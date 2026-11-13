import { describe, expect, it } from 'vitest';
import { ore } from './money';
import { buildCopy, buildReceipt, buildReturn } from './receipt';
import { aggregateZReport } from './z-report';

const burger = buildReceipt({
  kind: 'sale',
  lines: [{ name: 'Burgare', quantity: 1, unitPriceOre: ore(16900), vatRate: 12 }],
  payments: [{ method: 'card', amountOre: ore(16900) }],
});
const beer = buildReceipt({
  kind: 'sale',
  lines: [{ name: 'Öl', quantity: 2, unitPriceOre: ore(7450), vatRate: 25 }],
  payments: [{ method: 'cash', amountOre: ore(14900) }],
});
const beerReturn = buildReturn(beer, {
  lines: [{ lineNo: 1, quantity: 1 }],
  payments: [{ method: 'cash', amountOre: ore(-7500) }],
});
const training = buildReceipt({
  kind: 'training',
  lines: [{ name: 'Test', quantity: 1, unitPriceOre: ore(5000), vatRate: 12 }],
  payments: [{ method: 'card', amountOre: ore(5000) }],
});
const proforma = buildReceipt({
  kind: 'proforma',
  lines: [{ name: 'Nota', quantity: 1, unitPriceOre: ore(9900), vatRate: 12 }],
  payments: [],
});
const copy = buildCopy(burger);

describe('aggregateZReport', () => {
  const z = aggregateZReport({
    receipts: [burger, beer, beerReturn, training, proforma, copy],
    drawerOpenCount: 3,
    previousGrandTotals: { salesOre: ore(1_000_000), returnsOre: ore(-50_000) },
  });

  it('totals net sales (sales + returns) only', () => {
    expect(z.salesTotalOre).toBe(16900 + 14900);
    expect(z.returnsTotalOre).toBe(-7450);
    expect(z.netTotalOre).toBe(16900 + 14900 - 7450);
  });

  it('splits VAT per rate over sales and returns', () => {
    expect(z.totalsByVat).toEqual([
      { vatRate: 25, grossOre: 7450, netOre: 5960, vatOre: 1490 },
      { vatRate: 12, grossOre: 16900, netOre: 15089, vatOre: 1811 },
    ]);
  });

  it('totals payments per method, net of refunds', () => {
    expect(z.totalsByPayment).toEqual({ card: 16900, cash: 14900 - 7500 });
  });

  it('includes cash rounding', () => {
    expect(z.cashRoundingOre).toBe(0 + 0 + -50);
  });

  it('counts the special receipt kinds separately', () => {
    expect(z.counts).toEqual({ sale: 2, return: 1, copy: 1, training: 1, proforma: 1 });
    expect(z.trainingTotalOre).toBe(5000);
    expect(z.proformaTotalOre).toBe(9900);
    expect(z.copyTotalOre).toBe(16900);
    expect(z.drawerOpenCount).toBe(3);
  });

  it('carries grand totals forward', () => {
    expect(z.grandTotals).toEqual({
      salesOre: 1_000_000 + 31800,
      returnsOre: -50_000 - 7450,
      netOre: 1_000_000 + 31800 - 50_000 - 7450,
    });
  });

  it('produces an all-zero report for an empty period', () => {
    const empty = aggregateZReport({
      receipts: [],
      drawerOpenCount: 0,
      previousGrandTotals: { salesOre: ore(0), returnsOre: ore(0) },
    });
    expect(empty.netTotalOre).toBe(0);
    expect(empty.totalsByVat).toEqual([]);
    expect(empty.totalsByPayment).toEqual({});
  });
});

describe('aggregateZReport discounts', () => {
  const discounted = buildReceipt({
    kind: 'sale',
    lines: [
      { name: 'Pizza', quantity: 2, unitPriceOre: ore(10000), vatRate: 12, discountOre: ore(2000) },
    ],
    payments: [{ method: 'card', amountOre: ore(18000) }],
  });
  const returned = buildReturn(discounted, {
    lines: [{ lineNo: 1, quantity: 1 }],
    payments: [{ method: 'card', amountOre: ore(-9000) }],
  });
  const trainingWithDiscount = buildReceipt({
    kind: 'training',
    lines: [
      { name: 'Test', quantity: 1, unitPriceOre: ore(5000), vatRate: 12, discountOre: ore(500) },
    ],
    payments: [{ method: 'card', amountOre: ore(4500) }],
  });

  it('totals discounts on sales, less the discount share of returns', () => {
    const z = aggregateZReport({
      receipts: [discounted, returned, trainingWithDiscount],
      drawerOpenCount: 0,
      previousGrandTotals: { salesOre: ore(0), returnsOre: ore(0) },
    });
    // 20 kr off two pizzas; returning one gives back its 10 kr share of the discount.
    expect(z.discountTotalOre).toBe(2000 - 1000);
  });

  it('is zero without discounts', () => {
    const z = aggregateZReport({
      receipts: [burger],
      drawerOpenCount: 0,
      previousGrandTotals: { salesOre: ore(0), returnsOre: ore(0) },
    });
    expect(z.discountTotalOre).toBe(0);
  });
});

describe('aggregateZReport items sold', () => {
  it('counts items on sales, less items returned (7 kap. 3 § j SKVFS 2014:9)', () => {
    const z = aggregateZReport({
      receipts: [burger, beer, beerReturn, training, proforma, copy],
      drawerOpenCount: 0,
      previousGrandTotals: { salesOre: ore(0), returnsOre: ore(0) },
    });
    // 1 burger + 2 beers − 1 beer returned; training, quotes and copies sell nothing.
    expect(z.itemsSoldCount).toBe(2);
  });
});
