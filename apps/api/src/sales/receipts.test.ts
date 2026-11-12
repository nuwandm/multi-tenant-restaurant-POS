import { verifyJournalChain, type JournalEvent } from '@pos/domain';
import { FakeControlSystem } from '@pos/control-system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../test/db';
import {
  auth,
  createArticle,
  createSession,
  createTenant,
  insertRegister,
  type TenantFixture,
} from '../../test/fixtures';
import { buildApp } from '../app';
import { createSql } from '../db/client';
import { withTenant } from '../db/tenant';

const sql = createSql(testDatabaseUrl, { max: 20 });
const controlSystem = new FakeControlSystem();
const app = buildApp({ sql, controlSystem });

let shop: TenantFixture;
let pasta: string;
let wine: string;

beforeAll(async () => {
  shop = await createTenant(sql);
  pasta = await createArticle(sql, shop, { name: 'Pasta', priceOre: 14900, vatRate: 12 });
  wine = await createArticle(sql, shop, { name: 'Vin glas', priceOre: 11500, vatRate: 25 });
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

function postSale(
  fixture: TenantFixture,
  body: object,
  options: { registerId?: string; token?: string; target?: typeof app } = {},
) {
  return (options.target ?? app).inject({
    method: 'POST',
    url: `/registers/${options.registerId ?? fixture.registerId}/receipts`,
    headers: auth(options.token ?? fixture.token),
    payload: body,
  });
}

const cardSale = (articleId: string, amountOre: number) => ({
  kind: 'sale',
  lines: [{ articleId, quantity: 1 }],
  payments: [{ method: 'card', amountOre }],
});

async function receiptNumbers(fixture: TenantFixture, registerId: string, kind = 'sale') {
  const rows = await withTenant(
    sql,
    fixture.tenantId,
    (tx) => tx<{ n: number }[]>`
      SELECT receipt_number AS n FROM receipts
      WHERE register_id = ${registerId} AND kind = ${kind} ORDER BY receipt_number`,
  );
  return rows.map((r) => r.n);
}

describe('POST /registers/:id/receipts', () => {
  it('stores a signed sale and returns the printable receipt', async () => {
    const res = await postSale(shop, {
      kind: 'sale',
      lines: [
        { articleId: pasta, quantity: 2 },
        { articleId: wine, quantity: 1 },
      ],
      payments: [{ method: 'card', amountOre: 41300 }],
    });

    expect(res.statusCode).toBe(201);
    const receipt = res.json();
    expect(receipt).toMatchObject({
      kind: 'sale',
      receiptNumber: 1,
      register: { designation: 'KASSA-1' },
      seller: { orgNumber: expect.stringMatching(/^\d{10}$/) },
      totalOre: 41300,
      cashRoundingOre: 0,
      controlCode: 'FAKE-FAKE-REF-KASSA-1-sale-1',
      vatTotals: [
        { vatRate: 25, grossOre: 11500, netOre: 9200, vatOre: 2300 },
        { vatRate: 12, grossOre: 29800, netOre: 26607, vatOre: 3193 },
      ],
    });
    expect(receipt.lines).toHaveLength(2);

    const [stored] = await withTenant(
      sql,
      shop.tenantId,
      (tx) => tx`
        SELECT r.total_incl_vat_ore, r.control_code,
               (SELECT count(*)::int FROM receipt_lines WHERE receipt_id = r.id) AS lines,
               (SELECT count(*)::int FROM receipt_vat_totals WHERE receipt_id = r.id) AS vat_rows,
               (SELECT sum(amount_ore) FROM payments WHERE receipt_id = r.id)::int8 AS paid
        FROM receipts r WHERE r.id = ${receipt.id}`,
    );
    expect(stored).toEqual({
      total_incl_vat_ore: 41300,
      control_code: receipt.controlCode,
      lines: 2,
      vat_rows: 2,
      paid: 41300,
    });
  });

  it('takes prices from the menu, not from the client', async () => {
    const res = await postSale(shop, {
      kind: 'sale',
      lines: [{ articleId: wine, quantity: 1, unitPriceOre: 1 }],
      payments: [{ method: 'card', amountOre: 1 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('stores cash rounding', async () => {
    const coffee = await createArticle(sql, shop, { name: 'Kaffe', priceOre: 3450, vatRate: 12 });
    const res = await postSale(shop, {
      kind: 'sale',
      lines: [{ articleId: coffee, quantity: 1 }],
      payments: [{ method: 'cash', amountOre: 3500 }],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ totalOre: 3450, cashRoundingOre: 50 });
  });

  it('gives 50 parallel sales on one register unique, gapless numbers', async () => {
    const fixture = await createTenant(sql);
    const article = await createArticle(sql, fixture, {
      name: 'Kaffe',
      priceOre: 3500,
      vatRate: 12,
    });

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => postSale(fixture, cardSale(article, 3500))),
    );

    expect(responses.map((r) => r.statusCode)).toEqual(Array(50).fill(201));
    const numbers = responses.map((r) => r.json().receiptNumber as number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(await receiptNumbers(fixture, fixture.registerId)).toEqual(numbers);
  });

  it('keeps an independent series per register', async () => {
    const fixture = await createTenant(sql);
    const article = await createArticle(sql, fixture, {
      name: 'Bulle',
      priceOre: 3000,
      vatRate: 12,
    });
    const second = await withTenant(sql, fixture.tenantId, (tx) =>
      insertRegister(tx, fixture.tenantId, fixture.restaurantId, 'KASSA-2'),
    );

    await postSale(fixture, cardSale(article, 3000));
    await postSale(fixture, cardSale(article, 3000));
    const secondToken = await createSession(
      sql,
      fixture.tenantId,
      fixture.managerId,
      second,
      'manager',
    );
    const res = await postSale(fixture, cardSale(article, 3000), {
      registerId: second,
      token: secondToken,
    });

    expect(res.json()).toMatchObject({ receiptNumber: 1, register: { designation: 'KASSA-2' } });
    expect(await receiptNumbers(fixture, fixture.registerId)).toEqual([1, 2]);
    expect(await receiptNumbers(fixture, second)).toEqual([1]);
  });

  it('numbers training receipts in their own series', async () => {
    const fixture = await createTenant(sql);
    const article = await createArticle(sql, fixture, { name: 'Te', priceOre: 2500, vatRate: 12 });
    await postSale(fixture, cardSale(article, 2500));
    const res = await postSale(fixture, { ...cardSale(article, 2500), kind: 'training' });
    expect(res.json()).toMatchObject({ kind: 'training', receiptNumber: 1 });
  });

  it('stores nothing and uses no number when signing fails', async () => {
    const offlineCs = new FakeControlSystem();
    const target = buildApp({ sql, controlSystem: offlineCs });
    const fixture = await createTenant(sql);
    const article = await createArticle(sql, fixture, {
      name: 'Soppa',
      priceOre: 9500,
      vatRate: 12,
    });

    await postSale(fixture, cardSale(article, 9500), { target });
    offlineCs.setOnline(false);
    const failed = await postSale(fixture, cardSale(article, 9500), { target });
    offlineCs.setOnline(true);
    const next = await postSale(fixture, cardSale(article, 9500), { target });
    await target.close();

    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toMatchObject({ error: 'control_system_unavailable' });
    expect(next.json()).toMatchObject({ receiptNumber: 2 });
    expect(await receiptNumbers(fixture, fixture.registerId)).toEqual([1, 2]);
  });

  it('writes a verifiable journal event per receipt', async () => {
    const fixture = await createTenant(sql);
    const article = await createArticle(sql, fixture, {
      name: 'Glass',
      priceOre: 4500,
      vatRate: 12,
    });
    for (let i = 0; i < 3; i++) await postSale(fixture, cardSale(article, 4500));

    const rows = await withTenant(
      sql,
      fixture.tenantId,
      (tx) => tx<JournalEvent[]>`
        SELECT seq, event_type AS "eventType", occurred_at AS "occurredAt", payload,
               prev_hash AS "prevHash", hash
        FROM journal_events WHERE register_id = ${fixture.registerId} ORDER BY seq`,
    );
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(await verifyJournalChain(rows)).toEqual({ ok: true });
  });

  describe('rejects', () => {
    it("a login from another company's register", async () => {
      const other = await createTenant(sql);
      const res = await postSale(shop, cardSale(wine, 11500), { token: other.token });
      expect(res.statusCode).toBe(403);
    });

    it('a request without a login', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/registers/${shop.registerId}/receipts`,
        payload: cardSale(wine, 11500),
      });
      expect(res.statusCode).toBe(401);
    });

    it('payments that do not match the total', async () => {
      const res = await postSale(shop, cardSale(wine, 10000));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_receipt' });
    });

    it('an inactive article', async () => {
      const old = await createArticle(sql, shop, {
        name: 'Gammal rätt',
        priceOre: 9900,
        vatRate: 12,
        active: false,
      });
      const res = await postSale(shop, cardSale(old, 9900));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'article_unavailable' });
    });

    it("another restaurant's article", async () => {
      const other = await createTenant(sql);
      const theirs = await createArticle(sql, other, {
        name: 'Deras',
        priceOre: 9900,
        vatRate: 12,
      });
      const res = await postSale(shop, cardSale(theirs, 9900));
      expect(res.json()).toMatchObject({ error: 'article_unavailable' });
    });

    it('a retired register', async () => {
      const fixture = await createTenant(sql);
      const article = await createArticle(sql, fixture, {
        name: 'Mat',
        priceOre: 9900,
        vatRate: 12,
      });
      await withTenant(
        sql,
        fixture.tenantId,
        (tx) => tx`UPDATE cash_registers SET status = 'retired', retired_at = now()
                   WHERE id = ${fixture.registerId}`,
      );
      const res = await postSale(fixture, cardSale(article, 9900));
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'register_retired' });
    });

    it('a register not enrolled with the control system', async () => {
      const fixture = await createTenant(sql);
      const article = await createArticle(sql, fixture, {
        name: 'Mat',
        priceOre: 9900,
        vatRate: 12,
      });
      const unenrolled = await withTenant(sql, fixture.tenantId, (tx) =>
        insertRegister(tx, fixture.tenantId, fixture.restaurantId, 'KASSA-X', null),
      );
      const token = await createSession(
        sql,
        fixture.tenantId,
        fixture.managerId,
        unenrolled,
        'manager',
      );
      const res = await postSale(fixture, cardSale(article, 9900), {
        registerId: unenrolled,
        token,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'register_not_enrolled' });
    });
  });
});
