# Restaurant POS – rules for Claude

Multi-tenant restaurant POS for five Swedish restaurants. The full plan is in docs/proposal.md.

## Domain rules (never break)

- Every sales table has tenant_id; all queries go through the tenant-scoped repository. Postgres RLS is on.
- Primary keys are UUIDs. org_number is an attribute, never a key.
- Each cash register has a unique designation (kassabeteckning) printed on receipts, X and Z reports.
- Receipt numbers: one gapless series per register, allocated inside the same DB transaction as the receipt.
- Receipts, journal_events and z_reports are append-only. Corrections = new receipts (returns), never UPDATE/DELETE.
- Money is integer öre. Never floats. VAT rates: 25, 12, 6, 0.
- Every receipt is signed by the control system before it is printed; no control code, no receipt.
- Compliance texts live in docs/compliance. Cite them; don't invent requirements.
  - Technical rules: SKVFS 2014:9 as amended by SKVFS 2021:17 (applies from 1 January 2027).
  - XML journal export format: SKVFS 2021:16, validated against Skatteverket's XML schema.
  - Use of registers: SKVFS 2021:18.

## Repo layout

- apps/pos: till PWA (React + Vite)
- apps/backoffice: admin (React + Vite)
- apps/api: Fastify API, the only writer of sales data
- packages/domain: pure TypeScript (money, VAT, numbering, reports). No I/O.
- packages/control-system: ControlSystem interface + FakeControlSystem

Workspace packages are consumed as TypeScript source; there is no build step for packages.

## Commands

- `pnpm install`
- `pnpm db:up` starts Postgres 16 on localhost:5433; `pnpm db:migrate` applies apps/api/db/migrations
- API tests need Postgres running: they recreate a `pos_test` database on every run
- `pnpm dev:api` / `pnpm dev:pos` / `pnpm dev:backoffice`
- `pnpm lint && pnpm typecheck && pnpm test` must pass before a task is done

## Database conventions

- Migrations are plain SQL in apps/api/db/migrations, numbered, never edited after merge. Add a new file instead.
- Tenant data is accessed only through `withTenant(sql, tenantId, fn)` in apps/api/src/db/tenant.ts. It sets `SET LOCAL ROLE pos_app` and `app.tenant_id`, so RLS applies even on a superuser connection.
- Routes that touch tenant data use the `requireStaff(sql, roles?)` preHandler (apps/api/src/auth/session.ts) and take tenant and register from `req.staff`, never from the request.
- A till is a paired device: `/devices/pair` turns a one-time back office code into a device token, sent as `x-device-token`. `requireDevice` resolves it to tenant and register for `/device` and `/auth/login`. Revoking a device ends every staff session made on it.
- Sales, returns and copies accept an `Idempotency-Key` header; a repeat on the same register returns the stored receipt.
- Email goes through the `Mailer` in AppDeps (`ConsoleMailer` in dev prints to the API log, `MemoryMailer` in tests). No real provider is wired yet.
- Back office routes under `/admin/tenants/:tenantId` use `requireTenantAdmin` (owner or manager in that company) and write an `audit_log` entry for every change. `withUser` (app.user_id) lets a user see only their own memberships and companies.
- The platform console reads across tenants only through the `app_platform_*` SECURITY DEFINER functions, which return status and usage, never receipts, menus or staff. The migration owner must be a superuser or have BYPASSRLS for them to work.
- A company is `pending` until a platform admin approves it; `lockRegister(..., { forSelling: true })` refuses to sell for pending or suspended companies. The app role cannot change `tenants.status`.
- Child tables carry tenant_id and use composite foreign keys (tenant_id, parent_id).
- Prices of options and discounts are computed only on the server (apps/api/src/sales/pricing.ts). Order discounts are spread over the lines with `allocateDiscount` so VAT per rate stays exact.
- Table orders live in `open_orders` (with a `version` for optimistic locking). Paying with `openOrderId` consumes the paid quantities in the same transaction as the receipt. Kitchen tickets are per station and made when an order is sent, or at sale for quick sales.
- Money columns end in `_ore` and are bigint.
- Swish goes through `SwishClient` in AppDeps (`SimulatedSwish` by default, `HttpSwish` for Swish's test environment or production via `SWISH_MODE`). Where a restaurant has a `swish_number`, a sale's Swish payment must name a `payment_attempts` row that Swish confirmed as paid, for the same amount and not used before (`claimSwishPayments`). Callbacks are only a hint: the API always asks Swish itself. A return of a sale paid through Swish must carry a Swish refund that Swish has paid (`claimSwishRefunds`); refunds are `payment_attempts` rows with `kind = 'refund'`, and pending or paid refunds never add up to more than the payment.

## Workflow

- Plan first, wait for approval on schema or compliance changes.
- Write failing tests before implementation for anything in packages/domain.
- Small commits, one feature per branch, conventional commit messages.
