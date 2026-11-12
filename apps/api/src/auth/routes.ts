import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { registerParams, tenantHeaders, uuid } from '../http-schemas';
import { verifyPin } from './pin';
import {
  bearerToken,
  endSession,
  newSessionToken,
  requireStaff,
  SESSION_HOURS,
  type Role,
} from './session';

export const MAX_PIN_ATTEMPTS = 5;
export const LOCK_MINUTES = 5;

interface LoginBody {
  registerId: string;
  userId: string;
  pin: string;
}

interface MemberRow {
  role: Role;
  pin_hash: string | null;
  active: boolean;
  failed_pin_attempts: number;
  locked_until: Date | null;
  display_name: string;
}

type LoginResult =
  | { ok: true; token: string; expiresAt: Date; role: Role; displayName: string }
  | { ok: false; error: HttpError };

export function authRoutes(app: FastifyInstance, deps: AppDeps) {
  // What the login screen shows: the register and who can log in on it. No PINs.
  app.get<{ Headers: { 'x-tenant-id': string }; Params: { registerId: string } }>(
    '/registers/:registerId/login-info',
    { schema: { headers: tenantHeaders, params: registerParams } },
    async (req) =>
      withTenant(deps.sql, req.headers['x-tenant-id'], async (tx) => {
        const [register] = await tx<
          { designation: string; status: string; restaurant_name: string }[]
        >`
          SELECT r.designation, r.status, s.name AS restaurant_name
          FROM cash_registers r JOIN restaurants s ON s.id = r.restaurant_id
          WHERE r.id = ${req.params.registerId}`;
        if (!register) throw new HttpError(404, 'register_not_found', 'Register not found');

        const staff = await tx<{ user_id: string; display_name: string; role: Role }[]>`
          SELECT m.user_id, u.display_name, m.role
          FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.active AND m.pin_hash IS NOT NULL
          ORDER BY u.display_name`;
        return {
          register: {
            id: req.params.registerId,
            designation: register.designation,
            status: register.status,
          },
          restaurant: { name: register.restaurant_name },
          staff: staff.map((s) => ({
            userId: s.user_id,
            displayName: s.display_name,
            role: s.role,
          })),
        };
      }),
  );

  app.post<{ Headers: { 'x-tenant-id': string }; Body: LoginBody }>(
    '/auth/login',
    {
      schema: {
        headers: tenantHeaders,
        body: {
          type: 'object',
          required: ['registerId', 'userId', 'pin'],
          additionalProperties: false,
          properties: {
            registerId: uuid,
            userId: uuid,
            pin: { type: 'string', pattern: '^[0-9]{4,8}$' },
          },
        },
      },
    },
    async (req) => {
      const { registerId, userId, pin } = req.body;
      // Failed attempts must be committed, so errors are returned from the transaction, not thrown.
      const result = await withTenant(
        deps.sql,
        req.headers['x-tenant-id'],
        async (tx): Promise<LoginResult> => {
          const [register] = await tx<{ status: string }[]>`
          SELECT status FROM cash_registers WHERE id = ${registerId}`;
          if (!register) {
            return {
              ok: false,
              error: new HttpError(404, 'register_not_found', 'Register not found'),
            };
          }

          const [member] = await tx<MemberRow[]>`
          SELECT m.role, m.pin_hash, m.active, m.failed_pin_attempts, m.locked_until, u.display_name
          FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.user_id = ${userId}
          FOR UPDATE OF m`;
          const invalid = {
            ok: false,
            error: new HttpError(401, 'invalid_pin', 'Wrong PIN'),
          } as const;
          if (!member || !member.active || !member.pin_hash) return invalid;

          if (member.locked_until && member.locked_until > new Date()) {
            return {
              ok: false,
              error: new HttpError(
                423,
                'pin_locked',
                `Too many wrong PINs. Try again after ${LOCK_MINUTES} minutes.`,
              ),
            };
          }

          if (!(await verifyPin(pin, member.pin_hash))) {
            const attempts = member.failed_pin_attempts + 1;
            const lock = attempts >= MAX_PIN_ATTEMPTS;
            await tx`
            UPDATE memberships
            SET failed_pin_attempts = ${lock ? 0 : attempts},
                locked_until = ${lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null}
            WHERE user_id = ${userId}`;
            return invalid;
          }

          await tx`
          UPDATE memberships SET failed_pin_attempts = 0, locked_until = NULL WHERE user_id = ${userId}`;
          const { token, tokenHash } = newSessionToken();
          const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
          await tx`SELECT app_create_session(${tokenHash}, ${userId}, ${registerId}, ${member.role}, ${expiresAt})`;
          return {
            ok: true,
            token,
            expiresAt,
            role: member.role,
            displayName: member.display_name,
          };
        },
      );

      if (!result.ok) throw result.error;
      return {
        token: result.token,
        expiresAt: result.expiresAt,
        staff: { userId, displayName: result.displayName, role: result.role },
        registerId,
      };
    },
  );

  app.get('/auth/session', { preHandler: requireStaff(deps.sql) }, async (req) => {
    const staff = req.staff!;
    return {
      expiresAt: staff.expiresAt,
      staff: { userId: staff.userId, displayName: staff.displayName, role: staff.role },
      registerId: staff.registerId,
      tenantId: staff.tenantId,
    };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = bearerToken(req);
    if (token) await endSession(deps.sql, token);
    return reply.status(204).send();
  });
}
