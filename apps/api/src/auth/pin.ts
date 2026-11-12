import { randomBytes, scrypt, timingSafeEqual, type BinaryLike } from 'node:crypto';

const KEY_LENGTH = 32;

function scryptAsync(password: BinaryLike, salt: BinaryLike): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

/** "scrypt$<salt hex>$<key hex>" */
export async function hashPin(pin: string): Promise<string> {
  if (!isValidPinFormat(pin)) throw new RangeError('A PIN is 4 to 8 digits');
  const salt = randomBytes(16);
  const key = await scryptAsync(pin, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptAsync(pin, Buffer.from(saltHex, 'hex'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
