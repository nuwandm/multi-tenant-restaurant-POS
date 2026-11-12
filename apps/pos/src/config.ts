// Temporary until staff login (Phase 6): which company and register this till is.
// Defaults are the demo data from apps/api/db/seed-dev.sql. Override in apps/pos/.env.local.
export const TENANT_ID: string =
  import.meta.env.VITE_TENANT_ID ?? 'd0000000-0000-0000-0000-000000000001';
export const REGISTER_ID: string =
  import.meta.env.VITE_REGISTER_ID ?? 'd0000000-0000-0000-0000-0000000000c1';
