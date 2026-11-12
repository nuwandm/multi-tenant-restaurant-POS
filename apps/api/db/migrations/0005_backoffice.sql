-- Back office: owners and managers log in with email and password, and can belong to several
-- companies (tenants). They pick a company per request; the API checks their role in it.

-- Cashiers often have no email, so it becomes optional. The unique index still applies when set.
ALTER TABLE users
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN password_hash         text,
  ADD COLUMN failed_login_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN locked_until          timestamptz;

-- The user a back office request runs for. Lets a user see their own memberships and the
-- companies they belong to without a tenant being set first.
CREATE FUNCTION current_app_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION current_app_user_id() TO pos_app;

CREATE POLICY own_memberships ON memberships FOR SELECT
  USING (user_id = current_app_user_id());
CREATE POLICY member_tenants ON tenants FOR SELECT
  USING (id IN (SELECT tenant_id FROM memberships WHERE user_id = current_app_user_id()));

-- Back office logins. Not tenant data: a session is for a user, who may manage several tenants.
CREATE TABLE admin_sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ended_at    timestamptz
);
GRANT SELECT, INSERT ON admin_sessions TO pos_app;
GRANT UPDATE (ended_at) ON admin_sessions TO pos_app;

-- Ends a staff member's till sessions in the current tenant, e.g. when deactivated.
CREATE FUNCTION app_end_user_sessions(p_user_id uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    UPDATE sessions SET ended_at = now()
    WHERE tenant_id = current_tenant_id() AND user_id = p_user_id AND ended_at IS NULL
  $$;
REVOKE ALL ON FUNCTION app_end_user_sessions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_end_user_sessions(uuid) TO pos_app;

-- Who changed what in the back office. Append-only like the sales tables.
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  action      text NOT NULL,
  entity_id   uuid,
  details     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_created ON audit_log (tenant_id, created_at DESC);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_change();
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON audit_log TO pos_app;

CREATE INDEX receipts_register_created ON receipts (register_id, created_at);

-- Platform ------------------------------------------------------------------------
-- Owners sign up themselves. A new company starts 'pending' and can't sell until a platform
-- admin approves it. Only platform functions may change status, never the company itself.
ALTER TABLE tenants
  DROP CONSTRAINT tenants_status_check,
  ADD CONSTRAINT tenants_status_check CHECK (status IN ('pending', 'active', 'suspended')),
  ALTER COLUMN status SET DEFAULT 'pending',
  ADD COLUMN status_changed_at timestamptz;
REVOKE UPDATE ON tenants FROM pos_app;
GRANT UPDATE (legal_name, vat_number) ON tenants TO pos_app;

-- People who run the platform. Reached only through the functions below.
CREATE TABLE platform_admins (
  user_id     uuid PRIMARY KEY REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON platform_admins FROM PUBLIC;

-- The platform functions read across tenants, so they run as the migration owner, which must be
-- a superuser or have BYPASSRLS. They return status and usage totals only: no receipts, menus or
-- staff details, so owners' business data stays theirs.
CREATE FUNCTION app_is_platform_admin(p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = p_user_id) $$;

CREATE FUNCTION app_platform_companies()
  RETURNS TABLE (tenant_id uuid, legal_name text, org_number text, status text,
                 created_at timestamptz, status_changed_at timestamptz, owner_name text,
                 owner_email text, restaurants int, registers int, active_registers int,
                 staff int, last_sale_at timestamptz, sales_30d_ore bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT t.id, t.legal_name, t.org_number, t.status, t.created_at, t.status_changed_at,
           owner.display_name, owner.email,
           (SELECT count(*)::int FROM restaurants s WHERE s.tenant_id = t.id),
           (SELECT count(*)::int FROM cash_registers c WHERE c.tenant_id = t.id),
           (SELECT count(*)::int FROM cash_registers c WHERE c.tenant_id = t.id AND c.status = 'active'),
           (SELECT count(*)::int FROM memberships m WHERE m.tenant_id = t.id AND m.active),
           (SELECT max(r.created_at) FROM receipts r WHERE r.tenant_id = t.id AND r.kind = 'sale'),
           (SELECT coalesce(sum(r.total_incl_vat_ore), 0)::bigint FROM receipts r
            WHERE r.tenant_id = t.id AND r.kind IN ('sale', 'return')
              AND r.created_at > now() - interval '30 days')
    FROM tenants t
    LEFT JOIN LATERAL (
      SELECT u.display_name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1
    ) owner ON true
    -- Defence in depth: returns nothing unless app.user_id is a platform admin.
    WHERE EXISTS (SELECT 1 FROM platform_admins WHERE user_id = current_app_user_id())
    ORDER BY t.created_at DESC
  $$;

CREATE FUNCTION app_platform_set_status(p_tenant_id uuid, p_status text) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$
    UPDATE tenants SET status = p_status, status_changed_at = now()
    WHERE id = p_tenant_id AND status <> p_status
      AND EXISTS (SELECT 1 FROM platform_admins WHERE user_id = current_app_user_id())
    RETURNING true
  $$;

REVOKE ALL ON FUNCTION app_is_platform_admin(uuid), app_platform_companies(),
                       app_platform_set_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_platform_admin(uuid), app_platform_companies(),
                          app_platform_set_status(uuid, text) TO pos_app;
