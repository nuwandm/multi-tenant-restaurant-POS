import { randomUUID } from 'node:crypto';
import type { ControlSystem } from '@pos/control-system';
import {
  buildReceipt,
  createJournalEvent,
  ore,
  type BuiltReceipt,
  type PaymentMethod,
  type VatRate,
} from '@pos/domain';
import type { Sql, TransactionSql } from 'postgres';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';

export interface CreateReceiptRequest {
  kind: 'sale' | 'training' | 'proforma';
  /** Prices, names and VAT rates come from the menu; the client sends only what and how many. */
  lines: { articleId: string; quantity: number; discountOre?: number }[];
  payments: { method: PaymentMethod; amountOre: number }[];
}

export interface CreatedReceipt extends BuiltReceipt {
  id: string;
  receiptNumber: number;
  createdAt: Date;
  controlCode: string;
  signedAt: Date;
  seller: { legalName: string; orgNumber: string };
  register: { id: string; designation: string };
}

interface RegisterRow {
  restaurant_id: string;
  designation: string;
  status: 'active' | 'retired';
  control_system_ref: string | null;
  legal_name: string;
  org_number: string;
}

interface ArticleRow {
  id: string;
  restaurant_id: string;
  name: string;
  price_ore: number;
  vat_rate: VatRate;
  active: boolean;
}

/**
 * Creates a receipt in one transaction: allocate the next number, sign with the control
 * system, store the receipt and its journal event, commit. Any failure, signing included,
 * rolls everything back, so no number is used and no unsigned receipt exists.
 */
export async function createReceipt(
  deps: { sql: Sql; controlSystem: ControlSystem },
  tenantId: string,
  registerId: string,
  request: CreateReceiptRequest,
): Promise<CreatedReceipt> {
  return withTenant(deps.sql, tenantId, async (tx) => {
    const [register] = await tx<RegisterRow[]>`
      SELECT r.restaurant_id, r.designation, r.status, r.control_system_ref,
             t.legal_name, t.org_number
      FROM cash_registers r JOIN tenants t ON t.id = r.tenant_id
      WHERE r.id = ${registerId}`;
    if (!register) throw new HttpError(404, 'register_not_found', 'Register not found');
    if (register.status !== 'active') {
      throw new HttpError(409, 'register_retired', 'This register is retired');
    }
    if (!register.control_system_ref) {
      throw new HttpError(
        409,
        'register_not_enrolled',
        'This register is not enrolled with the control system yet',
      );
    }

    const built = buildReceipt({
      kind: request.kind,
      lines: await priceLines(tx, register.restaurant_id, request.lines),
      payments: request.payments.map((p) => ({ method: p.method, amountOre: ore(p.amountOre) })),
    });

    const id = randomUUID();
    const createdAt = new Date();
    const receiptNumber = await nextValue(tx, tenantId, registerId, `receipt:${request.kind}`);

    const signed = await deps.controlSystem.signReceipt({
      idempotencyKey: id,
      controlSystemRef: register.control_system_ref,
      orgNumber: register.org_number,
      receiptNumber,
      kind: request.kind,
      createdAt,
      totalInclVatOre: built.totalOre,
      vatTotalsOre: Object.fromEntries(built.vatTotals.map((v) => [v.vatRate, v.vatOre])),
    });

    await tx`
      INSERT INTO receipts (id, tenant_id, register_id, kind, receipt_number, total_incl_vat_ore,
                            cash_rounding_ore, control_code, signed_at, created_at)
      VALUES (${id}, ${tenantId}, ${registerId}, ${request.kind}, ${receiptNumber}, ${built.totalOre},
              ${built.cashRoundingOre}, ${signed.controlCode}, ${signed.signedAt}, ${createdAt})`;
    await tx`
      INSERT INTO receipt_lines ${tx(
        built.lines.map((l) => ({
          tenant_id: tenantId,
          receipt_id: id,
          line_no: l.lineNo,
          article_id: l.articleId ?? null,
          article_name: l.name,
          quantity: l.quantity,
          unit_price_ore: l.unitPriceOre,
          vat_rate: l.vatRate,
          discount_ore: l.discountOre,
          line_total_ore: l.lineTotalOre,
        })),
      )}`;
    await tx`
      INSERT INTO receipt_vat_totals ${tx(
        built.vatTotals.map((v) => ({
          tenant_id: tenantId,
          receipt_id: id,
          vat_rate: v.vatRate,
          net_ore: v.netOre,
          vat_ore: v.vatOre,
        })),
      )}`;
    if (built.payments.length > 0) {
      await tx`
        INSERT INTO payments ${tx(
          built.payments.map((p) => ({
            tenant_id: tenantId,
            receipt_id: id,
            method: p.method,
            amount_ore: p.amountOre,
          })),
        )}`;
    }

    await appendJournalEvent(tx, tenantId, registerId, createdAt, {
      receiptId: id,
      kind: request.kind,
      receiptNumber,
      totalOre: built.totalOre,
      controlCode: signed.controlCode,
    });

    return {
      ...built,
      id,
      receiptNumber,
      createdAt,
      controlCode: signed.controlCode,
      signedAt: signed.signedAt,
      seller: { legalName: register.legal_name, orgNumber: register.org_number },
      register: { id: registerId, designation: register.designation },
    };
  });
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

/**
 * Next value of a gapless per-register series. The upsert row-locks the counter until the
 * transaction ends, so concurrent sales queue up and a rollback returns the number.
 */
async function nextValue(
  tx: TransactionSql,
  tenantId: string,
  registerId: string,
  name: string,
): Promise<number> {
  const [row] = await tx<{ value: number }[]>`
    INSERT INTO register_sequences (tenant_id, register_id, name, next_value)
    VALUES (${tenantId}, ${registerId}, ${name}, 2)
    ON CONFLICT (register_id, name) DO UPDATE SET next_value = register_sequences.next_value + 1
    RETURNING next_value - 1 AS value`;
  return row!.value;
}

async function appendJournalEvent(
  tx: TransactionSql,
  tenantId: string,
  registerId: string,
  occurredAt: Date,
  payload: Record<string, string | number>,
) {
  const seq = await nextValue(tx, tenantId, registerId, 'journal');
  const [prev] = await tx<{ seq: number; hash: string }[]>`
    SELECT seq, hash FROM journal_events WHERE register_id = ${registerId} AND seq = ${seq - 1}`;
  const event = await createJournalEvent(prev ?? null, {
    eventType: 'receipt',
    occurredAt,
    payload,
  });
  if (event.seq !== seq) throw new Error(`Journal out of step on register ${registerId}`);

  await tx`
    INSERT INTO journal_events (tenant_id, register_id, seq, event_type, occurred_at, payload, hash, prev_hash)
    VALUES (${tenantId}, ${registerId}, ${event.seq}, ${event.eventType}, ${event.occurredAt},
            ${tx.json(event.payload)}, ${event.hash}, ${event.prevHash})`;
}
