import { randomUUID } from 'node:crypto';
import { FakeControlSystem } from '@pos/control-system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../test/db';
import { auth, createPlatformAdmin, randomOrgNumber } from '../../test/fixtures';
import { buildApp } from '../app';
import { createSql } from '../db/client';
import { MemoryMailer } from '../mail/mailer';
import { journalSchemaErrors } from './validate';

const sql = createSql(testDatabaseUrl);
const app = buildApp({ sql, controlSystem: new FakeControlSystem(), mailer: new MemoryMailer() });
const PASSWORD = 'correct horse battery';

function call(method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: object) {
  return app.inject({ method, url, headers: auth(token), ...(payload && { payload }) });
}

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date());

let owner: string;
let base: string;
let restaurantId: string;
let registerId: string;
let manager: string;
let soup: string;
let device: string;
let managerId: string;

const login = async () =>
  (
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'x-device-token': device },
      payload: { userId: managerId, pin: '1111' },
    })
  ).json().token as string;

beforeAll(async () => {
  const email = `admin-${randomUUID()}@platform.test`;
  await createPlatformAdmin(sql, email, PASSWORD);
  const admin = (
    await app.inject({
      method: 'POST',
      url: '/admin/login',
      payload: { email, password: PASSWORD },
    })
  ).json().token;
  const signup = (
    await app.inject({
      method: 'POST',
      url: '/signup',
      payload: {
        ownerName: 'Ägare',
        email: `owner-${randomUUID()}@example.test`,
        password: PASSWORD,
        legalName: 'Krog & Bar AB',
        orgNumber: randomOrgNumber(),
        restaurantName: 'Krogen',
      },
    })
  ).json();
  owner = signup.token;
  base = `/admin/tenants/${signup.tenantId}`;
  await call('POST', `/platform/companies/${signup.tenantId}/approve`, admin);
  restaurantId = (await call('GET', `${base}/restaurants`, owner)).json().restaurants[0].id;
  const r = `${base}/restaurants/${restaurantId}`;
  registerId = (await call('POST', `${r}/registers`, owner, { designation: 'KASSA-1' })).json().id;
  soup = (
    await call('POST', `${r}/articles`, owner, { name: 'Soppa', priceOre: 9550, vatRate: 12 })
  ).json().id;
  managerId = (
    await call('POST', `${base}/staff`, owner, {
      displayName: 'Maja',
      role: 'manager',
      pin: '1111',
    })
  ).json().userId;
  const code = (await call('POST', `${base}/registers/${registerId}/pairing-code`, owner)).json()
    .code;
  device = (
    await app.inject({ method: 'POST', url: '/devices/pair', payload: { code, name: 'iPad' } })
  ).json().deviceToken;
  manager = await login();
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

const at = (path: string) => `/registers/${registerId}/${path}`;
const exportUrl = (query = `from=${today}&to=${today}`) =>
  `${base}/journal-export?restaurantId=${restaurantId}&${query}`;

describe('journal export', () => {
  it('needs the restaurant address before anything can be sold', async () => {
    const res = await call('POST', at('receipts'), manager, {
      kind: 'sale',
      lines: [{ articleId: soup, quantity: 1 }],
      payments: [{ method: 'card', amountOre: 9550 }],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('restaurant_address_missing');

    const set = await call('PATCH', `${base}/restaurants/${restaurantId}`, owner, {
      address: 'Storgatan 1, 211 34 Malmö',
    });
    expect(set.statusCode).toBe(204);
  });

  it('exports a day of registrations as a file valid against Skatteverket’s schema', async () => {
    const sale = (
      await call('POST', at('receipts'), manager, {
        kind: 'sale',
        lines: [{ articleId: soup, quantity: 2, discountOre: 1100 }],
        payments: [{ method: 'card', amountOre: 18000 }],
      })
    ).json();
    expect(sale.seller.address).toBe('Storgatan 1, 211 34 Malmö');

    await call('POST', at('training-mode'), manager, { on: true });
    await call('POST', at('receipts'), manager, {
      kind: 'training',
      lines: [{ articleId: soup, quantity: 1 }],
      payments: [{ method: 'cash', amountOre: 9600 }],
    });
    await call('POST', at('training-mode'), manager, { on: false });
    await call('POST', at('copies'), manager, { originalReceiptId: sale.id });
    await call('POST', at('returns'), manager, {
      originalReceiptId: sale.id,
      lines: [{ lineNo: 1, quantity: 1 }],
      payments: [{ method: 'card', amountOre: -9000 }],
    });
    expect((await call('POST', at('x-reports'), manager)).statusCode).toBeLessThan(300);
    expect((await call('POST', at('z-reports'), manager)).statusCode).toBeLessThan(300);
    await app.inject({ method: 'POST', url: '/auth/logout', headers: auth(manager) });
    manager = await login();

    const res = await call('GET', exportUrl(), owner);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.headers['content-disposition']).toContain(`journal-all-${today}-${today}.xml`);
    const xml = res.body;
    expect(await journalSchemaErrors(xml)).toEqual([]);

    for (const element of [
      'InloggningIKassaregister',
      'Kassakvitto',
      'StallaOmTillOvningslage',
      'Ovningskvitto',
      'StallaOmTillNormallage',
      'KopiaAvKassakvitto',
      'Returkvitto',
      'XDagrapport',
      'ZDagrapport',
      'UtloggningUrKassaregister',
    ]) {
      expect(xml, element).toContain(`<${element}>`);
    }
    expect(xml).toContain('<DenAdressDarForsaljningSker>Storgatan 1, 211 34 Malmö<');
    expect(xml).toContain('<InloggadAnvandare>Maja<');
    // The Z report counts the discount and the items: 2 sold, 1 returned.
    const z = xml.slice(xml.indexOf('<ZDagrapport>'), xml.indexOf('</ZDagrapport>'));
    expect(z).toContain('<RabatternasBelopp>5.50</RabatternasBelopp>');
    expect(z).toContain('<AntalSaldaVaror>1</AntalSaldaVaror>');
    // Receipts made before this Z report belong to Z report 1.
    expect(xml).toContain('<LopnummerForZDagrapportPaKvitto>1<');
  });

  it('keeps the address a receipt was printed with', async () => {
    await call('PATCH', `${base}/restaurants/${restaurantId}`, owner, {
      address: 'Nya vägen 9, Malmö',
    });
    const xml = (await call('GET', exportUrl(), owner)).body;
    expect(xml).toContain('<DenAdressDarForsaljningSker>Storgatan 1, 211 34 Malmö<');
    // The export header shows where sales take place now.
    expect(xml).toContain('<InformationOmForetaget><OrganisationsnummerEllerPersonnummer>');
  });

  it('answers clearly for an empty period, a bad range or someone else’s company', async () => {
    const empty = await call('GET', exportUrl('from=2026-01-01&to=2026-01-02'), owner);
    expect(empty.statusCode).toBe(404);
    expect(empty.json().error).toBe('journal_empty');

    const backwards = await call('GET', exportUrl('from=2026-02-02&to=2026-02-01'), owner);
    expect(backwards.json().error).toBe('invalid_range');

    const byStaff = await call('GET', exportUrl(), manager);
    expect(byStaff.statusCode).toBe(401);
  });

  it('records the export in the change log', async () => {
    const log = (await call('GET', `${base}/audit`, owner)).json();
    expect(log.some((e: { action: string }) => e.action === 'journal.export')).toBe(true);
  });
});
