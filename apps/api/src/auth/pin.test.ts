import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from './pin';

describe('PIN hashing', () => {
  it('verifies the right PIN and rejects a wrong one', async () => {
    const stored = await hashPin('1234');
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(await verifyPin('1234', stored)).toBe(true);
    expect(await verifyPin('1235', stored)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPin('1234')).not.toBe(await hashPin('1234'));
  });

  it('rejects PINs that are not 4 to 8 digits', async () => {
    await expect(hashPin('123')).rejects.toThrow(RangeError);
    await expect(hashPin('12a4')).rejects.toThrow(RangeError);
  });

  it('treats a malformed stored hash as a mismatch', async () => {
    expect(await verifyPin('1234', 'plain-1234')).toBe(false);
  });
});
