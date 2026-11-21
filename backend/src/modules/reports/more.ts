import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { bundle, userNames, userPart, type Row } from '../../kernel/bundle';
import type { TenantCtx } from '../../kernel/context';
import { DateStr, scopeSql } from '../../kernel/query';
import { hrReach } from '../hr/employees';

// The reports the module pages did not have yet, each read in ONE database round trip:
// profit by item, stock movement, attendance and payroll registers, leave taken, bookings and time.
// Rows come back whole; the web app searches, sorts, pages and exports them.

export const Period = z.object({ from: DateStr, to: DateStr }).refine((p) => p.from <= p.to, { message: 'The start is after the end', path: ['to'] });
export const MonthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick a month') });
type P = { from: string; to: string };

const n = (v: unknown) => Number(v ?? 0);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const uuids = (ids: string[]) => Prisma.join(ids.map((b) => Prisma.sql`${b}::uuid`));

/** Sales documents in scope (owner = created_by, branch = branch_id), alias d */
function docScope(ctx: TenantCtx) {
  return scopeSql(ctx, ['d.created_by'], 'd.branch_id');
}
/** Employees in scope, the HR way: own = the person's record, team = them and their reports */
async function empScope(ctx: TenantCtx) {
  const reach = await hrReach(ctx);
  if (!reach) return Prisma.empty;
  return reach.length ? Prisma.sql`and e.id in (${uuids(reach)})` : Prisma.sql`and false`;
}

// ---------------------------------------------------------------- profit by item

/** What each item sold for against what it cost (the stock value that left with the sale). */
export async function profitByItem(ctx: TenantCtx, p: P) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`
      with sold as (
        select l.item_id,
          sum(case when d.kind = 'invoice' then l.quantity + l.free_quantity when d.note_type = 'return' then -l.quantity else 0 end) as qty,
          sum(case when d.kind = 'credit_note' then -l.taxable_paise else l.taxable_paise end) as sales_paise,
          count(distinct d.id) filter (where d.kind = 'invoice') as invoices
        from sales_document_lines l join sales_documents d on d.id = l.document_id
        where d.tenant_id = ${t}::uuid and l.item_id is not null and d.issue_date between ${p.from}::date and ${p.to}::date
          and ((d.kind in ('invoice', 'debit_note') and d.status in ('issued', 'partially_paid', 'paid')) or (d.kind = 'credit_note' and d.status = 'issued')) ${docScope(ctx)}
        group by l.item_id),
      cost as (
        select m.item_id, -sum(m.value_paise) as cost_paise from stock_moves m
        where m.tenant_id = ${t}::uuid and m.source_type in ('invoice', 'delivery_challan', 'credit_note') and m.move_date between ${p.from}::date and ${p.to}::date
        group by m.item_id)
      select i.id, i.name, i.sku, i.unit, i.type, c.name as category, s.qty, s.invoices, coalesce(s.sales_paise, 0) as sales_paise, coalesce(k.cost_paise, 0) as cost_paise
      from sold s join items i on i.id = s.item_id left join cost k on k.item_id = s.item_id left join item_categories c on c.id = i.category_id`,
  });
  const rows = b.rows.map((r) => {
    const sales = n(r.salesPaise);
    const cost = r.type === 'service' ? 0 : n(r.costPaise);
    return { id: r.id as string, name: r.name as string, sku: r.sku as string | null, unit: r.unit as string, type: r.type as string, category: r.category as string | null, quantity: Math.round(n(r.qty) * 1000) / 1000, invoices: n(r.invoices), salesPaise: sales, costPaise: cost, profitPaise: sales - cost, marginPct: pct(sales - cost, sales) };
  }).sort((a, z) => z.profitPaise - a.profitPaise);
  const sales = rows.reduce((s, r) => s + r.salesPaise, 0);
  const cost = rows.reduce((s, r) => s + r.costPaise, 0);
  return { data: rows, sums: { salesPaise: sales, costPaise: cost, profitPaise: sales - cost, marginPct: pct(sales - cost, sales), losing: rows.filter((r) => r.profitPaise < 0).length } };
}

// ---------------------------------------------------------------- stock movement

const IN_KINDS: Record<string, string> = { purchase: 'Bought', sale_return: 'Returned by customers', opening: 'Opening', stock_in: 'Stock in', transfer_in: 'Transfer in' };
const OUT_KINDS: Record<string, string> = { sale: 'Sold', purchase_return: 'Returned to suppliers', transfer_out: 'Transfer out' };

/** Per item: what you had at the start, what came in and went out (by kind), and what you had at the end. */
export async function stockMovement(ctx: TenantCtx, p: P & { locationId?: string }) {
  const t = ctx.tenantId;
  const loc = p.locationId ? Prisma.sql`and m.location_id = ${p.locationId}::uuid` : Prisma.empty;
  const b = await bundle({
    rows: Prisma.sql`
      select i.id, i.name, i.sku, i.unit, c.name as category,
        coalesce(sum(m.quantity) filter (where m.move_date < ${p.from}::date), 0) as open_qty,
        coalesce(sum(m.value_paise) filter (where m.move_date < ${p.from}::date), 0) as open_paise,
        coalesce(sum(m.quantity) filter (where m.move_date between ${p.from}::date and ${p.to}::date and m.quantity > 0), 0) as in_qty,
        coalesce(sum(m.value_paise) filter (where m.move_date between ${p.from}::date and ${p.to}::date and m.quantity > 0), 0) as in_paise,
        coalesce(-sum(m.quantity) filter (where m.move_date between ${p.from}::date and ${p.to}::date and m.quantity < 0), 0) as out_qty,
        coalesce(-sum(m.value_paise) filter (where m.move_date between ${p.from}::date and ${p.to}::date and m.quantity < 0), 0) as out_paise,
        coalesce(sum(m.quantity) filter (where m.move_date <= ${p.to}::date), 0) as close_qty,
        coalesce(sum(m.value_paise) filter (where m.move_date <= ${p.to}::date), 0) as close_paise,
        coalesce(-sum(m.quantity) filter (where m.move_date between ${p.from}::date and ${p.to}::date and m.kind = 'sale'), 0) as sold_qty,
        (select coalesce(json_object_agg(k.kind, k.qty), '{}'::json) from (
          select m2.kind, sum(m2.quantity) as qty from stock_moves m2
          where m2.tenant_id = ${t}::uuid and m2.item_id = i.id and m2.move_date between ${p.from}::date and ${p.to}::date ${p.locationId ? Prisma.sql`and m2.location_id = ${p.locationId}::uuid` : Prisma.empty}
          group by m2.kind) k) as kinds
      from stock_moves m join items i on i.id = m.item_id left join item_categories c on c.id = i.category_id
      where m.tenant_id = ${t}::uuid and m.move_date <= ${p.to}::date ${loc}
      group by i.id, i.name, i.sku, i.unit, c.name`,
    locs: Prisma.sql`select id, name from stock_locations where tenant_id = ${t}::uuid order by name`,
  });
  const round = (v: unknown) => Math.round(n(v) * 1000) / 1000;
  const rows = b.rows.map((r) => {
    const kinds = (r.kinds ?? {}) as Record<string, number>;
    const ins = Object.entries(kinds).filter(([k, q]) => k in IN_KINDS || ((k === 'adjustment' || k === 'count') && q > 0)).map(([k, q]) => ({ kind: IN_KINDS[k] ?? 'Adjusted up', qty: round(q) }));
    const outs = Object.entries(kinds).filter(([k, q]) => k in OUT_KINDS || ((k === 'adjustment' || k === 'count') && q < 0)).map(([k, q]) => ({ kind: OUT_KINDS[k] ?? 'Adjusted down', qty: round(-q) }));
    const open = round(r.openQty);
    const close = round(r.closeQty);
    const avg = (open + close) / 2;
    return {
      id: r.id as string, name: r.name as string, sku: r.sku as string | null, unit: r.unit as string, category: r.category as string | null,
      openQty: open, openPaise: n(r.openPaise), inQty: round(r.inQty), inPaise: n(r.inPaise), outQty: round(r.outQty), outPaise: n(r.outPaise),
      closeQty: close, closePaise: n(r.closePaise), soldQty: round(r.soldQty), ins, outs,
      /** Times the average stock sold in the period */
      turnover: avg > 0 ? Math.round((round(r.soldQty) / avg) * 10) / 10 : null,
    };
  }).filter((r) => r.openQty || r.inQty || r.outQty || r.closeQty).sort((a, z) => z.outPaise - a.outPaise || a.name.localeCompare(z.name));
  const sum = (k: 'openPaise' | 'inPaise' | 'outPaise' | 'closePaise') => rows.reduce((s, r) => s + r[k], 0);
  return { data: rows, locations: b.locs, sums: { openPaise: sum('openPaise'), inPaise: sum('inPaise'), outPaise: sum('outPaise'), closePaise: sum('closePaise'), notMoving: rows.filter((r) => !r.outQty && r.closeQty > 0).length } };
}

// ---------------------------------------------------------------- HR: attendance, payroll, leave

const monthRange = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}`, days: last };
};

/** Each person's month: days present, half, absent, on leave, off; late and overtime. */
export async function attendanceSummary(ctx: TenantCtx, month: string) {
  const t = ctx.tenantId;
  const r = monthRange(month);
  const b = await bundle({
    rows: Prisma.sql`
      select e.id, e.code, e.name, e.joined_on, e.exit_on, d.name as department, g.name as designation,
        count(a.id) filter (where a.status = 'present') as present, count(a.id) filter (where a.status = 'half_day') as half_day,
        count(a.id) filter (where a.status = 'absent') as absent, count(a.id) filter (where a.status = 'leave') as on_leave,
        count(a.id) filter (where a.status in ('holiday', 'week_off')) as off_days, count(a.id) filter (where a.late_minutes > 0) as late_days,
        coalesce(sum(a.late_minutes), 0) as late_minutes, coalesce(sum(a.overtime_minutes), 0) as overtime_minutes, coalesce(sum(a.worked_minutes), 0) as worked_minutes,
        count(a.id) as marked
      from employees e
      left join attendance a on a.employee_id = e.id and a.date between ${r.from}::date and ${r.to}::date
      left join hr_departments d on d.id = e.department_id left join hr_designations g on g.id = e.designation_id
      where e.tenant_id = ${t}::uuid and e.joined_on <= ${r.to}::date and (e.exit_on is null or e.exit_on >= ${r.from}::date) ${await empScope(ctx)}
      group by e.id, d.name, g.name order by e.name`,
  });
  const rows = b.rows.map((x) => {
    const present = n(x.present) + n(x.halfDay) / 2;
    const workDays = n(x.present) + n(x.halfDay) + n(x.absent) + n(x.onLeave);
    return {
      id: x.id as string, code: x.code as string, name: x.name as string, department: x.department as string | null, designation: x.designation as string | null,
      present: n(x.present), halfDay: n(x.halfDay), absent: n(x.absent), leave: n(x.onLeave), off: n(x.offDays), unmarked: Math.max(0, r.days - n(x.marked)),
      lateDays: n(x.lateDays), lateMinutes: n(x.lateMinutes), overtimeMinutes: n(x.overtimeMinutes), workedMinutes: n(x.workedMinutes),
      attendancePct: pct(present, workDays),
    };
  });
  const avg = rows.length ? Math.round((rows.reduce((s, x) => s + x.attendancePct, 0) / rows.length) * 10) / 10 : 0;
  return { data: rows, days: r.days, sums: { people: rows.length, avgPct: avg, absent: rows.reduce((s, x) => s + x.absent, 0), lateDays: rows.reduce((s, x) => s + x.lateDays, 0), overtimeMinutes: rows.reduce((s, x) => s + x.overtimeMinutes, 0) } };
}

type Part = { name: string; code?: string; amountPaise: number };

/** The month's payslips, one row each, with PF, ESI, PT and the employer's share split out. */
export async function payrollRegister(ctx: TenantCtx, month: string) {
  const t = ctx.tenantId;
  const b = await bundle({
    run: Prisma.sql`select id, number, status, pay_date, employees, gross_paise, deductions_paise, net_paise, employer_paise, paid_paise from payroll_runs where tenant_id = ${t}::uuid and month = ${month}`,
    rows: Prisma.sql`
      select s.id, s.number, s.status, s.paid_on, s.days_in_month, s.payable_days, s.lop_days, s.basic_paise, s.earnings, s.deductions, s.employer,
        s.gross_paise, s.deductions_paise, s.net_paise, s.employer_paise, e.id as employee_id, e.code, e.name, e.uan, e.esi_no, e.pan, d.name as department
      from payslips s join payroll_runs r on r.id = s.run_id join employees e on e.id = s.employee_id left join hr_departments d on d.id = e.department_id
      where s.tenant_id = ${t}::uuid and r.month = ${month} ${await empScope(ctx)}
      order by e.name`,
  });
  const by = (parts: unknown, code: string) => ((parts ?? []) as Part[]).filter((x) => x.code === code).reduce((s, x) => s + n(x.amountPaise), 0);
  const rows = b.rows.map((x) => ({
    id: x.id as string, number: x.number as string, status: x.status as string, paidOn: x.paidOn as Date | null, employeeId: x.employeeId as string, code: x.code as string, name: x.name as string,
    department: x.department as string | null, uan: x.uan as string | null, esiNo: x.esiNo as string | null, pan: x.pan as string | null,
    daysInMonth: n(x.daysInMonth), payableDays: n(x.payableDays), lopDays: n(x.lopDays), basicPaise: n(x.basicPaise),
    grossPaise: n(x.grossPaise), pfPaise: by(x.deductions, 'pf'), esiPaise: by(x.deductions, 'esi'), ptPaise: by(x.deductions, 'pt'), loanPaise: by(x.deductions, 'loan'),
    otherPaise: by(x.deductions, 'other') + by(x.deductions, 'tds'), deductionsPaise: n(x.deductionsPaise), netPaise: n(x.netPaise), employerPaise: n(x.employerPaise),
    overtimePaise: by(x.earnings, 'overtime'),
  }));
  const sum = (k: 'grossPaise' | 'pfPaise' | 'esiPaise' | 'ptPaise' | 'deductionsPaise' | 'netPaise' | 'employerPaise') => rows.reduce((s, x) => s + x[k], 0);
  const run = b.run[0] ?? null;
  return {
    data: rows, run: run && { id: run.id, number: run.number, status: run.status, payDate: run.payDate },
    sums: { people: rows.length, grossPaise: sum('grossPaise'), pfPaise: sum('pfPaise'), esiPaise: sum('esiPaise'), ptPaise: sum('ptPaise'), deductionsPaise: sum('deductionsPaise'), netPaise: sum('netPaise'), employerPaise: sum('employerPaise'), costPaise: sum('grossPaise') + sum('employerPaise'), unpaid: rows.filter((x) => x.status !== 'paid').length },
  };
}

/** Leave approved in the period, per person and type, with what is still waiting. */
export async function leaveReport(ctx: TenantCtx, p: P) {
  const t = ctx.tenantId;
  const b = await bundle({
    types: Prisma.sql`select id, name, code, color, paid from leave_types where tenant_id = ${t}::uuid and is_active order by position, name`,
    rows: Prisma.sql`
      select e.id, e.code, e.name, d.name as department,
        (select coalesce(json_object_agg(x.leave_type_id, x.days), '{}'::json) from (
          select l.leave_type_id, sum(l.days) as days from leave_applications l
          where l.employee_id = e.id and l.status = 'approved' and l.from_date <= ${p.to}::date and l.to_date >= ${p.from}::date group by l.leave_type_id) x) as taken,
        (select coalesce(sum(l.days), 0) from leave_applications l where l.employee_id = e.id and l.status = 'pending' and l.from_date <= ${p.to}::date and l.to_date >= ${p.from}::date) as pending,
        (select count(*) from leave_applications l where l.employee_id = e.id and l.status = 'rejected' and l.from_date <= ${p.to}::date and l.to_date >= ${p.from}::date) as rejected
      from employees e left join hr_departments d on d.id = e.department_id
      where e.tenant_id = ${t}::uuid and e.status <> 'exited' ${await empScope(ctx)} order by e.name`,
  });
  const paid = new Map(b.types.map((x) => [x.id as string, !!x.paid]));
  const rows = b.rows.map((x) => {
    const taken = Object.fromEntries(Object.entries((x.taken ?? {}) as Record<string, number>).map(([k, v]) => [k, n(v)]));
    const total = Object.values(taken).reduce((s, v) => s + v, 0);
    return { id: x.id as string, code: x.code as string, name: x.name as string, department: x.department as string | null, taken, total, unpaid: Object.entries(taken).filter(([k]) => !paid.get(k)).reduce((s, [, v]) => s + v, 0), pending: n(x.pending), rejected: n(x.rejected) };
  });
  return { data: rows, types: b.types, sums: { days: rows.reduce((s, x) => s + x.total, 0), pending: rows.reduce((s, x) => s + x.pending, 0), people: rows.filter((x) => x.total > 0).length } };
}

// ---------------------------------------------------------------- bookings

export const BookingReport = Period.and(z.object({ by: z.enum(['service', 'staff', 'source', 'day', 'customer']).default('service') }));

/** Appointments grouped by service, person, where they came from, day or customer. */
export async function bookingReport(ctx: TenantCtx, p: P & { by: 'service' | 'staff' | 'source' | 'day' | 'customer' }) {
  const t = ctx.tenantId;
  const own = scopeSql(ctx, ['a.staff_id', 'a.created_by']);
  const b = await bundle({
    rows: Prisma.sql`
      select a.id, a.status, a.source, a.start_at, a.end_at, a.price_paise, a.invoice_id, a.staff_id, a.item_id, a.contact_id, a.guest_name,
        i.name as service, c.name as customer, coalesce(bs.color, 'blue') as color
      from appointments a left join items i on i.id = a.item_id left join contacts c on c.id = a.contact_id
        left join booking_services bs on bs.item_id = a.item_id and bs.tenant_id = a.tenant_id
      where a.tenant_id = ${t}::uuid and a.kind = 'appointment'
        and a.start_at >= (${p.from}::date)::timestamp - interval '5 hours 30 minutes' and a.start_at < (${p.to}::date + 1)::timestamp - interval '5 hours 30 minutes' ${own}`,
    ...userPart(t),
  });
  const people = userNames(b);
  const SRC: Record<string, string> = { walk_in: 'Walk-in', phone: 'Phone', whatsapp: 'WhatsApp', online: 'Online page', other: 'Other' };
  const groups = new Map<string, { id: string; label: string; color?: string; total: number; completed: number; noShow: number; cancelled: number; upcoming: number; minutes: number; earnedPaise: number; invoicedPaise: number; customers: Set<string> }>();
  const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  for (const a of b.rows as Row[]) {
    const start = new Date(a.startAt);
    const [id, label] = p.by === 'service' ? [a.itemId ?? 'none', a.service ?? 'No service']
      : p.by === 'staff' ? [a.staffId ?? 'none', a.staffId ? people.get(a.staffId) ?? 'Staff' : 'Not assigned']
      : p.by === 'source' ? [a.source ?? 'other', SRC[a.source] ?? 'Other']
      : p.by === 'day' ? [ist(start), ist(start)]
      : [a.contactId ?? `guest:${(a.guestName ?? '').toLowerCase()}`, a.customer ?? a.guestName ?? 'Walk-in guest'];
    const g = groups.get(id) ?? { id, label, color: p.by === 'service' ? a.color : undefined, total: 0, completed: 0, noShow: 0, cancelled: 0, upcoming: 0, minutes: 0, earnedPaise: 0, invoicedPaise: 0, customers: new Set<string>() };
    g.total++;
    if (a.status === 'completed') { g.completed++; g.earnedPaise += n(a.pricePaise); g.minutes += (new Date(a.endAt).getTime() - start.getTime()) / 60_000; if (a.invoiceId) g.invoicedPaise += n(a.pricePaise); }
    else if (a.status === 'no_show') g.noShow++;
    else if (a.status === 'cancelled') g.cancelled++;
    else g.upcoming++;
    g.customers.add(a.contactId ?? a.guestName ?? a.id);
    groups.set(id, g);
  }
  const rows = [...groups.values()].map(({ customers, ...g }) => ({ ...g, customers: customers.size, minutes: Math.round(g.minutes), noShowPct: pct(g.noShow, g.total - g.cancelled - g.upcoming), avgPaise: g.completed ? Math.round(g.earnedPaise / g.completed) : 0 }))
    .sort((a, z) => (p.by === 'day' ? a.id.localeCompare(z.id) : z.earnedPaise - a.earnedPaise || z.total - a.total));
  const tot = (k: 'total' | 'completed' | 'noShow' | 'cancelled' | 'earnedPaise' | 'invoicedPaise') => rows.reduce((s, r) => s + r[k], 0);
  return { data: rows, sums: { total: tot('total'), completed: tot('completed'), noShow: tot('noShow'), cancelled: tot('cancelled'), earnedPaise: tot('earnedPaise'), invoicedPaise: tot('invoicedPaise'), noShowPct: pct(tot('noShow'), tot('completed') + tot('noShow')) } };
}

// ---------------------------------------------------------------- tasks & time

export const TimeReport = Period.and(z.object({ by: z.enum(['project', 'person', 'day', 'task']).default('project') }));

/** Time logged, grouped, with the billable share and what it is worth; and each person's tasks. */
export async function timeReport(ctx: TenantCtx, p: P & { by: 'project' | 'person' | 'day' | 'task' }) {
  const t = ctx.tenantId;
  const own = scopeSql(ctx, ['tt.user_id']);
  const ownTask = scopeSql(ctx, ['k.assignee_id', 'k.created_by']);
  const b = await bundle({
    rows: Prisma.sql`
      select tt.id, tt.user_id, tt.work_date, tt.minutes, tt.billable, tt.task_id, coalesce(tt.project_id, k.project_id) as project_id,
        k.title as task, pr.name as project, pr.color, pr.hourly_rate_paise
      from task_times tt left join tasks k on k.id = tt.task_id left join task_projects pr on pr.id = coalesce(tt.project_id, k.project_id)
      where tt.tenant_id = ${t}::uuid and tt.work_date between ${p.from}::date and ${p.to}::date ${own}`,
    tasks: Prisma.sql`
      select k.assignee_id, count(*) filter (where k.status = 'done' and k.completed_at >= (${p.from}::date)::timestamp - interval '5 hours 30 minutes' and k.completed_at < (${p.to}::date + 1)::timestamp - interval '5 hours 30 minutes') as done,
        count(*) filter (where k.status = 'done' and k.completed_at >= (${p.from}::date)::timestamp - interval '5 hours 30 minutes' and k.completed_at < (${p.to}::date + 1)::timestamp - interval '5 hours 30 minutes' and (k.due_at is null or k.completed_at <= k.due_at)) as on_time,
        count(*) filter (where k.status in ('todo', 'in_progress')) as open,
        count(*) filter (where k.status in ('todo', 'in_progress') and k.due_at < now()) as overdue
      from tasks k where k.tenant_id = ${t}::uuid ${ownTask} group by k.assignee_id`,
    ...userPart(t),
  });
  const people = userNames(b);
  const tasks = new Map(b.tasks.map((x) => [x.assigneeId ?? 'none', x]));
  const groups = new Map<string, { id: string; label: string; color?: string; minutes: number; billableMinutes: number; valuePaise: number; entries: number; people: Set<string> }>();
  for (const r of b.rows) {
    const day = new Date(r.workDate).toISOString().slice(0, 10);
    const [id, label] = p.by === 'project' ? [r.projectId ?? 'none', r.project ?? 'No project']
      : p.by === 'person' ? [r.userId, people.get(r.userId) ?? 'Someone']
      : p.by === 'day' ? [day, day]
      : [r.taskId ?? `p:${r.projectId ?? 'none'}`, r.task ?? `${r.project ?? 'General'} (no task)`];
    const g = groups.get(id) ?? { id, label, color: p.by === 'project' ? r.color ?? 'slate' : undefined, minutes: 0, billableMinutes: 0, valuePaise: 0, entries: 0, people: new Set<string>() };
    g.minutes += n(r.minutes);
    g.entries++;
    g.people.add(r.userId);
    if (r.billable) { g.billableMinutes += n(r.minutes); g.valuePaise += Math.round((n(r.minutes) / 60) * n(r.hourlyRatePaise)); }
    groups.set(id, g);
  }
  const rows = [...groups.values()].map(({ people: ps, ...g }) => {
    const k = p.by === 'person' ? tasks.get(g.id) : null;
    return { ...g, people: ps.size, billablePct: pct(g.billableMinutes, g.minutes), done: k ? n(k.done) : null, onTimePct: k ? pct(n(k.onTime), n(k.done)) : null, open: k ? n(k.open) : null, overdue: k ? n(k.overdue) : null };
  }).sort((a, z) => (p.by === 'day' ? a.id.localeCompare(z.id) : z.minutes - a.minutes));
  // People with tasks but no time still show on the person view
  if (p.by === 'person') for (const [id, k] of tasks) if (id !== 'none' && !groups.has(id)) rows.push({ id, label: people.get(id) ?? 'Someone', minutes: 0, billableMinutes: 0, valuePaise: 0, entries: 0, people: 1, billablePct: 0, done: n(k.done), onTimePct: pct(n(k.onTime), n(k.done)), open: n(k.open), overdue: n(k.overdue) });
  const tot = (k: 'minutes' | 'billableMinutes' | 'valuePaise') => rows.reduce((s, r) => s + r[k], 0);
  return { data: rows, sums: { minutes: tot('minutes'), billableMinutes: tot('billableMinutes'), valuePaise: tot('valuePaise'), billablePct: pct(tot('billableMinutes'), tot('minutes')), people: new Set(b.rows.map((r) => r.userId)).size } };
}
