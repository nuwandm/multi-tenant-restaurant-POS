import { FakeControlSystem } from '@pos/control-system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../test/db';
import {
  auth,
  createArticle,
  createSession,
  createStaff,
  createTenant,
  type TenantFixture,
} from '../../test/fixtures';
import { buildApp } from '../app';
import { createSql } from '../db/client';
import { MAX_PIN_ATTEMPTS } from './routes';

const sql = createSql(testDatabaseUrl);
const app = buildApp({ sql, controlSystem: new FakeControlSystem() });

let shop: TenantFixture;
let cashierId: string;
let coffee: string;

beforeAll(async () => {
  shop = await createTenant(sql);
  cashierId = await createStaff(sql, shop.tenantId, { name: 'Erik', pin: '4321', role: 'cashier' });
  coffee = await createArticle(sql, shop, { name: 'Kaffe', priceOre: 3500, vatRate: 12 });
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

function login(
  fixture: TenantFixture,
  userId: string,
  pin: string,
  registerId = fixture.registerId,
) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'x-tenant-id': fixture.tenantId },
    payload: { registerId, userId, pin },
  });
}

const sale = (token: string, fixture = shop) =>
  app.inject({
    method: 'POST',
    url: `/registers/${fixture.registerId}/receipts`,
    headers: auth(token),
    payload: {
      kind: 'sale',
      lines: [{ articleId: coffee, quantity: 1 }],
      payments: [{ method: 'card', amountOre: 3500 }],
    },
  });

describe('login screen', () => {
  it('lists active staff with a PIN, without PINs', async () => {
    await createStaff(sql, shop.tenantId, {
      name: 'Gone',
      pin: '1111',
      role: 'cashier',
      active: false,
    });
    const res = await app.inject({
      method: 'GET',
      url: `/registers/${shop.registerId}/login-info`,
      headers: { 'x-tenant-id': shop.tenantId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.register).toMatchObject({ designation: 'KASSA-1' });
    expect(body.staff.map((s: { displayName: string }) => s.displayName)).toEqual([
      'Erik',
      'Manager',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/scrypt|pin/i);
  });
});

describe('POST /auth/login', () => {
  it('logs in with the right PIN and the session works', async () => {
    const res = await login(shop, cashierId, '4321');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      staff: { userId: cashierId, displayName: 'Erik', role: 'cashier' },
      registerId: shop.registerId,
    });

    const session = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: auth(res.json().token),
    });
    expect(session.json()).toMatchObject({ staff: { displayName: 'Erik' } });
  });

  it('records the cashier on the receipt', async () => {
    const { token } = (await login(shop, cashierId, '4321')).json();
    const res = await sale(token);
    expect(res.json()).toMatchObject({ cashier: { id: cashierId, displayName: 'Erik' } });
  });

  it('rejects a wrong PIN', async () => {
    const res = await login(shop, cashierId, '0000');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'invalid_pin' });
  });

  it(`locks the PIN after ${MAX_PIN_ATTEMPTS} wrong tries, even for the right PIN`, async () => {
    const userId = await createStaff(sql, shop.tenantId, {
      name: 'Lisa',
      pin: '2468',
      role: 'cashier',
    });
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
      expect((await login(shop, userId, '9999')).statusCode).toBe(401);
    }
    const res = await login(shop, userId, '2468');
    expect(res.statusCode).toBe(423);
    expect(res.json()).toMatchObject({ error: 'pin_locked' });
  });

  it('resets the count of wrong tries after a good login', async () => {
    const userId = await createStaff(sql, shop.tenantId, {
      name: 'Nils',
      pin: '1357',
      role: 'cashier',
    });
    for (let i = 0; i < MAX_PIN_ATTEMPTS - 1; i++) await login(shop, userId, '9999');
    expect((await login(shop, userId, '1357')).statusCode).toBe(200);
    expect((await login(shop, userId, '9999')).statusCode).toBe(401);
    expect((await login(shop, userId, '1357')).statusCode).toBe(200);
  });

  it('rejects an inactive staff member', async () => {
    const userId = await createStaff(sql, shop.tenantId, {
      name: 'Slutat',
      pin: '1212',
      role: 'cashier',
      active: false,
    });
    expect((await login(shop, userId, '1212')).statusCode).toBe(401);
  });

  it("can't log in to another company's register or as their staff", async () => {
    const other = await createTenant(sql);
    expect((await login(shop, cashierId, '4321', other.registerId)).statusCode).toBe(404);
    expect((await login(other, cashierId, '4321', other.registerId)).statusCode).toBe(401);
  });
});

describe('sessions and roles', () => {
  it('requires a login to sell', async () => {
    expect((await sale('not-a-real-token')).statusCode).toBe(401);
  });

  it('ends the session on logout', async () => {
    const { token } = (await login(shop, cashierId, '4321')).json();
    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: auth(token) });
    expect(out.statusCode).toBe(204);
    expect((await sale(token)).statusCode).toBe(401);
  });

  it('rejects an expired session', async () => {
    const token = await createSession(
      sql,
      shop.tenantId,
      cashierId,
      shop.registerId,
      'cashier',
      new Date(Date.now() - 1000),
    );
    expect((await sale(token)).statusCode).toBe(401);
  });

  it('lets a cashier sell and take an X report, but not a Z report or a return', async () => {
    const { token } = (await login(shop, cashierId, '4321')).json();
    const receipt = await sale(token);
    expect(receipt.statusCode).toBe(201);

    const post = (path: string, payload?: object) =>
      app.inject({
        method: 'POST',
        url: `/registers/${shop.registerId}/${path}`,
        headers: auth(token),
        ...(payload && { payload }),
      });

    expect((await post('x-reports')).statusCode).toBe(201);
    expect((await post('z-reports')).statusCode).toBe(403);
    expect(
      (
        await post('returns', {
          originalReceiptId: receipt.json().id,
          lines: [{ lineNo: 1, quantity: 1 }],
          payments: [{ method: 'card', amountOre: -3500 }],
        })
      ).statusCode,
    ).toBe(403);
  });
});
