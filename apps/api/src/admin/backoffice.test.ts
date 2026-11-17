import { randomUUID } from 'node:crypto';
import { FakeControlSystem } from '@pos/control-system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../test/db';
import { auth, createPlatformAdmin, randomOrgNumber } from '../../test/fixtures';
import { buildApp } from '../app';
import { createSql } from '../db/client';
import { MemoryMailer } from '../mail/mailer';

const sql = createSql(testDatabaseUrl);
const mailer = new MemoryMailer();
const app = buildApp({ sql, controlSystem: new FakeControlSystem(), mailer });

const PASSWORD = 'correct horse battery';
let adminToken: string;

beforeAll(async () => {
  const email = `admin-${randomUUID()}@platform.test`;
  await createPlatformAdmin(sql, email, PASSWORD);
  adminToken = (await login(email, PASSWORD)).json().token;
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

async function login(email: string, password: string) {
  return app.inject({ method: 'POST', url: '/admin/login', payload: { email, password } });
}

function call(method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: object) {
  return app.inject({ method, url, headers: auth(token), ...(payload && { payload }) });
}

/** Signs up a new owner and company. Returns the owner's back office token and the tenant. */
async function signup(overrides: Record<string, string> = {}) {
  const email = `owner-${randomUUID()}@example.test`;
  const orgNumber = randomOrgNumber();
  const res = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: {
      ownerName: 'Olle Ägare',
      email,
      password: PASSWORD,
      legalName: `Olles Krog ${orgNumber} AB`,
      orgNumber,
      restaurantName: 'Olles Krog City',
      restaurantAddress: 'Kungsgatan 5, Stockholm',
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return { ...(res.json() as { token: string; tenantId: string }), email, orgNumber };
}

/** Owner sets up a register, a dish and a cashier; returns what the till needs. */
async function setUpRestaurant(token: string, tenantId: string) {
  const base = `/admin/tenants/${tenantId}`;
  const { restaurants } = (await call('GET', `${base}/restaurants`, token)).json();
  const restaurantId = restaurants[0].id as string;

  const register = await call('POST', `${base}/restaurants/${restaurantId}/registers`, token, {
    designation: 'kassa-1',
  });
  expect(register.statusCode).toBe(201);
  const article = await call('POST', `${base}/restaurants/${restaurantId}/articles`, token, {
    name: 'Dagens lunch',
    priceOre: 12500,
    vatRate: 12,
  });
  const cashier = await call('POST', `${base}/staff`, token, {
    displayName: 'Kim',
    role: 'cashier',
    pin: '2580',
  });
  expect(cashier.statusCode).toBe(201);
  // Pair a till the way an owner does: a code from the back office, typed in on the tablet.
  const registerId = register.json().id as string;
  const code = (await call('POST', `${base}/registers/${registerId}/pairing-code`, token)).json()
    .code as string;
  const paired = await app.inject({
    method: 'POST',
    url: '/devices/pair',
    payload: { code, name: 'Test-iPad' },
  });
  expect(paired.statusCode).toBe(201);
  deviceByRegister.set(registerId, paired.json().deviceToken);

  return {
    restaurantId,
    registerId,
    articleId: article.json().id as string,
    cashierId: cashier.json().userId as string,
  };
}

/** The till paired with each register in setUpRestaurant. */
const deviceByRegister = new Map<string, string>();

async function tillLogin(_tenantId: string, registerId: string, userId: string, pin: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'x-device-token': deviceByRegister.get(registerId)! },
    payload: { userId, pin },
  });
}

async function sell(token: string, registerId: string, articleId: string, amountOre: number) {
  return call('POST', `/registers/${registerId}/receipts`, token, {
    kind: 'sale',
    lines: [{ articleId, quantity: 1 }],
    payments: [{ method: 'card', amountOre }],
  });
}

describe('owner sign-up and approval', () => {
  it('a new company is pending: it can be set up and train, but cannot sell until approved', async () => {
    const owner = await signup();
    const setup = await setUpRestaurant(owner.token, owner.tenantId);
    const till = (
      await tillLogin(owner.tenantId, setup.registerId, setup.cashierId, '2580')
    ).json();

    const training = await call('POST', `/registers/${setup.registerId}/receipts`, till.token, {
      kind: 'training',
      lines: [{ articleId: setup.articleId, quantity: 1 }],
      payments: [{ method: 'card', amountOre: 12500 }],
    });
    expect(training.statusCode).toBe(201);

    const blocked = await sell(till.token, setup.registerId, setup.articleId, 12500);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: 'company_pending' });

    const approve = await call('POST', `/platform/companies/${owner.tenantId}/approve`, adminToken);
    expect(approve.json()).toMatchObject({ status: 'active' });

    const sold = await sell(till.token, setup.registerId, setup.articleId, 12500);
    expect(sold.statusCode).toBe(201);
    expect(sold.json()).toMatchObject({
      register: { designation: 'KASSA-1' },
      cashier: { displayName: 'Kim' },
    });

    await call('POST', `/platform/companies/${owner.tenantId}/suspend`, adminToken);
    const suspended = await sell(till.token, setup.registerId, setup.articleId, 12500);
    expect(suspended.json()).toMatchObject({ error: 'company_suspended' });
  });

  it('rejects an invalid or already registered org number and a taken email', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/signup',
      payload: {
        ownerName: 'X',
        email: `x-${randomUUID()}@example.test`,
        password: PASSWORD,
        legalName: 'X AB',
        orgNumber: '556036-0794',
        restaurantName: 'X',
      },
    });
    expect(bad.json()).toMatchObject({ error: 'invalid_org_number' });

    const first = await signup();
    const sameOrg = await app.inject({
      method: 'POST',
      url: '/signup',
      payload: {
        ownerName: 'Y',
        email: `y-${randomUUID()}@example.test`,
        password: PASSWORD,
        legalName: 'Y AB',
        orgNumber: first.orgNumber,
        restaurantName: 'Y',
      },
    });
    expect(sameOrg.json()).toMatchObject({ error: 'org_number_taken' });

    const sameEmail = await app.inject({
      method: 'POST',
      url: '/signup',
      payload: {
        ownerName: 'Z',
        email: first.email,
        password: PASSWORD,
        legalName: 'Z AB',
        orgNumber: randomOrgNumber(),
        restaurantName: 'Z',
      },
    });
    expect(sameEmail.json()).toMatchObject({ error: 'email_taken' });
  });

  it('an owner logs in with email and password and sees their companies', async () => {
    const owner = await signup();
    const res = await login(owner.email, PASSWORD);
    expect(res.statusCode).toBe(200);
    const me = (await call('GET', '/admin/me', res.json().token)).json();
    expect(me).toMatchObject({
      isPlatformAdmin: false,
      companies: [{ tenantId: owner.tenantId, role: 'owner' }],
    });
    expect((await login(owner.email, 'wrong password')).statusCode).toBe(401);
  });
});

describe('owner with several companies and branches', () => {
  it('adds a second company and a branch; the overview keeps companies apart', async () => {
    const owner = await signup();
    const second = await call('POST', '/admin/companies', owner.token, {
      legalName: 'Olles Andra AB',
      orgNumber: randomOrgNumber(),
      restaurantName: 'Olles Bar',
      restaurantAddress: 'Götgatan 10, Stockholm',
    });
    expect(second.statusCode).toBe(201);
    const secondId = second.json().tenantId as string;

    const branch = await call('POST', `/admin/tenants/${owner.tenantId}/restaurants`, owner.token, {
      name: 'Olles Krog Söder',
      address: 'Götgatan 12, Stockholm',
    });
    expect(branch.statusCode).toBe(201);

    for (const tenantId of [owner.tenantId, secondId]) {
      await call('POST', `/platform/companies/${tenantId}/approve`, adminToken);
    }
    const a = await setUpRestaurant(owner.token, owner.tenantId);
    const b = await setUpRestaurant(owner.token, secondId);
    const tillA = (await tillLogin(owner.tenantId, a.registerId, a.cashierId, '2580')).json().token;
    const tillB = (await tillLogin(secondId, b.registerId, b.cashierId, '2580')).json().token;
    await sell(tillA, a.registerId, a.articleId, 12500);
    await sell(tillA, a.registerId, a.articleId, 12500);
    await sell(tillB, b.registerId, b.articleId, 12500);

    const overview = (await call('GET', '/admin/overview', owner.token)).json();
    const byId = Object.fromEntries(
      overview.companies.map((c: { tenantId: string }) => [c.tenantId, c]),
    );
    expect(byId[owner.tenantId]).toMatchObject({ netOre: 25000 });
    expect(byId[owner.tenantId].restaurants).toHaveLength(2);
    expect(byId[secondId]).toMatchObject({ netOre: 12500 });
    expect(overview.netOre).toBe(37500);
  });

  it("cannot open another owner's company", async () => {
    const mine = await signup();
    const theirs = await signup();
    const res = await call('GET', `/admin/tenants/${theirs.tenantId}/restaurants`, mine.token);
    expect(res.statusCode).toBe(404);
  });
});

describe('menu, staff and registers', () => {
  it('a price change reaches the till but never changes old receipts', async () => {
    const owner = await signup();
    await call('POST', `/platform/companies/${owner.tenantId}/approve`, adminToken);
    const s = await setUpRestaurant(owner.token, owner.tenantId);
    const till = (await tillLogin(owner.tenantId, s.registerId, s.cashierId, '2580')).json().token;
    const before = (await sell(till, s.registerId, s.articleId, 12500)).json();

    await call('PATCH', `/admin/tenants/${owner.tenantId}/articles/${s.articleId}`, owner.token, {
      priceOre: 13500,
    });
    const menu = (await call('GET', `/registers/${s.registerId}/menu`, till)).json();
    expect(menu.groups[0].articles[0]).toMatchObject({ priceOre: 13500 });
    expect((await sell(till, s.registerId, s.articleId, 13500)).statusCode).toBe(201);

    const list = (await call('GET', `/registers/${s.registerId}/receipts`, till)).json();
    const old = list.find((r: { id: string }) => r.id === before.id);
    expect(old.lines[0]).toMatchObject({ unitPriceOre: 12500 });
  });

  it('deactivating a cashier logs them out of the till', async () => {
    const owner = await signup();
    await call('POST', `/platform/companies/${owner.tenantId}/approve`, adminToken);
    const s = await setUpRestaurant(owner.token, owner.tenantId);
    const till = (await tillLogin(owner.tenantId, s.registerId, s.cashierId, '2580')).json().token;

    await call('PATCH', `/admin/tenants/${owner.tenantId}/staff/${s.cashierId}`, owner.token, {
      active: false,
    });
    expect((await sell(till, s.registerId, s.articleId, 12500)).statusCode).toBe(401);
    expect((await tillLogin(owner.tenantId, s.registerId, s.cashierId, '2580')).statusCode).toBe(
      401,
    );
  });

  it('a manager cannot appoint owners; nobody can lock themselves out', async () => {
    const owner = await signup();
    const managerEmail = `mgr-${randomUUID()}@example.test`;
    const created = await call('POST', `/admin/tenants/${owner.tenantId}/staff`, owner.token, {
      displayName: 'Maja',
      email: managerEmail,
      role: 'manager',
      pin: '1470',
      password: PASSWORD,
    });
    expect(created.statusCode).toBe(201);
    const managerToken = (await login(managerEmail, PASSWORD)).json().token;

    const makeOwner = await call('POST', `/admin/tenants/${owner.tenantId}/staff`, managerToken, {
      displayName: 'Ny Ägare',
      role: 'owner',
      pin: '3690',
    });
    expect(makeOwner.statusCode).toBe(403);

    const me = (await call('GET', '/admin/me', owner.token)).json();
    const self = await call(
      'PATCH',
      `/admin/tenants/${owner.tenantId}/staff/${me.user.userId}`,
      owner.token,
      { active: false },
    );
    expect(self.json()).toMatchObject({ error: 'cannot_change_self' });
  });

  it('registers are retired, not deleted, and the audit log records changes', async () => {
    const owner = await signup();
    const s = await setUpRestaurant(owner.token, owner.tenantId);
    const base = `/admin/tenants/${owner.tenantId}`;

    const dup = await call('POST', `${base}/restaurants/${s.restaurantId}/registers`, owner.token, {
      designation: 'KASSA-1',
    });
    expect(dup.json()).toMatchObject({ error: 'designation_taken' });

    expect(
      (await call('POST', `${base}/registers/${s.registerId}/retire`, owner.token)).statusCode,
    ).toBe(200);
    const { restaurants } = (await call('GET', `${base}/restaurants`, owner.token)).json();
    expect(restaurants[0].registers[0]).toMatchObject({ status: 'retired', enrolled: true });

    const log = (await call('GET', `${base}/audit`, owner.token)).json();
    expect(log.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining([
        'company.signup',
        'register.create',
        'article.create',
        'staff.create',
        'register.retire',
      ]),
    );
  });
});

describe('paired devices', () => {
  it('revoking a till logs out everyone on it and stops it from logging in', async () => {
    const owner = await signup();
    await call('POST', `/platform/companies/${owner.tenantId}/approve`, adminToken);
    const s = await setUpRestaurant(owner.token, owner.tenantId);
    const till = (await tillLogin(owner.tenantId, s.registerId, s.cashierId, '2580')).json().token;

    const { restaurants } = (
      await call('GET', `/admin/tenants/${owner.tenantId}/restaurants`, owner.token)
    ).json();
    const device = restaurants[0].registers[0].devices[0];
    expect(device).toMatchObject({ name: 'Test-iPad' });

    await call('POST', `/admin/tenants/${owner.tenantId}/devices/${device.id}/revoke`, owner.token);
    expect((await sell(till, s.registerId, s.articleId, 12500)).statusCode).toBe(401);
    const again = await tillLogin(owner.tenantId, s.registerId, s.cashierId, '2580');
    expect(again.json()).toMatchObject({ error: 'device_not_paired' });
  });

  it("a code can't be made for another company's register", async () => {
    const mine = await signup();
    const theirs = await signup();
    const s = await setUpRestaurant(theirs.token, theirs.tenantId);
    const res = await call(
      'POST',
      `/admin/tenants/${mine.tenantId}/registers/${s.registerId}/pairing-code`,
      mine.token,
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('email', () => {
  const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)![1]!;

  it('sign-up sends a verification link that confirms the email once', async () => {
    const owner = await signup();
    const mail = mailer.lastTo(owner.email)!;
    expect(mail.subject).toMatch(/Confirm your email/);

    expect((await call('GET', '/admin/me', owner.token)).json().user.emailVerified).toBe(false);
    const token = tokenFrom(mail.text);
    const verify = () =>
      app.inject({ method: 'POST', url: '/admin/verify-email', payload: { token } });
    expect((await verify()).statusCode).toBe(200);
    expect((await call('GET', '/admin/me', owner.token)).json().user.emailVerified).toBe(true);
    expect((await verify()).json()).toMatchObject({ error: 'invalid_token' });
  });

  it('a password reset sets a new password and logs out old sessions', async () => {
    const owner = await signup();
    const request = await app.inject({
      method: 'POST',
      url: '/admin/password-reset',
      payload: { email: owner.email.toUpperCase() },
    });
    expect(request.statusCode).toBe(204);
    const token = tokenFrom(mailer.lastTo(owner.email)!.text);

    const confirm = await app.inject({
      method: 'POST',
      url: '/admin/password-reset/confirm',
      payload: { token, password: 'a brand new password' },
    });
    expect(confirm.statusCode).toBe(200);
    expect((await call('GET', '/admin/me', owner.token)).statusCode).toBe(401);
    expect((await login(owner.email, PASSWORD)).statusCode).toBe(401);
    expect((await login(owner.email, 'a brand new password')).statusCode).toBe(200);
  });

  it('answers the same for an unknown email and sends nothing', async () => {
    const before = mailer.sent.length;
    const res = await app.inject({
      method: 'POST',
      url: '/admin/password-reset',
      payload: { email: 'nobody@example.test' },
    });
    expect(res.statusCode).toBe(204);
    expect(mailer.sent.length).toBe(before);
  });
});

describe('platform console', () => {
  it('lists companies with status and usage only', async () => {
    const owner = await signup();
    const res = await call('GET', '/platform/companies', adminToken);
    expect(res.statusCode).toBe(200);
    const company = res.json().find((c: { tenantId: string }) => c.tenantId === owner.tenantId);
    expect(company).toMatchObject({
      status: 'pending',
      restaurants: 1,
      registers: 0,
      sales30dOre: 0,
      owner: { name: 'Olle Ägare', email: owner.email },
    });
    expect(Object.keys(company)).not.toEqual(expect.arrayContaining(['receipts', 'menu']));
  });

  it('is closed to owners', async () => {
    const owner = await signup();
    expect((await call('GET', '/platform/companies', owner.token)).statusCode).toBe(403);
    const approve = await call(
      'POST',
      `/platform/companies/${owner.tenantId}/approve`,
      owner.token,
    );
    expect(approve.statusCode).toBe(403);
  });
});
