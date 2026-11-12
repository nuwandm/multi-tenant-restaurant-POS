import { ore, type Ore } from './money';

/** Integer division rounded half away from zero, without floating-point drift. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError('Division by zero');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  let quotient = Math.floor(n / d);
  let remainder = n - quotient * d;
  if (remainder < 0) {
    quotient -= 1;
    remainder += d;
  }
  // `|| 0` turns -0 into 0.
  return sign * (2 * remainder >= d ? quotient + 1 : quotient) || 0;
}

/**
 * Cash rounding to whole kronor (öresavrundning): 0–49 öre down, 50–99 öre up,
 * symmetric for refunds. Card and Swish amounts are never rounded.
 */
export function roundToKrona(amount: Ore): Ore {
  return ore(divRound(amount, 100) * 100);
}
