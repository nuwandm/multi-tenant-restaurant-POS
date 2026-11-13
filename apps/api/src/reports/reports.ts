import {
  aggregateZReport,
  ore,
  type BuiltReceipt,
  type ExportReportTotals,
  type PaymentMethod,
  type ReceiptKind,
  type VatRate,
  type ZReportTotals,
} from '@pos/domain';
import type { Sql, TransactionSql } from 'postgres';
import type { StaffSession } from '../auth/session';
import { withTenant } from '../db/tenant';
import { orderTotal, type OrderLine } from '../sales/open-orders';
import { lockRegister, type LockedRegister } from '../sales/register';
import { appendJournalEvent, nextValue } from '../sales/sequences';

export interface Report extends ZReportTotals {
  periodFrom: Date;
  periodTo: Date;
  seller: { legalName: string; orgNumber: string; address: string | null };
  /** Växelkassa. No cash float is kept yet, so 0. */
  floatOre: number;
  /** Other registrations that reduced the day's sales (deleted items): not registered yet. */
  reducingCount: number;
  reducingTotalOre: number;
  /** Sales started on this register but not finished: its open table orders. */
  unfinishedCount: number;
  unfinishedTotalOre: number;
  register: { id: string; designation: string };
}

export interface ZReport extends Report {
  id: string;
  zNumber: number;
}

/** X report: totals of the open period so far. Changes nothing except the journal. */
export async function createXReport(sql: Sql, staff: StaffSession): Promise<Report> {
  const { tenantId, registerId } = staff;
  return withTenant(sql, tenantId, async (tx) => {
    const register = await lockRegister(tx, registerId, { forSelling: false });
    const report = await openPeriodReport(tx, register);
    // X reports are not stored anywhere else, so the journal keeps all their totals.
    await appendJournalEvent(tx, tenantId, registerId, 'x_report', report.periodTo, {
      takenBy: staff.userId,
      periodFrom: report.periodFrom.toISOString(),
      periodTo: report.periodTo.toISOString(),
      netTotalOre: report.netTotalOre,
      totals: { ...exportTotals(report) },
    });
    return report;
  });
}

/** Z report: closes the open period, stores its totals for good and numbers it. */
export async function createZReport(sql: Sql, staff: StaffSession): Promise<ZReport> {
  const { tenantId, registerId } = staff;
  return withTenant(sql, tenantId, async (tx) => {
    const register = await lockRegister(tx, registerId, { forSelling: false });
    const report = await openPeriodReport(tx, register);
    const zNumber = await nextValue(tx, tenantId, registerId, 'z_report');

    const [row] = await tx<{ id: string }[]>`
      INSERT INTO z_reports ${tx({
        tenant_id: tenantId,
        register_id: registerId,
        z_number: zNumber,
        period_from: report.periodFrom,
        period_to: report.periodTo,
        sale_count: report.counts.sale,
        sales_total_ore: report.salesTotalOre,
        return_count: report.counts.return,
        return_total_ore: report.returnsTotalOre,
        net_total_ore: report.netTotalOre,
        totals_by_vat: tx.json(report.totalsByVat as never),
        totals_by_payment: tx.json(report.totalsByPayment as never),
        cash_rounding_ore: report.cashRoundingOre,
        copy_count: report.counts.copy,
        copy_total_ore: report.copyTotalOre,
        training_count: report.counts.training,
        training_total_ore: report.trainingTotalOre,
        proforma_count: report.counts.proforma,
        proforma_total_ore: report.proformaTotalOre,
        drawer_open_count: report.drawerOpenCount,
        discount_total_ore: report.discountTotalOre,
        items_sold_count: report.itemsSoldCount,
        float_ore: report.floatOre,
        reducing_count: report.reducingCount,
        reducing_total_ore: report.reducingTotalOre,
        unfinished_count: report.unfinishedCount,
        unfinished_total_ore: report.unfinishedTotalOre,
        grand_sales_ore: report.grandTotals.salesOre,
        grand_returns_ore: report.grandTotals.returnsOre,
        grand_total_ore: report.grandTotals.netOre,
      })}
      RETURNING id`;

    await appendJournalEvent(tx, tenantId, registerId, 'z_report', report.periodTo, {
      zReportId: row!.id,
      takenBy: staff.userId,
      zNumber,
      periodFrom: report.periodFrom.toISOString(),
      periodTo: report.periodTo.toISOString(),
      netTotalOre: report.netTotalOre,
      grandNetOre: report.grandTotals.netOre,
    });
    return { ...report, id: row!.id, zNumber };
  });
}

/** Totals from the end of the last Z report (or the register's creation) up to now. */
async function openPeriodReport(tx: TransactionSql, register: LockedRegister): Promise<Report> {
  const [last] = await tx<
    { period_to: Date; grand_sales_ore: number; grand_returns_ore: number }[]
  >`
    SELECT period_to, grand_sales_ore, grand_returns_ore FROM z_reports
    WHERE register_id = ${register.id} ORDER BY z_number DESC LIMIT 1`;
  const periodFrom = last?.period_to ?? register.createdAt;
  const periodTo = new Date(Math.max(Date.now(), periodFrom.getTime()));

  const totals = aggregateZReport({
    receipts: await periodReceipts(tx, register.id, periodFrom, periodTo),
    // Drawer openings are not tracked yet (no cash drawer integration).
    drawerOpenCount: 0,
    previousGrandTotals: {
      salesOre: ore(last?.grand_sales_ore ?? 0),
      returnsOre: ore(last?.grand_returns_ore ?? 0),
    },
  });

  const open = await tx<{ lines: OrderLine[]; order_discount_ore: number }[]>`
    SELECT lines, order_discount_ore FROM open_orders
    WHERE register_id = ${register.id} AND status = 'open'`;

  return {
    ...totals,
    floatOre: 0,
    reducingCount: 0,
    reducingTotalOre: 0,
    unfinishedCount: open.length,
    unfinishedTotalOre: open.reduce((sum, o) => sum + orderTotal(o.lines, o.order_discount_ore), 0),
    periodFrom,
    periodTo,
    seller: register.seller,
    register: { id: register.id, designation: register.designation },
  };
}

/** The receipt fields aggregateZReport needs, with lines for discounts and items sold. */
async function periodReceipts(
  tx: TransactionSql,
  registerId: string,
  from: Date,
  to: Date,
): Promise<BuiltReceipt[]> {
  const receipts = await tx<
    { id: string; kind: ReceiptKind; total_incl_vat_ore: number; cash_rounding_ore: number }[]
  >`
    SELECT id, kind, total_incl_vat_ore, cash_rounding_ore FROM receipts
    WHERE register_id = ${registerId} AND created_at > ${from} AND created_at <= ${to}`;
  if (receipts.length === 0) return [];
  const ids = receipts.map((r) => r.id);

  const vat = await tx<
    { receipt_id: string; vat_rate: VatRate; net_ore: number; vat_ore: number }[]
  >`
    SELECT receipt_id, vat_rate, net_ore, vat_ore FROM receipt_vat_totals WHERE receipt_id IN ${tx(ids)}`;
  const payments = await tx<{ receipt_id: string; method: PaymentMethod; amount_ore: number }[]>`
    SELECT receipt_id, method, amount_ore FROM payments WHERE receipt_id IN ${tx(ids)}`;
  const lines = await tx<
    {
      receipt_id: string;
      line_no: number;
      article_name: string;
      quantity: number;
      unit_price_ore: number;
      vat_rate: VatRate;
      discount_ore: number;
      line_total_ore: number;
    }[]
  >`
    SELECT receipt_id, line_no, article_name, quantity, unit_price_ore, vat_rate, discount_ore,
           line_total_ore
    FROM receipt_lines WHERE receipt_id IN ${tx(ids)}`;

  return receipts.map((r) => ({
    kind: r.kind,
    lines: lines
      .filter((l) => l.receipt_id === r.id)
      .map((l) => ({
        lineNo: l.line_no,
        name: l.article_name,
        quantity: l.quantity,
        unitPriceOre: ore(l.unit_price_ore),
        vatRate: l.vat_rate,
        discountOre: ore(l.discount_ore),
        lineTotalOre: ore(l.line_total_ore),
      })),
    totalOre: ore(r.total_incl_vat_ore),
    cashRoundingOre: ore(r.cash_rounding_ore),
    vatTotals: vat
      .filter((v) => v.receipt_id === r.id)
      .map((v) => ({
        vatRate: v.vat_rate,
        grossOre: ore(v.net_ore + v.vat_ore),
        netOre: ore(v.net_ore),
        vatOre: ore(v.vat_ore),
      })),
    payments: payments
      .filter((p) => p.receipt_id === r.id)
      .map((p) => ({ method: p.method, amountOre: ore(p.amount_ore) })),
  }));
}

/** A report's totals in the shape of the journal export (24–25 kap. SKVFS 2021:16). */
export function exportTotals(report: Report): ExportReportTotals {
  return {
    totalSalesOre: report.salesTotalOre,
    vatTotals: report.totalsByVat.map((v) => ({ vatRate: v.vatRate, vatOre: v.vatOre })),
    floatOre: report.floatOre,
    itemsSoldCount: report.itemsSoldCount,
    receiptCount: report.counts.sale,
    drawerOpenCount: report.drawerOpenCount,
    copyCount: report.counts.copy,
    copyTotalOre: report.copyTotalOre,
    trainingCount: report.counts.training,
    trainingTotalOre: report.trainingTotalOre,
    payments: Object.entries(report.totalsByPayment).map(([method, amountOre]) => ({
      method: method as PaymentMethod,
      amountOre: amountOre ?? 0,
    })),
    returnCount: report.counts.return,
    returnTotalOre: report.returnsTotalOre,
    discountTotalOre: report.discountTotalOre,
    reducingCount: report.reducingCount,
    reducingTotalOre: report.reducingTotalOre,
    unfinishedCount: report.unfinishedCount,
    unfinishedTotalOre: report.unfinishedTotalOre,
    grandSalesOre: report.grandTotals.salesOre,
    grandReturnsOre: report.grandTotals.returnsOre,
    grandNetOre: report.grandTotals.netOre,
  };
}
