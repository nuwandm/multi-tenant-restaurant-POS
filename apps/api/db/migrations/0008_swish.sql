-- Swish payments. The till asks Swish for a payment request, shows the guest a QR code, and only
-- makes the receipt once Swish says the money is paid. A payment attempt is not a sales record:
-- the receipt and its payments stay the only record of the sale.

-- The restaurant's Swish number (Swish Handel), 123 followed by 7 digits. NULL: no Swish here.
ALTER TABLE restaurants ADD COLUMN swish_number text CHECK (swish_number ~ '^123[0-9]{7}$');

CREATE TABLE payment_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  register_id    uuid NOT NULL,
  provider       text NOT NULL CHECK (provider IN ('swish')),
  amount_ore     bigint NOT NULL CHECK (amount_ore > 0),
  -- The number the money goes to, as it was when the request was made.
  payee          text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'paid', 'declined', 'cancelled', 'error')),
  -- The provider's id and the token the QR code is made from.
  provider_ref   text,
  token          text,
  error_code     text,
  created_by     uuid NOT NULL REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  checked_at     timestamptz,
  paid_at        timestamptz,
  -- The receipt this payment was used for. A paid attempt pays for exactly one receipt.
  receipt_id     uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES cash_registers (tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES receipts (tenant_id, id)
);
CREATE INDEX payment_attempts_register ON payment_attempts (register_id, created_at DESC);
-- Paid money that no receipt has used yet: must be finished or refunded.
CREATE INDEX payment_attempts_unused ON payment_attempts (register_id)
  WHERE status = 'paid' AND receipt_id IS NULL;

ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_attempts
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT ON payment_attempts TO pos_app;
GRANT UPDATE (status, provider_ref, token, error_code, checked_at, paid_at, receipt_id)
  ON payment_attempts TO pos_app;
