import { randomInt, randomUUID } from 'node:crypto';
import { isValidOrgNumber } from '@pos/domain';
import type { Sql, TransactionSql } from 'postgres';
import { withTenant } from '../src/db/tenant';

/** A random Luhn-valid org number, so test runs never collide on the unique constraint. */
export function randomOrgNumber(): string {
  const base = String(randomInt(100_000_000, 1_000_000_000));
  for (let check = 0; check < 10; check++) {
    if (isValidOrgNumber(base + check)) return base + check;
  }
  throw new Error('unreachable: one check digit always satisfies Luhn');
}

export interface TenantFixture {
  tenantId: string;
  restaurantId: string;
  registerId: string;
}

/**
 * Creates a tenant with one restaurant and one register enrolled with the control system,
 * all through the RLS-scoped path.
 */
export async function createTenant(
  sql: Sql,
  orgNumber = randomOrgNumber(),
  designation = 'KASSA-1',
): Promise<TenantFixture> {
  const tenantId = randomUUID();
  return withTenant(sql, tenantId, async (tx) => {
    await tx`INSERT INTO tenants (id, legal_name, org_number) VALUES (${tenantId}, ${'Restaurang ' + orgNumber}, ${orgNumber})`;
    const [restaurant] = await tx<{ id: string }[]>`
      INSERT INTO restaurants (tenant_id, name) VALUES (${tenantId}, 'Main') RETURNING id`;
    const registerId = await insertRegister(tx, tenantId, restaurant!.id, designation);
    return { tenantId, restaurantId: restaurant!.id, registerId };
  });
}

export async function insertRegister(
  tx: TransactionSql,
  tenantId: string,
  restaurantId: string,
  designation: string,
  controlSystemRef: string | null = `FAKE-REF-${designation}`,
): Promise<string> {
  const [register] = await tx<{ id: string }[]>`
    INSERT INTO cash_registers (tenant_id, restaurant_id, designation, control_system_ref)
    VALUES (${tenantId}, ${restaurantId}, ${designation}, ${controlSystemRef}) RETURNING id`;
  return register!.id;
}

export async function createArticle(
  sql: Sql,
  fixture: TenantFixture,
  article: { name: string; priceOre: number; vatRate: 25 | 12 | 6 | 0; active?: boolean },
): Promise<string> {
  return withTenant(sql, fixture.tenantId, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO articles (tenant_id, restaurant_id, name, price_ore, vat_rate, active)
      VALUES (${fixture.tenantId}, ${fixture.restaurantId}, ${article.name}, ${article.priceOre},
              ${article.vatRate}, ${article.active ?? true})
      RETURNING id`;
    return row!.id;
  });
}

export async function insertReceipt(
  tx: TransactionSql,
  fixture: TenantFixture,
  receiptNumber: number,
  overrides: { tenantId?: string; controlCode?: string } = {},
): Promise<string> {
  const [receipt] = await tx<{ id: string }[]>`
    INSERT INTO receipts (tenant_id, register_id, kind, receipt_number, total_incl_vat_ore, control_code, signed_at)
    VALUES (${overrides.tenantId ?? fixture.tenantId}, ${fixture.registerId}, 'sale', ${receiptNumber},
            12900, ${overrides.controlCode ?? `CODE-${receiptNumber}`}, now())
    RETURNING id`;
  return receipt!.id;
}
