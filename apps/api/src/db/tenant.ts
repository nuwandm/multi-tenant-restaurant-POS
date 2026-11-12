import type { Sql, TransactionSql } from 'postgres';

/**
 * Runs fn in a transaction as pos_app with app.tenant_id set, so row-level security applies
 * even when the connection itself is a superuser (dev and tests). All tenant data access goes
 * through here.
 */
export async function withTenant<T>(
  sql: Sql,
  tenantId: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE pos_app`;
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
  return result as T;
}
