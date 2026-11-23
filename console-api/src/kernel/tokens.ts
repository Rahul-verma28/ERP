import jwt from 'jsonwebtoken';
import type { ConsoleRole } from '@prisma/client';
import { env } from '../config/env';
import { AppError } from './errors';

// Console tokens are their own kind (audience "ahead-console"): a token from the ERP is never
// accepted here, and the other way round.

const AUD = 'ahead-console';
export const ACCESS_MINUTES = 15;
export const REFRESH_DAYS = 14;

export interface AccessClaims {
  sub: string;
  role: ConsoleRole;
  pid: string | null;
  sid: string;
}

export const signAccess = (c: AccessClaims) => jwt.sign(c, env.JWT_SECRET, { algorithm: 'HS256', audience: AUD, expiresIn: ACCESS_MINUTES * 60 });

export function readAccess(token: string): AccessClaims {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], audience: AUD }) as AccessClaims;
  } catch (e) {
    throw new AppError(e instanceof jwt.TokenExpiredError ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED', 'Please sign in again.');
  }
}

/** Short-lived token for a step of signing in (two-step code, two-step setup) */
export const signStep = (typ: 'mfa' | 'mfa_setup', userId: string) => jwt.sign({ typ, sub: userId }, env.JWT_SECRET, { algorithm: 'HS256', audience: `${AUD}-step`, expiresIn: 10 * 60 });

export function readStep(typ: 'mfa' | 'mfa_setup', token: string) {
  try {
    const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], audience: `${AUD}-step` }) as { typ: string; sub: string };
    if (p.typ !== typ) throw new Error('wrong step');
    return p.sub;
  } catch {
    throw new AppError('UNAUTHENTICATED', 'This sign-in took too long. Start again.');
  }
}
