import type { BillingCycle, CouponType, PriceItemType, Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { PlanLimits } from '../../contracts/plans';
import { MODULE_KEYS } from '../../contracts/modules';
import { audit } from '../audit/service';
import { invalidateCatalog } from '../subscription/catalog';
import { persistEntitlements } from '../subscription/entitlements';

// Console → Plans & prices (design v2 R4). The database is the source of truth; every change
// clears the catalogue cache. All functions run inside consoleTx (platform transaction).

export async function catalogAdmin() {
  const tx = db();
  const [plans, modules, prices, coupons, counts] = await Promise.all([
    tx.plan.findMany({ orderBy: { sort: 'asc' }, include: { modules: true } }),
    tx.module.findMany({ orderBy: { sort: 'asc' } }),
    tx.price.findMany({ where: { activeTo: null }, orderBy: [{ itemType: 'asc' }, { itemRef: 'asc' }] }),
    tx.coupon.findMany({ orderBy: { code: 'asc' } }),
    tx.subscription.groupBy({ by: ['planId'], _count: true }),
  ]);
  const subscribers = new Map(counts.map((c) => [c.planId, c._count]));
  const now = new Date();
  return {
    plans: plans.map((p) => ({
      key: p.key, name: p.name, tagline: p.tagline, limits: p.limits as unknown as PlanLimits, isPublic: p.isPublic,
      fullModules: p.modules.map((m) => m.moduleKey), subscribers: subscribers.get(p.id) ?? 0,
    })),
    modules: modules.map((m) => ({ key: m.key, name: m.name, freeTier: m.isFreeTier, dependsOn: m.dependsOn })),
    prices: prices.map((p) => ({ id: p.id, itemType: p.itemType, itemRef: p.itemRef, cycle: p.cycle, amountPaise: Number(p.amountPaise), activeFrom: p.activeFrom })),
    coupons: coupons.map((c) => ({ ...c, active: (!c.validFrom || c.validFrom <= now) && (!c.validTo || c.validTo > now) && (c.maxRedemptions === null || c.redeemed < c.maxRedemptions) })),
  };
}

export interface PlanPatch {
  name?: string;
  tagline?: string | null;
  limits?: PlanLimits;
  isPublic?: boolean;
  fullModules?: string[];
}

/** Editing a plan's modules re-computes the entitlements of every client on that plan. */
export async function updatePlan(key: string, patch: PlanPatch, reason?: string) {
  const tx = db();
  const plan = await tx.plan.findUnique({ where: { key }, include: { modules: true } });
  if (!plan) throw notFound('Plan');
  if (patch.fullModules) {
    const unknown = patch.fullModules.filter((m) => !(MODULE_KEYS as readonly string[]).includes(m));
    if (unknown.length) throw new AppError('VALIDATION_FAILED', 'Unknown modules.', { fields: { fullModules: unknown.join(', ') } });
    if (key === 'free' && patch.fullModules.length) throw new AppError('VALIDATION_FAILED', 'The Free plan unlocks modules through free-tier flags, not plan modules.');
  }

  const before = { name: plan.name, tagline: plan.tagline, limits: plan.limits, isPublic: plan.isPublic, fullModules: plan.modules.map((m) => m.moduleKey) };
  await tx.plan.update({
    where: { id: plan.id },
    data: { name: patch.name, tagline: patch.tagline, limits: patch.limits as Prisma.InputJsonValue | undefined, isPublic: patch.isPublic },
  });
  let recomputed = 0;
  if (patch.fullModules) {
    await tx.planModule.deleteMany({ where: { planId: plan.id } });
    await tx.planModule.createMany({ data: [...new Set(patch.fullModules)].map((moduleKey) => ({ planId: plan.id, moduleKey })) });
    const affected = await tx.subscription.findMany({ where: { planId: plan.id }, select: { tenantId: true } });
    for (const s of affected) await persistEntitlements(s.tenantId);
    recomputed = affected.length;
  }
  await audit({ tenantId: null, action: 'console.plan_updated', entity: 'plan', entityId: key, before, after: { ...patch, reason } });
  invalidateCatalog();
  return { key, recomputed };
}

/** Prices are versioned (SUB-06): the active row is closed and a new one opened. Existing subscriptions keep their price. */
export async function setPrice(input: { itemType: PriceItemType; itemRef: string; cycle: BillingCycle; amountPaise: number }, reason?: string) {
  const tx = db();
  const current = await tx.price.findFirst({ where: { itemType: input.itemType, itemRef: input.itemRef, cycle: input.cycle, activeTo: null } });
  if (current && Number(current.amountPaise) === input.amountPaise) return { id: current.id, unchanged: true };
  if (input.itemType === 'plan' && !(await tx.plan.findUnique({ where: { key: input.itemRef } }))) throw notFound('Plan');
  if (input.itemType === 'addon_module' && !(await tx.module.findUnique({ where: { key: input.itemRef } }))) throw notFound('Module');
  const now = new Date();
  if (current) await tx.price.update({ where: { id: current.id }, data: { activeTo: now } });
  const row = await tx.price.create({ data: { ...input, amountPaise: BigInt(input.amountPaise), activeFrom: now } });
  await audit({ tenantId: null, action: 'console.price_changed', entity: 'price', entityId: `${input.itemType}:${input.itemRef}:${input.cycle}`, before: current ? Number(current.amountPaise) : null, after: { amountPaise: input.amountPaise, reason } });
  invalidateCatalog();
  return { id: row.id, unchanged: false };
}

export interface CouponInput {
  code: string;
  type: CouponType;
  value: number;
  appliesTo: string;
  validFrom?: string | null;
  validTo?: string | null;
  maxRedemptions?: number | null;
}

export async function createCoupon(input: CouponInput, reason?: string) {
  const tx = db();
  const code = input.code.trim().toUpperCase();
  if (input.type === 'percent' && input.value > 100) throw new AppError('VALIDATION_FAILED', 'A percentage coupon cannot exceed 100%.', { fields: { value: 'At most 100' } });
  if (await tx.coupon.findUnique({ where: { code } })) throw new AppError('CONFLICT', 'A coupon with this code already exists.', { fields: { code: 'Already exists' } });
  const row = await tx.coupon.create({
    data: {
      code, type: input.type, value: input.value, appliesTo: input.appliesTo,
      validFrom: input.validFrom ? new Date(input.validFrom) : null, validTo: input.validTo ? new Date(input.validTo) : null,
      maxRedemptions: input.maxRedemptions ?? null,
    },
  });
  await audit({ tenantId: null, action: 'console.coupon_created', entity: 'coupon', entityId: code, after: { ...row, reason } });
  return row;
}

/** Ends a coupon now (coupons are never deleted: past checkouts reference them). */
export async function endCoupon(code: string, reason?: string) {
  const tx = db();
  const coupon = await tx.coupon.findUnique({ where: { code } });
  if (!coupon) throw notFound('Coupon');
  const row = await tx.coupon.update({ where: { code }, data: { validTo: new Date() } });
  await audit({ tenantId: null, action: 'console.coupon_ended', entity: 'coupon', entityId: code, before: { validTo: coupon.validTo }, after: { validTo: row.validTo, reason } });
  return row;
}
