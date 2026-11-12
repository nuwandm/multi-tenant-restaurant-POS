import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { verifySecret } from '../auth/pin';
import { bearerToken, hashToken, newSessionToken, type Role } from '../auth/session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { ADMIN_SESSION_HOURS, MANAGER_ROLES, requireAdmin, withUser } from './admin-session';
import { isPlatformAdmin } from './platform-routes';

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 15;

interface Company {
  tenantId: string;
  legalName: string;
  orgNumber: string;
  role: Role;
}

type LoginResult = { ok: true; token: string; userId: string } | { ok: false; error: HttpError };

/** Companies the user can manage in the back office. */
export async function managedCompanies(deps: AppDeps, userId: string): Promise<Company[]> {
  const rows = await withUser(
    deps.sql,
    userId,
    (tx) => tx<{ tenant_id: string; legal_name: string; org_number: string; role: Role }[]>`
      SELECT m.tenant_id, t.legal_name, t.org_number, m.role
      FROM memberships m JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ${userId} AND m.active AND m.role IN ${tx(MANAGER_ROLES)}
      ORDER BY t.legal_name`,
  );
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    legalName: r.legal_name,
    orgNumber: r.org_number,
    role: r.role,
  }));
}

export function adminAuthRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post<{ Body: { email: string; password: string } }>(
    '/admin/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 200 },
            password: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (req) => {
      const { email, password } = req.body;
      // Failed attempts must be committed, so errors are returned, not thrown, inside the transaction.
      const result = await deps.sql.begin(async (tx): Promise<LoginResult> => {
        await tx`SET LOCAL ROLE pos_app`;
        const [user] = await tx<
          {
            id: string;
            password_hash: string | null;
            failed_login_attempts: number;
            locked_until: Date | null;
          }[]
        >`
          SELECT id, password_hash, failed_login_attempts, locked_until FROM users
          WHERE lower(email) = lower(${email.trim()})
          FOR UPDATE`;
        const invalid = {
          ok: false,
          error: new HttpError(401, 'invalid_login', 'Wrong email or password'),
        } as const;
        if (!user?.password_hash) return invalid;
        if (user.locked_until && user.locked_until > new Date()) {
          return {
            ok: false,
            error: new HttpError(
              423,
              'login_locked',
              `Too many failed logins. Try again in ${LOGIN_LOCK_MINUTES} minutes.`,
            ),
          };
        }
        if (!(await verifySecret(password, user.password_hash))) {
          const attempts = user.failed_login_attempts + 1;
          const lock = attempts >= MAX_LOGIN_ATTEMPTS;
          await tx`
            UPDATE users
            SET failed_login_attempts = ${lock ? 0 : attempts},
                locked_until = ${lock ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000) : null}
            WHERE id = ${user.id}`;
          return invalid;
        }
        await tx`UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ${user.id}`;
        const { token, tokenHash } = newSessionToken();
        await tx`
          INSERT INTO admin_sessions (token_hash, user_id, expires_at)
          VALUES (${tokenHash}, ${user.id}, ${new Date(Date.now() + ADMIN_SESSION_HOURS * 3_600_000)})`;
        return { ok: true, token, userId: user.id };
      });

      if (!result.ok) throw result.error;
      const companies = await managedCompanies(deps, result.userId);
      if (companies.length === 0 && !(await isPlatformAdmin(deps, result.userId))) {
        throw new HttpError(403, 'no_backoffice_access', 'You do not manage any company');
      }
      return { token: result.token };
    },
  );

  app.get('/admin/me', { preHandler: requireAdmin(deps.sql) }, async (req) => {
    const admin = req.admin!;
    return {
      user: admin,
      isPlatformAdmin: await isPlatformAdmin(deps, admin.userId),
      companies: await managedCompanies(deps, admin.userId),
    };
  });

  app.post('/admin/logout', async (req, reply) => {
    const token = bearerToken(req);
    if (token) {
      await deps.sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE pos_app`;
        await tx`UPDATE admin_sessions SET ended_at = now()
                 WHERE token_hash = ${hashToken(token)} AND ended_at IS NULL`;
      });
    }
    return reply.status(204).send();
  });

  // Today's (or a given day's) sales for every company the user manages, per restaurant.
  // Each company is queried in its own tenant scope; nothing is mixed across companies.
  app.get<{ Querystring: { date?: string } }>(
    '/admin/overview',
    {
      preHandler: requireAdmin(deps.sql),
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
        },
      },
    },
    async (req) => {
      const date =
        req.query.date ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
      const companies = await managedCompanies(deps, req.admin!.userId);

      const results = await Promise.all(
        companies.map(async (company) => {
          const restaurants = await withTenant(
            deps.sql,
            company.tenantId,
            (tx) => tx<
              { id: string; name: string; net_ore: number; sales: number; returns: number }[]
            >`
              SELECT s.id, s.name,
                     coalesce(sum(r.total_incl_vat_ore)
                              FILTER (WHERE r.kind IN ('sale', 'return')), 0)::int8 AS net_ore,
                     count(r.id) FILTER (WHERE r.kind = 'sale')::int AS sales,
                     count(r.id) FILTER (WHERE r.kind = 'return')::int AS returns
              FROM restaurants s
              LEFT JOIN cash_registers c ON c.restaurant_id = s.id
              LEFT JOIN receipts r ON r.register_id = c.id
                AND r.created_at >= (${date}::date)::timestamp AT TIME ZONE 'Europe/Stockholm'
                AND r.created_at < (${date}::date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm'
              GROUP BY s.id, s.name
              ORDER BY s.name`,
          );
          return {
            ...company,
            netOre: restaurants.reduce((sum, r) => sum + r.net_ore, 0),
            restaurants: restaurants.map((r) => ({
              id: r.id,
              name: r.name,
              netOre: r.net_ore,
              sales: r.sales,
              returns: r.returns,
            })),
          };
        }),
      );

      return { date, companies: results, netOre: results.reduce((sum, c) => sum + c.netOre, 0) };
    },
  );
}
