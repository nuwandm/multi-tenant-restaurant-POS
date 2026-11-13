import { describe, expect, it } from 'vitest';
import { ControlSystemUnavailableError, type SignReceiptInput } from './control-system';
import { FakeControlSystem } from './fake-control-system';

const receipt: SignReceiptInput = {
  idempotencyKey: 'key-1',
  controlSystemRef: 'REF-1',
  orgNumber: '5560000000',
  receiptNumber: 1,
  kind: 'sale',
  createdAt: new Date('2026-11-12T12:00:00Z'),
  totalInclVatOre: 12900,
  vatTotalsOre: { 12: 1382 },
};

describe('FakeControlSystem', () => {
  it('signs a receipt with a control code', async () => {
    const cs = new FakeControlSystem(() => new Date('2026-11-12T12:00:01Z'));
    const signed = await cs.signReceipt(receipt);
    expect(signed.controlCode).toBe('FAKE-REF-1-sale-1-'.padEnd(59, 'X'));
    expect(signed.controlCode).toHaveLength(59);
    expect(signed.signedAt.toISOString()).toBe('2026-11-12T12:00:01.000Z');
  });

  it('returns the same signature for a retried idempotency key', async () => {
    const cs = new FakeControlSystem();
    const first = await cs.signReceipt(receipt);
    const retry = await cs.signReceipt({ ...receipt, receiptNumber: 99 });
    expect(retry).toBe(first);
    expect(cs.signedCount).toBe(1);
  });

  it('refuses to sign while offline', async () => {
    const cs = new FakeControlSystem();
    cs.setOnline(false);
    await expect(cs.signReceipt(receipt)).rejects.toBeInstanceOf(ControlSystemUnavailableError);
    expect(await cs.getStatus()).toEqual({ online: false });
  });

  it('registers a register and returns a reference', async () => {
    const cs = new FakeControlSystem();
    const result = await cs.registerRegister({ orgNumber: '5560000000', designation: 'KASSA-1' });
    expect(result.controlSystemRef).toBe('FAKE-KASSA-1-1');
    expect(result.serialNumber).toBe('FAKE0000000000001');
  });
});
