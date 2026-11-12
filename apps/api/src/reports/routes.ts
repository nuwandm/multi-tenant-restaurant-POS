import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { registerParams, tenantHeaders } from '../http-schemas';
import { createXReport, createZReport } from './reports';

type ReportRequest = { Headers: { 'x-tenant-id': string }; Params: { registerId: string } };

const schema = { headers: tenantHeaders, params: registerParams };

export function reportRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post<ReportRequest>('/registers/:registerId/x-reports', { schema }, async (req, reply) => {
    const report = await createXReport(deps.sql, req.headers['x-tenant-id'], req.params.registerId);
    return reply.status(201).send(report);
  });

  app.post<ReportRequest>('/registers/:registerId/z-reports', { schema }, async (req, reply) => {
    const report = await createZReport(deps.sql, req.headers['x-tenant-id'], req.params.registerId);
    return reply.status(201).send(report);
  });
}
