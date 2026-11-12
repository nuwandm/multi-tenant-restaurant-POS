-- Phase 3: store cash rounding (öresavrundning) per receipt, so Z reports can total it.
-- Payments on a receipt sum to total_incl_vat_ore + cash_rounding_ore.
ALTER TABLE receipts ADD COLUMN cash_rounding_ore bigint NOT NULL DEFAULT 0;
