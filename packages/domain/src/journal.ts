export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface JournalEvent {
  /** 1-based, gapless per register. */
  seq: number;
  eventType: string;
  occurredAt: Date;
  payload: JsonValue;
  prevHash: string | null;
  /** SHA-256 (hex) over the canonical JSON of every field above. */
  hash: string;
}

export interface JournalEventInput {
  eventType: string;
  occurredAt: Date;
  payload: JsonValue;
}

export type ChainCheck =
  | { ok: true }
  | { ok: false; seq: number; reason: 'sequence gap' | 'broken link' | 'hash mismatch' };

/** JSON with object keys sorted at every level, so the same data always hashes the same. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`);
    return `{${entries.join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError(`Cannot hash a non-finite number: ${value}`);
  }
  return JSON.stringify(value);
}

export async function createJournalEvent(
  previous: Pick<JournalEvent, 'seq' | 'hash'> | null,
  input: JournalEventInput,
): Promise<JournalEvent> {
  const unsigned = {
    seq: previous ? previous.seq + 1 : 1,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    payload: input.payload,
    prevHash: previous?.hash ?? null,
  };
  return { ...unsigned, hash: await hashEvent(unsigned) };
}

/** Checks numbering, links and hashes. Events must be in seq order, starting anywhere. */
export async function verifyJournalChain(events: JournalEvent[]): Promise<ChainCheck> {
  for (const [i, event] of events.entries()) {
    const prev = events[i - 1];
    if (prev && event.seq !== prev.seq + 1) {
      return { ok: false, seq: event.seq, reason: 'sequence gap' };
    }
    const expectedPrevHash = prev ? prev.hash : event.seq === 1 ? null : event.prevHash;
    if (event.prevHash !== expectedPrevHash) {
      return { ok: false, seq: event.seq, reason: 'broken link' };
    }
    if ((await hashEvent(event)) !== event.hash) {
      return { ok: false, seq: event.seq, reason: 'hash mismatch' };
    }
  }
  return { ok: true };
}

async function hashEvent(event: Omit<JournalEvent, 'hash'>): Promise<string> {
  const canonical = canonicalJson({
    seq: event.seq,
    eventType: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
    prevHash: event.prevHash,
  });
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
