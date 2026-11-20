import { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { db, withPlatform } from '../../kernel/db';
import { bundle, type Row } from '../../kernel/bundle';
import { AppError, notFound } from '../../kernel/errors';
import { randomToken, sha256 } from '../../kernel/crypto';
import type { TenantCtx } from '../../kernel/context';
import { MODULES } from '../../contracts/modules';
import { PERMISSION_CATALOG } from '../../contracts/permissions';
import { getEntitlements } from '../subscription/entitlements';
import { audit } from '../audit/service';
import { sendMessage } from '../notifications/service';

// Users: everyone in the business and everyone invited, in ONE database round trip (kernel/bundle),
// with their role, branches, last sign-in, two-step and the work open on them; and one person's
// page: what their role lets them do, their sign-ins and devices, their open work and what they did.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const n = (v: unknown) => Number(v ?? 0);

/** Open work per person, from every module, as one SELECT each */
const workParts = (t: string) => ({
  tasks: Prisma.sql`select assignee_id as user_id, count(*)::int as n, count(*) filter (where due_at < now())::int as late from tasks where tenant_id = ${t}::uuid and status in ('todo', 'in_progress') and assignee_id is not null group by assignee_id`,
  tickets: Prisma.sql`select assignee_id as user_id, count(*)::int as n from support_tickets where tenant_id = ${t}::uuid and status in ('new', 'open', 'pending', 'on_hold') and assignee_id is not null group by assignee_id`,
  appts: Prisma.sql`select staff_id as user_id, count(*)::int as n from appointments where tenant_id = ${t}::uuid and start_at >= now() and status in ('scheduled', 'confirmed') and staff_id is not null group by staff_id`,
  leads: Prisma.sql`select owner_id as user_id, count(*)::int as n from contacts where tenant_id = ${t}::uuid and type = 'lead' and (lead_status is null or lead_status::text not in ('lost', 'converted')) and owner_id is not null group by owner_id`,
});
const byUser = (rows: Row[]) => new Map(rows.map((r) => [r.userId as string, r]));

export async function listUsers(ctx: TenantCtx) {
  const t = ctx.tenantId;
  const b = await bundle({
    members: Prisma.sql`
      select m.id, m.status, m.branch_ids, m.joined_at, m.deactivated_at, m.version, m.created_at, m.role_id,
        u.id as user_id, u.name, u.email, u.mobile, u.last_login_at, u.mfa_enabled, r.key as role_key, r.name as role_name, r.is_predefined, r.role_type
      from tenant_members m join users u on u.id = m.user_id join roles r on r.id = m.role_id
      where m.tenant_id = ${t}::uuid order by m.created_at`,
    invites: Prisma.sql`
      select i.id, i.name, i.email, i.mobile, i.role_id, i.branch_ids, i.expires_at, i.created_at, i.invited_by, r.name as role_name, r.role_type, u.name as invited_by_name
      from invitations i join roles r on r.id = i.role_id left join users u on u.id = i.invited_by
      where i.tenant_id = ${t}::uuid and i.accepted_at is null and i.revoked_at is null order by i.created_at desc`,
    branches: Prisma.sql`select id, name from branches where tenant_id = ${t}::uuid order by is_default desc, name`,
    ...workParts(t),
  });
  // Sessions are account data the business's database role can't read; count them with platform rights
  const live = await withPlatform(() => db().userSession.groupBy({ by: ['userId'], where: { tenantId: t, revokedAt: null, expiresAt: { gt: new Date() } }, _count: true }));
  const branch = new Map(b.branches.map((x) => [x.id as string, x.name as string]));
  const [tasks, tickets, appts, leads] = [byUser(b.tasks), byUser(b.tickets), byUser(b.appts), byUser(b.leads)];
  const sessions = new Map(live.map((s) => [s.userId, { n: s._count }]));
  const now = Date.now();
  const members = b.members.map((m) => ({
    kind: 'member' as const, id: m.id as string, userId: m.userId as string, status: m.status as 'active' | 'deactivated' | 'invited',
    name: m.name as string, email: m.email as string | null, mobile: m.mobile as string | null,
    role: { id: m.roleId as string, key: m.roleKey as string, name: m.roleName as string, custom: !m.isPredefined }, seatFree: m.roleType === 'employee',
    branches: ((m.branchIds ?? []) as string[]).map((id) => ({ id, name: branch.get(id) ?? 'Branch' })),
    lastLoginAt: m.lastLoginAt as Date | null, mfaEnabled: !!m.mfaEnabled, joinedAt: (m.joinedAt ?? m.createdAt) as Date, version: m.version as number,
    you: m.userId === ctx.userId, owner: m.roleKey === 'owner', devices: n(sessions.get(m.userId)?.n),
    work: { tasks: n(tasks.get(m.userId)?.n), lateTasks: n(tasks.get(m.userId)?.late), tickets: n(tickets.get(m.userId)?.n), appointments: n(appts.get(m.userId)?.n), leads: n(leads.get(m.userId)?.n) },
  }));
  const invites = b.invites.map((i) => ({
    kind: 'invite' as const, id: i.id as string, userId: null, status: 'invited' as const,
    name: (i.name as string | null) || (i.email as string | null) || (i.mobile as string | null) || 'Invited person', email: i.email as string | null, mobile: i.mobile as string | null,
    role: { id: i.roleId as string, key: '', name: i.roleName as string, custom: false }, seatFree: i.roleType === 'employee',
    branches: ((i.branchIds ?? []) as string[]).map((id) => ({ id, name: branch.get(id) ?? 'Branch' })),
    expiresAt: i.expiresAt as Date, expired: new Date(i.expiresAt).getTime() < now, invitedBy: i.invitedByName as string | null, joinedAt: i.createdAt as Date,
  }));
  const ent = await getEntitlements(t);
  const active = members.filter((m) => m.status === 'active');
  const counts = {
    all: members.length + invites.length, active: active.length, invited: invites.length,
    deactivated: members.filter((m) => m.status === 'deactivated').length,
    nomfa: active.filter((m) => !m.mfaEnabled).length,
    never: active.filter((m) => !m.lastLoginAt).length,
  };
  const week = now - 7 * 86_400_000;
  return {
    data: [...members, ...invites], counts, branches: b.branches,
    sums: {
      // Self-service employee logins don't take a paid seat
      seats: ent.limits?.users ?? null, used: active.filter((m) => !m.seatFree).length + invites.filter((i) => !i.expired && !i.seatFree).length,
      selfService: active.filter((m) => m.seatFree).length + invites.filter((i) => !i.expired && i.seatFree).length,
      signedInWeek: active.filter((m) => m.lastLoginAt && new Date(m.lastLoginAt).getTime() >= week).length,
      mfaPct: active.length ? Math.round((active.filter((m) => m.mfaEnabled).length / active.length) * 100) : 0,
      expiredInvites: invites.filter((i) => i.expired).length,
    },
  };
}

/** One person: role and what it allows, branches, sign-ins and devices, open work, and what they did */
export async function getUser(ctx: TenantCtx, memberId: string) {
  const t = ctx.tenantId;
  const b = await bundle({
    m: Prisma.sql`
      select m.id, m.status, m.branch_ids, m.joined_at, m.deactivated_at, m.version, m.created_at, m.role_id,
        u.id as user_id, u.name, u.email, u.mobile, u.last_login_at, u.mfa_enabled, u.created_at as account_since,
        r.key as role_key, r.name as role_name, r.description as role_description, r.is_predefined
      from tenant_members m join users u on u.id = m.user_id join roles r on r.id = m.role_id
      where m.tenant_id = ${t}::uuid and m.id = ${memberId}::uuid`,
  });
  const m = b.m[0];
  if (!m) throw notFound('User');
  const uid = m.userId as string;
  const d = await bundle({
    perms: Prisma.sql`select permission_key, scope from role_permissions where role_id = ${m.roleId}::uuid`,
    branches: Prisma.sql`select id, name, is_default from branches where tenant_id = ${t}::uuid order by is_default desc, name`,
    employee: Prisma.sql`select e.id, e.code, e.name, g.name as designation from employees e left join hr_designations g on g.id = e.designation_id where e.tenant_id = ${t}::uuid and e.member_id = ${memberId}::uuid limit 1`,
    tasks: Prisma.sql`select id, title, due_at, priority from tasks where tenant_id = ${t}::uuid and assignee_id = ${uid}::uuid and status in ('todo', 'in_progress') order by due_at nulls last limit 6`,
    tickets: Prisma.sql`select id, number, subject, priority, status from support_tickets where tenant_id = ${t}::uuid and assignee_id = ${uid}::uuid and status in ('new', 'open', 'pending', 'on_hold') order by created_at limit 6`,
    appts: Prisma.sql`select id, title, start_at from appointments where tenant_id = ${t}::uuid and staff_id = ${uid}::uuid and start_at >= now() and status in ('scheduled', 'confirmed') order by start_at limit 6`,
    counts: Prisma.sql`select
        (select count(*)::int from tasks where tenant_id = ${t}::uuid and assignee_id = ${uid}::uuid and status in ('todo', 'in_progress')) as tasks,
        (select count(*)::int from tasks where tenant_id = ${t}::uuid and assignee_id = ${uid}::uuid and status = 'done' and completed_at >= now() - interval '30 days') as tasks_done30,
        (select count(*)::int from support_tickets where tenant_id = ${t}::uuid and assignee_id = ${uid}::uuid and status in ('new', 'open', 'pending', 'on_hold')) as tickets,
        (select count(*)::int from appointments where tenant_id = ${t}::uuid and staff_id = ${uid}::uuid and start_at >= now() and status in ('scheduled', 'confirmed')) as appointments,
        (select count(*)::int from contacts where tenant_id = ${t}::uuid and owner_id = ${uid}::uuid and type = 'lead' and (lead_status is null or lead_status::text not in ('lost', 'converted'))) as leads,
        (select count(*)::int from sales_documents where tenant_id = ${t}::uuid and created_by = ${uid}::uuid and kind = 'invoice' and status not in ('draft', 'cancelled') and issue_date >= current_date - 30) as invoices30,
        (select coalesce(sum(total_paise), 0) from sales_documents where tenant_id = ${t}::uuid and created_by = ${uid}::uuid and kind = 'invoice' and status not in ('draft', 'cancelled') and issue_date >= current_date - 30) as invoiced30_paise`,
    did: Prisma.sql`select id, at, action, entity, entity_id, after from audit_log where tenant_id = ${t}::uuid and actor_id = ${uid}::uuid order by at desc limit 40`,
  });
  // Sign-ins and devices are the person's account data, read outside the business's row security
  const [signIns, devices] = await withPlatform(() => Promise.all([
    db().signInEvent.findMany({ where: { userId: uid, OR: [{ tenantId: t }, { tenantId: null }] }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, outcome: true, method: true, ip: true, userAgent: true, createdAt: true } }),
    db().userSession.findMany({ where: { userId: uid, tenantId: t, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true } }),
  ]));
  const ent = await getEntitlements(t);
  const scopeOf = new Map(d.perms.map((p) => [p.permissionKey as string, p.scope as string]));
  const access = MODULES.filter((mod) => (ent.modules[mod.key]?.status ?? 'inactive') !== 'inactive').map((mod) => ({
    key: mod.key, name: mod.name, status: ent.modules[mod.key]?.status,
    resources: (PERMISSION_CATALOG[mod.key] ?? []).map((r) => ({ label: r.label, actions: r.actions.filter((a) => scopeOf.has(`${mod.key}.${r.resource}.${a}`)).map((a) => ({ action: a, scope: scopeOf.get(`${mod.key}.${r.resource}.${a}`) })) })).filter((r) => r.actions.length),
  })).filter((mod) => mod.resources.length);
  const tenantAccess = (PERMISSION_CATALOG.tenant ?? []).map((r) => ({ label: r.label, actions: r.actions.filter((a) => scopeOf.has(`tenant.${r.resource}.${a}`)).map((a) => ({ action: a, scope: scopeOf.get(`tenant.${r.resource}.${a}`) })) })).filter((r) => r.actions.length);
  const c = d.counts[0] ?? {};
  const branchIds = (m.branchIds ?? []) as string[];
  return {
    id: m.id as string, userId: uid, status: m.status as string, version: m.version as number, name: m.name as string, email: m.email as string | null, mobile: m.mobile as string | null,
    lastLoginAt: m.lastLoginAt as Date | null, mfaEnabled: !!m.mfaEnabled, joinedAt: (m.joinedAt ?? m.createdAt) as Date, deactivatedAt: m.deactivatedAt as Date | null, createdAt: m.createdAt as Date,
    you: uid === ctx.userId, owner: m.roleKey === 'owner',
    role: { id: m.roleId as string, key: m.roleKey as string, name: m.roleName as string, description: m.roleDescription as string | null, custom: !m.isPredefined, permissions: d.perms.length },
    allBranches: !branchIds.length, branches: d.branches.filter((x) => branchIds.includes(x.id as string)).map((x) => ({ id: x.id as string, name: x.name as string })), branchOptions: d.branches,
    employee: d.employee[0] ?? null,
    access: { modules: access, tenant: tenantAccess, scopes: [...new Set(scopeOf.values())] },
    work: { tasks: d.tasks, tickets: d.tickets, appointments: d.appts, counts: { tasks: n(c.tasks), tasksDone30: n(c.tasksDone30), tickets: n(c.tickets), appointments: n(c.appointments), leads: n(c.leads), invoices30: n(c.invoices30), invoiced30Paise: n(c.invoiced30Paise) } },
    signIns, devices, did: d.did,
  };
}

/** A new link for an invitation, good for another 7 days, sent again */
export async function resendInvitation(ctx: TenantCtx, id: string) {
  const inv = await db().invitation.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!inv || inv.acceptedAt || inv.revokedAt) throw notFound('Invitation');
  const token = randomToken();
  await db().invitation.update({ where: { id }, data: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
  const [tenant, role] = await Promise.all([db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true } }), db().role.findUniqueOrThrow({ where: { id: inv.roleId }, select: { name: true } })]);
  const link = `${env.APP_URL}/invite/${token}`;
  const text = `Reminder: you have been invited to join ${tenant.name} on AHEAD as ${role.name}. Accept within 7 days: ${link}`;
  if (inv.email) await sendMessage({ channel: 'email', to: inv.email, template: 'member.invite', subject: `Join ${tenant.name} on AHEAD`, text });
  if (inv.mobile) await sendMessage({ channel: 'sms', to: inv.mobile, template: 'member.invite', text });
  await audit({ action: 'member.invite_resend', entity: 'invitation', entityId: id });
  return { id, inviteLink: env.NODE_ENV === 'production' ? undefined : link };
}

/** Sign a person out of this business on every device (their own account stays as it is) */
export async function signOutEverywhere(ctx: TenantCtx, memberId: string) {
  const m = await db().tenantMember.findFirst({ where: { id: memberId, tenantId: ctx.tenantId }, include: { role: { select: { key: true } } } });
  if (!m) throw notFound('User');
  if (m.userId === ctx.userId) throw new AppError('PERMISSION_DENIED', 'Sign yourself out from My account instead.');
  if (m.role.key === 'owner') throw new AppError('PERMISSION_DENIED', 'The Owner can only be signed out from their own account.');
  const r = await withPlatform(() => db().userSession.updateMany({ where: { userId: m.userId, tenantId: ctx.tenantId, revokedAt: null }, data: { revokedAt: new Date() } }));
  await audit({ action: 'member.sign_out_all', entity: 'tenant_member', entityId: memberId, after: { sessions: r.count } });
  return { signedOut: r.count };
}
