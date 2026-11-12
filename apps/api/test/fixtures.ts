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

/** Creates a tenant with one restaurant and one register, all through the RLS-scoped path. */
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
    const [register] = await tx<{ id: string }[]>`
      INSERT INTO cash_registers (tenant_id, restaurant_id, designation)
      VALUES (${tenantId}, ${restaurant!.id}, ${designation}) RETURNING id`;
    return { tenantId, restaurantId: restaurant!.id, registerId: register!.id };
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
