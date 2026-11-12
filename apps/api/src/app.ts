import Fastify, { type FastifyServerOptions } from 'fastify';
import type { ControlSystem } from '@pos/control-system';

export interface AppDeps {
  controlSystem: ControlSystem;
}

export function buildApp(deps: AppDeps, options: FastifyServerOptions = {}) {
  const app = Fastify(options);

  app.get('/health', async () => {
    const controlSystem = await deps.controlSystem.getStatus();
    return { status: 'ok', controlSystem };
  });

  return app;
}
