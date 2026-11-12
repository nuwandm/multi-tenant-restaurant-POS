# Testing from scratch

Run these in a PowerShell terminal in the project folder.

1. **Start Docker Desktop** and wait for "Engine running".
2. **Install packages:** `pnpm install` → `Done in … using pnpm`
3. **Settings file (first time only):** `Copy-Item .env.example .env`
4. **Start the database:** `pnpm db:up` → `Container …-postgres-1  Healthy`
5. **Create the tables:** `pnpm db:migrate` → `Applied: …` or `Database is up to date`
6. **Run all tests:** `pnpm test` → every package reports `Tests  N passed`
7. **See tenant isolation:**
   `Get-Content apps/api/db/demo-rls.sql | docker compose exec -T postgres psql -U pos -d pos`
   - Section 1 shows only Restaurang A AB; section 2 only Restaurang B AB.
   - Sections 3 and 4 show an `ERROR`. That is the expected result: receipts can't be edited and invalid org numbers are rejected.
8. **Open the app:** run `pnpm dev:api` in one terminal and `pnpm dev:pos` in another, then open http://localhost:5173. You should see "Kassa" and "API ok · control system online". Stop with Ctrl+C.

9. **Make a real sale through the API:**
   - Load demo data once: `Get-Content apps/api/db/seed-dev.sql | docker compose exec -T postgres psql -U pos -d pos`
   - Start the API: `pnpm dev:api`
   - In a second terminal: `powershell -ExecutionPolicy Bypass -File apps/api/db/demo-sale.ps1`
   - You get a printed receipt for Demo Restaurang AB: 332,50 kr, cash rounding 0,50 kr, paid 333 kr cash, and a control code. Run it again and the receipt number goes up by one.

10. **Log in and close the day in the till (http://localhost:5173):**
    - **Pair the till first (once per device):** in the back office (step 11) log in as Anna → **Restauranger & kassor** → **Koppla enhet** at KASSA-1. Type the 8-character code on the till's pairing screen.
    - Log in: tap **Anna** (manager, PIN 1234) or **Erik** (cashier, PIN 0000). Five wrong PINs lock that person for 5 minutes. Erik sees no Z-rapport button and cannot make returns.
    - **Kvitton:** pick a sale → **Skriv kopia** prints a receipt marked KOPIA; **Retur…** lets you choose how many of each line to return and how to refund. A line can never be returned twice.
    - **X-rapport:** totals since the last Z report; nothing is closed.
    - **Z-rapport:** closes the period with a Z number. Sell again and take another Z: it only contains the new sales, and the grand totals keep growing.

11. **Back office (`pnpm dev:backoffice`, http://localhost:5174):**
    - **As a platform admin:** log in as `admin@demo.local` / `demo-admin-2026` → **Plattform** lists every company with status and usage, and lets you approve or suspend.
    - **As a manager:** log in as `anna@demo.local` / `demo-anna-2026` → **Översikt** (today's sales), **Restauranger & kassor**, **Meny** (click a name or price to change it), **Personal**, **Z-rapporter**, **Ändringslogg**.
    - **As a new owner:** log out → **Registrera ditt företag**. The company is _pending_: set up menu, staff and a register, then approve it as the platform admin.
    - Create your own platform admin: `pnpm platform:admin you@example.com "Your Name"` prints a one-time password.

12. **Restaurant features (run `pnpm db:migrate` first):**
    - **Set up (back office as Anna):** **Restaurants & registers** → add tables (1, 2, Terrace 1). **Menu** → **Options** tab → add a group _Size_ (min 1, max 1) with _Small_ (0) and _Large_ (+15), and _Extras_ (min 0, max 3) with _Bacon_ (+12). On the **Items** tab, link them to a dish and set **Ticket** to Kitchen for food and Bar for drinks.
    - **Options:** at the till, tap that dish: you must pick a size before **Add** works. The line shows the choices and the price includes the extras.
    - **Discounts:** tap a line → discount in kr or %. The % button above the total gives a discount on the whole order. The receipt shows the discount and the VAT is still right.
    - **Tables:** **Tables** → pick a table → add items → **Send to kitchen**. Open the **Kitchen display** (user menu) on another tab: a ticket for the table appears, bar items get their own ticket. Tap a ticket to mark it done.
    - **Split bill:** with a table open, **Split** → _By items_ to pay part of the order (the rest stays on the table), or _By amount_ to pay with card plus cash. Pay the last part and the table becomes free.
    - **Reports:** back office → **Sales** shows totals, sales per day and hour, payment methods, best sellers and VAT for today, 7 days, 30 days or this month.

13. **Swish by QR code (run `pnpm db:migrate` first):**
    - Back office → **Restaurants & registers** → **Add Swish number** → `1231181189` (any 10 digits starting with 123 work in the simulator).
    - Till: reload the page, add items, tap **Swish**. A QR code appears and the till waits. Tap **Guest pays** in the simulator box: the receipt is made. Try **Guest declines** and **Cancel payment** too.
    - **Split** → _By amount_ with one Swish part and one cash part: the QR code is shown for the Swish part only.
    - No money moves: `SWISH_MODE` is `simulator` unless you set it (see `.env.example`).

After the first time, `pnpm db:up` and `pnpm test` are enough.

## Troubleshooting

| You see                                           | Fix                                                           |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `error during connect … dockerDesktopLinuxEngine` | Docker Desktop isn't running (step 1)                         |
| `Cannot reach Postgres at …`                      | `pnpm db:up`                                                  |
| `port is already allocated` / `EADDRINUSE`        | Another copy is running; close other terminals                |
| Need a fresh database                             | `docker compose down -v`, then steps 4–5 (deletes local data) |
