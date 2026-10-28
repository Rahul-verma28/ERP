import type { PlatformPaymentMethod, Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { normaliseEmail, normaliseMobile } from '../../kernel/crypto';
import { computeDocument, financialYear } from '../../kernel/gst';
import { audit } from '../audit/service';
import { sendMessage } from '../notifications/service';
import { getSetting } from '../settings/service';
import { createTenant } from '../tenancy/createTenant';
import { transition } from '../subscription/stateMachine';

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
  if (!/^\d{2}$/.test(s.stateCode)) throw new AppError('VALIDATION_FAILED', "Prices can't be worked out yet: AHEAD's billing details aren't filled in. A Super Admin adds them in Settings › Rules & billing details.");
  return s;
}

async function activePrice(itemType: 'plan' | 'addon_module' | 'extra_user', itemRef: string, cycle: 'monthly' | 'yearly') {
  return db().price.findFirst({ where: { itemType, itemRef, cycle, activeTo: null } });
}

/** Price an order. Nothing is written. */
export async function quote(input: QuoteInput, opts: { actorRoleKey?: string } = {}) {
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

  const discountBp = Math.round(input.discountPercent * 100);
  if (discountBp < 0 || discountBp > 10_000) throw new AppError('VALIDATION_FAILED', 'Discount must be between 0 and 100%.', { fields: { discountPercent: '0–100' } });
  const salesDiscount = Math.round((listPaise * discountBp) / 10_000);

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
    discountBp,
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
  order: Omit<QuoteInput, 'billTo'>;
}

async function roleKeyOf(ctx: ConsoleCtx) {
  return (await db().role.findUniqueOrThrow({ where: { id: ctx.roleId }, select: { key: true } })).key;
}

/** design v2 §4(B): a client created by sales or a vendor — no trial, modules open after payment. */
export async function createPaidClient(ctx: ConsoleCtx, input: NewClientInput) {
  const tx = db();
  const actorRole = await roleKeyOf(ctx);
  const billTo = { name: input.business.name, gstin: input.business.gstin?.toUpperCase() || null, stateCode: input.business.stateCode, address: input.business.address || null };
  const q = await quote({ ...input.order, billTo }, { actorRoleKey: actorRole });

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
    acquisition: { byType: actorRole === 'vendor' ? 'vendor' : 'sales_user', byUserId: ctx.userId, method: 'manual', couponCode: q.couponCode ?? undefined },
    paidOnboarding: { planId: q.plan.id, cycle: q.cycle },
  });

  const cancelDays = await getSetting('onboarding.unpaid_cancel_days');
  const order = await saveOrder(q, { tenantId: created.tenant.id, kind: 'fresh', billTo, createdBy: ctx.userId, expiresAt: new Date(Date.now() + cancelDays * DAY) });

  await sendMessage({
    channel: 'email',
    to: email,
    template: 'onboarding.paid_client',
    subject: `Your AHEAD workspace for ${billTo.name} is ready`,
    text: `Hi ${input.owner.name}, your workspace is set up. Sign in at /login with your mobile ${mobile} (OTP). Modules open as soon as the payment of ₹${(q.totalPaise / 100).toFixed(2)} is received.`,
  });
  await audit({ tenantId: null, action: 'console.client_created', entity: 'tenant', entityId: created.tenant.id, after: { orderId: order.id, plan: q.plan.key, cycle: q.cycle, totalPaise: q.totalPaise, discountBp: q.discountBp, needsApproval: q.needsApproval } });
  return { tenantId: created.tenant.id, orderId: order.id, status: order.status, totalPaise: q.totalPaise };
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
  const q = await quote({ ...order, billTo }, { actorRoleKey: await roleKeyOf(ctx) });
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
  await tx.subscription.update({ where: { id: sub.id }, data: { cycle: order.cycle } });
  await tx.subscriptionItem.deleteMany({ where: { subscriptionId: sub.id } });
  const extras = items.filter((i) => i.itemType !== 'plan');
  if (extras.length) {
    await tx.subscriptionItem.createMany({ data: extras.map((i) => ({ subscriptionId: sub.id, priceId: i.priceId, quantity: i.quantity, unitAmountPaise: BigInt(i.unitPaise), startsAt: now })) });
  }
  // A renewal paid on time extends from the old period end; anything else starts a new period today
  await transition(order.tenantId, sub.status === 'active' ? 'renewal_succeeded' : 'payment_captured', { planId: order.planId, now });
  if (order.couponCode) await tx.coupon.update({ where: { code: order.couponCode }, data: { redeemed: { increment: 1 } } });

  await audit({ tenantId: null, action: 'console.payment_recorded', entity: 'platform_order', entityId: orderId, after: { paymentId: payment.id, method: p.method, amountPaise: p.amountPaise, reference: p.reference, invoice: number } });
  return { payment, invoice };
}
