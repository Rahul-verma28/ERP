import { withDefaults, type WorkspaceProfile } from '../../contracts/workspace';
import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { db, prisma, withTenant } from '../../kernel/db';
import { logSignIn } from '../account/signin';
import { mfaRequirement } from '../account/policy';
import { personalWithDefaults } from '../../contracts/account';
import { AppError } from '../../kernel/errors';
import { hashPassword, verifyPassword } from '../../kernel/crypto';
import { getEntitlements } from '../subscription/entitlements';
import { effectivePermissions, getFieldAccess, getMember } from '../access/service';
import { getTerms } from '../config/service';
import { audit } from '../audit/service';
import { consoleAccess } from '../console/service';
import { getSetting } from '../settings/service';
import { sendMessage } from '../notifications/service';
import { signPurposeToken, startSession } from './tokens';

const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;

/** Pick the tenant to open after login: last used if still active, else the first active one. */
export async function pickTenant(userId: string, preferred?: string | null) {
  const memberships = await db().tenantMember.findMany({
    where: { userId, status: 'active', tenant: { status: { not: 'purged' } } },
    orderBy: { joinedAt: 'asc' },
    select: { tenantId: true, roleId: true },
  });
  return memberships.find((m) => m.tenantId === preferred) ?? memberships[0] ?? null;
}

/** Shared tail of every successful login. Must run in a platform transaction. */
export async function completeLogin(req: Request, res: Response, userId: string, method: string, open: { tenantId?: string | null; console?: boolean } = {}) {
  const tx = db();
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const membership = open.console ? null : await pickTenant(user.id, open.tenantId ?? user.lastTenantId);
  await tx.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null, lastTenantId: membership?.tenantId ?? user.lastTenantId },
  });
  // AHEAD team members with no business of their own (or arriving from a Console link) land in the Console
  const platform = membership ? null : await tx.platformMember.findUnique({ where: { userId: user.id } });
  const accessToken = platform?.status === 'active'
    ? await startSession(req, res, user.id, null, platform.roleId, 'console')
    : await startSession(req, res, user.id, membership?.tenantId ?? null, membership?.roleId ?? null);
  await audit({ tenantId: membership?.tenantId ?? null, actorId: user.id, action: 'auth.login', after: { method, workspace: platform?.status === 'active' ? 'console' : 'tenant' }, ip: req.ip, requestId: req.requestId });
  await logSignIn(req, { userId: user.id, tenantId: membership?.tenantId ?? null, identifier: user.email, outcome: 'success', method });
  return { accessToken };
}

/**
 * Password check with lockout after 5 failures for 15 minutes (LLD §11.2). The failure
 * counter and the sign-in history are written with the owner client: the request
 * transaction rolls back when this throws.
 */
export async function checkPassword(identifier: { email?: string; mobile?: string }, password: string, req?: Request) {
  const tx = db();
  const raw = identifier.email ?? identifier.mobile ?? '';
  const user = await tx.user.findFirst({ where: identifier.email ? { email: identifier.email } : { mobile: identifier.mobile } });
  if (!user || !user.passwordHash) {
    if (req) await logSignIn(req, { identifier: raw, outcome: 'unknown_account', method: 'password' });
    throw new AppError('INVALID_CREDENTIALS', 'Incorrect email/mobile or password.');
  }
  if (user.status === 'disabled') throw new AppError('ACCOUNT_LOCKED', 'This account is disabled.');
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    if (req) await logSignIn(req, { userId: user.id, identifier: raw, outcome: 'locked', method: 'password' });
    throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes.', { lockedUntil: user.lockedUntil.toISOString() });
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    const failed = user.failedLogins + 1;
    const locked = failed >= LOCK_AFTER;
    const lockedUntil = locked ? new Date(Date.now() + LOCK_MS) : null;
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: locked ? 0 : failed, lockedUntil } });
    if (req) await logSignIn(req, { userId: user.id, identifier: raw, outcome: locked ? 'locked' : 'wrong_password', method: `password:${failed}` });
    if (locked) throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Sign-in is locked for 15 minutes.', { lockedUntil: lockedUntil!.toISOString() });
    throw new AppError('INVALID_CREDENTIALS', 'Incorrect email/mobile or password.', { attemptsLeft: LOCK_AFTER - failed });
  }
  return user;
}

export async function sendEmailVerification(user: { id: string; email: string; name: string }) {
  const token = signPurposeToken('email_verify', { sub: user.id, email: user.email }, 24 * 60 * 60);
  await sendMessage({
    channel: 'email',
    to: user.email,
    template: 'email.verify',
    subject: 'Verify your email for AHEAD',
    text: `Hi ${user.name}, confirm your email: ${env.APP_URL}/verify-email?token=${token}`,
  });
}

export async function setPassword(userId: string, password: string) {
  await db().user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } });
}

/** GET /me — everything the frontend needs to render the app for the current workspace. */
export async function buildMe(userId: string, tenantId: string | null, workspace: 'tenant' | 'console' = 'tenant') {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const [memberships, consoleInfo, banner] = await Promise.all([
    prisma.tenantMember.findMany({
      where: { userId, status: 'active', tenant: { status: { not: 'purged' } } },
      include: { tenant: { select: { id: true, name: true, status: true, logoUrl: true } }, role: { select: { name: true } } },
    }),
    consoleAccess(userId),
    getSetting('announcement.banner'),
  ]);
  const mfa = await mfaRequirement(userId);
  const announcement = banner?.text && (!banner.until || new Date(banner.until) > new Date()) ? { text: banner.text, tone: banner.tone } : null;

  const base = {
    workspace: workspace === 'console' && consoleInfo ? ('console' as const) : ('tenant' as const),
    user: {
      id: user.id, name: user.name, email: user.email, mobile: user.mobile,
      emailVerified: !!user.emailVerifiedAt, mobileVerified: !!user.mobileVerifiedAt,
      preferences: personalWithDefaults(user.preferences),
    },
    /** Two-step verification required by a business (or the Console) and its grace period */
    security: {
      mfaEnabled: mfa.mfaEnabled,
      mfaRequired: mfa.requiredBy.length > 0,
      requiredBy: mfa.requiredBy.map((r) => r.name),
      deadline: mfa.deadline,
      mustSetUpMfa: mfa.mustSetUp,
    },
    memberships: memberships.map((m) => ({ tenantId: m.tenantId, name: m.tenant.name, status: m.tenant.status, logoUrl: m.tenant.logoUrl, roleName: m.role.name })),
    /** Present only for AHEAD team members; drives the workspace switcher */
    console: consoleInfo,
    /** Platform-wide banner set from the Console */
    announcement,
  };
  if (!tenantId || base.workspace === 'console') return { ...base, tenant: null };

  const member = await getMember(tenantId, userId);
  if (!member || member.status !== 'active') return { ...base, tenant: null };

  const [ent, permissions, fieldAccess] = await Promise.all([
    getEntitlements(tenantId),
    effectivePermissions(tenantId, member.roleId),
    getFieldAccess(member.roleId),
  ]);

  return withTenant({ kind: 'system', tenantId, userId }, async () => {
    const tenant = await db().tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const role = await db().role.findUniqueOrThrow({ where: { id: member.roleId }, select: { id: true, key: true, name: true, roleType: true } });
    const terms = await getTerms(tenantId);
    const daysLeft = ent.trialEndsAt ? Math.max(0, Math.ceil((ent.trialEndsAt.getTime() - Date.now()) / 86_400_000)) : null;
    return {
      ...base,
      tenant: {
        id: tenant.id, name: tenant.name, legalName: tenant.legalName, industryKey: tenant.industryKey, status: tenant.status,
        logoUrl: tenant.logoUrl, gstin: tenant.gstin, billingStateCode: tenant.billingStateCode, timezone: tenant.timezone, fyStartMonth: tenant.fyStartMonth,
        billingOwner: tenant.billingOwner, configApplied: !!tenant.configAppliedAt, needsSeatChoice: tenant.needsSeatChoice,
        isOwner: tenant.ownerUserId === userId, onboarding: tenant.onboarding, createdAt: tenant.createdAt,
        // Workspace look for every member; modules the owner chose at signup come first in the menu
        branding: withDefaults(tenant.preferences).branding,
        preferredModules: ((tenant.profile ?? {}) as WorkspaceProfile).modules ?? [],
      },
      role: { ...role, name: role.key === 'service_provider' ? terms['role.service_provider'] : role.name },
      subscription: { status: ent.status, planKey: ent.planKey, trialEndsAt: ent.trialEndsAt, daysLeft, currentPeriodEnd: ent.currentPeriodEnd },
      limits: ent.limits,
      modules: ent.modules,
      permissions,
      fieldAccess,
      terms,
    };
  });
}
