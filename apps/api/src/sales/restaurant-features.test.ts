import { randomUUID } from 'node:crypto';
import { FakeControlSystem } from '@pos/control-system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../test/db';
import { auth, createPlatformAdmin, randomOrgNumber } from '../../test/fixtures';
import { buildApp } from '../app';
import { createSql } from '../db/client';
import { MemoryMailer } from '../mail/mailer';

const sql = createSql(testDatabaseUrl);
const app = buildApp({ sql, controlSystem: new FakeControlSystem(), mailer: new MemoryMailer() });
const PASSWORD = 'correct horse battery';

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  token: string,
  payload?: object,
) {
  return app.inject({ method, url, headers: auth(token), ...(payload && { payload }) });
}

interface Shop {
  owner: string;
  base: string;
  restaurantId: string;
  registerId: string;
  manager: string;
  cashier: string;
  pizza: string;
  beer: string;
  large: string;
  small: string;
  cheese: string;
  table: string;
}

/** A complete approved restaurant: menu with options and stations, a table, two staff logins. */
async function setUpShop(adminToken: string): Promise<Shop> {
  const signup = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: {
      ownerName: 'Ägare',
      email: `owner-${randomUUID()}@example.test`,
      password: PASSWORD,
      legalName: 'Pizzeria AB',
      orgNumber: randomOrgNumber(),
      restaurantName: 'Pizzeria',
    },
  });
  const { token: owner, tenantId } = signup.json();
  await call('POST', `/platform/companies/${tenantId}/approve`, adminToken);
  const base = `/admin/tenants/${tenantId}`;
  const restaurantId = (await call('GET', `${base}/restaurants`, owner)).json().restaurants[0].id;
  const r = `${base}/restaurants/${restaurantId}`;

  const registerId = (
    await call('POST', `${r}/registers`, owner, { designation: 'KASSA-1' })
  ).json().id;
  const pizza = (
    await call('POST', `${r}/articles`, owner, {
      name: 'Margherita',
      priceOre: 12000,
      vatRate: 12,
      station: 'kitchen',
    })
  ).json().id;
  const beer = (
    await call('POST', `${r}/articles`, owner, {
      name: 'Öl',
      priceOre: 8000,
      vatRate: 25,
      station: 'bar',
    })
  ).json().id;

  const size = (
    await call('POST', `${r}/option-groups`, owner, { name: 'Size', minSelect: 1, maxSelect: 1 })
  ).json().id;
  const extras = (
    await call('POST', `${r}/option-groups`, owner, { name: 'Extras', minSelect: 0, maxSelect: 3 })
  ).json().id;
  const small = (
    await call('POST', `${base}/option-groups/${size}/options`, owner, {
      name: 'Small',
      priceDeltaOre: -2000,
    })
  ).json().id;
  const large = (
    await call('POST', `${base}/option-groups/${size}/options`, owner, {
      name: 'Large',
      priceDeltaOre: 3000,
    })
  ).json().id;
  const cheese = (
    await call('POST', `${base}/option-groups/${extras}/options`, owner, {
      name: 'Extra cheese',
      priceDeltaOre: 1500,
    })
  ).json().id;
  await call('PUT', `${base}/articles/${pizza}/option-groups`, owner, { groupIds: [size, extras] });
  const table = (await call('POST', `${r}/tables`, owner, { name: 'Bord 5' })).json().id;

  const addStaff = async (name: string, role: string, pin: string) =>
    (await call('POST', `${base}/staff`, owner, { displayName: name, role, pin })).json()
      .userId as string;
  const managerId = await addStaff('Maja', 'manager', '1111');
  const cashierId = await addStaff('Kim', 'cashier', '2222');

  const code = (await call('POST', `${base}/registers/${registerId}/pairing-code`, owner)).json()
    .code;
  const device = (
    await app.inject({ method: 'POST', url: '/devices/pair', payload: { code, name: 'iPad' } })
  ).json().deviceToken;
  const login = async (userId: string, pin: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-device-token': device },
        payload: { userId, pin },
      })
    ).json().token as string;

  return {
    owner,
    base,
    restaurantId,
    registerId,
    manager: await login(managerId, '1111'),
    cashier: await login(cashierId, '2222'),
    pizza,
    beer,
    large,
    small,
    cheese,
    table,
  };
}

let shop: Shop;

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
  shop = await setUpShop(admin);
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

const sell = (token: string, body: object) =>
  call('POST', `/registers/${shop.registerId}/receipts`, token, body);

describe('item options', () => {
  it('the till menu shows each item with its option groups', async () => {
    const menu = (await call('GET', `/registers/${shop.registerId}/menu`, shop.cashier)).json();
    const pizza = menu.groups
      .flatMap((g: { articles: unknown[] }) => g.articles)
      .find((a: { id: string }) => a.id === shop.pizza);
    expect(pizza).toMatchObject({
      station: 'kitchen',
      optionGroups: [{ name: 'Size', minSelect: 1 }, { name: 'Extras' }],
    });
    expect(menu.tables).toEqual([{ id: shop.table, name: 'Bord 5' }]);
  });

  it('prices options from the menu and prints them on the receipt', async () => {
    const res = await sell(shop.cashier, {
      kind: 'sale',
      lines: [{ articleId: shop.pizza, quantity: 2, optionIds: [shop.cheese, shop.large] }],
      payments: [{ method: 'card', amountOre: 2 * (12000 + 3000 + 1500) }],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().lines[0]).toMatchObject({
      name: 'Margherita',
      options: 'Large, Extra cheese',
      unitPriceOre: 16500,
      lineTotalOre: 33000,
    });
  });

  it('requires a choice where the item needs one, and refuses foreign options', async () => {
    const missing = await sell(shop.cashier, {
      kind: 'sale',
      lines: [{ articleId: shop.pizza, quantity: 1 }],
      payments: [{ method: 'card', amountOre: 12000 }],
    });
    expect(missing.json()).toMatchObject({ error: 'option_choice' });

    const twoSizes = await sell(shop.cashier, {
      kind: 'sale',
      lines: [{ articleId: shop.pizza, quantity: 1, optionIds: [shop.small, shop.large] }],
      payments: [{ method: 'card', amountOre: 13000 }],
    });
    expect(twoSizes.json()).toMatchObject({ error: 'option_choice' });

    const onBeer = await sell(shop.cashier, {
      kind: 'sale',
      lines: [{ articleId: shop.beer, quantity: 1, optionIds: [shop.cheese] }],
      payments: [{ method: 'card', amountOre: 9500 }],
    });
    expect(onBeer.json()).toMatchObject({ error: 'option_unavailable' });
  });
});

describe('discounts and split payments', () => {
  it('spreads an order discount over the lines', async () => {
    const res = await sell(shop.cashier, {
      kind: 'sale',
      lines: [
        { articleId: shop.pizza, quantity: 1, optionIds: [shop.small] },
        { articleId: shop.beer, quantity: 1 },
      ],
      orderDiscountOre: 1800,
      payments: [{ method: 'card', amountOre: 10000 + 8000 - 1800 }],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ totalOre: 16200, orderDiscountOre: 1800 });
  });

  it('takes one bill with card and cash together', async () => {
    const res = await sell(shop.cashier, {
      kind: 'sale',
      lines: [{ articleId: shop.beer, quantity: 2 }],
      payments: [
        { method: 'card', amountOre: 10000 },
        { method: 'cash', amountOre: 6000 },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().payments).toHaveLength(2);
  });
});

describe('tables, open orders and the kitchen', () => {
  const url = (path = '') => `/registers/${shop.registerId}/open-orders${path}`;

  it('runs a table from first order to last payment', async () => {
    const created = await call('POST', url(), shop.cashier, {
      tableId: shop.table,
      lines: [
        { articleId: shop.pizza, quantity: 2, optionIds: [shop.large] },
        { articleId: shop.beer, quantity: 2 },
      ],
    });
    expect(created.statusCode).toBe(201);
    const order = created.json();
    expect(order).toMatchObject({ tableName: 'Bord 5', totalOre: 2 * 15000 + 2 * 8000 });

    const busy = await call('POST', url(), shop.cashier, { tableId: shop.table, lines: [] });
    expect(busy.json()).toMatchObject({ error: 'table_busy' });

    // Send to the kitchen: one ticket per station.
    const sent = await call('POST', url(`/${order.id}/send`), shop.cashier);
    expect(sent.json().tickets).toBe(2);
    const kitchen = (
      await call(
        'GET',
        `/registers/${shop.registerId}/kitchen-tickets?station=kitchen`,
        shop.cashier,
      )
    ).json();
    const ticket = kitchen.find((k: { label: string }) => k.label === 'Bord 5');
    expect(ticket.lines).toEqual([{ name: 'Margherita', options: 'Large', quantity: 2 }]);

    // Another round of beer; a stale save is refused.
    const latest = (await call('GET', url(), shop.cashier))
      .json()
      .find((o: { id: string }) => o.id === order.id);
    const more = await call('PUT', url(`/${order.id}`), shop.cashier, {
      version: latest.version,
      lines: [
        { articleId: shop.pizza, quantity: 2, optionIds: [shop.large] },
        { articleId: shop.beer, quantity: 3 },
      ],
    });
    expect(more.statusCode).toBe(200);
    const stale = await call('PUT', url(`/${order.id}`), shop.cashier, {
      version: latest.version,
      lines: [],
    });
    expect(stale.json()).toMatchObject({ error: 'order_changed' });

    // One guest pays for their pizza; the rest stays on the table.
    const part = await sell(shop.cashier, {
      kind: 'sale',
      openOrderId: order.id,
      lines: [{ articleId: shop.pizza, quantity: 1, optionIds: [shop.large] }],
      payments: [{ method: 'card', amountOre: 15000 }],
    });
    expect(part.statusCode).toBe(201);
    const afterPart = (await call('GET', url(), shop.cashier))
      .json()
      .find((o: { id: string }) => o.id === order.id);
    expect(
      afterPart.lines.map((l: { name: string; quantity: number }) => [l.name, l.quantity]),
    ).toEqual([
      ['Margherita', 1],
      ['Öl', 3],
    ]);

    // The rest is paid; the unsent third beer goes to the bar with the payment.
    const before = (
      await call('GET', `/registers/${shop.registerId}/kitchen-tickets?station=bar`, shop.cashier)
    ).json().length;
    const rest = await sell(shop.cashier, {
      kind: 'sale',
      openOrderId: order.id,
      lines: [
        { articleId: shop.pizza, quantity: 1, optionIds: [shop.large] },
        { articleId: shop.beer, quantity: 3 },
      ],
      payments: [{ method: 'card', amountOre: 15000 + 24000 }],
    });
    expect(rest.statusCode).toBe(201);
    const bar = (
      await call('GET', `/registers/${shop.registerId}/kitchen-tickets?station=bar`, shop.cashier)
    ).json();
    expect(bar.length).toBe(before + 1);
    expect(bar.at(-1).lines).toEqual([{ name: 'Öl', options: null, quantity: 1 }]);
    expect(
      (await call('GET', url(), shop.cashier))
        .json()
        .some((o: { id: string }) => o.id === order.id),
    ).toBe(false);
  });

  it('a quick sale sends its items to the kitchen, and tickets can be marked done', async () => {
    const sale = await sell(shop.cashier, {
      kind: 'sale',
      lines: [{ articleId: shop.pizza, quantity: 1, optionIds: [shop.small] }],
      payments: [{ method: 'swish', amountOre: 10000 }],
    });
    const label = `#${sale.json().receiptNumber}`;
    const tickets = (
      await call(
        'GET',
        `/registers/${shop.registerId}/kitchen-tickets?station=kitchen`,
        shop.cashier,
      )
    ).json();
    const ticket = tickets.find((k: { label: string }) => k.label === label);
    expect(ticket).toMatchObject({
      doneAt: null,
      lines: [{ name: 'Margherita', options: 'Small', quantity: 1 }],
    });

    const done = await call(
      'POST',
      `/registers/${shop.registerId}/kitchen-tickets/${ticket.id}`,
      shop.cashier,
      { done: true },
    );
    expect(done.json()).toMatchObject({ done: true });
  });

  it('only a manager can cancel an order that went to the kitchen', async () => {
    const order = (
      await call('POST', url(), shop.cashier, {
        tableId: null,
        lines: [{ articleId: shop.beer, quantity: 1 }],
      })
    ).json();
    await call('POST', url(`/${order.id}/send`), shop.cashier);
    expect((await call('POST', url(`/${order.id}/cancel`), shop.cashier)).statusCode).toBe(403);
    expect((await call('POST', url(`/${order.id}/cancel`), shop.manager)).statusCode).toBe(204);
  });
});

describe('sales report', () => {
  it('totals the range and lists top items', async () => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
    const res = await call(
      'GET',
      `${shop.base}/reports/sales?from=${today}&to=${today}`,
      shop.owner,
    );
    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report.totals.receipts).toBeGreaterThanOrEqual(5);
    expect(report.days).toHaveLength(1);
    expect(report.days[0].netOre).toBe(report.totals.netOre);
    expect(report.topItems[0]).toMatchObject({
      name: expect.any(String),
      quantity: expect.any(Number),
    });
    expect(report.payments.map((p: { method: string }) => p.method)).toEqual(
      expect.arrayContaining(['card', 'cash', 'swish']),
    );
  });
});
