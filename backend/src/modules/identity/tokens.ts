import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env, isDev } from '../../config/env';
import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { randomToken, sha256 } from '../../kernel/crypto';
import type { AuthClaims } from '../../kernel/context';
import { personalPolicy } from '../account/policy';

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE = 'ahead_rt';
const REUSE_GRACE_MS = 30_000;

export function signAccessToken(claims: AuthClaims) {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: ACCESS_TTL_SEC, algorithm: 'HS256', audience: 'ahead-api' });
}

export function verifyAccessToken(token: string): AuthClaims {
  try {
    const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], audience: 'ahead-api' }) as jwt.JwtPayload & AuthClaims;
    if (p.typ) throw new Error('wrong token type');
    return { sub: p.sub!, tid: p.tid, rid: p.rid, sid: p.sid };
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) throw new AppError('TOKEN_EXPIRED', 'Your session has expired.');
    throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  }
}

/** Short-lived single-purpose tokens: mobile verification (10 min), email verification (24 h). */
export function signPurposeToken(typ: string, payload: Record<string, string>, expiresInSec: number) {
  return jwt.sign({ ...payload, typ }, env.JWT_SECRET, { expiresIn: expiresInSec, algorithm: 'HS256', audience: 'ahead-purpose' });
}

export function verifyPurposeToken<T extends Record<string, string>>(typ: string, token: string): T {
  try {
    const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], audience: 'ahead-purpose' }) as jwt.JwtPayload;
    if (p.typ !== typ) throw new Error('wrong type');
    return p as unknown as T;
  } catch {
    throw new AppError('OTP_TOKEN_INVALID', 'This verification link or code has expired. Please try again.');
  }
}

function setRefreshCookie(res: Response, token: string, maxAge = REFRESH_TTL_MS) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
}

/** Create a session (new refresh-token family) and return an access token. Needs a DB context. */
export async function startSession(req: Request, res: Response, userId: string, tenantId: string | null, roleId: string | null) {
  const refresh = randomToken();
  // The strictest "longest session" rule across this person's businesses (Settings › Users & security)
  const { maxDays } = await personalPolicy(userId);
  const ttlMs = Math.min(REFRESH_TTL_MS, maxDays * 86_400_000);
  const session = await db().userSession.create({
    data: {
      userId,
      tenantId,
      familyId: crypto.randomUUID(),
      refreshTokenHash: sha256(refresh),
      userAgent: req.header('user-agent')?.slice(0, 300),
      ip: req.ip,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  setRefreshCookie(res, refresh, ttlMs);
  return signAccessToken({ sub: userId, tid: session.tenantId, rid: roleId, sid: session.id });
}

/**
 * Rotate the refresh token. Reusing an already-rotated token revokes the whole family
 * (stolen-token detection). Needs a platform DB context.
 */
export async function rotateSession(req: Request, res: Response, refresh: string) {
  const tx = db();
  const current = await tx.userSession.findUnique({ where: { refreshTokenHash: sha256(refresh) } });
  if (!current) throw new AppError('UNAUTHENTICATED', 'Please sign in again.');
  // Two tabs (or a double-mounted effect) can refresh with the same token at the same moment.
  // A replay within the grace window is treated as that race, not as theft.
  const inGrace = current.revokedAt && Date.now() - current.revokedAt.getTime() < REUSE_GRACE_MS;
  if (current.revokedAt && !inGrace) {
    await tx.userSession.updateMany({ where: { familyId: current.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw new AppError('UNAUTHENTICATED', 'Please sign in again.');
  }
  if (current.expiresAt < new Date()) throw new AppError('UNAUTHENTICATED', 'Please sign in again.');
  // Each refresh writes a new row, so the newest row's age is the time since the last activity
  const { idleMinutes } = await personalPolicy(current.userId);
  if (!current.revokedAt && Date.now() - current.createdAt.getTime() > idleMinutes * 60_000) {
    await tx.userSession.update({ where: { id: current.id }, data: { revokedAt: new Date() } });
    throw new AppError('UNAUTHENTICATED', 'You were signed out after a period of inactivity. Please sign in again.', { reason: 'idle' });
  }

  const next = randomToken();
  if (!current.revokedAt) await tx.userSession.update({ where: { id: current.id }, data: { revokedAt: new Date() } });
  const session = await tx.userSession.create({
    data: {
      userId: current.userId,
      tenantId: current.tenantId,
      familyId: current.familyId,
      refreshTokenHash: sha256(next),
      userAgent: req.header('user-agent')?.slice(0, 300),
      ip: req.ip,
      expiresAt: current.expiresAt,
    },
  });
  setRefreshCookie(res, next, current.expiresAt.getTime() - Date.now());
  return session;
}
