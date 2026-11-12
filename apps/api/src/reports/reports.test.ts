import { verifyJournalChain, type JournalEvent } from '@pos/domain';
import { FakeControlSystem } from '@pos/control-system';
import { afterAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../test/db';
import { auth, createArticle, createTenant, type TenantFixture } from '../../test/fixtures';
import { buildApp } from '../app';
import { createSql } from '../db/client';
import { withTenant } from '../db/tenant';

const sql = createSql(testDatabaseUrl);
const app = buildApp({ sql, controlSystem: new FakeControlSystem() });

afterAll(async () => {
  await app.close();
  await sql.end();
});

function post(fixture: TenantFixture, path: string, payload?: object) {
  return app.inject({
    method: 'POST',
    url: `/registers/${fixture.registerId}/${path}`,
    headers: auth(fixture.token),
    ...(payload && { payload }),
  });
}

async function setup() {
  const fixture = await createTenant(sql);
  const food = await createArticle(sql, fixture, { name: 'Lunch', priceOre: 12900, vatRate: 12 });
  const beer = await createArticle(sql, fixture, { name: 'Öl', priceOre: 7450, vatRate: 25 });
  const sell = (kind: string, articleId: string, method: string, amountOre: number) =>
    post(fixture, 'receipts', {
      kind,
      lines: [{ articleId, quantity: 1 }],
      payments: [{ method, amountOre }],
    }).then((r) => {
      expect(r.statusCode).toBe(201);
      return r.json() as { id: string };
    });
  return { fixture, food, beer, sell };
}

describe('Z report', () => {
  it('closes the day with totals per VAT rate and payment method', async () => {
    const { fixture, food, beer, sell } = await setup();
    await sell('sale', food, 'card', 12900);
    const beerSale = await sell('sale', beer, 'cash', 7500);
    await sell('training', food, 'card', 12900);
    await post(fixture, 'returns', {
      originalReceiptId: beerSale.id,
      lines: [{ lineNo: 1, quantity: 1 }],
      payments: [{ method: 'cash', amountOre: -7500 }],
    });

    const res = await post(fixture, 'z-reports');

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      zNumber: 1,
      register: { designation: 'KASSA-1' },
      salesTotalOre: 12900 + 7450,
      returnsTotalOre: -7450,
      netTotalOre: 12900,
      totalsByVat: [
        { vatRate: 25, grossOre: 0, vatOre: 0 },
        { vatRate: 12, grossOre: 12900, vatOre: 1382 },
      ],
      totalsByPayment: { card: 12900, cash: 0 },
      cashRoundingOre: 50 - 50,
      counts: { sale: 2, return: 1, training: 1, copy: 0, proforma: 0 },
      trainingTotalOre: 12900,
      grandTotals: { salesOre: 20350, returnsOre: -7450, netOre: 12900 },
    });
  });

  it('starts the next period after the last Z and carries grand totals forward', async () => {
    const { fixture, food, sell } = await setup();
    await sell('sale', food, 'card', 12900);
    const first = (await post(fixture, 'z-reports')).json();

    await sell('sale', food, 'card', 12900);
    await sell('sale', food, 'card', 12900);
    const second = (await post(fixture, 'z-reports')).json();

    expect(second).toMatchObject({
      zNumber: 2,
      periodFrom: first.periodTo,
      counts: { sale: 2 },
      salesTotalOre: 25800,
      grandTotals: { salesOre: 38700, netOre: 38700 },
    });
  });

  it('allows an empty Z report', async () => {
    const { fixture } = await setup();
    const res = await post(fixture, 'z-reports');
    expect(res.json()).toMatchObject({ zNumber: 1, netTotalOre: 0, totalsByVat: [] });
  });

  it("can't be taken on another company's register", async () => {
    const { fixture } = await setup();
    const other = await createTenant(sql);
    const res = await app.inject({
      method: 'POST',
      url: `/registers/${fixture.registerId}/z-reports`,
      headers: auth(other.token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('X report', () => {
  it('shows the open period without closing it', async () => {
    const { fixture, food, sell } = await setup();
    await sell('sale', food, 'card', 12900);

    const x = await post(fixture, 'x-reports');
    expect(x.statusCode).toBe(201);
    expect(x.json()).toMatchObject({ salesTotalOre: 12900, counts: { sale: 1 } });
    expect(x.json()).not.toHaveProperty('zNumber');

    const z = (await post(fixture, 'z-reports')).json();
    expect(z).toMatchObject({ zNumber: 1, salesTotalOre: 12900 });
  });

  it('logs X and Z reports in the hash-chained journal', async () => {
    const { fixture, food, sell } = await setup();
    await sell('sale', food, 'card', 12900);
    await post(fixture, 'x-reports');
    await post(fixture, 'z-reports');

    const events = await withTenant(
      sql,
      fixture.tenantId,
      (tx) => tx<JournalEvent[]>`
        SELECT seq, event_type AS "eventType", occurred_at AS "occurredAt", payload,
               prev_hash AS "prevHash", hash
        FROM journal_events WHERE register_id = ${fixture.registerId} ORDER BY seq`,
    );
    expect(events.map((e) => e.eventType)).toEqual(['receipt', 'x_report', 'z_report']);
    expect(await verifyJournalChain(events)).toEqual({ ok: true });
  });
});
