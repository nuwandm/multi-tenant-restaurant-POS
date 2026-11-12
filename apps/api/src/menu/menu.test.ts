import { FakeControlSystem } from '@pos/control-system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../test/db';
import { auth, createArticle, createTenant, type TenantFixture } from '../../test/fixtures';
import { buildApp } from '../app';
import { createSql } from '../db/client';
import { withTenant } from '../db/tenant';

const sql = createSql(testDatabaseUrl);
const app = buildApp({ sql, controlSystem: new FakeControlSystem() });

let shop: TenantFixture;

beforeAll(async () => {
  shop = await createTenant(sql);
  const drinks = await withTenant(sql, shop.tenantId, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO menu_groups (tenant_id, restaurant_id, name, sort_order)
      VALUES (${shop.tenantId}, ${shop.restaurantId}, 'Dryck', 2) RETURNING id`;
    return row!.id;
  });
  await createArticle(sql, shop, { name: 'Pasta', priceOre: 14900, vatRate: 12 });
  await createArticle(sql, shop, { name: 'Gammal', priceOre: 100, vatRate: 12, active: false });
  await withTenant(
    sql,
    shop.tenantId,
    (tx) => tx`
      INSERT INTO articles (tenant_id, restaurant_id, menu_group_id, name, price_ore, vat_rate)
      VALUES (${shop.tenantId}, ${shop.restaurantId}, ${drinks}, 'Vin glas', 11500, 25)`,
  );
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

const getMenu = (registerId: string, token: string) =>
  app.inject({
    method: 'GET',
    url: `/registers/${registerId}/menu`,
    headers: auth(token),
  });

describe('GET /registers/:id/menu', () => {
  it('returns the register, seller and active articles grouped', async () => {
    const res = await getMenu(shop.registerId, shop.token);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      register: { id: shop.registerId, designation: 'KASSA-1', status: 'active' },
      restaurant: { name: 'Main' },
      seller: { orgNumber: expect.stringMatching(/^\d{10}$/) },
      groups: [
        { name: 'Dryck', articles: [{ name: 'Vin glas', priceOre: 11500, vatRate: 25 }] },
        { name: null, articles: [{ name: 'Pasta', priceOre: 14900, vatRate: 12 }] },
      ],
    });
  });

  it("does not show another company's register", async () => {
    const other = await createTenant(sql);
    const res = await getMenu(shop.registerId, other.token);
    expect(res.statusCode).toBe(403);
  });
});
