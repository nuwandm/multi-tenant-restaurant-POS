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

export const MIN_PASSWORD_LENGTH = 10;

/** "scrypt$<salt hex>$<key hex>". Used for till PINs and back office passwords alike. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(secret, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptAsync(secret, Buffer.from(saltHex, 'hex'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function hashPin(pin: string): Promise<string> {
  if (!isValidPinFormat(pin)) throw new RangeError('A PIN is 4 to 8 digits');
  return hashSecret(pin);
}

export const verifyPin = verifySecret;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new RangeError(`A password is at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return hashSecret(password);
}
