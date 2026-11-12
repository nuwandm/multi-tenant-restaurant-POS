import { FakeControlSystem } from '@pos/control-system';
import { buildApp } from './app';

// The fake control system is replaced by the real provider adapter in Phase 4.
const app = buildApp({ controlSystem: new FakeControlSystem() }, { logger: true });

const port = Number(process.env.API_PORT ?? 3000);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
