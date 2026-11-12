import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app';
import { requireStaff } from '../auth/session';
import { HttpError } from '../errors';
import { registerParams, uuid } from '../http-schemas';
import {
  createCopy,
  createReceipt,
  createReturn,
  listReceipts,
  type CreateReceiptRequest,
  type CreateReturnRequest,
} from './create-receipt';

const integer = { type: 'integer' } as const;

const payments = {
  type: 'array',
  maxItems: 10,
  items: {
    type: 'object',
    required: ['method', 'amountOre'],
    additionalProperties: false,
    properties: {
      method: { enum: ['cash', 'card', 'swish', 'gift_card'] },
      amountOre: integer,
    },
  },
} as const;

const createReceiptSchema = {
  params: registerParams,
  body: {
    type: 'object',
    required: ['kind', 'lines', 'payments'],
    additionalProperties: false,
    properties: {
      kind: { enum: ['sale', 'training', 'proforma'] },
      lines: {
        type: 'array',
        minItems: 1,
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
      },
      payments,
      orderDiscountOre: { ...integer, minimum: 0 },
      openOrderId: uuid,
    },
  },
} as const;

const createReturnSchema = {
  params: registerParams,
  body: {
    type: 'object',
    required: ['originalReceiptId', 'lines', 'payments'],
    additionalProperties: false,
    properties: {
      originalReceiptId: uuid,
      lines: {
        type: 'array',
        minItems: 1,
        maxItems: 200,
        items: {
          type: 'object',
          required: ['lineNo', 'quantity'],
          additionalProperties: false,
          properties: {
            lineNo: { ...integer, minimum: 1 },
            quantity: { ...integer, minimum: 1, maximum: 999 },
          },
        },
      },
      payments,
    },
  },
} as const;

const createCopySchema = {
  params: registerParams,
  body: {
    type: 'object',
    required: ['originalReceiptId'],
    additionalProperties: false,
    properties: { originalReceiptId: uuid },
  },
} as const;

const listReceiptsSchema = {
  params: registerParams,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { limit: { ...integer, minimum: 1, maximum: 100, default: 30 } },
  },
} as const;

type RegisterRequest = { Params: { registerId: string } };

/** The till's key for one payment attempt; a retry with the same key gets the same receipt. */
function idempotencyKey(req: FastifyRequest): string | null {
  const key = req.headers['idempotency-key'];
  if (key === undefined) return null;
  if (typeof key !== 'string' || !/^[\w-]{8,100}$/.test(key)) {
    throw new HttpError(
      400,
      'invalid_idempotency_key',
      'Idempotency-Key must be 8–100 letters, digits, - or _',
    );
  }
  return key;
}

export function salesRoutes(app: FastifyInstance, deps: AppDeps) {
  const anyStaff = requireStaff(deps.sql);
  const managers = requireStaff(deps.sql, ['owner', 'manager']);

  app.post<RegisterRequest & { Body: CreateReceiptRequest }>(
    '/registers/:registerId/receipts',
    { schema: createReceiptSchema, preHandler: anyStaff },
    async (req, reply) =>
      reply.status(201).send(await createReceipt(deps, req.staff!, req.body, idempotencyKey(req))),
  );

  app.get<RegisterRequest & { Querystring: { limit: number } }>(
    '/registers/:registerId/receipts',
    { schema: listReceiptsSchema, preHandler: anyStaff },
    async (req) => listReceipts(deps, req.staff!, req.query.limit),
  );

  // Refunds move money out of the drawer, so only managers and owners can make them.
  app.post<RegisterRequest & { Body: CreateReturnRequest }>(
    '/registers/:registerId/returns',
    { schema: createReturnSchema, preHandler: managers },
    async (req, reply) =>
      reply.status(201).send(await createReturn(deps, req.staff!, req.body, idempotencyKey(req))),
  );

  app.post<RegisterRequest & { Body: { originalReceiptId: string } }>(
    '/registers/:registerId/copies',
    { schema: createCopySchema, preHandler: anyStaff },
    async (req, reply) =>
      reply
        .status(201)
        .send(await createCopy(deps, req.staff!, req.body.originalReceiptId, idempotencyKey(req))),
  );
}
