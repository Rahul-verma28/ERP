import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { env, isDev } from '../../config/env';
import { db, prisma } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../kernel/crypto';
import { describePasswordPolicy, passwordPolicyError, personalWithDefaults, type PersonalPreferences } from '../../contracts/account';
import { audit } from '../audit/service';
import { sendMessage } from '../notifications/service';
import { consumeOtp, sendOtp } from '../identity/otp';
import { signPurposeToken, verifyPurposeToken } from '../identity/tokens';
import { decryptSecret, encryptSecret, hashBackupCode, newBackupCodes, newSecret, otpauthUrl, verifyTotp } from './totp';
import { forgetMfa, mfaRequirement, personalPolicy } from './policy';
import { deviceLabel } from './signin';

// My account: profile, personal preferences, email/mobile change, password, sessions and
// two-step verification. Everything here is about the signed-in person, across businesses.
// Runs in a platform transaction (identity tables have no tenant).

const DAY = 86_400_000;
export const TRUSTED_COOKIE = 'ahead_td';
const TRUST_DAYS = 30;
const MFA_LOCK_AFTER = 5;
const MFA_LOCK_MS = 15 * 60 * 1000;

type BackupCode = { hash: string; usedAt: string | null };
const codesLeft = (codes: unknown) => ((codes ?? []) as BackupCode[]).filter((c) => !c.usedAt).length;

async function requirePassword(userId: string, password: string, field = 'password') {
  const user = await db().user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    throw new AppError('VALIDATION_FAILED', 'Your password is incorrect.', { fields: { [field]: 'Your password is incorrect' } });
  }
  return user;
}

// ── Overview ──

export async function accountOverview(userId: string, sessionId: string) {
  const user = await db().user.findUniqueOrThrow({ where: { id: userId }, include: { mfa: true } });
  const [req, policy, memberships] = await Promise.all([
    mfaRequirement(userId),
    personalPolicy(userId),
    db().tenantMember.findMany({
      where: { userId, status: 'active', tenant: { status: { not: 'purged' } } },
      include: { tenant: { select: { id: true, name: true, status: true, logoUrl: true, ownerUserId: true } }, role: { select: { key: true, name: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
  ]);
  const current = await db().userSession.findUnique({ where: { id: sessionId }, select: { familyId: true } });
  return {
    profile: {
      id: user.id, name: user.name, email: user.email, mobile: user.mobile,
      emailVerified: !!user.emailVerifiedAt, mobileVerified: !!user.mobileVerifiedAt,
    },
    preferences: personalWithDefaults(user.preferences),
    security: {
      mfaEnabled: user.mfaEnabled,
      mfaEnabledAt: user.mfa?.enabledAt ?? null,
      backupCodesLeft: user.mfaEnabled ? codesLeft(user.mfa?.backupCodes) : 0,
      requiredBy: req.requiredBy,
      deadline: req.deadline,
      mustSetUp: req.mustSetUp,
      passwordChangedAt: user.passwordChangedAt,
      passwordPolicy: policy.password,
      passwordPolicyText: describePasswordPolicy(policy.password),
      passwordPolicySetBy: policy.passwordSetBy,
      passwordPolicyWhere: policy.passwordSetWhere,
    },
    businesses: memberships.map((m) => ({
      tenantId: m.tenantId, name: m.tenant.name, status: m.tenant.status, logoUrl: m.tenant.logoUrl,
      roleKey: m.role.key, roleName: m.role.name, isOwner: m.tenant.ownerUserId === userId, joinedAt: m.joinedAt,
    })),
    currentFamilyId: current?.familyId ?? null,
    lastTenantId: user.lastTenantId,
  };
}

export async function updateProfile(userId: string, name: string) {
  const before = await db().user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  await db().user.update({ where: { id: userId }, data: { name } });
  await audit({ tenantId: null, actorId: userId, action: 'account.profile.update', entity: 'user', entityId: userId, before, after: { name } });
}

export async function updatePreferences(userId: string, prefs: PersonalPreferences, defaultTenantId?: string | null) {
  if (defaultTenantId) {
    const m = await db().tenantMember.findUnique({ where: { tenantId_userId: { tenantId: defaultTenantId, userId } } });
    if (!m || m.status !== 'active') throw new AppError('VALIDATION_FAILED', 'Choose one of your businesses.', { fields: { defaultTenantId: 'Choose one of your businesses' } });
  }
  // Keep what other screens store here (the dashboard layout per business)
  const current = await db().user.findUniqueOrThrow({ where: { id: userId }, select: { preferences: true } });
  const stored = { ...((current.preferences ?? {}) as Record<string, unknown>), ...prefs };
  await db().user.update({
    where: { id: userId },
    data: { preferences: stored as unknown as Prisma.InputJsonValue, ...(defaultTenantId ? { lastTenantId: defaultTenantId } : {}) },
  });
  return prefs;
}

// ── Email / mobile change: password + a code sent to the new address ──

type Kind = 'email' | 'mobile';
const purposeOf = (k: Kind): 'email_change' | 'mobile_change' => (k === 'email' ? 'email_change' : 'mobile_change');

export async function startContactChange(userId: string, kind: Kind, value: string, password: string) {
  const user = await requirePassword(userId, password);
  if (user[kind] === value) throw new AppError('VALIDATION_FAILED', `That's already your ${kind}.`, { fields: { value: `That's already your ${kind}` } });
  const taken = await db().user.findFirst({ where: kind === 'email' ? { email: value } : { mobile: value }, select: { id: true } });
  if (taken) {
    const message = kind === 'email' ? 'Another account uses this email' : 'Another account uses this mobile number';
    throw new AppError(kind === 'email' ? 'EMAIL_TAKEN' : 'MOBILE_TAKEN', `${message}.`, { fields: { value: message } });
  }
  const sent = await sendOtp(value, purposeOf(kind));
  // The code proves the new address; this token proves the password was checked
  const changeToken = signPurposeToken(`${kind}_change`, { sub: userId, value }, 10 * 60);
  return { changeToken, devCode: sent.devCode };
}

export async function confirmContactChange(req: Request, userId: string, kind: Kind, changeToken: string, code: string) {
  const p = verifyPurposeToken<{ sub: string; value: string }>(`${kind}_change`, changeToken);
  if (p.sub !== userId) throw new AppError('OTP_TOKEN_INVALID', 'Please start again.');
  await consumeOtp(p.value, purposeOf(kind), code);
  const before = await db().user.findUniqueOrThrow({ where: { id: userId } });
  const taken = await db().user.findFirst({ where: kind === 'email' ? { email: p.value } : { mobile: p.value }, select: { id: true } });
  if (taken) throw new AppError(kind === 'email' ? 'EMAIL_TAKEN' : 'MOBILE_TAKEN', 'Another account now uses this address.');
  await db().user.update({
    where: { id: userId },
    data: kind === 'email' ? { email: p.value, emailVerifiedAt: new Date() } : { mobile: p.value, mobileVerifiedAt: new Date() },
  });
  await audit({ tenantId: null, actorId: userId, action: `account.${kind}.change`, entity: 'user', entityId: userId, before: { [kind]: before[kind] }, after: { [kind]: p.value }, ip: req.ip });
  // Security notice to the old address (cannot be muted)
  await sendMessage({
    channel: kind === 'email' ? 'email' : 'sms',
    to: before[kind],
    template: `account.${kind}_changed`,
    subject: kind === 'email' ? 'Your AHEAD sign-in email was changed' : undefined,
    text: `Hi ${before.name}, the ${kind} on your AHEAD account was changed to ${p.value}. If this wasn't you, reset your password now: ${env.APP_URL}/forgot-password`,
  });
  return { [kind]: p.value };
}

// ── Passwords ──

/** Check a new password against the strictest policy and recent passwords, then save it. */
export async function applyNewPassword(userId: string, password: string, field = 'password') {
  const user = await db().user.findUniqueOrThrow({ where: { id: userId } });
  const { password: rules, passwordSetBy } = await personalPolicy(userId);
  const personal = [user.name.split(' ')[0], user.email.split('@')[0], user.mobile.slice(-10)];
  const problem = passwordPolicyError(password, rules, personal);
  if (problem) {
    const message = passwordSetBy && rules.minLength > 8 && problem.startsWith('Use at least') ? `${passwordSetBy} needs ${describePasswordPolicy(rules)}` : problem;
    throw new AppError('VALIDATION_FAILED', message, { fields: { [field]: message } });
  }
  if (user.passwordHash && (await verifyPassword(user.passwordHash, password))) {
    throw new AppError('VALIDATION_FAILED', 'Choose a password you haven\'t used before.', { fields: { [field]: "That's your current password" } });
  }
  if (rules.reuseBlock > 0) {
    const recent = await db().userPasswordHistory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: rules.reuseBlock });
    for (const h of recent) {
      if (await verifyPassword(h.passwordHash, password)) {
        const message = `You used this password recently — pick one not in your last ${rules.reuseBlock}`;
        throw new AppError('VALIDATION_FAILED', message, { fields: { [field]: message } });
      }
    }
  }
  if (user.passwordHash) await db().userPasswordHistory.create({ data: { userId, passwordHash: user.passwordHash } });
  // Keep the last 5 (the longest reuse rule)
  const old = await db().userPasswordHistory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: 5, select: { id: true } });
  if (old.length) await db().userPasswordHistory.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  await db().user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } });
}

export async function changePassword(req: Request, userId: string, sessionId: string, current: string, password: string, signOutOthers: boolean) {
  await requirePassword(userId, current, 'current');
  await applyNewPassword(userId, password);
  let signedOut = 0;
  if (signOutOthers) signedOut = await signOutOtherSessions(userId, sessionId);
  await audit({ tenantId: null, actorId: userId, action: 'account.password.change', entity: 'user', entityId: userId, after: { signedOutOthers: signOutOthers, sessions: signedOut }, ip: req.ip });
  return { signedOut };
}

/** When the password has to be changed at sign-in (policy expiry). */
export async function passwordExpired(user: { passwordChangedAt: Date | null; createdAt: Date }, expiryDays: number) {
  if (!expiryDays) return false;
  const since = (user.passwordChangedAt ?? user.createdAt).getTime();
  return Date.now() - since > expiryDays * DAY;
}

// ── Sessions ──

/** Active sign-ins, one row per refresh-token family (the newest token in it). */
export async function listSessions(where: Prisma.UserSessionWhereInput) {
  const rows = await prisma.userSession.findMany({
    where: { ...where, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true } } },
  });
  const seen = new Set<string>();
  const families = rows.filter((r) => (seen.has(r.familyId) ? false : (seen.add(r.familyId), true)));
  const firsts = await prisma.userSession.groupBy({ by: ['familyId'], where: { familyId: { in: families.map((f) => f.familyId) } }, _min: { createdAt: true } });
  const started = new Map(firsts.map((f) => [f.familyId, f._min.createdAt]));
  return families.map((s) => ({
    familyId: s.familyId,
    userId: s.user.id,
    userName: s.user.name,
    device: deviceLabel(s.userAgent),
    userAgent: s.userAgent,
    ip: s.ip,
    workspace: s.workspace,
    tenantId: s.tenantId,
    lastActiveAt: s.createdAt,
    signedInAt: started.get(s.familyId) ?? s.createdAt,
    expiresAt: s.expiresAt,
  }));
}

export async function revokeFamily(familyId: string, userId?: string) {
  const r = await db().userSession.updateMany({ where: { familyId, revokedAt: null, ...(userId ? { userId } : {}) }, data: { revokedAt: new Date() } });
  return r.count;
}

export async function signOutOtherSessions(userId: string, sessionId: string) {
  const current = await db().userSession.findUnique({ where: { id: sessionId }, select: { familyId: true } });
  const r = await db().userSession.updateMany({ where: { userId, revokedAt: null, ...(current ? { familyId: { not: current.familyId } } : {}) }, data: { revokedAt: new Date() } });
  return r.count;
}

/** "This wasn't me": sign out everywhere (this device too) and forget trusted devices. */
export async function notMe(req: Request, userId: string) {
  const r = await db().userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await db().userTrustedDevice.deleteMany({ where: { userId } });
  await audit({ tenantId: null, actorId: userId, action: 'account.sessions.not_me', entity: 'user', entityId: userId, after: { sessions: r.count }, ip: req.ip });
  return r.count;
}

export async function listSignIns(userId: string, days = 30) {
  const rows = await prisma.signInEvent.findMany({
    where: { userId, createdAt: { gt: new Date(Date.now() - days * DAY) } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => ({ id: r.id, at: r.createdAt, outcome: r.outcome, method: r.method, ip: r.ip, device: deviceLabel(r.userAgent) }));
}

// ── Two-step verification (authenticator app) ──

/** Step 1 + 2: password, then a new secret. Nothing is stored until the code is confirmed. */
export async function startMfaSetup(userId: string, password: string) {
  const user = await requirePassword(userId, password);
  const secret = newSecret();
  const setupToken = signPurposeToken('mfa_setup', { sub: userId, s: encryptSecret(secret) }, 15 * 60);
  return { setupToken, secret, otpauthUrl: otpauthUrl(secret, user.email) };
}

/** Step 3: the code proves the app is set up. Returns the backup codes (shown once). */
export async function confirmMfaSetup(req: Request, userId: string, setupToken: string, code: string) {
  const p = verifyPurposeToken<{ sub: string; s: string }>('mfa_setup', setupToken);
  if (p.sub !== userId) throw new AppError('OTP_TOKEN_INVALID', 'Please start again.');
  const secret = decryptSecret(p.s);
  if (!verifyTotp(secret, code)) {
    throw new AppError('VALIDATION_FAILED', "That code didn't match. Check the time on your phone is automatic and try the next code.", { fields: { code: "That code didn't match" } });
  }
  const backupCodes = newBackupCodes();
  const stored: BackupCode[] = backupCodes.map((c) => ({ hash: hashBackupCode(c), usedAt: null }));
  const wasOn = (await db().user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabled: true } })).mfaEnabled;
  await db().userMfa.upsert({
    where: { userId },
    create: { userId, secretEnc: p.s, enabledAt: new Date(), backupCodes: stored as unknown as Prisma.InputJsonValue },
    update: { secretEnc: p.s, enabledAt: new Date(), backupCodes: stored as unknown as Prisma.InputJsonValue, failedAttempts: 0, lockedUntil: null },
  });
  await db().user.update({ where: { id: userId }, data: { mfaEnabled: true } });
  forgetMfa(userId);
  await audit({ tenantId: null, actorId: userId, action: wasOn ? 'account.mfa.change_app' : 'account.mfa.enable', entity: 'user', entityId: userId, ip: req.ip });
  return { backupCodes };
}

export async function disableMfa(req: Request, userId: string, password: string, code: string) {
  const req2 = await mfaRequirement(userId);
  if (req2.requiredBy.length) {
    throw new AppError('PERMISSION_DENIED', `${req2.requiredBy[0].name} requires two-step verification, so it can't be turned off.`);
  }
  await requirePassword(userId, password);
  await checkSecondFactor(userId, { code });
  await db().userMfa.delete({ where: { userId } });
  await db().user.update({ where: { id: userId }, data: { mfaEnabled: false } });
  await db().userTrustedDevice.deleteMany({ where: { userId } });
  forgetMfa(userId);
  await audit({ tenantId: null, actorId: userId, action: 'account.mfa.disable', entity: 'user', entityId: userId, ip: req.ip });
}

export async function regenerateBackupCodes(req: Request, userId: string, password: string) {
  await requirePassword(userId, password);
  const mfa = await db().userMfa.findUnique({ where: { userId } });
  if (!mfa?.enabledAt) throw new AppError('CONFLICT', 'Turn on two-step verification first.');
  const backupCodes = newBackupCodes();
  await db().userMfa.update({ where: { userId }, data: { backupCodes: backupCodes.map((c) => ({ hash: hashBackupCode(c), usedAt: null })) as unknown as Prisma.InputJsonValue } });
  await audit({ tenantId: null, actorId: userId, action: 'account.mfa.backup_codes', entity: 'user', entityId: userId, ip: req.ip });
  return { backupCodes };
}

/**
 * Check an app code or a backup code. Wrong codes count towards a 15-minute lock after 5;
 * the counter is written with the owner client so a rolled-back request still counts.
 */
export async function checkSecondFactor(userId: string, input: { code?: string; backupCode?: string }) {
  const mfa = await db().userMfa.findUnique({ where: { userId } });
  if (!mfa?.enabledAt) throw new AppError('CONFLICT', 'Two-step verification is not on for this account.');
  if (mfa.lockedUntil && mfa.lockedUntil > new Date()) {
    throw new AppError('ACCOUNT_LOCKED', 'Too many wrong codes. Try again in 15 minutes.', { lockedUntil: mfa.lockedUntil.toISOString() });
  }
  let ok = false;
  let left: number | null = null;
  if (input.backupCode) {
    const codes = (mfa.backupCodes ?? []) as BackupCode[];
    const h = hashBackupCode(input.backupCode);
    const hit = codes.find((c) => c.hash === h && !c.usedAt);
    if (hit) {
      ok = true;
      hit.usedAt = new Date().toISOString();
      left = codes.filter((c) => !c.usedAt).length;
      await prisma.userMfa.update({ where: { userId }, data: { backupCodes: codes as unknown as Prisma.InputJsonValue } });
    }
  } else if (input.code) {
    ok = verifyTotp(decryptSecret(mfa.secretEnc), input.code);
  }
  if (!ok) {
    const failed = mfa.failedAttempts + 1;
    const lock = failed >= MFA_LOCK_AFTER;
    await prisma.userMfa.update({ where: { userId }, data: { failedAttempts: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + MFA_LOCK_MS) : null } });
    if (lock) throw new AppError('ACCOUNT_LOCKED', 'Too many wrong codes. Sign-in is locked for 15 minutes.', { locked: true });
    const field = input.backupCode ? 'backupCode' : 'code';
    const message = input.backupCode ? "That backup code isn't valid or was already used" : "That code didn't match";
    throw new AppError('VALIDATION_FAILED', `${message}.`, { fields: { [field]: message }, attemptsLeft: MFA_LOCK_AFTER - failed });
  }
  if (mfa.failedAttempts) await prisma.userMfa.update({ where: { userId }, data: { failedAttempts: 0 } });
  return { backupCodesLeft: left ?? codesLeft(mfa.backupCodes) };
}

// ── Trusted devices (skip the app code for 30 days) ──

export async function isTrustedDevice(req: Request, userId: string) {
  const token = req.cookies?.[TRUSTED_COOKIE];
  if (!token) return false;
  const d = await db().userTrustedDevice.findUnique({ where: { tokenHash: sha256(token) } });
  return !!d && d.userId === userId && d.expiresAt > new Date();
}

export async function trustDevice(req: Request, res: Response, userId: string) {
  const token = randomToken();
  await db().userTrustedDevice.create({
    data: { userId, tokenHash: sha256(token), userAgent: req.header('user-agent')?.slice(0, 300), expiresAt: new Date(Date.now() + TRUST_DAYS * DAY) },
  });
  res.cookie(TRUSTED_COOKIE, token, { httpOnly: true, secure: !isDev, sameSite: 'lax', path: '/api/v1/auth', maxAge: TRUST_DAYS * DAY });
}

/** Families signed in from a device that is still trusted (shown as "Trusted 30 days"). */
export async function trustedUserAgents(userId: string) {
  const rows = await prisma.userTrustedDevice.findMany({ where: { userId, expiresAt: { gt: new Date() } }, select: { userAgent: true } });
  return new Set(rows.map((r) => r.userAgent ?? ''));
}

// ── Admin reset (Settings › Team) ──

/**
 * An Owner/Admin resets two-step for a member who lost their phone. Refused when the
 * person also belongs to another business or the Console: one business can't weaken the
 * account for the others.
 */
export async function adminResetMfa(tenantId: string, actorId: string, memberUserId: string, reason: string) {
  if (memberUserId === actorId) throw new AppError('VALIDATION_FAILED', 'Use My account › Security to change your own two-step verification.');
  const [others, platform, user] = await Promise.all([
    prisma.tenantMember.count({ where: { userId: memberUserId, status: 'active', tenantId: { not: tenantId } } }),
    prisma.platformMember.findUnique({ where: { userId: memberUserId } }),
    prisma.user.findUniqueOrThrow({ where: { id: memberUserId } }),
  ]);
  if (others > 0 || platform) {
    throw new AppError('PERMISSION_DENIED', `${user.name} also uses another AHEAD workspace, so only they can reset two-step (with a backup code).`);
  }
  await prisma.$transaction([
    prisma.userMfa.deleteMany({ where: { userId: memberUserId } }),
    prisma.userTrustedDevice.deleteMany({ where: { userId: memberUserId } }),
    prisma.user.update({ where: { id: memberUserId }, data: { mfaEnabled: false } }),
  ]);
  forgetMfa(memberUserId);
  await audit({ tenantId, actorId, action: 'tenant.member.mfa_reset', entity: 'user', entityId: memberUserId, after: { reason } });
  await sendMessage({
    channel: 'email', to: user.email, template: 'account.mfa_reset', subject: 'Your two-step verification was reset',
    text: `Hi ${user.name}, an admin reset two-step verification on your AHEAD account. You'll set it up again when you next sign in. Reason: ${reason}`,
  });
}
