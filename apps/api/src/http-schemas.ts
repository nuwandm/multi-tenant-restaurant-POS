export const uuid = { type: 'string', format: 'uuid' } as const;

export const registerParams = {
  type: 'object',
  required: ['registerId'],
  properties: { registerId: uuid },
} as const;
