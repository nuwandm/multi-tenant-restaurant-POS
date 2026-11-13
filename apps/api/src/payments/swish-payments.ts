import type { Sql, TransactionSql } from 'postgres';
import type { StaffSession } from '../auth/session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { instructionId, SwishError, type SwishClient, type SwishState } from './swish';

type Deps = { sql: Sql; swish: SwishClient };

/** How often a waiting till may make us ask Swish again. Callbacks usually come first. */
const RECHECK_MS = 2_000;

/** What the guest sees in the Swish app for a refund. */
const REFUND_MESSAGE = 'Återbetalning';

export interface SwishPaymentView {
  id: string;
  kind: 'payment' | 'refund';
  status: 'pending' | 'paid' | 'declined' | 'cancelled' | 'error';
  amountOre: number;
  errorCode: string | null;
  /** True if the payment (or refund) is on a receipt. */
  used: boolean;
  simulated: boolean;
}

interface AttemptRow {
  id: string;
  register_id: string;
  kind: 'payment' | 'refund';
  original_attempt_id: string | null;
  amount_ore: number;
  payee: string;
  status: SwishPaymentView['status'];
  error_code: string | null;
  payment_reference: string | null;
  created_by: string;
  created_at: Date;
  checked_at: Date | null;
  receipt_id: string | null;
}

const view = (row: AttemptRow, simulated: boolean): SwishPaymentView => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  amountOre: row.amount_ore,
  errorCode: row.error_code,
  used: row.receipt_id !== null,
  simulated,
});

/** Swish failed or was unreachable: tell the till plainly, the sale can use another method. */
function unavailable(err: unknown): HttpError {
  if (err instanceof SwishError) {
    return new HttpError(502, 'swish_failed', `Swish refused the request (${err.code})`);
  }
  return new HttpError(502, 'swish_unavailable', 'Could not reach Swish');
}

/**
 * Asks Swish for a payment request for the amount on the till. The receipt is made later, by
 * the till, once the guest has paid.
 */
export async function startSwishPayment(
  deps: Deps,
  staff: StaffSession,
  amountOre: number,
): Promise<SwishPaymentView & { qrSvg: string }> {
  const attempt = await withTenant(deps.sql, staff.tenantId, async (tx) => {
    const [place] = await tx<{ swish_number: string | null; name: string }[]>`
      SELECT s.swish_number, s.name FROM cash_registers r
      JOIN restaurants s ON s.id = r.restaurant_id WHERE r.id = ${staff.registerId}`;
    if (!place) throw new HttpError(404, 'register_not_found', 'Register not found');
    if (!place.swish_number) {
      throw new HttpError(409, 'swish_not_set_up', 'This restaurant has no Swish number');
    }
    const [row] = await tx<AttemptRow[]>`
      INSERT INTO payment_attempts
        (tenant_id, register_id, provider, amount_ore, payee, created_by)
      VALUES (${staff.tenantId}, ${staff.registerId}, 'swish', ${amountOre},
              ${place.swish_number}, ${staff.userId})
      RETURNING *`;
    return { row: row!, name: place.name };
  });

  // Swish is called outside the transaction: a slow answer must not hold a database connection.
  const id = instructionId(attempt.row.id);
  try {
    const { token } = await deps.swish.create({
      instructionId: id,
      payee: attempt.row.payee,
      amountOre,
      message: attempt.name,
      callbackPath: `/${staff.tenantId}/${attempt.row.id}`,
    });
    const qrSvg = await deps.swish.qrSvg(token);
    const row = await withTenant(deps.sql, staff.tenantId, async (tx) => {
      const [updated] = await tx<AttemptRow[]>`
        UPDATE payment_attempts SET provider_ref = ${id}, token = ${token}
        WHERE id = ${attempt.row.id} RETURNING *`;
      return updated!;
    });
    return { ...view(row, deps.swish.simulated), qrSvg };
  } catch (err) {
    await failed(deps, staff.tenantId, attempt.row.id, err);
    throw unavailable(err);
  }
}

/** The current state, asking Swish if we haven't heard for a while. */
export async function getSwishPayment(
  deps: Deps,
  staff: StaffSession,
  attemptId: string,
): Promise<SwishPaymentView> {
  const row = await refresh(deps, staff.tenantId, attemptId, staff.registerId);
  return view(row, deps.swish.simulated);
}

/** Stops waiting. If the guest paid in the meantime, the payment is paid and stays usable. */
export async function cancelSwishPayment(
  deps: Deps,
  staff: StaffSession,
  attemptId: string,
): Promise<SwishPaymentView> {
  const row = await load(deps, staff.tenantId, attemptId, staff.registerId);
  // Swish refunds can't be cancelled; they finish on their own within seconds.
  if (row.status !== 'pending' || row.kind === 'refund') return view(row, deps.swish.simulated);
  let state: SwishState;
  try {
    state = await deps.swish.cancel(instructionId(row.id));
  } catch (err) {
    throw unavailable(err);
  }
  const updated = await withTenant(deps.sql, staff.tenantId, (tx) => setState(tx, row.id, state));
  return view(updated, deps.swish.simulated);
}

/**
 * Swish calls back when a request ends. We don't trust the body: anyone could post it. We only
 * take it as a hint to ask Swish ourselves, over mutual TLS.
 */
export async function onSwishCallback(deps: Deps, tenantId: string, attemptId: string) {
  try {
    await refresh(deps, tenantId, attemptId, null);
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 404) return;
    throw err;
  }
}

/** For development: what the guest's phone would do. Only the simulator allows it. */
export async function simulateSwishPayment(
  deps: Deps,
  staff: StaffSession,
  attemptId: string,
  outcome: 'paid' | 'declined',
): Promise<SwishPaymentView> {
  const swish = deps.swish as SwishClient & {
    simulate?: (id: string, outcome: 'paid' | 'declined') => boolean;
  };
  if (!swish.simulated || !swish.simulate) {
    throw new HttpError(404, 'not_found', 'Only the Swish simulator can simulate payments');
  }
  const row = await load(deps, staff.tenantId, attemptId, staff.registerId);
  swish.simulate(instructionId(row.id), outcome);
  return getSwishPayment(deps, staff, attemptId);
}

// Refunds ------------------------------------------------------------------------------------

/**
 * Gives Swish money back for a return of a receipt that was paid by Swish. The return receipt
 * is made by the till once Swish has paid the refund, like a sale waits for the payment.
 */
export async function startSwishRefund(
  deps: Deps,
  staff: StaffSession,
  originalReceiptId: string,
  amountOre: number,
): Promise<SwishPaymentView> {
  const refund = await withTenant(deps.sql, staff.tenantId, async (tx) => {
    // A refund for this amount that went out but never got its return receipt (the receipt
    // failed, the till was reloaded): use it again, never send the money twice.
    const [earlier] = await tx<AttemptRow[]>`
      SELECT r.* FROM payment_attempts r
      JOIN payment_attempts a ON a.id = r.original_attempt_id
      WHERE a.receipt_id = ${originalReceiptId} AND r.kind = 'refund' AND r.receipt_id IS NULL
        AND r.register_id = ${staff.registerId}
        AND r.status IN ('pending', 'paid') AND r.amount_ore = ${amountOre}
      ORDER BY r.created_at LIMIT 1`;
    if (earlier) return { earlier };

    // Locked so two refunds at once can't both take the last of the money.
    const originals = await tx<(AttemptRow & { refunded_ore: number })[]>`
      SELECT a.*, (SELECT coalesce(sum(x.amount_ore), 0) FROM payment_attempts x
                   WHERE x.original_attempt_id = a.id AND x.kind = 'refund' AND x.status IN ('pending', 'paid')
                  )::int8 AS refunded_ore
      FROM payment_attempts a
      WHERE a.receipt_id = ${originalReceiptId} AND a.kind = 'payment' AND a.status = 'paid'
      ORDER BY a.amount_ore DESC
      FOR UPDATE OF a`;
    if (originals.length === 0) {
      throw new HttpError(409, 'swish_not_refundable', 'This receipt was not paid through Swish');
    }
    const original = originals.find((o) => o.amount_ore - o.refunded_ore >= amountOre);
    if (!original) {
      throw new HttpError(
        409,
        'swish_refund_too_large',
        'The refund is more than is left of the Swish payment',
      );
    }
    return {
      fresh: await insertRefund(
        tx,
        staff.tenantId,
        staff.registerId,
        staff.userId,
        original,
        amountOre,
      ),
    };
  });
  if (refund.earlier) return getSwishPayment(deps, staff, refund.earlier.id);
  return sendRefund(deps, staff.tenantId, refund.fresh!);
}

/**
 * Gives back Swish money that never got a receipt, e.g. the till was closed after the guest
 * paid. With no receipt, there is nothing to return: only the money goes back.
 */
export async function refundUnusedSwishPayment(
  deps: Deps,
  tenantId: string,
  userId: string,
  paymentId: string,
): Promise<SwishPaymentView> {
  const refund = await withTenant(deps.sql, tenantId, async (tx) => {
    const [original] = await tx<AttemptRow[]>`
      SELECT * FROM payment_attempts WHERE id = ${paymentId} AND kind = 'payment' FOR UPDATE`;
    if (!original) throw new HttpError(404, 'payment_not_found', 'Payment not found');
    if (original.status !== 'paid' || original.receipt_id) {
      throw new HttpError(
        409,
        'swish_not_refundable',
        'Only paid Swish money without a receipt can be refunded here',
      );
    }
    const [live] = await tx`
      SELECT 1 FROM payment_attempts WHERE original_attempt_id = ${paymentId}
        AND kind = 'refund' AND status IN ('pending', 'paid')`;
    if (live)
      throw new HttpError(409, 'swish_already_refunded', 'This payment is already refunded');
    return insertRefund(tx, tenantId, original.register_id, userId, original, original.amount_ore);
  });
  return sendRefund(deps, tenantId, refund);
}

async function insertRefund(
  tx: TransactionSql,
  tenantId: string,
  registerId: string,
  userId: string,
  original: AttemptRow,
  amountOre: number,
): Promise<{ row: AttemptRow; original: AttemptRow }> {
  if (!original.payment_reference) {
    throw new HttpError(409, 'swish_not_refundable', 'Swish gave no reference for this payment');
  }
  const [row] = await tx<AttemptRow[]>`
    INSERT INTO payment_attempts
      (tenant_id, register_id, provider, kind, original_attempt_id, amount_ore, payee, created_by)
    VALUES (${tenantId}, ${registerId}, 'swish', 'refund', ${original.id}, ${amountOre},
            ${original.payee}, ${userId})
    RETURNING *`;
  return { row: row!, original };
}

async function sendRefund(
  deps: Deps,
  tenantId: string,
  { row, original }: { row: AttemptRow; original: AttemptRow },
): Promise<SwishPaymentView> {
  const id = instructionId(row.id);
  try {
    await deps.swish.refund({
      instructionId: id,
      originalPaymentReference: original.payment_reference!,
      payer: original.payee,
      amountOre: row.amount_ore,
      message: REFUND_MESSAGE,
      callbackPath: `/${tenantId}/${row.id}`,
    });
  } catch (err) {
    await failed(deps, tenantId, row.id, err);
    throw unavailable(err);
  }
  const updated = await withTenant(deps.sql, tenantId, async (tx) => {
    const [r] = await tx<AttemptRow[]>`
      UPDATE payment_attempts SET provider_ref = ${id} WHERE id = ${row.id} RETURNING *`;
    return r!;
  });
  return view(updated, deps.swish.simulated);
}

// Paid money without a receipt ---------------------------------------------------------------

/** Paid Swish money on this register that no receipt has used and that isn't refunded. */
export async function listUnusedSwishPayments(
  deps: Deps,
  staff: StaffSession,
): Promise<SwishPaymentView[]> {
  return withTenant(deps.sql, staff.tenantId, async (tx) => {
    const rows = await tx<AttemptRow[]>`
      SELECT a.* FROM payment_attempts a
      WHERE a.register_id = ${staff.registerId} AND a.kind = 'payment' AND a.status = 'paid'
        AND a.receipt_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM payment_attempts x
                        WHERE x.original_attempt_id = a.id AND x.kind = 'refund' AND x.status IN ('pending', 'paid'))
      ORDER BY a.created_at`;
    return rows.map((r) => view(r, deps.swish.simulated));
  });
}

export interface UnusedSwishPayment {
  id: string;
  amountOre: number;
  paidAt: Date | null;
  restaurant: string;
  register: string;
  takenBy: string;
  /** The latest refund of it, if one was tried. */
  refund: { status: SwishPaymentView['status']; errorCode: string | null } | null;
}

/**
 * For the back office: every paid Swish payment in the company without a receipt, including
 * ones being refunded, so an owner sees the refund go through. Refunded ones drop off.
 */
export async function listUnusedSwishForCompany(
  deps: Deps,
  tenantId: string,
): Promise<UnusedSwishPayment[]> {
  const load = () =>
    withTenant(
      deps.sql,
      tenantId,
      (tx) =>
        tx<
          {
            id: string;
            amount_ore: number;
            paid_at: Date | null;
            restaurant: string;
            register: string;
            taken_by: string;
            refund_id: string | null;
            refund_status: SwishPaymentView['status'] | null;
            refund_error: string | null;
          }[]
        >`
        SELECT a.id, a.amount_ore, a.paid_at, s.name AS restaurant, c.designation AS register,
               u.display_name AS taken_by,
               r.id AS refund_id, r.status AS refund_status, r.error_code AS refund_error
        FROM payment_attempts a
        JOIN cash_registers c ON c.id = a.register_id
        JOIN restaurants s ON s.id = c.restaurant_id
        JOIN users u ON u.id = a.created_by
        LEFT JOIN LATERAL (
          SELECT x.id, x.status, x.error_code FROM payment_attempts x
          WHERE x.original_attempt_id = a.id ORDER BY x.created_at DESC LIMIT 1
        ) r ON true
        WHERE a.kind = 'payment' AND a.status = 'paid' AND a.receipt_id IS NULL
          AND r.status IS DISTINCT FROM 'paid'
        ORDER BY a.created_at DESC`,
    );

  // Ask Swish about refunds still on their way, then list again.
  const rows = await load();
  const waiting = rows.filter((r) => r.refund_status === 'pending' && r.refund_id);
  if (waiting.length > 0) {
    await Promise.all(waiting.map((r) => refresh(deps, tenantId, r.refund_id!, null)));
  }
  return (waiting.length > 0 ? await load() : rows).map((r) => ({
    id: r.id,
    amountOre: r.amount_ore,
    paidAt: r.paid_at,
    restaurant: r.restaurant,
    register: r.register,
    takenBy: r.taken_by,
    refund: r.refund_status ? { status: r.refund_status, errorCode: r.refund_error } : null,
  }));
}

// State --------------------------------------------------------------------------------------

async function load(
  deps: Deps,
  tenantId: string,
  attemptId: string,
  registerId: string | null,
): Promise<AttemptRow> {
  return withTenant(deps.sql, tenantId, async (tx) => {
    const [row] = await tx<AttemptRow[]>`
      SELECT * FROM payment_attempts
      WHERE id = ${attemptId} AND (${registerId}::uuid IS NULL OR register_id = ${registerId}::uuid)`;
    if (!row) throw new HttpError(404, 'payment_not_found', 'Payment not found');
    return row;
  });
}

async function refresh(
  deps: Deps,
  tenantId: string,
  attemptId: string,
  registerId: string | null,
): Promise<AttemptRow> {
  const row = await load(deps, tenantId, attemptId, registerId);
  const recent = row.checked_at && Date.now() - row.checked_at.getTime() < RECHECK_MS;
  if (row.status !== 'pending' || recent) return row;
  let state: SwishState;
  try {
    const id = instructionId(row.id);
    state = row.kind === 'refund' ? await deps.swish.refundStatus(id) : await deps.swish.status(id);
  } catch {
    // Swish is briefly unreachable: keep waiting, the next check may get through.
    return row;
  }
  return withTenant(deps.sql, tenantId, (tx) => setState(tx, row.id, state));
}

async function failed(deps: Deps, tenantId: string, attemptId: string, err: unknown) {
  const code = err instanceof SwishError ? err.code : 'UNREACHABLE';
  await withTenant(deps.sql, tenantId, (tx) =>
    setState(tx, attemptId, { status: 'error', errorCode: code }),
  );
}

/** Records what Swish said. A payment that has ended never changes again. */
async function setState(tx: TransactionSql, id: string, state: SwishState): Promise<AttemptRow> {
  const [row] = await tx<AttemptRow[]>`
    UPDATE payment_attempts
    SET status = CASE WHEN status = 'pending' THEN ${state.status} ELSE status END,
        error_code = CASE WHEN status = 'pending' THEN ${state.errorCode ?? null} ELSE error_code END,
        paid_at = CASE WHEN status = 'pending' AND ${state.status} = 'paid'
                       THEN ${state.paidAt ?? new Date()} ELSE paid_at END,
        payment_reference = coalesce(payment_reference, ${state.paymentReference ?? null}),
        checked_at = now()
    WHERE id = ${id} RETURNING *`;
  return row!;
}

// Receipts -----------------------------------------------------------------------------------

export interface SwishPaymentUse {
  method: string;
  amountOre: number;
  swishPaymentId?: string;
}

/**
 * Checks the Swish payments on a new sale, inside the receipt's transaction. Where the
 * restaurant has Swish set up, every Swish payment must be one Swish confirmed as paid, for
 * exactly that amount, not used before. Returns a function that links them to the receipt.
 */
export async function claimSwishPayments(
  tx: TransactionSql,
  staff: StaffSession,
  kind: 'sale' | 'training' | 'proforma',
  payments: SwishPaymentUse[],
): Promise<(receiptId: string) => Promise<void>> {
  const swish = payments.filter((p) => p.method === 'swish');
  const linked = payments.filter((p) => p.swishPaymentId);
  if (linked.some((p) => p.method !== 'swish')) {
    throw new HttpError(400, 'invalid_payment', 'Only Swish payments can carry a Swish payment id');
  }
  if (kind !== 'sale') {
    if (linked.length > 0) {
      throw new HttpError(400, 'invalid_payment', 'Training receipts and quotes take no money');
    }
    return async () => {};
  }

  const [place] = await tx<{ swish_number: string | null }[]>`
    SELECT s.swish_number FROM cash_registers r
    JOIN restaurants s ON s.id = r.restaurant_id WHERE r.id = ${staff.registerId}`;
  if (!place?.swish_number) return async () => {};

  const ids = new Set<string>();
  for (const p of swish) {
    if (!p.swishPaymentId) {
      throw new HttpError(
        409,
        'swish_not_paid',
        'Swish payments here go through Swish: show the guest the QR code first',
      );
    }
    if (ids.has(p.swishPaymentId)) {
      throw new HttpError(409, 'swish_not_paid', 'The same Swish payment is listed twice');
    }
    ids.add(p.swishPaymentId);
    const [row] = await tx<(AttemptRow & { refunded: boolean })[]>`
      SELECT a.*, EXISTS (SELECT 1 FROM payment_attempts x WHERE x.original_attempt_id = a.id
                          AND x.kind = 'refund' AND x.status IN ('pending', 'paid')) AS refunded
      FROM payment_attempts a
      WHERE a.id = ${p.swishPaymentId} AND a.register_id = ${staff.registerId}
        AND a.kind = 'payment'
      FOR UPDATE OF a`;
    if (!row || row.status !== 'paid') {
      throw new HttpError(409, 'swish_not_paid', 'Swish has not confirmed this payment');
    }
    if (row.receipt_id || row.refunded) {
      throw new HttpError(
        409,
        'swish_already_used',
        'This Swish payment is already on a receipt or refunded',
      );
    }
    if (row.amount_ore !== p.amountOre) {
      throw new HttpError(
        409,
        'swish_amount_mismatch',
        'The Swish payment is for a different amount',
      );
    }
  }
  return linkTo(tx, ids);
}

/**
 * Checks the Swish refunds on a return, inside its transaction. If the sale was paid through
 * Swish, its Swish money can only go back through Swish: each Swish payment on the return must
 * be a refund Swish has paid, of that sale's payment, for exactly that amount.
 */
export async function claimSwishRefunds(
  tx: TransactionSql,
  staff: StaffSession,
  originalReceiptId: string,
  payments: (SwishPaymentUse & { swishRefundId?: string })[],
): Promise<(receiptId: string) => Promise<void>> {
  const linked = payments.filter((p) => p.swishRefundId);
  if (linked.some((p) => p.method !== 'swish')) {
    throw new HttpError(400, 'invalid_payment', 'Only Swish payments can carry a Swish refund id');
  }
  const [paidBySwish] = await tx`
    SELECT 1 FROM payment_attempts
    WHERE receipt_id = ${originalReceiptId} AND kind = 'payment'`;
  if (!paidBySwish) {
    if (linked.length > 0) {
      throw new HttpError(400, 'invalid_payment', 'This sale was not paid through Swish');
    }
    return async () => {};
  }

  const ids = new Set<string>();
  for (const p of payments.filter((x) => x.method === 'swish')) {
    if (!p.swishRefundId || ids.has(p.swishRefundId)) {
      throw new HttpError(
        409,
        'swish_refund_needed',
        'This sale was paid through Swish: refund it through Swish first',
      );
    }
    ids.add(p.swishRefundId);
    const [row] = await tx<AttemptRow[]>`
      SELECT r.* FROM payment_attempts r
      JOIN payment_attempts a ON a.id = r.original_attempt_id
      WHERE r.id = ${p.swishRefundId} AND r.kind = 'refund' AND r.register_id = ${staff.registerId}
        AND a.receipt_id = ${originalReceiptId}
      FOR UPDATE OF r`;
    if (!row || row.status !== 'paid') {
      throw new HttpError(409, 'swish_refund_needed', 'Swish has not paid this refund yet');
    }
    if (row.receipt_id) {
      throw new HttpError(409, 'swish_already_used', 'This Swish refund is already on a receipt');
    }
    if (row.amount_ore !== -p.amountOre) {
      throw new HttpError(
        409,
        'swish_amount_mismatch',
        'The Swish refund is for a different amount',
      );
    }
  }
  return linkTo(tx, ids);
}

const linkTo = (tx: TransactionSql, ids: Set<string>) => async (receiptId: string) => {
  if (ids.size === 0) return;
  await tx`UPDATE payment_attempts SET receipt_id = ${receiptId} WHERE id IN ${tx([...ids])}`;
};

/** For the till's receipt list: how much Swish money each receipt can still give back. */
export async function swishRefundable(
  tx: TransactionSql,
  receiptIds: string[],
): Promise<Map<string, number>> {
  if (receiptIds.length === 0) return new Map();
  const rows = await tx<{ receipt_id: string; left_ore: number }[]>`
    SELECT a.receipt_id,
           sum(a.amount_ore - (SELECT coalesce(sum(x.amount_ore), 0) FROM payment_attempts x
                               WHERE x.original_attempt_id = a.id AND x.kind = 'refund' AND x.status IN ('pending', 'paid'))
              )::int8 AS left_ore
    FROM payment_attempts a
    WHERE a.receipt_id IN ${tx(receiptIds)} AND a.kind = 'payment' AND a.status = 'paid'
    GROUP BY a.receipt_id`;
  return new Map(rows.map((r) => [r.receipt_id, r.left_ore]));
}
