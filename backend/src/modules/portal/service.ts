import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { env, isDev } from '../../config/env';
import { db } from '../../kernel/db';
import { bundle } from '../../kernel/bundle';
import { AppError, notFound } from '../../kernel/errors';
import { randomToken } from '../../kernel/crypto';
import type { TenantCtx } from '../../kernel/context';
import { DateStr } from '../../kernel/query';
import { todayIST } from '../../kernel/gst';
import { consumeOtp, sendOtp } from '../identity/otp';
import { signPurposeToken, verifyPurposeToken } from '../identity/tokens';
import { customerLedger } from '../billing/ledger';
import { audit } from '../audit/service';
import * as support from '../support/service';

// Customer portal (CUS-01…CUS-05): a business's customers open /portal/<link>, sign in with their
// mobile number (a code by SMS) or a link the business sent, and see their bills and quotations,
// their statement, their requests and their bookings. A sign-in is good for 30 days and covers
// every customer record with that mobile number in this business. Public routes run with platform
// rights, so every read here names the business AND the customer.

const SESSION_SEC = 30 * 24 * 3600;
const LINK_SEC = 30 * 24 * 3600;
const AUD = 'ahead-portal';
const Mobile = z.string().trim().transform((v) => v.replace(/\D/g, '').slice(-10)).pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'));
const last10 = Prisma.sql`right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 10)`;

interface Session { tid: string; cids: string[] }

// ---------------------------------------------------------------- setup (staff)

export async function getSettings(ctx: Pick<TenantCtx, 'tenantId'>) {
  const s = await db().portalSettings.findUnique({ where: { tenantId: ctx.tenantId } });
  return {
    enabled: s?.enabled ?? false, slug: s?.slug ?? null, title: s?.title ?? 'Your account', intro: s?.intro ?? null,
    showBills: s?.showBills ?? true, showQuotes: s?.showQuotes ?? true, allowQuoteReply: s?.allowQuoteReply ?? true,
    showStatement: s?.showStatement ?? true, showRequests: s?.showRequests ?? true, showBookings: s?.showBookings ?? true,
  };
}

export const SettingsInput = z.object({
  enabled: z.boolean(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,38}$/, 'Use 3–40 letters, numbers or dashes').nullish(),
  title: z.string().trim().min(3).max(80),
  intro: z.string().trim().max(400).nullish(),
  showBills: z.boolean(), showQuotes: z.boolean(), allowQuoteReply: z.boolean(), showStatement: z.boolean(), showRequests: z.boolean(), showBookings: z.boolean(),
}).refine((s) => !s.enabled || !!s.slug, { message: 'Choose a link name to switch the portal on', path: ['slug'] });

export async function saveSettings(ctx: TenantCtx, b: z.infer<typeof SettingsInput>) {
  if (b.slug && (await db().portalSettings.findFirst({ where: { slug: b.slug, NOT: { tenantId: ctx.tenantId } }, select: { tenantId: true } }))) {
    throw new AppError('VALIDATION_FAILED', 'That link name is taken. Try another.', { fields: { slug: 'Taken' } });
  }
  const data = { ...b, slug: b.slug ?? null, intro: b.intro ?? null };
  await db().portalSettings.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...data }, update: data });
  await audit({ action: 'portal.settings.update', entity: 'portal_settings', entityId: ctx.tenantId, after: { enabled: b.enabled, slug: b.slug } });
  return getSettings(ctx);
}

/** A sign-in link for one customer, good for 30 days, for the business to send on WhatsApp */
export async function portalLink(ctx: TenantCtx, contactId: string) {
  const s = await getSettings(ctx);
  if (!s.enabled || !s.slug) throw new AppError('CONFLICT', 'Switch the customer portal on first (Sales › Customer portal).');
  const c = await db().contact.findFirst({ where: { id: contactId, tenantId: ctx.tenantId, type: 'customer' }, select: { id: true, name: true, companyName: true, phone: true, portalBlocked: true, portalSeenAt: true } });
  if (!c) throw notFound('Customer');
  if (c.portalBlocked) throw new AppError('CONFLICT', 'Portal access is turned off for this customer. Turn it on first.');
  const token = signPurposeToken('portal-link', { tid: ctx.tenantId, cid: c.id }, LINK_SEC);
  await audit({ action: 'portal.link.create', entity: 'contact', entityId: c.id });
  return { url: `${env.APP_URL}/portal/${s.slug}?t=${token}`, phone: c.phone, name: c.companyName || c.name, seenAt: c.portalSeenAt, expiresInDays: 30 };
}

export async function setBlocked(ctx: TenantCtx, contactId: string, blocked: boolean) {
  const r = await db().contact.updateMany({ where: { id: contactId, tenantId: ctx.tenantId }, data: { portalBlocked: blocked } });
  if (!r.count) throw notFound('Customer');
  await audit({ action: blocked ? 'portal.access.off' : 'portal.access.on', entity: 'contact', entityId: contactId });
  return { blocked };
}

// ---------------------------------------------------------------- sign-in (public)

async function bySlug(slug: string) {
  const s = await db().portalSettings.findUnique({ where: { slug } });
  if (!s || !s.enabled) throw notFound('Customer portal');
  return s;
}

/** Customers of this business with this mobile number (any way it was typed), portal not turned off */
async function customersByMobile(tenantId: string, mobile: string) {
  return db().$queryRaw<{ id: string; name: string; company_name: string | null; gstin: string | null }[]>`
    select c.id, c.name, c.company_name, c.gstin from contacts c
    where c.tenant_id = ${tenantId}::uuid and c.type = 'customer' and not c.portal_blocked and ${last10} = ${mobile}
    order by coalesce(c.company_name, c.name)`;
}

function signSession(s: Session) {
  return jwt.sign({ typ: 'portal', ...s }, env.JWT_SECRET, { expiresIn: SESSION_SEC, algorithm: 'HS256', audience: AUD });
}

export async function publicInfo(slug: string) {
  const s = await bySlug(slug);
  const t = await db().tenant.findUniqueOrThrow({ where: { id: s.tenantId }, select: { name: true, profile: true } });
  const p = (t.profile ?? {}) as { phone?: string; logoUrl?: string; address?: Record<string, string>; email?: string };
  return {
    business: { name: t.name, phone: p.phone ?? null, email: p.email ?? null, city: p.address?.city ?? null, logoUrl: p.logoUrl ?? null },
    title: s.title, intro: s.intro,
    parts: { bills: s.showBills, quotes: s.showQuotes, statement: s.showStatement, requests: s.showRequests, bookings: s.showBookings },
  };
}

export const OtpInput = z.object({ mobile: Mobile });
export const VerifyInput = z.object({ mobile: Mobile, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

/** Sends a code only to numbers this business knows; the answer is the same either way */
export async function requestCode(slug: string, b: z.infer<typeof OtpInput>) {
  const s = await bySlug(slug);
  const found = await customersByMobile(s.tenantId, b.mobile);
  // In development, say why no code came; a live portal never tells whose number it is
  if (!found.length) return { sent: true, devCode: undefined as string | undefined, devNote: isDev ? `No customer of this business has the mobile ${b.mobile}. Add it on the customer, or try another number.` : undefined };
  const r = await sendOtp(`+91${b.mobile}`, 'portal');
  return { sent: true, devCode: r.devCode, devNote: undefined as string | undefined };
}

export async function verifyCode(slug: string, b: z.infer<typeof VerifyInput>) {
  const s = await bySlug(slug);
  const found = await customersByMobile(s.tenantId, b.mobile);
  if (!found.length) throw new AppError('OTP_INVALID', 'The code is incorrect.');
  await consumeOtp(`+91${b.mobile}`, 'portal', b.code);
  return { token: signSession({ tid: s.tenantId, cids: found.map((c) => c.id) }), accounts: found.map((c) => ({ id: c.id, name: c.company_name || c.name, person: c.company_name ? c.name : null, gstin: c.gstin })) };
}

export const LinkInput = z.object({ token: z.string().min(20).max(1000) });

/** The link from the business signs the customer in without a code */
export async function linkSignIn(slug: string, b: z.infer<typeof LinkInput>) {
  const s = await bySlug(slug);
  let p: { tid: string; cid: string };
  try { p = verifyPurposeToken<{ tid: string; cid: string }>('portal-link', b.token); } catch { throw new AppError('UNAUTHENTICATED', 'This link has expired. Sign in with your mobile number.'); }
  if (p.tid !== s.tenantId) throw new AppError('UNAUTHENTICATED', 'This link is for another business.');
  const c = await db().contact.findFirst({ where: { id: p.cid, tenantId: s.tenantId, type: 'customer', portalBlocked: false }, select: { id: true, name: true, companyName: true, gstin: true } });
  if (!c) throw new AppError('UNAUTHENTICATED', 'This link no longer works. Sign in with your mobile number.');
  return { token: signSession({ tid: s.tenantId, cids: [c.id] }), accounts: [{ id: c.id, name: c.companyName || c.name, person: c.companyName ? c.name : null, gstin: c.gstin }] };
}

/** Checks the sign-in on every portal request: the portal is on, this business, this customer */
export async function session(slug: string, bearer: string | undefined, contactId: string) {
  if (!bearer) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  let p: Session;
  try {
    const v = jwt.verify(bearer, env.JWT_SECRET, { algorithms: ['HS256'], audience: AUD }) as jwt.JwtPayload & Session & { typ?: string };
    if (v.typ !== 'portal') throw new Error('type');
    p = { tid: v.tid, cids: v.cids };
  } catch { throw new AppError('UNAUTHENTICATED', 'Please sign in again.'); }
  const s = await bySlug(slug);
  if (p.tid !== s.tenantId || !p.cids.includes(contactId)) throw new AppError('UNAUTHENTICATED', 'Please sign in again.');
  const c = await db().contact.findFirst({ where: { id: contactId, tenantId: s.tenantId, type: 'customer' }, select: { id: true, name: true, companyName: true, phone: true, email: true, gstin: true, address: true, portalBlocked: true, portalSeenAt: true, creditLimitPaise: true } });
  if (!c || c.portalBlocked) throw new AppError('UNAUTHENTICATED', 'Your access was turned off. Please call the business.');
  // A visit, noted at most every 10 minutes
  if (!c.portalSeenAt || Date.now() - c.portalSeenAt.getTime() > 600_000) await db().contact.update({ where: { id: c.id }, data: { portalSeenAt: new Date() } });
  // The business's own code reads as a system user of that business with every record in scope
  const ctx = { kind: 'tenant', tenantId: s.tenantId, userId: null, memberId: '', roleId: '', sessionId: 'portal', branchIds: [], scope: 'all' } as unknown as TenantCtx;
  return { s, c, ctx, accounts: p.cids };
}
type Sess = Awaited<ReturnType<typeof session>>;

// ---------------------------------------------------------------- what the customer sees

const LIVE_INVOICE = Prisma.sql`d.kind in ('invoice', 'debit_note', 'opening_balance') and d.status in ('issued', 'partially_paid', 'paid')`;

/** Share links let the customer open, print and pay a bill; made on first look */
async function ensureShareTokens(tenantId: string, contactId: string) {
  // Tokens made here, not in SQL: a failed statement would abort the whole request's transaction
  const rows = await db().salesDocument.findMany({ where: { tenantId, contactId, shareToken: null, status: { not: 'draft' }, kind: { in: ['invoice', 'credit_note', 'debit_note', 'quotation'] } }, select: { id: true } });
  for (const r of rows) await db().salesDocument.update({ where: { id: r.id }, data: { shareToken: randomToken(18) } });
}

export async function home(x: Sess) {
  const t = x.s.tenantId, cid = x.c.id, today = todayIST();
  const b = await bundle({
    dues: Prisma.sql`select coalesce(sum(d.total_paise - d.paid_paise), 0) as due_paise,
        coalesce(sum(d.total_paise - d.paid_paise) filter (where d.due_date < ${today}::date), 0) as overdue_paise,
        count(*) filter (where d.status in ('issued', 'partially_paid'))::int as open_bills,
        min(d.due_date) filter (where d.status in ('issued', 'partially_paid') and d.due_date >= ${today}::date) as next_due
      from sales_documents d where d.tenant_id = ${t}::uuid and d.contact_id = ${cid}::uuid and ${LIVE_INVOICE} and d.status in ('issued', 'partially_paid')`,
    credit: Prisma.sql`select coalesce(sum(d.total_paise - d.paid_paise), 0) as credit_paise from sales_documents d where d.tenant_id = ${t}::uuid and d.contact_id = ${cid}::uuid and d.kind = 'credit_note' and d.status = 'issued'`,
    lastPay: Prisma.sql`select p.amount_paise, p.paid_on, p.method from payments_received p where p.tenant_id = ${t}::uuid and p.contact_id = ${cid}::uuid and p.reverses_id is null and p.amount_paise > 0 order by p.paid_on desc limit 1`,
    year: Prisma.sql`select coalesce(sum(case when d.kind = 'credit_note' then -d.total_paise else d.total_paise end), 0) as bought_paise, count(*) filter (where d.kind = 'invoice')::int as bills
      from sales_documents d where d.tenant_id = ${t}::uuid and d.contact_id = ${cid}::uuid and d.status not in ('draft', 'cancelled') and d.kind in ('invoice', 'credit_note') and d.issue_date >= ${today}::date - 365`,
    quotes: Prisma.sql`select count(*)::int as n from sales_documents d where d.tenant_id = ${t}::uuid and d.contact_id = ${cid}::uuid and d.kind = 'quotation' and d.status = 'sent'`,
    tickets: Prisma.sql`select count(*)::int as n from support_tickets k where k.tenant_id = ${t}::uuid and k.contact_id = ${cid}::uuid and k.status in ('new', 'open', 'pending', 'on_hold')`,
    bookings: Prisma.sql`select a.id, a.title, a.start_at, a.status, i.name as service from appointments a left join items i on i.id = a.item_id where a.tenant_id = ${t}::uuid and a.contact_id = ${cid}::uuid and a.start_at >= now() and a.status in ('scheduled', 'confirmed') order by a.start_at limit 3`,
  });
  const d = b.dues[0] ?? {};
  return {
    customer: { id: x.c.id, name: x.c.companyName || x.c.name, person: x.c.companyName ? x.c.name : null, phone: x.c.phone, email: x.c.email, gstin: x.c.gstin, address: x.c.address },
    dues: { duePaise: Number(d.duePaise ?? 0), overduePaise: Number(d.overduePaise ?? 0), openBills: Number(d.openBills ?? 0), nextDue: d.nextDue ?? null, creditPaise: Number(b.credit[0]?.creditPaise ?? 0) },
    lastPayment: b.lastPay[0] ? { amountPaise: Number(b.lastPay[0].amountPaise), paidOn: b.lastPay[0].paidOn, method: b.lastPay[0].method } : null,
    year: { boughtPaise: Number(b.year[0]?.boughtPaise ?? 0), bills: Number(b.year[0]?.bills ?? 0) },
    waiting: { quotes: Number(b.quotes[0]?.n ?? 0), requests: Number(b.tickets[0]?.n ?? 0) },
    bookings: x.s.showBookings ? b.bookings : [],
  };
}

export async function documents(x: Sess) {
  await ensureShareTokens(x.s.tenantId, x.c.id);
  const kinds = [...(x.s.showBills ? ['invoice', 'credit_note', 'debit_note'] : []), ...(x.s.showQuotes ? ['quotation'] : [])];
  if (!kinds.length) return { data: [] };
  const rows = await db().salesDocument.findMany({
    where: { tenantId: x.s.tenantId, contactId: x.c.id, kind: { in: kinds as never }, status: { notIn: ['draft', 'cancelled'] } },
    orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }], take: 500,
    select: { id: true, kind: true, number: true, status: true, issueDate: true, dueDate: true, totalPaise: true, paidPaise: true, shareToken: true },
  });
  const today = todayIST();
  return {
    data: rows.map((r) => ({ ...r, duePaise: ['invoice', 'debit_note'].includes(r.kind) && ['issued', 'partially_paid'].includes(r.status) ? Number(r.totalPaise - r.paidPaise) : 0, overdue: ['issued', 'partially_paid'].includes(r.status) && !!r.dueDate && r.dueDate.toISOString().slice(0, 10) < today })),
    canReply: x.s.allowQuoteReply,
  };
}

export const ReplyInput = z.object({ decision: z.enum(['accepted', 'declined']), note: z.string().trim().max(500).nullish() });

/** The customer says yes or no to a quotation that was sent */
export async function replyToQuote(x: Sess, id: string, b: z.infer<typeof ReplyInput>) {
  if (!x.s.showQuotes || !x.s.allowQuoteReply) throw new AppError('PERMISSION_DENIED', 'Please call the business to accept or decline.');
  const q = await db().salesDocument.findFirst({ where: { id, tenantId: x.s.tenantId, contactId: x.c.id, kind: 'quotation' } });
  if (!q) throw notFound('Quotation');
  if (q.status !== 'sent') throw new AppError('CONFLICT', q.status === 'accepted' ? 'You already accepted this quotation.' : q.status === 'declined' ? 'You already declined this quotation.' : 'This quotation can no longer be answered.');
  // A quotation's due date is its "valid till" date
  if (q.dueDate && q.dueDate.toISOString().slice(0, 10) < todayIST() && b.decision === 'accepted') throw new AppError('CONFLICT', 'This quotation has expired. Please ask the business for a new one.');
  await db().salesDocument.update({ where: { id }, data: { status: b.decision, version: { increment: 1 }, notes: b.note ? [q.notes, `Customer: ${b.note}`].filter(Boolean).join('\n') : undefined } });
  await audit({ tenantId: x.s.tenantId, actorId: null, action: `portal.quote.${b.decision === 'accepted' ? 'accept' : 'decline'}`, entity: 'sales_document', entityId: id, after: { number: q.number, note: b.note ?? null } });
  return { status: b.decision };
}

export const StatementQuery = z.object({ from: DateStr.optional(), to: DateStr.optional() });

export async function statement(x: Sess, q: z.infer<typeof StatementQuery>) {
  if (!x.s.showStatement) throw new AppError('PERMISSION_DENIED', 'The statement is not shown here. Please ask the business.');
  const l = await customerLedger(x.ctx, x.c.id, q);
  return { ...l, rows: l.rows.map((r) => ({ ...r, documentId: undefined })) };
}

export async function requests(x: Sess) {
  if (!x.s.showRequests) return { data: [], open: false };
  const rows = await db().supportTicket.findMany({ where: { tenantId: x.s.tenantId, contactId: x.c.id }, orderBy: { createdAt: 'desc' }, take: 100, select: { number: true, subject: true, status: true, createdAt: true, resolvedAt: true, publicToken: true, rating: true } });
  const cats = (await support.getSettings({ tenantId: x.s.tenantId })).categories.map((c) => ({ key: c.key, label: c.label }));
  return { data: rows, categories: cats, open: true };
}

export const RequestInput = z.object({
  category: z.string().trim().min(2).max(30),
  subject: z.string().trim().min(3, 'Say what it is about').max(200),
  description: z.string().trim().min(10, 'Tell us a little more (at least 10 letters)').max(3000),
  invoiceId: z.string().uuid().nullish(),
  serial: z.string().trim().max(60).nullish(),
});

export async function raiseRequest(x: Sess, b: z.infer<typeof RequestInput>) {
  if (!x.s.showRequests) throw new AppError('PERMISSION_DENIED', 'Please call the business.');
  if (b.invoiceId && !(await db().salesDocument.findFirst({ where: { id: b.invoiceId, tenantId: x.s.tenantId, contactId: x.c.id }, select: { id: true } }))) throw notFound('Bill');
  const t = await support.createTicket(x.ctx, support.TicketInput.parse({ subject: b.subject, description: b.description, contactId: x.c.id, channel: 'web', category: b.category, priority: 'medium', invoiceId: b.invoiceId ?? null, serial: b.serial ?? null }), { by: 'customer' });
  return { number: t.number, token: t.publicToken };
}

export async function bookings(x: Sess) {
  if (!x.s.showBookings) return { data: [], bookingSlug: null };
  const [rows, bs] = await Promise.all([
    db().$queryRaw<Record<string, unknown>[]>`
      select a.id, a.title, a.start_at, a.end_at, a.status, a.price_paise, a.cancel_reason, i.name as service, u.name as staff
      from appointments a left join items i on i.id = a.item_id left join users u on u.id = a.staff_id
      where a.tenant_id = ${x.s.tenantId}::uuid and a.contact_id = ${x.c.id}::uuid and a.kind = 'appointment' order by a.start_at desc limit 100`,
    db().bookingSettings.findUnique({ where: { tenantId: x.s.tenantId }, select: { enabled: true, slug: true } }),
  ]);
  return {
    data: rows.map((r) => ({ id: r.id, title: r.title, startAt: r.start_at, endAt: r.end_at, status: r.status, pricePaise: r.price_paise === null ? null : Number(r.price_paise), cancelReason: r.cancel_reason, service: r.service, staff: r.staff })),
    bookingSlug: bs?.enabled ? bs.slug : null,
  };
}

/** For the customer page: is the portal on, and when did this customer last visit */
export async function contactPortal(ctx: TenantCtx, contactId: string) {
  const [s, c] = await Promise.all([getSettings(ctx), db().contact.findFirst({ where: { id: contactId, tenantId: ctx.tenantId }, select: { portalSeenAt: true, portalBlocked: true, phone: true } })]);
  if (!c) throw notFound('Customer');
  return { enabled: s.enabled && !!s.slug, slug: s.slug, seenAt: c.portalSeenAt, blocked: c.portalBlocked, hasMobile: !!c.phone };
}
