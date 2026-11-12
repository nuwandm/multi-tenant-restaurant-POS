import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app';
import { HttpError } from '../errors';
import { uuid } from '../http-schemas';
import { requireAdmin, withUser } from './admin-session';

const STATUS_BY_ACTION = { approve: 'active', suspend: 'suspended', reactivate: 'active' } as const;

export async function isPlatformAdmin(deps: AppDeps, userId: string): Promise<boolean> {
  const [row] = await withUser(
    deps.sql,
    userId,
    (tx) => tx<{ ok: boolean }[]>`SELECT app_is_platform_admin(${userId}) AS ok`,
  );
  return row?.ok ?? false;
}

function requirePlatformAdmin(deps: AppDeps) {
  const login = requireAdmin(deps.sql);
  return async (req: FastifyRequest) => {
    await login(req);
    if (!(await isPlatformAdmin(deps, req.admin!.userId))) {
      throw new HttpError(403, 'forbidden', 'Platform admins only');
    }
  };
}

/** The platform console: every company's status and usage. No receipts, menus or staff. */
export function platformRoutes(app: FastifyInstance, deps: AppDeps) {
  const platformAdmin = requirePlatformAdmin(deps);

  app.get('/platform/companies', { preHandler: platformAdmin }, async (req) => {
    const rows = await withUser(
      deps.sql,
      req.admin!.userId,
      (tx) =>
        tx<
          {
            tenant_id: string;
            legal_name: string;
            org_number: string;
            status: string;
            created_at: Date;
            status_changed_at: Date | null;
            owner_name: string | null;
            owner_email: string | null;
            owner_email_verified: boolean;
            devices: number;
            restaurants: number;
            registers: number;
            active_registers: number;
            staff: number;
            last_sale_at: Date | null;
            sales_30d_ore: number;
          }[]
        >`SELECT * FROM app_platform_companies()`,
    );
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      legalName: r.legal_name,
      orgNumber: r.org_number,
      status: r.status,
      createdAt: r.created_at,
      statusChangedAt: r.status_changed_at,
      owner: r.owner_name
        ? { name: r.owner_name, email: r.owner_email, emailVerified: r.owner_email_verified }
        : null,
      devices: r.devices,
      restaurants: r.restaurants,
      registers: r.registers,
      activeRegisters: r.active_registers,
      staff: r.staff,
      lastSaleAt: r.last_sale_at,
      sales30dOre: r.sales_30d_ore,
    }));
  });

  app.post<{ Params: { tenantId: string; action: keyof typeof STATUS_BY_ACTION } }>(
    '/platform/companies/:tenantId/:action',
    {
      preHandler: platformAdmin,
      schema: {
        params: {
          type: 'object',
          required: ['tenantId', 'action'],
          properties: { tenantId: uuid, action: { enum: Object.keys(STATUS_BY_ACTION) } },
        },
      },
    },
    async (req) => {
      const status = STATUS_BY_ACTION[req.params.action];
      const [row] = await withUser(
        deps.sql,
        req.admin!.userId,
        (tx) => tx<{ changed: boolean | null }[]>`
          SELECT app_platform_set_status(${req.params.tenantId}, ${status}) AS changed`,
      );
      if (!row?.changed) {
        throw new HttpError(
          409,
          'status_unchanged',
          `Company is already ${status} or does not exist`,
        );
      }
      return { tenantId: req.params.tenantId, status };
    },
  );
}
