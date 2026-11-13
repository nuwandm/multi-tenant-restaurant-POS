import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { uuid } from '../http-schemas';
import { appendJournalEvent } from '../sales/sequences';
import { hashPairingCode, requireDevice } from './device';
import { verifyPin } from './pin';
import {
  bearerToken,
  endSession,
  hashToken,
  lookupSession,
  newSessionToken,
  requireStaff,
  SESSION_HOURS,
  type Role,
} from './session';

export const MAX_PIN_ATTEMPTS = 5;
export const LOCK_MINUTES = 5;

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

/** Till-side routes: pairing a device, the login screen, and staff PIN login. */
export function authRoutes(app: FastifyInstance, deps: AppDeps) {
  const device = requireDevice(deps.sql);

  // The till enters the code shown in the back office. The device token it gets back is the
  // till's identity from then on; it is shown once and only its hash is stored.
  app.post<{ Body: { code: string; name: string } }>(
    '/devices/pair',
    {
      schema: {
        body: {
          type: 'object',
          required: ['code', 'name'],
          additionalProperties: false,
          properties: {
            code: { type: 'string', minLength: 8, maxLength: 12 },
            name: { type: 'string', minLength: 1, maxLength: 60 },
          },
        },
      },
    },
    async (req, reply) => {
      const deviceToken = randomBytes(32).toString('base64url');
      const rows = await deps.sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE pos_app`;
        return tx<{ device_id: string; register_id: string }[]>`
          SELECT * FROM app_claim_pairing_code(
            ${hashPairingCode(req.body.code)}, ${hashToken(deviceToken)}, ${req.body.name.trim()})`;
      });
      if (!rows[0]) {
        throw new HttpError(400, 'invalid_pairing_code', 'The code is wrong, used or expired');
      }
      return reply
        .status(201)
        .send({ deviceToken, deviceId: rows[0].device_id, registerId: rows[0].register_id });
    },
  );

  // What the login screen shows: the register, the company and who can log in. No PINs.
  app.get('/device', { preHandler: device }, async (req) => {
    const { tenantId, registerId, deviceId } = req.device!;
    return withTenant(deps.sql, tenantId, async (tx) => {
      const [register] = await tx<
        {
          designation: string;
          status: string;
          restaurant_name: string;
          legal_name: string;
          company_status: string;
          device_name: string;
        }[]
      >`
        SELECT r.designation, r.status, s.name AS restaurant_name, t.legal_name,
               t.status AS company_status, d.name AS device_name
        FROM cash_registers r
        JOIN restaurants s ON s.id = r.restaurant_id
        JOIN tenants t ON t.id = r.tenant_id
        JOIN devices d ON d.id = ${deviceId}
        WHERE r.id = ${registerId}`;
      if (!register) throw new HttpError(404, 'register_not_found', 'Register not found');

      const staff = await tx<{ user_id: string; display_name: string; role: Role }[]>`
        SELECT m.user_id, u.display_name, m.role
        FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.active AND m.pin_hash IS NOT NULL
        ORDER BY u.display_name`;
      return {
        device: { id: deviceId, name: register.device_name },
        register: { id: registerId, designation: register.designation, status: register.status },
        restaurant: { name: register.restaurant_name },
        company: { legalName: register.legal_name, status: register.company_status },
        staff: staff.map((s) => ({ userId: s.user_id, displayName: s.display_name, role: s.role })),
      };
    });
  });

  app.post<{ Body: { userId: string; pin: string } }>(
    '/auth/login',
    {
      preHandler: device,
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'pin'],
          additionalProperties: false,
          properties: { userId: uuid, pin: { type: 'string', pattern: '^[0-9]{4,8}$' } },
        },
      },
    },
    async (req) => {
      const { userId, pin } = req.body;
      const { tenantId, registerId, deviceId } = req.device!;
      // Failed attempts must be committed, so errors are returned from the transaction, not thrown.
      const result = await withTenant(deps.sql, tenantId, async (tx): Promise<LoginResult> => {
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
        await tx`UPDATE devices SET last_seen_at = now() WHERE id = ${deviceId}`;
        const { token, tokenHash } = newSessionToken();
        const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
        await tx`
          SELECT app_create_session(${tokenHash}, ${userId}, ${registerId}, ${member.role},
                                    ${expiresAt}, ${deviceId})`;
        // Logins are part of the register's journal (30 kap. SKVFS 2021:16).
        await appendJournalEvent(tx, tenantId, registerId, 'login', new Date(), {
          userId,
          displayName: member.display_name,
        });
        return { ok: true, token, expiresAt, role: member.role, displayName: member.display_name };
      });

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
    };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = bearerToken(req);
    const staff = token ? await lookupSession(deps.sql, token) : null;
    if (staff) {
      // Logouts are part of the register's journal too (31 kap. SKVFS 2021:16).
      await withTenant(deps.sql, staff.tenantId, (tx) =>
        appendJournalEvent(tx, staff.tenantId, staff.registerId, 'logout', new Date(), {
          userId: staff.userId,
          displayName: staff.displayName,
        }),
      );
    }
    if (token) await endSession(deps.sql, token);
    return reply.status(204).send();
  });
}
