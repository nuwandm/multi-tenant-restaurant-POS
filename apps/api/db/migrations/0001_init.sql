-- Phase 1: tenancy and core schema. See docs/proposal.md, "Data model".
--
-- Rules enforced here, not only in application code:
--   * every tenant-owned row carries tenant_id; RLS limits pos_app to app.tenant_id
--   * child rows reference parents by (tenant_id, id), so they can't cross tenants
--   * receipts, their children, z_reports and journal_events are append-only
--   * money is bigint öre; VAT rates are 25, 12, 6 or 0

-- Application role. Has no login here: the API either logs in as a LOGIN role granted
-- pos_app (production) or does SET LOCAL ROLE pos_app per transaction (dev and tests).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pos_app') THEN
    CREATE ROLE pos_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO pos_app;

-- Helpers ---------------------------------------------------------------------

CREATE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- Luhn check, same algorithm as packages/domain/src/org-number.ts.
CREATE FUNCTION is_valid_org_number(n text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$
    SELECT CASE
      WHEN n IS NULL OR n !~ '^\d{10}$' THEN false
      ELSE (
        SELECT sum(CASE WHEN i % 2 = 1 THEN (d * 2) / 10 + (d * 2) % 10 ELSE d END) % 10 = 0
        FROM (SELECT i, substr(n, i, 1)::int AS d FROM generate_series(1, 10) AS i) AS digits
      )
    END
  $$;

CREATE FUNCTION reject_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END
  $$;

-- Tenancy ---------------------------------------------------------------------

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name  text NOT NULL,
  org_number  text NOT NULL UNIQUE CHECK (is_valid_org_number(org_number)),
  vat_number  text CHECK (vat_number ~ '^SE\d{10}01$'),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE restaurants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  name        text NOT NULL,
  address     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

-- Users can belong to several tenants, so users has no tenant_id.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE memberships (
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  role        text NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- Registers -------------------------------------------------------------------

CREATE TABLE cash_registers (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  restaurant_id           uuid NOT NULL,
  designation             text NOT NULL CHECK (designation <> ''),
  control_system_ref      text,
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  registered_with_skv_at  timestamptz,
  retired_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, designation),
  FOREIGN KEY (tenant_id, restaurant_id) REFERENCES restaurants (tenant_id, id),
  CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);

-- Gapless counters per register. One row per series: receipt:<kind>, z_report, journal.
-- Allocate with SELECT … FOR UPDATE in the same transaction as the row that uses the number.
CREATE TABLE register_sequences (
  tenant_id    uuid NOT NULL,
  register_id  uuid NOT NULL,
  name         text NOT NULL CHECK (name IN (
                 'receipt:sale', 'receipt:return', 'receipt:copy', 'receipt:training',
                 'receipt:proforma', 'z_report', 'journal')),
  next_value   bigint NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  PRIMARY KEY (register_id, name),
  FOREIGN KEY (tenant_id, register_id) REFERENCES cash_registers (tenant_id, id)
);

-- Menu ------------------------------------------------------------------------

CREATE TABLE menu_groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  restaurant_id  uuid NOT NULL,
  name           text NOT NULL,
  sort_order     int NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, restaurant_id) REFERENCES restaurants (tenant_id, id)
);

CREATE TABLE articles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  restaurant_id  uuid NOT NULL,
  menu_group_id  uuid,
  name           text NOT NULL,
  price_ore      bigint NOT NULL CHECK (price_ore >= 0),
  vat_rate       smallint NOT NULL CHECK (vat_rate IN (25, 12, 6, 0)),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, restaurant_id) REFERENCES restaurants (tenant_id, id),
  FOREIGN KEY (tenant_id, menu_group_id) REFERENCES menu_groups (tenant_id, id)
);

-- Sales (append-only) ---------------------------------------------------------

CREATE TABLE receipts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  register_id          uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('sale', 'return', 'copy', 'training', 'proforma')),
  receipt_number       bigint NOT NULL CHECK (receipt_number >= 1),
  original_receipt_id  uuid,
  cashier_user_id      uuid REFERENCES users (id),
  total_incl_vat_ore   bigint NOT NULL,
  control_code         text NOT NULL CHECK (control_code <> ''),
  signed_at            timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (register_id, kind, receipt_number),
  FOREIGN KEY (tenant_id, register_id) REFERENCES cash_registers (tenant_id, id),
  FOREIGN KEY (tenant_id, original_receipt_id) REFERENCES receipts (tenant_id, id),
  CHECK ((kind IN ('return', 'copy')) = (original_receipt_id IS NOT NULL))
);

CREATE TABLE receipt_lines (
  tenant_id       uuid NOT NULL,
  receipt_id      uuid NOT NULL,
  line_no         int NOT NULL CHECK (line_no >= 1),
  article_id      uuid,
  article_name    text NOT NULL,
  quantity        int NOT NULL CHECK (quantity <> 0),
  unit_price_ore  bigint NOT NULL,
  vat_rate        smallint NOT NULL CHECK (vat_rate IN (25, 12, 6, 0)),
  discount_ore    bigint NOT NULL DEFAULT 0 CHECK (discount_ore >= 0),
  line_total_ore  bigint NOT NULL,
  PRIMARY KEY (receipt_id, line_no),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES receipts (tenant_id, id),
  FOREIGN KEY (tenant_id, article_id) REFERENCES articles (tenant_id, id)
);

CREATE TABLE receipt_vat_totals (
  tenant_id   uuid NOT NULL,
  receipt_id  uuid NOT NULL,
  vat_rate    smallint NOT NULL CHECK (vat_rate IN (25, 12, 6, 0)),
  net_ore     bigint NOT NULL,
  vat_ore     bigint NOT NULL,
  PRIMARY KEY (receipt_id, vat_rate),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES receipts (tenant_id, id)
);

CREATE TABLE payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  receipt_id  uuid NOT NULL,
  method      text NOT NULL CHECK (method IN ('cash', 'card', 'swish', 'gift_card')),
  amount_ore  bigint NOT NULL,
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES receipts (tenant_id, id)
);

CREATE TABLE z_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  register_id         uuid NOT NULL,
  z_number            bigint NOT NULL CHECK (z_number >= 1),
  period_from         timestamptz NOT NULL,
  period_to           timestamptz NOT NULL CHECK (period_to >= period_from),
  grand_total_ore     bigint NOT NULL,
  totals_by_vat       jsonb NOT NULL,
  totals_by_payment   jsonb NOT NULL,
  return_count        int NOT NULL DEFAULT 0,
  return_total_ore    bigint NOT NULL DEFAULT 0,
  copy_count          int NOT NULL DEFAULT 0,
  training_count      int NOT NULL DEFAULT 0,
  training_total_ore  bigint NOT NULL DEFAULT 0,
  proforma_count      int NOT NULL DEFAULT 0,
  drawer_open_count   int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (register_id, z_number),
  FOREIGN KEY (tenant_id, register_id) REFERENCES cash_registers (tenant_id, id)
);

CREATE TABLE journal_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  register_id  uuid NOT NULL,
  seq          bigint NOT NULL CHECK (seq >= 1),
  event_type   text NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  payload      jsonb NOT NULL,
  hash         text NOT NULL,
  prev_hash    text,
  UNIQUE (register_id, seq),
  FOREIGN KEY (tenant_id, register_id) REFERENCES cash_registers (tenant_id, id),
  CHECK ((seq = 1) = (prev_hash IS NULL))
);

-- Append-only enforcement, also against the table owner.
CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER receipt_lines_append_only BEFORE UPDATE OR DELETE ON receipt_lines
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER receipt_vat_totals_append_only BEFORE UPDATE OR DELETE ON receipt_vat_totals
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER z_reports_append_only BEFORE UPDATE OR DELETE ON z_reports
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER journal_events_append_only BEFORE UPDATE OR DELETE ON journal_events
  FOR EACH ROW EXECUTE FUNCTION reject_change();

-- Row-level security ----------------------------------------------------------

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'restaurants', 'memberships', 'cash_registers', 'register_sequences', 'menu_groups',
    'articles', 'receipts', 'receipt_lines', 'receipt_vat_totals', 'payments', 'z_reports',
    'journal_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) '
      'WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END
$$;

-- Grants ----------------------------------------------------------------------
-- No DELETE on anything with legal history; registers are retired, articles deactivated.

GRANT SELECT, INSERT, UPDATE ON tenants, restaurants, cash_registers, menu_groups, articles, users
  TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO pos_app;
GRANT SELECT, INSERT, UPDATE ON register_sequences TO pos_app;
GRANT SELECT, INSERT ON receipts, receipt_lines, receipt_vat_totals, payments, z_reports,
  journal_events TO pos_app;
GRANT EXECUTE ON FUNCTION current_tenant_id(), is_valid_org_number(text) TO pos_app;
