import { Prisma } from '@prisma/client';
import type { TenantCtx } from '../../kernel/context';
import { todayIST } from '../../kernel/gst';
import { bundle, nameParts, namesFrom } from './bundle';
import { ensureHr, HrConfig } from './setup';
import { hrReach } from './employees';

// HR home: who is in today, who is away, what waits for approval, and what is coming up.
// Everything is read in ONE database round trip (see bundle.ts), then worked out here.

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const add = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86_400_000));

async function read(ctx: TenantCtx, today: string) {
  const t = ctx.tenantId;
  const month = today.slice(0, 7);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const calFrom = add(today, -62);
  const calTo = add(today, 124);
  return bundle({
    ...nameParts(t),
    settings: Prisma.sql`select data from hr_settings where tenant_id = ${t}::uuid`,
    types: Prisma.sql`select id, name, color from leave_types where tenant_id = ${t}::uuid`,
    depts: Prisma.sql`select id, name from hr_departments where tenant_id = ${t}::uuid and is_active`,
    emps: Prisma.sql`select id, name, code, dob, joined_on, employment_type, department_id, status, exit_on from employees where tenant_id = ${t}::uuid and status <> 'exited'`,
    attToday: Prisma.sql`select employee_id, status, late_minutes from attendance where tenant_id = ${t}::uuid and date = ${today}::date`,
    absentYesterday: Prisma.sql`select count(*)::int as n from attendance where tenant_id = ${t}::uuid and date = ${add(today, -1)}::date and status = 'absent'`,
    pending: Prisma.sql`select id, employee_id, leave_type_id, from_date, to_date, days from leave_applications where tenant_id = ${t}::uuid and status = 'pending' order by created_at desc`,
    onLeave: Prisma.sql`select id, employee_id, leave_type_id, to_date from leave_applications where tenant_id = ${t}::uuid and status = 'approved' and from_date <= ${today}::date and to_date >= ${today}::date`,
    recent: Prisma.sql`select id, employee_id, leave_type_id, from_date, to_date, days, status, created_at from leave_applications where tenant_id = ${t}::uuid order by created_at desc limit 6`,
    holidays: Prisma.sql`select id, name, from_date, to_date, kind, optional from holidays where tenant_id = ${t}::uuid and from_date <= ${calTo}::date and to_date >= ${calFrom}::date order by from_date`,
    posts: Prisma.sql`select id, kind, title, starts_on, ends_on, starts_at, location, priority, category, status from hr_posts where tenant_id = ${t}::uuid and kind in ('announcement', 'event') and status in ('active', 'approved', 'pending') and (ends_on is null or ends_on >= ${calFrom}::date) order by created_at desc limit 200`,
    career: Prisma.sql`select kind, count(*)::int as n from hr_actions where tenant_id = ${t}::uuid and status in ('pending', 'open', 'in_review') group by kind`,
    promotions: Prisma.sql`select count(*)::int as n from hr_actions where tenant_id = ${t}::uuid and kind = 'promotion' and status = 'approved' and coalesce(effective_on, on_date) >= ${yearStart}::date`,
    exits: Prisma.sql`select count(*)::int as n from employees where tenant_id = ${t}::uuid and exit_on >= ${`${month}-01`}::date and exit_on < (${`${month}-01`}::date + interval '1 month')`,
    run: Prisma.sql`select id, status, net_paise, paid_paise, employees from payroll_runs where tenant_id = ${t}::uuid and month = ${month}`,
  });
}

export async function hrDashboard(ctx: TenantCtx) {
  const today = todayIST();
  const month = today.slice(0, 7);
  let b = await read(ctx, today);
  // A business opening HR for the first time gets its default shift and leave types
  if (!b._shift.length || !b.types.length) { await ensureHr(ctx); b = await read(ctx, today); }
  // A team manager (or branch-scoped HR) sees only the people in reach; the payroll run stays company-wide
  const reach = await hrReach(ctx);
  if (reach) {
    const has = (r: { employeeId?: unknown; id?: unknown }, k: 'employeeId' | 'id' = 'employeeId') => reach.includes(r[k] as string);
    b = { ...b, emps: b.emps.filter((e) => has(e, 'id')), attToday: b.attToday.filter((x) => has(x)), pending: b.pending.filter((x) => has(x)), onLeave: b.onLeave.filter((x) => has(x)), recent: b.recent.filter((x) => has(x)), run: [] };
  }
  const lookup = namesFrom(b);
  const cfg = HrConfig.parse(b.settings[0]?.data ?? {});
  const typeOf = (id: string) => b.types.find((x) => x.id === id);
  const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;

  // Attendance today, as the day register works it out
  const holidayToday = b.holidays.find((h) => !h.optional && iso(h.fromDate) <= today && iso(h.toDate) >= today) ?? null;
  const working = cfg.workingDays.includes(day(today).getUTCDay()) && !holidayToday;
  const here = b.emps.filter((e) => iso(e.joinedOn) <= today && (!e.exitOn || iso(e.exitOn) >= today)).sort((x, y) => String(x.name).localeCompare(String(y.name)));
  const att = here.map((e) => ({ e, a: b.attToday.find((x) => x.employeeId === e.id) ?? null }));
  const count = (s: string) => att.filter((x) => x.a?.status === s).length;

  const mmdd = today.slice(5);
  const in60 = add(today, 60);
  const soon = (d: Date) => { const k = iso(d).slice(5); return k >= mmdd && k <= in60.slice(5) ? k : null; };
  const birthdays = b.emps.filter((e) => e.dob && soon(e.dob)).map((e) => ({ id: e.id, name: e.name, date: `${today.slice(0, 4)}-${iso(e.dob).slice(5)}` })).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 6);
  const anniversaries = b.emps.filter((e) => iso(e.joinedOn) < today.slice(0, 4) && soon(e.joinedOn)).map((e) => ({ id: e.id, name: e.name, date: `${today.slice(0, 4)}-${iso(e.joinedOn).slice(5)}`, years: Number(today.slice(0, 4)) - Number(iso(e.joinedOn).slice(0, 4)) })).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 6);
  const typeCount = (t: string) => b.emps.filter((e) => e.employmentType === t).length;
  const live = b.posts.filter((p) => p.status !== 'pending' && (!p.endsOn || iso(p.endsOn) >= today));
  const run = b.run[0];

  return {
    today,
    employees: { total: b.emps.length, fullTime: typeCount('full_time'), partTime: typeCount('part_time'), contract: typeCount('contract') + typeCount('temporary'), intern: typeCount('intern'), onNotice: b.emps.filter((e) => e.status === 'on_notice').length, joinedThisMonth: b.emps.filter((e) => iso(e.joinedOn).startsWith(month)).length },
    attendance: {
      total: att.length, present: count('present'), half_day: count('half_day'), absent: count('absent'), leave: count('leave'), unmarked: att.filter((x) => !x.a).length, late: att.filter((x) => (x.a?.lateMinutes ?? 0) > 0).length,
      working, holiday: holidayToday?.name ?? null,
      missing: working ? att.filter((x) => !x.a).slice(0, 8).map((x) => ({ id: x.e.id, name: x.e.name, code: x.e.code, sub: lookup.sub.get(x.e.id) ?? null })) : [],
    },
    pendingLeaves: b.pending.slice(0, 6).map((l) => ({ id: l.id, employee: lookup.emp.get(l.employeeId) ?? '—', leaveType: typeOf(l.leaveTypeId)?.name ?? '—', fromDate: l.fromDate, toDate: l.toDate, days: Number(l.days) })),
    pendingLeaveCount: b.pending.length,
    onLeave: b.onLeave.map((l) => ({ id: l.id, employee: lookup.emp.get(l.employeeId) ?? '—', leaveType: typeOf(l.leaveTypeId)?.name ?? '—', color: typeOf(l.leaveTypeId)?.color ?? 'slate', toDate: l.toDate })),
    holidays: b.holidays.filter((h) => iso(h.toDate) >= today && iso(h.fromDate) <= in60).slice(0, 6).map((h) => ({ id: h.id, name: h.name, fromDate: h.fromDate, toDate: h.toDate, kind: h.kind })),
    posts: live.slice(0, 6).map((p) => ({ id: p.id, kind: p.kind, title: p.title, startsOn: p.startsOn, priority: p.priority, category: p.category })),
    approvals: Object.fromEntries(b.career.map((c) => [c.kind, c.n])),
    payroll: run ? { id: run.id, status: run.status, netPaise: run.netPaise, paidPaise: run.paidPaise, employees: run.employees } : null,
    departments: b.depts.map((d) => ({ id: d.id, name: d.name, employees: b.emps.filter((e) => e.departmentId === d.id).length })).sort((x, y) => y.employees - x.employees),
    birthdays, anniversaries,
    counts: { branches: b._branch.length, departments: b.depts.length, absentYesterday: n(b.absentYesterday as { n: number }[]), promotionsYear: n(b.promotions as { n: number }[]), exitsMonth: n(b.exits as { n: number }[]) },
    calendar: [
      ...b.posts.filter((p) => p.kind === 'event' && p.startsOn).map((p) => ({ id: p.id, kind: 'event', title: p.title, from: iso(p.startsOn), to: p.endsOn ? iso(p.endsOn) : null, time: p.startsAt, place: p.location, pending: p.status === 'pending', category: p.category })),
      ...b.holidays.map((h) => ({ id: h.id, kind: 'holiday', title: h.name, from: iso(h.fromDate), to: iso(h.toDate), time: null, place: null, pending: false, category: h.kind })),
    ],
    recentLeaves: b.recent.map((l) => ({ id: l.id, employee: lookup.emp.get(l.employeeId) ?? '—', leaveType: typeOf(l.leaveTypeId)?.name ?? '—', color: typeOf(l.leaveTypeId)?.color ?? 'slate', fromDate: l.fromDate, toDate: l.toDate, days: Number(l.days), status: l.status, createdAt: l.createdAt })),
  };
}
