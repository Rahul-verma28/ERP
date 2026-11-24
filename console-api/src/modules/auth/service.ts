import type { Request, Response } from 'express';
import type { ConsoleUser } from '@prisma/client';
import { env, isDev } from '../../config/env';
import { prisma } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { hashPassword, pepperedHash, randomToken, seal, unseal, verifyPassword } from '../../kernel/crypto';
import { REFRESH_DAYS, signAccess, signStep } from '../../kernel/tokens';
import { checkTotp, newTotpSecret, otpauthUrl } from '../../kernel/totp';
import { audit } from '../../kernel/audit';
import { sendEmail } from '../../kernel/mail';
import { MFA_ROLES } from '../../middleware/auth';

export const REFRESH_COOKIE = 'ahead_console_rt';
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const LINK_DAYS = { invite: 7, reset: 1 } as const;

const cookieOpts = () => ({ httpOnly: true, secure: !isDev, sameSite: 'lax' as const, path: '/api/v1/auth', maxAge: REFRESH_DAYS * 86_400_000 });

/** Password checks for Console accounts: 10+ characters with a letter and a digit, not the email */
export function passwordProblem(pw: string, email: string) {
  if (pw.length < 10) return 'Use at least 10 characters';
  if (pw.length > 128) return 'Use at most 128 characters';
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return 'Use letters and at least one number';
  if (pw.toLowerCase().includes(email.split('@')[0].toLowerCase())) return 'Don’t use your email name in the password';
  return null;
}

/** Open a session: access token in the answer, refresh token in an http-only cookie */
export async function startSession(req: Request, res: Response, user: ConsoleUser) {
  const refresh = randomToken(32);
  const session = await prisma.consoleSession.create({
    data: { userId: user.id, refreshHash: pepperedHash(refresh), ip: req.ip ?? null, userAgent: req.header('user-agent')?.slice(0, 300) ?? null, expiresAt: new Date(Date.now() + REFRESH_DAYS * 86_400_000) },
  });
  await prisma.consoleUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
  res.cookie(REFRESH_COOKIE, refresh, cookieOpts());
  await audit({ actorId: user.id, action: 'auth.signed_in', entity: 'console_user', entityId: user.id, ip: req.ip });
  return { accessToken: signAccess({ sub: user.id, role: user.role, pid: user.partnerId, sid: session.id }) };
}

/** Step 1: email and password. Then: signed in, or a two-step code, or two-step setup (required roles). */
export async function login(req: Request, res: Response, email: string, password: string) {
  const user = await prisma.consoleUser.findUnique({ where: { email } });
  const wrong = new AppError('INVALID_CREDENTIALS', 'Email or password is wrong.');
  if (!user || !user.passwordHash) {
    // Same time either way, so nobody can tell which emails have accounts
    await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$2pYvbx2TQb6kJ6Gl2nZ0Ckx7Vm8nVd2XzIh0wq6Q0mQ', password);
    throw wrong;
  }
  if (user.status === 'disabled') throw new AppError('PERMISSION_DENIED', 'This account is switched off. Ask an AHEAD admin.');
  if (user.partnerId && (await prisma.partner.findUnique({ where: { id: user.partnerId }, select: { status: true } }))?.status !== 'active') throw new AppError('PERMISSION_DENIED', 'Your partner account is paused. Ask AHEAD.');
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new AppError('ACCOUNT_LOCKED', `Too many wrong passwords. Try again after ${user.lockedUntil.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.`);
  if (!(await verifyPassword(user.passwordHash, password))) {
    const failed = user.failedLogins + 1;
    await prisma.consoleUser.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
    await audit({ actorId: user.id, action: 'auth.wrong_password', entity: 'console_user', entityId: user.id, ip: req.ip });
    throw wrong;
  }
  if (user.mfaEnabledAt) return { mfaRequired: true as const, mfaToken: signStep('mfa', user.id) };
  if (MFA_ROLES.includes(user.role)) return { mfaSetupRequired: true as const, setupToken: signStep('mfa_setup', user.id) };
  return startSession(req, res, user);
}

export async function loginWithCode(req: Request, res: Response, userId: string, code: string) {
  const user = await prisma.consoleUser.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaSecret || !checkTotp(unseal(user.mfaSecret), code)) {
    await audit({ actorId: user.id, action: 'auth.wrong_code', entity: 'console_user', entityId: user.id, ip: req.ip });
    throw new AppError('OTP_INVALID', 'That code is not right. Use the newest code in your app.', { fields: { code: 'Wrong code' } });
  }
  return startSession(req, res, user);
}

/** Two-step setup: a new secret (kept sealed until the first code proves the app has it) */
export async function mfaSecretFor(userId: string) {
  const user = await prisma.consoleUser.findUniqueOrThrow({ where: { id: userId } });
  const secret = newTotpSecret();
  await prisma.consoleUser.update({ where: { id: userId }, data: { mfaSecret: seal(secret), mfaEnabledAt: null } });
  return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
}

export async function enableMfa(req: Request, res: Response, userId: string, code: string) {
  const user = await prisma.consoleUser.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaSecret || !checkTotp(unseal(user.mfaSecret), code)) throw new AppError('OTP_INVALID', 'That code is not right. Scan the code again and type the newest one.', { fields: { code: 'Wrong code' } });
  const on = await prisma.consoleUser.update({ where: { id: userId }, data: { mfaEnabledAt: new Date() } });
  await audit({ actorId: userId, action: 'auth.mfa_enabled', entity: 'console_user', entityId: userId, ip: req.ip });
  return startSession(req, res, on);
}

/** New access token from the refresh cookie; the refresh token is replaced each time */
export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  const s = await prisma.consoleSession.findUnique({ where: { refreshHash: pepperedHash(token) }, include: { user: true } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || s.user.status !== 'active') {
    // A refresh token used after it was replaced means it was copied: end that person's sessions
    if (s?.revokedAt) await prisma.consoleSession.updateMany({ where: { userId: s.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    throw new AppError('UNAUTHENTICATED', 'Please sign in again.');
  }
  const next = randomToken(32);
  await prisma.consoleSession.update({ where: { id: s.id }, data: { refreshHash: pepperedHash(next), lastUsedAt: new Date() } });
  res.cookie(REFRESH_COOKIE, next, cookieOpts());
  return { accessToken: signAccess({ sub: s.userId, role: s.user.role, pid: s.user.partnerId, sid: s.id }) };
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (token) await prisma.consoleSession.updateMany({ where: { refreshHash: pepperedHash(token), revokedAt: null }, data: { revokedAt: new Date() } });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
}

// ── Invite and reset links ──

export async function sendAccountLink(userId: string, purpose: 'invite' | 'reset', by?: string | null) {
  const user = await prisma.consoleUser.findUniqueOrThrow({ where: { id: userId } });
  await prisma.accountLink.updateMany({ where: { userId, usedAt: null, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date() } });
  const token = randomToken(24);
  const days = LINK_DAYS[purpose];
  await prisma.accountLink.create({ data: { userId, purpose, tokenHash: pepperedHash(token), expiresAt: new Date(Date.now() + days * 86_400_000) } });
  const url = `${env.APP_ORIGINS.find((o) => o.includes('3001')) ?? env.APP_ORIGINS[0]}/console/set-password/${token}`;
  await sendEmail(
    user.email,
    purpose === 'invite' ? 'You are invited to the AHEAD Console' : 'Reset your AHEAD Console password',
    purpose === 'invite'
      ? `Hi ${user.name},\n\nYou have been added to the AHEAD Console. Choose your password here:\n\n${url}\n\nThe link works once, for ${days} days.`
      : `Hi ${user.name},\n\nChoose a new password here:\n\n${url}\n\nThe link works once, for 24 hours. If you didn't ask for this, ignore this email.`,
  );
  await audit({ actorId: by ?? null, action: `auth.${purpose}_sent`, entity: 'console_user', entityId: userId });
  return url;
}

export async function linkInfo(token: string) {
  const l = await prisma.accountLink.findUnique({ where: { tokenHash: pepperedHash(token) }, include: { user: { select: { name: true, email: true, status: true } } } });
  if (!l || l.usedAt || l.expiresAt < new Date() || l.user.status === 'disabled') throw new AppError('NOT_FOUND', 'This link has run out or was already used. Ask for a new one.');
  return l;
}

export async function setPassword(token: string, password: string) {
  const l = await linkInfo(token);
  const problem = passwordProblem(password, l.user.email);
  if (problem) throw new AppError('VALIDATION_FAILED', problem, { fields: { password: problem } });
  await prisma.$transaction([
    prisma.consoleUser.update({ where: { id: l.userId }, data: { passwordHash: await hashPassword(password), status: 'active', failedLogins: 0, lockedUntil: null } }),
    prisma.accountLink.update({ where: { id: l.id }, data: { usedAt: new Date() } }),
    // A new password ends every open session
    prisma.consoleSession.updateMany({ where: { userId: l.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit({ actorId: l.userId, action: `auth.password_set`, entity: 'console_user', entityId: l.userId });
}
