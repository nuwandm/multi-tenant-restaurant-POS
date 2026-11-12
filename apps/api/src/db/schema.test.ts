import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../test/db';
import { createTenant, insertReceipt, type TenantFixture } from '../../test/fixtures';
import { withTenant } from './tenant';

// Postgres error codes asserted below.
const INSUFFICIENT_PRIVILEGE = '42501'; // missing grant, RLS WITH CHECK, append-only trigger
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

const sql = postgres(testDatabaseUrl, { onnotice: () => {} });

let a: TenantFixture;
let b: TenantFixture;
let receiptA: string;
let receiptB: string;

beforeAll(async () => {
  // Same designation in both tenants on purpose: it is unique per tenant, not globally.
  a = await createTenant(sql);
  b = await createTenant(sql);
  receiptA = await withTenant(sql, a.tenantId, (tx) => insertReceipt(tx, a, 1));
  receiptB = await withTenant(sql, b.tenantId, (tx) => insertReceipt(tx, b, 1));
});

afterAll(() => sql.end());

describe('tenant isolation (RLS)', () => {
  it("tenant A cannot read tenant B's receipts", async () => {
    const ids = await withTenant(
      sql,
      a.tenantId,
      (tx) => tx<{ id: string }[]>`SELECT id FROM receipts`,
    );
    expect(ids.map((r) => r.id)).toEqual([receiptA]);
  });

  it("tenant A cannot read tenant B's tenant row or registers", async () => {
    const result = await withTenant(sql, a.tenantId, async (tx) => ({
      tenants: await tx`SELECT id FROM tenants WHERE id = ${b.tenantId}`,
      registers: await tx`SELECT id FROM cash_registers WHERE id = ${b.registerId}`,
    }));
    expect(result.tenants).toHaveLength(0);
    expect(result.registers).toHaveLength(0);
  });

  it('tenant A cannot write a row tagged with tenant B', async () => {
    await expect(
      withTenant(sql, a.tenantId, (tx) => insertReceipt(tx, b, 2, { tenantId: b.tenantId })),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it("a child row cannot point at another tenant's receipt", async () => {
    await expect(
      withTenant(
        sql,
        a.tenantId,
        (tx) => tx`
          INSERT INTO payments (tenant_id, receipt_id, method, amount_ore)
          VALUES (${a.tenantId}, ${receiptB}, 'cash', 100)`,
      ),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });

  it('sees nothing when no tenant is set', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE pos_app`;
      return tx`SELECT id FROM receipts`;
    });
    expect(rows).toHaveLength(0);
  });
});

describe('append-only sales data', () => {
  it('the app role cannot update a receipt', async () => {
    await expect(
      withTenant(
        sql,
        a.tenantId,
        (tx) => tx`UPDATE receipts SET control_code = 'X' WHERE id = ${receiptA}`,
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('the app role cannot delete a receipt', async () => {
    await expect(
      withTenant(sql, a.tenantId, (tx) => tx`DELETE FROM receipts WHERE id = ${receiptA}`),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('even the table owner cannot update or delete a receipt', async () => {
    await expect(
      sql`UPDATE receipts SET control_code = 'X' WHERE id = ${receiptA}`,
    ).rejects.toMatchObject({
      code: INSUFFICIENT_PRIVILEGE,
      message: expect.stringContaining('append-only'),
    });
    await expect(sql`DELETE FROM receipts WHERE id = ${receiptA}`).rejects.toMatchObject({
      code: INSUFFICIENT_PRIVILEGE,
    });
  });

  it('registers can be retired but never deleted', async () => {
    await expect(
      withTenant(
        sql,
        a.tenantId,
        (tx) => tx`DELETE FROM cash_registers WHERE id = ${a.registerId}`,
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });
});

describe('constraints', () => {
  it('rejects an org number that fails the Luhn check', async () => {
    await expect(createTenant(sql, '5560360794')).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it('matches the domain Luhn check', async () => {
    const [row] = await sql<{ valid: boolean; invalid: boolean }[]>`
      SELECT is_valid_org_number('5560360793') AS valid, is_valid_org_number('5560360794') AS invalid`;
    expect(row).toEqual({ valid: true, invalid: false });
  });

  it('designation is unique within a tenant', async () => {
    await expect(
      withTenant(
        sql,
        a.tenantId,
        (tx) => tx`
          INSERT INTO cash_registers (tenant_id, restaurant_id, designation)
          VALUES (${a.tenantId}, ${a.restaurantId}, 'KASSA-1')`,
      ),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('receipt numbers are unique per register and kind', async () => {
    await expect(
      withTenant(sql, a.tenantId, (tx) => insertReceipt(tx, a, 1)),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('a receipt cannot be stored without a control code', async () => {
    await expect(
      withTenant(sql, a.tenantId, (tx) => insertReceipt(tx, a, 99, { controlCode: '' })),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it('a return must reference its original receipt', async () => {
    await expect(
      withTenant(
        sql,
        a.tenantId,
        (tx) => tx`
          INSERT INTO receipts (tenant_id, register_id, kind, receipt_number, total_incl_vat_ore, control_code, signed_at)
          VALUES (${a.tenantId}, ${a.registerId}, 'return', 1, -12900, 'CODE-R1', now())`,
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });
});
