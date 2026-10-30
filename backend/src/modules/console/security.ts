import type { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { audit } from '../audit/service';
import { invalidatePlatformMember } from './service';

// Console Security & audit (blueprint Phase C, S7). Admin only. Shows who changed what in the
// Console (before and after), Console sign-ins and open Console sessions. Business records
// are never shown here: only the Console's own events.

const DAY = 86_400_000;

export const AUDIT_AREAS = {
  businesses: { label: 'Businesses', prefixes: ['console.client', 'console.trial', 'console.partner_client', 'console.partner_plan', 'console.onboarding', 'console.handover', 'tenant.acquisition', 'tenant.handover', 'console.note'] },
  billing: { label: 'Billing', prefixes: ['console.order', 'console.payment', 'console.credit_note'] },
  product: { label: 'Plans & pricing', prefixes: ['console.plan', 'console.price', 'console.coupon'] },
  people: { label: 'People & roles', prefixes: ['console.member', 'console.role', 'console.partner_created', 'console.partner_updated', 'console.session'] },
  settings: { label: 'Settings', prefixes: ['settings.'] },
  signin: { label: 'Sign-ins', prefixes: ['auth.', 'account.'] },
} as const;
export type AuditArea = keyof typeof AUDIT_AREAS;

/** Actions shown as risky: role and access changes, prices, refunds, settings */
const RISKY_PREFIXES = ['console.role', 'console.member', 'console.price', 'console.credit_note', 'settings.', 'tenant.acquisition', 'console.order_approved', 'console.session'];
const isRisky = (action: string) => RISKY_PREFIXES.some((p) => action.startsWith(p));
const areaOf = (action: string): AuditArea | null => (Object.entries(AUDIT_AREAS).find(([, a]) => a.prefixes.some((p) => action.startsWith(p)))?.[0] as AuditArea) ?? null;

/** Plain sentence for an event: "Rahul added a person to the Console" */
const TEXT: Record<string, string> = {
  'console.client_created': 'onboarded a business',
  'console.partner_client_created': 'onboarded a partner business',
  'console.client_converted': 'created a paid order',
  'console.trial_extended': 'extended a trial',
  'console.onboarding_import': 'imported data for a business',
  'console.handover_sent': 'handed a business over',
  'tenant.handover_accepted': 'accepted a handover',
  'tenant.acquisition_changed': 'changed who onboarded a business',
  'console.order_approved': 'approved a discount',
  'console.order_cancelled': 'cancelled an order',
  'console.payment_recorded': 'recorded a payment',
  'console.payment_link_sent': 'sent a payment link',
  'console.credit_note_issued': 'issued a refund',
  'console.plan_updated': 'changed a plan',
  'console.price_changed': 'changed a price',
  'console.coupon_created': 'created a coupon',
  'console.coupon_ended': 'ended a coupon',
  'console.member_added': 'added a person to the Console',
  'console.member_updated': "changed a person's role or access",
  'console.member_deactivated': 'turned a person off',
  'console.role_created': 'created a role',
  'console.role_updated': "changed a role's permissions",
  'console.role_reset': 'reset a role to its defaults',
  'console.role_deleted': 'deleted a role',
  'console.partner_created': 'added a partner',
  'console.partner_updated': 'changed a partner',
  'console.session_revoked': 'signed someone out',
  'settings.changed': 'changed a Console setting',
  'settings.reset': 'reset a Console setting',
  'auth.login': 'signed in',
  'auth.switch_console': 'opened the Console',
  'auth.access_link_used': 'set up their login from a link',
  'auth.password_reset': 'reset their password',
};
const sentence = (action: string) => TEXT[action] ?? action.replace(/^[a-z]+\./, '').replace(/[._]/g, ' ');

export async function assertAuditor(ctx: ConsoleCtx) {
  const role = await db().role.findUniqueOrThrow({ where: { id: ctx.roleId }, select: { key: true } });
  if (ctx.partnerId || role.key !== 'super_admin') throw new AppError('PERMISSION_DENIED', 'Only an Admin sees Security & audit.');
}

export interface AuditQuery {
  search?: string;
  area?: AuditArea;
  actorId?: string;
  days?: number;
  riskyOnly?: boolean;
  limit: number;
  cursor?: string;
}

/** Console-level events (not a business's own records), newest first. */
export async function listAudit(q: AuditQuery) {
  const since = new Date(Date.now() - (q.days ?? 30) * DAY);
  const or: Prisma.AuditLogWhereInput[] = [];
  const area = q.area ? AUDIT_AREAS[q.area] : null;
  const prefixes = area ? [...area.prefixes] : q.riskyOnly ? RISKY_PREFIXES : null;
  if (prefixes) for (const p of prefixes) or.push({ action: { startsWith: p } });
  let searchWhere: Prisma.AuditLogWhereInput | null = null;
  if (q.search) {
    // A person's name or email, a business name, or part of the action
    const [users, tenants] = await Promise.all([
      db().user.findMany({ where: { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search.toLowerCase() } }] }, select: { id: true }, take: 50 }),
      db().tenant.findMany({ where: { name: { contains: q.search, mode: 'insensitive' } }, select: { id: true }, take: 50 }),
    ]);
    searchWhere = { OR: [{ actorId: { in: users.map((u) => u.id) } }, { entityId: { in: tenants.map((t) => t.id) } }, { action: { contains: q.search.toLowerCase() } }] };
  }
  const where: Prisma.AuditLogWhereInput = {
    tenantId: null,
    at: { gte: since },
    ...(q.actorId ? { actorId: q.actorId } : {}),
    AND: [...(or.length ? [{ OR: or }] : []), ...(searchWhere ? [searchWhere] : [])],
  };
  const rows = await db().auditLog.findMany({ where, orderBy: { id: 'desc' }, take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) });
  const page = rows.slice(0, q.limit);
  const people = new Map((await db().user.findMany({ where: { id: { in: page.map((r) => r.actorId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const entityIds = page.map((r) => r.entityId).filter((x): x is string => !!x && /^[0-9a-f-]{36}$/.test(x));
  const [tenants, roles, users] = await Promise.all([
    db().tenant.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } }),
    db().role.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } }),
    db().platformMember.findMany({ where: { id: { in: entityIds } }, select: { id: true, user: { select: { name: true } } } }),
  ]);
  const names = new Map<string, string>([...tenants.map((t) => [t.id, t.name] as const), ...roles.map((r) => [r.id, r.name] as const), ...users.map((m) => [m.id, m.user.name] as const)]);
  return {
    data: page.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      area: areaOf(r.action),
      risky: isRisky(r.action),
      actor: r.actorId ? people.get(r.actorId) ?? 'Unknown person' : r.actorKind === 'system' ? 'AHEAD (automatic)' : 'AHEAD',
      text: sentence(r.action),
      subject: r.entityId ? names.get(r.entityId) ?? (r.entity === 'setting' ? r.entityId : null) : null,
      subjectHref: r.entityId && tenants.some((t) => t.id === r.entityId) ? `/console/clients/${r.entityId}` : r.entityId && roles.some((x) => x.id === r.entityId) ? `/console/roles/${r.entityId}` : null,
      before: r.before,
      after: r.after,
      ip: r.ip,
    })),
    nextCursor: rows.length > q.limit ? page[page.length - 1].id : null,
  };
}

/** The four numbers on top of Security & audit. */
export async function securityStats() {
  const week = new Date(Date.now() - 7 * DAY);
  const members = await db().platformMember.findMany({ where: { status: 'active', partnerId: null }, select: { userId: true, user: { select: { mfaEnabled: true } } } });
  const ids = members.map((m) => m.userId);
  const [changes, riskyRows, failed] = await Promise.all([
    db().auditLog.count({ where: { tenantId: null, at: { gte: week }, NOT: { action: { startsWith: 'auth.' } } } }),
    db().auditLog.findMany({ where: { tenantId: null, at: { gte: week }, OR: RISKY_PREFIXES.map((p) => ({ action: { startsWith: p } })) }, select: { id: true } }),
    db().signInEvent.count({ where: { userId: { in: ids }, createdAt: { gte: week }, outcome: { notIn: ['success', 'mfa_challenge'] } } }),
  ]);
  return { changes7d: changes, risky7d: riskyRows.length, failedSignIns7d: failed, twoStepOn: members.filter((m) => m.user.mfaEnabled).length, people: members.length };
}

/** Console people's sign-ins (AHEAD team, sales, vendors; partners are left out). */
export async function listSignIns(days = 30) {
  const members = await db().platformMember.findMany({ where: { partnerId: null }, select: { userId: true, user: { select: { name: true } } } });
  const name = new Map(members.map((m) => [m.userId, m.user.name]));
  const rows = await db().signInEvent.findMany({ where: { userId: { in: [...name.keys()] }, createdAt: { gte: new Date(Date.now() - days * DAY) } }, orderBy: { createdAt: 'desc' }, take: 200 });
  return rows.map((r) => ({ id: r.id, at: r.createdAt, person: r.userId ? name.get(r.userId) ?? '—' : '—', outcome: r.outcome, method: r.method, ip: r.ip, device: deviceOf(r.userAgent) }));
}

/** Pure: "Chrome on Windows" from a user agent */
export function deviceOf(ua: string | null | undefined) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'unknown system';
  return `${browser} on ${os}`;
}

/** Open Console sessions right now. */
export async function listSessions(ctx: ConsoleCtx) {
  const rows = await db().userSession.findMany({
    where: { workspace: 'console', revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { name: true, email: true, platformMember: { select: { partnerId: true, role: { select: { name: true } } } } } } },
  });
  return rows
    .filter((s) => !s.user.platformMember?.partnerId)
    .map((s) => ({ id: s.id, person: s.user.name, email: s.user.email, role: s.user.platformMember?.role.name ?? '—', since: s.createdAt, ip: s.ip, device: deviceOf(s.userAgent), current: s.id === ctx.sessionId }));
}

export async function revokeSession(ctx: ConsoleCtx, id: string) {
  if (id === ctx.sessionId) throw new AppError('INVALID_TRANSITION', "That's your own session. Use Sign out instead.");
  const s = await db().userSession.findFirst({ where: { id, workspace: 'console', revokedAt: null } });
  if (!s) throw notFound('Session');
  // Revoke the whole refresh family so the person is signed out of the Console everywhere it was copied
  await db().userSession.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  invalidatePlatformMember(s.userId);
  await audit({ tenantId: null, action: 'console.session_revoked', entity: 'user', entityId: s.userId, after: { sessionId: id } });
}
