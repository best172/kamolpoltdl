import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

export const SESSION_COOKIE = 'session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Stored format: scrypt$<salt hex>$<hash hex>. The plain password is never stored.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

// Used when the username doesn't exist, so a login attempt takes the same time either way.
const DUMMY_HASH = await hashPassword('dummy-password-for-timing');
export const dummyVerify = (password) => verifyPassword(password, DUMMY_HASH);

// The cookie holds a random token; the DB only stores its SHA-256, so a leaked DB can't be replayed.
export const newSessionToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
