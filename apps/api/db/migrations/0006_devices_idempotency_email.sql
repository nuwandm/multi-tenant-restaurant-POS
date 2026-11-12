-- Device pairing ------------------------------------------------------------------
-- A till (tablet or PC) is paired to one register with a one-time code from the back office.
-- It then sends its device token with every request; staff log in on it with their PIN.

CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  register_id   uuid NOT NULL,
  name          text NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  paired_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, register_id) REFERENCES cash_registers (tenant_id, id)
);
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON devices
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT ON devices TO pos_app;
GRANT UPDATE (last_seen_at, revoked_at) ON devices TO pos_app;

-- Codes are 8 characters from a 32-letter alphabet (about 10^12 combinations), single use and
-- valid for 15 minutes. Only a hash is stored.
CREATE TABLE pairing_codes (
  code_hash    text PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  register_id  uuid NOT NULL,
  created_by   uuid NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  FOREIGN KEY (tenant_id, register_id) REFERENCES cash_registers (tenant_id, id)
);
ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pairing_codes
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON pairing_codes TO pos_app;

-- Looks up a device before the tenant is known. Like the other app_* definer functions, it
-- needs a migration owner that is a superuser or has BYPASSRLS.
CREATE FUNCTION app_device(p_token_hash text)
  RETURNS TABLE (device_id uuid, tenant_id uuid, register_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT d.id, d.tenant_id, d.register_id FROM devices d
    WHERE d.token_hash = p_token_hash AND d.revoked_at IS NULL
  $$;

-- Uses a pairing code once and creates the device. Returns nothing for a wrong, used or
-- expired code, or a register that is no longer active.
CREATE FUNCTION app_claim_pairing_code(p_code_hash text, p_device_token_hash text, p_name text)
  RETURNS TABLE (device_id uuid, tenant_id uuid, register_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE
    v_tenant uuid;
    v_register uuid;
    v_device uuid;
  BEGIN
    UPDATE pairing_codes c SET used_at = now()
    WHERE c.code_hash = p_code_hash AND c.used_at IS NULL AND c.expires_at > now()
    RETURNING c.tenant_id, c.register_id INTO v_tenant, v_register;
    IF v_tenant IS NULL THEN RETURN; END IF;
    IF NOT EXISTS (SELECT 1 FROM cash_registers r WHERE r.id = v_register AND r.status = 'active') THEN
      RETURN;
    END IF;
    INSERT INTO devices (tenant_id, register_id, name, token_hash)
    VALUES (v_tenant, v_register, p_name, p_device_token_hash)
    RETURNING id INTO v_device;
    RETURN QUERY SELECT v_device, v_tenant, v_register;
  END
  $$;

-- Staff sessions remember the device they were made on, so revoking a device logs everyone out of it.
ALTER TABLE sessions ADD COLUMN device_id uuid REFERENCES devices (id);

DROP FUNCTION app_create_session(text, uuid, uuid, text, timestamptz);
CREATE FUNCTION app_create_session(
  p_token_hash text, p_user_id uuid, p_register_id uuid, p_role text, p_expires_at timestamptz,
  p_device_id uuid
) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    INSERT INTO sessions (token_hash, tenant_id, user_id, register_id, role, expires_at, device_id)
    VALUES (p_token_hash, current_tenant_id(), p_user_id, p_register_id, p_role, p_expires_at, p_device_id)
  $$;

CREATE FUNCTION app_end_device_sessions(p_device_id uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    UPDATE sessions SET ended_at = now()
    WHERE tenant_id = current_tenant_id() AND device_id = p_device_id AND ended_at IS NULL
  $$;

REVOKE ALL ON FUNCTION app_device(text), app_claim_pairing_code(text, text, text),
  app_create_session(text, uuid, uuid, text, timestamptz, uuid), app_end_device_sessions(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_device(text), app_claim_pairing_code(text, text, text),
  app_create_session(text, uuid, uuid, text, timestamptz, uuid), app_end_device_sessions(uuid)
  TO pos_app;

-- Retried requests ------------------------------------------------------------------
-- The till sends an Idempotency-Key per payment attempt. A retry with the same key gets the
-- receipt that was already made instead of a second one.
ALTER TABLE receipts ADD COLUMN idempotency_key text CHECK (length(idempotency_key) <= 100);
CREATE UNIQUE INDEX receipts_idempotency ON receipts (register_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Email verification and password reset ---------------------------------------------
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

CREATE TABLE email_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id),
  purpose     text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
GRANT SELECT, INSERT ON email_tokens TO pos_app;
GRANT UPDATE (used_at) ON email_tokens TO pos_app;
GRANT UPDATE (ended_at) ON admin_sessions TO pos_app;

-- The platform console also shows whether the owner has verified their email.
DROP FUNCTION app_platform_companies();
CREATE FUNCTION app_platform_companies()
  RETURNS TABLE (tenant_id uuid, legal_name text, org_number text, status text,
                 created_at timestamptz, status_changed_at timestamptz, owner_name text,
                 owner_email text, owner_email_verified boolean, restaurants int, registers int,
                 active_registers int, devices int, staff int, last_sale_at timestamptz,
                 sales_30d_ore bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT t.id, t.legal_name, t.org_number, t.status, t.created_at, t.status_changed_at,
           owner.display_name, owner.email, owner.email_verified_at IS NOT NULL,
           (SELECT count(*)::int FROM restaurants s WHERE s.tenant_id = t.id),
           (SELECT count(*)::int FROM cash_registers c WHERE c.tenant_id = t.id),
           (SELECT count(*)::int FROM cash_registers c WHERE c.tenant_id = t.id AND c.status = 'active'),
           (SELECT count(*)::int FROM devices d WHERE d.tenant_id = t.id AND d.revoked_at IS NULL),
           (SELECT count(*)::int FROM memberships m WHERE m.tenant_id = t.id AND m.active),
           (SELECT max(r.created_at) FROM receipts r WHERE r.tenant_id = t.id AND r.kind = 'sale'),
           (SELECT coalesce(sum(r.total_incl_vat_ore), 0)::bigint FROM receipts r
            WHERE r.tenant_id = t.id AND r.kind IN ('sale', 'return')
              AND r.created_at > now() - interval '30 days')
    FROM tenants t
    LEFT JOIN LATERAL (
      SELECT u.display_name, u.email, u.email_verified_at FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1
    ) owner ON true
    WHERE EXISTS (SELECT 1 FROM platform_admins WHERE user_id = current_app_user_id())
    ORDER BY t.created_at DESC
  $$;
REVOKE ALL ON FUNCTION app_platform_companies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_platform_companies() TO pos_app;
