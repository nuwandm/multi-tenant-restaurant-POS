import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { requireStaff } from '../auth/session';
import { registerParams } from '../http-schemas';
import { createXReport, createZReport } from './reports';

type ReportRequest = { Params: { registerId: string } };

const schema = { params: registerParams };

export function reportRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post<ReportRequest>(
    '/registers/:registerId/x-reports',
    { schema, preHandler: requireStaff(deps.sql) },
    async (req, reply) => reply.status(201).send(await createXReport(deps.sql, req.staff!)),
  );

  // Closing the day is a manager's job.
  app.post<ReportRequest>(
    '/registers/:registerId/z-reports',
    { schema, preHandler: requireStaff(deps.sql, ['owner', 'manager']) },
    async (req, reply) => reply.status(201).send(await createZReport(deps.sql, req.staff!)),
  );
}
