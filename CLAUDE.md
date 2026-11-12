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
- Routes that touch tenant data use the `requireStaff(sql, roles?)` preHandler (apps/api/src/auth/session.ts) and take tenant and register from `req.staff`, never from the request. Only `login-info` and `/auth/login` read the temporary `x-tenant-id` header, until device pairing exists.
- Child tables carry tenant_id and use composite foreign keys (tenant_id, parent_id).
- Money columns end in `_ore` and are bigint.

## Workflow

- Plan first, wait for approval on schema or compliance changes.
- Write failing tests before implementation for anything in packages/domain.
- Small commits, one feature per branch, conventional commit messages.
