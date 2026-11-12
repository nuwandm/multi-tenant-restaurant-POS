import type { VatRate } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { registerParams, tenantHeaders } from '../http-schemas';

const UNGROUPED = 'Övrigt';

interface RegisterRow {
  designation: string;
  status: 'active' | 'retired';
  restaurant_id: string;
  restaurant_name: string;
  legal_name: string;
  org_number: string;
}

interface ArticleRow {
  id: string;
  name: string;
  price_ore: number;
  vat_rate: VatRate;
  group_name: string | null;
}

export function menuRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get<{ Headers: { 'x-tenant-id': string }; Params: { registerId: string } }>(
    '/registers/:registerId/menu',
    { schema: { headers: tenantHeaders, params: registerParams } },
    async (req) => {
      const { registerId } = req.params;
      return withTenant(deps.sql, req.headers['x-tenant-id'], async (tx) => {
        const [register] = await tx<RegisterRow[]>`
          SELECT r.designation, r.status, r.restaurant_id, s.name AS restaurant_name,
                 t.legal_name, t.org_number
          FROM cash_registers r
          JOIN restaurants s ON s.id = r.restaurant_id
          JOIN tenants t ON t.id = r.tenant_id
          WHERE r.id = ${registerId}`;
        if (!register) throw new HttpError(404, 'register_not_found', 'Register not found');

        const articles = await tx<ArticleRow[]>`
          SELECT a.id, a.name, a.price_ore, a.vat_rate, g.name AS group_name
          FROM articles a LEFT JOIN menu_groups g ON g.id = a.menu_group_id AND g.active
          WHERE a.restaurant_id = ${register.restaurant_id} AND a.active
          ORDER BY g.sort_order NULLS LAST, g.name, a.name`;

        const groups = new Map<
          string,
          { id: string; name: string; priceOre: number; vatRate: VatRate }[]
        >();
        for (const a of articles) {
          const name = a.group_name ?? UNGROUPED;
          if (!groups.has(name)) groups.set(name, []);
          groups
            .get(name)!
            .push({ id: a.id, name: a.name, priceOre: a.price_ore, vatRate: a.vat_rate });
        }

        return {
          register: { id: registerId, designation: register.designation, status: register.status },
          restaurant: { name: register.restaurant_name },
          seller: { legalName: register.legal_name, orgNumber: register.org_number },
          groups: [...groups].map(([name, items]) => ({ name, articles: items })),
        };
      });
    },
  );
}
