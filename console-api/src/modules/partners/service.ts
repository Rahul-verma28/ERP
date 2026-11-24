import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Tx } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { audit } from '../../kernel/audit';
import { normaliseEmail, normaliseMobile } from '../../kernel/crypto';
import { sendEmail } from '../../kernel/mail';
import { getSetting } from '../system/settings';
import { financialYear, quote, rupees, type Seller } from '../billing/money';
import { gateway } from '../billing/gateway';

// Partners sell AHEAD under their own relationship with the business: AHEAD bills the partner once
// a month for each paying client (trials are free) at list price minus the partner's discount, and
// never bills the client. Approved 29 Oct 2026 (partner portal, partner-billed clients).

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const PartnerInput = z
  .object({
    name: z.string().trim().min(2, 'Enter the company name').max(120),
    contactName: z.string().trim().min(2, 'Enter the contact person').max(100),
    email: z.string().trim().email('Enter a valid email').transform(normaliseEmail),
    mobile: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a 10-digit mobile').transform(normaliseMobile),
    gstin: z.string().trim().toUpperCase().regex(GSTIN, 'Enter a valid 15-character GSTIN').nullish().or(z.literal('').transform(() => null)),
    stateCode: z.string().regex(/^\d{2}$/, 'Choose the state').nullish(),
    city: z.string().trim().max(60).nullish(),
    discountPct: z.number().min(0, 'From 0 to 90').max(90, 'From 0 to 90'),
  })
  .refine((p) => !p.gstin || !p.stateCode || p.gstin.slice(0, 2) === p.stateCode, { message: 'The GSTIN is from another state', path: ['gstin'] });
export const PartnerPatch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  contactName: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().transform(normaliseEmail).optional(),
  mobile: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/).transform(normaliseMobile).optional(),
  gstin: z.string().trim().toUpperCase().regex(GSTIN, 'Enter a valid 15-character GSTIN').nullish(),
  city: z.string().trim().max(60).nullish(),
  discountPct: z.number().min(0).max(90).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

async function uniqueCode(name: string, tx: Tx | typeof prisma) {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PARTNER';
  for (let i = 0; ; i++) {
    const code = i ? `${base.slice(0, 6)}${i + 1}` : base;
    if (!(await tx.partner.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
}

/** A new partner and its owner, who gets an invite to set a password and open the partner portal */
export async function createPartner(actorId: string, input: z.infer<typeof PartnerInput>, tx: Tx | typeof prisma = prisma) {
  if (await tx.partner.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } } })) throw new AppError('CONFLICT', 'A partner with this name already exists.', { fields: { name: 'Already a partner' } });
  if (await tx.consoleUser.findUnique({ where: { email: input.email } })) throw new AppError('EMAIL_TAKEN', 'Someone already uses this email in the Console.', { fields: { email: 'Already in the Console' } });
  const partner = await tx.partner.create({
    data: {
      name: input.name, code: await uniqueCode(input.name, tx), contactName: input.contactName, email: input.email, mobile: input.mobile,
      gstin: input.gstin ?? null, stateCode: input.stateCode ?? input.gstin?.slice(0, 2) ?? null, city: input.city ?? null, discountBp: Math.round(input.discountPct * 100), createdById: actorId,
    },
  });
  const owner = await tx.consoleUser.create({ data: { name: input.contactName, email: input.email, mobile: input.mobile, role: 'partner_owner', partnerId: partner.id, createdById: actorId } });
  await audit({ actorId, action: 'partner.created', entity: 'partner', entityId: partner.id, after: { name: partner.name, discountBp: partner.discountBp } }, tx);
  return { partner, ownerId: owner.id };
}

export async function updatePartner(actorId: string, id: string, patch: z.infer<typeof PartnerPatch>) {
  const before = await prisma.partner.findUnique({ where: { id } });
  if (!before) throw new AppError('NOT_FOUND', 'Partner not found.');
  const { discountPct, ...rest } = patch;
  const row = await prisma.partner.update({ where: { id }, data: { ...rest, ...(rest.gstin !== undefined ? { stateCode: rest.gstin?.slice(0, 2) ?? before.stateCode } : {}), discountBp: discountPct === undefined ? undefined : Math.round(discountPct * 100) } });
  // Paused: its people are signed out at once (their businesses keep running)
  if (patch.status === 'disabled') await prisma.consoleSession.updateMany({ where: { user: { partnerId: id }, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ actorId, action: 'partner.updated', entity: 'partner', entityId: id, before: { discountBp: before.discountBp, status: before.status }, after: patch });
  return row;
}

/** Monthly price of a plan (a yearly-only price is spread over 12 months) */
const monthly = (p: { monthlyPaise: number | null; yearlyPaise: number | null }) => p.monthlyPaise ?? (p.yearlyPaise != null ? Math.round(p.yearlyPaise / 12) : 0);

/**
 * What the partner owes for a month: every client on a paid plan (a trial or Free costs nothing),
 * the plan's monthly list price and extra users, minus the partner's discount, plus GST.
 */
export async function statement(partnerId: string, tx: Tx | typeof prisma = prisma) {
  const [partner, seller, extraMonthly] = await Promise.all([
    tx.partner.findUniqueOrThrow({ where: { id: partnerId } }),
    getSetting<Seller>('seller', tx),
    getSetting<number>('extra_user.monthly_paise', tx),
  ]);
  const clients = await tx.business.findMany({
    where: { partnerId, subscription: { status: { in: ['active', 'past_due'] } } },
    orderBy: { name: 'asc' },
    include: { subscription: { include: { plan: true } } },
  });
  const lines = clients.map((c) => {
    const s = c.subscription!;
    const listPaise = monthly(s.plan) + s.extraUsers * (extraMonthly ?? 0);
    return { businessId: c.id, name: c.name, plan: s.plan.name, extraUsers: s.extraUsers, listPaise, chargePaise: Math.round((listPaise * (10_000 - partner.discountBp)) / 10_000) };
  });
  const subtotalPaise = lines.reduce((t, l) => t + l.chargePaise, 0);
  // GST the same way as every AHEAD bill (one taxable line = the subtotal)
  const q = quote({
    plan: { name: 'Partner clients', monthlyPaise: subtotalPaise, yearlyPaise: subtotalPaise }, cycle: 'monthly', extraUsers: 0, extraUserPaise: { monthly: 0, yearly: 0 }, discount: null,
    seller: seller!, billTo: { kind: 'partner', name: partner.name, gstin: partner.gstin, stateCode: partner.stateCode, email: partner.email, mobile: partner.mobile },
  });
  return { partner, discountPct: partner.discountBp / 100, lines, subtotalPaise, cgstPaise: q.cgstPaise, sgstPaise: q.sgstPaise, igstPaise: q.igstPaise, totalPaise: q.totalPaise };
}

/** This month's bill for one partner (once a month; nothing when no client pays) */
export async function billPartner(partnerId: string, now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const month = ist.toISOString().slice(0, 7);
  if (await prisma.partnerBill.findUnique({ where: { partnerId_month: { partnerId, month } } })) return null;
  const s = await statement(partnerId);
  if (!s.subtotalPaise) return null;
  const bill = await prisma.partnerBill.create({
    data: {
      partnerId, month, lines: s.lines as unknown as Prisma.InputJsonValue, subtotalPaise: s.subtotalPaise, cgstPaise: s.cgstPaise, sgstPaise: s.sgstPaise, igstPaise: s.igstPaise, totalPaise: s.totalPaise,
      dueAt: new Date(now.getTime() + 15 * 86_400_000),
    },
  });
  await sendPartnerBill(bill.id).catch((e) => console.error(`[partner bill] ${bill.id}:`, e instanceof Error ? e.message : e));
  // With its payment link
  return prisma.partnerBill.findUniqueOrThrow({ where: { id: bill.id } });
}

export async function sendPartnerBill(billId: string) {
  const b = await prisma.partnerBill.findUniqueOrThrow({ where: { id: billId }, include: { partner: true } });
  if (b.status !== 'awaiting_payment') throw new AppError('INVALID_TRANSITION', `This bill is ${b.status.replace('_', ' ')}.`);
  let url = b.linkUrl;
  if (!url) {
    const link = await gateway().createLink({ orderId: b.id, amountPaise: b.totalPaise, description: `AHEAD partner bill ${b.month} — ${b.partner.name}`, customer: { name: b.partner.contactName, email: b.partner.email, mobile: b.partner.mobile }, expiresAt: new Date(b.dueAt.getTime() + 15 * 86_400_000) });
    await prisma.partnerBill.update({ where: { id: b.id }, data: { linkId: link.linkId, linkUrl: link.url } });
    url = link.url;
  }
  const n = (b.lines as unknown[]).length;
  await sendEmail(b.partner.email, `AHEAD bill for ${b.month}: ${rupees(b.totalPaise)}`, `Hi ${b.partner.contactName},\n\nYour AHEAD bill for ${b.month} is ${rupees(b.totalPaise)} for ${n} client${n === 1 ? '' : 's'} (after your ${b.partner.discountBp / 100}% discount, with GST).\n\nPay here: ${url}\n\nPlease pay by ${b.dueAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}. The GST invoice follows the payment.\n\nAHEAD`);
  return { url };
}

/** A partner bill is paid (online or recorded): numbered as an AHEAD invoice */
export async function markBillPaid(tx: Tx, billId: string, ref: string, at = new Date()) {
  const b = await tx.partnerBill.findUniqueOrThrow({ where: { id: billId } });
  if (b.status === 'paid') return null;
  const fy = financialYear(at);
  const seq = await tx.sequence.upsert({ where: { docType_fy: { docType: 'invoice', fy } }, create: { docType: 'invoice', fy, nextNo: 2 }, update: { nextNo: { increment: 1 } } });
  const invoiceNumber = `AHD/${fy}/${String(seq.nextNo - 1).padStart(6, '0')}`;
  const paid = await tx.partnerBill.update({ where: { id: billId }, data: { status: 'paid', paidAt: at, paymentRef: ref, invoiceNumber } });
  await audit({ action: 'partner_bill.paid', entity: 'partner_bill', entityId: billId, after: { invoiceNumber, ref } }, tx);
  return paid;
}
