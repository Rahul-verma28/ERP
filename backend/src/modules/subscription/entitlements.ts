import type { EntitlementStatus, TenantStatus } from '@prisma/client';
import { prisma, db } from '../../kernel/db';
import { cache } from '../../kernel/cache';
import { MODULES, MODULE_KEYS, type ModuleKey, type ModuleTier } from '../../contracts/modules';
import type { PlanLimits } from '../../contracts/plans';
import { getSetting } from '../settings/service';
import { getCatalog } from './catalog';

// SUB-04: the entitlement table is the single source the app reads to unlock modules.

export interface ModuleEntitlement {
  status: EntitlementStatus;
  tier: ModuleTier;
}

export interface EntitlementSnapshot {
  tenantId: string;
  status: TenantStatus;
  planKey: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  limits: PlanLimits;
  modules: Record<ModuleKey, ModuleEntitlement>;
}

const PAID_STATES: TenantStatus[] = ['active', 'past_due'];

export function resolveEntitlements(
  status: TenantStatus,
  fullModules: Set<string>,
  everUsed: Set<string>,
  freeTier: Set<string>,
): Record<ModuleKey, ModuleEntitlement> {
  const out = {} as Record<ModuleKey, ModuleEntitlement>;
  for (const m of MODULES) {
    let e: ModuleEntitlement;
    if (status === 'trialing') e = { status: 'active', tier: 'full' };
    else if (status === 'incomplete') e = { status: 'inactive', tier: 'basic' }; // modules open after the first payment
    else if (status === 'closed' || status === 'purged') e = { status: everUsed.has(m.key) ? 'read_only' : 'inactive', tier: 'basic' };
    else if (PAID_STATES.includes(status) && fullModules.has(m.key)) e = { status: 'active', tier: 'full' };
    else if (freeTier.has(m.key)) e = { status: 'active', tier: 'basic' };
    else e = { status: everUsed.has(m.key) ? 'read_only' : 'inactive', tier: 'basic' };
    out[m.key] = e;
  }
  return out;
}

export function resolveLimits(status: TenantStatus, planLimits: PlanLimits, defaults: { trial: PlanLimits; free: PlanLimits }): PlanLimits {
  if (status === 'trialing') return defaults.trial;
  if (status === 'incomplete') return planLimits; // the plan being bought, so the owner can invite the team
  if (PAID_STATES.includes(status)) return planLimits;
  return defaults.free;
}

/** Extra users bought on top of the plan (subscription items priced as extra_user). */
async function extraUsers(client: Pick<typeof prisma, 'price'>, items: { priceId: string; quantity: number }[]) {
  if (!items.length) return 0;
  const prices = await client.price.findMany({ where: { id: { in: items.map((i) => i.priceId) }, itemType: 'extra_user' }, select: { id: true } });
  const ids = new Set(prices.map((p) => p.id));
  return items.filter((i) => ids.has(i.priceId)).reduce((n, i) => n + i.quantity, 0);
}

export const withExtraUsers = (limits: PlanLimits, extra: number, status: TenantStatus) =>
  extra && (PAID_STATES.includes(status) || status === 'incomplete') ? { ...limits, users: limits.users + extra } : limits;

async function limitDefaults() {
  const [catalog, trial] = await Promise.all([getCatalog(), getSetting('trial.limits')]);
  return { catalog, defaults: { trial, free: catalog.freeLimits } };
}

async function loadSubscription(tenantId: string, client: Pick<typeof prisma, 'subscription'>) {
  return client.subscription.findUniqueOrThrow({
    where: { tenantId },
    include: { items: true },
  });
}

/** Recompute and store tenant_entitlements. Call inside a platform transaction. */
/**
 * Pure: Console module switches for one business (Phase D) on top of what the plan gives.
 * "on" opens a module in full; "off" closes it (read-only if it was ever used). A business that
 * is closed or still waiting for its first payment gets nothing from a switch.
 */
export function applyOverrides<T extends Record<string, { status: 'active' | 'read_only' | 'inactive'; tier: ModuleTier }>>(
  resolved: T,
  overrides: { moduleKey: string; state: string }[],
  status: TenantStatus,
  everUsed: Set<string>,
): T {
  if (['closed', 'purged', 'incomplete'].includes(status)) return resolved;
  const out = { ...resolved };
  for (const o of overrides) {
    if (!(o.moduleKey in out)) continue;
    (out as Record<string, { status: 'active' | 'read_only' | 'inactive'; tier: ModuleTier }>)[o.moduleKey] =
      o.state === 'on' ? { status: 'active', tier: 'full' } : { status: everUsed.has(o.moduleKey) ? 'read_only' : 'inactive', tier: 'basic' };
  }
  return out;
}

export async function persistEntitlements(tenantId: string) {
  const tx = db();
  const sub = await loadSubscription(tenantId, tx);
  const plan = await tx.plan.findUniqueOrThrow({ where: { id: sub.planId }, include: { modules: true } });
  const full = new Set(plan.modules.map((m) => m.moduleKey));
  if (sub.items.length) {
    const prices = await tx.price.findMany({ where: { id: { in: sub.items.map((i) => i.priceId) }, itemType: 'addon_module' } });
    prices.forEach((p) => full.add(p.itemRef));
  }
  const rows = await tx.tenantEntitlement.findMany({ where: { tenantId } });
  const everUsed = new Set(rows.filter((r) => r.activatedAt).map((r) => r.moduleKey));
  const { catalog, defaults } = await limitDefaults();
  const resolved = applyOverrides(
    resolveEntitlements(sub.status, full, everUsed, catalog.freeTierModules),
    await tx.tenantModuleOverride.findMany({ where: { tenantId, OR: [{ until: null }, { until: { gt: new Date() } }] }, select: { moduleKey: true, state: true } }),
    sub.status,
    everUsed,
  );
  const limits = withExtraUsers(resolveLimits(sub.status, plan.limits as unknown as PlanLimits, defaults), await extraUsers(tx, sub.items), sub.status);
  const now = new Date();

  const dataFor = (key: ModuleKey) => {
    const e = resolved[key];
    const prev = rows.find((r) => r.moduleKey === key);
    return { status: e.status, limits: { tier: e.tier }, activatedAt: prev?.activatedAt ?? (e.status === 'active' ? now : null) };
  };
  // New tenant: one INSERT instead of a round trip per module (signup is latency-bound)
  const missing = MODULE_KEYS.filter((k) => !rows.some((r) => r.moduleKey === k));
  if (missing.length) await tx.tenantEntitlement.createMany({ data: missing.map((key) => ({ tenantId, moduleKey: key, ...dataFor(key) })) });
  for (const key of MODULE_KEYS) {
    if (missing.includes(key)) continue;
    const data = dataFor(key);
    const prev = rows.find((r) => r.moduleKey === key)!;
    if (prev.status === data.status && JSON.stringify(prev.limits) === JSON.stringify(data.limits) && +(prev.activatedAt ?? 0) === +(data.activatedAt ?? 0)) continue;
    await tx.tenantEntitlement.update({ where: { tenantId_moduleKey: { tenantId, moduleKey: key } }, data });
  }
  cache.del(`ent:tenant:${tenantId}`);
  return { modules: resolved, limits, planKey: plan.key };
}

/** Cached snapshot used by middleware and /me (reads with platform privileges). */
export function getEntitlements(tenantId: string): Promise<EntitlementSnapshot> {
  return cache.getOrSet(`ent:tenant:${tenantId}`, async () => {
    const sub = await loadSubscription(tenantId, prisma);
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: sub.planId } });
    const rows = await prisma.tenantEntitlement.findMany({ where: { tenantId } });
    const modules = {} as Record<ModuleKey, ModuleEntitlement>;
    for (const key of MODULE_KEYS) {
      const r = rows.find((x) => x.moduleKey === key);
      modules[key] = { status: r?.status ?? 'inactive', tier: ((r?.limits as { tier?: ModuleTier } | null)?.tier ?? 'basic') };
    }
    return {
      tenantId,
      status: sub.status,
      planKey: plan.key,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      limits: withExtraUsers(resolveLimits(sub.status, plan.limits as unknown as PlanLimits, (await limitDefaults()).defaults), await extraUsers(prisma, sub.items), sub.status),
      modules,
    };
  });
}

/** Module keys active at full tier — used for module-role visibility (Roles doc). */
export const fullModules = (snap: EntitlementSnapshot) =>
  MODULE_KEYS.filter((k) => snap.modules[k].status === 'active' && snap.modules[k].tier === 'full');
