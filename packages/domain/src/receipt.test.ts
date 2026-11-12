import { describe, expect, it } from 'vitest';
import { ore } from './money';
import { buildCopy, buildReceipt, buildReturn, ReceiptError, type BuiltReceipt } from './receipt';

const pasta = { name: 'Pasta', quantity: 2, unitPriceOre: ore(14900), vatRate: 12 } as const;
const wine = { name: 'Vin glas', quantity: 1, unitPriceOre: ore(11500), vatRate: 25 } as const;

function sale(): BuiltReceipt {
  return buildReceipt({
    kind: 'sale',
    lines: [pasta, wine],
    payments: [{ method: 'card', amountOre: ore(41300) }],
  });
}

describe('buildReceipt: sale', () => {
  it('totals lines and splits VAT per rate', () => {
    const r = sale();
    expect(r.totalOre).toBe(41300);
    expect(r.lines.map((l) => [l.lineNo, l.lineTotalOre])).toEqual([
      [1, 29800],
      [2, 11500],
    ]);
    expect(r.vatTotals).toEqual([
      { vatRate: 25, grossOre: 11500, netOre: 9200, vatOre: 2300 },
      { vatRate: 12, grossOre: 29800, netOre: 26607, vatOre: 3193 },
    ]);
    expect(r.cashRoundingOre).toBe(0);
  });

  it('applies a line discount before VAT', () => {
    const r = buildReceipt({
      kind: 'sale',
      lines: [{ ...pasta, discountOre: ore(2800) }],
      payments: [{ method: 'swish', amountOre: ore(27000) }],
    });
    expect(r.totalOre).toBe(27000);
    expect(r.vatTotals[0]).toMatchObject({ vatRate: 12, grossOre: 27000, vatOre: 2893 });
  });

  it('rejects a discount larger than the line', () => {
    expect(() =>
      buildReceipt({ kind: 'sale', lines: [{ ...wine, discountOre: ore(11600) }], payments: [] }),
    ).toThrow(ReceiptError);
  });

  it('rounds the cash part to whole kronor and records the rounding', () => {
    const r = buildReceipt({
      kind: 'sale',
      lines: [{ name: 'Kaffe', quantity: 1, unitPriceOre: ore(3450), vatRate: 12 }],
      payments: [{ method: 'cash', amountOre: ore(3500) }],
    });
    expect(r.totalOre).toBe(3450);
    expect(r.cashRoundingOre).toBe(50);
  });

  it('rounds only the cash remainder in a mixed payment', () => {
    const r = buildReceipt({
      kind: 'sale',
      lines: [{ name: 'Lunch', quantity: 1, unitPriceOre: ore(12940), vatRate: 12 }],
      payments: [
        { method: 'card', amountOre: ore(10000) },
        { method: 'cash', amountOre: ore(2900) }, // 29,40 kr due in cash -> 29 kr
      ],
    });
    expect(r.cashRoundingOre).toBe(-40);
  });

  it('rejects payments that do not match the total', () => {
    expect(() =>
      buildReceipt({
        kind: 'sale',
        lines: [wine],
        payments: [{ method: 'card', amountOre: ore(11000) }],
      }),
    ).toThrow(/payments/i);
  });

  it('allows a 0 kr receipt with no payments', () => {
    const r = buildReceipt({
      kind: 'sale',
      lines: [{ name: 'Bjudvatten', quantity: 1, unitPriceOre: ore(0), vatRate: 12 }],
      payments: [],
    });
    expect(r.totalOre).toBe(0);
    expect(r.vatTotals).toEqual([{ vatRate: 12, grossOre: 0, netOre: 0, vatOre: 0 }]);
  });

  it('rejects an empty receipt, zero or fractional quantities', () => {
    expect(() => buildReceipt({ kind: 'sale', lines: [], payments: [] })).toThrow(ReceiptError);
    expect(() =>
      buildReceipt({ kind: 'sale', lines: [{ ...wine, quantity: 0 }], payments: [] }),
    ).toThrow(ReceiptError);
    expect(() =>
      buildReceipt({ kind: 'sale', lines: [{ ...wine, quantity: 1.5 }], payments: [] }),
    ).toThrow(ReceiptError);
  });
});

describe('buildReceipt: training and proforma', () => {
  it('builds a training receipt like a sale', () => {
    const r = buildReceipt({
      kind: 'training',
      lines: [wine],
      payments: [{ method: 'card', amountOre: ore(11500) }],
    });
    expect(r.kind).toBe('training');
    expect(r.totalOre).toBe(11500);
  });

  it('builds a proforma receipt without payments', () => {
    const r = buildReceipt({ kind: 'proforma', lines: [pasta], payments: [] });
    expect(r.totalOre).toBe(29800);
    expect(r.payments).toEqual([]);
  });

  it('refuses payments on a proforma receipt', () => {
    expect(() =>
      buildReceipt({
        kind: 'proforma',
        lines: [wine],
        payments: [{ method: 'card', amountOre: ore(11500) }],
      }),
    ).toThrow(ReceiptError);
  });
});

describe('buildReturn', () => {
  it('returns a whole receipt as negative amounts', () => {
    const original = sale();
    const r = buildReturn(original, {
      lines: [
        { lineNo: 1, quantity: 2 },
        { lineNo: 2, quantity: 1 },
      ],
      payments: [{ method: 'card', amountOre: ore(-41300) }],
    });
    expect(r.kind).toBe('return');
    expect(r.totalOre).toBe(-41300);
    expect(r.vatTotals).toEqual([
      { vatRate: 25, grossOre: -11500, netOre: -9200, vatOre: -2300 },
      { vatRate: 12, grossOre: -29800, netOre: -26607, vatOre: -3193 },
    ]);
  });

  it('returns part of a line', () => {
    const r = buildReturn(sale(), {
      lines: [{ lineNo: 1, quantity: 1 }],
      payments: [{ method: 'card', amountOre: ore(-14900) }],
    });
    expect(r.lines).toEqual([
      expect.objectContaining({ lineNo: 1, name: 'Pasta', quantity: -1, lineTotalOre: -14900 }),
    ]);
  });

  it('refunds a discounted line in proportion', () => {
    const original = buildReceipt({
      kind: 'sale',
      lines: [
        { name: 'Öl', quantity: 3, unitPriceOre: ore(7900), vatRate: 25, discountOre: ore(1000) },
      ],
      payments: [{ method: 'card', amountOre: ore(22700) }],
    });
    const r = buildReturn(original, {
      lines: [{ lineNo: 1, quantity: 1 }],
      payments: [{ method: 'card', amountOre: ore(-7567) }],
    });
    expect(r.totalOre).toBe(-7567); // 22700 / 3, rounded
  });

  it('never refunds more than was paid when a discounted line is returned one by one', () => {
    const original = buildReceipt({
      kind: 'sale',
      lines: [
        { name: 'Öl', quantity: 3, unitPriceOre: ore(7900), vatRate: 25, discountOre: ore(1000) },
      ],
      payments: [{ method: 'card', amountOre: ore(22700) }],
    });
    const refunds = [0, 1, 2].map(
      (before) =>
        buildReturn(original, {
          lines: [{ lineNo: 1, quantity: 1 }],
          alreadyReturned: { 1: before },
          payments: [{ method: 'card', amountOre: ore([-7567, -7566, -7567][before]!) }],
        }).totalOre,
    );
    expect(refunds.reduce((a, b) => a + b, 0)).toBe(-22700);
  });

  it('refuses to return more than was sold, including earlier returns', () => {
    const original = sale();
    expect(() =>
      buildReturn(original, { lines: [{ lineNo: 2, quantity: 2 }], payments: [] }),
    ).toThrow(/more than/i);
    expect(() =>
      buildReturn(original, {
        lines: [{ lineNo: 1, quantity: 2 }],
        alreadyReturned: { 1: 1 },
        payments: [],
      }),
    ).toThrow(/more than/i);
  });

  it('refuses unknown lines and returns of non-sales', () => {
    expect(() =>
      buildReturn(sale(), { lines: [{ lineNo: 9, quantity: 1 }], payments: [] }),
    ).toThrow(ReceiptError);
    const proforma = buildReceipt({ kind: 'proforma', lines: [wine], payments: [] });
    expect(() =>
      buildReturn(proforma, { lines: [{ lineNo: 1, quantity: 1 }], payments: [] }),
    ).toThrow(ReceiptError);
  });
});

describe('buildCopy', () => {
  it('copies content and totals as kind copy', () => {
    const original = sale();
    const copy = buildCopy(original);
    expect(copy.kind).toBe('copy');
    expect(copy.lines).toEqual(original.lines);
    expect(copy.totalOre).toBe(original.totalOre);
    expect(copy.vatTotals).toEqual(original.vatTotals);
  });
});
