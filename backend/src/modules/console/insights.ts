import { prisma } from '../../kernel/db';
import type { ConsoleCtx } from '../../kernel/context';
import { SETUP_STEPS, type SetupState } from '../../contracts/workspace';
import { getEntitlements } from '../subscription/entitlements';
import { scopedTenantFilter } from './service';
import { partnerBill } from './partners';
import { myReferral } from './referral';

// The Console Home and each client's account health. Only AHEAD's own data and counts —
// never a client's business records. Reads use the owner client with the Console scope applied
// explicitly. Three audiences: the AHEAD team, a vendor (own clients) and a partner (its clients).

const DAY = 86_400_000;
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const monthKey = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 7);

/** Tenant ids in the person's scope, or null for "all clients". */
export async function scopedTenantIds(ctx: ConsoleCtx): Promise<string[] | null> {
  return (await scopeOf(ctx)).ids;
}

/** The scope filter and, unless it is "all", the tenant ids it covers. */
async function scopeOf(ctx: ConsoleCtx) {
  const where = await scopedTenantFilter(ctx);
  const ids = Object.keys(where).length ? (await prisma.tenant.findMany({ where, select: { id: true } })).map((t) => t.id) : null;
  return { where, ids };
}
const inScope = (ids: string[] | null) => (ids ? { tenantId: { in: ids } } : {});

// ── Account health (counts and status only) ──

export type HealthFlag = 'good' | 'no_invoice' | 'limit' | 'errors' | 'quiet';

export async function healthFor(tenantIds: string[]) {
  if (!tenantIds.length) return new Map<string, { flag: HealthFlag; label: string }>();
  const now = Date.now();
  const period = new Date(now + 330 * 60_000).toISOString().slice(0, 7);
  const [tenants, invoices, usage, lastSeen, failures] = await Promise.all([
    prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, status: true, createdAt: true } }),
    prisma.salesDocument.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, kind: 'invoice', number: { not: null } }, _count: true }),
    prisma.usageCounter.findMany({ where: { tenantId: { in: tenantIds }, period } }),
    // Sessions, not sign-in events: a refresh counts as use, and a sign-in may be logged before a business is picked
    prisma.userSession.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _max: { createdAt: true } }),
    prisma.outboxEvent.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, lastError: { not: null }, occurredAt: { gte: new Date(now - 7 * DAY) } }, _count: true }),
  ]);
  const inv = new Map(invoices.map((x) => [x.tenantId, x._count]));
  const seen = new Map(lastSeen.map((x) => [x.tenantId, x._max.createdAt]));
  const fail = new Map(failures.map((x) => [x.tenantId, x._count]));
  const needLimits = tenants.filter((t) => usage.some((u) => u.tenantId === t.id));
  const ents = new Map(await Promise.all(needLimits.map(async (t) => [t.id, await getEntitlements(t.id)] as const)));
  const out = new Map<string, { flag: HealthFlag; label: string }>();
  for (const t of tenants) {
    const used = usage.filter((u) => u.tenantId === t.id);
    let flag: HealthFlag = 'good';
    let label = 'Good';
    const errors = fail.get(t.id) ?? 0;
    const last = seen.get(t.id);
    if (errors) {
      flag = 'errors';
      label = `${errors} failed job${errors === 1 ? '' : 's'}`;
    } else if (t.status === 'trialing' && !inv.get(t.id) && now - t.createdAt.getTime() > 3 * DAY) {
      flag = 'no_invoice';
      label = 'No invoice yet';
    } else if (['active', 'past_due'].includes(t.status) && now - t.createdAt.getTime() > 14 * DAY && (!last || now - last.getTime() > 14 * DAY)) {
      flag = 'quiet';
      label = 'No sign-in for 14 days';
    } else if (used.length) {
      const ent = ents.get(t.id)!;
      const lim = ent.limits as unknown as Record<string, number | null>;
      const metricLimit: Record<string, string> = { invoices: 'invoicesPerMonth' };
      for (const u of used) {
        const max = lim[metricLimit[u.metric] ?? u.metric];
        if (max && Number(u.used) / max >= 0.9) {
          flag = 'limit';
          label = `${u.metric === 'invoices' ? 'Invoices' : u.metric} at ${Math.round((Number(u.used) / max) * 100)}% of limit`;
        }
      }
    }
    out.set(t.id, { flag, label });
  }
  return out;
}

/** Client 360 › Account health: setup, counts, limits, modules, sign-ins, two-step, errors. */
export async function accountHealth(tenantId: string) {
  const now = Date.now();
  const period = new Date(now + 330 * 60_000).toISOString().slice(0, 7);
  const [tenant, counts, usage, ent, members, lastSign, failures, imports] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { onboarding: true, createdAt: true } }),
    Promise.all([
      prisma.contact.count({ where: { tenantId, isSample: false } }),
      prisma.salesDocument.count({ where: { tenantId, kind: 'invoice', number: { not: null } } }),
      prisma.appointment.count({ where: { tenantId } }),
      prisma.item.count({ where: { tenantId } }),
      prisma.salesDocument.count({ where: { tenantId, kind: 'quotation' } }),
      prisma.expense.count({ where: { tenantId } }),
    ]),
    prisma.usageCounter.findMany({ where: { tenantId, period } }),
    getEntitlements(tenantId),
    prisma.tenantMember.findMany({ where: { tenantId, status: 'active' }, select: { role: { select: { key: true } }, user: { select: { mfaEnabled: true, lastLoginAt: true } } } }),
    prisma.userSession.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.outboxEvent.count({ where: { tenantId, lastError: { not: null }, occurredAt: { gte: new Date(now - 7 * DAY) } } }),
    prisma.auditLog.findMany({ where: { tenantId, action: { in: ['crm.contact.import', 'catalog.item.import'] }, at: { gte: new Date(now - 7 * DAY) } }, select: { after: true } }),
  ]);
  const setup = ((tenant.onboarding ?? {}) as { setup?: SetupState }).setup;
  const admins = members.filter((m) => ['owner', 'admin'].includes(m.role.key));
  const badRows = imports.reduce((t, a) => t + Number(((a.after ?? {}) as { errors?: number }).errors ?? 0), 0);
  const lim = ent.limits as unknown as Record<string, number | null>;
  return {
    setup: SETUP_STEPS.map((s) => ({ key: s.key, label: s.label, state: setup?.steps?.[s.key] ?? null })),
    setupCompleted: !!setup?.completedAt,
    records: { customers: counts[0], invoices: counts[1], appointments: counts[2], items: counts[3], quotations: counts[4], expenses: counts[5] },
    limits: {
      users: { used: members.length, max: lim.users },
      invoicesThisMonth: { used: Number(usage.find((u) => u.metric === 'invoices')?.used ?? 0), max: lim.invoicesPerMonth },
      contacts: { used: counts[0], max: lim.contacts },
      items: { used: counts[3], max: lim.items },
    },
    modules: Object.entries(ent.modules).map(([key, m]) => ({ key, status: m.status, tier: m.tier })),
    lastSignIn: lastSign?.createdAt ?? null,
    twoStep: { admins: admins.length, adminsOn: admins.filter((a) => a.user.mfaEnabled).length },
    errors: { failedJobs: failures, importBadRows: badRows },
  };
}

// ── Console home ──

export type Audience = 'team' | 'vendor' | 'partner';
export interface HomeCan { discount: boolean; income: boolean; payments: boolean; leads: boolean }

interface Todo { kind: 'discount' | 'unpaid' | 'trial' | 'followup' | 'setup' | 'signin'; title: string; detail: string; href: string; action: string }
interface Stat { key: string; label: string; value: number; money?: boolean; hint?: string; href?: string }

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const daysAgo = (d: Date, now: Date) => Math.max(0, Math.round((now.getTime() - d.getTime()) / DAY));
const rupees = (paise: bigint | number) => `₹${(n(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/** One page that answers "what needs doing" — the same shape for all three audiences. */
export async function consoleHome(ctx: ConsoleCtx, audience: Audience, can: HomeCan) {
  const now = new Date();
  const { where: scope, ids } = await scopeOf(ctx);
  const live = { ...scope, isInternal: false };
  const soon = new Date(now.getTime() + 3 * DAY);
  const week = new Date(now.getTime() + 7 * DAY);

  const [byStatus, recent, trialsSoon, trialsWeek, unpaid, discounts, followups, stuck, incomeRows, paidThisMonth] = await Promise.all([
    prisma.tenant.groupBy({ by: ['status'], where: live, _count: true }),
    prisma.tenant.findMany({ where: live, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, name: true, status: true, industryKey: true, createdAt: true, ownerUserId: true } }),
    prisma.tenant.findMany({ where: { ...live, status: 'trialing', subscription: { trialEndsAt: { gte: now, lte: soon } } }, take: 5, select: { id: true, name: true, subscription: { select: { trialEndsAt: true } } } }),
    prisma.tenant.count({ where: { ...live, status: 'trialing', subscription: { trialEndsAt: { gte: now, lte: week } } } }),
    can.payments ? prisma.platformOrder.findMany({ where: { status: 'awaiting_payment', ...inScope(ids) }, orderBy: { createdAt: 'asc' }, select: { id: true, tenantId: true, totalPaise: true, createdAt: true } }) : [],
    can.discount ? prisma.platformOrder.findMany({ where: { status: 'pending_approval', ...inScope(ids) }, orderBy: { createdAt: 'asc' }, take: 5, select: { id: true, tenantId: true, discountBp: true, createdBy: true } }) : [],
    can.leads ? prisma.consoleFollowup.findMany({ where: { ownerUserId: ctx.userId, doneAt: null, dueAt: { lt: new Date(now.getTime() + DAY) } }, orderBy: { dueAt: 'asc' }, take: 5, include: { prospect: { select: { businessName: true } } } }) : [],
    audience === 'team' ? prisma.tenant.findMany({ where: { ...live, status: 'trialing', createdAt: { lt: new Date(now.getTime() - 3 * DAY) } }, select: { id: true, name: true, createdAt: true }, take: 40 }) : [],
    can.income ? prisma.platformInvoice.findMany({ where: { issuedAt: { gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) }, ...inScope(ids) }, select: { issuedAt: true, taxablePaise: true } }) : [],
    audience === 'vendor' ? prisma.platformPayment.aggregate({ where: { receivedAt: { gte: startOfMonth(now) }, ...inScope(ids) }, _sum: { amountPaise: true } }) : null,
  ]);

  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count])) as Record<string, number>;
  const total = byStatus.reduce((t, r) => t + r._count, 0);
  const paying = counts.active ?? 0;
  const trials = counts.trialing ?? 0;

  // Names for the to-do lines, and the first invoice check for trials stuck in setup
  const nameIds = [...new Set([...unpaid.map((o) => o.tenantId), ...discounts.map((d) => d.tenantId), ...followups.map((f) => f.tenantId).filter((x): x is string => !!x)])];
  const [names, sellers, invoiced, owners] = await Promise.all([
    prisma.tenant.findMany({ where: { id: { in: nameIds } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: discounts.map((d) => d.createdBy) } }, select: { id: true, name: true } }),
    stuck.length ? prisma.salesDocument.groupBy({ by: ['tenantId'], where: { tenantId: { in: stuck.map((t) => t.id) }, kind: 'invoice', number: { not: null } } }) : [],
    audience === 'partner' ? prisma.user.findMany({ where: { id: { in: recent.map((t) => t.ownerUserId) } }, select: { id: true, lastLoginAt: true } }) : [],
  ]);
  const tn = new Map(names.map((t) => [t.id, t.name]));
  const sn = new Map(sellers.map((u) => [u.id, u.name]));
  const withInvoice = new Set(invoiced.map((x) => x.tenantId));

  const todo: Todo[] = [
    ...discounts.map((d) => ({ kind: 'discount' as const, title: tn.get(d.tenantId) ?? 'Client', detail: `${d.discountBp / 100}% discount by ${sn.get(d.createdBy) ?? 'a seller'} needs your OK`, href: `/console/payments/${d.id}`, action: 'Review' })),
    ...followups.map((f) => ({ kind: 'followup' as const, title: f.prospect?.businessName ?? (f.tenantId ? tn.get(f.tenantId) ?? 'Client' : 'Follow-up'), detail: `${f.title}${f.dueAt < now ? ' · overdue' : ' · today'}`, href: f.tenantId ? `/console/clients/${f.tenantId}` : '/console/leads', action: 'Open' })),
    ...unpaid.filter((o) => now.getTime() - o.createdAt.getTime() > 3 * DAY).slice(0, 5).map((o) => ({ kind: 'unpaid' as const, title: tn.get(o.tenantId) ?? 'Client', detail: `${rupees(o.totalPaise)} not paid for ${daysAgo(o.createdAt, now)} days`, href: `/console/payments/${o.id}`, action: 'Send link' })),
    ...trialsSoon.map((t) => {
      const left = Math.max(0, Math.ceil(((t.subscription?.trialEndsAt?.getTime() ?? now.getTime()) - now.getTime()) / DAY));
      return { kind: 'trial' as const, title: t.name, detail: left === 0 ? 'Free trial ends today' : `Free trial ends in ${left} day${left === 1 ? '' : 's'}`, href: `/console/clients/${t.id}`, action: 'Open' };
    }),
    ...stuck.filter((t) => !withInvoice.has(t.id)).slice(0, 3).map((t) => ({ kind: 'setup' as const, title: t.name, detail: `No invoice yet, ${daysAgo(t.createdAt, now)} days after signing up`, href: `/console/clients/${t.id}`, action: 'Open' })),
    ...(audience === 'partner'
      ? recent.filter((t) => !owners.find((o) => o.id === t.ownerUserId)?.lastLoginAt && daysAgo(t.createdAt, now) >= 2).map((t) => ({ kind: 'signin' as const, title: t.name, detail: 'The owner has not signed in yet', href: `/console/clients/${t.id}`, action: 'Open' }))
      : []),
  ].slice(0, 8);

  const waitingPaise = unpaid.reduce((t, o) => t + n(o.totalPaise), 0);
  const stats: Stat[] = [];
  if (audience === 'partner') {
    const bill = await partnerBill(ctx.partnerId!);
    stats.push(
      { key: 'clients', label: 'Clients', value: total, href: '/console/clients' },
      { key: 'live', label: 'Live now', value: paying + trials + (counts.past_due ?? 0), href: '/console/clients' },
      { key: 'bill', label: "This month's bill", value: bill.totalPaise, money: true, hint: `${bill.lines.length} client${bill.lines.length === 1 ? '' : 's'} · with GST`, href: '/console/billing' },
    );
  } else {
    if (can.income) {
      const thisMonth = incomeRows.filter((r) => monthKey(r.issuedAt) === monthKey(now)).reduce((t, r) => t + n(r.taxablePaise), 0);
      stats.push({ key: 'income', label: 'Income this month', value: thisMonth, money: true, hint: 'Paid invoices, before GST' });
    }
    if (audience === 'vendor') stats.push({ key: 'clients', label: 'My clients', value: total, href: '/console/clients' });
    stats.push(
      { key: 'paying', label: audience === 'vendor' ? 'Paying' : 'Paying clients', value: paying, href: '/console/clients?status=active' },
      { key: 'trial', label: 'On free trial', value: trials, hint: trialsWeek ? `${trialsWeek} end this week` : undefined, href: '/console/clients?status=trialing' },
    );
    if (audience === 'vendor' && paidThisMonth) stats.push({ key: 'paid', label: 'Paid this month', value: n(paidThisMonth._sum.amountPaise), money: true, hint: 'By your clients, with GST' });
    else if (can.payments) stats.push({ key: 'waiting', label: 'Waiting for payment', value: unpaid.length, hint: unpaid.length ? `${rupees(waitingPaise)} in total` : undefined, href: '/console/payments' });
  }

  // Last six months of income, oldest first (AHEAD team with the income permission only)
  const income = can.income
    ? Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 15);
        const key = monthKey(d);
        return { month: key, label: d.toLocaleString('en-IN', { month: 'short' }), paise: incomeRows.filter((r) => monthKey(r.issuedAt) === key).reduce((t, r) => t + n(r.taxablePaise), 0) };
      })
    : null;

  return {
    audience,
    stats,
    todo,
    income,
    recent: recent.map(({ ownerUserId: _o, ...t }) => t),
    referral: audience === 'vendor' ? await myReferral(ctx) : null,
  };
}
