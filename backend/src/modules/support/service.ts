import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type SupportTicket } from '@prisma/client';
import { db } from '../../kernel/db';
import { bundle, userNames, userPart, type Row } from '../../kernel/bundle';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { DateStr, assertVersion, scopeSql } from '../../kernel/query';
import { todayIST } from '../../kernel/gst';
import { getRolePermissions } from '../access/service';
import { notify } from '../notifications/service';
import { audit } from '../audit/service';

// Customer Service (SUP-01…SUP-06): tickets with a conversation, SLA timers per priority, warranty
// lookup from the sale, customer ratings, a knowledge base with saved replies, and a public form
// where a customer raises a request and follows it with a private link.

export const STATUSES = ['new', 'open', 'pending', 'on_hold', 'resolved', 'closed'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const CHANNELS = ['phone', 'whatsapp', 'email', 'walk_in', 'web', 'other'] as const;
type Status = (typeof STATUSES)[number];
type Priority = (typeof PRIORITIES)[number];
const OPEN: Status[] = ['new', 'open', 'pending', 'on_hold'];
const DONE: Status[] = ['resolved', 'closed'];

export interface Category { key: string; label: string; color: string }
export const DEFAULT_CATEGORIES: Category[] = [
  { key: 'complaint', label: 'Complaint', color: 'rose' },
  { key: 'repair', label: 'Repair / service', color: 'amber' },
  { key: 'installation', label: 'Installation', color: 'blue' },
  { key: 'return', label: 'Return / refund', color: 'violet' },
  { key: 'delivery', label: 'Delivery', color: 'cyan' },
  { key: 'billing', label: 'Billing question', color: 'emerald' },
  { key: 'other', label: 'Other', color: 'slate' },
];
type Sla = Record<Priority, { respondH: number; resolveH: number }>;
export const DEFAULT_SLA: Sla = { urgent: { respondH: 1, resolveH: 8 }, high: { respondH: 4, resolveH: 24 }, medium: { respondH: 8, resolveH: 48 }, low: { respondH: 24, resolveH: 96 } };

const HOUR = 3_600_000;
const DAY = 86_400_000;
const n = (v: unknown) => Number(v ?? 0);
const Phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number');
const token = () => randomBytes(18).toString('base64url');

// ---------------------------------------------------------------- settings

export async function getSettings(ctx: Pick<TenantCtx, 'tenantId'>) {
  const s = await db().supportSettings.findUnique({ where: { tenantId: ctx.tenantId } });
  const cats = (s?.categories as Category[] | undefined)?.length ? (s!.categories as unknown as Category[]) : DEFAULT_CATEGORIES;
  const sla = { ...DEFAULT_SLA, ...((s?.sla ?? {}) as Partial<Sla>) };
  return {
    formEnabled: s?.formEnabled ?? false, slug: s?.slug ?? null, title: s?.title ?? 'Raise a request', intro: s?.intro ?? null,
    categories: cats, sla, warrantyMonths: s?.warrantyMonths ?? 12, autoAssign: (s?.autoAssign ?? 'none') as 'none' | 'round_robin',
    askRating: s?.askRating ?? true, autoCloseDays: s?.autoCloseDays ?? 7, lastAssignedId: s?.lastAssignedId ?? null,
  };
}

const Hours = z.object({ respondH: z.number().min(0.25, 'At least 15 minutes').max(720), resolveH: z.number().min(0.5).max(2160) }).refine((h) => h.resolveH >= h.respondH, { message: 'Resolve time must be after the first reply', path: ['resolveH'] });
export const SettingsInput = z.object({
  formEnabled: z.boolean(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,38}$/, 'Use 3–40 letters, numbers or dashes').nullish(),
  title: z.string().trim().min(3).max(80),
  intro: z.string().trim().max(400).nullish(),
  categories: z.array(z.object({ key: z.string().trim().regex(/^[a-z0-9_]{2,30}$/), label: z.string().trim().min(2).max(40), color: z.string().max(12) })).min(1, 'Keep at least one category').max(20),
  sla: z.object({ urgent: Hours, high: Hours, medium: Hours, low: Hours }),
  warrantyMonths: z.number().int().min(0).max(120),
  autoAssign: z.enum(['none', 'round_robin']),
  askRating: z.boolean(),
  autoCloseDays: z.number().int().min(0).max(90),
}).refine((s) => !s.formEnabled || !!s.slug, { message: 'Choose a link name to switch the form on', path: ['slug'] })
  .refine((s) => new Set(s.categories.map((c) => c.key)).size === s.categories.length, { message: 'Two categories have the same key', path: ['categories'] });

export async function saveSettings(ctx: TenantCtx, b: z.infer<typeof SettingsInput>) {
  if (b.slug) {
    const taken = await db().supportSettings.findFirst({ where: { slug: b.slug, NOT: { tenantId: ctx.tenantId } }, select: { tenantId: true } });
    if (taken) throw new AppError('VALIDATION_FAILED', 'That link name is taken. Try another.', { fields: { slug: 'Taken' } });
  }
  const data = { formEnabled: b.formEnabled, slug: b.slug ?? null, title: b.title, intro: b.intro ?? null, categories: b.categories as unknown as Prisma.InputJsonValue, sla: b.sla as unknown as Prisma.InputJsonValue, warrantyMonths: b.warrantyMonths, autoAssign: b.autoAssign, askRating: b.askRating, autoCloseDays: b.autoCloseDays };
  await db().supportSettings.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...data }, update: data });
  await audit({ action: 'support.settings.update', entity: 'support_settings', entityId: ctx.tenantId, after: { formEnabled: b.formEnabled, slug: b.slug, warrantyMonths: b.warrantyMonths, autoAssign: b.autoAssign } });
  return getSettings(ctx);
}

/** People who can be given tickets: active members whose role can edit tickets */
export async function agents(ctx: Pick<TenantCtx, 'tenantId'>) {
  const members = await db().tenantMember.findMany({ where: { tenantId: ctx.tenantId, status: 'active' }, include: { user: { select: { id: true, name: true } }, role: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } });
  const out: { id: string; name: string; role: string }[] = [];
  for (const m of members) if ((await getRolePermissions(m.role.id)).has('support.ticket.edit')) out.push({ id: m.user.id, name: m.user.name, role: m.role.name });
  return out;
}

// ---------------------------------------------------------------- tickets

export const TicketInput = z.object({
  subject: z.string().trim().min(3, 'Say what it is about').max(200),
  description: z.string().trim().max(5000).nullish(),
  contactId: z.string().uuid().nullish(),
  guestName: z.string().trim().min(2).max(120).nullish(),
  guestPhone: Phone.nullish(),
  guestEmail: z.string().trim().email('Enter a valid email').max(160).nullish(),
  channel: z.enum(CHANNELS).default('phone'),
  category: z.string().trim().min(2).max(30).default('other'),
  priority: z.enum(PRIORITIES).default('medium'),
  assigneeId: z.string().uuid().nullish(),
  labels: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
  invoiceId: z.string().uuid().nullish(),
  itemId: z.string().uuid().nullish(),
  serial: z.string().trim().max(60).nullish(),
}).refine((t) => !!t.contactId || !!t.guestName, { message: 'Choose a customer or type the name', path: ['contactId'] })
  .refine((t) => !!t.contactId || !!t.guestPhone || !!t.guestEmail, { message: 'Add a mobile number or email to reach them', path: ['guestPhone'] });
export type TicketInput = z.infer<typeof TicketInput>;

async function nextNumber(tenantId: string) {
  await db().$queryRaw`select 1 as ok from pg_advisory_xact_lock(hashtext(${`support-number:${tenantId}`}))`;
  const [r] = await db().$queryRaw<{ n: number }[]>`select coalesce(max(nullif(regexp_replace(number, '\\D', '', 'g'), '')::int), 0)::int as n from support_tickets where tenant_id = ${tenantId}::uuid`;
  return `TKT-${String((r?.n ?? 0) + 1).padStart(4, '0')}`;
}

/** First-reply and resolve due times from the priority's SLA, counted from `from` */
function dues(sla: Sla, priority: Priority, from: Date) {
  const h = sla[priority];
  return { firstResponseDue: new Date(from.getTime() + h.respondH * HOUR), resolveDue: new Date(from.getTime() + h.resolveH * HOUR) };
}

async function checkLinks(ctx: TenantCtx, b: Partial<TicketInput>, categories: Category[]) {
  if (b.category && !categories.some((c) => c.key === b.category)) throw new AppError('VALIDATION_FAILED', 'Pick a category from the list.', { fields: { category: 'Unknown' } });
  if (b.contactId && !(await db().contact.findFirst({ where: { id: b.contactId, tenantId: ctx.tenantId }, select: { id: true } }))) throw notFound('Customer');
  if (b.assigneeId && !(await agents(ctx)).some((a) => a.id === b.assigneeId)) throw new AppError('VALIDATION_FAILED', 'This person cannot handle tickets. Give their role ticket access first.', { fields: { assigneeId: 'Not an agent' } });
  if (b.invoiceId) {
    const inv = await db().salesDocument.findFirst({ where: { id: b.invoiceId, tenantId: ctx.tenantId }, select: { contactId: true } });
    if (!inv) throw notFound('Invoice');
    if (b.contactId && inv.contactId && inv.contactId !== b.contactId) throw new AppError('VALIDATION_FAILED', 'This invoice is for another customer.', { fields: { invoiceId: 'Other customer' } });
  }
  if (b.itemId && !(await db().item.findFirst({ where: { id: b.itemId, tenantId: ctx.tenantId }, select: { id: true } }))) throw notFound('Item');
}

async function event(ctx: Pick<TenantCtx, 'tenantId'> & { userId?: string | null }, ticketId: string, what: string, meta: Record<string, unknown> = {}) {
  await db().supportMessage.create({ data: { tenantId: ctx.tenantId, ticketId, kind: 'event', authorId: ctx.userId ?? null, body: what, meta: meta as Prisma.InputJsonValue } });
}

/** The next agent in turn, for round-robin assignment */
async function nextAgent(ctx: Pick<TenantCtx, 'tenantId'>, last: string | null) {
  const list = await agents(ctx);
  if (!list.length) return null;
  const at = list.findIndex((a) => a.id === last);
  const pick = list[(at + 1) % list.length];
  await db().supportSettings.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, lastAssignedId: pick.id }, update: { lastAssignedId: pick.id } });
  return pick.id;
}

export async function createTicket(ctx: TenantCtx, b: TicketInput, opts: { by?: 'staff' | 'customer' } = {}) {
  const s = await getSettings(ctx);
  await checkLinks(ctx, b, s.categories);
  const now = new Date();
  const assigneeId = b.assigneeId ?? (s.autoAssign === 'round_robin' ? await nextAgent(ctx, s.lastAssignedId) : null);
  const t = await db().supportTicket.create({
    data: {
      tenantId: ctx.tenantId, number: await nextNumber(ctx.tenantId), subject: b.subject, description: b.description ?? null,
      contactId: b.contactId ?? null, guestName: b.contactId ? null : b.guestName ?? null, guestPhone: b.contactId ? null : b.guestPhone ?? null, guestEmail: b.contactId ? null : b.guestEmail ?? null,
      channel: b.channel, category: b.category, priority: b.priority, status: assigneeId ? 'open' : 'new', assigneeId, labels: b.labels,
      invoiceId: b.invoiceId ?? null, itemId: b.itemId ?? null, serial: b.serial || null, ...dues(s.sla, b.priority, now),
      publicToken: token(), createdBy: opts.by === 'customer' ? null : ctx.userId, createdAt: now,
    },
  });
  await event(opts.by === 'customer' ? { tenantId: ctx.tenantId } : ctx, t.id, opts.by === 'customer' ? 'raised' : 'created', { channel: b.channel, assigneeId });
  if (assigneeId && assigneeId !== ctx.userId) await notify(assigneeId, `New ticket ${t.number}: ${t.subject}`, undefined, `/app/m/support/${t.id}`);
  await audit({ action: 'support.ticket.create', entity: 'support_ticket', entityId: t.id, after: { number: t.number, subject: t.subject, priority: t.priority, by: opts.by ?? 'staff' } });
  return t;
}

export const TicketList = z.object({
  view: z.enum(['open', 'new', 'mine', 'unassigned', 'pending', 'overdue', 'resolved', 'closed', 'all']).default('open'),
  priority: z.enum(PRIORITIES).optional(),
  category: z.string().max(30).optional(),
  channel: z.enum(CHANNELS).optional(),
  assigneeId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: DateStr.optional(),
  to: DateStr.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().uuid().optional(),
});

const ownSql = (ctx: TenantCtx) => scopeSql(ctx, ['t.assignee_id', 't.created_by']);

/** Resolved tickets close themselves after the set days */
async function autoClose(ctx: TenantCtx, days: number) {
  if (!days) return;
  const ids = await db().$queryRaw<{ id: string }[]>`
    update support_tickets set status = 'closed', closed_at = now(), updated_at = now(), version = version + 1
    where tenant_id = ${ctx.tenantId}::uuid and status = 'resolved' and resolved_at < now() - make_interval(days => ${days}::int) returning id`;
  for (const r of ids) await event({ tenantId: ctx.tenantId }, r.id, 'closed', { auto: true });
}

export async function listTickets(ctx: TenantCtx, q: z.infer<typeof TicketList>) {
  const s = await getSettings(ctx);
  await autoClose(ctx, s.autoCloseDays);
  const t0 = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`
      select t.id, t.number, t.subject, t.status, t.priority, t.category, t.channel, t.assignee_id, t.contact_id, t.guest_name, t.guest_phone,
        t.labels, t.first_response_due, t.resolve_due, t.first_response_at, t.resolved_at, t.closed_at, t.rating, t.serial, t.invoice_id, t.created_by, t.created_at, t.updated_at, t.version,
        c.name as contact_name, c.company_name, c.phone as contact_phone, d.number as invoice_number, i.name as item_name,
        (select count(*)::int from support_messages m where m.ticket_id = t.id and m.kind in ('reply', 'customer', 'note')) as messages,
        (select m.kind from support_messages m where m.ticket_id = t.id and m.kind in ('reply', 'customer') order by m.created_at desc limit 1) as last_from
      from support_tickets t left join contacts c on c.id = t.contact_id left join sales_documents d on d.id = t.invoice_id left join items i on i.id = t.item_id
      where t.tenant_id = ${t0}::uuid ${ownSql(ctx)}
      order by t.created_at desc limit 5000`,
    ...userPart(t0),
  });
  const names = userNames(b);
  const now = Date.now();
  const all = b.rows.map((r) => {
    const open = OPEN.includes(r.status);
    const responseLate = !r.firstResponseAt && open && r.firstResponseDue && new Date(r.firstResponseDue).getTime() < now;
    const resolveLate = open && r.resolveDue && new Date(r.resolveDue).getTime() < now;
    const firstMin = r.firstResponseAt ? Math.round((new Date(r.firstResponseAt).getTime() - new Date(r.createdAt).getTime()) / 60_000) : null;
    const resolveMin = r.resolvedAt ? Math.round((new Date(r.resolvedAt).getTime() - new Date(r.createdAt).getTime()) / 60_000) : null;
    return {
      ...r, id: r.id as string, status: r.status as Status, customer: (r.companyName as string | null) || (r.contactName as string | null) || (r.guestName as string | null) || 'Customer',
      phone: (r.contactPhone as string | null) ?? (r.guestPhone as string | null), assignee: r.assigneeId ? { id: r.assigneeId, name: names.get(r.assigneeId) ?? 'Someone' } : null,
      overdue: !!(responseLate || resolveLate), responseLate: !!responseLate, firstMin, resolveMin,
      metFirst: r.firstResponseAt && r.firstResponseDue ? new Date(r.firstResponseAt) <= new Date(r.firstResponseDue) : null,
      metResolve: r.resolvedAt && r.resolveDue ? new Date(r.resolvedAt) <= new Date(r.resolveDue) : null,
      awaitingUs: r.lastFrom === 'customer' && open,
    } as Row & { id: string; status: Status; overdue: boolean; customer: string; firstMin: number | null; resolveMin: number | null; metFirst: boolean | null; metResolve: boolean | null };
  });
  const isOpen = (r: { status: Status }) => OPEN.includes(r.status);
  const counts = {
    open: all.filter(isOpen).length, new: all.filter((r) => r.status === 'new').length, mine: all.filter((r) => isOpen(r) && r.assigneeId === ctx.userId).length,
    unassigned: all.filter((r) => isOpen(r) && !r.assigneeId).length, pending: all.filter((r) => r.status === 'pending' || r.status === 'on_hold').length,
    overdue: all.filter((r) => r.overdue).length, resolved: all.filter((r) => r.status === 'resolved').length, closed: all.filter((r) => r.status === 'closed').length, all: all.length,
  };
  const month = now - 30 * DAY;
  const recent = all.filter((r) => new Date(r.createdAt).getTime() >= month);
  const responded = recent.filter((r) => r.firstMin !== null);
  const rated = all.filter((r) => r.rating && r.resolvedAt && new Date(r.resolvedAt).getTime() >= month);
  const slaChecked = recent.filter((r) => r.metResolve !== null);
  const sums = {
    avgFirstMin: responded.length ? Math.round(responded.reduce((x, r) => x + (r.firstMin ?? 0), 0) / responded.length) : null,
    resolvedWeek: all.filter((r) => r.resolvedAt && new Date(r.resolvedAt).getTime() >= now - 7 * DAY).length,
    csat: rated.length ? Math.round((rated.reduce((x, r) => x + n(r.rating), 0) / rated.length) * 10) / 10 : null, rated: rated.length,
    slaMetPct: slaChecked.length ? Math.round((slaChecked.filter((r) => r.metResolve).length / slaChecked.length) * 100) : null,
    urgent: all.filter((r) => isOpen(r) && r.priority === 'urgent').length,
    awaitingUs: all.filter((r) => r.awaitingUs).length,
  };
  const text = (q.q ?? '').toLowerCase();
  const inView = (r: (typeof all)[number]) => {
    switch (q.view) {
      case 'open': return isOpen(r);
      case 'new': return r.status === 'new';
      case 'mine': return isOpen(r) && r.assigneeId === ctx.userId;
      case 'unassigned': return isOpen(r) && !r.assigneeId;
      case 'pending': return r.status === 'pending' || r.status === 'on_hold';
      case 'overdue': return r.overdue;
      case 'resolved': return r.status === 'resolved';
      case 'closed': return r.status === 'closed';
      default: return true;
    }
  };
  const rows = all.filter((r) => inView(r)
    && (!q.priority || r.priority === q.priority) && (!q.category || r.category === q.category) && (!q.channel || r.channel === q.channel)
    && (!q.assigneeId || r.assigneeId === q.assigneeId) && (!q.contactId || r.contactId === q.contactId)
    && (!q.from || new Date(r.createdAt) >= new Date(`${q.from}T00:00:00+05:30`)) && (!q.to || new Date(r.createdAt) < new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + DAY))
    && (!text || [r.number, r.subject, r.customer, r.phone, r.serial, r.invoiceNumber, ...(r.labels ?? [])].filter(Boolean).join(' ').toLowerCase().includes(text)));
  // Overdue and urgent first among open ones, newest first otherwise
  const W: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  if (q.view === 'open' || q.view === 'mine' || q.view === 'unassigned' || q.view === 'overdue') rows.sort((a, z) => Number(z.overdue) - Number(a.overdue) || W[a.priority] - W[z.priority] || new Date(a.createdAt).getTime() - new Date(z.createdAt).getTime());
  const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor) + 1 : 0;
  const data = rows.slice(start, start + q.limit);
  return { data, nextCursor: start + q.limit < rows.length ? data[data.length - 1]?.id ?? null : null, total: rows.length, counts, sums, categories: s.categories };
}

/** When the item was sold (from the serial's sale, else the linked invoice) and when its warranty ends */
async function warranty(ctx: TenantCtx, t: Pick<SupportTicket, 'itemId' | 'serial' | 'invoiceId'>, months: number) {
  let soldOn: Date | null = null;
  let invoice: { id: string; number: string | null } | null = null;
  if (t.serial) {
    const [m] = await db().$queryRaw<{ move_date: Date; source_id: string; item_id: string }[]>`
      select move_date, source_id, item_id from stock_moves where tenant_id = ${ctx.tenantId}::uuid and kind = 'sale' and ${t.serial} = any(serials) and reverses_id is null
      ${t.itemId ? Prisma.sql`and item_id = ${t.itemId}::uuid` : Prisma.empty} order by move_date desc limit 1`;
    if (m) {
      soldOn = m.move_date;
      const d = await db().salesDocument.findFirst({ where: { id: m.source_id }, select: { id: true, number: true } });
      invoice = d;
    }
  }
  if (!soldOn && t.invoiceId) {
    const d = await db().salesDocument.findFirst({ where: { id: t.invoiceId }, select: { id: true, number: true, issueDate: true } });
    if (d) { soldOn = d.issueDate; invoice = { id: d.id, number: d.number }; }
  }
  if (!soldOn) return null;
  const ends = new Date(soldOn);
  ends.setUTCMonth(ends.getUTCMonth() + months);
  return { soldOn, endsOn: ends, months, inWarranty: ends.getTime() >= new Date(`${todayIST()}T00:00:00Z`).getTime(), invoice, fromSerial: !!t.serial && !!invoice };
}

export async function getTicket(ctx: TenantCtx, id: string) {
  const t0 = ctx.tenantId;
  const b = await bundle({
    t: Prisma.sql`select t.* from support_tickets t where t.tenant_id = ${t0}::uuid and t.id = ${id}::uuid ${ownSql(ctx)}`,
    messages: Prisma.sql`select id, kind, body, author_id, author_name, meta, created_at from support_messages where tenant_id = ${t0}::uuid and ticket_id = ${id}::uuid order by created_at`,
    ...userPart(t0),
  });
  const t = b.t[0];
  if (!t) throw notFound('Ticket');
  const names = userNames(b);
  const s = await getSettings(ctx);
  const links = await bundle({
    contact: t.contactId ? Prisma.sql`select id, type, name, company_name, phone, email, gstin from contacts where id = ${t.contactId}::uuid` : Prisma.sql`select 1 where false`,
    others: t.contactId ? Prisma.sql`select id, number, subject, status, created_at from support_tickets where tenant_id = ${t0}::uuid and contact_id = ${t.contactId}::uuid and id <> ${id}::uuid order by created_at desc limit 6` : Prisma.sql`select 1 where false`,
    invoice: t.invoiceId ? Prisma.sql`select id, kind, number, issue_date, total_paise, status from sales_documents where id = ${t.invoiceId}::uuid` : Prisma.sql`select 1 where false`,
    item: t.itemId ? Prisma.sql`select id, name, sku, type from items where id = ${t.itemId}::uuid` : Prisma.sql`select 1 where false`,
    invoices: t.contactId ? Prisma.sql`select id, number, issue_date, total_paise from sales_documents where tenant_id = ${t0}::uuid and contact_id = ${t.contactId}::uuid and kind = 'invoice' and status not in ('draft', 'cancelled') order by issue_date desc limit 10` : Prisma.sql`select 1 where false`,
  });
  const c = links.contact[0] ?? null;
  return {
    ...(t as unknown as SupportTicket), messages: b.messages.map((m) => ({ ...m, by: m.authorId ? names.get(m.authorId) ?? 'Someone' : m.authorName ?? (m.kind === 'customer' ? 'Customer' : 'System') })),
    assignee: t.assigneeId ? { id: t.assigneeId, name: names.get(t.assigneeId) ?? 'Someone' } : null,
    createdByName: t.createdBy ? names.get(t.createdBy) ?? null : null,
    customer: c ? { id: c.id, type: c.type, name: c.companyName || c.name, person: c.companyName ? c.name : null, phone: c.phone, email: c.email, gstin: c.gstin } : { id: null, type: 'guest', name: t.guestName, person: null, phone: t.guestPhone, email: t.guestEmail, gstin: null },
    otherTickets: links.others, invoice: links.invoice[0] ?? null, item: links.item[0] ?? null, recentInvoices: links.invoices,
    warranty: await warranty(ctx, t as unknown as SupportTicket, s.warrantyMonths),
    category: s.categories.find((x) => x.key === t.category) ?? { key: t.category, label: t.category, color: 'slate' },
  };
}

export const TicketPatch = z.object({
  subject: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(5000).nullish(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  category: z.string().trim().min(2).max(30).optional(),
  channel: z.enum(CHANNELS).optional(),
  assigneeId: z.string().uuid().nullish(),
  labels: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
  invoiceId: z.string().uuid().nullish(),
  itemId: z.string().uuid().nullish(),
  serial: z.string().trim().max(60).nullish(),
  /** Needed to resolve: what was done */
  resolution: z.string().trim().min(3).max(2000).optional(),
  version: z.number().int(),
});

const STATUS_WORD: Record<Status, string> = { new: 'New', open: 'Open', pending: 'Waiting on customer', on_hold: 'On hold', resolved: 'Resolved', closed: 'Closed' };

export async function updateTicket(ctx: TenantCtx, id: string, b: z.infer<typeof TicketPatch>) {
  const t = await db().supportTicket.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!t) throw notFound('Ticket');
  assertVersion(t.version, b.version, 'ticket');
  const s = await getSettings(ctx);
  await checkLinks(ctx, { ...b, contactId: t.contactId, assigneeId: b.assigneeId === undefined ? undefined : b.assigneeId }, s.categories);
  if (t.status === 'closed' && b.status !== 'open' && Object.keys(b).some((k) => !['version', 'status'].includes(k))) throw new AppError('CONFLICT', 'This ticket is closed. Reopen it to change it.');
  const data: Prisma.SupportTicketUpdateInput = { version: { increment: 1 } };
  const events: [string, Record<string, unknown>][] = [];
  for (const k of ['subject', 'description', 'category', 'channel', 'labels', 'invoiceId', 'itemId', 'serial'] as const) if (b[k] !== undefined) (data as Record<string, unknown>)[k] = b[k] ?? null;
  if (b.category && b.category !== t.category) events.push(['category', { from: t.category, to: b.category }]);
  if (b.priority && b.priority !== t.priority) {
    data.priority = b.priority;
    // New SLA from when the ticket came in; a first reply already made stays met
    Object.assign(data, dues(s.sla, b.priority, t.createdAt));
    events.push(['priority', { from: t.priority, to: b.priority }]);
  }
  if (b.assigneeId !== undefined && b.assigneeId !== t.assigneeId) {
    data.assigneeId = b.assigneeId;
    if (t.status === 'new' && b.assigneeId && !b.status) data.status = 'open';
    events.push(['assigned', { to: b.assigneeId }]);
  }
  if (b.status && b.status !== t.status) {
    const was = t.status as Status;
    if (b.status === 'resolved' && !b.resolution) throw new AppError('VALIDATION_FAILED', 'Say what was done to resolve it.', { fields: { resolution: 'Required' } });
    if (b.status === 'closed' && !DONE.includes(was) && !b.resolution) throw new AppError('VALIDATION_FAILED', 'Say why it is closed without a fix.', { fields: { resolution: 'Required' } });
    data.status = b.status;
    if (b.status === 'resolved') data.resolvedAt = new Date();
    if (b.status === 'closed') { data.closedAt = new Date(); if (!t.resolvedAt) data.resolvedAt = new Date(); }
    if (DONE.includes(was) && OPEN.includes(b.status)) { data.resolvedAt = null; data.closedAt = null; data.reopened = { increment: 1 }; Object.assign(data, { resolveDue: dues(s.sla, (b.priority ?? t.priority) as Priority, new Date()).resolveDue }); }
    events.push([DONE.includes(was) && OPEN.includes(b.status) ? 'reopened' : 'status', { from: was, to: b.status, note: b.resolution ?? null }]);
  }
  const out = await db().supportTicket.update({ where: { id }, data });
  for (const [what, meta] of events) await event(ctx, id, what, meta);
  if (b.resolution && b.status && DONE.includes(b.status)) await db().supportMessage.create({ data: { tenantId: ctx.tenantId, ticketId: id, kind: 'note', authorId: ctx.userId, body: `Resolution: ${b.resolution}` } });
  if (b.assigneeId && b.assigneeId !== t.assigneeId && b.assigneeId !== ctx.userId) await notify(b.assigneeId, `Ticket ${t.number} given to you: ${t.subject}`, undefined, `/app/m/support/${id}`);
  if (b.status && b.status !== t.status) await audit({ action: `support.ticket.${b.status === 'resolved' ? 'resolve' : b.status === 'closed' ? 'close' : DONE.includes(t.status as Status) ? 'reopen' : 'status'}`, entity: 'support_ticket', entityId: id, after: { number: t.number, status: STATUS_WORD[b.status], note: b.resolution } });
  return out;
}

export const ReplyInput = z.object({
  body: z.string().trim().min(1, 'Write something').max(5000),
  kind: z.enum(['reply', 'note']).default('reply'),
  /** What the ticket becomes after a reply: waiting on the customer, or resolved */
  then: z.enum(['open', 'pending', 'on_hold', 'resolved']).optional(),
  channel: z.enum(['whatsapp', 'email', 'phone', 'portal']).default('portal'),
  articleId: z.string().uuid().optional(),
});

export async function reply(ctx: TenantCtx, id: string, b: z.infer<typeof ReplyInput>) {
  const t = await db().supportTicket.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!t) throw notFound('Ticket');
  if (t.status === 'closed') throw new AppError('CONFLICT', 'This ticket is closed. Reopen it to reply.');
  const m = await db().supportMessage.create({ data: { tenantId: ctx.tenantId, ticketId: id, kind: b.kind, body: b.body, authorId: ctx.userId, meta: { channel: b.channel } } });
  const data: Prisma.SupportTicketUpdateInput = { version: { increment: 1 } };
  if (b.kind === 'reply' && !t.firstResponseAt) data.firstResponseAt = m.createdAt;
  if (b.kind === 'reply' && t.status === 'new') data.status = 'open';
  if (!t.assigneeId) data.assigneeId = ctx.userId;
  if (b.then && b.then !== t.status) {
    data.status = b.then;
    if (b.then === 'resolved') data.resolvedAt = new Date();
  }
  const out = await db().supportTicket.update({ where: { id }, data });
  if (b.then && b.then !== t.status) await event(ctx, id, 'status', { from: t.status, to: b.then });
  if (b.articleId) await db().kbArticle.updateMany({ where: { id: b.articleId, tenantId: ctx.tenantId }, data: { uses: { increment: 1 } } });
  return { message: m, ticket: out };
}

export async function deleteTicket(ctx: TenantCtx, id: string) {
  const t = await db().supportTicket.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!t) throw notFound('Ticket');
  await db().supportTicket.delete({ where: { id } });
  await audit({ action: 'support.ticket.delete', entity: 'support_ticket', entityId: id, before: { number: t.number, subject: t.subject } });
}

// ---------------------------------------------------------------- knowledge base

export const ArticleInput = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(3).max(20_000),
  category: z.string().trim().max(30).nullish(),
  tags: z.array(z.string().trim().min(1).max(24)).max(10).default([]),
  kind: z.enum(['article', 'reply']).default('article'),
  published: z.boolean().default(true),
  version: z.number().int().optional(),
});

export async function listArticles(ctx: TenantCtx, q: { kind?: 'article' | 'reply'; q?: string }) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`select id, title, body, category, tags, kind, published, uses, created_by, created_at, updated_at, version from kb_articles where tenant_id = ${t}::uuid order by kind, uses desc, title`,
    ...userPart(t),
  });
  const names = userNames(b);
  const text = (q.q ?? '').toLowerCase();
  const all = b.rows.map((r) => ({ ...r, id: r.id as string, createdByName: r.createdBy ? names.get(r.createdBy) ?? null : null }) as Row & { id: string });
  const data = all.filter((r) => (!q.kind || r.kind === q.kind) && (!text || `${r.title} ${r.body} ${(r.tags ?? []).join(' ')} ${r.category ?? ''}`.toLowerCase().includes(text)));
  return { data, counts: { all: all.length, article: all.filter((r) => r.kind === 'article').length, reply: all.filter((r) => r.kind === 'reply').length, draft: all.filter((r) => !r.published).length } };
}

export async function saveArticle(ctx: TenantCtx, id: string | null, b: z.infer<typeof ArticleInput>) {
  if (id) {
    const a = await db().kbArticle.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!a) throw notFound('Article');
    assertVersion(a.version, b.version, 'article');
    return db().kbArticle.update({ where: { id }, data: { title: b.title, body: b.body, category: b.category ?? null, tags: b.tags, kind: b.kind, published: b.published, version: { increment: 1 } } });
  }
  return db().kbArticle.create({ data: { tenantId: ctx.tenantId, title: b.title, body: b.body, category: b.category ?? null, tags: b.tags, kind: b.kind, published: b.published, createdBy: ctx.userId } });
}

export async function deleteArticle(ctx: TenantCtx, id: string) {
  const r = await db().kbArticle.deleteMany({ where: { id, tenantId: ctx.tenantId } });
  if (!r.count) throw notFound('Article');
}

// ---------------------------------------------------------------- public form and tracking

async function bySlug(slug: string) {
  const s = await db().supportSettings.findUnique({ where: { slug } });
  if (!s || !s.formEnabled) throw notFound('Request form');
  return s;
}

export async function publicForm(slug: string) {
  const s = await bySlug(slug);
  const settings = await getSettings({ tenantId: s.tenantId });
  const t = await db().tenant.findUnique({ where: { id: s.tenantId }, select: { name: true, profile: true } });
  const profile = (t?.profile ?? {}) as { address?: Record<string, string>; phone?: string; logoUrl?: string };
  const articles = await db().kbArticle.findMany({ where: { tenantId: s.tenantId, kind: 'article', published: true }, orderBy: { uses: 'desc' }, take: 6, select: { id: true, title: true, body: true } });
  return {
    business: { name: t?.name ?? '', phone: profile.phone ?? null, city: profile.address?.city ?? null, logoUrl: profile.logoUrl ?? null },
    title: settings.title, intro: settings.intro, categories: settings.categories.map((c) => ({ key: c.key, label: c.label })), articles,
  };
}

export const PublicTicketInput = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  phone: Phone,
  email: z.string().trim().email('Enter a valid email').max(160).nullish().or(z.literal('').transform(() => null)),
  category: z.string().trim().min(2).max(30),
  subject: z.string().trim().min(3, 'Say what it is about').max(200),
  description: z.string().trim().min(10, 'Tell us a little more (at least 10 letters)').max(3000),
  invoiceNumber: z.string().trim().max(40).nullish(),
  serial: z.string().trim().max(60).nullish(),
});

export async function publicCreate(slug: string, b: z.infer<typeof PublicTicketInput>) {
  const s = await bySlug(slug);
  const ctx = { kind: 'tenant', tenantId: s.tenantId, userId: null, scope: 'all' } as unknown as TenantCtx;
  const settings = await getSettings(ctx);
  if (!settings.categories.some((c) => c.key === b.category)) throw new AppError('VALIDATION_FAILED', 'Pick what it is about.', { fields: { category: 'Unknown' } });
  // A known customer is matched by mobile number; their invoice by its number
  const contact = await db().contact.findFirst({ where: { tenantId: s.tenantId, phone: { endsWith: b.phone }, type: { in: ['customer', 'lead'] } }, select: { id: true } });
  const invoice = b.invoiceNumber ? await db().salesDocument.findFirst({ where: { tenantId: s.tenantId, number: b.invoiceNumber, kind: 'invoice', ...(contact ? { contactId: contact.id } : {}) }, select: { id: true } }) : null;
  const t = await createTicket(ctx, TicketInput.parse({
    subject: b.subject, description: b.description, contactId: contact?.id ?? null, guestName: contact ? null : b.name, guestPhone: contact ? null : b.phone, guestEmail: contact ? null : b.email ?? null,
    channel: 'web', category: b.category, priority: 'medium', invoiceId: invoice?.id ?? null, serial: b.serial ?? null,
  }), { by: 'customer' });
  if (b.invoiceNumber && !invoice) await db().supportMessage.create({ data: { tenantId: s.tenantId, ticketId: t.id, kind: 'note', authorName: 'System', body: `The customer gave invoice number ${b.invoiceNumber}, which was not found.` } });
  return { number: t.number, token: t.publicToken };
}

/** What the customer sees on their private link: the status, the replies (never internal notes) */
export async function publicTicket(tok: string) {
  const t = await db().supportTicket.findUnique({ where: { publicToken: tok } });
  if (!t) throw notFound('Request');
  const [settings, tenant, msgs] = await Promise.all([
    getSettings({ tenantId: t.tenantId }),
    db().tenant.findUnique({ where: { id: t.tenantId }, select: { name: true, profile: true } }),
    db().supportMessage.findMany({ where: { ticketId: t.id, kind: { in: ['reply', 'customer', 'event'] } }, orderBy: { createdAt: 'asc' } }),
  ]);
  const profile = (tenant?.profile ?? {}) as { phone?: string; logoUrl?: string };
  return {
    business: { name: tenant?.name ?? '', phone: profile.phone ?? null, logoUrl: profile.logoUrl ?? null },
    number: t.number, subject: t.subject, status: t.status, statusLabel: STATUS_WORD[t.status as Status], createdAt: t.createdAt, resolvedAt: t.resolvedAt,
    category: settings.categories.find((c) => c.key === t.category)?.label ?? t.category, rating: t.rating, feedback: t.feedback,
    canRate: settings.askRating && DONE.includes(t.status as Status) && !t.rating, canReply: t.status !== 'closed',
    messages: msgs.filter((m) => m.kind !== 'event' || ['status', 'reopened', 'raised', 'created'].includes(m.body ?? '')).map((m) => ({
      id: m.id, kind: m.kind, at: m.createdAt, body: m.kind === 'event' ? (m.body === 'raised' || m.body === 'created' ? 'Request received' : `Now: ${STATUS_WORD[((m.meta ?? {}) as { to?: Status }).to ?? 'open']}`) : m.body,
      from: m.kind === 'customer' ? 'You' : m.kind === 'reply' ? tenant?.name ?? 'Support' : null,
    })),
  };
}

export const PublicReplyInput = z.object({ body: z.string().trim().min(2, 'Write something').max(3000) });

export async function publicReply(tok: string, b: z.infer<typeof PublicReplyInput>) {
  const t = await db().supportTicket.findUnique({ where: { publicToken: tok } });
  if (!t) throw notFound('Request');
  if (t.status === 'closed') throw new AppError('CONFLICT', 'This request is closed. Please raise a new one.');
  await db().supportMessage.create({ data: { tenantId: t.tenantId, ticketId: t.id, kind: 'customer', body: b.body, authorName: t.guestName ?? 'Customer' } });
  // A reply on a resolved or waiting request brings it back to the team
  if (t.status !== 'open' && t.status !== 'new') {
    const reopen = DONE.includes(t.status as Status);
    await db().supportTicket.update({ where: { id: t.id }, data: { status: 'open', version: { increment: 1 }, ...(reopen ? { resolvedAt: null, reopened: { increment: 1 } } : {}) } });
    await event({ tenantId: t.tenantId }, t.id, reopen ? 'reopened' : 'status', { from: t.status, to: 'open', byCustomer: true });
  }
  if (t.assigneeId) await notify(t.assigneeId, `Customer replied on ${t.number}`, b.body.slice(0, 120), `/app/m/support/${t.id}`);
  return publicTicket(tok);
}

export const RateInput = z.object({ rating: z.number().int().min(1).max(5), feedback: z.string().trim().max(1000).nullish() });

export async function publicRate(tok: string, b: z.infer<typeof RateInput>) {
  const t = await db().supportTicket.findUnique({ where: { publicToken: tok } });
  if (!t) throw notFound('Request');
  if (!DONE.includes(t.status as Status)) throw new AppError('CONFLICT', 'You can rate once the request is resolved.');
  if (t.rating) throw new AppError('CONFLICT', 'Thank you, this request is already rated.');
  await db().supportTicket.update({ where: { id: t.id }, data: { rating: b.rating, feedback: b.feedback ?? null } });
  await event({ tenantId: t.tenantId }, t.id, 'rated', { rating: b.rating });
  if (t.assigneeId) await notify(t.assigneeId, `${t.number} rated ${b.rating}/5`, b.feedback ?? undefined, `/app/m/support/${t.id}`);
  return publicTicket(tok);
}

// ---------------------------------------------------------------- report

/** Tickets in a period by category, agent, channel or day: how many, how fast, SLA met, rating */
export async function supportReport(ctx: TenantCtx, p: { from: string; to: string; by: 'category' | 'agent' | 'channel' | 'day' | 'customer' }) {
  const s = await getSettings(ctx);
  const res = await listTickets(ctx, TicketList.parse({ view: 'all', from: p.from, to: p.to, limit: 500 }));
  // listTickets pages; read every row of the period
  let rows = res.data;
  let cursor = res.nextCursor;
  while (cursor) { const more = await listTickets(ctx, TicketList.parse({ view: 'all', from: p.from, to: p.to, limit: 500, cursor })); rows = rows.concat(more.data); cursor = more.nextCursor; }
  const CH: Record<string, string> = { phone: 'Phone', whatsapp: 'WhatsApp', email: 'Email', walk_in: 'Walk-in', web: 'Online form', other: 'Other' };
  type G = { id: string; label: string; color?: string; total: number; open: number; resolved: number; overdue: number; firstMin: number[]; resolveMin: number[]; met: number; checked: number; ratings: number[] };
  const groups = new Map<string, G>();
  for (const r of rows) {
    const day = new Date(new Date(r.createdAt).getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const [id, label, color] = p.by === 'category' ? [r.category, s.categories.find((c) => c.key === r.category)?.label ?? r.category, s.categories.find((c) => c.key === r.category)?.color]
      : p.by === 'agent' ? [r.assigneeId ?? 'none', r.assignee?.name ?? 'Not assigned']
      : p.by === 'channel' ? [r.channel, CH[r.channel] ?? r.channel]
      : p.by === 'day' ? [day, day]
      : [r.contactId ?? `g:${r.customer}`, r.customer];
    const g: G = groups.get(id) ?? { id, label, color, total: 0, open: 0, resolved: 0, overdue: 0, firstMin: [], resolveMin: [], met: 0, checked: 0, ratings: [] };
    g.total++;
    if (OPEN.includes(r.status)) g.open++; else g.resolved++;
    if (r.overdue) g.overdue++;
    if (r.firstMin !== null) g.firstMin.push(r.firstMin);
    if (r.resolveMin !== null) g.resolveMin.push(r.resolveMin);
    if (r.metResolve !== null) { g.checked++; if (r.metResolve) g.met++; }
    if (r.rating) g.ratings.push(n(r.rating));
    groups.set(id, g);
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const data = [...groups.values()].map(({ firstMin, resolveMin, ratings, ...g }) => ({
    ...g, avgFirstMin: avg(firstMin), avgResolveMin: avg(resolveMin), slaMetPct: g.checked ? Math.round((g.met / g.checked) * 100) : null,
    csat: ratings.length ? Math.round((ratings.reduce((x, y) => x + y, 0) / ratings.length) * 10) / 10 : null, rated: ratings.length,
  })).sort((a, z) => (p.by === 'day' ? a.id.localeCompare(z.id) : z.total - a.total));
  const allFirst = rows.map((r) => r.firstMin).filter((x): x is number => x !== null);
  const allResolve = rows.map((r) => r.resolveMin).filter((x): x is number => x !== null);
  const checked = rows.filter((r) => r.metResolve !== null);
  const rated = rows.filter((r) => r.rating);
  return {
    data,
    sums: {
      total: rows.length, open: rows.filter((r) => OPEN.includes(r.status)).length, resolved: rows.filter((r) => DONE.includes(r.status)).length,
      avgFirstMin: avg(allFirst), avgResolveMin: avg(allResolve), slaMetPct: checked.length ? Math.round((checked.filter((r) => r.metResolve).length / checked.length) * 100) : null,
      csat: rated.length ? Math.round((rated.reduce((x, r) => x + n(r.rating), 0) / rated.length) * 10) / 10 : null, rated: rated.length,
    },
  };
}
