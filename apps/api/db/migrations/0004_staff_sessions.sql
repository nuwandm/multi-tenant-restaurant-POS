-- Staff log in at a till by picking their name and entering a PIN. The PIN belongs to the
-- membership, so a person working for two companies has a PIN per company.
ALTER TABLE memberships
  ADD COLUMN pin_hash             text,
  ADD COLUMN active               boolean NOT NULL DEFAULT true,
  ADD COLUMN failed_pin_attempts  int NOT NULL DEFAULT 0,
  ADD COLUMN locked_until         timestamptz;

-- A login on one register. Only a SHA-256 of the token is stored.
-- Sessions are looked up before the tenant is known, so the table has no RLS and the app role
-- has no grants on it: it is reached only through the SECURITY DEFINER functions below.
CREATE TABLE sessions (
  token_hash   text PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  user_id      uuid NOT NULL,
  register_id  uuid NOT NULL,
  role         text NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ended_at     timestamptz,
  FOREIGN KEY (tenant_id, register_id) REFERENCES cash_registers (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships (tenant_id, user_id)
);
REVOKE ALL ON sessions FROM PUBLIC;

-- Creates a session for the tenant in app.tenant_id, so a session can't be made for another tenant.
CREATE FUNCTION app_create_session(
  p_token_hash text, p_user_id uuid, p_register_id uuid, p_role text, p_expires_at timestamptz
) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    INSERT INTO sessions (token_hash, tenant_id, user_id, register_id, role, expires_at)
    VALUES (p_token_hash, current_tenant_id(), p_user_id, p_register_id, p_role, p_expires_at)
  $$;

CREATE FUNCTION app_session(p_token_hash text)
  RETURNS TABLE (tenant_id uuid, user_id uuid, register_id uuid, role text, display_name text,
                 expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT s.tenant_id, s.user_id, s.register_id, s.role, u.display_name, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = p_token_hash AND s.ended_at IS NULL AND s.expires_at > now()
  $$;

CREATE FUNCTION app_end_session(p_token_hash text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ UPDATE sessions SET ended_at = now() WHERE token_hash = p_token_hash AND ended_at IS NULL $$;

REVOKE ALL ON FUNCTION app_create_session(text, uuid, uuid, text, timestamptz),
                       app_session(text), app_end_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_create_session(text, uuid, uuid, text, timestamptz),
                          app_session(text), app_end_session(text) TO pos_app;
