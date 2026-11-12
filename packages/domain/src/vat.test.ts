import { describe, expect, it } from 'vitest';
import { isVatRate } from './vat';

describe('isVatRate', () => {
  it.each([25, 12, 6, 0])('accepts %d', (rate) => {
    expect(isVatRate(rate)).toBe(true);
  });

  it.each([24, 7.5, -1])('rejects %d', (rate) => {
    expect(isVatRate(rate)).toBe(false);
  });
});
