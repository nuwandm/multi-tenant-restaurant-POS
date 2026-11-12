import type { ControlSystem } from '@pos/control-system';
import {
  buildCopy,
  buildReceipt,
  buildReturn,
  type BuiltReceipt,
  ore,
  type PaymentMethod,
} from '@pos/domain';
import type { Sql, TransactionSql } from 'postgres';
import type { StaffSession } from '../auth/session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { claimSwishPayments } from '../payments/swish-payments';
import { loadReceipts, type LoadedReceipt } from './load-receipts';
import { consumeOpenOrder } from './open-orders';
import { createKitchenTickets, priceLines, type LineRequest, type PricedLine } from './pricing';
import { lockRegister, type LockedRegister } from './register';
import { storeReceipt, type StoredReceipt } from './store-receipt';

type Deps = { sql: Sql; controlSystem: ControlSystem };
type PaymentRequest = { method: PaymentMethod; amountOre: number }[];
/** A sale's payments; a Swish payment names the payment Swish confirmed. */
type SalePaymentRequest = { method: PaymentMethod; amountOre: number; swishPaymentId?: string }[];

export interface CreateReceiptRequest {
  kind: 'sale' | 'training' | 'proforma';
  /** Prices, names and VAT rates come from the menu; the client sends only what and how many. */
  lines: LineRequest[];
  orderDiscountOre?: number;
  payments: SalePaymentRequest;
  /** Paying (part of) an open order: the sold lines come off it, in the same transaction. */
  openOrderId?: string;
}

export interface CreateReturnRequest {
  originalReceiptId: string;
  lines: { lineNo: number; quantity: number }[];
  payments: PaymentRequest;
}

const toPayments = (payments: PaymentRequest) =>
  payments.map((p) => ({ method: p.method, amountOre: ore(p.amountOre) }));

/**
 * Locks the register and, if this idempotency key already made a receipt on it, returns that
 * receipt instead of making another. Otherwise builds and stores a new one.
 */
async function onceOnRegister(
  deps: Deps,
  staff: StaffSession,
  idempotencyKey: string | null,
  allowPending: boolean,
  make: (
    tx: TransactionSql,
    register: LockedRegister,
  ) => Promise<{
    built: BuiltReceipt;
    originalReceiptId?: string;
    /** Runs after the receipt is stored, in the same transaction. */
    after?: (stored: StoredReceipt) => Promise<void>;
  }>,
): Promise<StoredReceipt> {
  return withTenant(deps.sql, staff.tenantId, async (tx) => {
    const register = await lockRegister(tx, staff.registerId, { forSelling: true, allowPending });
    if (idempotencyKey) {
      const [earlier] = await tx<{ id: string }[]>`
        SELECT id FROM receipts
        WHERE register_id = ${staff.registerId} AND idempotency_key = ${idempotencyKey}`;
      if (earlier) return (await loadReceipts(tx, [earlier.id]))[0]!;
    }
    const { built, originalReceiptId = null, after } = await make(tx, register);
    const stored = await storeReceipt(
      tx,
      deps.controlSystem,
      staff,
      register,
      built,
      originalReceiptId,
      idempotencyKey,
    );
    await after?.(stored);
    return stored;
  });
}

/** Sale, training or proforma receipt, priced from the register's menu. */
export async function createReceipt(
  deps: Deps,
  staff: StaffSession,
  request: CreateReceiptRequest,
  idempotencyKey: string | null = null,
): Promise<StoredReceipt> {
  // A company waiting for approval may ring up training receipts, never real sales.
  const training = request.kind === 'training';
  return onceOnRegister(deps, staff, idempotencyKey, training, async (tx, register) => {
    const priced = await priceLines(tx, register.restaurantId, request.lines);
    const linkSwish = await claimSwishPayments(tx, staff, request.kind, request.payments);
    const built = buildReceipt({
      kind: request.kind,
      lines: priced,
      ...(request.orderDiscountOre && { orderDiscountOre: ore(request.orderDiscountOre) }),
      payments: toPayments(request.payments),
    });
    return {
      built,
      // Paid items go to the kitchen: everything on a quick sale, or what an open order hadn't
      // sent yet. Proforma receipts are only quotes and send nothing.
      after: async (stored) => {
        await linkSwish(stored.id);
        if (request.kind === 'proforma') return;
        let label = `#${stored.receiptNumber}`;
        let toKitchen: PricedLine[] = priced;
        if (request.openOrderId) {
          const consumed = await consumeOpenOrder(tx, staff, request.openOrderId, priced);
          label = consumed.label;
          toKitchen = consumed.unsent;
        }
        await createKitchenTickets(
          tx,
          {
            tenantId: staff.tenantId,
            restaurantId: register.restaurantId,
            createdBy: staff.userId,
            label,
            training,
            openOrderId: request.openOrderId ?? null,
            receiptId: stored.id,
          },
          toKitchen,
        );
      },
    };
  });
}

/** Return of all or part of a sale, from any register of the same company. */
export async function createReturn(
  deps: Deps,
  staff: StaffSession,
  request: CreateReturnRequest,
  idempotencyKey: string | null = null,
): Promise<StoredReceipt> {
  return onceOnRegister(deps, staff, idempotencyKey, false, async (tx) => {
    // Two returns of the same receipt on different registers must not both pass the check.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${request.originalReceiptId}, 0))`;
    const original = await loadOriginal(tx, request.originalReceiptId);
    return {
      built: buildReturn(original, {
        lines: request.lines,
        alreadyReturned: original.returnedQuantities,
        payments: toPayments(request.payments),
      }),
      originalReceiptId: original.id,
    };
  });
}

/** Copy of an earlier receipt, numbered in this register's copy series. */
export async function createCopy(
  deps: Deps,
  staff: StaffSession,
  originalReceiptId: string,
  idempotencyKey: string | null = null,
): Promise<StoredReceipt> {
  return onceOnRegister(deps, staff, idempotencyKey, false, async (tx) => {
    const original = await loadOriginal(tx, originalReceiptId);
    return { built: buildCopy(original), originalReceiptId: original.id };
  });
}

/** Most recent receipts on the staff member's register, newest first. */
export async function listReceipts(
  deps: Deps,
  staff: StaffSession,
  limit: number,
): Promise<LoadedReceipt[]> {
  return withTenant(deps.sql, staff.tenantId, async (tx) => {
    const ids = await tx<{ id: string }[]>`
      SELECT id FROM receipts WHERE register_id = ${staff.registerId}
      ORDER BY created_at DESC, receipt_number DESC LIMIT ${limit}`;
    return loadReceipts(
      tx,
      ids.map((r) => r.id),
    );
  });
}

async function loadOriginal(tx: TransactionSql, id: string): Promise<LoadedReceipt> {
  const [original] = await loadReceipts(tx, [id]);
  if (!original) throw new HttpError(404, 'receipt_not_found', 'Receipt not found');
  return original;
}
