import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { env } from '../config/env';

export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');
export const pepperedHash = (value: string) => createHmac('sha256', env.PEPPER).update(value).digest('hex');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const hashPassword = (password: string) => hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (stored: string, password: string) => verify(stored, password).catch(() => false);

export const normaliseEmail = (email: string) => email.trim().toLowerCase();
/** Indian mobiles as +91XXXXXXXXXX; numbers with another country code stay as typed */
export function normaliseMobile(input: string) {
  const d = input.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (/^\d{10}$/.test(d)) return `+91${d}`;
  if (/^91\d{10}$/.test(d)) return `+${d}`;
  if (/^0\d{10}$/.test(d)) return `+91${d.slice(1)}`;
  return d;
}

// Secrets kept at rest (two-step keys): AES-256-GCM with MFA_KEY
const key = () => Buffer.from(env.MFA_KEY, 'base64');
export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}
export function unseal(sealed: string) {
  const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}
