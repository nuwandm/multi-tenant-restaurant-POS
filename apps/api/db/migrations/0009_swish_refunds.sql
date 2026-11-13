-- Swish refunds. A refund is a payment attempt in the other direction: it names the payment it
-- gives money back from, and like a payment it is used by at most one receipt (the return).
-- A refund of Swish money that never got a receipt has no receipt at all.

ALTER TABLE payment_attempts
  ADD COLUMN kind text NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'refund')),
  ADD COLUMN original_attempt_id uuid,
  -- Swish's own reference for a paid payment; a refund must quote it.
  ADD COLUMN payment_reference text,
  ADD CONSTRAINT payment_attempts_original_fk
    FOREIGN KEY (tenant_id, original_attempt_id) REFERENCES payment_attempts (tenant_id, id),
  ADD CONSTRAINT payment_attempts_refund_has_original
    CHECK ((kind = 'refund') = (original_attempt_id IS NOT NULL));

CREATE INDEX payment_attempts_refunds ON payment_attempts (original_attempt_id)
  WHERE kind = 'refund';
CREATE INDEX payment_attempts_receipt ON payment_attempts (receipt_id) WHERE receipt_id IS NOT NULL;

-- The "unused" index only concerns payments, not refunds.
DROP INDEX payment_attempts_unused;
CREATE INDEX payment_attempts_unused ON payment_attempts (register_id)
  WHERE kind = 'payment' AND status = 'paid' AND receipt_id IS NULL;

GRANT UPDATE (payment_reference) ON payment_attempts TO pos_app;
