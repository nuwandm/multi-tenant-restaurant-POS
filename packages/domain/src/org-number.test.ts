import { describe, expect, it } from 'vitest';
import { isValidOrgNumber, parseOrgNumber } from './org-number';

describe('isValidOrgNumber', () => {
  it.each(['5560360793', '2021005489'])('accepts %s', (value) => {
    expect(isValidOrgNumber(value)).toBe(true);
  });

  it.each([
    ['wrong check digit', '5560360794'],
    ['too short', '556036079'],
    ['too long', '55603607930'],
    ['with dash', '556036-0793'],
    ['letters', '55603607a3'],
  ])('rejects %s', (_, value) => {
    expect(isValidOrgNumber(value)).toBe(false);
  });
});

describe('parseOrgNumber', () => {
  it.each([
    ['556036-0793', '5560360793'],
    [' 5560360793 ', '5560360793'],
    ['16556036-0793', '5560360793'],
    // Sole traders (enskild firma) use their personnummer, often written with the century.
    ['19850101-0113', '8501010113'],
    ['200102030459', '0102030459'],
    ['556036 0793', '5560360793'],
  ])('normalises %j to %s', (input, expected) => {
    expect(parseOrgNumber(input)).toBe(expected);
  });

  it('throws on an invalid number', () => {
    expect(() => parseOrgNumber('556036-0794')).toThrow(RangeError);
  });
});
