import { ore, type Ore } from './money';
import { divRound } from './rounding';

/** Swedish VAT rates in percent. Which rate applies to an article is decided by the menu, not here. */
export const VAT_RATES = [25, 12, 6, 0] as const;

export type VatRate = (typeof VAT_RATES)[number];

export function isVatRate(value: number): value is VatRate {
  return (VAT_RATES as readonly number[]).includes(value);
}

/** VAT contained in a price that includes VAT: gross × rate / (100 + rate), rounded to öre. */
export function vatFromGross(gross: Ore, rate: VatRate): Ore {
  return ore(divRound(gross * rate, 100 + rate));
}

export interface VatTotal {
  vatRate: VatRate;
  grossOre: Ore;
  netOre: Ore;
  vatOre: Ore;
}

/**
 * Sums amounts per rate and extracts VAT once per rate, so rounding happens once per rate
 * instead of once per line. Sorted by rate, highest first. net + vat = gross, always.
 */
export function vatTotals(amounts: { vatRate: VatRate; amountOre: Ore }[]): VatTotal[] {
  const grossByRate = new Map<VatRate, number>();
  for (const { vatRate, amountOre } of amounts) {
    grossByRate.set(vatRate, (grossByRate.get(vatRate) ?? 0) + amountOre);
  }
  return [...grossByRate.entries()]
    .sort(([a], [b]) => b - a)
    .map(([vatRate, gross]) => {
      const vat = vatFromGross(ore(gross), vatRate);
      return { vatRate, grossOre: ore(gross), netOre: ore(gross - vat), vatOre: vat };
    });
}
