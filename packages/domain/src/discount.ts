import { ore, type Ore } from './money';
import { divRound } from './rounding';

/** pct percent of an amount, rounded to whole öre. */
export function percentOf(amount: Ore, pct: number): Ore {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new RangeError(`A percentage is 0–100, got ${pct}`);
  }
  // Two decimals of precision on the percentage, kept in integers.
  return ore(divRound(amount * Math.round(pct * 100), 10000));
}

/**
 * Splits a discount over amounts in proportion to their size (largest-remainder method).
 * The parts always add up to the discount exactly and never exceed their amount.
 */
export function allocateDiscount(amounts: Ore[], discount: Ore): Ore[] {
  const total = amounts.reduce((sum, a) => sum + a, 0);
  if (discount < 0 || discount > total) {
    throw new RangeError(`Discount ${discount} öre must be between 0 and the total ${total} öre`);
  }
  if (discount === 0 || total === 0) return amounts.map(() => ore(0));

  const exact = amounts.map((a) => (a * discount) / total);
  const parts = exact.map(Math.floor);
  let left = discount - parts.reduce((s, p) => s + p, 0);
  const order = exact
    .map((e, i) => ({ i, rest: e - Math.floor(e) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    if (parts[i]! < amounts[i]!) {
      parts[i]! += 1;
      left -= 1;
    }
  }
  return parts.map((p) => ore(p));
}
