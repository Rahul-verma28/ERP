import type { PlatformPaymentMethod, Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { normaliseEmail, normaliseMobile } from '../../kernel/crypto';
import { computeDocument, financialYear } from '../../kernel/gst';
import { audit } from '../audit/service';
import { getSetting } from '../settings/service';
import { createTenant } from '../tenancy/createTenant';
import { sendAccessLink } from '../identity/accessLinks';
import { startHandover } from '../console/onboarding';
import { transition } from '../subscription/stateMachine';
import { persistEntitlements } from '../subscription/entitlements';

// design v2 Step 4: what AHEAD sells to a client. One order = plan + add-on modules + extra
// users for one cycle, priced from the active price list, discounted (sales limit / coupon),
// taxed with GST once, and invoiced only when paid. All functions run in a platform transaction.

const DAY = 86_400_000;

export interface QuoteInput {
  planKey: string;
  cycle: 'monthly' | 'yearly';
  addOns: string[];
  extraUsers: number;
  /** Sales discount in percent, up to 2 decimals */
  discountPercent: number;
  couponCode?: string | null;
  billTo: { name: string; gstin?: string | null; stateCode: string; address?: string | null };
}

export interface OrderItem {
  itemType: 'plan' | 'addon_module' | 'extra_user';
  itemRef: string;
  priceId: string;
  description: string;
  quantity: number;
  unitPaise: number;
  amountPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

/** Pure: split a discount over amounts in proportion; the last line takes the rounding remainder. */
export function allocate(amounts: number[], discount: number): number[] {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (!total || !discount) return amounts.map(() => 0);
  let left = discount;
  return amounts.map((a, i) => {
    if (i === amounts.length - 1) return left;
    const share = Math.floor((a * discount) / total);
    left -= share;
    return share;
  });
}

async function seller() {
  const s = await getSetting('ahead.billing');
  if (!/^\d{2}$/.test(s.stateCode)) throw new AppError('VALIDATION_FAILED', "Prices can't be worked out yet: AHEAD's billing details aren't filled in. An Admin adds them in Settings › Company details & rules.");
  return s;
}

async function activePrice(itemType: 'plan' | 'addon_module' | 'extra_user', itemRef: string, cycle: 'monthly' | 'yearly') {
  return db().price.findFirst({ where: { itemType, itemRef, cycle, activeTo: null } });
}

/**
 * Price an order. Nothing is written. Console v3: one discount per order — a manual discount
 * or a coupon, never both. `welcomePercent` (a referral signup's first payment) applies only
 * when the order has neither.
 */
export async function quote(input: QuoteInput, opts: { actorRoleKey?: string; welcomePercent?: number } = {}) {
  if (input.discountPercent > 0 && input.couponCode?.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Use a coupon or a discount, not both.', { fields: { couponCode: 'Remove the discount to use a coupon' } });
  }
  const tx = db();
  const plan = await tx.plan.findUnique({ where: { key: input.planKey }, include: { modules: true } });
  if (!plan || plan.key === 'free') throw new AppError('VALIDATION_FAILED', 'Choose a paid plan.', { fields: { planKey: 'Choose a paid plan' } });
  const planPrice = await activePrice('plan', plan.key, input.cycle);
  if (!planPrice) throw new AppError('VALIDATION_FAILED', `${plan.name} is not sold ${input.cycle}.`, { fields: { cycle: 'Not available for this plan' } });

  const raw: Omit<OrderItem, 'discountPaise' | 'taxablePaise' | 'cgstPaise' | 'sgstPaise' | 'igstPaise' | 'totalPaise'>[] = [
    { itemType: 'plan', itemRef: plan.key, priceId: planPrice.id, description: `${plan.name} plan (${input.cycle})`, quantity: 1, unitPaise: Number(planPrice.amountPaise), amountPaise: Number(planPrice.amountPaise) },
  ];
  const inPlan = new Set(plan.modules.map((m) => m.moduleKey));
  for (const key of [...new Set(input.addOns)].filter((k) => !inPlan.has(k))) {
    const price = await activePrice('addon_module', key, input.cycle);
    const module = await tx.module.findUnique({ where: { key } });
    if (!price || !module) throw new AppError('VALIDATION_FAILED', `No ${input.cycle} price for the ${key} add-on.`, { fields: { addOns: key } });
    raw.push({ itemType: 'addon_module', itemRef: key, priceId: price.id, description: `${module.name} add-on (${input.cycle})`, quantity: 1, unitPaise: Number(price.amountPaise), amountPaise: Number(price.amountPaise) });
  }
  if (input.extraUsers > 0) {
    const price = await activePrice('extra_user', 'user', input.cycle);
    if (!price) throw new AppError('VALIDATION_FAILED', 'Extra users are not priced for this cycle.', { fields: { extraUsers: 'Not available' } });
    raw.push({ itemType: 'extra_user', itemRef: 'user', priceId: price.id, description: `Extra users (${input.cycle})`, quantity: input.extraUsers, unitPaise: Number(price.amountPaise), amountPaise: Number(price.amountPaise) * input.extraUsers });
  }
  const listPaise = raw.reduce((a, r) => a + r.amountPaise, 0);

  const welcome = !input.discountPercent && !input.couponCode?.trim() && opts.welcomePercent ? opts.welcomePercent : 0;
  const discountBp = Math.round(input.discountPercent * 100);
  if (discountBp < 0 || discountBp > 10_000) throw new AppError('VALIDATION_FAILED', 'Discount must be between 0 and 100%.', { fields: { discountPercent: '0–100' } });
  // The welcome discount is AHEAD's standard offer, so it never needs approval
  const salesDiscount = Math.round((listPaise * (discountBp || Math.round(welcome * 100))) / 10_000);

  let couponDiscount = 0;
  let couponCode: string | null = null;
  if (input.couponCode) {
    couponCode = input.couponCode.trim().toUpperCase();
    const c = await tx.coupon.findUnique({ where: { code: couponCode } });
    const now = new Date();
    const valid = c && (!c.validFrom || c.validFrom <= now) && (!c.validTo || c.validTo > now) && (c.maxRedemptions === null || c.redeemed < c.maxRedemptions) && (c.appliesTo === 'all' || c.appliesTo === plan.key);
    if (!c || !valid) throw new AppError('VALIDATION_FAILED', 'This coupon is not valid for this order.', { fields: { couponCode: 'Not valid' } });
    const after = listPaise - salesDiscount;
    couponDiscount = c.type === 'percent' ? Math.round((after * c.value) / 100) : Math.min(c.value, after);
  }
  const discountPaise = salesDiscount + couponDiscount;

  const s = await seller();
  const intraState = input.billTo.stateCode === s.stateCode;
  const shares = allocate(raw.map((r) => r.amountPaise), discountPaise);
  const doc = computeDocument(raw.map((r, i) => ({ quantity: 1, unitPricePaise: r.amountPaise, discountPaise: shares[i], gstRateBp: s.gstRateBp })), intraState);
  const items: OrderItem[] = raw.map((r, i) => ({
    ...r,
    discountPaise: shares[i],
    taxablePaise: Number(doc.lines[i].taxablePaise),
    cgstPaise: Number(doc.lines[i].cgstPaise),
    sgstPaise: Number(doc.lines[i].sgstPaise),
    igstPaise: Number(doc.lines[i].igstPaise),
    totalPaise: Number(doc.lines[i].totalPaise),
  }));

  const limits = await getSetting('sales.discount_limits');
  const limit = opts.actorRoleKey === 'super_admin' ? 100 : (limits[opts.actorRoleKey ?? ''] ?? 0);
  return {
    plan: { id: plan.id, key: plan.key, name: plan.name },
    cycle: input.cycle,
    items,
    listPaise,
    discountBp: discountBp || Math.round(welcome * 100),
    welcomePercent: welcome,
    salesDiscountPaise: salesDiscount,
    couponCode,
    couponDiscountPaise: couponDiscount,
    discountPaise,
    taxablePaise: Number(doc.totals.taxablePaise),
    cgstPaise: Number(doc.totals.cgstPaise),
    sgstPaise: Number(doc.totals.sgstPaise),
    igstPaise: Number(doc.totals.igstPaise),
    totalPaise: Number(doc.totals.totalPaise),
    gstRateBp: s.gstRateBp,
    intraState,
    discountLimitPercent: limit,
    needsApproval: discountBp > limit * 100,
  };
}

export type Quote = Awaited<ReturnType<typeof quote>>;

/** Store a priced order. Platform transaction. */
export async function saveOrder(q: Quote, o: { tenantId: string; kind: 'fresh' | 'renewal'; billTo: QuoteInput['billTo']; createdBy: string; expiresAt: Date }) {
  return db().platformOrder.create({
    data: {
      tenantId: o.tenantId,
      kind: o.kind,
      status: q.needsApproval ? 'pending_approval' : 'awaiting_payment',
      planId: q.plan.id,
      cycle: q.cycle,
      items: q.items as unknown as Prisma.InputJsonValue,
      listPaise: BigInt(q.listPaise),
      discountBp: q.discountBp,
      couponCode: q.couponCode,
      discountPaise: BigInt(q.discountPaise),
      taxablePaise: BigInt(q.taxablePaise),
      cgstPaise: BigInt(q.cgstPaise),
      sgstPaise: BigInt(q.sgstPaise),
      igstPaise: BigInt(q.igstPaise),
      totalPaise: BigInt(q.totalPaise),
      billTo: o.billTo,
      createdBy: o.createdBy,
      expiresAt: o.expiresAt,
    },
  });
}

export interface NewClientInput {
  business: { name: string; industryKey: string; gstin?: string | null; stateCode: string; address?: string | null };
  owner: { name: string; email: string; mobile: string };
  /** Console v3: start on the free trial, or on a paid plan the owner pays for after signing in */
  start: 'trial' | 'paid';
  order?: Omit<QuoteInput, 'billTo'>;
  /** Blueprint Phase B: continue set-up in the onboarding wizard; the login link goes out at hand-over */
  setup?: boolean;
}

async function roleKeyOf(ctx: ConsoleCtx) {
  return (await db().role.findUniqueOrThrow({ where: { id: ctx.roleId }, select: { key: true } })).key;
}

/** Who "Onboarded by" names for a client added in the Console (set automatically, never chosen). */
export function acquirerType(roleKey: string): 'vendor' | 'sales_user' {
  return roleKey === 'vendor' ? 'vendor' : 'sales_user';
}

/**
 * Console v3: a client added by Admin, Staff, Sales or a vendor. The owner gets a login link
 * (SMS + email) and sets their own password; a paid client pays from inside the workspace.
 */
export async function createClient(ctx: ConsoleCtx, input: NewClientInput) {
  const tx = db();
  const actorRole = await roleKeyOf(ctx);
  const billTo = { name: input.business.name, gstin: input.business.gstin?.toUpperCase() || null, stateCode: input.business.stateCode, address: input.business.address || null };
  if (input.start === 'paid' && !input.order) throw new AppError('VALIDATION_FAILED', 'Choose a plan.', { fields: { 'order.planKey': 'Choose a plan' } });
  const q = input.start === 'paid' ? await quote({ ...input.order!, billTo }, { actorRoleKey: actorRole }) : null;

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
    gstin: billTo.gstin ?? undefined,
    billingStateCode: billTo.stateCode,
    acquisition: { byType: acquirerType(actorRole), byUserId: ctx.userId, method: 'manual', couponCode: q?.couponCode ?? undefined },
    paidOnboarding: q ? { planId: q.plan.id, cycle: q.cycle } : undefined,
  });

  let order: { id: string; status: string } | null = null;
  if (q) {
    const cancelDays = await getSetting('onboarding.unpaid_cancel_days');
    order = await saveOrder(q, { tenantId: created.tenant.id, kind: 'fresh', billTo, createdBy: ctx.userId, expiresAt: new Date(Date.now() + cancelDays * DAY) });
  }
  if (input.setup) {
    await startHandover(created.tenant.id, ctx.userId);
    await audit({ tenantId: null, action: 'console.client_created', entity: 'tenant', entityId: created.tenant.id, after: { start: input.start, orderId: order?.id, plan: q?.plan.key, setup: true } });
    return { tenantId: created.tenant.id, orderId: order?.id ?? null, status: order?.status ?? 'trialing', totalPaise: q?.totalPaise ?? 0, loginLink: null, owner: { name: created.user.name, mobile: created.user.mobile, email: created.user.email } };
  }
  const loginLink = await sendAccessLink({
    kind: 'client_owner',
    userId: created.user.id,
    tenantId: created.tenant.id,
    createdBy: ctx.userId,
    extra: q ? `After you sign in, pay ₹${(q.totalPaise / 100).toFixed(2)} to start your ${q.plan.name} plan.` : 'Your free trial starts today.',
  });
  await audit({ tenantId: null, action: 'console.client_created', entity: 'tenant', entityId: created.tenant.id, after: { start: input.start, orderId: order?.id, plan: q?.plan.key, cycle: q?.cycle, totalPaise: q?.totalPaise, discountBp: q?.discountBp, needsApproval: q?.needsApproval } });
  return {
    tenantId: created.tenant.id,
    orderId: order?.id ?? null,
    status: order?.status ?? 'trialing',
    totalPaise: q?.totalPaise ?? 0,
    loginLink,
    owner: { name: created.user.name, mobile: created.user.mobile, email: created.user.email },
  };
}

/** A client that signed up with a referral link or code gets the welcome discount on its first payment. */
export async function welcomePercentFor(tenantId: string) {
  const tx = db();
  const acq = await tx.tenantAcquisition.findUnique({ where: { tenantId }, select: { method: true } });
  if (!acq || (acq.method !== 'referral_link' && acq.method !== 'referral_code')) return 0;
  if (await tx.platformOrder.count({ where: { tenantId, status: 'paid' } })) return 0;
  return getSetting('referral.welcome_discount_percent');
}

/** Wireframe C3 "Convert to paid": an order for a client already on AHEAD (trial, Free or unpaid). */
export async function convertClient(ctx: ConsoleCtx, tenantId: string, order: Omit<QuoteInput, 'billTo'>) {
  const tx = db();
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, legalName: true, gstin: true, billingStateCode: true, status: true } });
  if (!['trialing', 'free', 'past_due', 'incomplete'].includes(tenant.status)) throw new AppError('INVALID_TRANSITION', 'Only a client on trial, on the Free plan or with a failed payment can be converted.');
  const open = await tx.platformOrder.findFirst({ where: { tenantId, status: { in: ['pending_approval', 'awaiting_payment'] } }, select: { id: true } });
  if (open) throw new AppError('CONFLICT', 'This client already has an order waiting — send that payment link or cancel it first.', { orderId: open.id });
  if (!tenant.billingStateCode) throw new AppError('VALIDATION_FAILED', "Add the client's GST state first (the owner sets it in Settings › Business).");
  const billTo = { name: tenant.legalName ?? tenant.name, gstin: tenant.gstin, stateCode: tenant.billingStateCode, address: null };
  const q = await quote({ ...order, billTo }, { actorRoleKey: await roleKeyOf(ctx), welcomePercent: await welcomePercentFor(tenantId) });
  const cancelDays = await getSetting('onboarding.unpaid_cancel_days');
  const saved = await saveOrder(q, { tenantId, kind: 'fresh', billTo, createdBy: ctx.userId, expiresAt: new Date(Date.now() + cancelDays * DAY) });
  await audit({ tenantId: null, action: 'console.client_converted', entity: 'tenant', entityId: tenantId, after: { orderId: saved.id, plan: q.plan.key, cycle: q.cycle, totalPaise: q.totalPaise, discountBp: q.discountBp, needsApproval: q.needsApproval } });
  return { orderId: saved.id, status: saved.status, totalPaise: q.totalPaise };
}

async function loadOrder(id: string) {
  const order = await db().platformOrder.findUnique({ where: { id } });
  if (!order) throw notFound('Order');
  return order;
}

export async function approveOrder(ctx: ConsoleCtx, id: string) {
  const order = await loadOrder(id);
  if (order.status !== 'pending_approval') throw new AppError('INVALID_TRANSITION', 'Only an order waiting for approval can be approved.');
  if (order.createdBy === ctx.userId) throw new AppError('PERMISSION_DENIED', 'Someone else must approve a discount you gave.');
  await db().platformOrder.update({ where: { id }, data: { status: 'awaiting_payment', approvedBy: ctx.userId, approvedAt: new Date() } });
  await audit({ tenantId: null, action: 'console.order_approved', entity: 'platform_order', entityId: id, after: { discountBp: order.discountBp } });
}

export async function cancelOrder(id: string, reason: string) {
  const order = await loadOrder(id);
  if (order.status === 'paid' || order.status === 'cancelled') throw new AppError('INVALID_TRANSITION', `This order is already ${order.status}.`);
  await db().platformOrder.update({ where: { id }, data: { status: 'cancelled', cancelledReason: reason } });
  await audit({ tenantId: null, action: 'console.order_cancelled', entity: 'platform_order', entityId: id, after: { reason } });
}

/** AHEAD's own invoice number, allocated only when paid: AHD/26-27/000123 (16 characters). */
async function allocateInvoiceNumber(at: Date) {
  const fy = financialYear(at, 4);
  const tx = db();
  await tx.$executeRaw`INSERT INTO platform_sequences (doc_type, fy, next_no) VALUES ('invoice', ${fy}, 1) ON CONFLICT DO NOTHING`;
  const rows = await tx.$queryRaw<{ allocated: number }[]>`
    UPDATE platform_sequences SET next_no = next_no + 1 WHERE doc_type = 'invoice' AND fy = ${fy}
    RETURNING (next_no - 1)::int AS allocated`;
  return { fy, number: `AHD/${fy}/${String(rows[0].allocated).padStart(6, '0')}` };
}

export interface PaymentInput {
  method: PlatformPaymentMethod;
  amountPaise: number;
  reference?: string | null;
  gatewayPaymentId?: string | null;
  receivedAt: Date;
  recordedBy: string | null;
}

/**
 * The one place money turns into access: records the payment, issues the GST invoice and
 * activates the subscription. Used by Finance (offline) and by the gateway webhook (Step 4b).
 */
export async function capturePayment(orderId: string, p: PaymentInput) {
  const tx = db();
  const order = await loadOrder(orderId);
  if (order.status === 'pending_approval') throw new AppError('INVALID_TRANSITION', 'The discount on this order still needs approval.');
  if (order.status !== 'awaiting_payment') throw new AppError('INVALID_TRANSITION', `This order is ${order.status}.`);
  if (BigInt(p.amountPaise) !== order.totalPaise) throw new AppError('VALIDATION_FAILED', `The amount must be the full order total (₹${(Number(order.totalPaise) / 100).toFixed(2)}).`, { fields: { amountPaise: 'Must equal the order total' } });

  const payment = await tx.platformPayment.create({
    data: { orderId, tenantId: order.tenantId, method: p.method, amountPaise: BigInt(p.amountPaise), reference: p.reference, gatewayPaymentId: p.gatewayPaymentId, receivedAt: p.receivedAt, recordedBy: p.recordedBy },
  });
  const now = new Date();
  await tx.platformOrder.update({ where: { id: orderId }, data: { status: 'paid', paidAt: now } });

  const s = await getSetting('ahead.billing');
  const items = order.items as unknown as OrderItem[];
  const { fy, number } = await allocateInvoiceNumber(now);
  const invoice = await tx.platformInvoice.create({
    data: {
      number, fy, tenantId: order.tenantId, orderId,
      seller: s, billTo: order.billTo as Prisma.InputJsonValue,
      lines: items.map((i) => ({ description: i.description, sac: s.sac, quantity: i.quantity, unitPaise: i.unitPaise, discountPaise: i.discountPaise, taxablePaise: i.taxablePaise, cgstPaise: i.cgstPaise, sgstPaise: i.sgstPaise, igstPaise: i.igstPaise, totalPaise: i.totalPaise })),
      taxablePaise: order.taxablePaise, cgstPaise: order.cgstPaise, sgstPaise: order.sgstPaise, igstPaise: order.igstPaise, totalPaise: order.totalPaise,
      issuedAt: now,
    },
  });

  // Subscription: the order's cycle and add-ons, then the state machine opens the modules
  const sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId: order.tenantId } });
  if (order.kind === 'upgrade') {
    // Pro-rated upgrade (Phase D): the new plan starts now, the period and extras stay as they are
    await tx.subscription.update({ where: { id: sub.id }, data: { planId: order.planId, version: { increment: 1 } } });
    await persistEntitlements(order.tenantId);
    await audit({ tenantId: null, action: 'console.payment_recorded', entity: 'platform_order', entityId: orderId, after: { paymentId: payment.id, method: p.method, amountPaise: p.amountPaise, reference: p.reference, invoice: number, upgrade: true } });
    return { payment, invoice };
  }
  await tx.subscription.update({ where: { id: sub.id }, data: { cycle: order.cycle } });
  await tx.subscriptionItem.deleteMany({ where: { subscriptionId: sub.id } });
  const extras = items.filter((i) => i.itemType !== 'plan');
  if (extras.length) {
    await tx.subscriptionItem.createMany({ data: extras.map((i) => ({ subscriptionId: sub.id, priceId: i.priceId, quantity: i.quantity, unitAmountPaise: BigInt(i.unitPaise), startsAt: now })) });
  }
  // A renewal paid on time extends from the old period end; anything else starts a new period today
  await transition(order.tenantId, sub.status === 'active' ? 'renewal_succeeded' : 'payment_captured', { planId: order.planId, now });
  // A plan change scheduled for this renewal is now in effect
  if (order.kind === 'renewal') await tx.scheduledChange.updateMany({ where: { subscriptionId: sub.id, appliedAt: null }, data: { appliedAt: now } });
  if (order.couponCode) await tx.coupon.update({ where: { code: order.couponCode }, data: { redeemed: { increment: 1 } } });

  await audit({ tenantId: null, action: 'console.payment_recorded', entity: 'platform_order', entityId: orderId, after: { paymentId: payment.id, method: p.method, amountPaise: p.amountPaise, reference: p.reference, invoice: number } });
  return { payment, invoice };
}

// ── Change plan for a paying business (blueprint Phase D) ──

export interface PlanChangeInput {
  planKey: string;
  cycle: 'monthly' | 'yearly';
}

/** Pure: the price difference for the days left in the period, rounded to the paisa. */
export function proRate(oldPaise: number, newPaise: number, periodStart: Date, periodEnd: Date, now: Date) {
  const total = periodEnd.getTime() - periodStart.getTime();
  const left = Math.max(0, periodEnd.getTime() - now.getTime());
  if (total <= 0 || newPaise <= oldPaise) return { amountPaise: 0, daysLeft: Math.ceil(left / DAY) };
  return { amountPaise: Math.round(((newPaise - oldPaise) * left) / total), daysLeft: Math.ceil(left / DAY) };
}

/**
 * What changing plan means for this business: an upgrade on the same cycle is paid now for the
 * days left (the plan switches when paid, the renewal date stays); anything else (a cheaper
 * plan, or another cycle) takes effect at the renewal date and nothing is paid now.
 */
export async function previewPlanChange(tenantId: string, input: PlanChangeInput, now = new Date()) {
  const tx = db();
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, legalName: true, gstin: true, billingStateCode: true, billingOwner: true } });
  if (tenant.billingOwner !== 'self') throw new AppError('INVALID_TRANSITION', "A partner's business changes plan from the partner portal.");
  const sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId } });
  if (sub.status !== 'active' || !sub.currentPeriodEnd || !sub.currentPeriodStart) throw new AppError('INVALID_TRANSITION', 'Only a paying business changes plan here. Use Convert to paid for trials and Free.');
  const [current, next] = await Promise.all([
    tx.plan.findUniqueOrThrow({ where: { id: sub.planId }, select: { id: true, key: true, name: true } }),
    tx.plan.findUnique({ where: { key: input.planKey }, select: { id: true, key: true, name: true } }),
  ]);
  if (!next || next.key === 'free') throw new AppError('VALIDATION_FAILED', 'Choose a paid plan.', { fields: { planKey: 'Choose a paid plan' } });
  if (next.id === current.id && input.cycle === sub.cycle) throw new AppError('VALIDATION_FAILED', "That's the plan this business is on.", { fields: { planKey: 'Same plan' } });
  const newPrice = await activePrice('plan', next.key, input.cycle);
  if (!newPrice) throw new AppError('VALIDATION_FAILED', `${next.name} is not sold ${input.cycle}.`, { fields: { cycle: 'Not sold on this cycle' } });
  // What they actually paid for the plan this period (the last paid order's plan line), else today's price
  const lastPaid = await tx.platformOrder.findFirst({ where: { tenantId, status: 'paid' }, orderBy: { paidAt: 'desc' } });
  const paidLine = (lastPaid?.items as unknown as OrderItem[] | undefined)?.find((i) => i.itemType === 'plan');
  const oldPrice = paidLine && lastPaid?.planId === current.id && lastPaid.kind !== 'upgrade'
    ? paidLine.unitPaise - paidLine.discountPaise
    : Number((await activePrice('plan', current.key, sub.cycle as 'monthly' | 'yearly'))?.amountPaise ?? 0);
  const upgrade = input.cycle === sub.cycle && Number(newPrice.amountPaise) > oldPrice;
  if (!upgrade) {
    return { kind: 'scheduled' as const, from: current, to: next, cycle: input.cycle, effectiveAt: sub.currentPeriodEnd, renewalPaise: Number(newPrice.amountPaise) };
  }
  const p = proRate(oldPrice, Number(newPrice.amountPaise), sub.currentPeriodStart, sub.currentPeriodEnd, now);
  const s = await seller();
  const billTo = { name: tenant.legalName ?? tenant.name, gstin: tenant.gstin, stateCode: tenant.billingStateCode ?? s.stateCode, address: null };
  const doc = computeDocument([{ quantity: 1, unitPricePaise: p.amountPaise, discountPaise: 0, gstRateBp: s.gstRateBp }], billTo.stateCode === s.stateCode);
  const line = doc.lines[0];
  const item: OrderItem = {
    itemType: 'plan', itemRef: next.key, priceId: newPrice.id, description: `${current.name} to ${next.name}, ${p.daysLeft} days left in this period (pro-rated)`,
    quantity: 1, unitPaise: p.amountPaise, amountPaise: p.amountPaise, discountPaise: 0,
    taxablePaise: Number(line.taxablePaise), cgstPaise: Number(line.cgstPaise), sgstPaise: Number(line.sgstPaise), igstPaise: Number(line.igstPaise), totalPaise: Number(line.totalPaise),
  };
  return {
    kind: 'upgrade' as const, from: current, to: next, cycle: input.cycle, daysLeft: p.daysLeft, renewsAt: sub.currentPeriodEnd, billTo, item,
    totalPaise: Number(doc.totals.totalPaise), taxablePaise: Number(doc.totals.taxablePaise), gstPaise: Number(doc.totals.cgstPaise) + Number(doc.totals.sgstPaise) + Number(doc.totals.igstPaise),
  };
}

export async function changePlan(ctx: ConsoleCtx, tenantId: string, input: PlanChangeInput) {
  const tx = db();
  const preview = await previewPlanChange(tenantId, input);
  const sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId } });
  const open = await tx.platformOrder.findFirst({ where: { tenantId, status: { in: ['pending_approval', 'awaiting_payment'] }, kind: { not: 'renewal' } }, select: { id: true } });
  if (open) throw new AppError('CONFLICT', 'This business already has an order waiting. Send that payment link or cancel it first.', { orderId: open.id });

  if (preview.kind === 'scheduled') {
    // One pending change at a time; a renewal order already made at the old plan is re-made by the next renewal run
    await tx.scheduledChange.deleteMany({ where: { subscriptionId: sub.id, appliedAt: null } });
    await tx.scheduledChange.create({ data: { subscriptionId: sub.id, change: { planKey: preview.to.key, cycle: preview.cycle }, effectiveAt: preview.effectiveAt } });
    await tx.platformOrder.updateMany({ where: { tenantId, kind: 'renewal', status: 'awaiting_payment' }, data: { status: 'cancelled', cancelledReason: 'Plan changed before renewal' } });
    await audit({ tenantId: null, action: 'console.plan_change_scheduled', entity: 'tenant', entityId: tenantId, after: { from: preview.from.key, to: preview.to.key, cycle: preview.cycle, effectiveAt: preview.effectiveAt } });
    return { kind: 'scheduled' as const, effectiveAt: preview.effectiveAt, to: preview.to.name };
  }

  const cancelDays = await getSetting('onboarding.unpaid_cancel_days');
  const order = await tx.platformOrder.create({
    data: {
      tenantId, kind: 'upgrade', status: 'awaiting_payment', planId: preview.to.id, cycle: preview.cycle,
      items: [preview.item] as unknown as Prisma.InputJsonValue,
      listPaise: BigInt(preview.item.amountPaise), discountBp: 0, discountPaise: BigInt(0),
      taxablePaise: BigInt(preview.taxablePaise), cgstPaise: BigInt(preview.item.cgstPaise), sgstPaise: BigInt(preview.item.sgstPaise), igstPaise: BigInt(preview.item.igstPaise), totalPaise: BigInt(preview.totalPaise),
      billTo: preview.billTo, createdBy: ctx.userId, expiresAt: new Date(Math.min(Date.now() + cancelDays * DAY, preview.renewsAt.getTime())),
    },
  });
  await audit({ tenantId: null, action: 'console.plan_upgrade_ordered', entity: 'platform_order', entityId: order.id, after: { from: preview.from.key, to: preview.to.key, totalPaise: preview.totalPaise, daysLeft: preview.daysLeft } });
  return { kind: 'upgrade' as const, orderId: order.id, totalPaise: preview.totalPaise };
}

export async function cancelScheduledChange(tenantId: string) {
  const sub = await db().subscription.findUniqueOrThrow({ where: { tenantId } });
  const n = await db().scheduledChange.deleteMany({ where: { subscriptionId: sub.id, appliedAt: null } });
  if (n.count) await audit({ tenantId: null, action: 'console.plan_change_cancelled', entity: 'tenant', entityId: tenantId });
  return { cancelled: n.count };
}

export async function pendingChange(tenantId: string) {
  const sub = await db().subscription.findUnique({ where: { tenantId }, select: { id: true } });
  if (!sub) return null;
  const c = await db().scheduledChange.findFirst({ where: { subscriptionId: sub.id, appliedAt: null }, orderBy: { effectiveAt: 'asc' } });
  if (!c) return null;
  const change = c.change as { planKey: string; cycle: 'monthly' | 'yearly' };
  const plan = await db().plan.findUnique({ where: { key: change.planKey }, select: { name: true } });
  return { planKey: change.planKey, planName: plan?.name ?? change.planKey, cycle: change.cycle, effectiveAt: c.effectiveAt };
}
