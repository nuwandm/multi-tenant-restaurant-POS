const adminUrl = new URL(
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://pos:pos@localhost:5433/postgres',
);

export const TEST_DATABASE = 'pos_test';

export const testAdminUrl = adminUrl.toString();

export const testDatabaseUrl = (() => {
  const url = new URL(adminUrl);
  url.pathname = `/${TEST_DATABASE}`;
  return url.toString();
})();
