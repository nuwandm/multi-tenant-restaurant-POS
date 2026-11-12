import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  createJournalEvent,
  verifyJournalChain,
  type JournalEvent,
} from './journal';

const at = (s: number) => new Date(Date.UTC(2026, 10, 12, 12, 0, s));

async function chainOf(n: number): Promise<JournalEvent[]> {
  const events: JournalEvent[] = [];
  for (let i = 0; i < n; i++) {
    events.push(
      await createJournalEvent(events.at(-1) ?? null, {
        eventType: 'receipt',
        occurredAt: at(i),
        payload: { receiptNumber: i + 1, totalOre: 1000 * (i + 1) },
      }),
    );
  }
  return events;
}

describe('canonicalJson', () => {
  it('sorts keys at every level so equal data hashes equally', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });
});

describe('journal hash chain', () => {
  it('numbers events from 1 and links each to the previous hash', async () => {
    const [first, second] = await chainOf(2);
    expect(first).toMatchObject({ seq: 1, prevHash: null });
    expect(first!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatchObject({ seq: 2, prevHash: first!.hash });
  });

  it('is deterministic', async () => {
    const [a] = await chainOf(1);
    const [b] = await chainOf(1);
    expect(a!.hash).toBe(b!.hash);
  });

  it('verifies an intact chain', async () => {
    expect(await verifyJournalChain(await chainOf(5))).toEqual({ ok: true });
  });

  it('detects a changed payload', async () => {
    const events = await chainOf(3);
    events[1] = { ...events[1]!, payload: { receiptNumber: 2, totalOre: 1 } };
    expect(await verifyJournalChain(events)).toEqual({
      ok: false,
      seq: 2,
      reason: 'hash mismatch',
    });
  });

  it('detects a removed event', async () => {
    const events = await chainOf(3);
    events.splice(1, 1);
    expect(await verifyJournalChain(events)).toEqual({ ok: false, seq: 3, reason: 'sequence gap' });
  });

  it('detects a broken link', async () => {
    const events = await chainOf(3);
    events[2] = { ...events[2]!, prevHash: '0'.repeat(64) };
    expect(await verifyJournalChain(events)).toMatchObject({ ok: false, seq: 3 });
  });
});
