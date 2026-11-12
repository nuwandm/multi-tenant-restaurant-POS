-- Returns need to know which original line they return, so later returns can't exceed it.
ALTER TABLE receipt_lines ADD COLUMN original_line_no int CHECK (original_line_no >= 1);

-- Z reports store every total from aggregateZReport (packages/domain), including running
-- grand totals for sales and returns separately. grand_total_ore remains the net grand total.
ALTER TABLE z_reports
  ADD COLUMN sale_count          int    NOT NULL DEFAULT 0,
  ADD COLUMN sales_total_ore     bigint NOT NULL DEFAULT 0,
  ADD COLUMN net_total_ore       bigint NOT NULL DEFAULT 0,
  ADD COLUMN cash_rounding_ore   bigint NOT NULL DEFAULT 0,
  ADD COLUMN copy_total_ore      bigint NOT NULL DEFAULT 0,
  ADD COLUMN proforma_total_ore  bigint NOT NULL DEFAULT 0,
  ADD COLUMN grand_sales_ore     bigint NOT NULL DEFAULT 0,
  ADD COLUMN grand_returns_ore   bigint NOT NULL DEFAULT 0;
