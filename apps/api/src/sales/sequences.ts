import { createJournalEvent, type JsonValue } from '@pos/domain';
import type { TransactionSql } from 'postgres';

/**
 * Next value of a gapless per-register series. The upsert row-locks the counter until the
 * transaction ends, so concurrent callers queue up and a rollback returns the number.
 */
export async function nextValue(
  tx: TransactionSql,
  tenantId: string,
  registerId: string,
  name: string,
): Promise<number> {
  const [row] = await tx<{ value: number }[]>`
    INSERT INTO register_sequences (tenant_id, register_id, name, next_value)
    VALUES (${tenantId}, ${registerId}, ${name}, 2)
    ON CONFLICT (register_id, name) DO UPDATE SET next_value = register_sequences.next_value + 1
    RETURNING next_value - 1 AS value`;
  return row!.value;
}

/** Appends the next event to the register's hash-chained journal. */
export async function appendJournalEvent(
  tx: TransactionSql,
  tenantId: string,
  registerId: string,
  eventType: string,
  occurredAt: Date,
  payload: { [key: string]: JsonValue },
) {
  const seq = await nextValue(tx, tenantId, registerId, 'journal');
  const [prev] = await tx<{ seq: number; hash: string }[]>`
    SELECT seq, hash FROM journal_events WHERE register_id = ${registerId} AND seq = ${seq - 1}`;
  const event = await createJournalEvent(prev ?? null, { eventType, occurredAt, payload });
  if (event.seq !== seq) throw new Error(`Journal out of step on register ${registerId}`);

  await tx`
    INSERT INTO journal_events (tenant_id, register_id, seq, event_type, occurred_at, payload, hash, prev_hash)
    VALUES (${tenantId}, ${registerId}, ${event.seq}, ${event.eventType}, ${event.occurredAt},
            ${tx.json(event.payload as never)}, ${event.hash}, ${event.prevHash})`;
}
