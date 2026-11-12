import { describe, expect, it } from 'vitest';
import { ore } from './money';
import { isVatRate, vatFromGross, vatTotals } from './vat';

describe('isVatRate', () => {
  it.each([25, 12, 6, 0])('accepts %d', (rate) => {
    expect(isVatRate(rate)).toBe(true);
  });

  it.each([24, 7.5, -1])('rejects %d', (rate) => {
    expect(isVatRate(rate)).toBe(false);
  });
});

describe('vatFromGross (prices include VAT)', () => {
  it.each([
    [12500, 25, 2500], // 125 kr at 25% -> 25 kr VAT
    [11200, 12, 1200], // 112 kr at 12% -> 12 kr VAT
    [10600, 6, 600],
    [10000, 0, 0],
    [12900, 12, 1382], // 1382.14… -> 1382
    [9900, 25, 1980],
    [-12900, 12, -1382], // returns
  ])('%d öre at %d%% has %d öre VAT', (gross, rate, vat) => {
    expect(vatFromGross(ore(gross), rate as 25 | 12 | 6 | 0)).toBe(vat);
  });
});

describe('vatTotals', () => {
  it('groups gross per rate, then extracts VAT once per rate', () => {
    // Three 33 kr items at 12%: per-line VAT would round 3 times; per-rate rounds once.
    const totals = vatTotals([
      { vatRate: 12, amountOre: ore(3300) },
      { vatRate: 12, amountOre: ore(3300) },
      { vatRate: 12, amountOre: ore(3300) },
      { vatRate: 25, amountOre: ore(8900) },
    ]);
    expect(totals).toEqual([
      { vatRate: 25, grossOre: 8900, netOre: 7120, vatOre: 1780 },
      { vatRate: 12, grossOre: 9900, netOre: 8839, vatOre: 1061 },
    ]);
  });

  it('net + vat always equals gross', () => {
    for (let gross = 1; gross < 2000; gross += 37) {
      for (const [rate] of [[25], [12], [6], [0]] as const) {
        const [t] = vatTotals([{ vatRate: rate, amountOre: ore(gross) }]);
        expect(t!.netOre + t!.vatOre).toBe(gross);
      }
    }
  });

  it('keeps a 0 kr line as a 0 total', () => {
    expect(vatTotals([{ vatRate: 12, amountOre: ore(0) }])).toEqual([
      { vatRate: 12, grossOre: 0, netOre: 0, vatOre: 0 },
    ]);
  });
});
