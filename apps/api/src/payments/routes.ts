import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { requireStaff } from '../auth/session';
import { registerParams, uuid } from '../http-schemas';
import {
  cancelSwishPayment,
  getSwishPayment,
  onSwishCallback,
  simulateSwishPayment,
  startSwishPayment,
} from './swish-payments';

const paymentParams = {
  type: 'object',
  required: ['registerId', 'paymentId'],
  properties: { registerId: uuid, paymentId: uuid },
} as const;

type PaymentRequest = { Params: { registerId: string; paymentId: string } };

/** Swish at the till: start a payment request, wait for it, cancel it. */
export function swishRoutes(app: FastifyInstance, deps: AppDeps) {
  const staff = requireStaff(deps.sql);

  app.post<{ Params: { registerId: string }; Body: { amountOre: number } }>(
    '/registers/:registerId/swish-payments',
    {
      preHandler: staff,
      schema: {
        params: registerParams,
        body: {
          type: 'object',
          required: ['amountOre'],
          additionalProperties: false,
          properties: { amountOre: { type: 'integer', minimum: 100, maximum: 100_000_000 } },
        },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await startSwishPayment(deps, req.staff!, req.body.amountOre)),
  );

  app.get<PaymentRequest>(
    '/registers/:registerId/swish-payments/:paymentId',
    { preHandler: staff, schema: { params: paymentParams } },
    async (req) => getSwishPayment(deps, req.staff!, req.params.paymentId),
  );

  app.post<PaymentRequest>(
    '/registers/:registerId/swish-payments/:paymentId/cancel',
    { preHandler: staff, schema: { params: paymentParams } },
    async (req) => cancelSwishPayment(deps, req.staff!, req.params.paymentId),
  );

  app.post<PaymentRequest & { Body: { outcome: 'paid' | 'declined' } }>(
    '/registers/:registerId/swish-payments/:paymentId/simulate',
    {
      preHandler: staff,
      schema: {
        params: paymentParams,
        body: {
          type: 'object',
          required: ['outcome'],
          additionalProperties: false,
          properties: { outcome: { enum: ['paid', 'declined'] } },
        },
      },
    },
    async (req) => simulateSwishPayment(deps, req.staff!, req.params.paymentId, req.body.outcome),
  );

  // Called by Swish, not by a till. Always answers 200 so Swish doesn't retry; see onSwishCallback.
  app.post<{ Params: { tenantId: string; paymentId: string } }>(
    '/swish/callback/:tenantId/:paymentId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['tenantId', 'paymentId'],
          properties: { tenantId: uuid, paymentId: uuid },
        },
      },
    },
    async (req, reply) => {
      await onSwishCallback(deps, req.params.tenantId, req.params.paymentId);
      return reply.status(200).send({ ok: true });
    },
  );
}
