import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHmac,
  randomUUID,
} from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const hmac = (key, value) => createHmac('sha256', key).update(value).digest('hex');
export function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [algorithm, cost, salt, expected] = String(encoded).split('$');
  if (
    algorithm !== 'scrypt' ||
    cost !== '32768' ||
    !/^[a-f0-9]{32}$/.test(salt ?? '') ||
    !/^[a-f0-9]{128}$/.test(expected ?? '')
  )
    return false;
  const actual = await derive(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return constantEqual(actual.toString('hex'), expected);
}
