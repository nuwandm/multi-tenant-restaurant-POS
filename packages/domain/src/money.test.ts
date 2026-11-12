import { describe, expect, it } from 'vitest';
import { addOre, multiplyOre, ore, parseKronor } from './money';

describe('ore', () => {
  it('accepts integers', () => {
    expect(ore(12950)).toBe(12950);
  });

  it('rejects floats', () => {
    expect(() => ore(129.5)).toThrow(RangeError);
  });
});

describe('parseKronor', () => {
  it.each([
    ['129', 12900],
    ['129.5', 12950],
    ['129,50', 12950],
    ['0,05', 5],
    ['-10', -1000],
  ])('parses %s as %d öre', (input, expected) => {
    expect(parseKronor(input)).toBe(expected);
  });

  it.each(['', 'abc', '1.234', '1,2,3'])('rejects %j', (input) => {
    expect(() => parseKronor(input)).toThrow(RangeError);
  });
});

describe('arithmetic', () => {
  it('adds amounts', () => {
    expect(addOre(ore(10), ore(20), ore(-5))).toBe(25);
  });

  it('adds nothing to zero', () => {
    expect(addOre()).toBe(0);
  });

  it('multiplies by integer quantity only', () => {
    expect(multiplyOre(ore(4500), 3)).toBe(13500);
    expect(() => multiplyOre(ore(4500), 1.5)).toThrow(RangeError);
  });
});
