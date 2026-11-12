import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { adminAuthRoutes } from './auth-routes';
import { emailRoutes } from './email-routes';
import { platformRoutes } from './platform-routes';
import { signupRoutes } from './signup-routes';
import { tenantAdminRoutes } from './tenant-routes';

/** Back office for owners and managers, owner sign-up, and the platform console. */
export function adminRoutes(app: FastifyInstance, deps: AppDeps) {
  signupRoutes(app, deps);
  adminAuthRoutes(app, deps);
  emailRoutes(app, deps);
  tenantAdminRoutes(app, deps);
  platformRoutes(app, deps);
}
