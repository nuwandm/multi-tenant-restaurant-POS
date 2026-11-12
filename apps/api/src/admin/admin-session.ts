import type { FastifyRequest } from 'fastify';
import type { Sql, TransactionSql } from 'postgres';
import { bearerToken, hashToken, type Role } from '../auth/session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';

export interface AdminUser {
  userId: string;
  displayName: string;
  email: string | null;
}

/** An admin request scoped to one company the user manages. */
export interface AdminContext extends AdminUser {
  tenantId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminUser;
    adminTenant?: AdminContext;
  }
}

export const ADMIN_SESSION_HOURS = 8;
export const MANAGER_ROLES: Role[] = ['owner', 'manager'];

/** Runs fn as pos_app with app.user_id set: the user sees their own memberships and companies. */
export async function withUser<T>(
  sql: Sql,
  userId: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE pos_app`;
    await tx`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
  return result as T;
}

async function lookupAdminSession(sql: Sql, token: string): Promise<AdminUser | null> {
  const rows = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE pos_app`;
    return tx<{ user_id: string; display_name: string; email: string | null }[]>`
      SELECT s.user_id, u.display_name, u.email
      FROM admin_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ${hashToken(token)} AND s.ended_at IS NULL AND s.expires_at > now()`;
  });
  const row = rows[0];
  return row ? { userId: row.user_id, displayName: row.display_name, email: row.email } : null;
}

/** preHandler: requires a back office login. */
export function requireAdmin(sql: Sql) {
  return async (req: FastifyRequest) => {
    const token = bearerToken(req);
    const admin = token ? await lookupAdminSession(sql, token) : null;
    if (!admin) throw new HttpError(401, 'not_logged_in', 'Log in to continue');
    req.admin = admin;
  };
}

/**
 * preHandler for /admin/tenants/:tenantId/...: requires a back office login and an active
 * owner or manager membership in that company. Anything else looks like "not found".
 */
export function requireTenantAdmin(sql: Sql) {
  const login = requireAdmin(sql);
  return async (req: FastifyRequest) => {
    await login(req);
    const admin = req.admin!;
    const { tenantId } = req.params as { tenantId: string };
    const [membership] = await withTenant(
      sql,
      tenantId,
      (tx) => tx<{ role: Role }[]>`
        SELECT role FROM memberships WHERE user_id = ${admin.userId} AND active`,
    );
    if (!membership || !MANAGER_ROLES.includes(membership.role)) {
      throw new HttpError(404, 'company_not_found', 'Company not found');
    }
    req.adminTenant = { ...admin, tenantId, role: membership.role };
  };
}

/** Records a back office change. Call inside the transaction that makes the change. */
export async function audit(
  tx: TransactionSql,
  ctx: AdminContext,
  action: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  await tx`
    INSERT INTO audit_log (tenant_id, user_id, action, entity_id, details)
    VALUES (${ctx.tenantId}, ${ctx.userId}, ${action}, ${entityId}, ${tx.json(details as never)})`;
}
