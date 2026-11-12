import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { uuid } from '../http-schemas';
import { requireTenantAdmin } from './admin-session';

const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

/**
 * Sales analysis for owners: per day, per hour, per payment method and top items, for a date range
 * in Swedish time. Only real sales and returns count; training, copies and quotes do not.
 */
export function salesReportRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get<{
    Params: { tenantId: string };
    Querystring: { from: string; to: string; restaurantId?: string };
  }>(
    '/admin/tenants/:tenantId/reports/sales',
    {
      preHandler: requireTenantAdmin(deps.sql),
      schema: {
        params: { type: 'object', required: ['tenantId'], properties: { tenantId: uuid } },
        querystring: {
          type: 'object',
          required: ['from', 'to'],
          additionalProperties: false,
          properties: { from: day, to: day, restaurantId: uuid },
        },
      },
    },
    async (req) => {
      const { from, to } = req.query;
      if (from > to)
        throw new HttpError(400, 'invalid_range', 'The start date is after the end date');
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (days > 366) throw new HttpError(400, 'invalid_range', 'Choose at most one year');
      const restaurantId = req.query.restaurantId ?? null;

      return withTenant(deps.sql, req.adminTenant!.tenantId, async (tx) => {
        // The receipts in range, as a reusable filter.
        const scope = tx`
          FROM receipts r
          JOIN cash_registers c ON c.id = r.register_id
          WHERE r.kind IN ('sale', 'return')
            AND r.created_at >= (${from}::date)::timestamp AT TIME ZONE 'Europe/Stockholm'
            AND r.created_at < (${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm'
            AND (${restaurantId}::uuid IS NULL OR c.restaurant_id = ${restaurantId}::uuid)`;

        const [totals] = await tx<
          {
            net_ore: number;
            sales_ore: number;
            returns_ore: number;
            receipts: number;
            returns: number;
          }[]
        >`
          SELECT coalesce(sum(r.total_incl_vat_ore), 0)::int8 AS net_ore,
                 coalesce(sum(r.total_incl_vat_ore) FILTER (WHERE r.kind = 'sale'), 0)::int8 AS sales_ore,
                 coalesce(sum(r.total_incl_vat_ore) FILTER (WHERE r.kind = 'return'), 0)::int8 AS returns_ore,
                 count(*) FILTER (WHERE r.kind = 'sale')::int AS receipts,
                 count(*) FILTER (WHERE r.kind = 'return')::int AS returns
          ${scope}`;

        const perDay = await tx<{ day: string; net_ore: number; receipts: number }[]>`
          SELECT to_char(g.day, 'YYYY-MM-DD') AS day,
                 coalesce(sum(x.total), 0)::int8 AS net_ore,
                 count(x.total) FILTER (WHERE x.kind = 'sale')::int AS receipts
          FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS g(day)
          LEFT JOIN (
            SELECT (r.created_at AT TIME ZONE 'Europe/Stockholm')::date AS day,
                   r.total_incl_vat_ore AS total, r.kind
            ${scope}
          ) x ON x.day = g.day::date
          GROUP BY g.day ORDER BY g.day`;

        const perHour = await tx<{ hour: number; net_ore: number; receipts: number }[]>`
          SELECT extract(hour FROM r.created_at AT TIME ZONE 'Europe/Stockholm')::int AS hour,
                 sum(r.total_incl_vat_ore)::int8 AS net_ore,
                 count(*) FILTER (WHERE r.kind = 'sale')::int AS receipts
          ${scope}
          GROUP BY 1 ORDER BY 1`;

        const perPayment = await tx<{ method: string; amount_ore: number }[]>`
          SELECT p.method, sum(p.amount_ore)::int8 AS amount_ore
          FROM payments p
          WHERE p.receipt_id IN (SELECT r.id ${scope})
          GROUP BY p.method ORDER BY 2 DESC`;

        const topItems = await tx<{ name: string; quantity: number; net_ore: number }[]>`
          SELECT l.article_name AS name, sum(l.quantity)::int AS quantity,
                 sum(l.line_total_ore)::int8 AS net_ore
          FROM receipt_lines l
          WHERE l.receipt_id IN (SELECT r.id ${scope})
          GROUP BY l.article_name
          HAVING sum(l.quantity) > 0
          ORDER BY 3 DESC LIMIT 10`;

        const perVat = await tx<{ vat_rate: number; net_ore: number; vat_ore: number }[]>`
          SELECT v.vat_rate, sum(v.net_ore)::int8 AS net_ore, sum(v.vat_ore)::int8 AS vat_ore
          FROM receipt_vat_totals v
          WHERE v.receipt_id IN (SELECT r.id ${scope})
          GROUP BY v.vat_rate ORDER BY v.vat_rate DESC`;

        return {
          from,
          to,
          totals: {
            netOre: totals!.net_ore,
            salesOre: totals!.sales_ore,
            returnsOre: totals!.returns_ore,
            receipts: totals!.receipts,
            returns: totals!.returns,
            averageOre: totals!.receipts > 0 ? Math.round(totals!.sales_ore / totals!.receipts) : 0,
          },
          days: perDay.map((d) => ({ day: d.day, netOre: d.net_ore, receipts: d.receipts })),
          hours: perHour.map((h) => ({ hour: h.hour, netOre: h.net_ore, receipts: h.receipts })),
          payments: perPayment.map((p) => ({ method: p.method, amountOre: p.amount_ore })),
          topItems: topItems.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            netOre: i.net_ore,
          })),
          vat: perVat.map((v) => ({ vatRate: v.vat_rate, netOre: v.net_ore, vatOre: v.vat_ore })),
        };
      });
    },
  );
}
