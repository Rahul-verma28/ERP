import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db, withTenant } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { audit } from '../audit/service';
import { MODULE_KEYS, MODULES } from '../../contracts/modules';
import type { PlanLimits } from '../../contracts/plans';
import { setPrice, updatePlan } from './catalogAdmin';
import { invalidateCatalog } from '../subscription/catalog';
import { persistEntitlements } from '../subscription/entitlements';
import { scopedTenantFilter } from './service';

// Console Product (blueprint Phase D): plans are edited as a draft, the impact is shown (who is
// on the plan, which modules they would gain or lose, what the price does), then an Admin
// publishes. Modules shows which plans include each module and how many businesses use it, and
// lets Admin/Staff switch a module on or off for one business. Platform transaction unless noted.

const LimitsInput = z.object({
  users: z.number().int().min(1).max(10_000),
  branches: z.number().int().min(1).max(1_000),
  contacts: z.number().int().min(1).nullable(),
  items: z.number().int().min(1).nullable(),
  invoicesPerMonth: z.number().int().min(1).nullable(),
  storageMb: z.number().int().min(100).max(10_000_000),
  aiCredits: z.number().int().min(0).max(1_000_000),
});

export const PlanDraftInput = z.object({
  name: z.string().trim().min(2, 'Use 2–40 characters').max(40),
  tagline: z.string().trim().max(120),
  isPublic: z.boolean(),
  limits: LimitsInput,
  fullModules: z.array(z.enum(MODULE_KEYS as unknown as [string, ...string[]])),
  /** null = not sold on this cycle (e.g. Enterprise is quoted) */
  monthlyPaise: z.number().int().min(0).max(100_000_000).nullable(),
  yearlyPaise: z.number().int().min(0).max(1_000_000_000).nullable(),
});
export type PlanDraft = z.infer<typeof PlanDraftInput>;

async function livePlan(key: string) {
  const plan = await db().plan.findUnique({ where: { key }, include: { modules: true } });
  if (!plan) throw notFound('Plan');
  const prices = await db().price.findMany({ where: { itemType: 'plan', itemRef: key, activeTo: null } });
  const price = (cycle: 'monthly' | 'yearly') => {
    const p = prices.find((x) => x.cycle === cycle);
    return p ? Number(p.amountPaise) : null;
  };
  const live: PlanDraft = {
    name: plan.name, tagline: plan.tagline ?? '', isPublic: plan.isPublic, limits: plan.limits as unknown as PlanLimits,
    fullModules: plan.modules.map((m) => m.moduleKey), monthlyPaise: price('monthly'), yearlyPaise: price('yearly'),
  };
  return { plan, live };
}

/** Dependencies first: a module needs the modules it depends on in the same plan. */
function dependencyProblems(mods: string[]) {
  const set = new Set(mods);
  return MODULES.filter((m) => set.has(m.key)).flatMap((m) => m.dependsOn.filter((d) => !set.has(d)).map((d) => `${m.name} needs ${MODULES.find((x) => x.key === d)?.name ?? d}`));
}

/** Pure: what a draft changes against the live plan. */
export function planDiff(live: PlanDraft, draft: PlanDraft) {
  const added = draft.fullModules.filter((m) => !live.fullModules.includes(m));
  const removed = live.fullModules.filter((m) => !draft.fullModules.includes(m));
  const limits = (Object.keys(draft.limits) as (keyof PlanLimits)[]).filter((k) => draft.limits[k] !== live.limits[k]).map((k) => ({ key: k, from: live.limits[k] ?? null, to: draft.limits[k] ?? null }));
  const prices = (['monthly', 'yearly'] as const).flatMap((c) => {
    const k = c === 'monthly' ? 'monthlyPaise' : 'yearlyPaise';
    return draft[k] !== live[k] ? [{ cycle: c, from: live[k], to: draft[k] }] : [];
  });
  const text = ['name', 'tagline', 'isPublic'].filter((k) => draft[k as keyof PlanDraft] !== live[k as keyof PlanDraft]);
  return { added, removed, limits, prices, text, changed: !!(added.length || removed.length || limits.length || prices.length || text.length) };
}

export async function planEditor(key: string) {
  const { plan, live } = await livePlan(key);
  const draftRow = await db().planDraft.findUnique({ where: { planKey: key } });
  const draft = draftRow ? (draftRow.data as unknown as PlanDraft) : null;
  const subs = await db().subscription.groupBy({ by: ['status'], where: { planId: plan.id }, _count: true });
  const by = Object.fromEntries(subs.map((s) => [s.status, s._count])) as Record<string, number>;
  const diff = draft ? planDiff(live, draft) : null;
  // Who would lose a module: paying or overdue businesses on this plan (trials have everything)
  const losing = diff?.removed.length ? (by.active ?? 0) + (by.past_due ?? 0) : 0;
  const editor = draftRow ? await db().user.findUnique({ where: { id: draftRow.updatedBy ?? '00000000-0000-0000-0000-000000000000' }, select: { name: true } }) : null;
  return {
    key, live, draft,
    draftBy: editor?.name ?? null, draftAt: draftRow?.updatedAt ?? null,
    diff,
    impact: { onPlan: Object.values(by).reduce((a, b) => a + b, 0), paying: by.active ?? 0, trial: by.trialing ?? 0, overdue: by.past_due ?? 0, losingModules: losing },
    problems: draft ? dependencyProblems(draft.fullModules) : [],
    modules: MODULES.map((m) => ({ key: m.key, name: m.name, category: m.category, dependsOn: m.dependsOn, freeTier: m.freeTier })),
  };
}

export async function saveDraft(ctx: ConsoleCtx, key: string, input: PlanDraft) {
  await livePlan(key);
  if (key === 'free' && input.fullModules.length) throw new AppError('VALIDATION_FAILED', 'The Free plan gets its modules from the free-tier list, not from plan modules.', { fields: { fullModules: 'Leave empty for Free' } });
  await db().planDraft.upsert({
    where: { planKey: key },
    create: { planKey: key, data: input as unknown as Prisma.InputJsonValue, updatedBy: ctx.userId },
    update: { data: input as unknown as Prisma.InputJsonValue, updatedBy: ctx.userId, updatedAt: new Date() },
  });
  return planEditor(key);
}

export async function discardDraft(key: string) {
  await db().planDraft.deleteMany({ where: { planKey: key } });
  return planEditor(key);
}

/** Apply the draft: plan facts, modules (re-computing every business on the plan) and prices. */
export async function publishDraft(ctx: ConsoleCtx, key: string) {
  const { live } = await livePlan(key);
  const row = await db().planDraft.findUnique({ where: { planKey: key } });
  if (!row) throw new AppError('INVALID_TRANSITION', 'There is no draft to publish.');
  const draft = PlanDraftInput.parse(row.data);
  const problems = dependencyProblems(draft.fullModules);
  if (problems.length) throw new AppError('VALIDATION_FAILED', `Fix the modules first: ${problems.join('; ')}.`, { fields: { fullModules: problems.join('; ') } });
  const diff = planDiff(live, draft);
  const out = await updatePlan(key, { name: draft.name, tagline: draft.tagline || null, isPublic: draft.isPublic, limits: draft.limits, ...(diff.added.length || diff.removed.length ? { fullModules: draft.fullModules } : {}) });
  for (const p of diff.prices) {
    if (p.to === null) {
      // No longer sold on this cycle: close the active price (history stays)
      await db().price.updateMany({ where: { itemType: 'plan', itemRef: key, cycle: p.cycle, activeTo: null }, data: { activeTo: new Date() } });
      invalidateCatalog();
    } else {
      await setPrice({ itemType: 'plan', itemRef: key, cycle: p.cycle, amountPaise: p.to });
    }
  }
  await db().planDraft.delete({ where: { planKey: key } });
  await audit({ tenantId: null, action: 'console.plan_published', entity: 'plan', entityId: key, before: live, after: { ...draft, recomputed: out.recomputed } });
  return planEditor(key);
}

// ── Modules ──

export async function modulesOverview() {
  const [plans, ents, overrides] = await Promise.all([
    db().plan.findMany({ orderBy: { sort: 'asc' }, include: { modules: true } }),
    db().$queryRaw<{ module_key: string; n: number }[]>`SELECT e.module_key, count(*)::int AS n FROM tenant_entitlements e JOIN tenants t ON t.id = e.tenant_id
      WHERE e.status = 'active' AND t.status IN ('trialing', 'active', 'past_due', 'free') AND NOT t.is_internal GROUP BY e.module_key`,
    db().tenantModuleOverride.findMany({ where: { OR: [{ until: null }, { until: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' } }),
  ]);
  const using = new Map(ents.map((e) => [e.module_key, e.n]));
  const tenants = new Map((await db().tenant.findMany({ where: { id: { in: overrides.map((o) => o.tenantId) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  const people = new Map((await db().user.findMany({ where: { id: { in: overrides.map((o) => o.createdBy).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return {
    plans: plans.filter((p) => p.isPublic).map((p) => ({ key: p.key, name: p.name })),
    modules: MODULES.map((m) => ({
      key: m.key, name: m.name, category: m.category, description: m.description, dependsOn: m.dependsOn, freeTier: m.freeTier,
      plans: plans.filter((p) => p.isPublic && (p.modules.some((x) => x.moduleKey === m.key) || (p.key === 'free' && m.freeTier))).map((p) => p.key),
      businesses: using.get(m.key) ?? 0,
    })),
    overrides: overrides.map((o) => ({ tenantId: o.tenantId, business: tenants.get(o.tenantId) ?? '—', moduleKey: o.moduleKey, state: o.state, until: o.until, reason: o.reason, by: o.createdBy ? people.get(o.createdBy) ?? null : null, at: o.createdAt })),
  };
}

export const OverrideInput = z.object({
  state: z.enum(['on', 'off']),
  until: z.string().datetime().nullish(),
  reason: z.string().trim().min(3, 'Say why, in a few words').max(200),
});

async function scopedBusiness(ctx: ConsoleCtx, id: string) {
  const t = await db().tenant.findFirst({ where: { id, ...(await scopedTenantFilter(ctx)) }, select: { id: true, name: true, ownerUserId: true, billingOwner: true } });
  if (!t) throw notFound('Business');
  return t;
}

/** Re-compute a business's modules inside its own transaction (RLS on). */
const recompute = (t: { id: string; ownerUserId: string }) => withTenant({ kind: 'system', tenantId: t.id, userId: t.ownerUserId }, () => persistEntitlements(t.id));

export async function setOverride(ctx: ConsoleCtx, id: string, moduleKey: string, input: z.infer<typeof OverrideInput>) {
  const t = await scopedBusiness(ctx, id);
  if (!MODULE_KEYS.includes(moduleKey as (typeof MODULE_KEYS)[number])) throw notFound('Module');
  const until = input.until ? new Date(input.until) : null;
  if (until && until <= new Date()) throw new AppError('VALIDATION_FAILED', 'Pick a date in the future.', { fields: { until: 'In the past' } });
  const data = { state: input.state, until, reason: input.reason, createdBy: ctx.userId, createdAt: new Date() };
  await db().tenantModuleOverride.upsert({ where: { tenantId_moduleKey: { tenantId: t.id, moduleKey } }, create: { tenantId: t.id, moduleKey, ...data }, update: data });
  await audit({ tenantId: null, action: 'console.module_switched', entity: 'tenant', entityId: t.id, after: { moduleKey, ...input } });
  return { ok: true, recompute: () => recompute(t) };
}

export async function clearOverride(ctx: ConsoleCtx, id: string, moduleKey: string) {
  const t = await scopedBusiness(ctx, id);
  await db().tenantModuleOverride.deleteMany({ where: { tenantId: t.id, moduleKey } });
  await audit({ tenantId: null, action: 'console.module_switch_removed', entity: 'tenant', entityId: t.id, after: { moduleKey } });
  return { ok: true, recompute: () => recompute(t) };
}

export async function businessOverrides(ctx: ConsoleCtx, id: string) {
  const t = await scopedBusiness(ctx, id);
  return db().tenantModuleOverride.findMany({ where: { tenantId: t.id }, select: { moduleKey: true, state: true, until: true, reason: true, createdAt: true } });
}

/** Daily: switches whose date has passed are removed and the business re-computed. */
export async function expireOverrides(now = new Date()) {
  const expired = await db().tenantModuleOverride.findMany({ where: { until: { lte: now } }, select: { tenantId: true, moduleKey: true } });
  for (const o of expired) await db().tenantModuleOverride.delete({ where: { tenantId_moduleKey: { tenantId: o.tenantId, moduleKey: o.moduleKey } } });
  return [...new Set(expired.map((o) => o.tenantId))];
}
