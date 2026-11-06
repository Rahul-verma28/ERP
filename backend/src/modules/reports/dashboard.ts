import type { PermissionScope, Prisma } from '@prisma/client';
import { db, prisma, withTenant } from '../../kernel/db';
import type { TenantCtx } from '../../kernel/context';
import { scopeWhere } from '../../kernel/query';
import { dateOnly, todayIST } from '../../kernel/gst';
import { SETUP_STEPS, withDefaults, type SetupState } from '../../contracts/workspace';
import { DASHBOARD_TABS, addDays, bucketsFor, daysBetween, gstr3bDue, previousRange, type DashboardTab } from '../../contracts/dashboard';
import { getRolePermissions } from '../access/service';
import { getEntitlements } from '../subscription/entitlements';

// Phase 3 dashboard (wireframes 5.1–5.8): one endpoint per tab, every figure filtered by the
// module's data scope and the chosen branch, with the same figures for the previous period.
// Each widget is computed on its own; a failing one returns { error } and the rest still load.

const DAY = 86_400_000;
const IST = 330 * 60_000;
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
/** Start of an India-time day as a timestamp */
const istStart = (d: string) => new Date(dateOnly(d).getTime() - IST);
const dateIn = (r: Range) => ({ gte: dateOnly(r.from), lte: dateOnly(r.to) });
const timeIn = (r: Range) => ({ gte: istStart(r.from), lt: istStart(addDays(r.to, 1)) });
const istDate = (t: Date) => new Date(t.getTime() + IST).toISOString().slice(0, 10);
const istHour = (t: Date) => new Date(t.getTime() + IST).getUTCHours();

export interface Range {
  from: string;
  to: string;
}

export interface DashboardInput {
  range: Range;
  compare: boolean;
  branchId: string | null;
}

type Scoped = (key: string) => TenantCtx | null;

export async function scoper(ctx: TenantCtx): Promise<{ scoped: Scoped; readOnly: (module: string) => boolean }> {
  const [perms, ent] = await Promise.all([getRolePermissions(ctx.roleId), getEntitlements(ctx.tenantId)]);
  return {
    scoped: (key) => {
      const scope = perms.get(key) as PermissionScope | undefined;
      const module = key.split('.')[0] as keyof typeof ent.modules;
      if (!scope || (module in ent.modules && ent.modules[module].status === 'inactive')) return null;
      return { ...ctx, scope };
    },
    readOnly: (module) => ent.modules[module as keyof typeof ent.modules]?.status === 'read_only',
  };
}

async function safe<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    console.error('[dashboard] widget failed', e);
    return { error: 'This widget could not load.' };
  }
}

/** Setup steps the owner hasn't done or skipped, while the wizard isn't finished */
function readSetupSteps(onboarding: unknown) {
  const setup = ((onboarding ?? {}) as { setup?: SetupState }).setup;
  if (!setup || setup.completedAt || setup.cardDismissedAt) return [];
  return SETUP_STEPS.filter((st) => !setup.steps?.[st.key]);
}

/**
 * Each widget runs in its own tenant transaction so they load side by side (one transaction
 * means one connection, and every query a round trip to the database one after another).
 */
const runner = (ctx: TenantCtx) => <T>(fn: () => Promise<T>) => safe(() => withTenant(ctx, fn));

async function settle(o: Record<string, unknown>) {
  const entries = Object.entries(o);
  const values = await Promise.all(entries.map(([, v]) => v));
  return Object.fromEntries(entries.map(([k], idx) => [k, values[idx]]));
}

const change = (now: number, prev: number | null) => (prev === null ? null : { prev, delta: now - prev, pct: prev ? Math.round(((now - prev) / prev) * 100) : null });

// ── Shared queries ──

// Debit notes add to sales the way credit notes take away
const LIVE_INVOICE = { kind: { in: ['invoice' as const, 'debit_note' as const] }, status: { in: ['issued' as const, 'partially_paid' as const, 'paid' as const] } };
const LIVE_CREDIT_NOTE = { kind: 'credit_note' as const, status: 'issued' as const };
// Opening balances are owed too; they have no due date, so overdue lists never pick them up
const OPEN_INVOICE = { kind: { in: ['invoice' as const, 'opening_balance' as const, 'debit_note' as const] }, status: { in: ['issued' as const, 'partially_paid' as const] } };

function docWhere(c: TenantCtx, branchId: string | null): Prisma.SalesDocumentWhereInput {
  return { AND: [scopeWhere(c, { owner: ['createdBy'], branch: 'branchId' }), branchId ? { branchId } : {}] };
}
function payWhere(c: TenantCtx, branchId: string | null): Prisma.PaymentWhereInput {
  return { AND: [scopeWhere(c, { owner: ['createdBy'] }), branchId ? { document: { branchId } } : {}] };
}
function expWhere(c: TenantCtx, branchId: string | null): Prisma.ExpenseWhereInput {
  return { AND: [scopeWhere(c, { owner: ['createdBy'], branch: 'branchId' }), branchId ? { branchId } : {}] };
}
function apptWhere(c: TenantCtx, branchId: string | null): Prisma.AppointmentWhereInput {
  return { AND: [scopeWhere(c, { owner: ['createdBy', 'staffId'], branch: 'branchId' }), branchId ? { branchId } : {}] };
}

async function invoiced(c: TenantCtx, b: string | null, r: Range) {
  const a = await db().salesDocument.aggregate({ where: { AND: [docWhere(c, b), LIVE_INVOICE, { issueDate: dateIn(r) }] }, _sum: { totalPaise: true, taxablePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true }, _count: true });
  // Credit notes take sales and GST back on the day they are issued
  const cn = await db().salesDocument.aggregate({ where: { AND: [docWhere(c, b), LIVE_CREDIT_NOTE, { issueDate: dateIn(r) }] }, _sum: { totalPaise: true, taxablePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } });
  return { total: n(a._sum.totalPaise) - n(cn._sum.totalPaise), taxable: n(a._sum.taxablePaise) - n(cn._sum.taxablePaise), cgst: n(a._sum.cgstPaise) - n(cn._sum.cgstPaise), sgst: n(a._sum.sgstPaise) - n(cn._sum.sgstPaise), igst: n(a._sum.igstPaise) - n(cn._sum.igstPaise), count: a._count };
}
async function collected(c: TenantCtx, b: string | null, r: Range) {
  const a = await db().payment.aggregate({ where: { AND: [payWhere(c, b), { paidOn: dateIn(r) }] }, _sum: { amountPaise: true }, _count: true });
  return { total: n(a._sum.amountPaise), count: a._count };
}
async function spent(c: TenantCtx, b: string | null, r: Range) {
  const a = await db().expense.aggregate({ where: { AND: [expWhere(c, b), { paidOn: dateIn(r) }] }, _sum: { amountPaise: true }, _count: true });
  return { total: n(a._sum.amountPaise), count: a._count };
}
async function outstanding(c: TenantCtx, b: string | null) {
  const today = todayIST();
  const [a, overdue, oldest] = await Promise.all([
    db().salesDocument.aggregate({ where: { AND: [docWhere(c, b), OPEN_INVOICE] }, _sum: { totalPaise: true, paidPaise: true }, _count: true }),
    db().salesDocument.count({ where: { AND: [docWhere(c, b), OPEN_INVOICE, { dueDate: { lt: dateOnly(today) } }] } }),
    db().salesDocument.findFirst({ where: { AND: [docWhere(c, b), OPEN_INVOICE] }, orderBy: { issueDate: 'asc' }, select: { issueDate: true } }),
  ]);
  return {
    total: n(a._sum.totalPaise) - n(a._sum.paidPaise),
    count: a._count,
    overdue,
    oldestDays: oldest ? Math.round((dateOnly(today).getTime() - oldest.issueDate.getTime()) / DAY) : null,
  };
}

async function trend(c: TenantCtx, b: string | null, r: Range, canPay: TenantCtx | null) {
  const buckets = bucketsFor(r);
  const [inv, credit, pay] = await Promise.all([
    db().salesDocument.groupBy({ by: ['issueDate'], where: { AND: [docWhere(c, b), LIVE_INVOICE, { issueDate: dateIn(r) }] }, _sum: { totalPaise: true } }),
    db().salesDocument.groupBy({ by: ['issueDate'], where: { AND: [docWhere(c, b), LIVE_CREDIT_NOTE, { issueDate: dateIn(r) }] }, _sum: { totalPaise: true } }),
    canPay ? db().payment.groupBy({ by: ['paidOn'], where: { AND: [payWhere(canPay, b), { paidOn: dateIn(r) }] }, _sum: { amountPaise: true } }) : Promise.resolve([]),
  ]);
  const into = (rows: { d: string; v: number }[]) => buckets.map((k) => rows.filter((x) => x.d >= k.from && x.d <= k.to).reduce((s, x) => s + x.v, 0));
  const invoicedB = into([...inv.map((x) => ({ d: x.issueDate.toISOString().slice(0, 10), v: n(x._sum.totalPaise) })), ...credit.map((x) => ({ d: x.issueDate.toISOString().slice(0, 10), v: -n(x._sum.totalPaise) }))]);
  const collectedB = into((pay as { paidOn: Date; _sum: { amountPaise: bigint | null } }[]).map((x) => ({ d: x.paidOn.toISOString().slice(0, 10), v: n(x._sum.amountPaise) })));
  return { buckets: buckets.map((k, i) => ({ label: k.label, from: k.from, to: k.to, invoiced: invoicedB[i], collected: collectedB[i] })), hasCollected: !!canPay };
}

const userNames = async (ids: (string | null | undefined)[]) => {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(rows.map((u) => [u.id, u.name]));
};
const buyerName = (b: unknown) => ((b ?? {}) as { name?: string }).name ?? 'Customer';

// ── Tabs ──

export async function overview(ctx: TenantCtx, s: Scoped, i: DashboardInput) {
  const run = runner(ctx);
  const { range: r, compare, branchId: b } = i;
  const prev = previousRange(r);
  const inv = s('billing.invoice.view');
  const pay = s('billing.payment.view');
  const exp = s('finance.expense.view');
  const appt = s('bookings.appointment.view');
  const fu = s('crm.activity.view');
  const task = s('tasks.task.view');
  const today = todayIST();
  const out: Record<string, unknown> = {};

  // The four numbers come from different tables: each in its own transaction
  const own = <T>(fn: () => Promise<T>) => withTenant(ctx, fn);
  out.kpis = safe(async () => {
    const [sNow, sPrev, cNow, cPrev, due, eNow, ePrev, methods] = await Promise.all([
      inv ? own(() => invoiced(inv, b, r)) : null,
      inv && compare ? own(() => invoiced(inv, b, prev)) : null,
      pay ? own(() => collected(pay, b, r)) : null,
      pay && compare ? own(() => collected(pay, b, prev)) : null,
      inv ? own(() => outstanding(inv, b)) : null,
      exp ? own(() => spent(exp, b, r)) : null,
      exp && compare ? own(() => spent(exp, b, prev)) : null,
      pay ? own(() => db().payment.groupBy({ by: ['method'], where: { AND: [payWhere(pay, b), { paidOn: dateIn(r) }] }, _sum: { amountPaise: true } })) : null,
    ]);
    const top = methods?.sort((a, z) => n(z._sum.amountPaise) - n(a._sum.amountPaise)).slice(0, 2) ?? [];
    const methodTotal = methods?.reduce((t, m) => t + n(m._sum.amountPaise), 0) ?? 0;
    return {
      sales: sNow && { value: sNow.total, count: sNow.count, change: change(sNow.total, sPrev?.total ?? null) },
      collected: cNow && { value: cNow.total, count: cNow.count, change: change(cNow.total, cPrev?.total ?? null), topMethods: top.map((m) => ({ method: m.method, share: methodTotal ? Math.round((n(m._sum.amountPaise) / methodTotal) * 100) : 0 })) },
      toCollect: due && { value: due.total, count: due.count, overdue: due.overdue },
      expenses: eNow && { value: eNow.total, count: eNow.count, change: change(eNow.total, ePrev?.total ?? null) },
    };
  });

  out.inbox = run(async () => {
    const items: { kind: string; id: string; title: string; detail: string; href: string; action: string; amountPaise?: number; days?: number }[] = [];
    const endToday = istStart(addDays(today, 1));
    const [overdue, followups, tasks, tenant] = await Promise.all([
      inv ? db().salesDocument.findMany({ where: { AND: [docWhere(inv, b), OPEN_INVOICE, { dueDate: { lt: dateOnly(today) } }] }, orderBy: { dueDate: 'asc' }, take: 5, select: { id: true, number: true, buyer: true, totalPaise: true, paidPaise: true, dueDate: true } }) : [],
      fu ? db().activity.findMany({ where: { AND: [scopeWhere(fu, { owner: ['assigneeId', 'createdBy'] }), { type: 'follow_up', completedAt: null, dueAt: { lt: endToday } }] }, orderBy: { dueAt: 'asc' }, take: 5, select: { id: true, title: true, dueAt: true, contactId: true } }) : [],
      task ? db().task.findMany({ where: { assigneeId: ctx.userId, status: { in: ['todo', 'in_progress'] }, dueAt: { lt: endToday } }, orderBy: { dueAt: 'asc' }, take: 5, select: { id: true, title: true, dueAt: true } }) : [],
      db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { ownerUserId: true, onboarding: true, preferences: true } }),
    ]);
    const contacts = followups.length ? await db().contact.findMany({ where: { id: { in: followups.map((f) => f.contactId) } }, select: { id: true, name: true } }) : [];
    const cname = new Map(contacts.map((x) => [x.id, x.name]));
    for (const d of overdue) {
      const days = Math.round((dateOnly(today).getTime() - d.dueDate!.getTime()) / DAY);
      items.push({ kind: 'overdue', id: d.id, title: `${d.number} · ${buyerName(d.buyer)}`, detail: `${days} day${days === 1 ? '' : 's'} overdue`, href: `/app/m/billing/${d.id}`, action: 'remind', amountPaise: n(d.totalPaise) - n(d.paidPaise), days });
    }
    for (const f of followups) items.push({ kind: 'followup', id: f.id, title: f.title || 'Follow up', detail: `${cname.get(f.contactId) ?? 'Contact'}${f.dueAt && f.dueAt < istStart(today) ? ' · overdue' : ' · today'}`, href: `/app/m/crm/${f.contactId}`, action: 'done' });
    for (const t of tasks) items.push({ kind: 'task', id: t.id, title: t.title, detail: t.dueAt && t.dueAt < istStart(today) ? 'overdue · you' : 'due today · you', href: `/app/m/tasks/${t.id}`, action: 'done' });
    if (tenant.ownerUserId === ctx.userId) {
      for (const step of readSetupSteps(tenant.onboarding)) items.push({ kind: 'setup', id: step.key, title: step.label, detail: 'Setup step left', href: `/app/setup?step=${step.key}`, action: 'open' });
      const p = withDefaults(tenant.preferences).payments;
      if (!p.bankAccount && !p.upiId) items.push({ kind: 'setup', id: 'payments', title: 'Add your bank account or UPI to get paid faster', detail: 'Printed on invoices', href: '/app/settings/payments', action: 'open' });
    }
    return { items, count: items.length };
  });

  if (appt) {
    out.today = run(async () => {
      const rows = await db().appointment.findMany({
        where: { AND: [apptWhere(appt, b), { startAt: timeIn({ from: today, to: today }), status: { not: 'cancelled' } }] },
        orderBy: { startAt: 'asc' },
        take: 12,
        select: { id: true, title: true, startAt: true, status: true, staffId: true, contactId: true },
      });
      const [staff, noShowsWeek] = await Promise.all([
        userNames(rows.map((x) => x.staffId)),
        db().appointment.count({ where: { AND: [apptWhere(appt, b), { status: 'no_show', startAt: timeIn({ from: addDays(today, -6), to: today }) }] } }),
      ]);
      const now = Date.now();
      const nextId = rows.find((x) => x.startAt.getTime() >= now && ['scheduled', 'confirmed'].includes(x.status))?.id;
      return { rows: rows.map((x) => ({ id: x.id, title: x.title, startAt: x.startAt, status: x.status, staff: x.staffId ? staff.get(x.staffId) ?? null : null, next: x.id === nextId })), noShowsWeek };
    });
  }

  if (inv) out.trend = run(() => trend(inv, b, r, pay));

  out.activity = safe(async () => {
    const take = 6;
    const since = istStart(addDays(today, -30));
    const contact = s('crm.contact.view');
    const [invs, pays, contacts, appts, exps, tsk] = await Promise.all([
      inv ? own(() => db().salesDocument.findMany({ where: { AND: [docWhere(inv, b), { kind: 'invoice', issuedAt: { gte: since } }] }, orderBy: { issuedAt: 'desc' }, take, select: { id: true, number: true, totalPaise: true, issuedAt: true, createdBy: true } })) : [],
      pay ? own(() => db().payment.findMany({ where: { AND: [payWhere(pay, b), { createdAt: { gte: since } }] }, orderBy: { createdAt: 'desc' }, take, select: { id: true, amountPaise: true, method: true, createdAt: true, createdBy: true, documentId: true, contactId: true, reversesId: true, document: { select: { number: true, kind: true } } } })) : [],
      contact ? own(() => db().contact.findMany({ where: { AND: [scopeWhere(contact, { owner: ['ownerId', 'createdBy'], branch: 'branchId' }), { createdAt: { gte: since }, isSample: false }] }, orderBy: { createdAt: 'desc' }, take, select: { id: true, name: true, type: true, leadSource: true, createdAt: true, createdBy: true } })) : [],
      appt ? own(() => db().appointment.findMany({ where: { AND: [apptWhere(appt, b), { createdAt: { gte: since } }] }, orderBy: { createdAt: 'desc' }, take, select: { id: true, title: true, createdAt: true, createdBy: true } })) : [],
      exp ? own(() => db().expense.findMany({ where: { AND: [expWhere(exp, b), { createdAt: { gte: since } }] }, orderBy: { createdAt: 'desc' }, take, select: { id: true, amountPaise: true, category: true, createdAt: true, createdBy: true } })) : [],
      task ? own(() => db().task.findMany({ where: { AND: [scopeWhere(task, { owner: ['assigneeId', 'createdBy'] }), { createdAt: { gte: since } }] }, orderBy: { createdAt: 'desc' }, take, select: { id: true, title: true, createdAt: true, createdBy: true } })) : [],
    ]);
    type Row = { id: string; at: Date; by: string | null; what: string; href: string };
    const rows: Row[] = [
      ...invs.map((x) => ({ id: `i${x.id}`, at: x.issuedAt!, by: x.createdBy, what: `issued ${x.number} · ${rupees(x.totalPaise)}`, href: `/app/m/billing/${x.id}` })),
      ...pays.map((x) => {
        const where = x.document ? `on ${x.document.number ?? 'an invoice'}` : 'as an advance';
        const what = x.reversesId ? `reversed ${rupees(x.amountPaise < 0n ? -x.amountPaise : x.amountPaise)} ${where}` : x.amountPaise < 0n ? `refunded ${rupees(-x.amountPaise)} ${where}` : `recorded ${rupees(x.amountPaise)} ${x.method === 'upi' ? 'UPI' : x.method} ${where}`;
        return { id: `p${x.id}`, at: x.createdAt, by: x.createdBy, what, href: !x.documentId ? `/app/m/crm/${x.contactId}` : x.document?.kind === 'credit_note' ? `/app/m/billing/credit-notes/${x.documentId}` : `/app/m/billing/${x.documentId}` };
      }),
      ...contacts.map((x) => ({ id: `c${x.id}`, at: x.createdAt, by: x.createdBy, what: `added ${x.type === 'lead' ? 'lead' : 'customer'} ${x.name}${x.leadSource ? ` (${x.leadSource})` : ''}`, href: `/app/m/crm/${x.id}` })),
      ...appts.map((x) => ({ id: `a${x.id}`, at: x.createdAt, by: x.createdBy, what: `booked ${x.title}`, href: '/app/m/bookings' })),
      ...exps.map((x) => ({ id: `e${x.id}`, at: x.createdAt, by: x.createdBy, what: `added expense ${rupees(x.amountPaise)} · ${x.category}`, href: '/app/m/finance' })),
      ...tsk.map((x) => ({ id: `t${x.id}`, at: x.createdAt, by: x.createdBy, what: `created task ${x.title}`, href: `/app/m/tasks/${x.id}` })),
    ]
      .sort((x, y) => y.at.getTime() - x.at.getTime())
      .slice(0, 8);
    const names = await userNames(rows.map((x) => x.by));
    return { rows: rows.map((x) => ({ id: x.id, at: x.at, who: x.by === ctx.userId ? 'You' : (x.by && names.get(x.by)) || 'Someone', what: x.what, href: x.href })) };
  });
  return settle(out);
}

const rupees = (p: unknown) => `₹${(Number(p ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
export async function billing(ctx: TenantCtx, s: Scoped, i: DashboardInput) {
  const run = runner(ctx);
  const { range: r, compare, branchId: b } = i;
  const inv = s('billing.invoice.view')!;
  const pay = s('billing.payment.view');
  const prev = previousRange(r);
  const today = todayIST();
  const out: Record<string, unknown> = {};
  out.kpis = run(async () => {
    const [now, before, cNow, cPrev, due] = await Promise.all([
      invoiced(inv, b, r),
      compare ? invoiced(inv, b, prev) : null,
      pay ? collected(pay, b, r) : null,
      pay && compare ? collected(pay, b, prev) : null,
      outstanding(inv, b),
    ]);
    const avg = now.count ? Math.round(now.total / now.count) : 0;
    const avgPrev = before?.count ? Math.round(before.total / before.count) : null;
    return {
      invoiced: { value: now.total, count: now.count, change: change(now.total, before?.total ?? null) },
      collected: cNow && { value: cNow.total, share: now.total ? Math.round((cNow.total / now.total) * 100) : null, change: change(cNow.total, cPrev?.total ?? null) },
      outstanding: { value: due.total, count: due.count, oldestDays: due.oldestDays },
      average: { value: avg, change: change(avg, avgPrev) },
    };
  });
  out.trend = run(() => trend(inv, b, r, pay));
  out.ageing = run(async () => {
    const open = await db().salesDocument.findMany({ where: { AND: [docWhere(inv, b), OPEN_INVOICE] }, select: { issueDate: true, totalPaise: true, paidPaise: true } });
    const bands = [
      { label: '0–30 days', min: 0, max: 30 },
      { label: '31–60 days', min: 31, max: 60 },
      { label: '61–90 days', min: 61, max: 90 },
      { label: 'Over 90 days', min: 91, max: Infinity },
    ].map((x) => ({ ...x, amount: 0, count: 0 }));
    const t = dateOnly(today).getTime();
    for (const d of open) {
      const age = Math.round((t - d.issueDate.getTime()) / DAY);
      const band = bands.find((x) => age >= x.min && age <= x.max)!;
      band.amount += n(d.totalPaise) - n(d.paidPaise);
      band.count++;
    }
    return { bands: bands.map(({ label, amount, count }) => ({ label, amount, count })), total: bands.reduce((s2, x) => s2 + x.amount, 0) };
  });
  out.overdue = run(async () => {
    const where = { AND: [docWhere(inv, b), OPEN_INVOICE, { dueDate: { lt: dateOnly(today) } }] };
    const [rows, count] = await Promise.all([
      db().salesDocument.findMany({ where, orderBy: { dueDate: 'asc' }, take: 8, select: { id: true, number: true, buyer: true, totalPaise: true, paidPaise: true, dueDate: true } }),
      db().salesDocument.count({ where }),
    ]);
    const t = dateOnly(today).getTime();
    return { count, rows: rows.map((d) => ({ id: d.id, number: d.number, customer: buyerName(d.buyer), email: !!((d.buyer ?? {}) as { email?: string }).email, balance: n(d.totalPaise) - n(d.paidPaise), days: Math.round((t - d.dueDate!.getTime()) / DAY) })) };
  });
  if (pay) {
    out.methods = run(async () => {
      const rows = await db().payment.groupBy({ by: ['method'], where: { AND: [payWhere(pay, b), { paidOn: dateIn(r) }] }, _sum: { amountPaise: true }, _count: true });
      const total = rows.reduce((t, x) => t + n(x._sum.amountPaise), 0);
      return { total, rows: rows.map((x) => ({ method: x.method, amount: n(x._sum.amountPaise), count: x._count, share: total ? Math.round((n(x._sum.amountPaise) / total) * 100) : 0 })).sort((a, z) => z.amount - a.amount) };
    });
  }
  return settle(out);
}

export async function sales(ctx: TenantCtx, s: Scoped, i: DashboardInput) {
  const run = runner(ctx);
  const { range: r, compare, branchId: b } = i;
  const q = s('sales.quotation.view')!;
  const inv = s('billing.invoice.view');
  const prev = previousRange(r);
  const today = todayIST();
  const QUOTE = { kind: 'quotation' as const, status: { not: 'draft' as const } };
  const out: Record<string, unknown> = {};
  const byStatus = async (range: Range) => {
    const rows = await db().salesDocument.groupBy({ by: ['status'], where: { AND: [docWhere(q, b), QUOTE, { issueDate: dateIn(range) }] }, _sum: { totalPaise: true }, _count: true });
    const get = (st: string[]) => rows.filter((x) => st.includes(x.status)).reduce((a, x) => ({ count: a.count + x._count, value: a.value + n(x._sum.totalPaise) }), { count: 0, value: 0 });
    return { sent: get(['sent', 'accepted', 'declined', 'converted']), won: get(['converted']), open: get(['sent', 'accepted']), declined: get(['declined']) };
  };
  out.kpis = run(async () => {
    const [now, before, expiring] = await Promise.all([
      byStatus(r),
      compare ? byStatus(prev) : null,
      db().salesDocument.count({ where: { AND: [docWhere(q, b), { kind: 'quotation', status: { in: ['sent', 'accepted'] }, dueDate: { gte: dateOnly(today), lte: dateOnly(addDays(today, 7)) } }] } }),
    ]);
    const rate = (x: typeof now) => (x.sent.count ? Math.round((x.won.count / x.sent.count) * 100) : null);
    return {
      sent: { ...now.sent, change: change(now.sent.count, before?.sent.count ?? null) },
      won: { ...now.won, rate: rate(now), change: change(rate(now) ?? 0, before ? rate(before) ?? 0 : null) },
      open: now.open,
      expiring,
    };
  });
  out.results = run(async () => {
    const now = await byStatus(r);
    const expired = await db().salesDocument.aggregate({ where: { AND: [docWhere(q, b), { kind: 'quotation', status: { in: ['sent', 'accepted'] }, issueDate: dateIn(r), dueDate: { lt: dateOnly(today) } }] }, _sum: { totalPaise: true }, _count: true });
    const exp = { count: expired._count, value: n(expired._sum.totalPaise) };
    return {
      total: now.sent.count,
      rows: [
        { key: 'won', label: 'Won (invoiced)', ...now.won },
        { key: 'open', label: 'Open', count: now.open.count - exp.count, value: now.open.value - exp.value },
        { key: 'expired', label: 'Expired', ...exp },
        { key: 'declined', label: 'Declined', ...now.declined },
      ],
    };
  });
  if (inv) {
    out.top = run(async () => {
      const lines = await db().salesDocumentLine.groupBy({
        by: ['description'],
        where: { document: { AND: [docWhere(inv, b), LIVE_INVOICE, { issueDate: dateIn(r) }] } },
        _sum: { taxablePaise: true, quantity: true },
        orderBy: { _sum: { taxablePaise: 'desc' } },
        take: 6,
      });
      return { rows: lines.map((l) => ({ name: l.description, amount: n(l._sum.taxablePaise), quantity: Number(l._sum.quantity ?? 0) })) };
    });
  }
  out.open = run(async () => {
    const rows = await db().salesDocument.findMany({ where: { AND: [docWhere(q, b), { kind: 'quotation', status: { in: ['sent', 'accepted'] } }] }, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }], take: 8, select: { id: true, number: true, buyer: true, issueDate: true, dueDate: true, totalPaise: true } });
    return { rows: rows.map((d) => ({ id: d.id, number: d.number, customer: buyerName(d.buyer), sent: d.issueDate, validUntil: d.dueDate, amount: n(d.totalPaise), expiringSoon: !!d.dueDate && d.dueDate <= dateOnly(addDays(today, 7)), expired: !!d.dueDate && d.dueDate < dateOnly(today) })) };
  });
  return settle(out);
}

export async function crm(ctx: TenantCtx, s: Scoped, i: DashboardInput) {
  const run = runner(ctx);
  const { range: r, compare, branchId: b } = i;
  const c = s('crm.contact.view')!;
  const fu = s('crm.activity.view');
  const inv = s('billing.invoice.view');
  const prev = previousRange(r);
  const today = todayIST();
  const scope = { AND: [scopeWhere(c, { owner: ['ownerId', 'createdBy'], branch: 'branchId' }), b ? { branchId: b } : {}] };
  const out: Record<string, unknown> = {};
  const counts = async (range: Range) => {
    const [leads, converted, customers] = await Promise.all([
      db().contact.count({ where: { AND: [scope, { leadStatus: { not: null }, createdAt: timeIn(range) }] } }),
      db().contact.count({ where: { AND: [scope, { convertedAt: timeIn(range) }] } }),
      db().contact.count({ where: { AND: [scope, { type: 'customer', isSample: false, OR: [{ createdAt: timeIn(range), convertedAt: null }, { convertedAt: timeIn(range) }] }] } }),
    ]);
    return { leads, converted, customers };
  };
  out.kpis = run(async () => {
    const [now, before, due, overdue] = await Promise.all([
      counts(r),
      compare ? counts(prev) : null,
      fu ? db().activity.count({ where: { AND: [scopeWhere(fu, { owner: ['assigneeId', 'createdBy'] }), { type: 'follow_up', completedAt: null, dueAt: { lt: istStart(addDays(today, 1)) } }] } }) : null,
      fu ? db().activity.count({ where: { AND: [scopeWhere(fu, { owner: ['assigneeId', 'createdBy'] }), { type: 'follow_up', completedAt: null, dueAt: { lt: istStart(today) } }] } }) : null,
    ]);
    const rate = (x: typeof now) => (x.leads ? Math.round((x.converted / x.leads) * 100) : null);
    return {
      leads: { value: now.leads, change: change(now.leads, before?.leads ?? null) },
      converted: { value: now.converted, rate: rate(now), change: change(rate(now) ?? 0, before ? rate(before) ?? 0 : null) },
      customers: { value: now.customers, change: change(now.customers, before?.customers ?? null) },
      followUps: due === null ? null : { value: due, overdue },
    };
  });
  out.stages = run(async () => {
    const rows = await db().contact.groupBy({ by: ['leadStatus'], where: { AND: [scope, { leadStatus: { not: null }, createdAt: timeIn(r) }] }, _count: true });
    const order = ['new', 'contacted', 'qualified', 'converted', 'lost'];
    return { rows: order.map((st) => ({ stage: st, count: rows.find((x) => x.leadStatus === st)?._count ?? 0 })) };
  });
  out.sources = run(async () => {
    const rows = await db().contact.groupBy({ by: ['leadSource'], where: { AND: [scope, { leadStatus: { not: null }, createdAt: timeIn(r) }] }, _count: true });
    const total = rows.reduce((t, x) => t + x._count, 0);
    return { total, rows: rows.map((x) => ({ source: x.leadSource || null, count: x._count, share: total ? Math.round((x._count / total) * 100) : 0 })).sort((a, z) => z.count - a.count) };
  });
  if (fu) {
    out.followups = run(async () => {
      const rows = await db().activity.findMany({ where: { AND: [scopeWhere(fu, { owner: ['assigneeId', 'createdBy'] }), { type: 'follow_up', completedAt: null, dueAt: { lt: istStart(addDays(today, 1)) } }] }, orderBy: { dueAt: 'asc' }, take: 8, select: { id: true, title: true, body: true, dueAt: true, contactId: true, assigneeId: true } });
      const [contacts, names] = await Promise.all([db().contact.findMany({ where: { id: { in: rows.map((x) => x.contactId) } }, select: { id: true, name: true } }), userNames(rows.map((x) => x.assigneeId))]);
      const cn = new Map(contacts.map((x) => [x.id, x.name]));
      return { rows: rows.map((x) => ({ id: x.id, dueAt: x.dueAt, overdue: !!x.dueAt && x.dueAt < istStart(today), who: cn.get(x.contactId) ?? 'Contact', contactId: x.contactId, what: x.title || x.body?.slice(0, 60) || 'Follow up', owner: x.assigneeId ? names.get(x.assigneeId) ?? null : null })) };
    });
  }
  if (inv) {
    out.top = run(async () => {
      const rows = await db().salesDocument.groupBy({ by: ['contactId'], where: { AND: [docWhere(inv, b), LIVE_INVOICE, { issueDate: dateIn(r), contactId: { not: null } }] }, _sum: { totalPaise: true }, _count: true, orderBy: { _sum: { totalPaise: 'desc' } }, take: 5 });
      const contacts = await db().contact.findMany({ where: { id: { in: rows.map((x) => x.contactId!) } }, select: { id: true, name: true } });
      const cn = new Map(contacts.map((x) => [x.id, x.name]));
      // Credit notes take the customer's sales back
      const credits = await db().salesDocument.groupBy({ by: ['contactId'], where: { AND: [docWhere(inv, b), LIVE_CREDIT_NOTE, { issueDate: dateIn(r), contactId: { in: rows.map((x) => x.contactId!) } }] }, _sum: { totalPaise: true } });
      const credit = new Map(credits.map((x) => [x.contactId, n(x._sum.totalPaise)]));
      return { rows: rows.map((x) => ({ id: x.contactId, name: cn.get(x.contactId!) ?? 'Customer', amount: n(x._sum.totalPaise) - (credit.get(x.contactId) ?? 0), invoices: x._count })).sort((a, c) => c.amount - a.amount) };
    });
  }
  return settle(out);
}

const WORK_HOURS_PER_DAY = 9;

export async function bookings(ctx: TenantCtx, s: Scoped, i: DashboardInput) {
  const run = runner(ctx);
  const { range: r, compare, branchId: b } = i;
  const a = s('bookings.appointment.view')!;
  const prev = previousRange(r);
  const today = todayIST();
  const out: Record<string, unknown> = {};
  const statusCounts = async (range: Range) => {
    const rows = await db().appointment.groupBy({ by: ['status'], where: { AND: [apptWhere(a, b), { startAt: timeIn(range) }] }, _count: true });
    const get = (st: string) => rows.find((x) => x.status === st)?._count ?? 0;
    const total = rows.reduce((t, x) => t + x._count, 0);
    return { total, completed: get('completed'), noShow: get('no_show'), cancelled: get('cancelled') };
  };
  out.kpis = run(async () => {
    const [now, before] = await Promise.all([statusCounts(r), compare ? statusCounts(prev) : null]);
    const live = now.total - now.cancelled;
    return {
      total: { value: now.total, change: change(now.total, before?.total ?? null) },
      completed: { value: now.completed, rate: live ? Math.round((now.completed / live) * 100) : null },
      noShows: { value: now.noShow, rate: live ? Math.round((now.noShow / live) * 100) : null, change: change(now.noShow, before?.noShow ?? null) },
      cancelled: { value: now.cancelled, change: change(now.cancelled, before?.cancelled ?? null) },
    };
  });
  const inRange = () => db().appointment.findMany({ where: { AND: [apptWhere(a, b), { startAt: timeIn(r), status: { not: 'cancelled' } }] }, select: { startAt: true, endAt: true, staffId: true, status: true } });
  out.hours = run(async () => {
    const rows = await inRange();
    const by = new Map<number, number>();
    for (const x of rows) by.set(istHour(x.startAt), (by.get(istHour(x.startAt)) ?? 0) + 1);
    const hours = [...by.keys()];
    const lo = Math.min(9, ...hours);
    const hi = Math.max(20, ...hours);
    return { rows: Array.from({ length: hi - lo + 1 }, (_, k) => ({ hour: lo + k, count: by.get(lo + k) ?? 0 })) };
  });
  out.staff = run(async () => {
    const rows = await inRange();
    const elapsed = Math.max(1, Math.min(daysBetween(r.from, r.to), daysBetween(r.from, today)));
    const per = new Map<string, { minutes: number; count: number }>();
    for (const x of rows) {
      if (!x.staffId) continue;
      const p = per.get(x.staffId) ?? { minutes: 0, count: 0 };
      p.minutes += Math.max(0, (x.endAt.getTime() - x.startAt.getTime()) / 60_000);
      p.count++;
      per.set(x.staffId, p);
    }
    const names = await userNames([...per.keys()]);
    const capacity = elapsed * WORK_HOURS_PER_DAY * 60;
    return { hoursPerDay: WORK_HOURS_PER_DAY, rows: [...per.entries()].map(([id, p]) => ({ id, name: names.get(id) ?? 'Staff', count: p.count, pct: Math.min(100, Math.round((p.minutes / capacity) * 100)) })).sort((x, y) => y.pct - x.pct) };
  });
  out.week = run(async () => {
    const rows = await db().appointment.findMany({ where: { AND: [apptWhere(a, b), { startAt: timeIn({ from: today, to: addDays(today, 6) }), status: { not: 'cancelled' } }] }, select: { startAt: true } });
    return { days: Array.from({ length: 7 }, (_, k) => { const d = addDays(today, k); return { date: d, count: rows.filter((x) => istDate(x.startAt) === d).length }; }) };
  });
  out.noshows = run(async () => {
    const rows = await db().appointment.findMany({ where: { AND: [apptWhere(a, b), { status: 'no_show', startAt: timeIn(r) }] }, orderBy: { startAt: 'desc' }, take: 6, select: { id: true, title: true, startAt: true, contactId: true } });
    const ids = rows.map((x) => x.contactId).filter((x): x is string => !!x);
    const [contacts, repeats] = await Promise.all([
      db().contact.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      ids.length ? db().appointment.groupBy({ by: ['contactId'], where: { contactId: { in: ids }, status: 'no_show' }, _count: true }) : [],
    ]);
    const cn = new Map(contacts.map((x) => [x.id, x.name]));
    const rep = new Map(repeats.map((x) => [x.contactId, x._count]));
    return { rows: rows.map((x) => ({ id: x.id, title: x.title, startAt: x.startAt, customer: x.contactId ? cn.get(x.contactId) ?? null : null, times: x.contactId ? rep.get(x.contactId) ?? 1 : 1 })) };
  });
  return settle(out);
}

export async function finance(ctx: TenantCtx, s: Scoped, i: DashboardInput) {
  const run = runner(ctx);
  const { range: r, compare, branchId: b } = i;
  const e = s('finance.expense.view')!;
  const inv = s('billing.invoice.view');
  const pay = s('billing.payment.view');
  const prev = previousRange(r);
  const out: Record<string, unknown> = {};
  out.kpis = run(async () => {
    const [inNow, inPrev, outNow, outPrev, sales] = await Promise.all([
      pay ? collected(pay, b, r) : null,
      pay && compare ? collected(pay, b, prev) : null,
      spent(e, b, r),
      compare ? spent(e, b, prev) : null,
      inv ? invoiced(inv, b, r) : null,
    ]);
    const net = (inNow?.total ?? 0) - outNow.total;
    const netPrev = inPrev && outPrev ? inPrev.total - outPrev.total : null;
    return {
      moneyIn: inNow && { value: inNow.total, change: change(inNow.total, inPrev?.total ?? null) },
      moneyOut: { value: outNow.total, change: change(outNow.total, outPrev?.total ?? null) },
      net: inNow ? { value: net, change: change(net, netPrev) } : null,
      gst: sales && { value: sales.cgst + sales.sgst + sales.igst },
    };
  });
  out.categories = run(async () => {
    const rows = await db().expense.groupBy({ by: ['category'], where: { AND: [expWhere(e, b), { paidOn: dateIn(r) }] }, _sum: { amountPaise: true }, orderBy: { _sum: { amountPaise: 'desc' } } });
    const total = rows.reduce((t, x) => t + n(x._sum.amountPaise), 0);
    const top = rows.slice(0, 5).map((x) => ({ category: x.category, amount: n(x._sum.amountPaise), share: total ? Math.round((n(x._sum.amountPaise) / total) * 100) : 0 }));
    const rest = rows.slice(5).reduce((t, x) => t + n(x._sum.amountPaise), 0);
    if (rest) top.push({ category: 'Other', amount: rest, share: total ? Math.round((rest / total) * 100) : 0 });
    return { total, rows: top };
  });
  if (inv) {
    out.profit = run(async () => {
      const [sales, cost] = await Promise.all([invoiced(inv, b, r), spent(e, b, r)]);
      return { sales: sales.taxable, expenses: cost.total, profit: sales.taxable - cost.total };
    });
    out.gst = run(async () => {
      const [sales, t] = await Promise.all([invoiced(inv, b, r), db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { preferences: true, profile: true } })]);
      const taxes = withDefaults(t.preferences, t.profile).taxes;
      return { cgst: sales.cgst, sgst: sales.sgst, igst: sales.igst, total: sales.cgst + sales.sgst + sales.igst, composition: taxes.composition, compositionRateBp: taxes.compositionRateBp, taxable: sales.taxable, due: gstr3bDue(r.to) };
    });
  }
  return settle(out);
}

export async function tasks(ctx: TenantCtx, s: Scoped, i: DashboardInput) {
  const run = runner(ctx);
  const { range: r, compare } = i;
  const t = s('tasks.task.view')!;
  const prev = previousRange(r);
  const today = todayIST();
  const scope = scopeWhere(t, { owner: ['assigneeId', 'createdBy'] });
  const OPEN = { status: { in: ['todo' as const, 'in_progress' as const] } };
  const out: Record<string, unknown> = {};
  out.kpis = run(async () => {
    const [open, overdue, done, donePrev] = await Promise.all([
      db().task.count({ where: { AND: [scope, OPEN] } }),
      db().task.count({ where: { AND: [scope, OPEN, { dueAt: { lt: istStart(today) } }] } }),
      db().task.count({ where: { AND: [scope, { status: 'done', completedAt: timeIn(r) }] } }),
      compare ? db().task.count({ where: { AND: [scope, { status: 'done', completedAt: timeIn(prev) }] } }) : null,
    ]);
    return { open: { value: open }, overdue: { value: overdue }, done: { value: done, change: change(done, donePrev) } };
  });
  out.people = run(async () => {
    const [all, late] = await Promise.all([
      db().task.groupBy({ by: ['assigneeId'], where: { AND: [scope, OPEN] }, _count: true }),
      db().task.groupBy({ by: ['assigneeId'], where: { AND: [scope, OPEN, { dueAt: { lt: istStart(today) } }] }, _count: true }),
    ]);
    const names = await userNames(all.map((x) => x.assigneeId));
    const lateBy = new Map(late.map((x) => [x.assigneeId, x._count]));
    const max = Math.max(1, ...all.map((x) => x._count));
    return {
      rows: all
        .map((x) => ({ id: x.assigneeId, name: !x.assigneeId ? 'Unassigned' : x.assigneeId === ctx.userId ? 'You' : names.get(x.assigneeId) ?? 'Someone', open: x._count, overdue: lateBy.get(x.assigneeId) ?? 0, pct: Math.round((x._count / max) * 100) }))
        .sort((a, z) => z.open - a.open),
    };
  });
  out.due = run(async () => {
    const rows = await db().task.findMany({ where: { AND: [scope, OPEN, { dueAt: { lt: istStart(addDays(today, 1)) } }] }, orderBy: { dueAt: 'asc' }, take: 8, select: { id: true, title: true, dueAt: true, assigneeId: true, priority: true } });
    const names = await userNames(rows.map((x) => x.assigneeId));
    return { rows: rows.map((x) => ({ id: x.id, title: x.title, dueAt: x.dueAt, overdueDays: x.dueAt && x.dueAt < istStart(today) ? Math.ceil((istStart(today).getTime() - x.dueAt.getTime()) / DAY) : 0, who: !x.assigneeId ? null : x.assigneeId === ctx.userId ? 'You' : names.get(x.assigneeId) ?? null, priority: x.priority })) };
  });
  return settle(out);
}

/** Staff home: only the person's own work, whatever their scope. */
export async function myday(ctx: TenantCtx, s: Scoped, i: DashboardInput) {
  const run = runner(ctx);
  const { range: r, compare } = i;
  const today = todayIST();
  const prev = previousRange(r);
  const appt = s('bookings.appointment.view');
  const inv = s('billing.invoice.view');
  const task = s('tasks.task.view');
  const out: Record<string, unknown> = {};
  const mineAppt = { staffId: ctx.userId, startAt: timeIn({ from: today, to: today }), status: { not: 'cancelled' as const } };
  out.kpis = run(async () => {
    const own = { ...ctx, scope: 'own' as const };
    const [appts, done, mySales, mySalesPrev, myTasks, dueToday] = await Promise.all([
      appt ? db().appointment.count({ where: mineAppt }) : null,
      appt ? db().appointment.count({ where: { ...mineAppt, status: 'completed' } }) : null,
      inv ? invoiced(own, null, r) : null,
      inv && compare ? invoiced(own, null, prev) : null,
      task ? db().task.count({ where: { assigneeId: ctx.userId, status: { in: ['todo', 'in_progress'] } } }) : null,
      task ? db().task.count({ where: { assigneeId: ctx.userId, status: { in: ['todo', 'in_progress'] }, dueAt: { lt: istStart(addDays(today, 1)) } } }) : null,
    ]);
    return {
      appointments: appts === null ? null : { value: appts, done },
      sales: mySales && { value: mySales.total, count: mySales.count, change: change(mySales.total, mySalesPrev?.total ?? null) },
      tasks: myTasks === null ? null : { value: myTasks, dueToday },
    };
  });
  if (appt) {
    out.schedule = run(async () => {
      const rows = await db().appointment.findMany({ where: mineAppt, orderBy: { startAt: 'asc' }, select: { id: true, title: true, startAt: true, status: true } });
      const now = Date.now();
      const nextId = rows.find((x) => x.startAt.getTime() >= now && ['scheduled', 'confirmed'].includes(x.status))?.id;
      return { rows: rows.map((x) => ({ ...x, next: x.id === nextId })) };
    });
  }
  if (task) {
    out.tasks = run(async () => {
      const rows = await db().task.findMany({ where: { assigneeId: ctx.userId, status: { in: ['todo', 'in_progress'] } }, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }], take: 8, select: { id: true, title: true, dueAt: true, priority: true } });
      return { rows };
    });
  }
  return settle(out);
}

export const TAB_HANDLERS: Record<DashboardTab, (ctx: TenantCtx, s: Scoped, i: DashboardInput) => Promise<Record<string, unknown>>> = {
  overview, myday, billing, sales, crm, bookings, finance, tasks,
};

/** Which tabs this person gets: the module is on and the role can view it. */
export function availableTabs(s: Scoped, readOnly: (m: string) => boolean) {
  const money = !!s('billing.invoice.view') || !!s('finance.expense.view');
  return DASHBOARD_TABS.filter((t) => {
    // Staff without money views get "My day" instead of the Overview, with or without the dashboard permission
    if (t.key === 'myday') return !money && (!!s('bookings.appointment.view') || !!s('tasks.task.view'));
    if (!s(t.permission)) return false;
    if (t.key === 'overview') return money;
    return true;
  }).map((t) => ({ key: t.key, label: t.label, readOnly: readOnly(t.permission.split('.')[0]) }));
}

/** The tabs, the role's default tab and the branch list (needs a tenant transaction). */
export async function dashboardConfig(_ctx: TenantCtx, s: Scoped, readOnly: (m: string) => boolean, role: { key: string; roleType: string }) {
  const tabs = availableTabs(s, readOnly);
  const has = (k: string) => tabs.some((t) => t.key === k);
  let defaultTab: string | null = tabs[0]?.key ?? null;
  if (/billing|cashier|counter/.test(role.key) || role.roleType === 'counter') defaultTab = has('billing') ? 'billing' : defaultTab;
  else if (/finance|account/.test(role.key)) defaultTab = has('finance') ? 'finance' : defaultTab;
  const branches = await db().branch.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true } });
  return { tabs, defaultTab, branches: branches.length > 1 ? branches : [] };
}
