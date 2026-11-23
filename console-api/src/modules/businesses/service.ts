import { randomUUID } from 'node:crypto';
import type { OnboardedBy, Prisma, SubStatus } from '@prisma/client';
import { z } from 'zod';
import { MODULE_KEYS } from '@contracts/modules';
import { prisma, type Tx } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { audit } from '../../kernel/audit';
import { normaliseEmail, normaliseMobile } from '../../kernel/crypto';
import { getSetting } from '../system/settings';
import { issueLicence } from '../licences/service';
import { erp, type ErpOverview } from '../erp/client';
import { PARTNER_ROLES } from '../../middleware/auth';

// Businesses AHEAD serves: who they are, who brought them in, their plan and its state. Every
// change issues a fresh licence in the same transaction; the outbox then sends it to the ERP.

export type Actor = { id: string; role: import('@prisma/client').ConsoleRole; partnerId: string | null };

/** Which businesses a person may see: all (Admin, Staff), the ones they brought (Sales, Vendor), their partner's */
export function scopeOf(a: Actor): Prisma.BusinessWhereInput {
  if (a.role === 'admin' || a.role === 'staff') return {};
  if (PARTNER_ROLES.includes(a.role)) return { partnerId: a.partnerId ?? '00000000-0000-0000-0000-000000000000' };
  return { onboardedById: a.id };
}

export async function findScoped(a: Actor, id: string, tx: Tx | typeof prisma = prisma) {
  const b = await tx.business.findFirst({ where: { id, ...scopeOf(a) } });
  if (!b) throw new AppError('NOT_FOUND', 'Business not found.');
  return b;
}

const DAY = 86_400_000;
/** End of the last trial day in India */
export function trialEnd(from: Date, days: number) {
  const ist = new Date(from.getTime() + 330 * 60_000 + days * DAY);
  ist.setUTCHours(23, 59, 59, 0);
  return new Date(ist.getTime() - 330 * 60_000);
}

export const CreateInput = z.object({
  name: z.string().trim().min(2, 'Enter the business name').max(100),
  legalName: z.string().trim().max(160).nullish(),
  industryKey: z.string().min(2, 'Choose the industry').max(60),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN').nullish().or(z.literal('').transform(() => null)),
  stateCode: z.string().regex(/^\d{2}$/).nullish(),
  owner: z.object({
    name: z.string().trim().min(2, 'Enter the owner’s name').max(100),
    email: z.string().trim().email('Enter a valid email').transform(normaliseEmail),
    mobile: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a 10-digit mobile').transform(normaliseMobile),
  }),
  /** Trial: Professional for the trial days, then Free. Paid: the chosen plan opens after the first payment. */
  start: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('trial') }),
    z.object({ kind: z.literal('paid'), planKey: z.string(), cycle: z.enum(['monthly', 'yearly']) }),
  ]),
  /** Admin and Staff may add a business for a partner */
  partnerId: z.string().uuid().nullish(),
});
export type CreateInput = z.infer<typeof CreateInput>;

const ONBOARDED: Record<string, OnboardedBy> = { admin: 'team', staff: 'team', sales: 'sales', vendor: 'vendor', partner_owner: 'partner', partner_staff: 'partner' };
const SOURCE = { website: 'direct', team: 'direct', sales: 'sales', vendor: 'vendor', partner: 'partner' } as const;

export async function createBusiness(a: Actor, input: CreateInput) {
  const partnerId = PARTNER_ROLES.includes(a.role) ? a.partnerId : (a.role === 'admin' || a.role === 'staff') ? input.partnerId ?? null : null;
  if (partnerId && !(await prisma.partner.findFirst({ where: { id: partnerId, status: 'active' } }))) throw new AppError('VALIDATION_FAILED', 'Choose an active partner.', { fields: { partnerId: 'Unknown partner' } });
  // One free trial per owner (email or mobile) and per GSTIN
  if (input.start.kind === 'trial') {
    const used = await prisma.business.findFirst({
      where: { OR: [{ ownerEmail: input.owner.email }, { ownerMobile: input.owner.mobile }, ...(input.gstin ? [{ gstin: input.gstin }] : [])] },
      select: { name: true },
    });
    if (used) throw new AppError('DUPLICATE_TRIAL', `These details already had a free trial (${used.name}). Start this one on a paid plan.`);
  }
  const plan =
    input.start.kind === 'paid'
      ? await prisma.plan.findFirst({ where: { key: input.start.planKey, active: true, isFree: false, monthlyPaise: { not: null } } })
      : await prisma.plan.findFirst({ where: { isTrial: true, active: true } });
  if (!plan) throw new AppError('VALIDATION_FAILED', input.start.kind === 'paid' ? 'Choose a paid plan.' : 'No trial plan is set up.', { fields: { 'start.planKey': 'Choose a plan' } });
  const trialDays = (await getSetting<number>('trial.days')) ?? 14;
  const onboardedBy = partnerId ? 'partner' : ONBOARDED[a.role];
  const id = randomUUID();
  const now = new Date();

  const business = await prisma.$transaction(async (tx) => {
    const b = await tx.business.create({
      data: {
        id, name: input.name, legalName: input.legalName ?? null, industryKey: input.industryKey, gstin: input.gstin ?? null, stateCode: input.stateCode ?? input.gstin?.slice(0, 2) ?? null,
        ownerName: input.owner.name, ownerEmail: input.owner.email, ownerMobile: input.owner.mobile, onboardedBy, onboardedById: a.id, partnerId,
      },
    });
    await tx.subscription.create({
      data: input.start.kind === 'trial'
        ? { businessId: id, planKey: plan.key, status: 'trialing', trialEndsAt: trialEnd(now, trialDays) }
        : { businessId: id, planKey: plan.key, status: 'incomplete', cycle: input.start.cycle },
    });
    await issueLicence(tx, id);
    await tx.delivery.create({ data: { kind: 'provision', businessId: id, payload: { industryKey: input.industryKey, billedToPartner: !!partnerId, source: SOURCE[onboardedBy] } } });
    await audit({ actorId: a.id, action: 'business.created', entity: 'business', entityId: id, after: { name: b.name, start: input.start, partnerId } }, tx);
    return b;
  });
  return business;
}

/** Change the subscription and issue its licence, in one transaction */
async function changeSubscription(a: Actor, id: string, action: string, change: (sub: { status: SubStatus; planKey: string }, tx: Tx) => Promise<Prisma.SubscriptionUpdateInput>) {
  return prisma.$transaction(async (tx) => {
    await findScoped(a, id, tx);
    const sub = await tx.subscription.findUniqueOrThrow({ where: { businessId: id } });
    const data = await change(sub, tx);
    const after = await tx.subscription.update({ where: { businessId: id }, data: { ...data, version: { increment: 1 } } });
    await issueLicence(tx, id);
    await audit({ actorId: a.id, action, entity: 'business', entityId: id, before: { status: sub.status, plan: sub.planKey }, after: { status: after.status, plan: after.planKey } }, tx);
    return after;
  });
}

/** Admin/Staff: put a business on a plan now (paid outside online checkout: bank transfer, cheque) */
export const setPlan = (a: Actor, id: string, planKey: string, cycle: 'monthly' | 'yearly') =>
  changeSubscription(a, id, 'business.plan_set', async (sub, tx) => {
    if (sub.status === 'closed') throw new AppError('CONFLICT', 'Reopen the business first.');
    const plan = await tx.plan.findFirst({ where: { key: planKey, active: true } });
    if (!plan) throw new AppError('VALIDATION_FAILED', 'Choose a plan.', { fields: { planKey: 'Unknown plan' } });
    if (plan.isFree) return { planKey, status: 'free', periodStart: null, periodEnd: null, trialEndsAt: null, graceEndsAt: null };
    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + (cycle === 'yearly' ? 12 : 1));
    return { planKey, cycle, status: 'active', periodStart: now, periodEnd: end, trialEndsAt: null, graceEndsAt: null, cancelAtPeriodEnd: false };
  });

export const extendTrial = (a: Actor, id: string, days: number) =>
  changeSubscription(a, id, 'business.trial_extended', async (sub, tx) => {
    if (sub.status !== 'trialing' && sub.status !== 'free') throw new AppError('CONFLICT', 'Only a business on trial or on Free can get trial days.');
    const current = (await tx.subscription.findUniqueOrThrow({ where: { businessId: id } })).trialEndsAt;
    const from = current && current > new Date() ? current : new Date();
    const trialPlan = await tx.plan.findFirstOrThrow({ where: { isTrial: true } });
    return { status: 'trialing', planKey: trialPlan.key, trialEndsAt: trialEnd(from, days) };
  });

export const closeBusiness = (a: Actor, id: string) =>
  changeSubscription(a, id, 'business.closed', async (sub) => {
    if (sub.status === 'closed') throw new AppError('CONFLICT', 'This business is already closed.');
    const keep = (await getSetting<number>('closed.keep_days')) ?? 90;
    return { status: 'closed', closedAt: new Date(), purgeAt: new Date(Date.now() + keep * DAY) };
  });

export const reopenBusiness = (a: Actor, id: string) =>
  changeSubscription(a, id, 'business.reopened', async (sub, tx) => {
    if (sub.status !== 'closed') throw new AppError('CONFLICT', 'This business is not closed.');
    const free = await tx.plan.findFirstOrThrow({ where: { isFree: true } });
    return { status: 'free', planKey: free.key, closedAt: null, purgeAt: null, periodStart: null, periodEnd: null };
  });

/** Switch one module on or off on top of the plan (until a date, or for good); null removes the switch */
export async function setModule(a: Actor, id: string, moduleKey: string, state: 'on' | 'off' | null, until: Date | null) {
  if (!MODULE_KEYS.includes(moduleKey as (typeof MODULE_KEYS)[number])) throw new AppError('NOT_FOUND', 'Unknown module.');
  return prisma.$transaction(async (tx) => {
    await findScoped(a, id, tx);
    if (state === null) await tx.moduleOverride.deleteMany({ where: { businessId: id, moduleKey } });
    else await tx.moduleOverride.upsert({ where: { businessId_moduleKey: { businessId: id, moduleKey } }, create: { businessId: id, moduleKey, state, until, createdById: a.id }, update: { state, until, createdById: a.id } });
    await issueLicence(tx, id);
    await audit({ actorId: a.id, action: 'business.module_switch', entity: 'business', entityId: id, after: { moduleKey, state, until } }, tx);
  });
}

export async function resendOwnerLink(a: Actor, id: string) {
  const b = await findScoped(a, id);
  if (!b.provisionedAt) throw new AppError('CONFLICT', 'The workspace is still being set up. The link goes out as soon as it is ready.');
  await prisma.delivery.create({ data: { kind: 'owner_link', businessId: id, payload: {} } });
  await audit({ actorId: a.id, action: 'business.owner_link', entity: 'business', entityId: id });
}

/** Live facts from the ERP (kept as the last known if the ERP can't be reached) */
export async function refreshFacts(id: string) {
  try {
    const facts = await erp<ErpOverview>('GET', `/tenants/${id}/overview`, undefined, 8_000);
    await prisma.business.update({ where: { id }, data: { facts: facts as unknown as Prisma.InputJsonValue, factsAt: new Date() } });
    return { facts, live: true };
  } catch {
    const b = await prisma.business.findUniqueOrThrow({ where: { id }, select: { facts: true } });
    return { facts: b.facts as unknown as ErpOverview | null, live: false };
  }
}
