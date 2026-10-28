import type { Prisma, TenantSource, TenantStatus } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { audit } from '../audit/service';
import { cache } from '../../kernel/cache';
import { scopedTenantFilter } from './service';
import { clientOrders } from '../platformBilling/orders';
import { healthFor } from './insights';

// Console → Clients (design v2 §3). Only account metadata: plan, status, usage counts and who
// brought the client in. Business records (customers, invoices, salaries) are never read here.
// All functions run inside consoleTx (platform transaction).

const DAY = 86_400_000;

/** A client outside the Console user's scope behaves like one that does not exist. */
async function scopedTenant(ctx: ConsoleCtx, id: string) {
  const tenant = await db().tenant.findFirst({ where: { id, ...(await scopedTenantFilter(ctx)) } });
  if (!tenant) throw notFound('Client');
  return tenant;
}

export async function listClients(ctx: ConsoleCtx, q: { search?: string; status?: TenantStatus; source?: TenantSource; ownerId?: string; limit: number; cursor?: string }) {
  const where: Prisma.TenantWhereInput = {
    ...(await scopedTenantFilter(ctx)),
    ...(q.status ? { status: q.status } : {}),
    ...(q.source ? { source: q.source } : {}),
    // Owner (sales) = the Console user who brought the client in; ANDed so it never widens the scope
    ...(q.ownerId ? { AND: [{ acquisition: { acquiredByUserId: q.ownerId } }] } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { gstin: { contains: q.search.toUpperCase() } }] } : {}),
  };
  const rows = await db().tenant.findMany({
    where,
    orderBy: { id: 'desc' }, // UUID v7: newest first
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    include: {
      subscription: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true, cycle: true, planId: true } },
      acquisition: { select: { acquiredByType: true, acquiredByUserId: true, method: true } },
      partner: { select: { name: true } },
      _count: { select: { members: { where: { status: 'active' } } } },
    },
  });
  const pageRows = rows.slice(0, q.limit);
  const ids = pageRows.map((t) => t.id);
  const [plans, people, health, lastPaid, nextSteps] = await Promise.all([
    db().plan.findMany({ select: { id: true, key: true, name: true } }),
    db().user.findMany({
      where: { id: { in: [...new Set(pageRows.flatMap((t) => [t.ownerUserId, t.acquisition?.acquiredByUserId].filter(Boolean) as string[]))] } },
      select: { id: true, name: true, email: true },
    }),
    healthFor(ids),
    db().platformOrder.findMany({ where: { tenantId: { in: ids }, status: 'paid' }, orderBy: { paidAt: 'desc' }, distinct: ['tenantId'], select: { tenantId: true, taxablePaise: true, cycle: true } }),
    db().consoleFollowup.findMany({ where: { tenantId: { in: ids }, doneAt: null }, orderBy: { dueAt: 'asc' }, distinct: ['tenantId'], select: { tenantId: true, title: true, dueAt: true } }),
  ]);
  const plan = new Map(plans.map((p) => [p.id, p]));
  const mrr = new Map(lastPaid.map((o) => [o.tenantId, Math.round(Number(o.taxablePaise) / (o.cycle === 'yearly' ? 12 : 1))]));
  const next = new Map(nextSteps.map((f) => [f.tenantId, { title: f.title, dueAt: f.dueAt }]));
  const person = new Map(people.map((u) => [u.id, u]));
  return {
    data: pageRows.map((t) => ({
      id: t.id,
      name: t.name,
      industryKey: t.industryKey,
      status: t.status,
      source: t.source,
      isInternal: t.isInternal,
      createdAt: t.createdAt,
      plan: t.subscription ? plan.get(t.subscription.planId)?.name ?? null : null,
      trialEndsAt: t.subscription?.trialEndsAt ?? null,
      renewsAt: t.subscription?.currentPeriodEnd ?? null,
      owner: person.get(t.ownerUserId) ?? null,
      acquiredBy: t.acquisition?.acquiredByUserId ? person.get(t.acquisition.acquiredByUserId)?.name ?? null : null,
      activeUsers: t._count.members,
      partner: t.partner?.name ?? null,
      mrrPaise: mrr.get(t.id) ?? null,
      health: health.get(t.id) ?? null,
      next: next.get(t.id) ?? null,
    })),
    nextCursor: rows.length > q.limit ? pageRows[pageRows.length - 1].id : null,
  };
}

export async function clientDetail(ctx: ConsoleCtx, id: string) {
  const tenant = await scopedTenant(ctx, id);
  const tx = db();
  const period = new Date().toISOString().slice(0, 7);
  const [owner, subscription, entitlements, activeUsers, branches, usage, acquisition, extensions, history] = await Promise.all([
    tx.user.findUnique({ where: { id: tenant.ownerUserId }, select: { name: true, email: true, mobile: true, emailVerifiedAt: true, lastLoginAt: true } }),
    tx.subscription.findUnique({ where: { tenantId: id } }),
    tx.tenantEntitlement.findMany({ where: { tenantId: id }, orderBy: { moduleKey: 'asc' } }),
    tx.tenantMember.count({ where: { tenantId: id, status: 'active' } }),
    tx.branch.count({ where: { tenantId: id } }),
    tx.usageCounter.findMany({ where: { tenantId: id, period } }),
    tx.tenantAcquisition.findUnique({ where: { tenantId: id } }),
    tx.gracePeriod.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    tx.auditLog.findMany({
      where: { OR: [{ tenantId: id, action: { in: ['tenant.created', 'subscription.changed'] } }, { tenantId: null, entityId: id }] },
      orderBy: { id: 'desc' },
      take: 20,
    }),
  ]);
  const [orders, partner] = await Promise.all([
    clientOrders(id),
    tenant.partnerId ? tx.partner.findUnique({ where: { id: tenant.partnerId }, select: { id: true, name: true } }) : null,
  ]);
  const plan = subscription ? await tx.plan.findUnique({ where: { id: subscription.planId }, select: { key: true, name: true, limits: true } }) : null;
  const peopleIds = [acquisition?.acquiredByUserId, acquisition?.changedBy, ...extensions.map((e) => e.grantedBy), ...history.map((h) => h.actorId)].filter(Boolean) as string[];
  const people = new Map((await tx.user.findMany({ where: { id: { in: [...new Set(peopleIds)] } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u]));

  return {
    id: tenant.id,
    name: tenant.name,
    legalName: tenant.legalName,
    industryKey: tenant.industryKey,
    gstin: tenant.gstin,
    billingStateCode: tenant.billingStateCode,
    status: tenant.status,
    source: tenant.source,
    onboardingType: tenant.onboardingType,
    isInternal: tenant.isInternal,
    createdAt: tenant.createdAt,
    // Partner clients are billed to the partner, never through AHEAD orders
    partner,
    billedBy: tenant.billingOwner,
    owner: owner && { name: owner.name, email: owner.email, mobile: owner.mobile, emailVerified: !!owner.emailVerifiedAt, lastLoginAt: owner.lastLoginAt },
    subscription: subscription && {
      status: subscription.status, cycle: subscription.cycle, plan,
      trialEndsAt: subscription.trialEndsAt, currentPeriodEnd: subscription.currentPeriodEnd, graceEndsAt: subscription.graceEndsAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    },
    modules: entitlements.map((e) => ({ key: e.moduleKey, status: e.status, tier: (e.limits as { tier?: string }).tier ?? 'basic' })),
    usage: { activeUsers, branches, thisMonth: Object.fromEntries(usage.map((u) => [u.metric, Number(u.used)])) },
    acquisition: acquisition && {
      byType: acquisition.acquiredByType,
      by: acquisition.acquiredByUserId ? people.get(acquisition.acquiredByUserId) ?? { id: acquisition.acquiredByUserId, name: 'Unknown user', email: '' } : null,
      method: acquisition.method, referralCode: acquisition.referralCode, couponCode: acquisition.couponCode, lockedAt: acquisition.lockedAt,
      changeReason: acquisition.changeReason, changedBy: acquisition.changedBy ? people.get(acquisition.changedBy)?.name ?? null : null,
    },
    extensions: extensions.map((e) => ({ ...e, grantedBy: people.get(e.grantedBy)?.name ?? null })),
    orders,
    history: history.map((h) => ({ id: h.id, action: h.action, at: h.at, actor: h.actorId ? people.get(h.actorId)?.name ?? null : null, after: h.after })),
  };
}

/**
 * Extra days from the Console: extends the trial (trialing) or the payment grace (past_due).
 * Paid and Free clients have nothing to extend.
 */
export async function extendClient(ctx: ConsoleCtx, id: string, input: { days: number; reason: string }) {
  await scopedTenant(ctx, id);
  const tx = db();
  const sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId: id } });
  const kind = sub.status === 'trialing' ? 'trial' : sub.status === 'past_due' ? 'grace' : null;
  if (!kind) throw new AppError('INVALID_TRANSITION', 'Only a client on trial or with a failed payment can be given extra days.');

  const previous = kind === 'trial' ? sub.trialEndsAt : sub.graceEndsAt;
  const base = previous && previous > new Date() ? previous : new Date();
  const newEndAt = new Date(base.getTime() + input.days * DAY);
  await tx.subscription.update({
    where: { id: sub.id },
    data: { ...(kind === 'trial' ? { trialEndsAt: newEndAt } : { graceEndsAt: newEndAt }), version: { increment: 1 } },
  });
  const row = await tx.gracePeriod.create({
    data: { tenantId: id, kind, days: input.days, reason: input.reason.trim(), previousEndAt: previous, newEndAt, grantedBy: ctx.userId },
  });
  await audit({ tenantId: null, action: `console.${kind}_extended`, entity: 'tenant', entityId: id, before: { endAt: previous }, after: { endAt: newEndAt, days: input.days, reason: input.reason.trim() } });
  cache.del(`ent:tenant:${id}`);
  return row;
}

/** Vendors see a client's name, plan, status and payments — not usage, modules or contact details (platform design §1). */
export function vendorView(c: Awaited<ReturnType<typeof clientDetail>>) {
  const { usage: _u, modules: _m, history: _h, extensions: _e, owner, ...rest } = c;
  return { ...rest, owner: owner && { name: owner.name, email: '', mobile: '', emailVerified: owner.emailVerified, lastLoginAt: owner.lastLoginAt }, usage: null, modules: [], history: [], extensions: [] };
}

/** Scope check for actions that call other services with a tenant id (e.g. changeAcquisition). */
export const assertClientInScope = scopedTenant;
