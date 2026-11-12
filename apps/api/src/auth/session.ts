import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { HttpError } from '../errors';

export type Role = 'owner' | 'manager' | 'cashier';

export interface StaffSession {
  tenantId: string;
  userId: string;
  registerId: string;
  role: Role;
  displayName: string;
  expiresAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffSession;
  }
}

export const SESSION_HOURS = 12;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export async function lookupSession(sql: Sql, token: string): Promise<StaffSession | null> {
  const rows = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE pos_app`;
    return tx<
      {
        tenant_id: string;
        user_id: string;
        register_id: string;
        role: Role;
        display_name: string;
        expires_at: Date;
      }[]
    >`SELECT * FROM app_session(${hashToken(token)})`;
  });
  const row = rows[0];
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    registerId: row.register_id,
    role: row.role,
    displayName: row.display_name,
    expiresAt: row.expires_at,
  };
}

export async function endSession(sql: Sql, token: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE pos_app`;
    await tx`SELECT app_end_session(${hashToken(token)})`;
  });
}

export function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  const match = header ? /^Bearer (\S+)$/.exec(header) : null;
  return match?.[1] ?? null;
}

/**
 * preHandler: requires a valid staff session. A session belongs to one register, so a
 * :registerId in the URL must match it. Pass roles to restrict the route further.
 */
export function requireStaff(sql: Sql, roles?: Role[]) {
  return async (req: FastifyRequest) => {
    const token = bearerToken(req);
    const staff = token ? await lookupSession(sql, token) : null;
    if (!staff) throw new HttpError(401, 'not_logged_in', 'Log in to continue');

    const { registerId } = (req.params ?? {}) as { registerId?: string };
    if (registerId !== undefined && registerId !== staff.registerId) {
      throw new HttpError(403, 'wrong_register', 'You are logged in on another register');
    }
    if (roles && !roles.includes(staff.role)) {
      throw new HttpError(403, 'forbidden', 'Only a manager or owner can do this');
    }
    req.staff = staff;
  };
}
