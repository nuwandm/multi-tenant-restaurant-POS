import type { Sql, TransactionSql } from 'postgres';
import type { StaffSession } from '../auth/session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { instructionId, SwishError, type SwishClient, type SwishState } from './swish';

type Deps = { sql: Sql; swish: SwishClient };

/** How often a waiting till may make us ask Swish again. Callbacks usually come first. */
const RECHECK_MS = 2_000;

export interface SwishPaymentView {
  id: string;
  status: 'pending' | 'paid' | 'declined' | 'cancelled' | 'error';
  amountOre: number;
  errorCode: string | null;
  /** True if the payment was used for a receipt. */
  used: boolean;
  simulated: boolean;
}

interface AttemptRow {
  id: string;
  register_id: string;
  amount_ore: number;
  status: SwishPaymentView['status'];
  error_code: string | null;
  checked_at: Date | null;
  receipt_id: string | null;
}

const view = (row: AttemptRow, simulated: boolean): SwishPaymentView => ({
  id: row.id,
  status: row.status,
  amountOre: row.amount_ore,
  errorCode: row.error_code,
  used: row.receipt_id !== null,
  simulated,
});

/** Swish failed or was unreachable: tell the till plainly, the sale can use another method. */
function unavailable(err: unknown): HttpError {
  if (err instanceof SwishError) {
    return new HttpError(502, 'swish_failed', `Swish refused the payment (${err.code})`);
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
    return { row: row!, payee: place.swish_number, name: place.name };
  });

  // Swish is called outside the transaction: a slow answer must not hold a database connection.
  const id = instructionId(attempt.row.id);
  try {
    const { token } = await deps.swish.create({
      instructionId: id,
      payee: attempt.payee,
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
    const code = err instanceof SwishError ? err.code : 'UNREACHABLE';
    await withTenant(deps.sql, staff.tenantId, (tx) =>
      setState(tx, attempt.row.id, { status: 'error', errorCode: code }),
    );
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
  if (row.status !== 'pending') return view(row, deps.swish.simulated);
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
    state = await deps.swish.status(instructionId(row.id));
  } catch {
    // Swish is briefly unreachable: keep waiting, the next check may get through.
    return row;
  }
  return withTenant(deps.sql, tenantId, (tx) => setState(tx, row.id, state));
}

/** Records what Swish said. A payment that has ended never changes again. */
async function setState(tx: TransactionSql, id: string, state: SwishState): Promise<AttemptRow> {
  const [row] = await tx<AttemptRow[]>`
    UPDATE payment_attempts
    SET status = CASE WHEN status = 'pending' THEN ${state.status} ELSE status END,
        error_code = CASE WHEN status = 'pending' THEN ${state.errorCode ?? null} ELSE error_code END,
        paid_at = CASE WHEN status = 'pending' AND ${state.status} = 'paid'
                       THEN ${state.paidAt ?? new Date()} ELSE paid_at END,
        checked_at = now()
    WHERE id = ${id} RETURNING *`;
  return row!;
}

// Receipts -----------------------------------------------------------------------------------

export interface SwishPaymentUse {
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
  payments: (SwishPaymentUse & { method: string })[],
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
    const [row] = await tx<AttemptRow[]>`
      SELECT * FROM payment_attempts
      WHERE id = ${p.swishPaymentId} AND register_id = ${staff.registerId}
      FOR UPDATE`;
    if (!row || row.status !== 'paid') {
      throw new HttpError(409, 'swish_not_paid', 'Swish has not confirmed this payment');
    }
    if (row.receipt_id) {
      throw new HttpError(409, 'swish_already_used', 'This Swish payment is already on a receipt');
    }
    if (row.amount_ore !== p.amountOre) {
      throw new HttpError(
        409,
        'swish_amount_mismatch',
        'The Swish payment is for a different amount',
      );
    }
  }
  return async (receiptId) => {
    if (ids.size === 0) return;
    await tx`UPDATE payment_attempts SET receipt_id = ${receiptId} WHERE id IN ${tx([...ids])}`;
  };
}
