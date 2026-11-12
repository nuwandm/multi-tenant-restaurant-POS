import { FakeControlSystem } from '@pos/control-system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../test/db';
import { createArticle, createTenant, type TenantFixture } from '../../test/fixtures';
import { buildApp } from '../app';
import { createSql } from '../db/client';
import { withTenant } from '../db/tenant';

const sql = createSql(testDatabaseUrl);
const app = buildApp({ sql, controlSystem: new FakeControlSystem() });

let shop: TenantFixture;
let beer: string;
let pasta: string;

beforeAll(async () => {
  shop = await createTenant(sql);
  beer = await createArticle(sql, shop, { name: 'Öl', priceOre: 7900, vatRate: 25 });
  pasta = await createArticle(sql, shop, { name: 'Pasta', priceOre: 14900, vatRate: 12 });
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

function post(fixture: TenantFixture, path: string, payload: object) {
  return app.inject({
    method: 'POST',
    url: `/registers/${fixture.registerId}/${path}`,
    headers: { 'x-tenant-id': fixture.tenantId },
    payload,
  });
}

async function sale() {
  const res = await post(shop, 'receipts', {
    kind: 'sale',
    lines: [
      { articleId: beer, quantity: 3 },
      { articleId: pasta, quantity: 1 },
    ],
    payments: [{ method: 'card', amountOre: 3 * 7900 + 14900 }],
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

describe('POST /registers/:id/returns', () => {
  it('returns part of a sale as a signed, negative receipt in its own series', async () => {
    const original = await sale();
    const res = await post(shop, 'returns', {
      originalReceiptId: original.id,
      lines: [{ lineNo: 1, quantity: 2 }],
      payments: [{ method: 'card', amountOre: -15800 }],
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      kind: 'return',
      receiptNumber: 1,
      originalReceiptId: original.id,
      totalOre: -15800,
      lines: [{ name: 'Öl', quantity: -2, lineTotalOre: -15800, originalLineNo: 1 }],
      vatTotals: [{ vatRate: 25, vatOre: -3160 }],
    });
  });

  it('refuses to return more than is left after earlier returns', async () => {
    const original = await sale();
    const first = await post(shop, 'returns', {
      originalReceiptId: original.id,
      lines: [{ lineNo: 1, quantity: 2 }],
      payments: [{ method: 'card', amountOre: -15800 }],
    });
    expect(first.statusCode).toBe(201);

    const second = await post(shop, 'returns', {
      originalReceiptId: original.id,
      lines: [{ lineNo: 1, quantity: 2 }],
      payments: [{ method: 'card', amountOre: -15800 }],
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().message).toMatch(/more than was sold/);
  });

  it('shows returned quantities in the receipt list', async () => {
    const original = await sale();
    await post(shop, 'returns', {
      originalReceiptId: original.id,
      lines: [{ lineNo: 2, quantity: 1 }],
      payments: [{ method: 'card', amountOre: -14900 }],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/registers/${shop.registerId}/receipts?limit=5`,
      headers: { 'x-tenant-id': shop.tenantId },
    });
    const listed = (res.json() as { id: string; returnedQuantities: object }[]).find(
      (r) => r.id === original.id,
    );
    expect(listed?.returnedQuantities).toEqual({ 2: 1 });
  });

  it("can't return another company's receipt", async () => {
    const original = await sale();
    const other = await createTenant(sql);
    const res = await post(other, 'returns', {
      originalReceiptId: original.id,
      lines: [{ lineNo: 1, quantity: 1 }],
      payments: [{ method: 'card', amountOre: -7900 }],
    });
    expect(res.statusCode).toBe(404);
  });

  it("can't return a training receipt", async () => {
    const training = await post(shop, 'receipts', {
      kind: 'training',
      lines: [{ articleId: beer, quantity: 1 }],
      payments: [{ method: 'card', amountOre: 7900 }],
    });
    const res = await post(shop, 'returns', {
      originalReceiptId: training.json().id,
      lines: [{ lineNo: 1, quantity: 1 }],
      payments: [{ method: 'card', amountOre: -7900 }],
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /registers/:id/copies', () => {
  it('prints a signed copy with the original content, without counting its payments', async () => {
    const fixture = await createTenant(sql);
    const coffee = await createArticle(sql, fixture, {
      name: 'Kaffe',
      priceOre: 3500,
      vatRate: 12,
    });
    const original = await post(fixture, 'receipts', {
      kind: 'sale',
      lines: [{ articleId: coffee, quantity: 2 }],
      payments: [{ method: 'swish', amountOre: 7000 }],
    });

    const res = await post(fixture, 'copies', { originalReceiptId: original.json().id });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      kind: 'copy',
      receiptNumber: 1,
      totalOre: 7000,
      payments: [{ method: 'swish', amountOre: 7000 }],
      lines: [{ name: 'Kaffe', quantity: 2 }],
    });
    const [paid] = await withTenant(
      sql,
      fixture.tenantId,
      (tx) => tx<{ n: number }[]>`SELECT count(*)::int AS n FROM payments`,
    );
    expect(paid!.n).toBe(1);
  });

  it('refuses a copy of a copy', async () => {
    const original = await sale();
    const copy = await post(shop, 'copies', { originalReceiptId: original.id });
    const res = await post(shop, 'copies', { originalReceiptId: copy.json().id });
    expect(res.statusCode).toBe(400);
  });
});
