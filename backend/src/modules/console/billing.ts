import { db } from '../../kernel/db';
import type { ConsoleCtx } from '../../kernel/context';
import { scopedTenantFilter } from './service';

// Console Billing (blueprint Phase D): the numbers on top, money received, AHEAD invoices and
// renewals coming up, all inside the person's scope. Orders keep their own list (orders.ts).
// Runs inside consoleTx.

const DAY = 86_400_000;
const n = (v: bigint | null | undefined) => Number(v ?? 0);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

async function idsInScope(ctx: ConsoleCtx): Promise<string[] | null> {
  const filter = await scopedTenantFilter(ctx);
  if (!Object.keys(filter).length) return null;
  return (await db().tenant.findMany({ where: filter, select: { id: true } })).map((t) => t.id);
}
const inScope = (ids: string[] | null) => (ids ? { tenantId: { in: ids } } : {});

async function names(ids: string[]) {
  return new Map((await db().tenant.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
}

export async function billingSummary(ctx: ConsoleCtx, now = new Date()) {
  const ids = await idsInScope(ctx);
  const month = startOfMonth(now);
  const lastMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1);
  const [received, receivedLast, waiting, approvals, overdue, renewals] = await Promise.all([
    db().platformPayment.aggregate({ where: { ...inScope(ids), receivedAt: { gte: month } }, _sum: { amountPaise: true }, _count: true }),
    db().platformPayment.aggregate({ where: { ...inScope(ids), receivedAt: { gte: lastMonth, lt: month } }, _sum: { amountPaise: true } }),
    db().platformOrder.aggregate({ where: { ...inScope(ids), status: 'awaiting_payment' }, _sum: { totalPaise: true }, _count: true }),
    db().platformOrder.count({ where: { ...inScope(ids), status: 'pending_approval' } }),
    db().subscription.count({ where: { ...(ids ? { tenantId: { in: ids } } : {}), status: 'past_due' } }),
    db().subscription.count({ where: { ...(ids ? { tenantId: { in: ids } } : {}), status: 'active', currentPeriodEnd: { gte: now, lte: new Date(now.getTime() + 30 * DAY) }, tenant: { billingOwner: 'self' } } }),
  ]);
  return {
    receivedPaise: n(received._sum.amountPaise),
    receivedCount: received._count,
    receivedLastMonthPaise: n(receivedLast._sum.amountPaise),
    waitingPaise: n(waiting._sum.totalPaise),
    waitingCount: waiting._count,
    approvals,
    overdue,
    renewals30d: renewals,
  };
}

export async function listPayments(ctx: ConsoleCtx, q: { limit: number; cursor?: string }) {
  const ids = await idsInScope(ctx);
  const rows = await db().platformPayment.findMany({
    where: inScope(ids),
    orderBy: { id: 'desc' },
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    include: { order: { select: { kind: true, invoice: { select: { id: true, number: true } } } } },
  });
  const page = rows.slice(0, q.limit);
  const tenant = await names(page.map((r) => r.tenantId));
  const people = new Map((await db().user.findMany({ where: { id: { in: page.map((r) => r.recordedBy).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return {
    data: page.map((p) => ({
      id: p.id, orderId: p.orderId, tenantId: p.tenantId, business: tenant.get(p.tenantId) ?? '—', method: p.method, amountPaise: n(p.amountPaise),
      reference: p.reference, receivedAt: p.receivedAt, recordedBy: p.recordedBy ? people.get(p.recordedBy) ?? null : 'Online payment', kind: p.order.kind, invoice: p.order.invoice,
    })),
    nextCursor: rows.length > q.limit ? page[page.length - 1].id : null,
  };
}

export async function listInvoices(ctx: ConsoleCtx, q: { limit: number; cursor?: string }) {
  const ids = await idsInScope(ctx);
  const rows = await db().platformInvoice.findMany({ where: inScope(ids), orderBy: { id: 'desc' }, take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) });
  const page = rows.slice(0, q.limit);
  const tenant = await names(page.map((r) => r.tenantId));
  return {
    data: page.map((i) => ({ id: i.id, number: i.number, tenantId: i.tenantId, business: tenant.get(i.tenantId) ?? '—', issuedAt: i.issuedAt, taxablePaise: n(i.taxablePaise), gstPaise: n(i.cgstPaise) + n(i.sgstPaise) + n(i.igstPaise), totalPaise: n(i.totalPaise) })),
    nextCursor: rows.length > q.limit ? page[page.length - 1].id : null,
  };
}

/** Renewals in the next 30 days, and businesses past their renewal date (grace). */
export async function listRenewals(ctx: ConsoleCtx, now = new Date()) {
  const ids = await idsInScope(ctx);
  const subs = await db().subscription.findMany({
    where: {
      ...(ids ? { tenantId: { in: ids } } : {}),
      tenant: { billingOwner: 'self', isInternal: false },
      OR: [{ status: 'active', currentPeriodEnd: { gte: now, lte: new Date(now.getTime() + 30 * DAY) } }, { status: 'past_due' }],
    },
    orderBy: { currentPeriodEnd: 'asc' },
    take: 200,
    include: { scheduledChanges: { where: { appliedAt: null }, take: 1 } },
  });
  const [tenant, plans, orders] = await Promise.all([
    names(subs.map((s) => s.tenantId)),
    db().plan.findMany({ select: { id: true, key: true, name: true } }),
    db().platformOrder.findMany({ where: { tenantId: { in: subs.map((s) => s.tenantId) }, kind: 'renewal', status: { in: ['awaiting_payment', 'paid'] }, createdAt: { gte: new Date(now.getTime() - 40 * DAY) } }, orderBy: { createdAt: 'desc' }, select: { id: true, tenantId: true, status: true, totalPaise: true, paymentLinkUrl: true } }),
  ]);
  const plan = new Map(plans.map((p) => [p.id, p]));
  const planByKey = new Map(plans.map((p) => [p.key, p.name]));
  return subs.map((s) => {
    const o = orders.find((x) => x.tenantId === s.tenantId);
    const change = s.scheduledChanges[0]?.change as { planKey: string; cycle: string } | undefined;
    return {
      tenantId: s.tenantId, business: tenant.get(s.tenantId) ?? '—', status: s.status, plan: plan.get(s.planId)?.name ?? '—', cycle: s.cycle,
      renewsAt: s.currentPeriodEnd, graceEndsAt: s.graceEndsAt,
      order: o ? { id: o.id, status: o.status, totalPaise: n(o.totalPaise), hasLink: !!o.paymentLinkUrl } : null,
      changeTo: change ? `${planByKey.get(change.planKey) ?? change.planKey} · ${change.cycle}` : null,
    };
  });
}
