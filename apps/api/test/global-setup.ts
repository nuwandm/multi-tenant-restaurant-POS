import postgres from 'postgres';
import { migrate } from '../src/db/migrate';
import { TEST_DATABASE, testAdminUrl, testDatabaseUrl } from './db';

/** Recreates the test database and runs all migrations once per test run. */
export default async function setup() {
  const admin = postgres(testAdminUrl, { onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DATABASE}`);
  } catch (err) {
    throw new Error(
      `Cannot reach Postgres at ${testAdminUrl}. Start it with "pnpm db:up".\n${String(err)}`,
    );
  } finally {
    await admin.end();
  }

  const sql = postgres(testDatabaseUrl, { onnotice: () => {} });
  try {
    await migrate(sql);
  } finally {
    await sql.end();
  }
}
