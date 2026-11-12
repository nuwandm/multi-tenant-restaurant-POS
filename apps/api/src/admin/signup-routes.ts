import { randomUUID } from 'node:crypto';
import { parseOrgNumber } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import type { TransactionSql } from 'postgres';
import type { AppDeps } from '../app';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/pin';
import { newSessionToken } from '../auth/session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { ADMIN_SESSION_HOURS, requireAdmin } from './admin-session';

interface SignupBody {
  ownerName: string;
  email: string;
  password: string;
  legalName: string;
  orgNumber: string;
  restaurantName: string;
  restaurantAddress?: string;
}

const text = (max: number) => ({ type: 'string', minLength: 1, maxLength: max }) as const;

/**
 * An owner registers their company and first restaurant. The company starts 'pending': the owner
 * can set up menu, staff and registers right away, but can't sell until a platform admin approves.
 */
export function signupRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post<{ Body: SignupBody }>(
    '/signup',
    {
      schema: {
        body: {
          type: 'object',
          required: ['ownerName', 'email', 'password', 'legalName', 'orgNumber', 'restaurantName'],
          additionalProperties: false,
          properties: {
            ownerName: text(100),
            email: { type: 'string', format: 'email', maxLength: 200 },
            password: { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: 200 },
            legalName: text(200),
            orgNumber: text(20),
            restaurantName: text(100),
            restaurantAddress: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const orgNumber = checkedOrgNumber(body.orgNumber);
      const passwordHash = await hashPassword(body.password);
      const tenantId = randomUUID();
      const { token, tokenHash } = newSessionToken();

      try {
        await withTenant(deps.sql, tenantId, async (tx) => {
          const [user] = await tx<{ id: string }[]>`
            INSERT INTO users (email, display_name, password_hash)
            VALUES (${body.email.trim()}, ${body.ownerName.trim()}, ${passwordHash})
            RETURNING id`;
          await createCompany(tx, tenantId, user!.id, { ...body, orgNumber });
          await tx`
            INSERT INTO admin_sessions (token_hash, user_id, expires_at)
            VALUES (${tokenHash}, ${user!.id}, ${new Date(Date.now() + ADMIN_SESSION_HOURS * 3_600_000)})`;
        });
      } catch (err) {
        throw conflictError(err);
      }

      return reply.status(201).send({ token, tenantId, status: 'pending' });
    },
  );

  // A logged-in owner registers another company (another org number). Also starts pending.
  app.post<{ Body: Omit<SignupBody, 'ownerName' | 'email' | 'password'> }>(
    '/admin/companies',
    {
      preHandler: requireAdmin(deps.sql),
      schema: {
        body: {
          type: 'object',
          required: ['legalName', 'orgNumber', 'restaurantName'],
          additionalProperties: false,
          properties: {
            legalName: text(200),
            orgNumber: text(20),
            restaurantName: text(100),
            restaurantAddress: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const orgNumber = checkedOrgNumber(req.body.orgNumber);
      const tenantId = randomUUID();
      const userId = req.admin!.userId;
      try {
        await withTenant(deps.sql, tenantId, async (tx) => {
          await createCompany(tx, tenantId, userId, { ...req.body, orgNumber });
        });
      } catch (err) {
        throw conflictError(err);
      }
      return reply.status(201).send({ tenantId, status: 'pending' });
    },
  );
}

function checkedOrgNumber(input: string): string {
  try {
    return parseOrgNumber(input);
  } catch {
    throw new HttpError(400, 'invalid_org_number', 'That is not a valid organisation number');
  }
}

async function createCompany(
  tx: TransactionSql,
  tenantId: string,
  ownerId: string,
  c: { legalName: string; orgNumber: string; restaurantName: string; restaurantAddress?: string },
) {
  await tx`
    INSERT INTO tenants (id, legal_name, org_number, status)
    VALUES (${tenantId}, ${c.legalName.trim()}, ${c.orgNumber}, 'pending')`;
  await tx`
    INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenantId}, ${ownerId}, 'owner')`;
  await tx`
    INSERT INTO restaurants (tenant_id, name, address)
    VALUES (${tenantId}, ${c.restaurantName.trim()}, ${c.restaurantAddress?.trim() || null})`;
  await tx`
    INSERT INTO audit_log (tenant_id, user_id, action, details)
    VALUES (${tenantId}, ${ownerId}, 'company.signup', ${tx.json({ orgNumber: c.orgNumber })})`;
}

function conflictError(err: unknown): unknown {
  const constraint = (err as { constraint_name?: string }).constraint_name;
  if (constraint === 'users_email_key') {
    return new HttpError(409, 'email_taken', 'An account with this email already exists');
  }
  if (constraint === 'tenants_org_number_key') {
    return new HttpError(409, 'org_number_taken', 'This company is already registered');
  }
  return err;
}
