import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { registerParams, tenantHeaders, uuid } from '../http-schemas';
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
  headers: tenantHeaders,
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
          },
        },
      },
      payments,
    },
  },
} as const;

const createReturnSchema = {
  headers: tenantHeaders,
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
  headers: tenantHeaders,
  params: registerParams,
  body: {
    type: 'object',
    required: ['originalReceiptId'],
    additionalProperties: false,
    properties: { originalReceiptId: uuid },
  },
} as const;

const listReceiptsSchema = {
  headers: tenantHeaders,
  params: registerParams,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { limit: { ...integer, minimum: 1, maximum: 100, default: 30 } },
  },
} as const;

type RegisterRequest = { Headers: { 'x-tenant-id': string }; Params: { registerId: string } };

export function salesRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post<RegisterRequest & { Body: CreateReceiptRequest }>(
    '/registers/:registerId/receipts',
    { schema: createReceiptSchema },
    async (req, reply) => {
      const receipt = await createReceipt(
        deps,
        req.headers['x-tenant-id'],
        req.params.registerId,
        req.body,
      );
      return reply.status(201).send(receipt);
    },
  );

  app.get<RegisterRequest & { Querystring: { limit: number } }>(
    '/registers/:registerId/receipts',
    { schema: listReceiptsSchema },
    async (req) =>
      listReceipts(deps, req.headers['x-tenant-id'], req.params.registerId, req.query.limit),
  );

  app.post<RegisterRequest & { Body: CreateReturnRequest }>(
    '/registers/:registerId/returns',
    { schema: createReturnSchema },
    async (req, reply) => {
      const receipt = await createReturn(
        deps,
        req.headers['x-tenant-id'],
        req.params.registerId,
        req.body,
      );
      return reply.status(201).send(receipt);
    },
  );

  app.post<RegisterRequest & { Body: { originalReceiptId: string } }>(
    '/registers/:registerId/copies',
    { schema: createCopySchema },
    async (req, reply) => {
      const receipt = await createCopy(
        deps,
        req.headers['x-tenant-id'],
        req.params.registerId,
        req.body.originalReceiptId,
      );
      return reply.status(201).send(receipt);
    },
  );
}
