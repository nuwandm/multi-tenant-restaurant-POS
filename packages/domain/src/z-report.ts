import { addOre, ore, type Ore } from './money';
import type { BuiltReceipt, PaymentMethod, ReceiptKind } from './receipt';
import type { VatRate, VatTotal } from './vat';

export interface GrandTotals {
  salesOre: Ore;
  returnsOre: Ore;
}

export interface ZReportInput {
  /** Every receipt from the register in the period, of every kind. */
  receipts: BuiltReceipt[];
  drawerOpenCount: number;
  /** Grand totals from the previous Z report (zeros for the first one). */
  previousGrandTotals: GrandTotals;
}

export interface ZReportTotals {
  salesTotalOre: Ore;
  returnsTotalOre: Ore;
  netTotalOre: Ore;
  /** Sum of the VAT printed on each sale and return, per rate, highest rate first. */
  totalsByVat: VatTotal[];
  totalsByPayment: Partial<Record<PaymentMethod, Ore>>;
  cashRoundingOre: Ore;
  /** Discounts given on sales, less the discount share of returns. */
  discountTotalOre: Ore;
  /** Items sold, less items returned. Every item counts as goods (varor). */
  itemsSoldCount: number;
  counts: Record<ReceiptKind, number>;
  copyTotalOre: Ore;
  trainingTotalOre: Ore;
  proformaTotalOre: Ore;
  drawerOpenCount: number;
  grandTotals: GrandTotals & { netOre: Ore };
}

/**
 * Totals for a Z report. Only sales and returns count as turnover; copies, training and
 * proforma receipts are counted and totalled separately. Field list to be checked against
 * SKVFS 2014:9 as amended by 2021:17 in Phase 5.
 */
export function aggregateZReport(input: ZReportInput): ZReportTotals {
  const ofKind = (kind: ReceiptKind) => input.receipts.filter((r) => r.kind === kind);
  const sumTotals = (receipts: BuiltReceipt[]) => addOre(...receipts.map((r) => r.totalOre));

  const sales = ofKind('sale');
  const returns = ofKind('return');
  const turnover = [...sales, ...returns];

  const vat = new Map<VatRate, { gross: number; net: number; vat: number }>();
  for (const t of turnover.flatMap((r) => r.vatTotals)) {
    const acc = vat.get(t.vatRate) ?? { gross: 0, net: 0, vat: 0 };
    vat.set(t.vatRate, {
      gross: acc.gross + t.grossOre,
      net: acc.net + t.netOre,
      vat: acc.vat + t.vatOre,
    });
  }

  const totalsByPayment: Partial<Record<PaymentMethod, Ore>> = {};
  for (const p of turnover.flatMap((r) => r.payments)) {
    totalsByPayment[p.method] = ore((totalsByPayment[p.method] ?? 0) + p.amountOre);
  }

  const salesTotalOre = sumTotals(sales);
  const returnsTotalOre = sumTotals(returns);
  const grandSales = addOre(input.previousGrandTotals.salesOre, salesTotalOre);
  const grandReturns = addOre(input.previousGrandTotals.returnsOre, returnsTotalOre);

  return {
    salesTotalOre,
    returnsTotalOre,
    netTotalOre: addOre(salesTotalOre, returnsTotalOre),
    totalsByVat: [...vat.entries()]
      .sort(([a], [b]) => b - a)
      .map(([vatRate, t]) => ({
        vatRate,
        grossOre: ore(t.gross),
        netOre: ore(t.net),
        vatOre: ore(t.vat),
      })),
    totalsByPayment,
    cashRoundingOre: addOre(...turnover.map((r) => r.cashRoundingOre)),
    // A line's discount is always ≥ 0; its sign follows the quantity, negative on returns.
    discountTotalOre: ore(
      turnover
        .flatMap((r) => r.lines)
        .reduce((sum, l) => sum + Math.sign(l.quantity) * l.discountOre, 0),
    ),
    itemsSoldCount: turnover.flatMap((r) => r.lines).reduce((sum, l) => sum + l.quantity, 0),
    counts: {
      sale: sales.length,
      return: returns.length,
      copy: ofKind('copy').length,
      training: ofKind('training').length,
      proforma: ofKind('proforma').length,
    },
    copyTotalOre: sumTotals(ofKind('copy')),
    trainingTotalOre: sumTotals(ofKind('training')),
    proformaTotalOre: sumTotals(ofKind('proforma')),
    drawerOpenCount: input.drawerOpenCount,
    grandTotals: {
      salesOre: grandSales,
      returnsOre: grandReturns,
      netOre: addOre(grandSales, grandReturns),
    },
  };
}
