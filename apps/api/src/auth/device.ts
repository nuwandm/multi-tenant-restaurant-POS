import { randomInt } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { HttpError } from '../errors';
import { hashToken } from './session';

export interface PairedDevice {
  deviceId: string;
  tenantId: string;
  registerId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    device?: PairedDevice;
  }
}

export const DEVICE_HEADER = 'x-device-token';
export const PAIRING_CODE_MINUTES = 15;

// Crockford base32: no I, L, O or U, so codes are easy to read aloud and type.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** "K7M4-Q2XP": 8 characters, about 10^12 possibilities. */
export function newPairingCode(): string {
  const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** Hash of a code as typed: case, spaces and dashes don't matter; O/I/L read as 0/1/1. */
export function hashPairingCode(code: string): string {
  const normalized = code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return hashToken(`pairing:${normalized}`);
}

export async function lookupDevice(sql: Sql, token: string): Promise<PairedDevice | null> {
  const rows = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE pos_app`;
    return tx<{ device_id: string; tenant_id: string; register_id: string }[]>`
      SELECT * FROM app_device(${hashToken(token)})`;
  });
  const row = rows[0];
  return row
    ? { deviceId: row.device_id, tenantId: row.tenant_id, registerId: row.register_id }
    : null;
}

/** preHandler: the request must come from a paired, non-revoked till. */
export function requireDevice(sql: Sql) {
  return async (req: FastifyRequest) => {
    const token = req.headers[DEVICE_HEADER];
    const device = typeof token === 'string' && token ? await lookupDevice(sql, token) : null;
    if (!device)
      throw new HttpError(401, 'device_not_paired', 'This device is not paired with a register');
    req.device = device;
  };
}
