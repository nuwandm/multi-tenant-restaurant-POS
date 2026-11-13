# Roadmap: closing the gap to Ancon

Status on 13 November 2026. Goal: everything Ancon (ancon.io) advertises that we don't have, built in phases, most important first. Each phase is finished, tested and documented before the next one starts.

Some items need a contract, an account or hardware before they can go live. For those we build the integration with a simulator (as with Swish), then switch on once the account exists. They are marked **[needs account]** or **[needs hardware]**.

## Before phase 2: finish checking phase 1

Phase 1 is written but the API tests have not run yet, because Docker Desktop was not running.

1. Start Docker Desktop.
2. `pnpm db:migrate` (applies `0010_journal_export.sql`).
3. `pnpm lint && pnpm typecheck && pnpm test` — all must pass. The new test is `apps/api/src/journal/journal.test.ts`.
4. Add an address to every existing restaurant (back office → Restaurants & registers → pencil). Without it the till refuses to sell.
5. Try step 14 in `docs/TESTING.md`: sell, switch training mode, copy, return, X and Z report, then download the journal export.
6. Commit phase 1 (branch `feat/swish-refunds` currently holds it; move it to its own branch such as `feat/journal-export` if you prefer).

Known limits of phase 1:

- Receipts made before migration 0010 have old fake control codes and cannot be exported. Test with new sales.
- X reports taken before phase 1 have no stored totals and are left out of the export (development data only).
- Product name, program and version for the manufacturer declaration are placeholders in `apps/api/src/journal/product.ts`.

## Phase 1: legal basis — written, waiting for test run

What changed:

| Area               | Change                                                                                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Compliance sources | Skatteverket's XML schema in `docs/compliance/xml-schema/`; interpretations in `docs/compliance/notes.md`                                                                                                                                                                                                                      |
| Domain             | `journal-export.ts`: builds the SKVFS 2021:16 XML, tested against Skatteverket's schema. Z reports gained discount total and items sold                                                                                                                                                                                        |
| Control system     | Fake codes are 59 characters; enrolment returns the control system's 17-character serial                                                                                                                                                                                                                                       |
| Database (0010)    | Register manufacturing number and control system serial; seller snapshot on receipts; new Z report totals; open orders remember their register                                                                                                                                                                                 |
| API                | Selling requires the restaurant address; receipts store the seller as printed; X/Z reports include discounts, items sold, cash float, deleted items, unfinished sales; logins, logouts and training-mode switches are journaled; `GET /admin/tenants/:t/journal-export` downloads the XML after checking it against the schema |
| Till               | Address on receipts; new X/Z report lines; training-mode switch sent to the API                                                                                                                                                                                                                                                |
| Back office        | Journal export page; edit restaurant name and address; change log entry for exports                                                                                                                                                                                                                                            |

Open questions for the accountant (details in `docs/compliance/notes.md`):

- Restaurant meals as goods (`VARA`) or services (`TJANST`)?
- Must items deleted before payment be journaled (phase B below)?

## Phase 2: daily operation

- Free-text and preset kitchen messages per item ("no onion", allergies).
- Hold/fire courses: hold starters or mains, release to the kitchen with one tap.
- Combined kitchen ticket for one party.
- Bar tabs: open a named tab, add to it, pay later (the API already supports orders without a table).
- Split bill equally by number of guests (we already split by items and by amount).
- Tips.
- Custom payment methods, shown on the Z report.
- Pay by invoice, with the details sent on to invoicing.
- Permission groups instead of three fixed roles (e.g. who may give discounts).
- More ticket destinations than kitchen and bar (e.g. hatch).
- Drawn table map with live status colours (we have a grid of tables).
- Phase B of the journal (if the accountant says yes): the till reports every item registered, changed or deleted, clears and table-order events; Z reports then count deleted items.

## Phase 3: hardware

- Receipt and kitchen printers (ESC/POS over the network). **[needs hardware]**
- Card terminal: adapter with a simulator, first provider Adyen or the restaurant's own. **[needs account]**
- Several terminals on one till; phone as terminal (Tap to Pay). **[needs account]**
- Scale (price per kilo) and barcode scanner. **[needs hardware]**
- Certified cloud control system instead of the fake one. **[needs account — required before any real sale]**

## Phase 4: menu and stock

- Item types and units: glass/bottle, centilitre, kilo.
- Bundles (set menus).
- Price templates by time of day or order type (happy hour, takeaway).
- Stock counts; items blocked when out of stock.
- Purchase prices, recipe costing, profit per item.

## Phase 5: guest channels

- QR ordering at the table (one QR code per table).
- Pay at the table from the phone: split, tip, email receipt.
- Online ordering for pickup, with pre-ordering and auto-accept; one order screen for all channels.
- Self-service kiosk with product photos.
- "Order ready" screen for guests.
- Upselling suggestions.
- Delivery apps (Foodora, Uber Eats, Wolt) through Deliverect. **[needs account]**

## Phase 6: loyalty

- Digital gift cards (QR).
- Loyalty programme.
- Customer register: preferences, last visit.

## Phase 7: analytics

- Period comparison (last week, same week last year, any period).
- Budgets and forecasts for sales, staff and ingredient cost.
- Staff cost as a share of sales (needs a staff system, phase 8).
- AI assistant over the restaurant's sales data (Claude), including changing prices in plain language.

## Phase 8: integrations

- SIE export and Fortnox/Visma. **[needs account for Fortnox/Visma]**
- Public API with webhooks.
- Table booking: BokaBord, Waiteraid, Easytable. **[needs account]**
- Staff systems: Personalkollen, Planday. **[needs account]**
- Stock systems: Stockifi, Apicbase. **[needs account]**

## Not code: business and legal

- Contract with a certified cloud control system provider (longest lead time; start now).
- Manufacturer declaration (tillverkardeklaration); ask Skatteverket whether a foreign maker can issue it.
- Company form: sole trader is fine for a pilot with a liability cap and insurance; an AB before the system becomes a restaurant's legal cash register.
- Swish: ask Swish or a bank about becoming a technical supplier.
- With the first client: run a pilot next to their existing register until the control system, manufacturer declaration and export are in place.
