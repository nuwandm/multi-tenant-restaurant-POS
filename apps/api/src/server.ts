import { FakeControlSystem } from '@pos/control-system';
import { buildApp } from './app';
import { createSql } from './db/client';
import { swishFromEnv } from './payments/swish';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.');
  process.exit(1);
}

// The fake control system is replaced by the real provider adapter in Phase 4.
const app = buildApp(
  { sql: createSql(databaseUrl), controlSystem: new FakeControlSystem(), swish: swishFromEnv() },
  { logger: true },
);

const port = Number(process.env.API_PORT ?? 3000);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
