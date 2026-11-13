import type { FastifyInstance } from 'fastify';
import { requireTenantAdmin } from '../admin/admin-session';
import type { AppDeps } from '../app';
import { requireStaff } from '../auth/session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { registerParams, uuid } from '../http-schemas';
import { appendJournalEvent } from '../sales/sequences';
import { exportJournal } from './export';

const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

/** The journal memory: what the till adds to it, and the XML export for Skatteverket. */
export function journalRoutes(app: FastifyInstance, deps: AppDeps) {
  // Switching between training and normal mode is journaled (33–34 kap. SKVFS 2021:16).
  app.post<{ Params: { registerId: string }; Body: { on: boolean } }>(
    '/registers/:registerId/training-mode',
    {
      preHandler: requireStaff(deps.sql),
      schema: {
        params: registerParams,
        body: {
          type: 'object',
          required: ['on'],
          additionalProperties: false,
          properties: { on: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      const staff = req.staff!;
      await withTenant(deps.sql, staff.tenantId, (tx) =>
        appendJournalEvent(tx, staff.tenantId, staff.registerId, 'training_mode', new Date(), {
          on: req.body.on,
          userId: staff.userId,
          displayName: staff.displayName,
        }),
      );
      return reply.status(204).send();
    },
  );

  app.get<{
    Params: { tenantId: string };
    Querystring: { restaurantId: string; registerIds?: string; from: string; to: string };
  }>(
    '/admin/tenants/:tenantId/journal-export',
    {
      preHandler: requireTenantAdmin(deps.sql),
      schema: {
        params: { type: 'object', required: ['tenantId'], properties: { tenantId: uuid } },
        querystring: {
          type: 'object',
          required: ['restaurantId', 'from', 'to'],
          additionalProperties: false,
          properties: {
            restaurantId: uuid,
            // Comma-separated register ids; all of the restaurant's registers when left out.
            registerIds: { type: 'string', maxLength: 2000 },
            from: day,
            to: day,
          },
        },
      },
    },
    async (req, reply) => {
      const registerIds = req.query.registerIds?.split(',').filter(Boolean);
      if (registerIds?.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
        throw new HttpError(400, 'invalid_request', 'registerIds must be register ids');
      }
      const { xml, fileName } = await exportJournal(deps.sql, req.adminTenant!, {
        restaurantId: req.query.restaurantId,
        ...(registerIds && registerIds.length > 0 && { registerIds }),
        from: req.query.from,
        to: req.query.to,
      });
      return reply
        .header('content-type', 'application/xml; charset=utf-8')
        .header('content-disposition', `attachment; filename="${fileName}"`)
        .send(xml);
    },
  );
}
