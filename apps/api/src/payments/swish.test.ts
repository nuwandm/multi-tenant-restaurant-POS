import { randomUUID } from 'node:crypto';
import { FakeControlSystem } from '@pos/control-system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../test/db';
import { auth, createPlatformAdmin, randomOrgNumber } from '../../test/fixtures';
import { buildApp } from '../app';
import { createSql } from '../db/client';
import { MemoryMailer } from '../mail/mailer';
import { SimulatedSwish, swishAmount, swishMessage } from './swish';

const sql = createSql(testDatabaseUrl);
const swish = new SimulatedSwish();
const app = buildApp({
  sql,
  controlSystem: new FakeControlSystem(),
  mailer: new MemoryMailer(),
  swish,
});
const PASSWORD = 'correct horse battery';

function call(method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: object) {
  return app.inject({ method, url, headers: auth(token), ...(payload && { payload }) });
}

let owner: string;
let base: string;
let restaurantId: string;
let registerId: string;
let cashier: string;
let manager: string;
let soup: string;

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
        legalName: 'Soppkök AB',
        orgNumber: randomOrgNumber(),
        restaurantName: 'Soppköket',
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
  const userId = (
    await call('POST', `${base}/staff`, owner, { displayName: 'Kim', role: 'cashier', pin: '2222' })
  ).json().userId;
  const managerId = (
    await call('POST', `${base}/staff`, owner, {
      displayName: 'Maja',
      role: 'manager',
      pin: '1111',
    })
  ).json().userId;
  const code = (await call('POST', `${base}/registers/${registerId}/pairing-code`, owner)).json()
    .code;
  const device = (
    await app.inject({ method: 'POST', url: '/devices/pair', payload: { code, name: 'iPad' } })
  ).json().deviceToken;
  const login = async (id: string, pin: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-device-token': device },
        payload: { userId: id, pin },
      })
    ).json().token as string;
  cashier = await login(userId, '2222');
  manager = await login(managerId, '1111');
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

const url = (path = '') => `/registers/${registerId}/swish-payments${path}`;
const start = (amountOre: number) => call('POST', url(), cashier, { amountOre });
const sell = (payment: object) =>
  call('POST', `/registers/${registerId}/receipts`, cashier, {
    kind: 'sale',
    lines: [{ articleId: soup, quantity: 1 }],
    payments: [payment],
  });

describe('Swish helpers', () => {
  it('formats amounts and messages the way Swish wants them', () => {
    expect(swishAmount(24550)).toBe('245.50');
    expect(swishAmount(100)).toBe('1.00');
    expect(swishAmount(5)).toBe('0.05');
    expect(swishMessage('Café Åsa & Co — bord #4')).toBe('Caf Åsa  Co  bord 4');
    expect(swishMessage('x'.repeat(80))).toHaveLength(50);
  });
});

describe('Swish at the till', () => {
  it('needs a Swish number on the restaurant', async () => {
    const res = await start(9550);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('swish_not_set_up');
  });

  it('lets the owner set and check the Swish number', async () => {
    const bad = await call('PATCH', `${base}/restaurants/${restaurantId}`, owner, {
      swishNumber: '0701234567',
    });
    expect(bad.statusCode).toBe(400);
    const ok = await call('PATCH', `${base}/restaurants/${restaurantId}`, owner, {
      swishNumber: '1231181189',
    });
    expect(ok.statusCode).toBe(204);
    const list = (await call('GET', `${base}/restaurants`, owner)).json();
    expect(list.restaurants[0].swishNumber).toBe('1231181189');
    const menu = (await call('GET', `/registers/${registerId}/menu`, cashier)).json();
    expect(menu.restaurant.swish).toBe(true);
  });

  it('refuses a Swish sale that Swish has not confirmed', async () => {
    const res = await sell({ method: 'swish', amountOre: 9550 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('swish_not_paid');
  });

  it('shows a QR code, waits, and makes the receipt once the guest has paid', async () => {
    const started = await start(9550);
    expect(started.statusCode).toBe(201);
    const payment = started.json();
    expect(payment).toMatchObject({ status: 'pending', amountOre: 9550, simulated: true });
    expect(payment.qrSvg).toContain('<svg');

    // Not paid yet: no receipt.
    const early = await sell({ method: 'swish', amountOre: 9550, swishPaymentId: payment.id });
    expect(early.json().error).toBe('swish_not_paid');

    const paid = await call('POST', url(`/${payment.id}/simulate`), cashier, { outcome: 'paid' });
    expect(paid.json()).toMatchObject({ status: 'paid', used: false });

    const receipt = await sell({ method: 'swish', amountOre: 9550, swishPaymentId: payment.id });
    expect(receipt.statusCode).toBe(201);
    expect(receipt.json().payments).toEqual([{ method: 'swish', amountOre: 9550 }]);
    expect((await call('GET', url(`/${payment.id}`), cashier)).json().used).toBe(true);

    // One payment pays for one receipt.
    const again = await sell({ method: 'swish', amountOre: 9550, swishPaymentId: payment.id });
    expect(again.json().error).toBe('swish_already_used');
  });

  it('refuses a payment for a different amount', async () => {
    const payment = (await start(5000)).json();
    await call('POST', url(`/${payment.id}/simulate`), cashier, { outcome: 'paid' });
    const res = await call('POST', `/registers/${registerId}/receipts`, cashier, {
      kind: 'sale',
      lines: [{ articleId: soup, quantity: 1 }],
      payments: [{ method: 'swish', amountOre: 9550, swishPaymentId: payment.id }],
    });
    expect(res.json().error).toBe('swish_amount_mismatch');
  });

  it('splits a bill between Swish and cash', async () => {
    const payment = (await start(5000)).json();
    await call('POST', url(`/${payment.id}/simulate`), cashier, { outcome: 'paid' });
    const res = await call('POST', `/registers/${registerId}/receipts`, cashier, {
      kind: 'sale',
      lines: [{ articleId: soup, quantity: 1 }],
      payments: [
        { method: 'swish', amountOre: 5000, swishPaymentId: payment.id },
        { method: 'cash', amountOre: 4600 },
      ],
    });
    expect(res.statusCode).toBe(201);
  });

  it('reports a declined payment and cancels a waiting one', async () => {
    const declined = (await start(9550)).json();
    const res = await call('POST', url(`/${declined.id}/simulate`), cashier, {
      outcome: 'declined',
    });
    expect(res.json().status).toBe('declined');

    const waiting = (await start(9550)).json();
    const cancelled = await call('POST', url(`/${waiting.id}/cancel`), cashier);
    expect(cancelled.json().status).toBe('cancelled');
    // Once ended, a payment never changes again.
    await call('POST', url(`/${waiting.id}/simulate`), cashier, { outcome: 'paid' });
    expect((await call('GET', url(`/${waiting.id}`), cashier)).json().status).toBe('cancelled');
  });

  it('takes the callback only as a hint and never trusts its body', async () => {
    const payment = (await start(9550)).json();
    const tenantId = base.split('/').pop();
    const forged = await app.inject({
      method: 'POST',
      url: `/swish/callback/${tenantId}/${payment.id}`,
      payload: { status: 'PAID', amount: '95.50' },
    });
    expect(forged.statusCode).toBe(200);
    expect((await call('GET', url(`/${payment.id}`), cashier)).json().status).toBe('pending');

    // An unknown id is answered quietly too, so the callback reveals nothing.
    const unknown = await app.inject({
      method: 'POST',
      url: `/swish/callback/${tenantId}/${randomUUID()}`,
      payload: {},
    });
    expect(unknown.statusCode).toBe(200);
  });

  it('training receipts take no Swish money', async () => {
    const payment = (await start(9550)).json();
    await call('POST', url(`/${payment.id}/simulate`), cashier, { outcome: 'paid' });
    const res = await call('POST', `/registers/${registerId}/receipts`, cashier, {
      kind: 'training',
      lines: [{ articleId: soup, quantity: 1 }],
      payments: [{ method: 'swish', amountOre: 9550, swishPaymentId: payment.id }],
    });
    expect(res.json().error).toBe('invalid_payment');
  });
});

/** A Swish sale of one soup, paid and on a receipt. */
async function swishSale() {
  const payment = (await start(9550)).json();
  await call('POST', url(`/${payment.id}/simulate`), cashier, { outcome: 'paid' });
  return (await sell({ method: 'swish', amountOre: 9550, swishPaymentId: payment.id })).json();
}

const refund = (originalReceiptId: string, amountOre: number) =>
  call('POST', `/registers/${registerId}/swish-refunds`, manager, { originalReceiptId, amountOre });

const returnSoup = (originalReceiptId: string, payment: object) =>
  call('POST', `/registers/${registerId}/returns`, manager, {
    originalReceiptId,
    lines: [{ lineNo: 1, quantity: 1 }],
    payments: [payment],
  });

describe('Swish refunds', () => {
  it('a return of a Swish sale must go back through Swish', async () => {
    const sale = await swishSale();
    const manual = await returnSoup(sale.id, { method: 'swish', amountOre: -9550 });
    expect(manual.json().error).toBe('swish_refund_needed');
  });

  it('refunds through Swish, then makes the return receipt', async () => {
    const sale = await swishSale();
    const listed = (await call('GET', `/registers/${registerId}/receipts`, cashier)).json();
    expect(listed.find((r: { id: string }) => r.id === sale.id).swishRefundableOre).toBe(9550);

    const started = await refund(sale.id, 9550);
    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({ kind: 'refund', status: 'pending', amountOre: 9550 });

    // Not paid out yet: no return receipt.
    const early = await returnSoup(sale.id, {
      method: 'swish',
      amountOre: -9550,
      swishRefundId: started.json().id,
    });
    expect(early.json().error).toBe('swish_refund_needed');

    const paid = (await call('GET', url(`/${started.json().id}`), manager)).json();
    expect(paid.status).toBe('paid');
    const ret = await returnSoup(sale.id, {
      method: 'swish',
      amountOre: -9550,
      swishRefundId: started.json().id,
    });
    expect(ret.statusCode).toBe(201);
    expect(ret.json()).toMatchObject({ kind: 'return', totalOre: -9550 });

    const after = (await call('GET', `/registers/${registerId}/receipts`, cashier)).json();
    expect(after.find((r: { id: string }) => r.id === sale.id).swishRefundableOre).toBe(0);
  });

  it('reuses a refund that went out when the return receipt failed', async () => {
    const sale = await swishSale();
    const first = (await refund(sale.id, 9550)).json();
    await call('GET', url(`/${first.id}`), manager);
    // The till was reloaded before the return receipt: asking again gives the same refund.
    const again = (await refund(sale.id, 9550)).json();
    expect(again).toMatchObject({ id: first.id, status: 'paid' });
  });

  it('never refunds more than was paid', async () => {
    const sale = await swishSale();
    expect((await refund(sale.id, 9551)).json().error).toBe('swish_refund_too_large');
    expect((await refund(sale.id, 5000)).statusCode).toBe(201);
    // 50 + 46 kr is more than the 95,50 kr paid.
    expect((await refund(sale.id, 4600)).json().error).toBe('swish_refund_too_large');
  });

  it('only managers refund, and only sales paid through Swish', async () => {
    const sale = await swishSale();
    const byCashier = await call('POST', `/registers/${registerId}/swish-refunds`, cashier, {
      originalReceiptId: sale.id,
      amountOre: 100,
    });
    expect(byCashier.statusCode).toBe(403);

    const card = (await sell({ method: 'card', amountOre: 9550 })).json();
    expect((await refund(card.id, 9550)).json().error).toBe('swish_not_refundable');
  });
});

describe('Swish money without a receipt', () => {
  it('stays usable after a reload and can be refunded from the back office', async () => {
    const payment = (await start(4200)).json();
    await call('POST', url(`/${payment.id}/simulate`), cashier, { outcome: 'paid' });

    // The till was reloaded: it can still find the money.
    const unused = (await call('GET', url('/unused'), cashier)).json();
    expect(unused.map((p: { id: string }) => p.id)).toContain(payment.id);

    const listed = (await call('GET', `${base}/swish-payments/unused`, owner)).json();
    expect(listed.find((p: { id: string }) => p.id === payment.id)).toMatchObject({
      amountOre: 4200,
      register: 'KASSA-1',
      takenBy: 'Kim',
      refund: null,
    });

    const res = await call('POST', `${base}/swish-payments/${payment.id}/refund`, owner);
    expect(res.statusCode).toBe(201);
    // A second refund of the same money is refused.
    const again = await call('POST', `${base}/swish-payments/${payment.id}/refund`, owner);
    expect(again.json().error).toBe('swish_already_refunded');

    // Refunded money is no longer usable at the till, and leaves the list once paid out.
    expect((await call('GET', url('/unused'), cashier)).json()).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: payment.id })]),
    );
    const sale = await sell({ method: 'swish', amountOre: 4200, swishPaymentId: payment.id });
    expect(sale.json().error).toBe('swish_already_used');
    const later = (await call('GET', `${base}/swish-payments/unused`, owner)).json();
    expect(later.some((p: { id: string }) => p.id === payment.id)).toBe(false);
  });
});
