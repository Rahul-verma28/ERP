import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { bundle, userNames, userPart, type Row } from '../../kernel/bundle';
import { notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { todayIST } from '../../kernel/gst';
import { DateStr } from '../../kernel/query';

// Purchase lists, each read in ONE database round trip (kernel/bundle): the rows, the names they
// point to, and the counts and totals for the tabs and cards over the list. Filters run here, so
// the counts always describe the whole list, not the page.

const DAY = 86_400_000;
const today = () => new Date(`${todayIST()}T00:00:00.000Z`);
const big = (v: unknown) => (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v ?? 0))));
const text = (...v: unknown[]) => v.filter((x) => typeof x === 'string' && x).join(' ').toLowerCase();
const inRange = (d: Date, from?: string, to?: string) => (!from || d >= new Date(`${from}T00:00:00.000Z`)) && (!to || d <= new Date(`${to}T00:00:00.000Z`));
/** Cursor paging over rows already in memory: the cursor is the id of the last row shown */
function page<T extends { id: string }>(rows: T[], limit: number, cursor?: string) {
  const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
  const data = rows.slice(start, start + limit);
  return { data, nextCursor: start + limit < rows.length ? data[data.length - 1]?.id ?? null : null, total: rows.length };
}

// ---------------------------------------------------------------- invoices, returns, orders, receipts

export const PurchaseList = z.object({
  kind: z.enum(['purchase_order', 'goods_receipt', 'purchase_bill', 'purchase_return']),
  status: z.string().max(16).optional(),
  contactId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: DateStr.optional(),
  to: DateStr.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

export async function listPurchases(ctx: TenantCtx, q: z.infer<typeof PurchaseList>) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`
      select d.id, d.kind, d.status, d.number, d.contact_id, d.supplier, d.supplier_ref, d.supplier_date, d.issue_date, d.due_date,
        d.reverse_charge, d.location_id, d.subtotal_paise, d.discount_paise, d.taxable_paise, d.cgst_paise, d.sgst_paise, d.igst_paise,
        d.charges_paise, d.round_off_paise, d.total_paise, d.paid_paise, d.returned_paise, d.source_type, d.source_id, d.source_number,
        d.return_reason, d.notes, d.cancel_reason, d.created_by, d.created_at, d.version,
        (select coalesce(json_agg(json_build_object('description', l.description, 'quantity', l.quantity, 'unit', l.unit) order by l.position), '[]'::json)
           from purchase_document_lines l where l.document_id = d.id) as lines
      from purchase_documents d
      where d.tenant_id = ${t}::uuid and d.kind = ${q.kind} ${q.contactId ? Prisma.sql`and d.contact_id = ${q.contactId}::uuid` : Prisma.empty}
      order by d.id desc limit 5000`,
    sup: Prisma.sql`select id, email, phone from contacts where tenant_id = ${t}::uuid and type = 'supplier'`,
    places: Prisma.sql`select id, name from stock_locations where tenant_id = ${t}::uuid`,
    pays: Prisma.sql`
      select p.document_id, count(*)::int as n, max(p.paid_on) as last_paid_on from supplier_payments p
      where p.tenant_id = ${t}::uuid and p.reverses_id is null and p.amount_paise > 0
        and not exists (select 1 from supplier_payments r where r.reverses_id = p.id)
      group by p.document_id`,
    ...userPart(t),
  });
  const sup = new Map(b.sup.map((c) => [c.id as string, c]));
  const place = new Map(b.places.map((p) => [p.id as string, { id: p.id as string, name: p.name as string }]));
  const pay = new Map(b.pays.map((p) => [p.documentId as string, p]));
  const user = userNames(b);
  const now = today();

  type Doc = Row & { id: string; status: string; balancePaise: bigint; overdue: boolean };
  const all: Doc[] = b.rows.map((d) => {
    const owes = d.kind === 'purchase_bill' && d.status !== 'cancelled' && d.status !== 'draft';
    const balancePaise = owes ? big(d.totalPaise) - big(d.paidPaise) - big(d.returnedPaise) : 0n;
    const overdue = d.kind === 'purchase_bill' && !!d.dueDate && d.dueDate < now && (d.status === 'unpaid' || d.status === 'part_paid');
    const c = sup.get(d.contactId);
    const p = pay.get(d.id);
    return {
      ...d,
      id: d.id as string,
      status: d.status as string,
      supplier: { ...(d.supplier ?? {}), email: c?.email ?? null, phone: c?.phone ?? null },
      location: d.locationId ? place.get(d.locationId) ?? null : null,
      balancePaise,
      overdue,
      overdueDays: overdue ? Math.round((now.getTime() - (d.dueDate as Date).getTime()) / DAY) : 0,
      taxPaise: big(d.cgstPaise) + big(d.sgstPaise) + big(d.igstPaise),
      lineCount: (d.lines as unknown[]).length,
      paymentCount: p?.n ?? 0,
      lastPaidOn: p?.lastPaidOn ?? null,
      createdByName: d.createdBy ? user.get(d.createdBy) ?? null : null,
    };
  });

  // Tabs: one count (and one total) per status, plus overdue and "to receive" for orders
  const counts: Record<string, number> = { all: all.length };
  const sums: Record<string, bigint> = { all: 0n, paid: 0n, balance: 0n, overdue: 0n };
  for (const d of all) {
    counts[d.status] = (counts[d.status] ?? 0) + 1;
    sums[d.status] = (sums[d.status] ?? 0n) + big(d.totalPaise);
    if (d.status !== 'cancelled' && d.status !== 'draft') { sums.all += big(d.totalPaise); sums.paid += big(d.paidPaise); sums.balance += d.balancePaise; }
    if (d.overdue) { counts.overdue = (counts.overdue ?? 0) + 1; sums.overdue += d.balancePaise; }
    if (d.status === 'open' || d.status === 'part_received') counts.pending = (counts.pending ?? 0) + 1;
    if (d.issueDate >= new Date(now.getTime() - (now.getUTCDate() - 1) * DAY)) sums.month = (sums.month ?? 0n) + (d.status === 'cancelled' || d.status === 'draft' ? 0n : big(d.totalPaise));
  }

  const s = q.q?.toLowerCase();
  const rows = all.filter((d) =>
    (q.status === 'overdue' ? d.overdue : q.status === 'pending' ? d.status === 'open' || d.status === 'part_received' : !q.status || d.status === q.status)
    && (!q.locationId || d.locationId === q.locationId)
    && inRange(d.issueDate, q.from, q.to)
    && (!s || text(d.number, d.supplierRef, d.sourceNumber, d.supplier?.name, d.supplier?.gstin, d.supplier.email).includes(s)));
  return { ...page(rows, q.limit, q.cursor), counts, sums };
}

// ---------------------------------------------------------------- suppliers

export const SupplierList = z.object({
  q: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  /** dues = you owe them something, overdue = some of it is past due */
  owing: z.enum(['dues', 'overdue']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

/** Per supplier: posted invoices, what they came to, what is paid, returned, still owed and overdue */
const supplierStats = (t: string, one?: string) => Prisma.sql`
  select contact_id, count(*)::int as bill_count, sum(total_paise) as billed_paise, sum(paid_paise) as paid_paise, sum(returned_paise) as returned_paise,
    sum(total_paise - paid_paise - returned_paise) as due_paise,
    sum(case when due_date < ${todayIST()}::date and status in ('unpaid', 'part_paid') then total_paise - paid_paise - returned_paise else 0 end) as overdue_paise,
    count(*) filter (where due_date < ${todayIST()}::date and status in ('unpaid', 'part_paid'))::int as overdue_count,
    sum(case when issue_date >= date_trunc('month', ${todayIST()}::date) then total_paise else 0 end) as month_paise,
    max(issue_date) as last_bill_on
  from purchase_documents
  where tenant_id = ${t}::uuid and kind = 'purchase_bill' and status not in ('cancelled', 'draft') ${one ? Prisma.sql`and contact_id = ${one}::uuid` : Prisma.empty}
  group by contact_id`;

type SupplierRow = Row & { id: string; balancePaise: bigint; overduePaise: bigint; monthPaise: bigint; billedPaise: bigint };
function supplierRow(c: Row, s: Row | undefined): SupplierRow {
  return {
    ...c,
    id: c.id as string,
    billCount: s?.billCount ?? 0,
    billedPaise: big(s?.billedPaise), paidPaise: big(s?.paidPaise), returnedPaise: big(s?.returnedPaise),
    balancePaise: big(s?.duePaise), overduePaise: big(s?.overduePaise), overdueCount: s?.overdueCount ?? 0,
    monthPaise: big(s?.monthPaise), lastBillOn: s?.lastBillOn ?? null,
  };
}

export async function listSuppliers(ctx: TenantCtx, q: z.infer<typeof SupplierList>) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`select * from contacts where tenant_id = ${t}::uuid and type = 'supplier' order by lower(coalesce(company_name, name))`,
    stats: supplierStats(t),
  });
  const stat = new Map(b.stats.map((s) => [s.contactId as string, s]));
  const all = b.rows.map((c) => supplierRow(c, stat.get(c.id)));
  const active = all.filter((c) => c.isActive);
  const counts = {
    all: all.length, active: active.length, inactive: all.length - active.length,
    dues: active.filter((c) => c.balancePaise > 0n).length, overdue: all.filter((c) => c.overduePaise > 0n).length,
  };
  const sums = {
    balance: all.reduce((a, c) => a + c.balancePaise, 0n), overdue: all.reduce((a, c) => a + c.overduePaise, 0n),
    month: all.reduce((a, c) => a + c.monthPaise, 0n), billed: all.reduce((a, c) => a + c.billedPaise, 0n),
  };
  const s = q.q?.toLowerCase();
  const rows = all.filter((c) =>
    (q.active === 'all' || c.isActive === (q.active === 'true'))
    && (q.owing !== 'dues' || c.balancePaise > 0n) && (q.owing !== 'overdue' || c.overduePaise > 0n)
    && (!s || text(c.name, c.companyName, c.phone, c.email, c.gstin).includes(s) || (!!c.gstin && c.gstin.includes(q.q!.toUpperCase()))));
  return { ...page(rows, q.limit, q.cursor), counts, sums };
}

/** One supplier with everything its page shows, in one round trip: totals for the period, their
 *  invoices, returns and payments in it, and what is owed overall. */
export async function supplierOverview(ctx: TenantCtx, id: string, range: { from?: string; to?: string }) {
  const t = ctx.tenantId;
  const from = range.from ?? '1900-01-01';
  const to = range.to ?? '2999-12-31';
  const b = await bundle({
    sup: Prisma.sql`select * from contacts where tenant_id = ${t}::uuid and id = ${id}::uuid and type = 'supplier'`,
    stats: supplierStats(t, id),
    docs: Prisma.sql`
      select d.id, d.kind, d.status, d.number, d.supplier_ref, d.supplier_date, d.issue_date, d.due_date, d.location_id, d.taxable_paise,
        d.cgst_paise + d.sgst_paise + d.igst_paise as tax_paise, d.total_paise, d.paid_paise, d.returned_paise, d.source_id, d.source_number, d.return_reason,
        (select count(*)::int from purchase_document_lines l where l.document_id = d.id) as line_count,
        (select string_agg(l.description || ' ×' || trim(trailing '.' from trim(trailing '0' from l.quantity::text)), ', ' order by l.position) from purchase_document_lines l where l.document_id = d.id) as items
      from purchase_documents d
      where d.tenant_id = ${t}::uuid and d.contact_id = ${id}::uuid and d.kind in ('purchase_bill', 'purchase_return')
        and d.issue_date between ${from}::date and ${to}::date
      order by d.issue_date desc, d.id desc`,
    pays: Prisma.sql`
      select p.id, p.number, p.paid_on, p.method, p.reference, p.amount_paise, p.document_id, d.number as bill_number, d.supplier_ref as bill_ref,
        a.name as account_name, r.number as reversal_number
      from supplier_payments p
      left join purchase_documents d on d.id = p.document_id
      left join fin_accounts a on a.id = p.account_id
      left join supplier_payments r on r.reverses_id = p.id
      where p.tenant_id = ${t}::uuid and p.contact_id = ${id}::uuid and p.reverses_id is null and p.amount_paise > 0
        and p.paid_on between ${from}::date and ${to}::date
      order by p.paid_on desc, p.id desc`,
    places: Prisma.sql`select id, name from stock_locations where tenant_id = ${t}::uuid`,
  });
  const c = b.sup[0];
  if (!c) throw notFound('Supplier');
  const supplier = supplierRow(c, b.stats[0]);
  const place = new Map(b.places.map((p) => [p.id as string, p.name as string]));
  const now = today();
  const docs: Row[] = b.docs.map((d) => ({
    ...d,
    location: d.locationId ? place.get(d.locationId) ?? null : null,
    balancePaise: d.kind === 'purchase_bill' && d.status !== 'cancelled' && d.status !== 'draft' ? big(d.totalPaise) - big(d.paidPaise) - big(d.returnedPaise) : 0n,
    overdue: d.kind === 'purchase_bill' && !!d.dueDate && d.dueDate < now && (d.status === 'unpaid' || d.status === 'part_paid'),
  }));
  // One payment can sit on several invoices: one row each, sharing the number
  const payMap = new Map<string, { id: string; number: string; paidOn: Date; method: string; reference: string | null; accountName: string | null; amountPaise: bigint; reversed: boolean; bills: string[] }>();
  for (const p of b.pays) {
    const g = payMap.get(p.number) ?? { id: p.id, number: p.number, paidOn: p.paidOn, method: p.method, reference: p.reference, accountName: p.accountName, amountPaise: 0n, reversed: false, bills: [] as string[] };
    g.amountPaise += big(p.amountPaise);
    g.reversed ||= !!p.reversalNumber;
    g.bills.push(p.billRef ?? p.billNumber);
    payMap.set(p.number, g);
  }
  const payments = [...payMap.values()];
  const bills = docs.filter((d) => d.kind === 'purchase_bill');
  const returns = docs.filter((d) => d.kind === 'purchase_return');
  const live = (s: string) => s !== 'cancelled' && s !== 'draft';
  return {
    supplier,
    totals: {
      billedPaise: bills.filter((d) => live(d.status)).reduce((a, d) => a + big(d.totalPaise), 0n),
      returnedPaise: returns.filter((d) => d.status === 'issued').reduce((a, d) => a + big(d.totalPaise), 0n),
      paidPaise: payments.filter((p) => !p.reversed).reduce((a, p) => a + p.amountPaise, 0n),
      balancePaise: supplier.balancePaise,
      overduePaise: supplier.overduePaise,
    },
    bills, returns, payments,
  };
}

// ---------------------------------------------------------------- payments made

export const PaymentList = z.object({
  from: DateStr.optional(),
  to: DateStr.optional(),
  method: z.enum(['cash', 'upi', 'card', 'bank', 'cheque', 'other']).optional(),
  contactId: z.string().uuid().optional(),
});

/** Payments made, newest first (the last 2,000 rows, searched and paged on the screen). One payment
 *  can sit on several invoices: one row each sharing the number, grouped back here. */
export async function listSupplierPayments(ctx: TenantCtx, q: z.infer<typeof PaymentList>) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`
      select p.id, p.number, p.paid_on, p.method, p.reference, p.amount_paise, p.contact_id, p.document_id, p.account_id, p.created_by, p.created_at,
        c.name as supplier_name, c.company_name, c.phone as supplier_phone, c.gstin as supplier_gstin,
        d.number as bill_number, d.supplier_ref as bill_ref, d.total_paise as bill_total_paise,
        a.name as account_name, a.kind as account_kind, r.number as reversal_number, r.paid_on as reversal_on
      from supplier_payments p
      join contacts c on c.id = p.contact_id
      left join purchase_documents d on d.id = p.document_id
      left join fin_accounts a on a.id = p.account_id
      left join supplier_payments r on r.reverses_id = p.id
      where p.tenant_id = ${t}::uuid and p.reverses_id is null and p.amount_paise > 0
        ${q.contactId ? Prisma.sql`and p.contact_id = ${q.contactId}::uuid` : Prisma.empty}
        ${q.method ? Prisma.sql`and p.method = ${q.method}` : Prisma.empty}
        ${q.from ? Prisma.sql`and p.paid_on >= ${q.from}::date` : Prisma.empty}
        ${q.to ? Prisma.sql`and p.paid_on <= ${q.to}::date` : Prisma.empty}
      order by p.id desc limit 2000`,
    ...userPart(t),
  });
  const user = userNames(b);
  type Pay = {
    id: string; number: string; paidOn: Date; method: string; reference: string | null; contactId: string; supplier: string; supplierPhone: string | null;
    supplierGstin: string | null; accountId: string | null; accountName: string | null; accountKind: string | null; createdByName: string | null; createdAt: Date;
    amountPaise: bigint; reversed: boolean; reversal: { number: string; paidOn: Date } | null;
    appliedTo: { id: string; paymentId: string; number: string | null; supplierRef: string | null; billTotalPaise: bigint; amountPaise: bigint }[];
  };
  const out = new Map<string, Pay>();
  for (const r of b.rows) {
    const key = `${r.contactId}|${r.number}`;
    const g = out.get(key) ?? {
      id: r.id, number: r.number, paidOn: r.paidOn, method: r.method, reference: r.reference, contactId: r.contactId, supplier: r.companyName || r.supplierName,
      supplierPhone: r.supplierPhone ?? null, supplierGstin: r.supplierGstin ?? null, accountId: r.accountId ?? null, accountName: r.accountName ?? null,
      accountKind: r.accountKind ?? null, createdByName: r.createdBy ? user.get(r.createdBy) ?? null : null, createdAt: r.createdAt,
      amountPaise: 0n, reversed: false, reversal: null, appliedTo: [] as Pay['appliedTo'],
    };
    g.amountPaise += big(r.amountPaise);
    g.appliedTo.push({ id: r.documentId, paymentId: r.id, number: r.billNumber ?? null, supplierRef: r.billRef ?? null, billTotalPaise: big(r.billTotalPaise), amountPaise: big(r.amountPaise) });
    if (r.reversalNumber) { g.reversed = true; g.reversal = { number: r.reversalNumber, paidOn: r.reversalOn }; }
    out.set(key, g);
  }
  return { data: [...out.values()] };
}
