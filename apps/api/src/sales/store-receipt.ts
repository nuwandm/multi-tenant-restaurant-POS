import { randomUUID } from 'node:crypto';
import type { ControlSystem } from '@pos/control-system';
import type { BuiltReceipt } from '@pos/domain';
import type { TransactionSql } from 'postgres';
import type { StaffSession } from '../auth/session';
import { receiptTimestamp, type LockedRegister } from './register';
import { appendJournalEvent, nextValue } from './sequences';

export interface StoredReceipt extends BuiltReceipt {
  id: string;
  receiptNumber: number;
  createdAt: Date;
  controlCode: string;
  signedAt: Date;
  originalReceiptId: string | null;
  seller: { legalName: string; orgNumber: string };
  register: { id: string; designation: string };
  /** Who rang it up. Null only for receipts from before staff login existed. */
  cashier: { id: string; displayName: string } | null;
}

/**
 * Numbers, signs and stores a built receipt with its journal event. Must run inside the
 * transaction that holds the register lock; any failure rolls back the number too.
 * Copies keep the original's payments for printing but don't store them, so payment
 * totals only ever count real money.
 */
export async function storeReceipt(
  tx: TransactionSql,
  controlSystem: ControlSystem,
  staff: StaffSession,
  register: LockedRegister,
  built: BuiltReceipt,
  originalReceiptId: string | null = null,
  idempotencyKey: string | null = null,
): Promise<StoredReceipt> {
  const { tenantId } = staff;
  const id = randomUUID();
  const createdAt = receiptTimestamp(register);
  const receiptNumber = await nextValue(tx, tenantId, register.id, `receipt:${built.kind}`);

  const signed = await controlSystem.signReceipt({
    idempotencyKey: id,
    controlSystemRef: register.controlSystemRef!,
    orgNumber: register.seller.orgNumber,
    receiptNumber,
    kind: built.kind,
    createdAt,
    totalInclVatOre: built.totalOre,
    vatTotalsOre: Object.fromEntries(built.vatTotals.map((v) => [v.vatRate, v.vatOre])),
  });

  await tx`
    INSERT INTO receipts (id, tenant_id, register_id, kind, receipt_number, original_receipt_id,
                          cashier_user_id, total_incl_vat_ore, cash_rounding_ore, control_code,
                          signed_at, created_at, idempotency_key)
    VALUES (${id}, ${tenantId}, ${register.id}, ${built.kind}, ${receiptNumber}, ${originalReceiptId},
            ${staff.userId}, ${built.totalOre}, ${built.cashRoundingOre}, ${signed.controlCode},
            ${signed.signedAt}, ${createdAt}, ${idempotencyKey})`;
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
        original_line_no: l.originalLineNo ?? null,
        options: l.options ?? null,
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
  if (built.kind !== 'copy' && built.payments.length > 0) {
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

  await appendJournalEvent(tx, tenantId, register.id, 'receipt', createdAt, {
    receiptId: id,
    kind: built.kind,
    receiptNumber,
    totalOre: built.totalOre,
    controlCode: signed.controlCode,
    originalReceiptId,
  });

  return {
    ...built,
    id,
    receiptNumber,
    createdAt,
    controlCode: signed.controlCode,
    signedAt: signed.signedAt,
    originalReceiptId,
    seller: register.seller,
    register: { id: register.id, designation: register.designation },
    cashier: { id: staff.userId, displayName: staff.displayName },
  };
}
