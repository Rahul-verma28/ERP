import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db, prisma } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { zReason } from '../../kernel/zodRules';
import { cidrError, ipAllowed, securityWithDefaults, type SecurityPolicy } from '../../contracts/account';
import { audit } from '../audit/service';
import { sendMessage } from '../notifications/service';
import { forgetTenantSecurity, policyCovers } from '../account/policy';
import { listSessions } from '../account/service';
import { deviceLabel } from '../account/signin';
import type { TenantCtx } from '../../kernel/context';

// Settings › Users & security: the rules for everyone who signs in to this business,
// the team's active sessions and the sign-in history.

export const SecurityInput = z.object({
  policy: z.object({
    mfa: z.object({
      policy: z.enum(['off', 'admins', 'everyone', 'roles']),
      roleIds: z.array(z.string().uuid()).max(50),
      graceDays: z.number().int().min(0, 'Use 0–30 days').max(30, 'Use 0–30 days'),
    }),
    password: z.object({
      minLength: z.number().int().min(8, 'Use 8–32 characters').max(32, 'Use 8–32 characters'),
      requireNumber: z.boolean(),
      requireSymbol: z.boolean(),
      blockCommon: z.boolean(),
      expiryDays: z.union([z.literal(0), z.literal(90), z.literal(180)]),
      reuseBlock: z.union([z.literal(0), z.literal(3), z.literal(5)]),
    }),
    sessions: z.object({
      idleMinutes: z.union([z.literal(30), z.literal(120), z.literal(480), z.literal(1440), z.literal(10080)]),
      maxDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    }),
    ipAllowlist: z.array(z.string().trim().min(1)).max(50, 'Up to 50 networks'),
  }),
  reason: zReason,
  /** The admin saw the warning that the list leaves out their own network */
  allowSelfExclusion: z.boolean().default(false),
});

const readRaw = (prefs: unknown) => ((prefs ?? {}) as Record<string, unknown>);

async function membersWithMfa(tenantId: string) {
  return prisma.tenantMember.findMany({
    where: { tenantId, status: 'active' },
    select: { userId: true, role: { select: { id: true, key: true, name: true } }, user: { select: { name: true, mfaEnabled: true } } },
  });
}

export async function getSecurity(tenantId: string, actorId: string, ip: string | undefined) {
  const t = await db().tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { preferences: true, ownerUserId: true } });
  const policy = securityWithDefaults(readRaw(t.preferences).security);
  const members = await membersWithMfa(tenantId);
  const covered = members.filter((m) => policyCovers({ ...policy.mfa, policy: policy.mfa.policy === 'off' ? 'admins' : policy.mfa.policy }, m.role));
  return {
    policy,
    currentIp: ip ?? null,
    currentIpAllowed: ipAllowed(ip, policy.ipAllowlist),
    me: { mfaEnabled: members.find((m) => m.userId === actorId)?.user.mfaEnabled ?? false, isOwner: t.ownerUserId === actorId },
    // Who the current (or, when off, the suggested owner & admins) rule would cover and hasn't set it up
    withoutMfa: covered.filter((m) => !m.user.mfaEnabled).map((m) => ({ userId: m.userId, name: m.user.name, role: m.role.name })),
    adminsWithoutMfa: members.filter((m) => (m.role.key === 'owner' || m.role.key === 'admin') && !m.user.mfaEnabled).length,
  };
}

export async function updateSecurity(ctx: TenantCtx, input: z.infer<typeof SecurityInput>) {
  const t = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { preferences: true, name: true, ownerUserId: true } });
  const raw = readRaw(t.preferences);
  const before = securityWithDefaults(raw.security);
  const next = input.policy;

  const fields: Record<string, string> = {};
  next.ipAllowlist.forEach((entry, i) => {
    const e = cidrError(entry);
    if (e) fields[`policy.ipAllowlist.${i}`] = e;
  });
  if (next.mfa.policy === 'roles' && !next.mfa.roleIds.length) fields['policy.mfa.roleIds'] = 'Choose at least one role';
  if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', 'Some fields are invalid.', { fields });

  if (next.ipAllowlist.length && !ipAllowed(ctx.ip, next.ipAllowlist) && !input.allowSelfExclusion) {
    throw new AppError('VALIDATION_FAILED', `This list leaves out your current network (${ctx.ip}). You'd be signed out of ${t.name}.`, {
      fields: { 'policy.ipAllowlist': `Leaves out your current IP ${ctx.ip}` },
      selfExcluded: true,
    });
  }

  // Nobody locks themself out: whoever turns the rule on must already use two-step
  if (next.mfa.policy !== 'off') {
    const actorRole = await db().tenantMember.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: ctx.tenantId, userId: ctx.userId } }, select: { role: { select: { id: true, key: true } } } });
    const me = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { mfaEnabled: true } });
    if (!me.mfaEnabled && policyCovers({ ...before.mfa, ...next.mfa }, actorRole.role)) {
      throw new AppError('VALIDATION_FAILED', 'Turn on two-step verification for yourself first (My account › Security).', { fields: { 'policy.mfa.policy': 'Turn it on for yourself first' }, needsOwnMfa: true });
    }
  }

  const coverageChanged = next.mfa.policy !== before.mfa.policy || next.mfa.roleIds.join() !== before.mfa.roleIds.join();
  const policy: SecurityPolicy = {
    ...next,
    mfa: { ...next.mfa, since: next.mfa.policy === 'off' ? null : coverageChanged || !before.mfa.since ? new Date().toISOString() : before.mfa.since },
  };
  await db().tenant.update({ where: { id: ctx.tenantId }, data: { preferences: { ...raw, security: policy } as unknown as Prisma.InputJsonValue } });
  forgetTenantSecurity(ctx.tenantId);
  await audit({ action: 'tenant.security.update', entity: 'tenant', entityId: ctx.tenantId, before, after: { ...policy, reason: input.reason } });

  const owner = await prisma.user.findUniqueOrThrow({ where: { id: t.ownerUserId }, select: { email: true, name: true } });
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } });
  await sendMessage({
    channel: 'email', to: owner.email, template: 'tenant.security_changed', subject: `Security settings changed in ${t.name}`,
    text: `Hi ${owner.name}, ${actor.name} changed the sign-in rules for ${t.name}. Reason: ${input.reason}`,
  });
  return policy;
}

// ── Team sessions ──

export async function teamSessions(ctx: TenantCtx) {
  const current = await prisma.userSession.findUnique({ where: { id: ctx.sessionId }, select: { familyId: true } });
  const rows = await listSessions({ tenantId: ctx.tenantId });
  return rows.map(({ userAgent: _ua, ...s }) => ({ ...s, current: s.familyId === current?.familyId }));
}

export async function signOutTeamSession(ctx: TenantCtx, familyId: string) {
  const current = await prisma.userSession.findUnique({ where: { id: ctx.sessionId }, select: { familyId: true } });
  if (current?.familyId === familyId) throw new AppError('VALIDATION_FAILED', 'Use Sign out to end your own session.');
  const r = await prisma.userSession.updateMany({ where: { familyId, tenantId: ctx.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) throw new AppError('NOT_FOUND', 'That session has already ended.');
  await audit({ action: 'tenant.session.sign_out', entity: 'session', entityId: familyId });
}

export async function signOutEveryoneElse(ctx: TenantCtx) {
  const current = await prisma.userSession.findUnique({ where: { id: ctx.sessionId }, select: { familyId: true } });
  const r = await prisma.userSession.updateMany({
    where: { tenantId: ctx.tenantId, revokedAt: null, ...(current ? { familyId: { not: current.familyId } } : {}) },
    data: { revokedAt: new Date() },
  });
  await audit({ action: 'tenant.session.sign_out_all', entity: 'tenant', entityId: ctx.tenantId, after: { sessions: r.count } });
  return r.count;
}

// ── Sign-in history ──

const OUTCOME_LABEL: Record<string, string> = {
  success: 'Signed in',
  wrong_password: 'Wrong password',
  locked: 'Locked 15 min',
  mfa_challenge: 'Two-step asked',
  mfa_failed: 'Wrong two-step code',
  mfa_locked: 'Two-step locked 15 min',
  blocked_ip: 'Blocked network',
  expired_password: 'Password expired',
  unknown_account: 'Unknown account',
};
export const FAILED_OUTCOMES = ['wrong_password', 'locked', 'mfa_failed', 'mfa_locked', 'blocked_ip'];

export async function teamSignIns(tenantId: string, opts: { failedOnly: boolean; days: number }) {
  const members = await prisma.tenantMember.findMany({ where: { tenantId }, select: { userId: true, user: { select: { name: true } } } });
  const names = new Map(members.map((m) => [m.userId, m.user.name]));
  const rows = await prisma.signInEvent.findMany({
    where: {
      userId: { in: [...names.keys()] },
      createdAt: { gt: new Date(Date.now() - opts.days * 86_400_000) },
      ...(opts.failedOnly ? { outcome: { in: FAILED_OUTCOMES } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return rows.map((r) => {
    const attempt = r.method?.startsWith('password:') ? Number(r.method.split(':')[1]) : null;
    const twoStep = !!r.method && /\+(app|backup_code)$/.test(r.method);
    let label = OUTCOME_LABEL[r.outcome] ?? r.outcome;
    if (r.outcome === 'wrong_password' && attempt) label = `Wrong password (${attempt} of 5)`;
    if (r.outcome === 'success' && twoStep) label = 'Signed in · two-step';
    return {
      id: r.id,
      at: r.createdAt,
      userId: r.userId,
      person: (r.userId && names.get(r.userId)) || r.identifier || 'Unknown',
      identifier: r.identifier,
      outcome: r.outcome,
      label,
      failed: FAILED_OUTCOMES.includes(r.outcome),
      ip: r.ip,
      device: deviceLabel(r.userAgent),
    };
  });
}

export function signInsCsv(rows: Awaited<ReturnType<typeof teamSignIns>>) {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [['Time (UTC)', 'Person', 'Identifier', 'Result', 'IP', 'Device'].join(',')];
  for (const r of rows) lines.push([r.at.toISOString(), r.person, r.identifier, r.label, r.ip, r.device].map(esc).join(','));
  return lines.join('\n');
}
