import { Prisma, type SalesDocKind } from '@prisma/client';
import { bundle, userNames, userPart, type Row } from '../../kernel/bundle';
import type { TenantCtx } from '../../kernel/context';
import { todayIST } from '../../kernel/gst';

// Sales lists (quotations, orders, challans, invoices, credit notes) in ONE database round trip
// (kernel/bundle): the rows within the user's data scope, the warehouse and people names, how much
// was received on each, and the counts and totals for the tabs and cards. Filters run here, so the
// counts always describe the whole list, not the page.

const DAY = 86_400_000;
const big = (v: unknown) => (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v ?? 0))));
const OPEN = ['issued', 'partially_paid'];
const LIVE_OUT = ['draft', 'cancelled', 'declined'];

export interface SalesListQuery {
  status?: string; unpaid?: 'true' | 'false'; overdue?: 'true' | 'false'; contactId?: string; sourceId?: string; locationId?: string;
  noteType?: 'return' | 'amount'; from?: string; to?: string; q?: string; limit: number; cursor?: string;
}

/** The SQL form of kernel/query scopeWhere for sales documents (owner = created_by, branch = branch_id) */
function scopeSql(ctx: TenantCtx) {
  const scope = ctx.scope ?? 'own';
  if (scope === 'all') return Prisma.empty;
  if (scope === 'branch') {
    if (!ctx.branchIds.length) return Prisma.empty;
    return Prisma.sql`and (d.branch_id in (${Prisma.join(ctx.branchIds.map((b) => Prisma.sql`${b}::uuid`))}) or d.branch_id is null)`;
  }
  return Prisma.sql`and d.created_by = ${ctx.userId}::uuid`;
}

export async function listSalesDocs(ctx: TenantCtx, kind: SalesDocKind, q: SalesListQuery) {
  const t = ctx.tenantId;
  const today = todayIST();
  const now = new Date(`${today}T00:00:00.000Z`);
  const b = await bundle({
    rows: Prisma.sql`
      select d.id, d.kind, d.status, d.number, d.contact_id, d.buyer, d.issue_date, d.due_date, d.total_paise, d.paid_paise, d.credited_paise,
        d.created_at, d.created_by, d.branch_id, d.note_type, d.source_id, d.source_number, d.source_type, d.note_reason,
        d.taxable_paise, d.cgst_paise, d.sgst_paise, d.igst_paise, d.discount_paise, d.location_id, d.eway_bill_no, d.irn, d.issued_at,
        (select count(*)::int from sales_document_lines l where l.document_id = d.id) as line_count,
        (select string_agg(l.description || ' ×' || trim(trailing '.' from trim(trailing '0' from l.quantity::text)), ', ' order by l.position)
           from (select * from sales_document_lines l2 where l2.document_id = d.id order by l2.position limit 4) l) as items
      from sales_documents d
      where d.tenant_id = ${t}::uuid and d.kind::text = ${kind} ${scopeSql(ctx)}
        ${q.contactId ? Prisma.sql`and d.contact_id = ${q.contactId}::uuid` : Prisma.empty}
        ${q.sourceId ? Prisma.sql`and d.source_id = ${q.sourceId}::uuid` : Prisma.empty}
      order by d.id desc limit 5000`,
    pays: Prisma.sql`
      select p.document_id, count(*)::int as n, max(p.paid_on) as last_paid_on from payments_received p
      where p.tenant_id = ${t}::uuid and p.document_id is not null and p.reverses_id is null and p.amount_paise > 0
        and not exists (select 1 from payments_received r where r.reverses_id = p.id)
      group by p.document_id`,
    places: Prisma.sql`select id, name from stock_locations where tenant_id = ${t}::uuid`,
    ...userPart(t),
  });
  const place = new Map(b.places.map((p) => [p.id as string, { id: p.id as string, name: p.name as string }]));
  const pay = new Map(b.pays.map((p) => [p.documentId as string, p]));
  const user = userNames(b);

  type Doc = Row & { id: string; status: string; totalPaise: bigint; paidPaise: bigint; balancePaise: bigint; overdue: boolean; issueDate: Date };
  const all: Doc[] = b.rows.map((d) => {
    const open = d.kind === 'invoice' && OPEN.includes(d.status);
    const overdue = open && !!d.dueDate && d.dueDate < now;
    const expired = d.kind === 'quotation' && ['draft', 'sent'].includes(d.status) && !!d.dueDate && d.dueDate < now;
    const p = pay.get(d.id);
    return {
      ...d,
      id: d.id as string, status: d.status as string, totalPaise: big(d.totalPaise), paidPaise: big(d.paidPaise), issueDate: d.issueDate as Date,
      location: d.locationId ? place.get(d.locationId) ?? null : null,
      balancePaise: d.kind === 'invoice' && !LIVE_OUT.includes(d.status) ? big(d.totalPaise) - big(d.paidPaise) : 0n,
      overdue, expired,
      overdueDays: overdue ? Math.round((now.getTime() - (d.dueDate as Date).getTime()) / DAY) : 0,
      paymentCount: p?.n ?? 0, lastPaidOn: p?.lastPaidOn ?? null,
      createdByName: d.createdBy ? user.get(d.createdBy) ?? null : null,
    };
  });

  // Tabs and cards: a count and a total per status, plus open, overdue and this month
  const monthStart = new Date(now.getTime() - (now.getUTCDate() - 1) * DAY);
  const counts: Record<string, number> = { all: all.length, unpaid: 0, overdue: 0, expired: 0 };
  const sums: Record<string, bigint> = { all: 0n, received: 0n, balance: 0n, overdue: 0n, month: 0n };
  for (const d of all) {
    counts[d.status] = (counts[d.status] ?? 0) + 1;
    sums[d.status] = (sums[d.status] ?? 0n) + d.totalPaise;
    if (OPEN.includes(d.status)) counts.unpaid++;
    if (d.overdue) { counts.overdue++; sums.overdue += d.balancePaise; }
    if (d.expired) counts.expired++;
    if (d.noteType) counts[d.noteType] = (counts[d.noteType] ?? 0) + 1;
    // Credit and debit notes: what is still open on them (credit left, or due)
    if ((d.kind === 'credit_note' || d.kind === 'debit_note') && d.status !== 'cancelled') sums.open = (sums.open ?? 0n) + d.totalPaise - d.paidPaise;
    if (!LIVE_OUT.includes(d.status)) {
      sums.all += d.totalPaise; sums.received += d.paidPaise; sums.balance += d.balancePaise;
      if (d.issueDate >= monthStart) sums.month += d.totalPaise;
    }
  }
  counts.customers = new Set(all.filter((d) => !LIVE_OUT.includes(d.status)).map((d) => d.contactId)).size;

  const s = q.q?.toLowerCase();
  const digits = q.q?.replace(/\s/g, '');
  const rows = all.filter((d) =>
    (!q.status || d.status === q.status) && (q.unpaid !== 'true' || OPEN.includes(d.status)) && (q.overdue !== 'true' || d.overdue)
    && (!q.locationId || d.locationId === q.locationId) && (!q.noteType || d.noteType === q.noteType)
    && (!q.from || d.issueDate >= new Date(`${q.from}T00:00:00.000Z`)) && (!q.to || d.issueDate <= new Date(`${q.to}T00:00:00.000Z`))
    && (!s || (d.number ?? '').toLowerCase().includes(s) || (d.buyer?.name ?? '').toLowerCase().includes(s) || (!!digits && (d.buyer?.phone ?? '').includes(digits))
      || (d.buyer?.gstin ?? '').includes(q.q!.toUpperCase()) || (d.items ?? '').toLowerCase().includes(s)));
  const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor) + 1 : 0;
  const data = rows.slice(start, start + q.limit);
  return { data, nextCursor: start + q.limit < rows.length ? data[data.length - 1]?.id ?? null : null, total: rows.length, counts, sums };
}

// ---------------------------------------------------------------- customers

export interface CustomerListQuery { q?: string; active: 'true' | 'false' | 'all'; dues?: 'owes' | 'overdue'; limit: number; cursor?: string }

/** Customers with what each bought, paid and still owes, in one round trip. Money shows only to
 *  people who may see dues (`withDues`). Owner scope = created by or owned by the user. */
export async function listCustomers(ctx: TenantCtx, q: CustomerListQuery, withDues: boolean) {
  const t = ctx.tenantId;
  const today = todayIST();
  const scope = ctx.scope ?? 'own';
  const scoped = scope === 'all' ? Prisma.empty
    : scope === 'branch' ? (ctx.branchIds.length ? Prisma.sql`and (c.branch_id in (${Prisma.join(ctx.branchIds.map((b) => Prisma.sql`${b}::uuid`))}) or c.branch_id is null)` : Prisma.empty)
    : Prisma.sql`and (c.created_by = ${ctx.userId}::uuid or c.owner_id = ${ctx.userId}::uuid)`;
  const b = await bundle({
    rows: Prisma.sql`select c.* from contacts c where c.tenant_id = ${t}::uuid and c.type = 'customer' ${scoped} order by c.id desc`,
    docs: Prisma.sql`
      select contact_id,
        sum(case when kind = 'credit_note' then -total_paise else total_paise end) as docs_paise,
        count(*) filter (where kind = 'invoice')::int as invoice_count,
        coalesce(sum(total_paise) filter (where kind = 'invoice'), 0) as billed_paise,
        coalesce(sum(total_paise) filter (where kind = 'invoice' and issue_date >= date_trunc('month', ${today}::date)), 0) as month_paise,
        coalesce(sum(total_paise - paid_paise) filter (where kind = 'invoice' and status in ('issued', 'partially_paid') and due_date < ${today}::date), 0) as overdue_paise,
        count(*) filter (where kind = 'invoice' and status in ('issued', 'partially_paid') and due_date < ${today}::date)::int as overdue_count,
        max(issue_date) filter (where kind = 'invoice') as last_invoice_on
      from sales_documents
      where tenant_id = ${t}::uuid and contact_id is not null and kind in ('invoice', 'credit_note', 'opening_balance', 'debit_note') and status not in ('draft', 'cancelled')
      group by contact_id`,
    paid: Prisma.sql`select contact_id, sum(amount_paise) as paid_paise, max(paid_on) filter (where amount_paise > 0) as last_paid_on from payments_received where tenant_id = ${t}::uuid and contact_id is not null group by contact_id`,
  });
  const docs = new Map(b.docs.map((d) => [d.contactId as string, d]));
  const paid = new Map(b.paid.map((p) => [p.contactId as string, p]));
  type Cust = Row & { id: string; isActive: boolean; balancePaise: bigint; overduePaise: bigint; monthPaise: bigint; billedPaise: bigint };
  const all: Cust[] = b.rows.map((c) => {
    const d = docs.get(c.id);
    const p = paid.get(c.id);
    const money = withDues ? {
      balancePaise: big(d?.docsPaise) - big(p?.paidPaise), overduePaise: big(d?.overduePaise), overdueCount: d?.overdueCount ?? 0,
      billedPaise: big(d?.billedPaise), receivedPaise: big(p?.paidPaise), monthPaise: big(d?.monthPaise),
    } : { balancePaise: 0n, overduePaise: 0n, overdueCount: 0, billedPaise: 0n, receivedPaise: 0n, monthPaise: 0n };
    return { ...c, id: c.id as string, isActive: c.isActive as boolean, ...money, invoiceCount: d?.invoiceCount ?? 0, lastInvoiceOn: d?.lastInvoiceOn ?? null, lastPaidOn: withDues ? p?.lastPaidOn ?? null : null };
  });
  const active = all.filter((c) => c.isActive);
  const counts = { all: all.length, active: active.length, inactive: all.length - active.length, owes: active.filter((c) => c.balancePaise > 0n).length, overdue: active.filter((c) => c.overduePaise > 0n).length };
  const sums = {
    balance: all.reduce((a, c) => a + (c.balancePaise > 0n ? c.balancePaise : 0n), 0n), overdue: all.reduce((a, c) => a + c.overduePaise, 0n),
    month: all.reduce((a, c) => a + c.monthPaise, 0n), billed: all.reduce((a, c) => a + c.billedPaise, 0n),
    advance: all.reduce((a, c) => a + (c.balancePaise < 0n ? -c.balancePaise : 0n), 0n),
  };
  const s = q.q?.toLowerCase();
  const rows = all.filter((c) =>
    (q.active === 'all' || c.isActive === (q.active === 'true'))
    && (q.dues !== 'owes' || c.balancePaise > 0n) && (q.dues !== 'overdue' || c.overduePaise > 0n)
    && (!s || [c.name, c.companyName, c.phone, c.email, c.gstin].some((v) => typeof v === 'string' && v.toLowerCase().includes(s))));
  const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor) + 1 : 0;
  const data = rows.slice(start, start + q.limit);
  return { data, nextCursor: start + q.limit < rows.length ? data[data.length - 1]?.id ?? null : null, total: rows.length, counts, ...(withDues ? { sums } : {}) };
}
