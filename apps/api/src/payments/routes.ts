import type { FastifyInstance } from 'fastify';
import { audit, requireTenantAdmin } from '../admin/admin-session';
import type { AppDeps } from '../app';
import { requireStaff } from '../auth/session';
import { withTenant } from '../db/tenant';
import { registerParams, uuid } from '../http-schemas';
import {
  cancelSwishPayment,
  getSwishPayment,
  listUnusedSwishForCompany,
  listUnusedSwishPayments,
  onSwishCallback,
  refundUnusedSwishPayment,
  simulateSwishPayment,
  startSwishPayment,
  startSwishRefund,
} from './swish-payments';

const paymentParams = {
  type: 'object',
  required: ['registerId', 'paymentId'],
  properties: { registerId: uuid, paymentId: uuid },
} as const;

type PaymentRequest = { Params: { registerId: string; paymentId: string } };

/** Swish at the till: start a payment request, wait for it, cancel it; refunds for returns. */
export function swishRoutes(app: FastifyInstance, deps: AppDeps) {
  const staff = requireStaff(deps.sql);
  const managers = requireStaff(deps.sql, ['owner', 'manager']);

  // Paid money no receipt has used yet, so a till that was reloaded can still use it.
  app.get<{ Params: { registerId: string } }>(
    '/registers/:registerId/swish-payments/unused',
    { preHandler: staff, schema: { params: registerParams } },
    async (req) => listUnusedSwishPayments(deps, req.staff!),
  );

  // Refunds move money out, so like returns only managers and owners can make them.
  app.post<{
    Params: { registerId: string };
    Body: { originalReceiptId: string; amountOre: number };
  }>(
    '/registers/:registerId/swish-refunds',
    {
      preHandler: managers,
      schema: {
        params: registerParams,
        body: {
          type: 'object',
          required: ['originalReceiptId', 'amountOre'],
          additionalProperties: false,
          properties: {
            originalReceiptId: uuid,
            amountOre: { type: 'integer', minimum: 1, maximum: 100_000_000 },
          },
        },
      },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send(
          await startSwishRefund(deps, req.staff!, req.body.originalReceiptId, req.body.amountOre),
        ),
  );

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

  // Back office: Swish money without a receipt, and giving it back.
  const admin = requireTenantAdmin(deps.sql);
  app.get<{ Params: { tenantId: string } }>(
    '/admin/tenants/:tenantId/swish-payments/unused',
    {
      preHandler: admin,
      schema: {
        params: { type: 'object', required: ['tenantId'], properties: { tenantId: uuid } },
      },
    },
    async (req) => listUnusedSwishForCompany(deps, req.adminTenant!.tenantId),
  );

  app.post<{ Params: { tenantId: string; paymentId: string } }>(
    '/admin/tenants/:tenantId/swish-payments/:paymentId/refund',
    {
      preHandler: admin,
      schema: {
        params: {
          type: 'object',
          required: ['tenantId', 'paymentId'],
          properties: { tenantId: uuid, paymentId: uuid },
        },
      },
    },
    async (req, reply) => {
      const ctx = req.adminTenant!;
      const refund = await refundUnusedSwishPayment(
        deps,
        ctx.tenantId,
        ctx.userId,
        req.params.paymentId,
      );
      await withTenant(deps.sql, ctx.tenantId, (tx) =>
        audit(tx, ctx, 'swish.refund', req.params.paymentId, { amountOre: refund.amountOre }),
      );
      return reply.status(201).send(refund);
    },
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
