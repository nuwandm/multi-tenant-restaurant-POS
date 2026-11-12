export const uuid = { type: 'string', format: 'uuid' } as const;

// Temporary: the tenant comes from a header until staff login (Phase 6) puts it in the session.
export const tenantHeaders = {
  type: 'object',
  required: ['x-tenant-id'],
  properties: { 'x-tenant-id': uuid },
} as const;

export const registerParams = {
  type: 'object',
  required: ['registerId'],
  properties: { registerId: uuid },
} as const;
