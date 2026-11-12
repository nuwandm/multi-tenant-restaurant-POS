import type { FastifyInstance } from 'fastify';
import type { TransactionSql } from 'postgres';
import type { AppDeps } from '../app';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { uuid } from '../http-schemas';
import { audit, requireTenantAdmin } from './admin-session';

const integer = { type: 'integer' } as const;
const name = { type: 'string', minLength: 1, maxLength: 100 } as const;

const params = (...ids: string[]) => ({
  type: 'object',
  required: ['tenantId', ...ids],
  properties: Object.fromEntries(['tenantId', ...ids].map((id) => [id, uuid])),
});

const body = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  required,
  additionalProperties: false,
  minProperties: required.length > 0 ? required.length : 1,
  properties,
});

type P<T extends string> = Record<'tenantId' | T, string>;

async function assertRestaurant(tx: TransactionSql, restaurantId: string) {
  const [row] = await tx`SELECT 1 FROM restaurants WHERE id = ${restaurantId}`;
  if (!row) throw new HttpError(404, 'restaurant_not_found', 'Restaurant not found');
}

/** Item options (sizes, extras) and tables, managed per restaurant. */
export function catalogRoutes(app: FastifyInstance, deps: AppDeps) {
  const preHandler = requireTenantAdmin(deps.sql);
  const base = '/admin/tenants/:tenantId';

  // Option groups with their options, for the menu editor.
  app.get<{ Params: P<'restaurantId'> }>(
    `${base}/restaurants/:restaurantId/option-groups`,
    { preHandler, schema: { params: params('restaurantId') } },
    async (req) =>
      withTenant(deps.sql, req.adminTenant!.tenantId, async (tx) => {
        await assertRestaurant(tx, req.params.restaurantId);
        const groups = await tx<
          {
            id: string;
            name: string;
            min_select: number;
            max_select: number;
            active: boolean;
          }[]
        >`SELECT id, name, min_select, max_select, active FROM option_groups
          WHERE restaurant_id = ${req.params.restaurantId} ORDER BY sort_order, name`;
        const options = await tx<
          { id: string; group_id: string; name: string; price_delta_ore: number; active: boolean }[]
        >`SELECT o.id, o.group_id, o.name, o.price_delta_ore, o.active
          FROM item_options o JOIN option_groups g ON g.id = o.group_id
          WHERE g.restaurant_id = ${req.params.restaurantId} ORDER BY o.sort_order, o.name`;
        return groups.map((g) => ({
          id: g.id,
          name: g.name,
          minSelect: g.min_select,
          maxSelect: g.max_select,
          active: g.active,
          options: options
            .filter((o) => o.group_id === g.id)
            .map((o) => ({
              id: o.id,
              name: o.name,
              priceDeltaOre: o.price_delta_ore,
              active: o.active,
            })),
        }));
      }),
  );

  app.post<{
    Params: P<'restaurantId'>;
    Body: { name: string; minSelect: number; maxSelect: number };
  }>(
    `${base}/restaurants/:restaurantId/option-groups`,
    {
      preHandler,
      schema: {
        params: params('restaurantId'),
        body: body(
          {
            name,
            minSelect: { ...integer, minimum: 0, maximum: 20 },
            maxSelect: { ...integer, minimum: 1, maximum: 20 },
          },
          ['name', 'minSelect', 'maxSelect'],
        ),
      },
    },
    async (req, reply) => {
      const ctx = req.adminTenant!;
      const { minSelect, maxSelect } = req.body;
      if (maxSelect < minSelect) {
        throw new HttpError(400, 'invalid_choice_range', 'Max must be at least min');
      }
      const created = await withTenant(deps.sql, ctx.tenantId, async (tx) => {
        await assertRestaurant(tx, req.params.restaurantId);
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO option_groups (tenant_id, restaurant_id, name, min_select, max_select)
          VALUES (${ctx.tenantId}, ${req.params.restaurantId}, ${req.body.name.trim()}, ${minSelect}, ${maxSelect})
          RETURNING id`;
        await audit(tx, ctx, 'option_group.create', row!.id, req.body);
        return row!;
      });
      return reply.status(201).send(created);
    },
  );

  app.patch<{
    Params: P<'groupId'>;
    Body: { name?: string; minSelect?: number; maxSelect?: number; active?: boolean };
  }>(
    `${base}/option-groups/:groupId`,
    {
      preHandler,
      schema: {
        params: params('groupId'),
        body: body({
          name,
          minSelect: { ...integer, minimum: 0, maximum: 20 },
          maxSelect: { ...integer, minimum: 1, maximum: 20 },
          active: { type: 'boolean' },
        }),
      },
    },
    async (req) => {
      const ctx = req.adminTenant!;
      const b = req.body;
      return withTenant(deps.sql, ctx.tenantId, async (tx) => {
        try {
          const [row] = await tx<{ id: string }[]>`
            UPDATE option_groups SET
              name = coalesce(${b.name?.trim() ?? null}, name),
              min_select = coalesce(${b.minSelect ?? null}::int, min_select),
              max_select = coalesce(${b.maxSelect ?? null}::int, max_select),
              active = coalesce(${b.active ?? null}::boolean, active)
            WHERE id = ${req.params.groupId} RETURNING id`;
          if (!row) throw new HttpError(404, 'group_not_found', 'Option group not found');
        } catch (err) {
          if ((err as { code?: string }).code === '23514') {
            throw new HttpError(400, 'invalid_choice_range', 'Max must be at least min');
          }
          throw err;
        }
        await audit(tx, ctx, 'option_group.update', req.params.groupId, b);
        return { id: req.params.groupId };
      });
    },
  );

  app.post<{ Params: P<'groupId'>; Body: { name: string; priceDeltaOre: number } }>(
    `${base}/option-groups/:groupId/options`,
    {
      preHandler,
      schema: {
        params: params('groupId'),
        body: body(
          { name, priceDeltaOre: { ...integer, minimum: -10_000_000, maximum: 10_000_000 } },
          ['name', 'priceDeltaOre'],
        ),
      },
    },
    async (req, reply) => {
      const ctx = req.adminTenant!;
      const created = await withTenant(deps.sql, ctx.tenantId, async (tx) => {
        const [group] = await tx`SELECT 1 FROM option_groups WHERE id = ${req.params.groupId}`;
        if (!group) throw new HttpError(404, 'group_not_found', 'Option group not found');
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO item_options (tenant_id, group_id, name, price_delta_ore, sort_order)
          VALUES (${ctx.tenantId}, ${req.params.groupId}, ${req.body.name.trim()}, ${req.body.priceDeltaOre},
                  (SELECT count(*) FROM item_options WHERE group_id = ${req.params.groupId}))
          RETURNING id`;
        await audit(tx, ctx, 'option.create', row!.id, req.body);
        return row!;
      });
      return reply.status(201).send(created);
    },
  );

  app.patch<{
    Params: P<'optionId'>;
    Body: { name?: string; priceDeltaOre?: number; active?: boolean };
  }>(
    `${base}/options/:optionId`,
    {
      preHandler,
      schema: {
        params: params('optionId'),
        body: body({
          name,
          priceDeltaOre: { ...integer, minimum: -10_000_000, maximum: 10_000_000 },
          active: { type: 'boolean' },
        }),
      },
    },
    async (req) => {
      const ctx = req.adminTenant!;
      const b = req.body;
      return withTenant(deps.sql, ctx.tenantId, async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          UPDATE item_options SET
            name = coalesce(${b.name?.trim() ?? null}, name),
            price_delta_ore = coalesce(${b.priceDeltaOre ?? null}::bigint, price_delta_ore),
            active = coalesce(${b.active ?? null}::boolean, active)
          WHERE id = ${req.params.optionId} RETURNING id`;
        if (!row) throw new HttpError(404, 'option_not_found', 'Option not found');
        await audit(tx, ctx, 'option.update', row.id, b);
        return { id: row.id };
      });
    },
  );

  // Which option groups an item offers, in order. Replaces the whole list.
  app.put<{ Params: P<'articleId'>; Body: { groupIds: string[] } }>(
    `${base}/articles/:articleId/option-groups`,
    {
      preHandler,
      schema: {
        params: params('articleId'),
        body: body({ groupIds: { type: 'array', maxItems: 20, items: uuid } }, ['groupIds']),
      },
    },
    async (req) => {
      const ctx = req.adminTenant!;
      const groupIds = [...new Set(req.body.groupIds)];
      return withTenant(deps.sql, ctx.tenantId, async (tx) => {
        const [article] = await tx<{ restaurant_id: string }[]>`
          SELECT restaurant_id FROM articles WHERE id = ${req.params.articleId}`;
        if (!article) throw new HttpError(404, 'article_not_found', 'Article not found');
        if (groupIds.length > 0) {
          const [found] = await tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM option_groups
            WHERE id IN ${tx(groupIds)} AND restaurant_id = ${article.restaurant_id}`;
          if (found!.n !== groupIds.length) {
            throw new HttpError(
              400,
              'group_not_in_restaurant',
              'An option group belongs to another restaurant',
            );
          }
        }
        await tx`DELETE FROM article_option_groups WHERE article_id = ${req.params.articleId}`;
        for (const [i, groupId] of groupIds.entries()) {
          await tx`
            INSERT INTO article_option_groups (tenant_id, article_id, group_id, sort_order)
            VALUES (${ctx.tenantId}, ${req.params.articleId}, ${groupId}, ${i})`;
        }
        await audit(tx, ctx, 'article.options', req.params.articleId, { groupIds });
        return { id: req.params.articleId, groupIds };
      });
    },
  );

  app.post<{ Params: P<'restaurantId'>; Body: { name: string } }>(
    `${base}/restaurants/:restaurantId/tables`,
    { preHandler, schema: { params: params('restaurantId'), body: body({ name }, ['name']) } },
    async (req, reply) => {
      const ctx = req.adminTenant!;
      const created = await withTenant(deps.sql, ctx.tenantId, async (tx) => {
        await assertRestaurant(tx, req.params.restaurantId);
        try {
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO dining_tables (tenant_id, restaurant_id, name, sort_order)
            VALUES (${ctx.tenantId}, ${req.params.restaurantId}, ${req.body.name.trim()},
                    (SELECT count(*) FROM dining_tables WHERE restaurant_id = ${req.params.restaurantId}))
            RETURNING id`;
          await audit(tx, ctx, 'table.create', row!.id, req.body);
          return row!;
        } catch (err) {
          if (
            (err as { constraint_name?: string }).constraint_name ===
            'dining_tables_restaurant_id_name_key'
          ) {
            throw new HttpError(409, 'table_name_taken', 'A table with that name already exists');
          }
          throw err;
        }
      });
      return reply.status(201).send(created);
    },
  );

  app.patch<{ Params: P<'tableId'>; Body: { name?: string; active?: boolean } }>(
    `${base}/tables/:tableId`,
    {
      preHandler,
      schema: { params: params('tableId'), body: body({ name, active: { type: 'boolean' } }) },
    },
    async (req) => {
      const ctx = req.adminTenant!;
      const b = req.body;
      return withTenant(deps.sql, ctx.tenantId, async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          UPDATE dining_tables SET
            name = coalesce(${b.name?.trim() ?? null}, name),
            active = coalesce(${b.active ?? null}::boolean, active)
          WHERE id = ${req.params.tableId} RETURNING id`;
        if (!row) throw new HttpError(404, 'table_not_found', 'Table not found');
        await audit(tx, ctx, 'table.update', row.id, b);
        return { id: row.id };
      });
    },
  );
}
