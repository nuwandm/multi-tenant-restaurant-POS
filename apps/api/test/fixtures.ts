import { randomInt, randomUUID } from 'node:crypto';
import { isValidOrgNumber } from '@pos/domain';
import type { Sql, TransactionSql } from 'postgres';
import { hashPassword, hashPin } from '../src/auth/pin';
import { hashPairingCode, newPairingCode } from '../src/auth/device';
import { hashToken, newSessionToken, type Role } from '../src/auth/session';
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
  /** A manager, already logged in on registerId. */
  managerId: string;
  /** Bearer token of the manager's session. */
  token: string;
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * Creates a tenant with one restaurant, one register enrolled with the control system and a
 * logged-in manager, all through the RLS-scoped path.
 */
export async function createTenant(
  sql: Sql,
  orgNumber = randomOrgNumber(),
  designation = 'KASSA-1',
): Promise<TenantFixture> {
  const tenantId = randomUUID();
  const base = await withTenant(sql, tenantId, async (tx) => {
    await tx`INSERT INTO tenants (id, legal_name, org_number, status) VALUES (${tenantId}, ${'Restaurang ' + orgNumber}, ${orgNumber}, 'active')`;
    const [restaurant] = await tx<{ id: string }[]>`
      INSERT INTO restaurants (tenant_id, name, address)
      VALUES (${tenantId}, 'Main', 'Storgatan 1, Stockholm') RETURNING id`;
    const registerId = await insertRegister(tx, tenantId, restaurant!.id, designation);
    return { tenantId, restaurantId: restaurant!.id, registerId };
  });
  const managerId = await createStaff(sql, base.tenantId, {
    name: 'Manager',
    pin: '1234',
    role: 'manager',
  });
  const token = await createSession(sql, base.tenantId, managerId, base.registerId, 'manager');
  return { ...base, managerId, token };
}

/** A platform admin with a back office password. Written directly, as the CLI script does. */
export async function createPlatformAdmin(sql: Sql, email: string, password: string) {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, display_name, password_hash)
    VALUES (${email}, 'Platform admin', ${await hashPassword(password)}) RETURNING id`;
  await sql`INSERT INTO platform_admins (user_id) VALUES (${user!.id})`;
  return user!.id;
}

/** A staff member with a PIN. Returns the user id. */
export async function createStaff(
  sql: Sql,
  tenantId: string,
  staff: { name: string; pin: string; role: Role; active?: boolean },
): Promise<string> {
  const pinHash = await hashPin(staff.pin);
  return withTenant(sql, tenantId, async (tx) => {
    const [user] = await tx<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES (${`${randomUUID()}@test.local`}, ${staff.name})
      RETURNING id`;
    await tx`
      INSERT INTO memberships (tenant_id, user_id, role, pin_hash, active)
      VALUES (${tenantId}, ${user!.id}, ${staff.role}, ${pinHash}, ${staff.active ?? true})`;
    return user!.id;
  });
}

/** Pairs a till with a register the way the back office and till do. Returns the device token. */
export async function pairDevice(
  sql: Sql,
  tenantId: string,
  registerId: string,
  createdBy: string,
  name = 'Test tablet',
): Promise<string> {
  const code = newPairingCode();
  await withTenant(
    sql,
    tenantId,
    (tx) => tx`
      INSERT INTO pairing_codes (code_hash, tenant_id, register_id, created_by, expires_at)
      VALUES (${hashPairingCode(code)}, ${tenantId}, ${registerId}, ${createdBy},
              ${new Date(Date.now() + 600_000)})`,
  );
  const deviceToken = randomUUID() + randomUUID();
  const [row] = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE pos_app`;
    return tx<{ device_id: string }[]>`
      SELECT * FROM app_claim_pairing_code(${hashPairingCode(code)}, ${hashToken(deviceToken)}, ${name})`;
  });
  if (!row) throw new Error('pairing failed');
  return deviceToken;
}

/** A logged-in session without going through the PIN check. Returns the bearer token. */
export async function createSession(
  sql: Sql,
  tenantId: string,
  userId: string,
  registerId: string,
  role: Role,
  expiresAt = new Date(Date.now() + 3_600_000),
): Promise<string> {
  const { token, tokenHash } = newSessionToken();
  await withTenant(
    sql,
    tenantId,
    (tx) =>
      tx`SELECT app_create_session(${tokenHash}, ${userId}, ${registerId}, ${role}, ${expiresAt}, NULL)`,
  );
  return token;
}

export async function insertRegister(
  tx: TransactionSql,
  tenantId: string,
  restaurantId: string,
  designation: string,
  controlSystemRef: string | null = `FAKE-REF-${designation}`,
): Promise<string> {
  const [register] = await tx<{ id: string }[]>`
    INSERT INTO cash_registers
      (tenant_id, restaurant_id, designation, control_system_ref, control_system_serial)
    VALUES (${tenantId}, ${restaurantId}, ${designation}, ${controlSystemRef},
            ${controlSystemRef ? 'FAKE0000000000001' : null}) RETURNING id`;
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
