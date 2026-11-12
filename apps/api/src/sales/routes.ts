import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { registerParams, tenantHeaders, uuid } from '../http-schemas';
import { createReceipt, type CreateReceiptRequest } from './create-receipt';

const integer = { type: 'integer' } as const;

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
      payments: {
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
      },
    },
  },
} as const;

export function salesRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post<{
    Headers: { 'x-tenant-id': string };
    Params: { registerId: string };
    Body: CreateReceiptRequest;
  }>('/registers/:registerId/receipts', { schema: createReceiptSchema }, async (req, reply) => {
    const receipt = await createReceipt(
      deps,
      req.headers['x-tenant-id'],
      req.params.registerId,
      req.body,
    );
    return reply.status(201).send(receipt);
  });
}
