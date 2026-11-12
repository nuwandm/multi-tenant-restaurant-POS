-- Demo data for local development only. Safe to run more than once.
--   Get-Content apps/api/db/seed-dev.sql | docker compose exec -T postgres psql -U pos -d pos
-- Swedish letters are written as U&'\00F6' escapes so the file survives PowerShell piping.
BEGIN;
SET LOCAL ROLE pos_app;
SELECT set_config('app.tenant_id', 'd0000000-0000-0000-0000-000000000001', true);

INSERT INTO tenants (id, legal_name, org_number, vat_number, status)
VALUES ('d0000000-0000-0000-0000-000000000001', 'Demo Restaurang AB', '5566778899', 'SE556677889901', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO restaurants (id, tenant_id, name, address)
VALUES ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000001',
        U&'Demo S\00F6dermalm', U&'G\00F6tgatan 1, Stockholm')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address;

INSERT INTO cash_registers (id, tenant_id, restaurant_id, designation, control_system_ref)
VALUES ('d0000000-0000-0000-0000-0000000000c1', 'd0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-0000000000a1', 'KASSA-1', 'FAKE-REF-KASSA-1')
ON CONFLICT DO NOTHING;

INSERT INTO menu_groups (id, tenant_id, restaurant_id, name, sort_order)
SELECT id::uuid, 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a1', name, sort_order
FROM (VALUES
  ('d0000000-0000-0000-0000-000000000e01', U&'F\00F6rr\00E4tter', 1),
  ('d0000000-0000-0000-0000-000000000e02', U&'Varmr\00E4tter', 2),
  ('d0000000-0000-0000-0000-000000000e03', 'Dryck', 3),
  ('d0000000-0000-0000-0000-000000000e04', 'Kaffe & dessert', 4)
) AS g (id, name, sort_order)
ON CONFLICT DO NOTHING;

INSERT INTO articles (id, tenant_id, restaurant_id, menu_group_id, name, price_ore, vat_rate)
SELECT id::uuid, 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a1',
       group_id::uuid, name, price_ore, vat_rate
FROM (VALUES
  ('d0000000-0000-0000-0000-000000000b04', 'd0000000-0000-0000-0000-000000000e01', 'Toast Skagen', 14500, 12),
  ('d0000000-0000-0000-0000-000000000b05', 'd0000000-0000-0000-0000-000000000e01', U&'L\00F6ksoppa', 9500, 12),
  ('d0000000-0000-0000-0000-000000000b01', 'd0000000-0000-0000-0000-000000000e02', 'Pasta carbonara', 14900, 12),
  ('d0000000-0000-0000-0000-000000000b06', 'd0000000-0000-0000-0000-000000000e02', U&'K\00F6ttbullar med mos', 16900, 12),
  ('d0000000-0000-0000-0000-000000000b07', 'd0000000-0000-0000-0000-000000000e02', U&'Laxfil\00E9', 19500, 12),
  ('d0000000-0000-0000-0000-000000000b02', 'd0000000-0000-0000-0000-000000000e03', 'Vin glas', 11500, 25),
  ('d0000000-0000-0000-0000-000000000b08', 'd0000000-0000-0000-0000-000000000e03', U&'\00D6l 33 cl', 7900, 25),
  ('d0000000-0000-0000-0000-000000000b09', 'd0000000-0000-0000-0000-000000000e03', U&'L\00E4sk', 3500, 12),
  ('d0000000-0000-0000-0000-000000000b10', 'd0000000-0000-0000-0000-000000000e03', 'Mineralvatten', 3000, 12),
  ('d0000000-0000-0000-0000-000000000b03', 'd0000000-0000-0000-0000-000000000e04', 'Kaffe', 3450, 12),
  ('d0000000-0000-0000-0000-000000000b11', 'd0000000-0000-0000-0000-000000000e04', 'Kladdkaka', 6500, 12),
  ('d0000000-0000-0000-0000-000000000b12', 'd0000000-0000-0000-0000-000000000e04', 'Glass', 5500, 12)
) AS a (id, group_id, name, price_ore, vat_rate)
ON CONFLICT (id) DO UPDATE SET menu_group_id = EXCLUDED.menu_group_id;

-- Demo staff. PINs: Anna (manager) 1234, Erik (cashier) 0000. Hashes made with apps/api/src/auth/pin.ts.
INSERT INTO users (id, email, display_name) VALUES
  ('d0000000-0000-0000-0000-000000000f01', 'anna@demo.local', 'Anna'),
  ('d0000000-0000-0000-0000-000000000f02', 'erik@demo.local', 'Erik')
ON CONFLICT DO NOTHING;

INSERT INTO memberships (tenant_id, user_id, role, pin_hash) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000f01', 'manager',
   'scrypt$0a575bb288669e101a019c03d5306e48$fff447774eb3ecb5bfc6768a1abfe03c7e253bc98f1356978c68b70ada7be99f'),
  ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000f02', 'cashier',
   'scrypt$13390a46446428ce6c180ac93edfcba0$72de335c70722d3ff26ef507709fea034e34493a4f74b240086dd9f0aedb0174')
ON CONFLICT (tenant_id, user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, role = EXCLUDED.role;

-- Anna also logs in to the back office: anna@demo.local / demo-anna-2026
UPDATE users SET password_hash = 'scrypt$2745c53b6bf8f689845cbc5265231cd0$abe3878c3a73aee5188bf62c5f23d4dad3aa747c7ffb4db631c8de480bdd65c2'
WHERE id = 'd0000000-0000-0000-0000-000000000f01' AND password_hash IS NULL;

COMMIT;

-- Demo platform admin: admin@demo.local / demo-admin-2026. Written as the database owner,
-- like `pnpm platform:admin`, because the app role cannot write platform_admins.
INSERT INTO users (id, email, display_name, password_hash)
VALUES ('d0000000-0000-0000-0000-0000000000ad', 'admin@demo.local', 'Plattformsadmin',
        'scrypt$355d646fd93de2a6a4a9ad60b2973f4a$0dfe1e178d68c41baa9aaa0ce596954c5a733f576b7d0b1e45d6b7dcf08a757b')
ON CONFLICT DO NOTHING;
INSERT INTO platform_admins (user_id) VALUES ('d0000000-0000-0000-0000-0000000000ad') ON CONFLICT DO NOTHING;
\echo 'Seeded: tenant d0000000-0000-0000-0000-000000000001, register d0000000-0000-0000-0000-0000000000c1'
\echo 'Till: Anna (manager) PIN 1234, Erik (cashier) PIN 0000'
\echo 'Back office: anna@demo.local / demo-anna-2026 (manager), admin@demo.local / demo-admin-2026 (platform admin)'
