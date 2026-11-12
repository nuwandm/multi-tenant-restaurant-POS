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

After the first time, `pnpm db:up` and `pnpm test` are enough.

## Troubleshooting

| You see                                           | Fix                                                           |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `error during connect … dockerDesktopLinuxEngine` | Docker Desktop isn't running (step 1)                         |
| `Cannot reach Postgres at …`                      | `pnpm db:up`                                                  |
| `port is already allocated` / `EADDRINUSE`        | Another copy is running; close other terminals                |
| Need a fresh database                             | `docker compose down -v`, then steps 4–5 (deletes local data) |
