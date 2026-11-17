# Backend learning guide

A study path for the API in `apps/api`. Each step names what to learn, where it appears in
this repo, and a small exercise. Do the steps in order; later ones build on earlier ones.

## 0. Get it running

```sh
pnpm install
pnpm db:up        # Postgres 16 on localhost:5433 (Docker)
pnpm db:migrate   # applies apps/api/db/migrations
pnpm dev:api
pnpm --filter @pos/api test   # recreates the pos_test database every run
```

**Exercise:** open `http://localhost:3000/health` and find the route that answered it in
`src/app.ts`.

---

## 1. TypeScript and Node.js

| Learn | Why here |
|---|---|
| Types, interfaces, union types (`'sale' \| 'training'`) | Every request and row is typed |
| Generics (`withTenant<T>`) | Helpers return whatever the callback returns |
| `async` / `await`, Promises | Every DB call is async |
| ES modules (`import` / `export`, `"type": "module"`) | The whole repo |
| `node:crypto` (`randomUUID`, `randomBytes`, `createHash`) | IDs, tokens, token hashing |
| Module augmentation (`declare module 'fastify'`) | Adds `req.staff` in `src/auth/session.ts` |

**Read:** `src/errors.ts` (5 lines) and `src/auth/session.ts`.

**Exercise:** explain why a session token is stored only as a SHA-256 hash (`hashToken`).

---

## 2. Fastify (HTTP layer)

| Learn | Where |
|---|---|
| Creating an app and registering routes | `buildApp` in `src/app.ts` |
| Dependency injection through an object | `AppDeps` (sql, controlSystem, mailer, swish) |
| JSON Schema validation of request bodies | `src/sales/routes.ts`, `src/http-schemas.ts` |
| `preHandler` hooks for auth | `requireStaff`, `requireDevice`, `requireTenantAdmin` |
| Central error handler | `app.setErrorHandler` maps `HttpError` → status + `{ error, message }` |
| Logging (`req.log`) | Pino, built into Fastify |
| Testing with `app.inject()` (no real network) | `*.test.ts` |

**Key idea:** routes are thin. They validate input, read `req.staff`, and call a service
function such as `createReceipt`. Business logic does not live in route handlers.

**Exercise:** trace `POST` for a sale from `src/sales/routes.ts` to `createReceipt` in
`src/sales/create-receipt.ts`.

---

## 3. PostgreSQL fundamentals

| Learn | Where |
|---|---|
| Tables, primary keys (UUID), foreign keys | `db/migrations/0001_init.sql` |
| Composite foreign keys `(tenant_id, parent_id)` | Child tables such as `receipt_lines` |
| `bigint` money columns ending in `_ore` | All money columns |
| `CHECK` constraints and unique indexes | Throughout the migrations |
| Upsert: `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` | `nextValue` in `src/sales/sequences.ts` |
| Triggers | `reject_change()` blocks UPDATE/DELETE on legal records |
| Roles and `GRANT` | `pos_app` role, no DELETE on legal history |
| Plain SQL migrations, never edited after merge | `src/db/migrate.ts` |

**Exercise:** read the migrations in number order (0001 → 0010) and write one sentence per
file on what it added.

---

## 4. postgres.js (the DB client)

The `postgres` package uses tagged templates. Values in `${}` become parameters, so this is
safe from SQL injection:

```ts
const [row] = await tx<{ id: string }[]>`
  SELECT id FROM receipts
  WHERE register_id = ${staff.registerId} AND idempotency_key = ${idempotencyKey}`;
```

| Learn | Where |
|---|---|
| `sql.begin(async (tx) => ...)` transactions | `withTenant` in `src/db/tenant.ts` |
| Typing results: `tx<Row[]>\`...\`` | Everywhere |
| Bulk insert: `` tx`INSERT INTO t ${tx(rows)}` `` | `storeReceipt` |
| JSON columns: `tx.json(value)` | `appendJournalEvent` |

---

## 5. Multi-tenancy with Row-Level Security ★

The most important pattern in the backend. Five restaurants share one database; RLS makes it
impossible for one company to read another's data, even if a query forgets a `WHERE`.

How it fits together:

1. `current_tenant_id()` reads the session setting `app.tenant_id`.
2. Every tenant table has a policy:
   ```sql
   CREATE POLICY tenant_isolation ON receipts
     USING (tenant_id = current_tenant_id())
     WITH CHECK (tenant_id = current_tenant_id());
   ```
   `FORCE ROW LEVEL SECURITY` applies it to the table owner too.
3. `withTenant` opens a transaction, switches to the restricted role and sets the tenant:
   ```ts
   await tx`SET LOCAL ROLE pos_app`;
   await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
   ```
   `LOCAL` / `true` means both end with the transaction, so nothing leaks between requests.
4. The tenant comes from `req.staff` (the session), never from the request body or URL.

Related: `SECURITY DEFINER` functions (`app_platform_*`, `app_session`) run with the owner's
rights for the few cross-tenant reads that are allowed.

**Read:** `db/demo-rls.sql`, `src/db/tenant.ts`, the RLS section of `0001_init.sql`.

**Exercise:** in `psql`, `SET ROLE pos_app;` without setting `app.tenant_id`, then
`SELECT count(*) FROM receipts;`. Explain the result.

---

## 6. Transactions, locking and concurrency ★

| Learn | Where |
|---|---|
| ACID and what a rollback undoes | Every sale is one transaction |
| `SELECT ... FOR UPDATE` row locks | `lockRegister` in `src/sales/register.ts` |
| Advisory locks (`pg_advisory_xact_lock`) | `createReturn`: two returns of one receipt can't both pass |
| Optimistic locking with a `version` column | `open_orders` in `src/sales/open-orders.ts` |
| Gapless numbering | `nextValue`: the upsert locks the counter row; a rollback gives the number back |

**Why gapless matters:** the law requires one unbroken receipt series per register. A
Postgres `SEQUENCE` can skip numbers on rollback, so this repo uses a locked counter row in
the same transaction as the receipt instead.

**Exercise:** explain what happens if two tills on the *same* register sell at the same
moment, and what happens if the control system fails after the number was taken.

---

## 7. The life of a sale (read this end to end)

`createReceipt` → `onceOnRegister` → `storeReceipt`, all inside one `withTenant` transaction:

1. `lockRegister` — lock the register row; refuse if the company is pending/suspended, the
   register is retired, the address is missing, or it is not enrolled with the control system.
2. Idempotency check — same `Idempotency-Key` on this register returns the stored receipt.
3. `priceLines` (`src/sales/pricing.ts`) — prices come from the menu on the server; the client
   sends only article and quantity.
4. `claimSwishPayments` — a Swish payment must point at a confirmed, unused payment attempt.
5. `buildReceipt` (`packages/domain`) — pure function: totals, discounts, VAT per rate.
6. `nextValue` — gapless receipt number.
7. `controlSystem.signReceipt` — no control code, no receipt (error → whole transaction rolls back).
8. Insert `receipts`, `receipt_lines`, `receipt_vat_totals`, `payments`.
9. `appendJournalEvent` — hash-chained, append-only journal.
10. `after` — link Swish, consume the open order, create kitchen tickets.

**Exercise:** set a breakpoint (or `console.log`) at each step and run
`src/sales/receipts.test.ts`.

---

## 8. Domain design patterns

| Pattern | Where |
|---|---|
| Pure domain core, I/O at the edges | `packages/domain` has no DB or HTTP |
| Interfaces + fakes for external systems | `ControlSystem` / `FakeControlSystem`, `SwishClient` / `SimulatedSwish`, `Mailer` / `MemoryMailer` |
| Append-only records, corrections as new rows | Returns are new receipts; triggers reject UPDATE/DELETE |
| Hash chains for tamper evidence | `createJournalEvent` + `journal_events.prev_hash` |
| Integer money (öre) | `ore()` in `packages/domain` |
| Idempotency keys | `onceOnRegister` |
| Stable error codes for clients | `HttpError(409, 'company_pending', ...)` |

---

## 9. Authentication and authorization

| Learn | Where |
|---|---|
| Opaque bearer tokens, hashed at rest | `src/auth/session.ts` |
| Device pairing (one-time code → device token) | `src/auth/device.ts`, `/devices/pair` |
| PIN login for staff | `src/auth/pin.ts` |
| Role checks (owner / manager / cashier) | `requireStaff(sql, roles)` |
| Back office sessions and audit log | `src/admin/admin-session.ts`, `audit_log` |

**Exercise:** what happens to staff sessions when a device is revoked, and where is that enforced?

---

## 10. External integrations

- **Swish** (`src/payments/`): create payment → poll Swish for status → claim when paid.
  Callbacks are only hints; the API always asks Swish itself. Refunds are `payment_attempts`
  rows with `kind = 'refund'`.
- **XML journal export** (`src/journal/`): build XML, validate against Skatteverket's XSD with
  `xmllint-wasm` before handing it out.
- **Email** (`src/mail/mailer.ts`): an interface with console and in-memory implementations.

Learn: HTTP clients with `fetch`, TLS client certificates (Swish uses them), XML and XSD basics.

---

## 11. Testing

| Learn | Where |
|---|---|
| Vitest (`describe`, `it`, `expect`, `beforeEach`) | `src/**/*.test.ts` |
| Global setup that recreates a test database | `test/global-setup.ts` |
| Fixtures for tenants, registers, staff | `test/fixtures.ts`, `test/db.ts` |
| Testing through HTTP with `app.inject()` | `src/app.test.ts` |
| Test-first for `packages/domain` | Project rule in `CLAUDE.md` |

**Exercise:** write a test that a cashier from tenant A gets 404 for a receipt of tenant B.

---

## 12. Swedish compliance (backend view)

Enough to understand *why* the code is shaped this way. Sources are in `docs/compliance`.

- SKVFS 2014:9 (amended by 2021:17): receipt contents, control system, X/Z reports, journal.
- SKVFS 2021:16: XML journal export format.
- SKVFS 2021:18: how registers must be used.
- VAT rates 25 / 12 / 6 / 0 %, cash rounding to whole kronor.

Search the code for `SKVFS` to see which rule each check comes from.

---

## Suggested order and checklist

- [ ] 0 Run it
- [ ] 1 TypeScript / Node
- [ ] 2 Fastify
- [ ] 3 PostgreSQL basics
- [ ] 4 postgres.js
- [ ] 5 RLS multi-tenancy
- [ ] 6 Transactions and locking
- [ ] 7 Life of a sale
- [ ] 8 Domain patterns
- [ ] 9 Auth
- [ ] 10 Integrations
- [ ] 11 Testing
- [ ] 12 Compliance

## Outside resources

- Fastify docs: https://fastify.dev/docs/latest/
- postgres.js README: https://github.com/porsager/postgres
- PostgreSQL docs on Row Security Policies, Explicit Locking and Transaction Isolation
- Vitest docs: https://vitest.dev/
- Skatteverket: kassaregister (search "kassaregister skatteverket")
