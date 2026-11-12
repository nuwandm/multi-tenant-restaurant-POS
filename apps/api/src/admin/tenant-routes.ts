import type { VatRate } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import type { TransactionSql } from 'postgres';
import type { AppDeps } from '../app';
import { hashPassword, hashPin, MIN_PASSWORD_LENGTH } from '../auth/pin';
import type { Role } from '../auth/session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { uuid } from '../http-schemas';
import { hashPairingCode, newPairingCode, PAIRING_CODE_MINUTES } from '../auth/device';
import { audit, requireTenantAdmin, type AdminContext } from './admin-session';

const integer = { type: 'integer' } as const;
const name = { type: 'string', minLength: 1, maxLength: 100 } as const;
const vatRate = { enum: [25, 12, 6, 0] } as const;
const role = { enum: ['owner', 'manager', 'cashier'] } as const;
const station = { anyOf: [{ enum: ['kitchen', 'bar'] }, { type: 'null' }] } as const;
const pin = { type: 'string', pattern: '^[0-9]{4,8}$' } as const;
const password = { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: 200 } as const;

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

/** Runs fn in the company's tenant scope with the admin context of the request. */
function inTenant<T>(
  deps: AppDeps,
  ctx: AdminContext,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return withTenant(deps.sql, ctx.tenantId, fn);
}

async function assertRestaurant(tx: TransactionSql, restaurantId: string) {
  const [row] = await tx`SELECT 1 FROM restaurants WHERE id = ${restaurantId}`;
  if (!row) throw new HttpError(404, 'restaurant_not_found', 'Restaurant not found');
}

/** Everything an owner or manager manages for their own company. */
export function tenantAdminRoutes(app: FastifyInstance, deps: AppDeps) {
  const preHandler = requireTenantAdmin(deps.sql);
  const base = '/admin/tenants/:tenantId';

  // Restaurants (branches) and their registers ------------------------------------------

  app.get<{ Params: P<never> }>(
    `${base}/restaurants`,
    { preHandler, schema: { params: params() } },
    async (req) =>
      inTenant(deps, req.adminTenant!, async (tx) => {
        const restaurants = await tx<{ id: string; name: string; address: string | null }[]>`
        SELECT id, name, address FROM restaurants ORDER BY name`;
        const tables = await tx<
          { id: string; restaurant_id: string; name: string; active: boolean; sort_order: number }[]
        >`SELECT id, restaurant_id, name, active, sort_order FROM dining_tables
        ORDER BY sort_order, name`;
        const registers = await tx<
          {
            id: string;
            restaurant_id: string;
            designation: string;
            status: string;
            control_system_ref: string | null;
            created_at: Date;
            retired_at: Date | null;
          }[]
        >`SELECT id, restaurant_id, designation, status, control_system_ref, created_at, retired_at
        FROM cash_registers ORDER BY designation`;
        const devices = await tx<
          {
            id: string;
            register_id: string;
            name: string;
            paired_at: Date;
            last_seen_at: Date | null;
          }[]
        >`SELECT id, register_id, name, paired_at, last_seen_at FROM devices
          WHERE revoked_at IS NULL ORDER BY paired_at`;
        const [tenant] = await tx<{ legal_name: string; org_number: string; status: string }[]>`
        SELECT legal_name, org_number, status FROM tenants`;
        return {
          company: tenant
            ? { legalName: tenant.legal_name, orgNumber: tenant.org_number, status: tenant.status }
            : null,
          restaurants: restaurants.map((r) => ({
            ...r,
            tables: tables
              .filter((tb) => tb.restaurant_id === r.id)
              .map((tb) => ({ id: tb.id, name: tb.name, active: tb.active })),
            registers: registers
              .filter((c) => c.restaurant_id === r.id)
              .map((c) => ({
                id: c.id,
                designation: c.designation,
                status: c.status,
                enrolled: c.control_system_ref !== null,
                createdAt: c.created_at,
                retiredAt: c.retired_at,
                devices: devices
                  .filter((d) => d.register_id === c.id)
                  .map((d) => ({
                    id: d.id,
                    name: d.name,
                    pairedAt: d.paired_at,
                    lastSeenAt: d.last_seen_at,
                  })),
              })),
          })),
        };
      }),
  );

  app.post<{ Params: P<never>; Body: { name: string; address?: string } }>(
    `${base}/restaurants`,
    {
      preHandler,
      schema: {
        params: params(),
        body: body({ name, address: { type: 'string', maxLength: 200 } }, ['name']),
      },
    },
    async (req, reply) => {
      const ctx = req.adminTenant!;
      const created = await inTenant(deps, ctx, async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO restaurants (tenant_id, name, address)
          VALUES (${ctx.tenantId}, ${req.body.name.trim()}, ${req.body.address?.trim() || null})
          RETURNING id`;
        await audit(tx, ctx, 'restaurant.create', row!.id, { name: req.body.name });
        return row!;
      });
      return reply.status(201).send(created);
    },
  );

  // A new register is enrolled with the control system straight away.
  app.post<{ Params: P<'restaurantId'>; Body: { designation: string } }>(
    `${base}/restaurants/:restaurantId/registers`,
    {
      preHandler,
      schema: {
        params: params('restaurantId'),
        body: body({ designation: { type: 'string', pattern: '^[A-Za-z0-9-]{1,20}$' } }, [
          'designation',
        ]),
      },
    },
    async (req, reply) => {
      const ctx = req.adminTenant!;
      const designation = req.body.designation.toUpperCase();
      const created = await inTenant(deps, ctx, async (tx) => {
        await assertRestaurant(tx, req.params.restaurantId);
        const [taken] = await tx`SELECT 1 FROM cash_registers WHERE designation = ${designation}`;
        if (taken)
          throw new HttpError(409, 'designation_taken', 'That register name is already used');

        const [tenant] = await tx<{ org_number: string }[]>`SELECT org_number FROM tenants`;
        const { controlSystemRef } = await deps.controlSystem.registerRegister({
          orgNumber: tenant!.org_number,
          designation,
        });
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO cash_registers (tenant_id, restaurant_id, designation, control_system_ref)
          VALUES (${ctx.tenantId}, ${req.params.restaurantId}, ${designation}, ${controlSystemRef})
          RETURNING id`;
        await audit(tx, ctx, 'register.create', row!.id, { designation });
        return { id: row!.id, designation };
      });
      return reply.status(201).send(created);
    },
  );

  // Registers are never deleted: their receipts and Z reports must stay. They are retired.
  app.post<{ Params: P<'registerId'> }>(
    `${base}/registers/:registerId/retire`,
    { preHandler, schema: { params: params('registerId') } },
    async (req) => {
      const ctx = req.adminTenant!;
      return inTenant(deps, ctx, async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          UPDATE cash_registers SET status = 'retired', retired_at = now()
          WHERE id = ${req.params.registerId} AND status = 'active' RETURNING id`;
        if (!row) throw new HttpError(404, 'register_not_found', 'No active register with that id');
        await revokeDevices(tx, { registerId: row.id });
        await audit(tx, ctx, 'register.retire', row.id);
        return { id: row.id, status: 'retired' };
      });
    },
  );

  // A one-time code the till types in to become this register. Valid 15 minutes, single use.
  app.post<{ Params: P<'registerId'> }>(
    `${base}/registers/:registerId/pairing-code`,
    { preHandler, schema: { params: params('registerId') } },
    async (req, reply) => {
      const ctx = req.adminTenant!;
      const code = newPairingCode();
      const expiresAt = new Date(Date.now() + PAIRING_CODE_MINUTES * 60_000);
      await inTenant(deps, ctx, async (tx) => {
        const [register] = await tx`
          SELECT 1 FROM cash_registers WHERE id = ${req.params.registerId} AND status = 'active'`;
        if (!register)
          throw new HttpError(404, 'register_not_found', 'No active register with that id');
        await tx`
          INSERT INTO pairing_codes (code_hash, tenant_id, register_id, created_by, expires_at)
          VALUES (${hashPairingCode(code)}, ${ctx.tenantId}, ${req.params.registerId}, ${ctx.userId},
                  ${expiresAt})`;
        await audit(tx, ctx, 'device.pairing_code', req.params.registerId);
      });
      return reply.status(201).send({ code, expiresAt });
    },
  );

  // Unpairs a till at once, e.g. a lost tablet. Anyone logged in on it is logged out.
  app.post<{ Params: P<'deviceId'> }>(
    `${base}/devices/:deviceId/revoke`,
    { preHandler, schema: { params: params('deviceId') } },
    async (req) => {
      const ctx = req.adminTenant!;
      return inTenant(deps, ctx, async (tx) => {
        const revoked = await revokeDevices(tx, { deviceId: req.params.deviceId });
        if (revoked.length === 0)
          throw new HttpError(404, 'device_not_found', 'No paired device with that id');
        await audit(tx, ctx, 'device.revoke', req.params.deviceId);
        return { id: req.params.deviceId, revoked: true };
      });
    },
  );

  // Menu -----------------------------------------------------------------------------

  app.get<{ Params: P<'restaurantId'> }>(
    `${base}/restaurants/:restaurantId/menu`,
    { preHandler, schema: { params: params('restaurantId') } },
    async (req) =>
      inTenant(deps, req.adminTenant!, async (tx) => {
        await assertRestaurant(tx, req.params.restaurantId);
        const groups = await tx<
          { id: string; name: string; sort_order: number; active: boolean }[]
        >`
          SELECT id, name, sort_order, active FROM menu_groups
          WHERE restaurant_id = ${req.params.restaurantId} ORDER BY sort_order, name`;
        const articles = await tx<
          {
            id: string;
            name: string;
            price_ore: number;
            vat_rate: VatRate;
            menu_group_id: string | null;
            active: boolean;
            station: 'kitchen' | 'bar' | null;
            option_group_ids: string[];
          }[]
        >`SELECT a.id, a.name, a.price_ore, a.vat_rate, a.menu_group_id, a.active, a.station,
                 coalesce(array_agg(aog.group_id ORDER BY aog.sort_order)
                          FILTER (WHERE aog.group_id IS NOT NULL), '{}') AS option_group_ids
          FROM articles a LEFT JOIN article_option_groups aog ON aog.article_id = a.id
          WHERE a.restaurant_id = ${req.params.restaurantId}
          GROUP BY a.id ORDER BY a.name`;
        return {
          groups: groups.map((g) => ({
            id: g.id,
            name: g.name,
            sortOrder: g.sort_order,
            active: g.active,
          })),
          articles: articles.map((a) => ({
            id: a.id,
            name: a.name,
            priceOre: a.price_ore,
            vatRate: a.vat_rate,
            menuGroupId: a.menu_group_id,
            active: a.active,
            station: a.station,
            optionGroupIds: a.option_group_ids,
          })),
        };
      }),
  );

  app.post<{ Params: P<'restaurantId'>; Body: { name: string; sortOrder?: number } }>(
    `${base}/restaurants/:restaurantId/menu-groups`,
    {
      preHandler,
      schema: {
        params: params('restaurantId'),
        body: body({ name, sortOrder: integer }, ['name']),
      },
    },
    async (req, reply) => {
      const ctx = req.adminTenant!;
      const created = await inTenant(deps, ctx, async (tx) => {
        await assertRestaurant(tx, req.params.restaurantId);
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO menu_groups (tenant_id, restaurant_id, name, sort_order)
          VALUES (${ctx.tenantId}, ${req.params.restaurantId}, ${req.body.name.trim()}, ${req.body.sortOrder ?? 0})
          RETURNING id`;
        await audit(tx, ctx, 'menu_group.create', row!.id, { name: req.body.name });
        return row!;
      });
      return reply.status(201).send(created);
    },
  );

  app.patch<{
    Params: P<'groupId'>;
    Body: { name?: string; sortOrder?: number; active?: boolean };
  }>(
    `${base}/menu-groups/:groupId`,
    {
      preHandler,
      schema: {
        params: params('groupId'),
        body: body({ name, sortOrder: integer, active: { type: 'boolean' } }),
      },
    },
    async (req) => {
      const ctx = req.adminTenant!;
      const { name: newName, sortOrder, active } = req.body;
      return inTenant(deps, ctx, async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          UPDATE menu_groups SET
            name = coalesce(${newName?.trim() ?? null}, name),
            sort_order = coalesce(${sortOrder ?? null}::int, sort_order),
            active = coalesce(${active ?? null}::boolean, active)
          WHERE id = ${req.params.groupId} RETURNING id`;
        if (!row) throw new HttpError(404, 'group_not_found', 'Menu group not found');
        await audit(tx, ctx, 'menu_group.update', row.id, req.body);
        return { id: row.id };
      });
    },
  );

  app.post<{
    Params: P<'restaurantId'>;
    Body: {
      name: string;
      priceOre: number;
      vatRate: VatRate;
      menuGroupId?: string | null;
      station?: 'kitchen' | 'bar' | null;
    };
  }>(
    `${base}/restaurants/:restaurantId/articles`,
    {
      preHandler,
      schema: {
        params: params('restaurantId'),
        body: body(
          {
            name,
            priceOre: { ...integer, minimum: 0, maximum: 10_000_000 },
            vatRate,
            menuGroupId: { anyOf: [uuid, { type: 'null' }] },
            station,
          },
          ['name', 'priceOre', 'vatRate'],
        ),
      },
    },
    async (req, reply) => {
      const ctx = req.adminTenant!;
      const { name: articleName, priceOre, vatRate: rate, menuGroupId, station: where } = req.body;
      const created = await inTenant(deps, ctx, async (tx) => {
        await assertRestaurant(tx, req.params.restaurantId);
        if (menuGroupId) await assertGroupInRestaurant(tx, menuGroupId, req.params.restaurantId);
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO articles (tenant_id, restaurant_id, menu_group_id, name, price_ore, vat_rate, station)
          VALUES (${ctx.tenantId}, ${req.params.restaurantId}, ${menuGroupId ?? null},
                  ${articleName.trim()}, ${priceOre}, ${rate}, ${where ?? null})
          RETURNING id`;
        await audit(tx, ctx, 'article.create', row!.id, {
          name: articleName,
          priceOre,
          vatRate: rate,
        });
        return row!;
      });
      return reply.status(201).send(created);
    },
  );

  // Price changes affect future sales only: receipts keep the name and price they were sold at.
  app.patch<{
    Params: P<'articleId'>;
    Body: {
      name?: string;
      priceOre?: number;
      vatRate?: VatRate;
      menuGroupId?: string | null;
      active?: boolean;
      station?: 'kitchen' | 'bar' | null;
    };
  }>(
    `${base}/articles/:articleId`,
    {
      preHandler,
      schema: {
        params: params('articleId'),
        body: body({
          name,
          priceOre: { ...integer, minimum: 0, maximum: 10_000_000 },
          vatRate,
          menuGroupId: { anyOf: [uuid, { type: 'null' }] },
          active: { type: 'boolean' },
          station,
        }),
      },
    },
    async (req) => {
      const ctx = req.adminTenant!;
      const b = req.body;
      return inTenant(deps, ctx, async (tx) => {
        const [article] = await tx<{ restaurant_id: string }[]>`
          SELECT restaurant_id FROM articles WHERE id = ${req.params.articleId}`;
        if (!article) throw new HttpError(404, 'article_not_found', 'Article not found');
        if (b.menuGroupId) await assertGroupInRestaurant(tx, b.menuGroupId, article.restaurant_id);

        await tx`
          UPDATE articles SET
            name = coalesce(${b.name?.trim() ?? null}, name),
            price_ore = coalesce(${b.priceOre ?? null}::bigint, price_ore),
            vat_rate = coalesce(${b.vatRate ?? null}::smallint, vat_rate),
            menu_group_id = CASE WHEN ${'menuGroupId' in b}::boolean THEN ${b.menuGroupId ?? null}::uuid
                                 ELSE menu_group_id END,
            active = coalesce(${b.active ?? null}::boolean, active),
            station = CASE WHEN ${'station' in b}::boolean THEN ${b.station ?? null}::text
                           ELSE station END
          WHERE id = ${req.params.articleId}`;
        await audit(tx, ctx, 'article.update', req.params.articleId, b);
        return { id: req.params.articleId };
      });
    },
  );

  // Staff ----------------------------------------------------------------------------

  app.get<{ Params: P<never> }>(
    `${base}/staff`,
    { preHandler, schema: { params: params() } },
    async (req) =>
      inTenant(deps, req.adminTenant!, async (tx) => {
        const rows = await tx<
          {
            user_id: string;
            display_name: string;
            email: string | null;
            role: Role;
            active: boolean;
            has_pin: boolean;
            has_password: boolean;
            locked_until: Date | null;
          }[]
        >`
        SELECT m.user_id, u.display_name, u.email, m.role, m.active,
               m.pin_hash IS NOT NULL AS has_pin, u.password_hash IS NOT NULL AS has_password,
               m.locked_until
        FROM memberships m JOIN users u ON u.id = m.user_id
        ORDER BY m.active DESC, u.display_name`;
        return rows.map((r) => ({
          userId: r.user_id,
          displayName: r.display_name,
          email: r.email,
          role: r.role,
          active: r.active,
          hasPin: r.has_pin,
          hasPassword: r.has_password,
          pinLocked: r.locked_until !== null && r.locked_until > new Date(),
        }));
      }),
  );

  app.post<{
    Params: P<never>;
    Body: { displayName: string; email?: string; role: Role; pin: string; password?: string };
  }>(
    `${base}/staff`,
    {
      preHandler,
      schema: {
        params: params(),
        body: body(
          {
            displayName: name,
            email: { type: 'string', format: 'email', maxLength: 200 },
            role,
            pin,
            password,
          },
          ['displayName', 'role', 'pin'],
        ),
      },
    },
    async (req, reply) => {
      const ctx = req.adminTenant!;
      const b = req.body;
      assertMayAssign(ctx, b.role);
      if (b.password && b.role === 'cashier') {
        throw new HttpError(
          400,
          'cashier_no_password',
          'Cashiers use the till only and get no password',
        );
      }
      const pinHash = await hashPin(b.pin);
      const passwordHash = b.password ? await hashPassword(b.password) : null;

      try {
        const created = await inTenant(deps, ctx, async (tx) => {
          const [user] = await tx<{ id: string }[]>`
            INSERT INTO users (email, display_name, password_hash)
            VALUES (${b.email?.trim() || null}, ${b.displayName.trim()}, ${passwordHash})
            RETURNING id`;
          await tx`
            INSERT INTO memberships (tenant_id, user_id, role, pin_hash)
            VALUES (${ctx.tenantId}, ${user!.id}, ${b.role}, ${pinHash})`;
          await audit(tx, ctx, 'staff.create', user!.id, {
            displayName: b.displayName,
            role: b.role,
          });
          return { userId: user!.id };
        });
        return reply.status(201).send(created);
      } catch (err) {
        if ((err as { constraint_name?: string }).constraint_name === 'users_email_key') {
          throw new HttpError(409, 'email_taken', 'An account with this email already exists');
        }
        throw err;
      }
    },
  );

  app.patch<{
    Params: P<'userId'>;
    Body: { displayName?: string; role?: Role; active?: boolean; pin?: string };
  }>(
    `${base}/staff/:userId`,
    {
      preHandler,
      schema: {
        params: params('userId'),
        body: body({ displayName: name, role, active: { type: 'boolean' }, pin }),
      },
    },
    async (req) => {
      const ctx = req.adminTenant!;
      const b = req.body;
      const isSelf = req.params.userId === ctx.userId;
      if (isSelf && (b.active === false || (b.role && b.role !== ctx.role))) {
        throw new HttpError(
          400,
          'cannot_change_self',
          'You cannot deactivate yourself or change your own role',
        );
      }
      if (b.role) assertMayAssign(ctx, b.role);
      const pinHash = b.pin ? await hashPin(b.pin) : null;

      return inTenant(deps, ctx, async (tx) => {
        const [member] = await tx<{ role: Role }[]>`
          SELECT role FROM memberships WHERE user_id = ${req.params.userId} FOR UPDATE`;
        if (!member) throw new HttpError(404, 'staff_not_found', 'Staff member not found');
        if (member.role === 'owner' && ctx.role !== 'owner') {
          throw new HttpError(403, 'forbidden', 'Only an owner can change an owner');
        }

        await tx`
          UPDATE memberships SET
            role = coalesce(${b.role ?? null}, role),
            active = coalesce(${b.active ?? null}::boolean, active),
            pin_hash = coalesce(${pinHash}, pin_hash),
            failed_pin_attempts = CASE WHEN ${pinHash !== null}::boolean THEN 0 ELSE failed_pin_attempts END,
            locked_until = CASE WHEN ${pinHash !== null}::boolean THEN NULL ELSE locked_until END
          WHERE user_id = ${req.params.userId}`;
        if (b.displayName) {
          await tx`UPDATE users SET display_name = ${b.displayName.trim()} WHERE id = ${req.params.userId}`;
        }
        // Losing access or changing role takes effect at once: log them out of every till.
        if (b.active === false || (b.role && b.role !== member.role)) {
          await tx`SELECT app_end_user_sessions(${req.params.userId})`;
        }
        await audit(tx, ctx, 'staff.update', req.params.userId, {
          ...b,
          ...(b.pin && { pin: 'changed' }),
        });
        return { userId: req.params.userId };
      });
    },
  );

  // History --------------------------------------------------------------------------

  app.get<{ Params: P<never>; Querystring: { limit: number } }>(
    `${base}/z-reports`,
    {
      preHandler,
      schema: {
        params: params(),
        querystring: {
          type: 'object',
          properties: { limit: { ...integer, minimum: 1, maximum: 200, default: 50 } },
        },
      },
    },
    async (req) =>
      inTenant(deps, req.adminTenant!, async (tx) => {
        const rows = await tx<
          {
            id: string;
            z_number: number;
            designation: string;
            restaurant_name: string;
            period_from: Date;
            period_to: Date;
            sale_count: number;
            sales_total_ore: number;
            return_total_ore: number;
            net_total_ore: number;
            grand_total_ore: number;
          }[]
        >`
          SELECT z.id, z.z_number, c.designation, s.name AS restaurant_name, z.period_from,
                 z.period_to, z.sale_count, z.sales_total_ore, z.return_total_ore,
                 z.net_total_ore, z.grand_total_ore
          FROM z_reports z
          JOIN cash_registers c ON c.id = z.register_id
          JOIN restaurants s ON s.id = c.restaurant_id
          ORDER BY z.period_to DESC LIMIT ${req.query.limit}`;
        return rows.map((r) => ({
          id: r.id,
          zNumber: r.z_number,
          register: r.designation,
          restaurant: r.restaurant_name,
          periodFrom: r.period_from,
          periodTo: r.period_to,
          saleCount: r.sale_count,
          salesTotalOre: r.sales_total_ore,
          returnsTotalOre: r.return_total_ore,
          netTotalOre: r.net_total_ore,
          grandTotalOre: r.grand_total_ore,
        }));
      }),
  );

  app.get<{ Params: P<never> }>(
    `${base}/audit`,
    { preHandler, schema: { params: params() } },
    async (req) =>
      inTenant(deps, req.adminTenant!, async (tx) => {
        const rows = await tx<
          {
            action: string;
            entity_id: string | null;
            details: unknown;
            created_at: Date;
            display_name: string;
          }[]
        >`
        SELECT a.action, a.entity_id, a.details, a.created_at, u.display_name
        FROM audit_log a JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC LIMIT 100`;
        return rows.map((r) => ({
          action: r.action,
          entityId: r.entity_id,
          details: r.details,
          at: r.created_at,
          by: r.display_name,
        }));
      }),
  );
}

/** Revokes one device or every device on a register, and logs out anyone using them. */
async function revokeDevices(
  tx: TransactionSql,
  target: { deviceId: string } | { registerId: string },
): Promise<string[]> {
  const deviceId = 'deviceId' in target ? target.deviceId : null;
  const registerId = 'registerId' in target ? target.registerId : null;
  const rows = await tx<{ id: string }[]>`
    UPDATE devices SET revoked_at = now()
    WHERE revoked_at IS NULL
      AND (id = ${deviceId}::uuid OR register_id = ${registerId}::uuid)
    RETURNING id`;
  for (const { id } of rows) await tx`SELECT app_end_device_sessions(${id})`;
  return rows.map((r) => r.id);
}

async function assertGroupInRestaurant(tx: TransactionSql, groupId: string, restaurantId: string) {
  const [row] = await tx`
    SELECT 1 FROM menu_groups WHERE id = ${groupId} AND restaurant_id = ${restaurantId}`;
  if (!row)
    throw new HttpError(
      400,
      'group_not_in_restaurant',
      'That menu group belongs to another restaurant',
    );
}

/** Managers can add and manage managers and cashiers; only owners can make owners. */
function assertMayAssign(ctx: AdminContext, target: Role) {
  if (target === 'owner' && ctx.role !== 'owner') {
    throw new HttpError(403, 'forbidden', 'Only an owner can add or appoint owners');
  }
}
