import { describe, expect, it } from 'vitest';
import { allocateDiscount, percentOf } from './discount';
import { ore } from './money';
import { buildReceipt, ReceiptError } from './receipt';

describe('percentOf', () => {
  it.each([
    [10000, 10, 1000],
    [14900, 15, 2235],
    [3450, 33, 1139], // 1138.5 -> 1139
    [9900, 100, 9900],
    [9900, 0, 0],
  ])('%d öre × %d%% = %d öre', (amount, pct, expected) => {
    expect(percentOf(ore(amount), pct)).toBe(expected);
  });

  it('rejects percentages outside 0–100', () => {
    expect(() => percentOf(ore(100), 101)).toThrow(RangeError);
    expect(() => percentOf(ore(100), -1)).toThrow(RangeError);
  });
});

describe('allocateDiscount', () => {
  it('splits in proportion to each amount', () => {
    expect(allocateDiscount([ore(6000), ore(4000)], ore(1000))).toEqual([600, 400]);
  });

  it('always adds up to the discount exactly', () => {
    const parts = allocateDiscount([ore(3333), ore(3333), ore(3334)], ore(1000));
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([333, 333, 334]);
  });

  it('gives leftover öre to the largest remainders first', () => {
    expect(allocateDiscount([ore(100), ore(100), ore(100)], ore(100))).toEqual([34, 33, 33]);
  });

  it('never gives a line more discount than its amount', () => {
    const parts = allocateDiscount([ore(50), ore(9950)], ore(10000));
    expect(parts).toEqual([50, 9950]);
  });

  it('rejects a discount larger than the total', () => {
    expect(() => allocateDiscount([ore(100)], ore(101))).toThrow(RangeError);
  });
});

describe('buildReceipt with an order discount', () => {
  const lines = [
    { name: 'Pasta', quantity: 2, unitPriceOre: ore(15000), vatRate: 12 as const },
    { name: 'Vin', quantity: 1, unitPriceOre: ore(10000), vatRate: 25 as const },
  ];

  it('spreads the discount over the lines so VAT per rate stays right', () => {
    const r = buildReceipt({
      kind: 'sale',
      lines,
      orderDiscountOre: ore(4000),
      payments: [{ method: 'card', amountOre: ore(36000) }],
    });
    expect(r.totalOre).toBe(36000);
    expect(r.lines.map((l) => [l.discountOre, l.lineTotalOre])).toEqual([
      [3000, 27000],
      [1000, 9000],
    ]);
    expect(r.vatTotals).toEqual([
      { vatRate: 25, grossOre: 9000, netOre: 7200, vatOre: 1800 },
      { vatRate: 12, grossOre: 27000, netOre: 24107, vatOre: 2893 },
    ]);
    expect(r.orderDiscountOre).toBe(4000);
  });

  it('adds to existing line discounts', () => {
    const r = buildReceipt({
      kind: 'sale',
      lines: [{ ...lines[0]!, discountOre: ore(1000) }, lines[1]!],
      orderDiscountOre: ore(3000),
      payments: [{ method: 'card', amountOre: ore(36000) }],
    });
    expect(r.totalOre).toBe(36000);
    expect(r.lines[0]!.discountOre).toBe(1000 + 2231);
  });

  it('rejects an order discount above the total', () => {
    expect(() =>
      buildReceipt({ kind: 'sale', lines, orderDiscountOre: ore(40001), payments: [] }),
    ).toThrow(ReceiptError);
  });
});
