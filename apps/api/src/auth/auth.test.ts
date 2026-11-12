import { FakeControlSystem } from '@pos/control-system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../test/db';
import {
  auth,
  createArticle,
  createSession,
  createStaff,
  createTenant,
  pairDevice,
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
const devices = new Map<string, string>();

/** One paired till per test company, created on first use. */
async function deviceFor(fixture: TenantFixture): Promise<string> {
  if (!devices.has(fixture.tenantId)) {
    devices.set(
      fixture.tenantId,
      await pairDevice(sql, fixture.tenantId, fixture.registerId, fixture.managerId),
    );
  }
  return devices.get(fixture.tenantId)!;
}

beforeAll(async () => {
  shop = await createTenant(sql);
  cashierId = await createStaff(sql, shop.tenantId, { name: 'Erik', pin: '4321', role: 'cashier' });
  coffee = await createArticle(sql, shop, { name: 'Kaffe', priceOre: 3500, vatRate: 12 });
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

async function login(fixture: TenantFixture, userId: string, pin: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'x-device-token': await deviceFor(fixture) },
    payload: { userId, pin },
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
      url: '/device',
      headers: { 'x-device-token': await deviceFor(shop) },
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

  it("can't log in on another company's till", async () => {
    const other = await createTenant(sql);
    expect((await login(other, cashierId, '4321')).statusCode).toBe(401);
  });
});

describe('device pairing', () => {
  const pair = (code: string, name = 'Kassa-iPad') =>
    app.inject({ method: 'POST', url: '/devices/pair', payload: { code, name } });

  async function pairingCode(fixture: TenantFixture) {
    const { newPairingCode, hashPairingCode } = await import('./device');
    const code = newPairingCode();
    await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE pos_app`;
      await tx`SELECT set_config('app.tenant_id', ${fixture.tenantId}, true)`;
      await tx`
        INSERT INTO pairing_codes (code_hash, tenant_id, register_id, created_by, expires_at)
        VALUES (${hashPairingCode(code)}, ${fixture.tenantId}, ${fixture.registerId},
                ${fixture.managerId}, ${new Date(Date.now() + 60_000)})`;
    });
    return code;
  }

  it('a code pairs one device, once, and is forgiving about case and dashes', async () => {
    const code = await pairingCode(shop);
    const typed = code.toLowerCase().replace('-', ' ');
    const res = await pair(typed);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ registerId: shop.registerId });

    const device = await app.inject({
      method: 'GET',
      url: '/device',
      headers: { 'x-device-token': res.json().deviceToken },
    });
    expect(device.json()).toMatchObject({ device: { name: 'Kassa-iPad' } });

    expect((await pair(code)).json()).toMatchObject({ error: 'invalid_pairing_code' });
  });

  it('rejects a made-up code and an unpaired device', async () => {
    expect((await pair('ABCD-EFGH')).statusCode).toBe(400);
    const res = await app.inject({
      method: 'GET',
      url: '/device',
      headers: { 'x-device-token': 'nope' },
    });
    expect(res.json()).toMatchObject({ error: 'device_not_paired' });
  });
});

describe('retried payments', () => {
  it('the same Idempotency-Key returns the first receipt and uses no new number', async () => {
    const fixture = await createTenant(sql);
    const tea = await createArticle(sql, fixture, { name: 'Te', priceOre: 2500, vatRate: 12 });
    const send = (key: string) =>
      app.inject({
        method: 'POST',
        url: `/registers/${fixture.registerId}/receipts`,
        headers: { ...auth(fixture.token), 'idempotency-key': key },
        payload: {
          kind: 'sale',
          lines: [{ articleId: tea, quantity: 1 }],
          payments: [{ method: 'card', amountOre: 2500 }],
        },
      });

    const first = await send('attempt-0001');
    const retry = await send('attempt-0001');
    const next = await send('attempt-0002');

    expect(retry.json().id).toBe(first.json().id);
    expect(retry.json().receiptNumber).toBe(1);
    expect(next.json().receiptNumber).toBe(2);
  });

  it('rejects a malformed key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/registers/${shop.registerId}/receipts`,
      headers: { ...auth(shop.token), 'idempotency-key': 'x' },
      payload: { kind: 'sale', lines: [{ articleId: coffee, quantity: 1 }], payments: [] },
    });
    expect(res.json()).toMatchObject({ error: 'invalid_idempotency_key' });
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
