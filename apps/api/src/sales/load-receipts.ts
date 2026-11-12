import { ore, type PaymentMethod, type ReceiptKind, type VatRate } from '@pos/domain';
import type { TransactionSql } from 'postgres';
import type { StoredReceipt } from './store-receipt';

export interface LoadedReceipt extends StoredReceipt {
  /** For sales: quantity already returned per line number. */
  returnedQuantities: Record<number, number>;
}

interface ReceiptRow {
  id: string;
  kind: ReceiptKind;
  receipt_number: number;
  original_receipt_id: string | null;
  total_incl_vat_ore: number;
  cash_rounding_ore: number;
  control_code: string;
  signed_at: Date;
  created_at: Date;
  register_id: string;
  designation: string;
  legal_name: string;
  org_number: string;
}

/** Loads receipts with lines, VAT, payments and returned quantities, in the order of ids. */
export async function loadReceipts(tx: TransactionSql, ids: string[]): Promise<LoadedReceipt[]> {
  if (ids.length === 0) return [];

  const rows = await tx<ReceiptRow[]>`
    SELECT r.id, r.kind, r.receipt_number, r.original_receipt_id, r.total_incl_vat_ore,
           r.cash_rounding_ore, r.control_code, r.signed_at, r.created_at, r.register_id,
           c.designation, t.legal_name, t.org_number
    FROM receipts r
    JOIN cash_registers c ON c.id = r.register_id
    JOIN tenants t ON t.id = r.tenant_id
    WHERE r.id IN ${tx(ids)}`;
  const lines = await tx<
    {
      receipt_id: string;
      line_no: number;
      article_id: string | null;
      article_name: string;
      quantity: number;
      unit_price_ore: number;
      vat_rate: VatRate;
      discount_ore: number;
      line_total_ore: number;
      original_line_no: number | null;
    }[]
  >`SELECT * FROM receipt_lines WHERE receipt_id IN ${tx(ids)} ORDER BY receipt_id, line_no`;
  const vat = await tx<
    { receipt_id: string; vat_rate: VatRate; net_ore: number; vat_ore: number }[]
  >`SELECT * FROM receipt_vat_totals WHERE receipt_id IN ${tx(ids)} ORDER BY vat_rate DESC`;
  const payments = await tx<
    {
      receipt_id: string;
      original_receipt_id: string | null;
      method: PaymentMethod;
      amount_ore: number;
    }[]
  >`
    SELECT p.receipt_id, r.original_receipt_id, p.method, p.amount_ore
    FROM payments p JOIN receipts r ON r.id = p.receipt_id
    WHERE p.receipt_id IN ${tx(ids)}
       OR p.receipt_id IN (SELECT original_receipt_id FROM receipts
                           WHERE id IN ${tx(ids)} AND kind = 'copy')`;
  const returned = await tx<{ original_receipt_id: string; line_no: number; quantity: number }[]>`
    SELECT r.original_receipt_id, l.original_line_no AS line_no, (-sum(l.quantity))::int AS quantity
    FROM receipts r JOIN receipt_lines l ON l.receipt_id = r.id
    WHERE r.kind = 'return' AND r.original_receipt_id IN ${tx(ids)}
    GROUP BY r.original_receipt_id, l.original_line_no`;

  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    // A copy shows the payments of the receipt it copies.
    const paymentSource = r.kind === 'copy' ? r.original_receipt_id : r.id;
    return [
      {
        id: r.id,
        kind: r.kind,
        receiptNumber: r.receipt_number,
        originalReceiptId: r.original_receipt_id,
        createdAt: r.created_at,
        controlCode: r.control_code,
        signedAt: r.signed_at,
        totalOre: ore(r.total_incl_vat_ore),
        cashRoundingOre: ore(r.cash_rounding_ore),
        seller: { legalName: r.legal_name, orgNumber: r.org_number },
        register: { id: r.register_id, designation: r.designation },
        lines: lines
          .filter((l) => l.receipt_id === id)
          .map((l) => ({
            lineNo: l.line_no,
            ...(l.article_id !== null && { articleId: l.article_id }),
            name: l.article_name,
            quantity: l.quantity,
            unitPriceOre: ore(l.unit_price_ore),
            vatRate: l.vat_rate,
            discountOre: ore(l.discount_ore),
            lineTotalOre: ore(l.line_total_ore),
            ...(l.original_line_no !== null && { originalLineNo: l.original_line_no }),
          })),
        vatTotals: vat
          .filter((v) => v.receipt_id === id)
          .map((v) => ({
            vatRate: v.vat_rate,
            grossOre: ore(v.net_ore + v.vat_ore),
            netOre: ore(v.net_ore),
            vatOre: ore(v.vat_ore),
          })),
        payments: payments
          .filter((p) => p.receipt_id === paymentSource)
          .map((p) => ({ method: p.method, amountOre: ore(p.amount_ore) })),
        returnedQuantities: Object.fromEntries(
          returned.filter((x) => x.original_receipt_id === id).map((x) => [x.line_no, x.quantity]),
        ),
      },
    ];
  });
}
