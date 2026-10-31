import type { Prisma } from '@prisma/client';
import { prisma } from '../../kernel/db';
import type { ConsoleCtx } from '../../kernel/context';
import { MODULES } from '../../contracts/modules';
import { scopedTenantFilter } from './service';
import type { Audience } from './insights';

// Analytics (blueprint Phase F): how AHEAD as a business is doing, per role and always within
// the person's own businesses. Counts and money AHEAD received only, never a business's own
// records. One definition per number, used on every screen:
//   Live      = not closed, not AHEAD's own workspace
//   Paying    = subscription active or payment overdue
//   Converted = made a first payment (a "fresh" order paid)
//   Active    = at least one sign-in to the business that month

const DAY = 86_400_000;
const IST = 330 * 60_000;
const monthOf = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 7);
const LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LIVE = ['trialing', 'active', 'past_due', 'free', 'incomplete'] as const;

/** First instant of the IST month `back` months before this one. */
function monthStart(now: Date, back: number) {
  const ist = new Date(now.getTime() + IST);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - back, 1) - IST);
}

export interface AnalyticsCan { income: boolean }

export async function analytics(ctx: ConsoleCtx, audience: Audience, can: AnalyticsCan, months: number, now = new Date()) {
  const scope = await scopedTenantFilter(ctx);
  const since = monthStart(now, months - 1);
  const tenants = await prisma.tenant.findMany({
    where: { ...scope, isInternal: false, status: { not: 'purged' } } as Prisma.TenantWhereInput,
    select: { id: true, name: true, status: true, source: true, createdAt: true, subscription: { select: { status: true, planId: true, trialEndsAt: true } }, acquisition: { select: { method: true } } },
  });
  const ids = tenants.map((t) => t.id);
  const live = tenants.filter((t) => (LIVE as readonly string[]).includes(t.status));
  const liveIds = live.map((t) => t.id);
  const none = <T>(v: T) => Promise.resolve(v);

  const [firstPaid, payments, active, invoices, modules, plans] = await Promise.all([
    ids.length ? prisma.platformOrder.findMany({ where: { tenantId: { in: ids }, kind: 'fresh', status: 'paid' }, select: { tenantId: true, paidAt: true } }) : none([]),
    can.income && ids.length ? prisma.platformPayment.findMany({ where: { tenantId: { in: ids }, receivedAt: { gte: since } }, select: { amountPaise: true, receivedAt: true, order: { select: { planId: true } } } }) : none([]),
    ids.length
      ? prisma.$queryRaw<{ m: string; n: number }[]>`SELECT to_char(created_at + interval '330 minutes', 'YYYY-MM') AS m, count(DISTINCT tenant_id)::int AS n
          FROM user_sessions WHERE tenant_id = ANY(${ids}::uuid[]) AND created_at >= ${since} GROUP BY 1`
      : none([]),
    ids.length
      ? prisma.$queryRaw<{ m: string; n: number }[]>`SELECT to_char(issue_date, 'YYYY-MM') AS m, count(*)::int AS n
          FROM sales_documents WHERE tenant_id = ANY(${ids}::uuid[]) AND kind = 'invoice' AND number IS NOT NULL AND issue_date >= ${since}::date GROUP BY 1`
      : none([]),
    liveIds.length
      ? prisma.$queryRaw<{ module_key: string; n: number }[]>`SELECT module_key, count(*)::int AS n FROM tenant_entitlements
          WHERE tenant_id = ANY(${liveIds}::uuid[]) AND status = 'active' GROUP BY module_key`
      : none([]),
    prisma.plan.findMany({ select: { id: true, key: true, name: true } }),
  ]);

  // Monthly series
  const series = Array.from({ length: months }, (_, i) => {
    const start = monthStart(now, months - 1 - i);
    const key = monthOf(start);
    return { month: key, label: LABEL[Number(key.slice(5)) - 1], newBusinesses: 0, firstPayments: 0, receivedPaise: can.income ? 0 : null as number | null, activeBusinesses: 0, invoices: 0 };
  });
  const at = new Map(series.map((s) => [s.month, s]));
  for (const t of tenants) if (t.createdAt >= since) at.get(monthOf(t.createdAt))!.newBusinesses++;
  const paidOnce = new Set<string>();
  for (const o of firstPaid) {
    paidOnce.add(o.tenantId);
    if (o.paidAt && o.paidAt >= since) at.get(monthOf(o.paidAt))!.firstPayments++;
  }
  for (const p of payments) {
    const s = at.get(monthOf(p.receivedAt));
    if (s && s.receivedPaise !== null) s.receivedPaise += Number(p.amountPaise);
  }
  for (const r of active) if (at.has(r.m)) at.get(r.m)!.activeBusinesses = r.n;
  for (const r of invoices) if (at.has(r.m)) at.get(r.m)!.invoices = r.n;

  // Period figures
  const started = tenants.filter((t) => t.createdAt >= since);
  const convertedOfStarted = started.filter((t) => paidOnce.has(t.id)).length;
  const paying = live.filter((t) => ['active', 'past_due'].includes(t.subscription?.status ?? '')).length;
  const trials = live.filter((t) => t.subscription?.status === 'trialing').length;
  const lost = tenants.filter((t) => t.status === 'closed' || (t.status === 'free' && paidOnce.has(t.id))).length;

  const sources = (['direct', 'vendor', 'sales', 'partner'] as const).map((s) => ({ key: s, count: started.filter((t) => t.source === s).length }));
  const planName = new Map(plans.map((p) => [p.id, p.name]));
  const byPlan = new Map<string, number>();
  for (const p of payments) {
    const name = planName.get(p.order.planId) ?? 'Other';
    byPlan.set(name, (byPlan.get(name) ?? 0) + Number(p.amountPaise));
  }
  const using = new Map(modules.map((m) => [m.module_key, m.n]));

  const result = {
    months,
    definitions: {
      live: 'Not closed; AHEAD’s own workspace is left out',
      paying: 'Plan active, or a renewal payment overdue',
      conversion: 'Businesses started in the period that have made a first payment',
      active: 'At least one sign-in to the business that month',
      lost: 'Paid at least once, now on Free or closed',
    },
    kpis: {
      live: live.length,
      started: started.length,
      paying,
      trials,
      conversionPercent: started.length ? Math.round((convertedOfStarted / started.length) * 100) : null,
      converted: convertedOfStarted,
      receivedPaise: can.income ? payments.reduce((a, p) => a + Number(p.amountPaise), 0) : null,
      lost,
    },
    series,
    sources,
    revenueByPlan: can.income ? [...byPlan.entries()].map(([name, paise]) => ({ name, paise })).sort((a, b) => b.paise - a.paise) : null,
    modules: MODULES.map((m) => ({ key: m.key, name: m.name, businesses: using.get(m.key) ?? 0, percent: live.length ? Math.round(((using.get(m.key) ?? 0) / live.length) * 100) : 0 }))
      .filter((m) => m.businesses > 0)
      .sort((a, b) => b.businesses - a.businesses),
    mine: null as null | Awaited<ReturnType<typeof myNumbers>>,
    perBusiness: null as null | Awaited<ReturnType<typeof perBusiness>>,
  };

  if (audience === 'vendor' || ctx.scope === 'own') result.mine = await myNumbers(ctx, tenants, since, now);
  if (audience === 'partner') result.perBusiness = await perBusiness(live.map((t) => ({ id: t.id, name: t.name, status: t.status })), now);
  return result;
}

/** Sales and vendors: trials ending soon, link signups and discounts they gave. */
async function myNumbers(ctx: ConsoleCtx, tenants: { id: string; name: string; createdAt: Date; subscription: { status: string; trialEndsAt: Date | null } | null; acquisition: { method: string } | null }[], since: Date, now: Date) {
  const soon = tenants
    .filter((t) => t.subscription?.status === 'trialing' && t.subscription.trialEndsAt && t.subscription.trialEndsAt.getTime() - now.getTime() < 7 * DAY && t.subscription.trialEndsAt > now)
    .map((t) => ({ id: t.id, name: t.name, trialEndsAt: t.subscription!.trialEndsAt! }))
    .sort((a, b) => a.trialEndsAt.getTime() - b.trialEndsAt.getTime());
  const linkSignups = tenants.filter((t) => t.createdAt >= since && ['referral_link', 'referral_code'].includes(t.acquisition?.method ?? '')).length;
  const orders = await prisma.platformOrder.findMany({ where: { createdBy: ctx.userId, createdAt: { gte: since }, discountBp: { gt: 0 } }, select: { discountBp: true, approvedBy: true } });
  return {
    trialsEnding: soon,
    linkSignups,
    discounts: { orders: orders.length, averagePercent: orders.length ? Math.round(orders.reduce((a, o) => a + o.discountBp, 0) / orders.length) / 100 : 0, approved: orders.filter((o) => o.approvedBy).length },
  };
}

/** Partner owners: users and invoices this month for each of their businesses. */
async function perBusiness(live: { id: string; name: string; status: string }[], now: Date) {
  if (!live.length) return [];
  const ids = live.map((t) => t.id);
  const from = monthStart(now, 0);
  const [users, invoices, seen] = await Promise.all([
    prisma.tenantMember.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, status: 'active' }, _count: true }),
    prisma.$queryRaw<{ tenant_id: string; n: number }[]>`SELECT tenant_id, count(*)::int AS n FROM sales_documents
      WHERE tenant_id = ANY(${ids}::uuid[]) AND kind = 'invoice' AND number IS NOT NULL AND issue_date >= ${from}::date GROUP BY 1`,
    prisma.userSession.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _max: { createdAt: true } }),
  ]);
  const u = new Map(users.map((x) => [x.tenantId, x._count]));
  const inv = new Map(invoices.map((x) => [x.tenant_id, x.n]));
  const last = new Map(seen.map((x) => [x.tenantId, x._max.createdAt]));
  return live
    .map((t) => ({ id: t.id, name: t.name, status: t.status, users: u.get(t.id) ?? 0, invoicesThisMonth: inv.get(t.id) ?? 0, lastSignIn: last.get(t.id) ?? null }))
    .sort((a, b) => b.invoicesThisMonth - a.invoicesThisMonth || a.name.localeCompare(b.name));
}
