import { describe, expect, it } from 'vitest';
import { ore } from './money';
import { divRound, roundToKrona } from './rounding';

describe('divRound (half away from zero)', () => {
  it.each([
    [10, 4, 3], // 2.5 -> 3
    [9, 4, 2], // 2.25 -> 2
    [11, 4, 3], // 2.75 -> 3
    [-10, 4, -3], // -2.5 -> -3
    [-9, 4, -2],
    [0, 7, 0],
  ])('divRound(%d, %d) = %d', (n, d, expected) => {
    expect(divRound(n, d)).toBe(expected);
  });

  it('rejects a zero divisor', () => {
    expect(() => divRound(1, 0)).toThrow(RangeError);
  });
});

describe('roundToKrona (cash rounding, öresavrundning)', () => {
  it.each([
    [12949, 12900], // 129,49 -> 129
    [12950, 13000], // 129,50 -> 130
    [12999, 13000],
    [12900, 12900],
    [-12950, -13000], // refunds round symmetrically
    [-12949, -12900],
    [0, 0],
  ])('%d öre -> %d öre', (input, expected) => {
    expect(roundToKrona(ore(input))).toBe(expected);
  });
});
