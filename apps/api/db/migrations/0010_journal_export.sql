-- What the journal export (SKVFS 2021:16) needs that we did not store yet.

-- The register's manufacturing number (tillverkningsnummer, 2 kap. 23 § SKVFS 2014:9) and the
-- control system's (8 kap. 37 § SKVFS 2020:9, 17 characters). New registers get both when they
-- are created; existing ones get a generated number now.
ALTER TABLE cash_registers
  ADD COLUMN manufacturing_number text
    DEFAULT ('RP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  ADD COLUMN control_system_serial text CHECK (length(control_system_serial) = 17);
UPDATE cash_registers SET manufacturing_number = DEFAULT WHERE manufacturing_number IS NULL;
ALTER TABLE cash_registers ALTER COLUMN manufacturing_number SET NOT NULL;
ALTER TABLE cash_registers ADD CONSTRAINT cash_registers_manufacturing_number_key
  UNIQUE (manufacturing_number);
UPDATE cash_registers SET control_system_serial = 'FAKE' || upper(substr(md5(id::text), 1, 13))
  WHERE control_system_ref IS NOT NULL;

-- The seller as printed on the receipt (7 kap. 1 § a–b SKVFS 2014:9). Receipts never change,
-- so a later change of name or address must not change old receipts. Older receipts have none
-- and fall back to the current values.
ALTER TABLE receipts
  ADD COLUMN seller_name text,
  ADD COLUMN seller_org_number text,
  ADD COLUMN seller_address text;

-- Z report totals the export requires (25 kap. SKVFS 2021:16).
ALTER TABLE z_reports
  ADD COLUMN discount_total_ore bigint NOT NULL DEFAULT 0,
  -- Antal sålda varor (7 kap. 3 § j SKVFS 2014:9).
  ADD COLUMN items_sold_count int NOT NULL DEFAULT 0,
  -- Växelkassa: no cash float is kept yet.
  ADD COLUMN float_ore bigint NOT NULL DEFAULT 0,
  -- Other registrations that reduced the day's sales (deleted items): not registered yet.
  ADD COLUMN reducing_count int NOT NULL DEFAULT 0,
  ADD COLUMN reducing_total_ore bigint NOT NULL DEFAULT 0,
  -- Sales started but not finished when the report was taken: open table orders.
  ADD COLUMN unfinished_count int NOT NULL DEFAULT 0,
  ADD COLUMN unfinished_total_ore bigint NOT NULL DEFAULT 0;

-- The register an open order was started on, so each register reports its own unfinished
-- sales. NULL for orders from before this change.
ALTER TABLE open_orders ADD COLUMN register_id uuid;
ALTER TABLE open_orders ADD CONSTRAINT open_orders_register_fk
  FOREIGN KEY (tenant_id, register_id) REFERENCES cash_registers (tenant_id, id);
