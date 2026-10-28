import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { normaliseEmail, normaliseMobile } from '../../kernel/crypto';
import { optionalText, zEmail, zGstin, zMobileIN, zPersonName, zStateCode } from '../../kernel/zodRules';
import { gstinStateMismatch } from '../../contracts/validation';
import { audit } from '../audit/service';
import { sendMessage } from '../notifications/service';
import { getSetting } from '../settings/service';
import { createTenant } from '../tenancy/createTenant';
import { transition } from '../subscription/stateMachine';
import { persistEntitlements } from '../subscription/entitlements';
import { addMember } from './members';
import { assertClientInScope } from './clients';

// Partners (platform design §1, §4, §5 — v1): a reseller that brings its own clients. Partner
// clients go live straight away on the plan the partner picks; AHEAD bills the partner once a
// month for every live client at list price minus the partner's discount. Branding, domains
// and the monthly invoice run come later. All functions run inside consoleTx.

export const PartnerInput = z
  .object({
    name: z.string().trim().min(2, 'Use 2–120 characters').max(120),
    contactName: zPersonName,
    email: zEmail,
    mobile: zMobileIN,
    gstin: optionalText(zGstin),
    stateCode: zStateCode.nullish(),
    discountPercent: z.number().min(0, 'From 0 to 90').max(90, 'From 0 to 90'),
  })
  .superRefine((b, c) => {
    const mismatch = gstinStateMismatch(b.gstin, b.stateCode ?? undefined);
    if (mismatch) c.addIssue({ code: z.ZodIssueCode.custom, path: ['gstin'], message: mismatch });
  });
export const PartnerPatch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  contactName: zPersonName.optional(),
  email: zEmail.optional(),
  mobile: zMobileIN.optional(),
  gstin: optionalText(zGstin),
  stateCode: zStateCode.nullish(),
  discountPercent: z.number().min(0).max(90).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

const LIVE = ['trialing', 'active', 'past_due'] as const;

/** This month's bill for a partner: every live client at list price minus the discount, plus GST. */
export async function partnerBill(partnerId: string) {
  const [partner, clients, plans, prices, seller] = await Promise.all([
    db().partner.findUniqueOrThrow({ where: { id: partnerId }, select: { discountBp: true } }),
    db().tenant.findMany({ where: { partnerId, status: { in: [...LIVE] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, subscription: { select: { planId: true } } } }),
    db().plan.findMany({ select: { id: true, key: true, name: true } }),
    db().price.findMany({ where: { itemType: 'plan', activeTo: null }, select: { itemRef: true, cycle: true, amountPaise: true } }),
    getSetting('ahead.billing'),
  ]);
  // Billed monthly whatever the client's cycle: the monthly list price, or the yearly price ÷ 12
  const monthly = (planKey: string) => {
    const m = prices.find((p) => p.itemRef === planKey && p.cycle === 'monthly');
    if (m) return Number(m.amountPaise);
    const y = prices.find((p) => p.itemRef === planKey && p.cycle === 'yearly');
    return y ? Math.round(Number(y.amountPaise) / 12) : 0;
  };
  const planOf = new Map(plans.map((pl) => [pl.id, pl]));
  const lines = clients.map((c) => {
    const plan = c.subscription ? planOf.get(c.subscription.planId) : undefined;
    const list = plan ? monthly(plan.key) : 0;
    return { tenantId: c.id, name: c.name, plan: plan?.name ?? '—', listPaise: list, chargePaise: Math.round((list * (10_000 - partner.discountBp)) / 10_000) };
  });
  const subtotal = lines.reduce((t, l) => t + l.chargePaise, 0);
  const gst = Math.round((subtotal * seller.gstRateBp) / 10_000);
  return { discountPercent: partner.discountBp / 100, lines, subtotalPaise: subtotal, gstPaise: gst, totalPaise: subtotal + gst, gstRatePercent: seller.gstRateBp / 100 };
}

export async function listPartners() {
  const rows = await db().partner.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { tenants: true, members: { where: { status: 'active' } } } } },
  });
  const live = await db().tenant.groupBy({ by: ['partnerId'], where: { partnerId: { in: rows.map((r) => r.id) }, status: { in: [...LIVE] } }, _count: true });
  const liveBy = new Map(live.map((l) => [l.partnerId, l._count]));
  return rows.map((p) => ({ id: p.id, name: p.name, contactName: p.contactName, email: p.email, mobile: p.mobile, discountPercent: p.discountBp / 100, status: p.status, clients: p._count.tenants, liveClients: liveBy.get(p.id) ?? 0, people: p._count.members, createdAt: p.createdAt }));
}

export async function partnerDetail(id: string) {
  const p = await db().partner.findUnique({ where: { id } });
  if (!p) throw notFound('Partner');
  const [people, bill] = await Promise.all([
    db().platformMember.findMany({ where: { partnerId: id }, orderBy: { joinedAt: 'asc' }, select: { id: true, status: true, user: { select: { name: true, email: true, lastLoginAt: true } }, role: { select: { name: true } } } }),
    partnerBill(id),
  ]);
  return { id: p.id, name: p.name, contactName: p.contactName, email: p.email, mobile: p.mobile, gstin: p.gstin, stateCode: p.stateCode, discountPercent: p.discountBp / 100, status: p.status, createdAt: p.createdAt, people, bill };
}

/** A new partner and its first admin, who signs in with mobile OTP. */
export async function createPartner(ctx: ConsoleCtx, input: z.infer<typeof PartnerInput>) {
  const tx = db();
  if (await tx.partner.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } } })) throw new AppError('CONFLICT', 'A partner with this name already exists.', { fields: { name: 'Already a partner' } });
  const partner = await tx.partner.create({
    data: { name: input.name, contactName: input.contactName, email: normaliseEmail(input.email), mobile: normaliseMobile(input.mobile), gstin: input.gstin?.toUpperCase() ?? null, stateCode: input.stateCode ?? null, discountBp: Math.round(input.discountPercent * 100), createdBy: ctx.userId },
  });
  await addMember(ctx, { email: input.email, name: input.contactName, mobile: input.mobile, roleKey: 'partner_admin' }, { partnerId: partner.id });
  await sendMessage({
    channel: 'email',
    to: normaliseEmail(input.email),
    template: 'partner.welcome',
    subject: `${partner.name} is now an AHEAD partner`,
    text: `Hi ${input.contactName}, your AHEAD partner panel is ready. Sign in at /login with your mobile (OTP) to add your clients.`,
  });
  await audit({ tenantId: null, action: 'console.partner_created', entity: 'partner', entityId: partner.id, after: { name: partner.name, discountBp: partner.discountBp } });
  return { id: partner.id };
}

export async function updatePartner(id: string, patch: z.infer<typeof PartnerPatch>) {
  const tx = db();
  const before = await tx.partner.findUnique({ where: { id } });
  if (!before) throw notFound('Partner');
  const { discountPercent, ...rest } = patch;
  const row = await tx.partner.update({
    where: { id },
    data: { ...rest, email: rest.email ? normaliseEmail(rest.email) : undefined, mobile: rest.mobile ? normaliseMobile(rest.mobile) : undefined, gstin: rest.gstin === undefined ? undefined : rest.gstin?.toUpperCase() ?? null, discountBp: discountPercent === undefined ? undefined : Math.round(discountPercent * 100) },
  });
  await audit({ tenantId: null, action: 'console.partner_updated', entity: 'partner', entityId: id, before: { discountBp: before.discountBp, status: before.status }, after: patch });
  return row;
}

export const PartnerClientInput = z
  .object({
    business: z.object({
      name: z.string().trim().min(2, 'Use 2–120 characters').max(120),
      industryKey: z.string().max(40),
      gstin: optionalText(zGstin),
      stateCode: zStateCode,
    }),
    owner: z.object({ name: zPersonName, email: zEmail, mobile: zMobileIN }),
    planKey: z.string().max(40),
    cycle: z.enum(['monthly', 'yearly']),
  })
  .superRefine((b, c) => {
    const mismatch = gstinStateMismatch(b.business.gstin, b.business.stateCode);
    if (mismatch) c.addIssue({ code: z.ZodIssueCode.custom, path: ['business', 'gstin'], message: mismatch });
  });

/** A partner adds a client: live at once, billed to the partner (no AHEAD order or payment link). */
export async function createPartnerClient(ctx: ConsoleCtx, input: z.infer<typeof PartnerClientInput>) {
  if (!ctx.partnerId) throw new AppError('PERMISSION_DENIED', 'Only partner people add partner clients.');
  const tx = db();
  const partner = await tx.partner.findUniqueOrThrow({ where: { id: ctx.partnerId } });
  if (partner.status !== 'active') throw new AppError('PERMISSION_DENIED', 'Your partner account is paused. Please contact AHEAD.');
  const plan = await tx.plan.findUnique({ where: { key: input.planKey } });
  if (!plan || plan.key === 'free') throw new AppError('VALIDATION_FAILED', 'Choose a paid plan.', { fields: { planKey: 'Choose a paid plan' } });

  const email = normaliseEmail(input.owner.email);
  const mobile = normaliseMobile(input.owner.mobile);
  const byEmail = await tx.user.findUnique({ where: { email } });
  const byMobile = await tx.user.findUnique({ where: { mobile } });
  if (byEmail && byMobile && byEmail.id !== byMobile.id) throw new AppError('CONFLICT', 'This email and mobile belong to two different accounts.', { fields: { mobile: 'Belongs to another account' } });
  if (!byEmail && byMobile) throw new AppError('MOBILE_TAKEN', 'This mobile number already belongs to another account.', { fields: { mobile: 'Already in use' } });

  const created = await createTenant({
    owner: byEmail ? { kind: 'existing', userId: byEmail.id } : { kind: 'new', name: input.owner.name.trim(), email, mobile, passwordHash: null, mobileVerified: false },
    businessName: input.business.name.trim(),
    industryKey: input.business.industryKey,
    gstin: input.business.gstin?.toUpperCase() ?? undefined,
    billingStateCode: input.business.stateCode,
    partnerId: partner.id,
    acquisition: { byType: 'partner_user', byUserId: ctx.userId, method: 'manual' },
    paidOnboarding: { planId: plan.id, cycle: input.cycle },
  });
  await transition(created.tenant.id, 'payment_captured', { planId: plan.id });
  // No AHEAD period: the partner's monthly bill covers it, so renewals and dunning never touch it
  await tx.subscription.update({ where: { tenantId: created.tenant.id }, data: { currentPeriodEnd: null } });

  await sendMessage({
    channel: 'email',
    to: email,
    template: 'onboarding.partner_client',
    subject: `Your workspace for ${input.business.name} is ready`,
    text: `Hi ${input.owner.name}, ${partner.name} has set up your business software. Sign in at /login with your mobile ${mobile} (OTP).`,
  });
  await audit({ tenantId: null, action: 'console.partner_client_created', entity: 'tenant', entityId: created.tenant.id, after: { partnerId: partner.id, plan: plan.key, cycle: input.cycle } });
  return { tenantId: created.tenant.id };
}

/** A partner moves its client to another plan; it shows on the next monthly bill. */
export async function changePartnerClientPlan(ctx: ConsoleCtx, tenantId: string, planKey: string) {
  if (!ctx.partnerId) throw new AppError('PERMISSION_DENIED', 'Only the partner changes a partner client’s plan.');
  await assertClientInScope(ctx, tenantId);
  const tx = db();
  const plan = await tx.plan.findUnique({ where: { key: planKey } });
  if (!plan || plan.key === 'free') throw new AppError('VALIDATION_FAILED', 'Choose a paid plan.', { fields: { planKey: 'Choose a paid plan' } });
  const sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId } });
  if (sub.planId === plan.id) return { changed: false };
  await tx.subscription.update({ where: { tenantId }, data: { planId: plan.id, version: { increment: 1 } } });
  await persistEntitlements(tenantId);
  await audit({ tenantId: null, action: 'console.partner_plan_changed', entity: 'tenant', entityId: tenantId, before: { planId: sub.planId }, after: { plan: plan.key } });
  return { changed: true };
}
