-- Manual demo of tenant isolation and append-only receipts. Runs in one transaction and rolls back,
-- so it leaves the database unchanged. Run with:
--   Get-Content apps/api/db/demo-rls.sql | docker compose exec -T postgres psql -U pos -d pos
\set ON_ERROR_STOP off
BEGIN;

-- Two restaurant companies, each with a register and one receipt (created as the app role).
SET LOCAL ROLE pos_app;
SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);
INSERT INTO tenants (id, legal_name, org_number) VALUES ('11111111-1111-1111-1111-111111111111', 'Restaurang A AB', '5560360793');
INSERT INTO restaurants (id, tenant_id, name) VALUES ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A Sodermalm');
INSERT INTO cash_registers (id, tenant_id, restaurant_id, designation) VALUES ('a0000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'KASSA-1');
INSERT INTO receipts (tenant_id, register_id, kind, receipt_number, total_incl_vat_ore, control_code, signed_at)
  VALUES ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-0000000000c1', 'sale', 1, 12900, 'CODE-A1', now());

SELECT set_config('app.tenant_id', '22222222-2222-2222-2222-222222222222', true);
INSERT INTO tenants (id, legal_name, org_number) VALUES ('22222222-2222-2222-2222-222222222222', 'Restaurang B AB', '2021005489');
INSERT INTO restaurants (id, tenant_id, name) VALUES ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'B Vasastan');
INSERT INTO cash_registers (id, tenant_id, restaurant_id, designation) VALUES ('b0000000-0000-0000-0000-0000000000c1', '22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-000000000001', 'KASSA-1');
INSERT INTO receipts (tenant_id, register_id, kind, receipt_number, total_incl_vat_ore, control_code, signed_at)
  VALUES ('22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-0000000000c1', 'sale', 1, 45000, 'CODE-B1', now());

\echo '--- 1. As restaurant A: only A''s receipt is visible'
SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);
SELECT r.receipt_number, r.total_incl_vat_ore, t.legal_name FROM receipts r JOIN tenants t ON t.id = r.tenant_id;

\echo '--- 2. As restaurant B: only B''s receipt is visible'
SELECT set_config('app.tenant_id', '22222222-2222-2222-2222-222222222222', true);
SELECT r.receipt_number, r.total_incl_vat_ore, t.legal_name FROM receipts r JOIN tenants t ON t.id = r.tenant_id;

\echo '--- 3. Editing a receipt is refused (expect ERROR: permission denied)'
SAVEPOINT s;
UPDATE receipts SET total_incl_vat_ore = 0;
ROLLBACK TO SAVEPOINT s;

\echo '--- 4. An invalid org number is refused (expect ERROR: violates check constraint)'
SAVEPOINT s;
SELECT set_config('app.tenant_id', '33333333-3333-3333-3333-333333333333', true);
INSERT INTO tenants (id, legal_name, org_number) VALUES ('33333333-3333-3333-3333-333333333333', 'Fel AB', '5560360794');
ROLLBACK TO SAVEPOINT s;

ROLLBACK;
\echo '--- Done. Everything was rolled back.'
