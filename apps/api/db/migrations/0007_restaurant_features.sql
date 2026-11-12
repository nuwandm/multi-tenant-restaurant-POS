-- Restaurant features: item options, kitchen stations, tables, open orders, kitchen tickets.
-- None of these are legal sales records: receipts stay the only record of a sale. They follow
-- the same tenant isolation as everything else.

-- Item options ("Size", "Extras"). A group allows between min_select and max_select options.
CREATE TABLE option_groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  restaurant_id  uuid NOT NULL,
  name           text NOT NULL CHECK (name <> ''),
  min_select     int NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select     int NOT NULL DEFAULT 1 CHECK (max_select >= 1 AND max_select >= min_select),
  sort_order     int NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, restaurant_id) REFERENCES restaurants (tenant_id, id)
);

CREATE TABLE item_options (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  group_id         uuid NOT NULL,
  name             text NOT NULL CHECK (name <> ''),
  price_delta_ore  bigint NOT NULL DEFAULT 0,
  sort_order       int NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES option_groups (tenant_id, id)
);

CREATE TABLE article_option_groups (
  tenant_id   uuid NOT NULL,
  article_id  uuid NOT NULL,
  group_id    uuid NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, group_id),
  FOREIGN KEY (tenant_id, article_id) REFERENCES articles (tenant_id, id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES option_groups (tenant_id, id)
);

-- Where an item is made. NULL: nothing to prepare (e.g. a bottle from the fridge).
ALTER TABLE articles ADD COLUMN station text CHECK (station IN ('kitchen', 'bar'));

-- Tables in a restaurant.
CREATE TABLE dining_tables (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  restaurant_id  uuid NOT NULL,
  name           text NOT NULL CHECK (name <> ''),
  sort_order     int NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  UNIQUE (restaurant_id, name),
  FOREIGN KEY (tenant_id, restaurant_id) REFERENCES restaurants (tenant_id, id)
);

-- An order being built before payment, usually on a table. Lines are a priced snapshot,
-- re-priced by the API whenever they are saved; payment re-prices again.
CREATE TABLE open_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  restaurant_id       uuid NOT NULL,
  table_id            uuid,
  created_by          uuid NOT NULL REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  lines               jsonb NOT NULL DEFAULT '[]',
  order_discount_ore  bigint NOT NULL DEFAULT 0 CHECK (order_discount_ore >= 0),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  version             int NOT NULL DEFAULT 1,
  closed_at           timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, restaurant_id) REFERENCES restaurants (tenant_id, id),
  FOREIGN KEY (tenant_id, table_id) REFERENCES dining_tables (tenant_id, id)
);
CREATE UNIQUE INDEX open_orders_one_per_table ON open_orders (table_id) WHERE status = 'open';

-- Orders for the kitchen or bar, shown on a kitchen display or printed.
CREATE TABLE kitchen_tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  restaurant_id  uuid NOT NULL,
  station        text NOT NULL CHECK (station IN ('kitchen', 'bar')),
  ticket_no      int NOT NULL,
  label          text NOT NULL,
  training       boolean NOT NULL DEFAULT false,
  open_order_id  uuid,
  receipt_id     uuid,
  created_by     uuid NOT NULL REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  done_at        timestamptz,
  lines          jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, restaurant_id) REFERENCES restaurants (tenant_id, id),
  FOREIGN KEY (tenant_id, open_order_id) REFERENCES open_orders (tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES receipts (tenant_id, id)
);
CREATE INDEX kitchen_tickets_open ON kitchen_tickets (restaurant_id, station) WHERE done_at IS NULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'option_groups', 'item_options', 'article_option_groups', 'dining_tables', 'open_orders',
    'kitchen_tickets'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) '
      'WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE ON option_groups, item_options, dining_tables, open_orders TO pos_app;
GRANT SELECT, INSERT, DELETE ON article_option_groups TO pos_app;
GRANT SELECT, INSERT ON kitchen_tickets TO pos_app;
GRANT UPDATE (done_at) ON kitchen_tickets TO pos_app;

-- Receipt lines keep the chosen options as text, so a receipt shows what was sold even after
-- the menu changes.
ALTER TABLE receipt_lines ADD COLUMN options text;
