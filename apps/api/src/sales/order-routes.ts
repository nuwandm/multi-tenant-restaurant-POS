import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { requireStaff } from '../auth/session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { registerParams, uuid } from '../http-schemas';
import {
  cancelOpenOrder,
  createOpenOrder,
  listOpenOrders,
  sendOpenOrder,
  updateOpenOrder,
} from './open-orders';
import type { LineRequest } from './pricing';

const integer = { type: 'integer' } as const;

const lines = {
  type: 'array',
  maxItems: 200,
  items: {
    type: 'object',
    required: ['articleId', 'quantity'],
    additionalProperties: false,
    properties: {
      articleId: uuid,
      quantity: { ...integer, minimum: 1, maximum: 999 },
      discountOre: { ...integer, minimum: 0 },
      optionIds: { type: 'array', maxItems: 20, items: uuid },
    },
  },
} as const;

const orderParams = {
  type: 'object',
  required: ['registerId', 'orderId'],
  properties: { registerId: uuid, orderId: uuid },
} as const;

type RegisterRequest = { Params: { registerId: string } };
type OrderRequest = { Params: { registerId: string; orderId: string } };

/** Tables, open orders and the kitchen display, all for the register's own restaurant. */
export function orderRoutes(app: FastifyInstance, deps: AppDeps) {
  const staff = requireStaff(deps.sql);

  app.get<RegisterRequest>(
    '/registers/:registerId/open-orders',
    { schema: { params: registerParams }, preHandler: staff },
    async (req) => listOpenOrders(deps.sql, req.staff!),
  );

  app.post<
    RegisterRequest & {
      Body: { tableId: string | null; lines: LineRequest[]; orderDiscountOre?: number };
    }
  >(
    '/registers/:registerId/open-orders',
    {
      preHandler: staff,
      schema: {
        params: registerParams,
        body: {
          type: 'object',
          required: ['tableId', 'lines'],
          additionalProperties: false,
          properties: {
            tableId: { anyOf: [uuid, { type: 'null' }] },
            lines,
            orderDiscountOre: { ...integer, minimum: 0 },
          },
        },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await createOpenOrder(deps.sql, req.staff!, req.body)),
  );

  app.put<
    OrderRequest & { Body: { lines: LineRequest[]; orderDiscountOre?: number; version: number } }
  >(
    '/registers/:registerId/open-orders/:orderId',
    {
      preHandler: staff,
      schema: {
        params: orderParams,
        body: {
          type: 'object',
          required: ['lines', 'version'],
          additionalProperties: false,
          properties: { lines, orderDiscountOre: { ...integer, minimum: 0 }, version: integer },
        },
      },
    },
    async (req) => updateOpenOrder(deps.sql, req.staff!, req.params.orderId, req.body),
  );

  app.post<OrderRequest>(
    '/registers/:registerId/open-orders/:orderId/send',
    { schema: { params: orderParams }, preHandler: staff },
    async (req) => sendOpenOrder(deps.sql, req.staff!, req.params.orderId),
  );

  app.post<OrderRequest>(
    '/registers/:registerId/open-orders/:orderId/cancel',
    { schema: { params: orderParams }, preHandler: staff },
    async (req, reply) => {
      await cancelOpenOrder(deps.sql, req.staff!, req.params.orderId);
      return reply.status(204).send();
    },
  );

  // Kitchen display: open tickets for a station, plus the last ones finished (to undo a tap).
  app.get<RegisterRequest & { Querystring: { station?: 'kitchen' | 'bar' } }>(
    '/registers/:registerId/kitchen-tickets',
    {
      preHandler: staff,
      schema: {
        params: registerParams,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { station: { enum: ['kitchen', 'bar'] } },
        },
      },
    },
    async (req) =>
      withTenant(deps.sql, req.staff!.tenantId, async (tx) => {
        const station = req.query.station ?? null;
        const rows = await tx<
          {
            id: string;
            station: string;
            ticket_no: number;
            label: string;
            training: boolean;
            created_at: Date;
            done_at: Date | null;
            lines: { name: string; options: string | null; quantity: number }[];
            created_by_name: string;
          }[]
        >`
          SELECT k.id, k.station, k.ticket_no, k.label, k.training, k.created_at, k.done_at, k.lines,
                 u.display_name AS created_by_name
          FROM kitchen_tickets k
          JOIN cash_registers c ON c.restaurant_id = k.restaurant_id AND c.id = ${req.staff!.registerId}
          JOIN users u ON u.id = k.created_by
          WHERE (${station}::text IS NULL OR k.station = ${station}::text)
            AND (k.done_at IS NULL OR k.done_at > now() - interval '10 minutes')
          ORDER BY k.done_at IS NOT NULL, k.created_at`;
        return rows.map((r) => ({
          id: r.id,
          station: r.station,
          ticketNo: r.ticket_no,
          label: r.label,
          training: r.training,
          createdAt: r.created_at,
          doneAt: r.done_at,
          lines: r.lines,
          createdBy: r.created_by_name,
        }));
      }),
  );

  app.post<{ Params: { registerId: string; ticketId: string }; Body: { done: boolean } }>(
    '/registers/:registerId/kitchen-tickets/:ticketId',
    {
      preHandler: staff,
      schema: {
        params: {
          type: 'object',
          required: ['registerId', 'ticketId'],
          properties: { registerId: uuid, ticketId: uuid },
        },
        body: {
          type: 'object',
          required: ['done'],
          additionalProperties: false,
          properties: { done: { type: 'boolean' } },
        },
      },
    },
    async (req) =>
      withTenant(deps.sql, req.staff!.tenantId, async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          UPDATE kitchen_tickets k SET done_at = ${req.body.done ? new Date() : null}
          FROM cash_registers c
          WHERE k.id = ${req.params.ticketId} AND c.id = ${req.staff!.registerId}
            AND c.restaurant_id = k.restaurant_id
          RETURNING k.id`;
        if (!row) throw new HttpError(404, 'ticket_not_found', 'Ticket not found');
        return { id: row.id, done: req.body.done };
      }),
  );
}
