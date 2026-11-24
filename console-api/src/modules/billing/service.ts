import type { Order, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Tx } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { audit } from '../../kernel/audit';
import { sendEmail } from '../../kernel/mail';
import { getSetting } from '../system/settings';
import { issueLicence } from '../licences/service';
import { findScoped, type Actor } from '../businesses/service';
import { financialYear, nextPeriod, quote, rupees, type BillTo, type Seller } from './money';
import { gateway, webhookGateway } from './gateway';
import { markBillPaid } from '../partners/service';

// AHEAD's bills to the businesses it serves (or to their partner): orders, payment links,
// payments (online or recorded by the team), GST invoices and credit notes. A paid order puts the
// subscription on its plan and issues the licence, all in one transaction.

const DAY = 86_400_000;

export const OrderInput = z
  .object({
    planKey: z.string().min(1, 'Choose a plan'),
    cycle: z.enum(['monthly', 'yearly']),
    extraUsers: z.number().int().min(0).max(500).default(0),
    /** One discount per order: a coupon, or a percent (within the role's limit, or Admin approves) */
    couponCode: z.string().trim().toUpperCase().max(20).nullish(),
    discountPct: z.number().int().min(1).max(100).nullish(),
  })
  .refine((o) => !(o.couponCode && o.discountPct), { message: 'Use a coupon or a discount, not both', path: ['discountPct'] });
export type OrderInput = z.infer<typeof OrderInput>;

async function billToFor(businessId: string, tx: Tx | typeof prisma = prisma): Promise<BillTo> {
  const b = await tx.business.findUniqueOrThrow({ where: { id: businessId }, include: { partner: true } });
  // A partner's client: AHEAD bills the partner, never the client
  if (b.partner) return { kind: 'partner', name: b.partner.name, gstin: b.partner.gstin, stateCode: b.partner.gstin?.slice(0, 2) ?? null, email: b.partner.email, mobile: b.partner.mobile };
  return { kind: 'business', name: b.legalName || b.name, gstin: b.gstin, stateCode: b.stateCode ?? b.gstin?.slice(0, 2) ?? null, email: b.ownerEmail, mobile: b.ownerMobile };
}

async function pricing(tx: Tx | typeof prisma = prisma) {
  const [seller, monthly, yearly] = await Promise.all([getSetting<Seller>('seller', tx), getSetting<number>('extra_user.monthly_paise', tx), getSetting<number>('extra_user.yearly_paise', tx)]);
  if (!seller) throw new AppError('INTERNAL', 'AHEAD’s invoice details are not set (Settings › Seller).');
  return { seller, extraUserPaise: { monthly: monthly ?? 0, yearly: yearly ?? 0 } };
}

/** Which discount applies and whether Admin must approve it */
async function discountFor(a: Actor, businessId: string, kind: string, input: OrderInput, planKey: string, tx: Tx | typeof prisma = prisma) {
  if (input.couponCode) {
    const c = await tx.coupon.findUnique({ where: { code: input.couponCode } });
    const bad = !c || !c.active ? 'This coupon doesn’t exist or is switched off' : c.validUntil && c.validUntil < new Date() ? 'This coupon has run out' : c.maxUses != null && c.used >= c.maxUses ? 'This coupon has been used up' : c.planKeys.length && !c.planKeys.includes(planKey) ? 'This coupon is not for this plan' : null;
    if (bad || !c) throw new AppError('VALIDATION_FAILED', bad ?? 'Unknown coupon', { fields: { couponCode: bad ?? 'Unknown coupon' } });
    return { discount: c.percentOff ? { percent: c.percentOff } : { amountPaise: c.amountOffPaise! }, couponCode: c.code, discountPct: c.percentOff, approval: false };
  }
  if (input.discountPct) {
    const limits = (await getSetting<Record<string, number>>('discount.limits', tx)) ?? {};
    return { discount: { percent: input.discountPct }, couponCode: null, discountPct: input.discountPct, approval: input.discountPct > (limits[a.role] ?? 0) };
  }
  // A business that came with a referral code gets the welcome discount on its first payment
  const b = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { referralCode: true } });
  if (kind === 'new' && b.referralCode) {
    const paidBefore = await tx.order.count({ where: { businessId, status: 'paid' } });
    const welcome = (await getSetting<number>('referral.welcome_discount_percent', tx)) ?? 0;
    if (!paidBefore && welcome > 0) return { discount: { percent: welcome }, couponCode: null, discountPct: welcome, approval: false };
  }
  return { discount: null, couponCode: null, discountPct: null, approval: false };
}

/** What an order would cost, before it is made */
export async function previewOrder(a: Actor, businessId: string, input: OrderInput) {
  await findScoped(a, businessId);
  const plan = await sellablePlan(input.planKey);
  const kind = await kindOf(businessId, input.planKey);
  const [{ seller, extraUserPaise }, billTo, d] = await Promise.all([pricing(), billToFor(businessId), discountFor(a, businessId, kind, input, plan.key)]);
  return { kind, billTo, needsApproval: d.approval, ...quote({ plan, cycle: input.cycle, extraUsers: input.extraUsers, extraUserPaise, discount: d.discount, seller, billTo }) };
}

async function sellablePlan(key: string, tx: Tx | typeof prisma = prisma) {
  const plan = await tx.plan.findUnique({ where: { key } });
  if (!plan || !plan.active || plan.isFree) throw new AppError('VALIDATION_FAILED', 'Choose a paid plan.', { fields: { planKey: 'Choose a paid plan' } });
  if (plan.monthlyPaise == null || plan.yearlyPaise == null) throw new AppError('VALIDATION_FAILED', `${plan.name} is priced by quote. Make the order with the agreed price as a discount.`, { fields: { planKey: 'Priced by quote' } });
  return plan;
}

/** new: the first paid plan (or after trial/Free/closed); renewal: the same plan again; change: another plan */
async function kindOf(businessId: string, planKey: string, tx: Tx | typeof prisma = prisma) {
  const sub = await tx.subscription.findUniqueOrThrow({ where: { businessId } });
  if (!['active', 'past_due'].includes(sub.status)) return 'new';
  return sub.planKey === planKey ? 'renewal' : 'change';
}

export async function createOrder(a: Actor, businessId: string, input: OrderInput, opts: { kind?: 'renewal' } = {}) {
  const order = await prisma.$transaction(async (tx) => {
    await findScoped(a, businessId, tx);
    const plan = await sellablePlan(input.planKey, tx);
    const kind = opts.kind ?? (await kindOf(businessId, input.planKey, tx));
    const [{ seller, extraUserPaise }, billTo, d, payWithin] = await Promise.all([pricing(tx), billToFor(businessId, tx), discountFor(a, businessId, kind, input, plan.key, tx), getSetting<number>('orders.pay_within_days', tx)]);
    const q = quote({ plan, cycle: input.cycle, extraUsers: input.extraUsers, extraUserPaise, discount: d.discount, seller, billTo });
    // One open order per business: a new one replaces what was still waiting
    await tx.order.updateMany({ where: { businessId, status: { in: ['awaiting_payment', 'pending_approval'] } }, data: { status: 'cancelled', cancelReason: 'Replaced by a newer order' } });
    const o = await tx.order.create({
      data: {
        businessId, kind, status: d.approval ? 'pending_approval' : 'awaiting_payment', planKey: plan.key, cycle: input.cycle, extraUsers: input.extraUsers,
        lines: q.lines as unknown as Prisma.InputJsonValue, listPaise: q.listPaise, couponCode: d.couponCode, discountPct: d.discountPct, discountPaise: q.discountPaise,
        taxablePaise: q.taxablePaise, cgstPaise: q.cgstPaise, sgstPaise: q.sgstPaise, igstPaise: q.igstPaise, totalPaise: q.totalPaise,
        billTo: billTo as unknown as Prisma.InputJsonValue, createdById: a.id === 'system' ? null : a.id, expiresAt: new Date(Date.now() + (payWithin ?? 14) * DAY),
      },
    });
    await audit({ actorId: a.id === 'system' ? null : a.id, action: 'order.created', entity: 'order', entityId: o.id, after: { businessId, kind, plan: plan.key, cycle: input.cycle, total: q.totalPaise, discountPct: d.discountPct, coupon: d.couponCode } }, tx);
    return o;
  });
  // The link is made after the order is saved: a gateway that is down never loses the order
  if (order.status === 'awaiting_payment') await sendPaymentLink(order.id).catch((e) => console.error(`[billing] link for order ${order.id}:`, e instanceof Error ? e.message : e));
  return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
}

/** Make the gateway link (once) and email it to whoever pays. resend: email it again. */
export async function sendPaymentLink(orderId: string, opts: { resend?: boolean } = {}) {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { business: { select: { name: true } } } });
  if (o.status !== 'awaiting_payment') throw new AppError('INVALID_TRANSITION', o.status === 'pending_approval' ? 'The discount on this order still needs Admin approval.' : `This order is ${o.status.replace('_', ' ')}.`);
  const billTo = o.billTo as unknown as BillTo;
  let url = o.linkUrl;
  if (!url) {
    const link = await gateway().createLink({ orderId: o.id, amountPaise: o.totalPaise, description: `AHEAD ${o.kind === 'renewal' ? 'renewal' : 'plan'} for ${o.business.name}`, customer: { name: billTo.name, email: billTo.email, mobile: billTo.mobile }, expiresAt: o.expiresAt });
    await prisma.order.update({ where: { id: o.id }, data: { linkId: link.linkId, linkUrl: link.url } });
    url = link.url;
  } else if (!opts.resend && o.linkSentAt) {
    return { url, sent: false };
  }
  const until = o.expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  await sendEmail(billTo.email, `Pay ${rupees(o.totalPaise)} for AHEAD (${o.business.name})`, `Hi ${billTo.name},\n\nPlease pay ${rupees(o.totalPaise)} for ${o.business.name}'s AHEAD ${o.kind === 'renewal' ? 'renewal' : 'plan'}:\n\n${url}\n\nThe link works until ${until}. Your GST invoice is emailed as soon as the payment is received.\n\nAHEAD`);
  await prisma.order.update({ where: { id: o.id }, data: { linkSentAt: new Date() } });
  return { url, sent: true };
}

export async function approveOrder(a: Actor, orderId: string) {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (o.status !== 'pending_approval') throw new AppError('INVALID_TRANSITION', 'This order doesn’t need approval.');
  await prisma.order.update({ where: { id: orderId }, data: { status: 'awaiting_payment', approvedById: a.id, approvedAt: new Date() } });
  await audit({ actorId: a.id, action: 'order.approved', entity: 'order', entityId: orderId, after: { discountPct: o.discountPct } });
  return sendPaymentLink(orderId);
}

export async function cancelOrder(a: Actor, orderId: string, reason: string) {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  await findScoped(a, o.businessId);
  if (!['awaiting_payment', 'pending_approval'].includes(o.status)) throw new AppError('INVALID_TRANSITION', `This order is ${o.status.replace('_', ' ')}.`);
  await prisma.order.update({ where: { id: orderId }, data: { status: 'cancelled', cancelReason: reason } });
  await audit({ actorId: a.id, action: 'order.cancelled', entity: 'order', entityId: orderId, after: { reason } });
}

async function nextNumber(tx: Tx, docType: 'invoice' | 'credit_note', prefix: string, at: Date) {
  const fy = financialYear(at);
  const row = await tx.sequence.upsert({ where: { docType_fy: { docType, fy } }, create: { docType, fy, nextNo: 2 }, update: { nextNo: { increment: 1 } } });
  return { fy, number: `${prefix}/${fy}/${String(row.nextNo - 1).padStart(6, '0')}` };
}

/**
 * The money is in: record it, mark the order paid, issue the invoice, put the subscription on its
 * plan for the period and issue the licence. Idempotent per order (a paid order is left alone).
 */
export async function capturePayment(tx: Tx, order: Order, p: { method: string; amountPaise: number; reference?: string | null; gatewayPaymentId?: string | null; receivedAt: Date; recordedById?: string | null }) {
  if (order.status === 'paid') return null;
  if (p.amountPaise !== order.totalPaise) throw new AppError('VALIDATION_FAILED', `The payment (${rupees(p.amountPaise)}) is not the order total (${rupees(order.totalPaise)}).`, { fields: { amountPaise: 'Must equal the order total' } });
  const payment = await tx.payment.create({ data: { orderId: order.id, businessId: order.businessId, method: p.method, amountPaise: p.amountPaise, reference: p.reference ?? null, gatewayPaymentId: p.gatewayPaymentId ?? null, receivedAt: p.receivedAt, recordedById: p.recordedById ?? null } });
  await tx.order.update({ where: { id: order.id }, data: { status: 'paid', paidAt: p.receivedAt } });
  const { seller } = await pricing(tx);
  const { number, fy } = await nextNumber(tx, 'invoice', 'AHD', p.receivedAt);
  const invoice = await tx.invoice.create({
    data: {
      number, fy, businessId: order.businessId, orderId: order.id, seller: seller as unknown as Prisma.InputJsonValue, billTo: order.billTo as Prisma.InputJsonValue, lines: order.lines as Prisma.InputJsonValue,
      taxablePaise: order.taxablePaise, cgstPaise: order.cgstPaise, sgstPaise: order.sgstPaise, igstPaise: order.igstPaise, totalPaise: order.totalPaise, issuedAt: p.receivedAt,
    },
  });
  if (order.couponCode) await tx.coupon.update({ where: { code: order.couponCode }, data: { used: { increment: 1 } } });

  const sub = await tx.subscription.findUniqueOrThrow({ where: { businessId: order.businessId } });
  const cycle = order.cycle as 'monthly' | 'yearly';
  // A renewal continues the running period; a new plan starts today
  const period = nextPeriod(order.kind === 'renewal' && ['active', 'past_due'].includes(sub.status) ? sub.periodEnd : null, cycle, p.receivedAt);
  await tx.subscription.update({
    where: { businessId: order.businessId },
    data: { status: 'active', planKey: order.planKey, cycle, extraUsers: order.extraUsers, periodStart: period.start, periodEnd: period.end, trialEndsAt: null, graceEndsAt: null, cancelAtPeriodEnd: false, closedAt: null, purgeAt: null, version: { increment: 1 } },
  });
  await issueLicence(tx, order.businessId);
  await audit({ actorId: p.recordedById ?? null, action: 'order.paid', entity: 'order', entityId: order.id, after: { invoice: number, method: p.method, amount: p.amountPaise, periodEnd: period.end } }, tx);
  return { payment, invoice, periodEnd: period.end };
}

async function emailInvoice(invoiceId: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { order: { include: { business: { select: { name: true, subscription: { select: { periodEnd: true } } } } } } } });
  const billTo = inv.billTo as unknown as BillTo;
  const end = inv.order.business.subscription?.periodEnd?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  await sendEmail(billTo.email, `Payment received: invoice ${inv.number}`, `Hi ${billTo.name},\n\nWe received ${rupees(inv.totalPaise)} for ${inv.order.business.name}. Your plan is active${end ? ` until ${end}` : ''}.\n\nInvoice ${inv.number}\nTaxable value ${rupees(inv.taxablePaise)}${inv.igstPaise ? `\nIGST ${rupees(inv.igstPaise)}` : inv.cgstPaise ? `\nCGST ${rupees(inv.cgstPaise)}\nSGST ${rupees(inv.sgstPaise)}` : ''}\nTotal ${rupees(inv.totalPaise)}\n\nThank you,\nAHEAD`);
}

export const OfflinePayment = z.object({
  method: z.enum(['bank', 'upi', 'cheque', 'cash']),
  reference: z.string().trim().min(3, 'Enter the UTR, UPI or cheque number').max(60).nullish(),
  receivedAt: z.string().datetime().optional(),
  amountPaise: z.number().int().min(1),
}).refine((p) => p.method === 'cash' || !!p.reference, { message: 'Enter the UTR, UPI or cheque number', path: ['reference'] });

/** Admin or Staff: money received outside the payment link (bank transfer, UPI, cheque, cash) */
export async function recordOfflinePayment(a: Actor, orderId: string, input: z.infer<typeof OfflinePayment>) {
  const out = await prisma.$transaction(async (tx) => {
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (o.status !== 'awaiting_payment') throw new AppError('INVALID_TRANSITION', o.status === 'paid' ? 'This order is already paid.' : `This order is ${o.status.replace('_', ' ')}.`);
    return capturePayment(tx, o, { method: input.method, amountPaise: input.amountPaise, reference: input.reference, receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(), recordedById: a.id });
  });
  if (out) await emailInvoice(out.invoice.id).catch(() => undefined);
  return out;
}

export interface WebhookResult {
  status: 'processed' | 'duplicate' | 'ignored' | 'needs_attention';
  detail?: string;
}

/** A gateway event: checked, kept once, and a paid link turned into a paid order */
export async function handleWebhook(name: string, raw: Buffer, signature: string | undefined, body: unknown, headerEventId?: string): Promise<WebhookResult> {
  const gw = webhookGateway(name);
  if (!gw || !gw.verify(raw, signature)) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
  const evt = gw.parse(body, headerEventId);
  const stored = await prisma.webhookEvent.createMany({ data: [{ gateway: name, eventId: evt.eventId, type: evt.type, payload: body as Prisma.InputJsonValue }], skipDuplicates: true });
  if (!stored.count) return { status: 'duplicate' };
  if (evt.type !== 'payment_link.paid' || !evt.linkId) {
    await prisma.webhookEvent.update({ where: { eventId: evt.eventId }, data: { processedAt: new Date() } });
    return { status: 'ignored' };
  }
  try {
    // A partner's monthly bill paid through its link
    const bill = await prisma.partnerBill.findUnique({ where: { linkId: evt.linkId }, select: { id: true } });
    if (bill) {
      await prisma.$transaction((tx) => markBillPaid(tx, bill.id, evt.paymentId ?? evt.eventId));
      await prisma.webhookEvent.update({ where: { eventId: evt.eventId }, data: { processedAt: new Date() } });
      return { status: 'processed' };
    }
    const out = await prisma.$transaction(async (tx) => {
      const o = await tx.order.findUnique({ where: { linkId: evt.linkId! } });
      if (!o) throw new Error(`No order has payment link ${evt.linkId}`);
      // Paid after the order was cancelled or ran out: the money is real, so it still counts
      return capturePayment(tx, o.status === 'paid' ? o : { ...o, status: 'awaiting_payment' }, { method: 'online', amountPaise: evt.amountPaise, gatewayPaymentId: evt.paymentId, reference: evt.method, receivedAt: new Date() });
    });
    await prisma.webhookEvent.update({ where: { eventId: evt.eventId }, data: { processedAt: new Date() } });
    if (out) await emailInvoice(out.invoice.id).catch(() => undefined);
    return { status: 'processed' };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await prisma.webhookEvent.update({ where: { eventId: evt.eventId }, data: { error: detail } });
    return { status: 'needs_attention', detail };
  }
}

/** Admin: a full credit note for an invoice (a refund); optionally the plan ends now and the business moves to Free */
export async function creditNote(a: Actor, invoiceId: string, reason: string, endPlan: boolean) {
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { creditNote: true } });
    if (inv.creditNote) throw new AppError('CONFLICT', `Credit note ${inv.creditNote.number} already exists for this invoice.`);
    const { number, fy } = await nextNumber(tx, 'credit_note', 'AHD-CN', new Date());
    const cn = await tx.creditNote.create({
      data: { number, fy, businessId: inv.businessId, invoiceId, reason, taxablePaise: inv.taxablePaise, cgstPaise: inv.cgstPaise, sgstPaise: inv.sgstPaise, igstPaise: inv.igstPaise, totalPaise: inv.totalPaise, createdById: a.id },
    });
    if (endPlan) {
      const free = await tx.plan.findFirstOrThrow({ where: { isFree: true } });
      await tx.subscription.update({ where: { businessId: inv.businessId }, data: { status: 'free', planKey: free.key, periodStart: null, periodEnd: null, graceEndsAt: null, version: { increment: 1 } } });
      await issueLicence(tx, inv.businessId);
    }
    await audit({ actorId: a.id, action: 'invoice.credit_note', entity: 'invoice', entityId: invoiceId, after: { creditNote: number, reason, endPlan } }, tx);
    return cn;
  });
}
