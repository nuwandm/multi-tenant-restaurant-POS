import type { ControlSystem } from '@pos/control-system';
import {
  buildCopy,
  buildReceipt,
  buildReturn,
  type BuiltReceipt,
  ore,
  type PaymentMethod,
  type VatRate,
} from '@pos/domain';
import type { Sql, TransactionSql } from 'postgres';
import type { StaffSession } from '../auth/session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { loadReceipts, type LoadedReceipt } from './load-receipts';
import { lockRegister, type LockedRegister } from './register';
import { storeReceipt, type StoredReceipt } from './store-receipt';

type Deps = { sql: Sql; controlSystem: ControlSystem };
type PaymentRequest = { method: PaymentMethod; amountOre: number }[];

export interface CreateReceiptRequest {
  kind: 'sale' | 'training' | 'proforma';
  /** Prices, names and VAT rates come from the menu; the client sends only what and how many. */
  lines: { articleId: string; quantity: number; discountOre?: number }[];
  payments: PaymentRequest;
}

export interface CreateReturnRequest {
  originalReceiptId: string;
  lines: { lineNo: number; quantity: number }[];
  payments: PaymentRequest;
}

interface ArticleRow {
  id: string;
  restaurant_id: string;
  name: string;
  price_ore: number;
  vat_rate: VatRate;
  active: boolean;
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
  ) => Promise<{ built: BuiltReceipt; originalReceiptId?: string }>,
): Promise<StoredReceipt> {
  return withTenant(deps.sql, staff.tenantId, async (tx) => {
    const register = await lockRegister(tx, staff.registerId, { forSelling: true, allowPending });
    if (idempotencyKey) {
      const [earlier] = await tx<{ id: string }[]>`
        SELECT id FROM receipts
        WHERE register_id = ${staff.registerId} AND idempotency_key = ${idempotencyKey}`;
      if (earlier) return (await loadReceipts(tx, [earlier.id]))[0]!;
    }
    const { built, originalReceiptId = null } = await make(tx, register);
    return storeReceipt(
      tx,
      deps.controlSystem,
      staff,
      register,
      built,
      originalReceiptId,
      idempotencyKey,
    );
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
  return onceOnRegister(deps, staff, idempotencyKey, training, async (tx, register) => ({
    built: buildReceipt({
      kind: request.kind,
      lines: await priceLines(tx, register.restaurantId, request.lines),
      payments: toPayments(request.payments),
    }),
  }));
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

async function priceLines(
  tx: TransactionSql,
  restaurantId: string,
  lines: CreateReceiptRequest['lines'],
) {
  const ids = [...new Set(lines.map((l) => l.articleId))];
  const articles = await tx<ArticleRow[]>`
    SELECT id, restaurant_id, name, price_ore, vat_rate, active FROM articles WHERE id IN ${tx(ids)}`;
  const byId = new Map(articles.map((a) => [a.id, a]));

  return lines.map((line, i) => {
    const article = byId.get(line.articleId);
    if (!article || !article.active || article.restaurant_id !== restaurantId) {
      throw new HttpError(
        400,
        'article_unavailable',
        `Line ${i + 1}: article is not on sale at this register`,
      );
    }
    return {
      articleId: article.id,
      name: article.name,
      quantity: line.quantity,
      unitPriceOre: ore(article.price_ore),
      vatRate: article.vat_rate,
      ...(line.discountOre !== undefined && { discountOre: ore(line.discountOre) }),
    };
  });
}
