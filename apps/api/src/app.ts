import Fastify, { type FastifyServerOptions } from 'fastify';
import { ControlSystemUnavailableError, type ControlSystem } from '@pos/control-system';
import { ReceiptError } from '@pos/domain';
import type { Sql } from 'postgres';
import { HttpError } from './errors';
import { menuRoutes } from './menu/routes';
import { reportRoutes } from './reports/routes';
import { salesRoutes } from './sales/routes';

export interface AppDeps {
  sql: Sql;
  controlSystem: ControlSystem;
}

export function buildApp(deps: AppDeps, options: FastifyServerOptions = {}) {
  const app = Fastify(options);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }
    if (err instanceof ReceiptError) {
      return reply.status(400).send({ error: 'invalid_receipt', message: err.message });
    }
    if (err instanceof ControlSystemUnavailableError) {
      return reply.status(503).send({
        error: 'control_system_unavailable',
        message: 'The control system did not sign the receipt. No receipt was created.',
      });
    }
    if (err instanceof Error && 'validation' in err) {
      return reply.status(400).send({ error: 'invalid_request', message: err.message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'internal_error', message: 'Internal error' });
  });

  app.get('/health', async () => {
    const controlSystem = await deps.controlSystem.getStatus();
    return { status: 'ok', controlSystem };
  });

  menuRoutes(app, deps);
  salesRoutes(app, deps);
  reportRoutes(app, deps);

  return app;
}
