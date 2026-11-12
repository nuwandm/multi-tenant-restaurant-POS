# Multi-Restaurant POS Platform: Project Proposal & Claude Code Plan

Nov 12, 2026 · @Nuwan Madusanka

## Summary

We will build one multi-tenant restaurant POS that runs five Swedish restaurants. Each restaurant's sales, receipt numbering and reports stay separate, and the system meets Skatteverket's cash-register rules, including the XML journal export that becomes mandatory on 1 January 2027.

- **What:** a web-based POS (order taking, payment recording, receipts, X/Z reports) plus a back office for menus, staff and reporting.
- **Who:** restaurant owners across Sweden, starting with five pilot restaurants. Owners sign up themselves; each company is a tenant with its own organisation number, one or more restaurants (branches) and their registers.
- **How:** a React/TypeScript front end and a Node/TypeScript API on PostgreSQL. Signing goes through a certified cloud control system instead of a box at every till. Development is paired with Claude Code, phase by phase, using the prompts in this doc.
- **Outcome:** a pilot register live in one restaurant first, then all five, each register registered with Skatteverket under its own designation (kassabeteckning).

The biggest decision is ownership. If we write the register software ourselves, we are its manufacturer and must issue the manufacturer declaration. The alternative is to build only the back office on top of an already-declared register. See Market landscape and Risks and open questions.

**Why build at all?** The Swedish market already has mature restaurant registers (Caspeco/Trivec, Ancon, Munu, Yabie, Onslip, WEIQ, Zettle). For our group, building our own only makes sense if it gets us at least one of these:

1. **One group view we control.** Five companies, each with separate books, still need one owner dashboard with our own KPIs, without paying per-site fees for a "chain" tier.
2. **Lower running cost at our scale.** Ten or more registers at 500–1,000 kr a month each, plus add-ons, is a recurring cost we can partly replace (see Build versus buy cost).
3. **Owning the data and the roadmap.** We decide on integrations (accounting, booking, delivery) instead of waiting for a vendor.

If none of these matters enough, the recommended fallback is to **buy a declared register and build only the back office and group reporting** on its API.

## Scope change: a SaaS platform (12 November 2026)

The platform is now sold to restaurant owners, not only run for one group.

- **Platform admin (us):** approves new companies, suspends them if needed, and sees each company's status and usage (branches, registers, staff count, last sale, 30-day sales total). The console never shows receipts, menus or staff details: owners' business data stays theirs.
- **Owners sign up themselves** with company name, organisation number and first restaurant. A new company starts *pending*: the owner can set up menu, staff, branches and registers at once, but the tills can't sell until we approve. One owner can register several companies, and each company can have several restaurants.
- **Owners and managers** run their own companies in the back office: branches, registers, menu and prices, staff and PINs, Z-report history and a change log.
- **Consequence:** because we sell the register software, we are its manufacturer and must issue the manufacturer declaration. Buying a declared register is no longer a fallback. We also become a personal-data processor for every customer and need a data processing agreement (DPA) with each.

## Swedish compliance requirements

Every register needs a manufacturer declaration, a connection to a certified control unit or cloud control system, and a unique kassabeteckning. From 1 January 2027 it must also be able to export its journal as XML. The requirements below are what the software has to enforce.

| Requirement | What the software must do | Source |
| --- | --- | --- |
| Obligation to use a register | Record every cash, card and Swish sale. The obligation applies once a business's sales exceed four price base amounts a year. | [Skatteverket](https://www.skatteverket.se/foretag/drivaforetag/kassaregister), [fiskaly](https://www.fiskaly.com/blog/fiskaly-sign-se-launch-sweden-cash-register) |
| Manufacturer declaration | The register must be manufacturer-declared. Skatteverket does not test registers; the manufacturer is responsible. | [Skatteverket](https://www.skatteverket.se/foretag/drivaforetag/kassaregister) |
| Control unit or system | Send every receipt to a certified control unit or cloud control system. Print the returned control code on the receipt. | [Skatteverket](https://www.skatteverket.se/foretag/drivaforetag/kassaregister), [fiskaly](https://www.fiskaly.com/blog/fiskaly-sign-se-launch-sweden-cash-register) |
| Unique kassabeteckning | Give each register a unique designation and print it on receipts, X reports and Z reports. A shared device counts as a separate register for each company using it. | [Skatteverket FAQ](https://www.skatteverket.se/foretag/etjansterochblanketter/svarpavanligafragor/kassaregister/anvandakassaregister/hurangerjagkassabeteckningvidgemensammakassaregister.5.70ac421612e2a997f858000103311.html) |
| Separation between companies | Keep each company's registrations securely separate, even on shared hardware. | [Skatteverket FAQ](https://www.skatteverket.se/foretag/etjansterochblanketter/svarpavanligafragor/kassaregister/anvandakassaregister/hurangerjagkassabeteckningvidgemensammakassaregister.5.70ac421612e2a997f858000103311.html) |
| Receipts | Produce and offer a receipt for every sale. Stored sales data must be unchangeable afterwards. | [Bokio](https://www.bokio.se/blogg/nya-krav-for-kassaregister/) |
| Registration with Skatteverket | Each business notifies Skatteverket of its registers, and must report a replacement system within two weeks. | [Skatteverket](https://www.skatteverket.se/fordigsomar/foretagare/kassaregister/anmalantillskatteverket.4.69ef368911e1304a62580008748.html), [Bokio](https://www.bokio.se/blogg/nya-krav-for-kassaregister/) |
| Updated technical rules | From 1 January 2027, every register must meet the technical rules as amended by SKVFS 2021:17. That regulation is an amendment of SKVFS 2014:9, not a standalone replacement. | [Skatteverket](https://www.skatteverket.se/foretag/drivaforetag/kassaregister), [lagen.nu](https://lagen.nu/skvfs/2021:17) |
| XML journal export | From 1 January 2027, a register with a journal memory must export it as a UTF-8 XML file in the format set by SKVFS 2021:16, validated against Skatteverket's published XML schema. | [lagen.nu SKVFS 2021:16](https://lagen.nu/skvfs/2021:16), [Skatteverket for manufacturers](https://www.skatteverket.se/foretag/drivaforetag/kassaregister/fortillverkareochleverantorer.4.6efe6285127ab4f1d2580006050.html) |

The detailed rules on receipt fields, X/Z report content and journal events are in [SKVFS 2014:9](https://www.skatteverket.se/download/18.3aa8c78a1466c5845874ba/1708608280801/SKVFS2014-09.pdf) as amended by [SKVFS 2021:17](https://lagen.nu/skvfs/2021:17) (technical requirements). The XML format is in [SKVFS 2021:16](https://lagen.nu/skvfs/2021:16), and the rules on using registers are in [SKVFS 2021:18](https://lagen.nu/skvfs/2021:18). Skatteverket's XML schema package is on its [page for manufacturers](https://www.skatteverket.se/foretag/drivaforetag/kassaregister/fortillverkareochleverantorer.4.6efe6285127ab4f1d2580006050.html). Claude Code should work from those texts, not from memory. Skatteverket has also [asked for a wider review](https://skatteverket.se/download/18.70685bee19c85dd5dd02aeb/1773751310702/utredning-om-en-oversyn-av-reglerna-om-kassaregister.pdf) of the rules. It sets no dates yet, so it does not change this plan.

## Market landscape (Sweden, November 2026)

Swedish restaurants already have plenty of compliant registers. Most competitors will also ship the 2027 XML export as an update, so compliance alone is not an advantage. Our case rests on cost at group scale, group reporting and data ownership.

| Product | Positioning | Price signal (indicative) | Strengths | Gaps for our case |
| --- | --- | --- | --- | --- |
| **Caspeco** (incl. **Trivec**) | Market leader for full-service restaurants. Caspeco bought Trivec in June 2025 and now serves about 6,500 restaurants in the Nordics and Benelux/France. | Quote only, bundled pricing across modules ([Caspeco](https://caspeco.com/en/)) | Register, booking, staff scheduling, analytics and kitchen screens in one suite; chain features | Expensive and bundled; lock-in; two platforms are still being merged after the acquisition ([Caspeco press release](https://caspeco.com/en/articles/caspeco-acquires-trivec/)) |
| **Ancon** | Long-standing Swedish restaurant register (founded 1985, Uddevalla), cloud-based | From about 525 kr/month per register ([Kassaguiden](https://www.kassaguiden.se/jamforelse-kassasystem/basta-kassasystem-restaurang)) | Restaurant-specific, strong local support | Less flexible for custom group reporting |
| **Munu** | Nordic all-in-one: register, payments, booking, kitchen, reporting | Quote only (no public price list found) | One flow from order to kitchen to report | Pricing not public |
| **Yabie** (Go / Express) | Small to mid-sized restaurants | From about 899 kr/month ([Kassaguiden](https://www.kassaguiden.se/jamforelse-kassasystem/basta-kassasystem-restaurang)) | Table booking, split bills, Fortnox integration ([Yabie](https://yabie.com/branscher/kassasystem-restaurang/)) | Per-register cost grows with 5 sites |
| **Onslip** | Budget all-industries register with restaurant package | 329 / 529 / 829 kr/month tiers, 12-month term on lower tiers ([Onslip](https://www.onslip.com/kassasystem-restaurang/)) | Cheap, quick to start | Generic, limited group analytics |
| **WEIQ** | Low-cost restaurant register with QR ordering | Free tier; Easy from 250 kr; Pro from 750 kr/month ([WEIQ](https://weiq.tech/en/)) | QR and online ordering in Pro tier | Built for single sites |
| **Zettle** (PayPal) | Card reader with basic register | 0 kr/month (app) or about 299 kr/month with terminal; about 1.75–1.85% per card transaction ([Vstudio](https://www.vstudio.se/post/kassasystem-restaurang-sverige)) | Very cheap entry, payments built in | No table service or kitchen flow; not for full-service restaurants |
| **Lightspeed Restaurant** | International cloud register | Quote / per-user | Mature product, strong integrations | Limited Swedish presence and support |

Prices come from vendor and comparison sites, several of them biased, and change often. Get written quotes from at least Caspeco, Ancon and Yabie before the build-versus-buy decision.

**What the market tells us**

- **Table stakes:** table and split-bill handling, kitchen printing or a kitchen screen, card terminal integration, Swish, accounting export (Fortnox/Visma via SIE), and multi-register reporting. Without kitchen printing and accounting export, our v1 is weaker than a 300 kr/month product.
- **Differentiation available to us:** a group dashboard across five companies that keeps their records separate, menu and price pushed from one place to all sites, and no per-site licence fees.
- **Consolidation risk works in our favour:** after the Caspeco–Trivec merger, Trivec customers face a platform migration. Owning our stack avoids being moved on a vendor's timeline.

### Build versus buy cost (5 restaurants, about 10 registers)

These are estimates for comparison only. Replace them with real quotes.

| Item | Buy (declared register) | Build (this plan) |
| --- | --- | --- |
| Register licences | ~10 × 500–900 kr/month ≈ **60,000–110,000 kr/year** | 0 |
| Add-ons (booking, kitchen screen, analytics, chain tier) | Often extra per site | Built as needed |
| Cloud control system | Usually included | Per-register fee to the provider (e.g. fiskaly). Get a quote. |
| Hosting (EU) | Included | ~500–1,500 kr/month |
| Development | 0 | One developer part-time with Claude Code for about 6–9 months |
| Compliance and legal | Vendor's responsibility | Manufacturer declaration, review by a cash-register consultant or accountant, ongoing rule changes |
| Hardware | Tablets, printers, card terminals | Same |

**Reading this:** buying is cheaper in year one. Building pays back only over several years, and only if the group grows or the back office creates value a vendor can't. The hybrid option (buy registers, build the group back office on the vendor's API) has the lowest risk and captures most of the reporting benefit.

## Scope, goals and non-goals

Version 1 covers what a restaurant needs to sell legally and close the day. Everything else waits until all five sites are live.

**Goals for v1**

- Tenant isolation: five restaurants on one platform. No user, query or report can see another restaurant's sales.
- Registers: several registers per restaurant, each with its own kassabeteckning and its own unbroken receipt series.
- Selling: menu with VAT rates (12% food, 25% alcohol), tables or quick orders, card, cash and Swish recorded as payment types.
- Compliance: signing through the control system, control code on every receipt, X and Z reports, copy receipts, returns, training mode, an append-only journal and XML export.
- Kitchen: order tickets to a kitchen printer per station (bar, kitchen). Competitors treat this as standard.
- Accounting: daily SIE export per company (sales per VAT rate and payment method) for Fortnox or Visma, so accountants don't retype Z reports.
- Back office: menu and price management pushed to all sites from one place, staff and roles, daily sales per restaurant, and a group view for the owner.

**Success metrics**

| Metric | Target |
| --- | --- |
| Pilot Z reports match the old register | 7 consecutive days, to the öre |
| Receipt numbering | 0 gaps or duplicates (nightly check) |
| Time to ring up a 4-item order | ≤ the current register (measured at the pilot) |
| XML export | Validates against Skatteverket's schema for every register before 1 January 2027 |
| Running cost | Below the lowest buy quote per register per month by month 12 |
| Group reporting | Owner sees yesterday's sales for all five sites by 07:00 |

**Non-goals for v1**

- Building our own control unit. We buy a certified cloud control system.
- Payment terminal integration. Card payments are taken on the existing terminal and recorded by type. This is the largest gap against competitors and the first v2 item.
- Online and QR ordering, delivery platforms, table booking, loyalty, staff scheduling and stock control. Where needed, integrate with a specialist (for example a booking system) instead of building it.

## Architecture and tech stack

One API serves every restaurant. It sets the tenant on each request and is the only part allowed to write sales, so the compliance rules live in one place.

&#91;embedded content: system architecture · 2 apps, 1 API, 3 back-end parts\]

The tills run as a PWA on tablets and talk to the API. Signing uses a certified cloud control system ([fiskaly SIGN SE](https://www.fiskaly.com/blog/fiskaly-sign-se-launch-sweden-cash-register) is one option), so there is no hardware box at each till. Stack: React + TypeScript + Vite, Node + Fastify + TypeScript, PostgreSQL 16, and Docker, hosted in an EU region. If the internet drops, the till takes no new sales until the control system answers; any offline mode needs the provider's and an accountant's approval first.

## Data model

Every tenant-owned table carries `tenant_id`, including child tables such as `receipt_lines` and `payments`, and PostgreSQL row-level security enforces it. Child rows reference their parent by (`tenant_id`, `id`), so a row can never point at another tenant's data. The schema is in `apps/api/db/migrations`. Primary keys are generated UUIDs. The organisation number is a unique, validated attribute, never a key.

| Table | Purpose | Key columns and rules |
| --- | --- | --- |
| `tenants` | One row per restaurant company | `id` UUID PK, `legal_name`, `org_number` (unique, Luhn-checked), `vat_number`, `status` |
| `restaurants` | A physical site under a tenant | `id`, `tenant_id`, `name`, `address`. One tenant can own more than one site later. |
| `cash_registers` | One registration unit | `id`, `tenant_id`, `restaurant_id`, `designation` (kassabeteckning, unique per tenant), `control_system_ref`, `status` (active, retired), `registered_with_skv_at` |
| `register_sequences` | Gapless counters for one register | (`register_id`, `name`) PK, `next_value`. One row per series: `receipt:<kind>`, `z_report`, `journal`. Incremented with `SELECT … FOR UPDATE` in the same transaction as the row that uses the number, so there are no gaps or duplicates. |
| `receipts` | Sale, return, copy, training or proforma | `id`, `tenant_id`, `register_id`, `receipt_number`, `type`, `created_at`, `total_incl_vat`, `control_code`, `signed_at`. Unique on (`register_id`, `type`, `receipt_number`). No UPDATE or DELETE is granted. |
| `receipt_lines` | Items on a receipt | `receipt_id`, `article_id`, `quantity`, `unit_price`, `vat_rate`, `discount` |
| `receipt_vat_totals` | VAT per rate per receipt | `receipt_id`, `vat_rate`, `net`, `vat` |
| `payments` | How a receipt was paid | `receipt_id`, `method` (cash, card, swish, gift card), `amount` |
| `z_reports` | End-of-day close per register | `id`, `register_id`, `z_number` (own series), `period_from`, `period_to`, totals by VAT rate and payment method, counts of returns, copies, training and drawer openings |
| `journal_events` | Append-only journal for XML export | `id`, `tenant_id`, `register_id`, `seq`, `event_type`, `payload` JSONB, `hash`, `prev_hash` |
| `articles`, `menu_groups` | Menu per restaurant | `tenant_id`, `restaurant_id`, `name`, `price`, `vat_rate`, `active` |
| `users`, `memberships` | Staff and roles | A user can belong to several tenants. `role` is owner, manager or cashier. |

X reports are calculated on demand and logged as a journal event, not stored as rows. Corrections are made only by new receipts, such as a return, never by editing an old one.

## Delivery plan

The nine Claude Code phases group into four stages. A stage starts only when the gate before it passes, so a compliance problem is found before the apps are built on top of it.

&#91;embedded content: delivery roadmap · 4 stages, 3 gates\]

These weeks are estimates for one developer working part-time with Claude Code. The pilot restaurant keeps its current register running in parallel until its Z reports match for a full week.

## Claude Code setup

Claude Code works best with a monorepo, a CLAUDE.md file that states the compliance rules, and a short loop of plan, test, build and review for every feature.

**Repo layout**

- `apps/pos`: React + TypeScript + Vite PWA for the till
- `apps/backoffice`: React + TypeScript admin
- `apps/api`: Node + TypeScript (Fastify), Prisma or Drizzle, PostgreSQL
- `packages/domain`: pure TypeScript for money, VAT, receipt numbering and reports, with no I/O
- `packages/control-system`: an adapter interface plus a fake implementation for tests
- `docs/compliance`: PDFs of the Skatteverket rules and your notes on them

**CLAUDE.md starter** (save at the repo root)

```markdown
# Restaurant POS – rules for Claude

## Domain rules (never break)
- Every sales table has tenant_id; all queries go through the tenant-scoped repository. Postgres RLS is on.
- Primary keys are UUIDs. org_number is an attribute, never a key.
- Each cash register has a unique designation (kassabeteckning) printed on receipts, X and Z reports.
- Receipt numbers: one gapless series per register, allocated inside the same DB transaction as the receipt.
- Receipts, journal_events and z_reports are append-only. Corrections = new receipts (returns), never UPDATE/DELETE.
- Money is integer öre. Never floats. VAT rates: 25, 12, 6, 0.
- Every receipt is signed by the control system before it is printed; no control code, no receipt.
- Compliance texts live in docs/compliance. Cite them; don't invent requirements.

## Workflow
- Plan first, wait for approval on schema or compliance changes.
- Write failing tests before implementation for anything in packages/domain.
- Run `pnpm lint && pnpm typecheck && pnpm test` before saying a task is done.
- Small commits, one feature per branch, conventional commit messages.
```

**Working loop for each feature**

1. Start in plan mode and ask for a plan. Review it, especially schema and compliance changes.
2. Have Claude write the failing tests, then the code to pass them.
3. Run `/review` or a fresh session on the diff before merging.
4. Update CLAUDE.md whenever you correct Claude twice about the same thing.

## Claude Code prompts

Paste these in order, one phase per branch. Each prompt asks for a plan first, so you can approve it before code is written.

**Phase 0: Scaffold**

```text
Read CLAUDE.md. Scaffold a pnpm monorepo with apps/pos, apps/backoffice (React + TS + Vite), apps/api (Fastify + TS), packages/domain and packages/control-system. Add ESLint, Prettier, Vitest, a docker-compose with Postgres 16, and a GitHub Actions workflow running lint, typecheck and tests. Show me the plan and the folder tree before creating files.
```

**Phase 1: Tenancy and schema**

```text
Using the Data model section of docs/proposal.md, design the Postgres schema and migrations for tenants, restaurants, cash_registers, receipt_series, receipts, receipt_lines, receipt_vat_totals, payments, z_reports, journal_events, articles, users and memberships. Requirements: UUID primary keys; org_number unique and validated with the Swedish Luhn check but never a key; designation unique per tenant; row-level security on every table with tenant_id, driven by a session setting app.tenant_id; revoke UPDATE and DELETE on receipts, receipt_lines, payments, z_reports and journal_events from the app role. Write integration tests proving tenant A cannot read tenant B's receipts and that updating a receipt fails. Plan first.
```

**Phase 2: Domain core**

```text
In packages/domain, with tests first: money as integer öre; VAT calculation per line and per rate (25/12/6/0) with Swedish rounding; a receipt builder for types sale, return, copy, training and proforma; Z-report aggregation (totals per VAT rate and payment method, counts of returns, copies, training receipts, drawer openings); a hash-chained journal event. No database or HTTP code in this package. Cover edge cases: mixed VAT, full and partial returns, discounts, 0 kr receipts.
```

**Phase 3: Receipt numbering and the sale flow**

```text
Implement POST /registers/:id/receipts in apps/api. In one transaction: lock receipt_series FOR UPDATE, allocate the next number, build the receipt with packages/domain, call the ControlSystem adapter to sign it, store receipt, lines, VAT totals, payments and a journal event, then commit. If signing fails, roll back and return a clear error: no unsigned receipts. Write a concurrency test with 50 parallel sales on one register that proves numbers are unique and gapless, and a test that two registers keep independent series.
```

**Phase 4: Control system adapter**

```text
In packages/control-system define a ControlSystem interface (registerRegister, signReceipt, getStatus) and a FakeControlSystem for tests. Then write a real adapter for the cloud control system we choose, using its sandbox API documentation, which I will paste into docs/compliance/control-system-api.md. Handle timeouts, retries with idempotency keys, and an offline queue rule we agree on. Plan first and list the questions the docs don't answer.
```

**Phase 5: X/Z reports and journal export**

```text
Add X report (on demand, logged as a journal event) and Z report (closes the period, own gapless z_number per register) endpoints, both printing tenant legal name, org_number, register designation and all totals required by SKVFS 2014:9 as amended by SKVFS 2021:17, both in docs/compliance. Then implement the UTF-8 XML journal export required from 1 January 2027 in the format set by SKVFS 2021:16, validating against Skatteverket's XML schema in docs/compliance/xml-schema. Also add a daily SIE export per tenant (sales per VAT rate and payment method). Add a test that the export of a sample day validates and the hash chain verifies.
```

**Phase 6: POS front end**

```text
Build apps/pos as a touch-first PWA: login by PIN, pick register, menu grid by group, order basket with quantity and discount, pay by cash/card/Swish, print or show receipt with control code and designation, split bill by item or amount, send order tickets to kitchen and bar printers, returns from an existing receipt, X and Z report buttons for managers, and a visible TRAINING MODE banner. Make it work at 1024×768 and on a 10-inch tablet. Use a receipt-printer abstraction with an ESC/POS implementation and a PDF fallback.
```

**Phase 7: Back office**

```text
Build apps/backoffice: tenant and restaurant setup, register management (create, set designation, retire, never delete), menu and VAT management per restaurant, staff and roles, daily sales and Z-report history per register, and an owner view that totals all five restaurants without mixing their records. Every admin action writes an audit entry.
```

**Phase 8: Hardening and review**

```text
Act as a reviewer who has not seen this code. Check: any query missing tenant scoping, any path that can create an unsigned or unnumbered receipt, any UPDATE/DELETE on append-only tables, float money, missing designation on receipts or reports, and secrets in the repo. Produce a findings list ranked by severity, then fix them one by one with tests.
```

## Risks, open questions and next steps

The largest risk is legal, not technical: a self-built register is only usable once its manufacturer declaration and control-system connection are in place.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Manufacturer responsibility | We must declare the register meets SKVFS 2014:9. A wrong declaration exposes all five restaurants. | Have a Swedish cash-register consultant or accountant review the declaration. The fallback is a declared register with our back office on top. |
| Control-system dependency | No signing means no sales. | Check the provider's SLA, test outage behaviour early in Phase 4, and keep a paper fallback routine approved by the accountant. |
| Receipt numbering bugs | Gaps or duplicates fail an inspection. | Database-level uniqueness, the concurrency test in Phase 3, and a nightly gap-check job. |
| Tenant data leak | One restaurant sees another's sales. | Row-level security plus repository scoping, and isolation tests in CI. |
| Deadline | Older registers may be used only until 31 December 2026; XML export is required from 1 January 2027. That is seven weeks from this proposal, too soon for our pilot. | Confirm that every restaurant's current register vendor has shipped the 2027 update and test its XML export now. Our system replaces them later, not before the deadline. |
| Feature gap against competitors | Staff compare us with Caspeco, Yabie and others that have card terminal integration, kitchen screens and booking. A thinner product gets rejected at the sites. | Keep kitchen printing, split bills and SIE export in v1. Plan card terminal integration as v2. Run the pilot with real staff and track order time. |
| Cost case doesn't hold | Development and compliance time exceeds licence savings. | Get real quotes before Phase 1. Review at Gate 1 and switch to the hybrid option if the payback period is over three years. |
| Regulation changes | Skatteverket's ongoing review may change the rules again. As manufacturer, we must follow. | Keep compliance logic in packages/domain, track Skatteverket news, and budget time each year for rule updates. |

**Open questions**

- [ ] Is each restaurant a separate company with its own organisation number, or are some sites under one company?
- [ ] Build our own register (we become the manufacturer) or buy a declared register and build only the back office?
- [ ] Which cloud control system: fiskaly SIGN SE or another certified provider on [Skatteverket's list](https://www.skatteverket.se/foretag/drivaforetag/kassaregister)?
- [ ] Which receipt printers and tablets are already in the restaurants?
- [ ] Which registers do the five restaurants use today, what do they cost, and when do their contracts end?
- [ ] Do the current vendors offer an API good enough for the hybrid option (back office only)?

**Next steps**

1. Collect current register contracts and request quotes from Caspeco, Ancon and Yabie for 5 sites and about 10 registers.
2. Fill in the Build versus buy cost table with real numbers and decide build, buy or hybrid.
3. Download SKVFS 2014:9, 2021:16, 2021:17, 2021:18 and Skatteverket's XML schema package into `docs/compliance`.
4. Open a control-system sandbox account and get its per-register price.
5. Run the Phase 0 prompt.
