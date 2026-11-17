import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { todayIST } from '../../kernel/gst';
import { DateStr } from '../../kernel/query';
import { audit } from '../audit/service';
import { employeeScope, myEmployee } from './employees';
import { getConfig, listLeaveTypes, shiftMinutes, toMinutes, type HrConfig } from './setup';
import { Prisma } from '@prisma/client';
import { bundle, nameParts, namesFrom } from './bundle';
import { HrConfig as HrConfigSchema } from './setup';

// Attendance and leave. Days with no attendance mark count as worked (most shops only mark who
// was absent); approved leave fills the attendance register; holidays and weekly offs are known
// from setup. Loss-of-pay days for payroll come from here.

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86_400_000));
const nowHHMM = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 16);

export const STATUSES = ['present', 'absent', 'half_day', 'leave', 'holiday', 'week_off'] as const;
type Status = (typeof STATUSES)[number];

type Hol = { fromDate: Date; toDate: Date; name: string; paid: boolean; optional: boolean };
export function holidayOn(holidays: Hol[], date: string) {
  const d = day(date);
  return holidays.find((h) => !h.optional && h.fromDate <= d && h.toDate >= d) ?? null;
}
export const isWorkingDay = (cfg: HrConfig, holidays: Hol[], date: string) => cfg.workingDays.includes(day(date).getUTCDay()) && !holidayOn(holidays, date);

async function holidaysBetween(ctx: TenantCtx, from: string, to: string) {
  return db().holiday.findMany({ where: { tenantId: ctx.tenantId, fromDate: { lte: day(to) }, toDate: { gte: day(from) } } });
}

/** Worked, late and overtime minutes from clock-in and clock-out against the shift */
function minutes(shift: { startsAt: string; endsAt: string; breakMinutes: number; graceMinutes: number } | null, clockIn?: string | null, clockOut?: string | null) {
  if (!clockIn || !clockOut) return { worked: 0, late: shift && clockIn ? Math.max(0, toMinutes(clockIn) - toMinutes(shift.startsAt) - shift.graceMinutes) : 0, overtime: 0 };
  let span = toMinutes(clockOut) - toMinutes(clockIn);
  if (span < 0) span += 24 * 60;
  const breakMin = shift && span > 5 * 60 ? shift.breakMinutes : 0;
  const worked = Math.max(0, span - breakMin);
  const planned = shift ? shiftMinutes(shift) : 8 * 60;
  return { worked, late: shift ? Math.max(0, toMinutes(clockIn) - toMinutes(shift.startsAt) - shift.graceMinutes) : 0, overtime: Math.max(0, worked - planned) };
}

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const MarkInput = z.object({
  date: DateStr,
  rows: z.array(z.object({
    employeeId: z.string().uuid(),
    status: z.enum(['present', 'absent', 'half_day', 'week_off', 'holiday']).optional(),
    clockIn: Time.optional().nullable().or(z.literal('').transform(() => null)),
    clockOut: Time.optional().nullable().or(z.literal('').transform(() => null)),
    notes: z.string().trim().max(300).optional().nullable(),
  })).min(1, 'Mark at least one employee').max(1000),
});

const employedOn = (e: { joinedOn: Date; exitOn: Date | null }, date: string) => iso(e.joinedOn) <= date && (!e.exitOn || iso(e.exitOn) >= date);

export async function markAttendance(ctx: TenantCtx, b: z.infer<typeof MarkInput>) {
  if (b.date > todayIST()) throw new AppError('VALIDATION_FAILED', "Attendance can't be marked for a future date.", { fields: { date: 'In the future' } });
  const ids = [...new Set(b.rows.map((r) => r.employeeId))];
  const [emps, shifts, leaves] = await Promise.all([
    db().employee.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } } }),
    db().hrShift.findMany({ where: { tenantId: ctx.tenantId } }),
    db().attendance.findMany({ where: { tenantId: ctx.tenantId, date: day(b.date), employeeId: { in: ids }, source: 'leave' } }),
  ]);
  let saved = 0;
  for (const r of b.rows) {
    const e = emps.find((x) => x.id === r.employeeId);
    if (!e) throw new AppError('VALIDATION_FAILED', 'Choose employees from the list.');
    if (!employedOn(e, b.date)) throw new AppError('VALIDATION_FAILED', `${e.name} was not working here on ${b.date}.`);
    // Approved leave owns the day; change the leave instead
    if (leaves.some((l) => l.employeeId === e.id)) continue;
    if (r.clockIn && r.clockOut === r.clockIn) throw new AppError('VALIDATION_FAILED', `${e.name}: clock-out must differ from clock-in.`);
    const shift = shifts.find((s) => s.id === e.shiftId) ?? shifts.find((s) => s.isDefault) ?? null;
    const m = minutes(shift, r.clockIn, r.clockOut);
    // No status given: work it out from the hours (under half the shift is a half day)
    const status: Status = r.status ?? (r.clockIn ? (r.clockOut && shift && m.worked < shiftMinutes(shift) / 2 ? 'half_day' : 'present') : 'present');
    const timed = status === 'present' || status === 'half_day';
    const values = { status, clockIn: timed ? r.clockIn ?? null : null, clockOut: timed ? r.clockOut ?? null : null, workedMinutes: timed ? m.worked : 0, lateMinutes: timed ? m.late : 0, overtimeMinutes: timed ? m.overtime : 0, notes: r.notes ?? null, source: 'manual' };
    await db().attendance.upsert({ where: { employeeId_date: { employeeId: e.id, date: day(b.date) } }, create: { ...values, tenantId: ctx.tenantId, employeeId: e.id, date: day(b.date), createdBy: ctx.userId }, update: values });
    saved++;
  }
  return { saved };
}

export async function clearAttendance(ctx: TenantCtx, employeeId: string, date: string) {
  const row = await db().attendance.findFirst({ where: { tenantId: ctx.tenantId, employeeId, date: day(date) } });
  if (!row) return;
  if (row.source === 'leave') throw new AppError('CONFLICT', 'This day is approved leave. Cancel the leave instead.');
  await db().attendance.delete({ where: { id: row.id } });
}

/** Self-service clock in and out, for the employee who is signed in */
export async function clock(ctx: TenantCtx, action: 'in' | 'out') {
  const e = await myEmployee(ctx);
  if (!e) throw new AppError('CONFLICT', 'Your login is not linked to an employee record. Ask HR to link it.');
  const today = todayIST();
  const shift = (e.shiftId ? await db().hrShift.findFirst({ where: { id: e.shiftId } }) : null) ?? (await db().hrShift.findFirst({ where: { tenantId: ctx.tenantId, isDefault: true } }));
  const row = await db().attendance.findFirst({ where: { tenantId: ctx.tenantId, employeeId: e.id, date: day(today) } });
  const now = nowHHMM();
  if (row?.source === 'leave') throw new AppError('CONFLICT', 'You are on approved leave today.');
  if (action === 'in') {
    if (row?.clockIn) throw new AppError('CONFLICT', `You clocked in at ${row.clockIn}.`);
    const m = minutes(shift, now, null);
    await db().attendance.upsert({ where: { employeeId_date: { employeeId: e.id, date: day(today) } }, create: { tenantId: ctx.tenantId, employeeId: e.id, date: day(today), status: 'present', clockIn: now, lateMinutes: m.late, source: 'self', createdBy: ctx.userId }, update: { status: 'present', clockIn: now, lateMinutes: m.late, source: 'self' } });
  } else {
    if (!row?.clockIn) throw new AppError('CONFLICT', 'Clock in first.');
    if (row.clockOut) throw new AppError('CONFLICT', `You clocked out at ${row.clockOut}.`);
    const m = minutes(shift, row.clockIn, now);
    await db().attendance.update({ where: { id: row.id }, data: { clockOut: now, workedMinutes: m.worked, lateMinutes: m.late, overtimeMinutes: m.overtime, status: shift && m.worked < shiftMinutes(shift) / 2 ? 'half_day' : 'present' } });
  }
  return myToday(ctx);
}

export async function myToday(ctx: TenantCtx) {
  const e = await myEmployee(ctx);
  if (!e) return { employee: null, today: null };
  const row = await db().attendance.findFirst({ where: { tenantId: ctx.tenantId, employeeId: e.id, date: day(todayIST()) } });
  const shift = e.shiftId ? await db().hrShift.findFirst({ where: { id: e.shiftId } }) : null;
  return { employee: { id: e.id, name: e.name, code: e.code }, shift, today: row };
}

/** Everyone working on a date with their mark, approved leave and the day's holiday */
export async function dayView(ctx: TenantCtx, date: string) {
  const [cfg, holidays, emps, rows, shifts] = await Promise.all([
    getConfig(ctx), holidaysBetween(ctx, date, date),
    db().employee.findMany({ where: { AND: [employeeScope(ctx), { joinedOn: { lte: day(date) } }, { OR: [{ exitOn: null }, { exitOn: { gte: day(date) } }] }] }, orderBy: { name: 'asc' } }),
    db().attendance.findMany({ where: { tenantId: ctx.tenantId, date: day(date) } }),
    db().hrShift.findMany({ where: { tenantId: ctx.tenantId } }),
  ]);
  const holiday = holidayOn(holidays, date);
  const working = isWorkingDay(cfg, holidays, date);
  const depts = new Map((await db().hrDepartment.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
  const data = emps.map((e) => {
    const r = rows.find((x) => x.employeeId === e.id) ?? null;
    const shift = shifts.find((s) => s.id === e.shiftId) ?? shifts.find((s) => s.isDefault) ?? null;
    return { id: e.id, employeeId: e.id, code: e.code, name: e.name, department: e.departmentId ? depts.get(e.departmentId) ?? null : null, shift: shift ? `${shift.name} ${shift.startsAt}–${shift.endsAt}` : null, attendance: r, status: (r?.status ?? null) as Status | null };
  });
  const count = (s: Status) => data.filter((d) => d.status === s).length;
  return {
    date, working, holiday: holiday ? holiday.name : null, weekOff: !cfg.workingDays.includes(day(date).getUTCDay()),
    data,
    counts: { total: data.length, present: count('present'), half_day: count('half_day'), absent: count('absent'), leave: count('leave'), unmarked: data.filter((d) => !d.status).length, late: data.filter((d) => (d.attendance?.lateMinutes ?? 0) > 0).length },
  };
}

/** The monthly register: one letter per employee per day, with totals */
export async function monthView(ctx: TenantCtx, month: string, employeeId?: string) {
  const from = `${month}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const to = `${month}-${String(last).padStart(2, '0')}`;
  const today = todayIST();
  const [cfg, holidays, emps, rows] = await Promise.all([
    getConfig(ctx), holidaysBetween(ctx, from, to),
    db().employee.findMany({ where: { AND: [employeeScope(ctx), employeeId ? { id: employeeId } : {}, { joinedOn: { lte: day(to) } }, { OR: [{ exitOn: null }, { exitOn: { gte: day(from) } }] }] }, orderBy: { name: 'asc' } }),
    db().attendance.findMany({ where: { tenantId: ctx.tenantId, date: { gte: day(from), lte: day(to) } } }),
  ]);
  const days = Array.from({ length: last }, (_, i) => addDays(from, i));
  const data = emps.map((e) => {
    const mine = new Map(rows.filter((r) => r.employeeId === e.id).map((r) => [iso(r.date), r]));
    const t = { present: 0, absent: 0, half_day: 0, leave: 0, holiday: 0, week_off: 0, unmarked: 0, late: 0, workedMinutes: 0, overtimeMinutes: 0 };
    const cells = days.map((d) => {
      if (!employedOn(e, d)) return '';
      const r = mine.get(d);
      if (r) {
        t[r.status as Status] += 1;
        if (r.lateMinutes > 0) t.late += 1;
        t.workedMinutes += r.workedMinutes;
        t.overtimeMinutes += r.overtimeMinutes;
        return r.status;
      }
      if (d > today) return 'future';
      if (holidayOn(holidays, d)) { t.holiday += 1; return 'holiday'; }
      if (!cfg.workingDays.includes(day(d).getUTCDay())) { t.week_off += 1; return 'week_off'; }
      t.unmarked += 1;
      return 'unmarked';
    });
    return { id: e.id, code: e.code, name: e.name, cells, totals: t };
  });
  return { month, days, holidays: holidays.map((h) => ({ name: h.name, from: iso(h.fromDate), to: iso(h.toDate) })), workingDays: cfg.workingDays, data };
}

// ── Leave ──

/** Leave days between two dates: working days only (weekly offs and holidays don't count) */
export function leaveDays(cfg: HrConfig, holidays: Hol[], from: string, to: string, halfDay: boolean) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkingDay(cfg, holidays, d)) out.push(d);
  return { dates: out, days: halfDay && from === to && out.length ? 0.5 : out.length };
}

export const LeaveInput = z.object({
  employeeId: z.string().uuid().optional(),
  leaveTypeId: z.string().uuid({ message: 'Choose the leave type' }),
  fromDate: DateStr,
  toDate: DateStr,
  halfDay: z.boolean().default(false),
  reason: z.string().trim().min(3, 'Say why the leave is needed').max(500),
}).refine((l) => l.toDate >= l.fromDate, { message: 'The end date must be on or after the start', path: ['toDate'] })
  .refine((l) => !l.halfDay || l.fromDate === l.toDate, { message: 'A half day is for one date only', path: ['halfDay'] });

function leaveYear(cfg: HrConfig, date: string) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= cfg.leaveYearStart ? y : y - 1;
  const from = `${start}-${String(cfg.leaveYearStart).padStart(2, '0')}-01`;
  return { from, to: addDays(`${start + 1}-${String(cfg.leaveYearStart).padStart(2, '0')}-01`, -1) };
}

/** Each employee's leave this leave year: allowed, taken, waiting for approval, left */
export async function balances(ctx: TenantCtx, opts: { employeeId?: string; date?: string } = {}) {
  const cfg = await getConfig(ctx);
  const year = leaveYear(cfg, opts.date ?? todayIST());
  const [types, emps, apps] = await Promise.all([
    listLeaveTypes(ctx),
    db().employee.findMany({ where: { AND: [employeeScope(ctx), opts.employeeId ? { id: opts.employeeId } : {}, { status: { not: 'exited' } }] }, orderBy: { name: 'asc' } }),
    db().leaveApplication.findMany({ where: { tenantId: ctx.tenantId, status: { in: ['approved', 'pending'] }, fromDate: { gte: day(year.from), lte: day(year.to) } } }),
  ]);
  const active = types.filter((t) => t.isActive);
  return {
    year,
    types: active.map((t) => ({ id: t.id, name: t.name, code: t.code, color: t.color, paid: t.paid, daysPerYear: t.daysPerYear })),
    data: emps.map((e) => ({
      id: e.id, code: e.code, name: e.name,
      leave: active.map((t) => {
        const mine = apps.filter((a) => a.employeeId === e.id && a.leaveTypeId === t.id);
        const used = mine.filter((a) => a.status === 'approved').reduce((s, a) => s + Number(a.days), 0);
        const pending = mine.filter((a) => a.status === 'pending').reduce((s, a) => s + Number(a.days), 0);
        return { typeId: t.id, allowed: t.daysPerYear, used, pending, left: t.daysPerYear ? Math.max(0, t.daysPerYear - used) : null };
      }),
    })),
  };
}

async function leaveData(ctx: TenantCtx, b: z.infer<typeof LeaveInput>, exceptId?: string) {
  let employeeId = b.employeeId;
  if (ctx.scope === 'own' || !employeeId) {
    const me = await myEmployee(ctx);
    if (!me) throw new AppError('VALIDATION_FAILED', 'Choose the employee.', { fields: { employeeId: 'Choose the employee' } });
    if (ctx.scope === 'own' || !employeeId) employeeId = me.id;
  }
  const [cfg, e, type, holidays] = await Promise.all([
    getConfig(ctx),
    db().employee.findFirst({ where: { id: employeeId, tenantId: ctx.tenantId } }),
    db().leaveType.findFirst({ where: { id: b.leaveTypeId, tenantId: ctx.tenantId, isActive: true } }),
    holidaysBetween(ctx, b.fromDate, b.toDate),
  ]);
  if (!e || e.status === 'exited') throw new AppError('VALIDATION_FAILED', 'Choose a current employee.', { fields: { employeeId: 'Choose the employee' } });
  if (!type) throw new AppError('VALIDATION_FAILED', 'Choose the leave type.', { fields: { leaveTypeId: 'Choose the leave type' } });
  if (b.fromDate < iso(e.joinedOn)) throw new AppError('VALIDATION_FAILED', 'Leave cannot start before the joining date.', { fields: { fromDate: 'Before joining' } });
  const { days } = leaveDays(cfg, holidays, b.fromDate, b.toDate, b.halfDay);
  if (!days) throw new AppError('VALIDATION_FAILED', 'These dates are all holidays or weekly offs: no leave is needed.', { fields: { toDate: 'No working days' } });
  const clash = await db().leaveApplication.findFirst({ where: { tenantId: ctx.tenantId, employeeId, status: { in: ['pending', 'approved'] }, fromDate: { lte: day(b.toDate) }, toDate: { gte: day(b.fromDate) }, id: exceptId ? { not: exceptId } : undefined } });
  if (clash) throw new AppError('VALIDATION_FAILED', `There is already leave from ${iso(clash.fromDate)} to ${iso(clash.toDate)}.`, { fields: { fromDate: 'Overlaps another leave' } });
  if (type.paid && Number(type.daysPerYear) > 0) {
    const bal = await balances(ctx, { employeeId, date: b.fromDate });
    const mine = bal.data[0]?.leave.find((l) => l.typeId === type.id);
    const left = mine ? Number(type.daysPerYear) - mine.used - mine.pending + (exceptId ? Number((await db().leaveApplication.findUnique({ where: { id: exceptId } }))?.days ?? 0) : 0) : 0;
    if (days > left) throw new AppError('VALIDATION_FAILED', `Only ${left} day${left === 1 ? '' : 's'} of ${type.name} left. Choose "Loss of pay" for the rest.`, { fields: { toDate: 'Not enough balance' } });
  }
  return { employeeId: employeeId!, leaveTypeId: type.id, fromDate: day(b.fromDate), toDate: day(b.toDate), halfDay: b.halfDay, days, reason: b.reason };
}

export async function applyLeave(ctx: TenantCtx, b: z.infer<typeof LeaveInput>) {
  const data = await leaveData(ctx, b);
  const l = await db().leaveApplication.create({ data: { ...data, tenantId: ctx.tenantId, createdBy: ctx.userId } });
  await audit({ action: 'hr.leave.apply', entity: 'leave_application', entityId: l.id, after: { employeeId: data.employeeId, days: data.days } });
  return l;
}

export async function updateLeave(ctx: TenantCtx, id: string, b: z.infer<typeof LeaveInput>, version: number) {
  const l = await findLeave(ctx, id);
  if (l.status !== 'pending') throw new AppError('CONFLICT', 'Only leave waiting for approval can be changed.');
  if (l.version !== version) throw new AppError('CONFLICT', 'Someone else changed this. Reload and try again.');
  const data = await leaveData(ctx, { ...b, employeeId: l.employeeId }, id);
  return db().leaveApplication.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
}

async function findLeave(ctx: TenantCtx, id: string) {
  const l = await db().leaveApplication.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!l) throw notFound('Leave application');
  if (ctx.scope === 'own') {
    const me = await myEmployee(ctx);
    if (!me || me.id !== l.employeeId) throw notFound('Leave application');
  }
  return l;
}

export const DecideInput = z.object({ status: z.enum(['approved', 'rejected']), comment: z.string().trim().max(500).optional().nullable() });

/** Approve or reject; approved leave marks each working day as leave in attendance */
export async function decideLeave(ctx: TenantCtx, id: string, b: z.infer<typeof DecideInput>) {
  const l = await findLeave(ctx, id);
  if (l.status !== 'pending') throw new AppError('CONFLICT', `This leave is already ${l.status}.`);
  if (b.status === 'rejected' && !b.comment) throw new AppError('VALIDATION_FAILED', 'Say why it is rejected.', { fields: { comment: 'Needed to reject' } });
  if (b.status === 'approved') await fillLeave(ctx, l);
  await db().leaveApplication.update({ where: { id }, data: { status: b.status, comment: b.comment ?? null, decidedBy: ctx.userId, decidedAt: new Date(), version: { increment: 1 } } });
  await audit({ action: `hr.leave.${b.status}`, entity: 'leave_application', entityId: id, after: { comment: b.comment } });
  return db().leaveApplication.findUniqueOrThrow({ where: { id } });
}

async function fillLeave(ctx: TenantCtx, l: { id: string; employeeId: string; fromDate: Date; toDate: Date; halfDay: boolean; leaveTypeId: string }) {
  const [cfg, holidays, type] = await Promise.all([getConfig(ctx), holidaysBetween(ctx, iso(l.fromDate), iso(l.toDate)), db().leaveType.findUnique({ where: { id: l.leaveTypeId } })]);
  const { dates } = leaveDays(cfg, holidays, iso(l.fromDate), iso(l.toDate), l.halfDay);
  for (const d of dates) {
    const values = { status: l.halfDay ? 'half_day' : 'leave', clockIn: null, clockOut: null, workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, source: 'leave', notes: `${type?.name ?? 'Leave'}${type && !type.paid ? ' (unpaid)' : ''}` };
    await db().attendance.upsert({ where: { employeeId_date: { employeeId: l.employeeId, date: day(d) } }, create: { ...values, tenantId: ctx.tenantId, employeeId: l.employeeId, date: day(d), createdBy: ctx.userId }, update: values });
  }
}

/** Withdraw a request, or cancel approved leave (its attendance marks are removed) */
export async function cancelLeave(ctx: TenantCtx, id: string) {
  const l = await findLeave(ctx, id);
  if (!['pending', 'approved'].includes(l.status)) throw new AppError('CONFLICT', `This leave is already ${l.status}.`);
  if (l.status === 'approved') await db().attendance.deleteMany({ where: { tenantId: ctx.tenantId, employeeId: l.employeeId, source: 'leave', date: { gte: l.fromDate, lte: l.toDate } } });
  await db().leaveApplication.update({ where: { id }, data: { status: 'cancelled', version: { increment: 1 } } });
  await audit({ action: 'hr.leave.cancel', entity: 'leave_application', entityId: id });
}

export async function deleteLeave(ctx: TenantCtx, id: string) {
  const l = await findLeave(ctx, id);
  if (l.status === 'approved') throw new AppError('CONFLICT', 'Cancel approved leave first.');
  await db().leaveApplication.delete({ where: { id } });
}

export const LeaveList = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), employeeId: z.string().uuid().optional(), leaveTypeId: z.string().uuid().optional(), from: DateStr.optional(), to: DateStr.optional() });

export async function listLeaves(ctx: TenantCtx, q: z.infer<typeof LeaveList>) {
  const t = ctx.tenantId;
  const b = await bundle({
    ...nameParts(t),
    me: Prisma.sql`select id from employees where tenant_id = ${t}::uuid and member_id = ${ctx.memberId}::uuid and status <> 'exited' limit 1`,
    types: Prisma.sql`select id, name, code, color, paid from leave_types where tenant_id = ${t}::uuid`,
    rows: Prisma.sql`select * from leave_applications where tenant_id = ${t}::uuid
      ${q.employeeId ? Prisma.sql`and employee_id = ${q.employeeId}::uuid` : Prisma.empty}
      ${q.to ? Prisma.sql`and from_date <= ${q.to}::date` : Prisma.empty}
      ${q.from ? Prisma.sql`and to_date >= ${q.from}::date` : Prisma.empty}
      order by from_date desc, created_at desc limit 2000`,
  });
  const lookup = namesFrom(b);
  const mine = ctx.scope === 'own' ? (b.me[0]?.id as string | undefined) ?? null : undefined;
  if (mine === null) return { data: [], counts: { all: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 } };
  const base = b.rows.filter((l) => !mine || l.employeeId === mine);
  const c = (s: string) => base.filter((l) => l.status === s).length;
  return {
    data: base.filter((l) => (!q.status || l.status === q.status) && (!q.leaveTypeId || l.leaveTypeId === q.leaveTypeId)).map((l) => {
      const ty = b.types.find((x) => x.id === l.leaveTypeId);
      return { ...l, decidedByName: l.decidedBy ? lookup.user.get(l.decidedBy) ?? null : null, days: Number(l.days), employee: lookup.emp.get(l.employeeId) ?? '—', employeeCode: lookup.code.get(l.employeeId) ?? '', employeeSub: lookup.sub.get(l.employeeId) ?? null, leaveType: ty?.name ?? '—', leaveCode: ty?.code ?? '', color: ty?.color ?? 'slate', paid: ty?.paid ?? true };
    }),
    counts: { all: base.length, pending: c('pending'), approved: c('approved'), rejected: c('rejected'), cancelled: c('cancelled') },
  };
}

/** The team calendar over a week: every current employee and the leave (approved or waiting) on each day, with holidays */
export async function leaveWeek(ctx: TenantCtx, start: string) {
  const t = ctx.tenantId;
  const end = iso(new Date(day(start).getTime() + 6 * 86_400_000));
  const b = await bundle({
    ...nameParts(t),
    settings: Prisma.sql`select data from hr_settings where tenant_id = ${t}::uuid`,
    me: Prisma.sql`select id from employees where tenant_id = ${t}::uuid and member_id = ${ctx.memberId}::uuid and status <> 'exited' limit 1`,
    emps: Prisma.sql`select id, name, code, designation_id from employees where tenant_id = ${t}::uuid and status <> 'exited' order by name`,
    leaves: Prisma.sql`select id, employee_id, leave_type_id, from_date, to_date, status, half_day, days from leave_applications where tenant_id = ${t}::uuid and status in ('approved', 'pending') and from_date <= ${end}::date and to_date >= ${start}::date`,
    types: Prisma.sql`select id, name, code, color from leave_types where tenant_id = ${t}::uuid`,
    holidays: Prisma.sql`select name, from_date, to_date, optional from holidays where tenant_id = ${t}::uuid and from_date <= ${end}::date and to_date >= ${start}::date`,
  });
  const lookup = namesFrom(b);
  const cfg = HrConfigSchema.parse(b.settings[0]?.data ?? {});
  const mine = ctx.scope === 'own' ? (b.me[0]?.id as string | undefined) ?? '-' : null;
  const days = Array.from({ length: 7 }, (_, i) => iso(new Date(day(start).getTime() + i * 86_400_000)));
  const emps = b.emps.filter((e) => !mine || e.id === mine);
  const leaves = b.leaves.filter((l) => !mine || l.employeeId === mine);
  return {
    start, end, today: todayIST(),
    days: days.map((d) => ({ date: d, weekday: day(d).getUTCDay(), working: cfg.workingDays.includes(day(d).getUTCDay()), holiday: b.holidays.find((h) => iso(h.fromDate) <= d && iso(h.toDate) >= d)?.name ?? null })),
    employees: emps.map((e) => ({
      id: e.id, name: e.name, code: e.code, designation: e.designationId ? lookup.desig.get(e.designationId) ?? null : null,
      leaves: leaves.filter((l) => l.employeeId === e.id).map((l) => {
        const ty = b.types.find((x) => x.id === l.leaveTypeId);
        return { id: l.id, from: iso(l.fromDate), to: iso(l.toDate), status: l.status, halfDay: l.halfDay, days: Number(l.days), type: ty?.name ?? '—', code: ty?.code ?? '', color: ty?.color ?? 'slate' };
      }),
    })),
    onLeave: leaves.filter((l) => l.status === 'approved').length,
  };
}

/** Unpaid days in a month for payroll: absences, half days, and approved unpaid leave */
export async function lopDays(ctx: TenantCtx, employeeId: string, from: string, to: string) {
  const rows = await db().attendance.findMany({ where: { tenantId: ctx.tenantId, employeeId, date: { gte: day(from), lte: day(to) } } });
  let lop = 0;
  let present = 0;
  for (const r of rows) {
    if (r.status === 'absent') lop += 1;
    // A half day off is unpaid, unless it was half a day of paid leave
    else if (r.status === 'half_day') { if (r.source !== 'leave' || r.notes?.endsWith('(unpaid)')) lop += 0.5; present += 0.5; }
    else if (r.status === 'leave' && r.notes?.endsWith('(unpaid)')) lop += 1;
    else if (r.status === 'present') present += 1;
  }
  return { lop, present, marked: rows.length };
}
