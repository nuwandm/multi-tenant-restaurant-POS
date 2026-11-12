import type { VatRate } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { requireStaff } from '../auth/session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { registerParams } from '../http-schemas';

// Items without a group come last under a group with no name; the till labels it.
const UNGROUPED = '';

interface RegisterRow {
  designation: string;
  status: 'active' | 'retired';
  restaurant_id: string;
  restaurant_name: string;
  swish: boolean;
  legal_name: string;
  org_number: string;
}

interface ArticleRow {
  id: string;
  name: string;
  price_ore: number;
  vat_rate: VatRate;
  station: 'kitchen' | 'bar' | null;
  group_name: string | null;
}

interface OptionGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { id: string; name: string; priceDeltaOre: number }[];
}

type TillArticle = {
  id: string;
  name: string;
  priceOre: number;
  vatRate: VatRate;
  station: 'kitchen' | 'bar' | null;
  optionGroups: OptionGroup[];
};

export function menuRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get<{ Params: { registerId: string } }>(
    '/registers/:registerId/menu',
    { schema: { params: registerParams }, preHandler: requireStaff(deps.sql) },
    async (req) => {
      const { registerId } = req.params;
      return withTenant(deps.sql, req.staff!.tenantId, async (tx) => {
        const [register] = await tx<RegisterRow[]>`
          SELECT r.designation, r.status, r.restaurant_id, s.name AS restaurant_name,
                 s.swish_number IS NOT NULL AS swish,
                 t.legal_name, t.org_number
          FROM cash_registers r
          JOIN restaurants s ON s.id = r.restaurant_id
          JOIN tenants t ON t.id = r.tenant_id
          WHERE r.id = ${registerId}`;
        if (!register) throw new HttpError(404, 'register_not_found', 'Register not found');

        const articles = await tx<ArticleRow[]>`
          SELECT a.id, a.name, a.price_ore, a.vat_rate, a.station, g.name AS group_name
          FROM articles a LEFT JOIN menu_groups g ON g.id = a.menu_group_id AND g.active
          WHERE a.restaurant_id = ${register.restaurant_id} AND a.active
          ORDER BY g.sort_order NULLS LAST, g.name, a.name`;

        // Option groups per item, with their active options, in menu order.
        const links = await tx<
          {
            article_id: string;
            group_id: string;
            name: string;
            min_select: number;
            max_select: number;
          }[]
        >`
          SELECT aog.article_id, g.id AS group_id, g.name, g.min_select, g.max_select
          FROM article_option_groups aog JOIN option_groups g ON g.id = aog.group_id
          WHERE g.restaurant_id = ${register.restaurant_id} AND g.active
          ORDER BY aog.sort_order, g.sort_order, g.name`;
        const options = await tx<
          { id: string; group_id: string; name: string; price_delta_ore: number }[]
        >`
          SELECT o.id, o.group_id, o.name, o.price_delta_ore
          FROM item_options o JOIN option_groups g ON g.id = o.group_id
          WHERE g.restaurant_id = ${register.restaurant_id} AND o.active
          ORDER BY o.sort_order, o.name`;
        const optionGroupsOf = (articleId: string): OptionGroup[] =>
          links
            .filter((l) => l.article_id === articleId)
            .map((l) => ({
              id: l.group_id,
              name: l.name,
              minSelect: l.min_select,
              maxSelect: l.max_select,
              options: options
                .filter((o) => o.group_id === l.group_id)
                .map((o) => ({ id: o.id, name: o.name, priceDeltaOre: o.price_delta_ore })),
            }));

        const groups = new Map<string, TillArticle[]>();
        for (const a of articles) {
          const name = a.group_name ?? UNGROUPED;
          if (!groups.has(name)) groups.set(name, []);
          groups.get(name)!.push({
            id: a.id,
            name: a.name,
            priceOre: a.price_ore,
            vatRate: a.vat_rate,
            station: a.station,
            optionGroups: optionGroupsOf(a.id),
          });
        }

        const tables = await tx<{ id: string; name: string }[]>`
          SELECT id, name FROM dining_tables
          WHERE restaurant_id = ${register.restaurant_id} AND active
          ORDER BY sort_order, name`;

        return {
          register: { id: registerId, designation: register.designation, status: register.status },
          // With Swish set up, Swish payments go through a QR code and Swish's confirmation.
          restaurant: { name: register.restaurant_name, swish: register.swish },
          seller: { legalName: register.legal_name, orgNumber: register.org_number },
          groups: [...groups].map(([name, items]) => ({ name: name || null, articles: items })),
          tables,
        };
      });
    },
  );
}
