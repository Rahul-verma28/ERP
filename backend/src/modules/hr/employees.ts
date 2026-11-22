import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { DateStr, Paise } from '../../kernel/query';
import { audit } from '../audit/service';
import { bundle, nameParts, namesFrom } from './bundle';
import { ensureHr, getConfig } from './setup';
import { zFileRef } from '../../kernel/zodRules';

// Employees: who they are, where they work, how they are paid, and the salary structure
// (allowances and deductions on top of basic). Self-service people see only themselves.

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'temporary'] as const;
const Phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number');
const Pan = z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN looks like ABCDE1234F');
const Ifsc = z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC looks like SBIN0001234');
const opt = <T extends z.ZodTypeAny>(t: T) => t.optional().nullable().or(z.literal('').transform(() => null));

export const EmployeeInput = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(120),
  email: opt(z.string().trim().email('Enter a valid email')),
  phone: opt(Phone),
  gender: opt(z.enum(['male', 'female', 'other'])),
  dob: opt(DateStr),
  photoUrl: opt(zFileRef),
  memberId: opt(z.string().uuid()),
  branchId: opt(z.string().uuid()),
  departmentId: opt(z.string().uuid()),
  designationId: opt(z.string().uuid()),
  managerId: opt(z.string().uuid()),
  shiftId: opt(z.string().uuid()),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('full_time'),
  joinedOn: DateStr,
  probationEndsOn: opt(DateStr),
  address: z.object({ line1: z.string().trim().max(200).optional().nullable(), line2: z.string().trim().max(200).optional().nullable(), country: z.string().trim().max(60).optional().nullable(), city: z.string().trim().max(80).optional().nullable(), state: z.string().trim().max(80).optional().nullable(), pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode has 6 digits').optional().nullable().or(z.literal('').transform(() => null)) }).optional().nullable(),
  emergency: z.object({ name: z.string().trim().max(120).optional().nullable(), relation: z.string().trim().max(40).optional().nullable(), phone: opt(Phone) }).optional().nullable(),
  bank: z.object({ holder: z.string().trim().max(120).optional().nullable(), bankName: z.string().trim().max(80).optional().nullable(), branch: z.string().trim().max(80).optional().nullable(), accountNo: z.string().trim().regex(/^\d{9,18}$/, 'Account number has 9 to 18 digits').optional().nullable().or(z.literal('').transform(() => null)), ifsc: opt(Ifsc) }).optional().nullable(),
  pan: opt(Pan),
  aadhaarLast4: opt(z.string().trim().regex(/^\d{4}$/, 'Last 4 digits only')),
  uan: opt(z.string().trim().regex(/^\d{12}$/, 'UAN has 12 digits')),
  esiNo: opt(z.string().trim().regex(/^\d{10,17}$/, 'ESI number has 10 to 17 digits')),
  payType: z.enum(['monthly', 'daily']).default('monthly'),
  basicPaise: Paise.default(0),
  pf: z.boolean().default(false),
  esi: z.boolean().default(false),
  pt: z.boolean().default(false),
  notes: opt(z.string().trim().max(1000)),
});
export type EmployeeInput = z.infer<typeof EmployeeInput>;

export const EmployeeList = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(['active', 'on_notice', 'exited', 'current']).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  departmentId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});

/**
 * The employees this person may see and act on, by the permission's scope: null = everyone;
 * branch = their branches' people; own = their own record; team = themselves and everyone who
 * reports to them, at any depth (from each employee's manager).
 */
export async function hrReach(ctx: TenantCtx): Promise<string[] | null> {
  const scope = ctx.scope ?? 'own';
  if (scope === 'all') return null;
  if (scope === 'branch') {
    if (!ctx.branchIds.length) return null;
    const rows = await db().employee.findMany({ where: { tenantId: ctx.tenantId, OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] }, select: { id: true } });
    return rows.map((r) => r.id);
  }
  if (scope === 'own') return (await db().employee.findMany({ where: { tenantId: ctx.tenantId, memberId: ctx.memberId }, select: { id: true } })).map((r) => r.id);
  const rows = await db().$queryRaw<{ id: string }[]>`
    with recursive team as (
      select id from employees where tenant_id = ${ctx.tenantId}::uuid and member_id = ${ctx.memberId}::uuid
      union
      select e.id from employees e join team t on e.manager_id = t.id where e.tenant_id = ${ctx.tenantId}::uuid
    ) select id from team`;
  return rows.map((r) => r.id);
}

/** Employees this person may see, as a filter (see hrReach) */
export async function employeeScope(ctx: TenantCtx): Promise<Prisma.EmployeeWhereInput> {
  const reach = await hrReach(ctx);
  return reach ? { tenantId: ctx.tenantId, id: { in: reach } } : { tenantId: ctx.tenantId };
}

/** Stops an action on someone outside this person's reach */
export async function assertReach(ctx: TenantCtx, employeeIds: string[]) {
  const reach = await hrReach(ctx);
  if (reach && employeeIds.some((id) => !reach.includes(id))) throw new AppError('PERMISSION_DENIED', 'This person is not in your team.');
}

/** The employee record of whoever is signed in, for self-service */
export async function myEmployee(ctx: TenantCtx) {
  return db().employee.findFirst({ where: { tenantId: ctx.tenantId, memberId: ctx.memberId, status: { not: 'exited' } } });
}

const dateOf = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : s === null ? null : undefined);

async function check(ctx: TenantCtx, b: EmployeeInput, exceptId?: string) {
  const fields: Record<string, string> = {};
  const [dept, desig, mgr, shift, member, branch] = await Promise.all([
    b.departmentId ? db().hrDepartment.findFirst({ where: { id: b.departmentId, tenantId: ctx.tenantId } }) : null,
    b.designationId ? db().hrDesignation.findFirst({ where: { id: b.designationId, tenantId: ctx.tenantId } }) : null,
    b.managerId ? db().employee.findFirst({ where: { id: b.managerId, tenantId: ctx.tenantId } }) : null,
    b.shiftId ? db().hrShift.findFirst({ where: { id: b.shiftId, tenantId: ctx.tenantId } }) : null,
    b.memberId ? db().tenantMember.findFirst({ where: { id: b.memberId, tenantId: ctx.tenantId } }) : null,
    b.branchId ? db().branch.findFirst({ where: { id: b.branchId, tenantId: ctx.tenantId } }) : null,
  ]);
  if (b.departmentId && !dept) fields.departmentId = 'Choose a department from the list';
  if (b.designationId && !desig) fields.designationId = 'Choose a designation from the list';
  if (b.managerId && (!mgr || mgr.id === exceptId)) fields.managerId = 'Choose another employee as manager';
  if (b.shiftId && !shift) fields.shiftId = 'Choose a shift from the list';
  if (b.memberId && !member) fields.memberId = 'Choose a user from the list';
  if (b.branchId && !branch) fields.branchId = 'Choose a branch from the list';
  if (b.memberId && (await db().employee.findFirst({ where: { tenantId: ctx.tenantId, memberId: b.memberId, id: exceptId ? { not: exceptId } : undefined } }))) fields.memberId = 'This login is already linked to another employee';
  if (b.dob && b.dob > b.joinedOn) fields.dob = 'Date of birth must be before joining';
  if (b.probationEndsOn && b.probationEndsOn < b.joinedOn) fields.probationEndsOn = 'Must be after the joining date';
  if (b.pf && !b.basicPaise) fields.basicPaise = 'Enter basic pay to deduct PF';
  if (b.phone && (await db().employee.findFirst({ where: { tenantId: ctx.tenantId, phone: b.phone, id: exceptId ? { not: exceptId } : undefined } }))) fields.phone = 'Another employee has this mobile number';
  if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', Object.values(fields)[0], { fields });
}

function data(b: EmployeeInput) {
  return {
    ...b,
    dob: dateOf(b.dob), joinedOn: dateOf(b.joinedOn)!, probationEndsOn: dateOf(b.probationEndsOn),
    address: b.address ?? undefined, emergency: b.emergency ?? undefined, bank: b.bank ?? undefined,
    basicPaise: BigInt(b.basicPaise),
  } as Prisma.EmployeeUncheckedCreateInput;
}

/** The next code: EMP-0001, EMP-0002 … after the highest one used */
async function nextCode(ctx: TenantCtx) {
  const cfg = await getConfig(ctx);
  const rows = await db().employee.findMany({ where: { tenantId: ctx.tenantId, code: { startsWith: cfg.employeePrefix } }, select: { code: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.code.slice(cfg.employeePrefix.length)) || 0), 0);
  return `${cfg.employeePrefix}${String(max + 1).padStart(4, '0')}`;
}

export async function createEmployee(ctx: TenantCtx, b: EmployeeInput) {
  await ensureHr(ctx);
  await check(ctx, b);
  const shiftId = b.shiftId ?? (await db().hrShift.findFirst({ where: { tenantId: ctx.tenantId, isDefault: true } }))?.id ?? null;
  const code = await nextCode(ctx);
  const e = await db().employee.create({ data: { ...data(b), shiftId, code, tenantId: ctx.tenantId, createdBy: ctx.userId } });
  await audit({ action: 'hr.employee.create', entity: 'employee', entityId: e.id, after: { code, name: e.name } });
  return getEmployee(ctx, e.id);
}

export async function updateEmployee(ctx: TenantCtx, id: string, b: EmployeeInput, version: number) {
  const e = await db().employee.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!e) throw notFound('Employee');
  if (e.version !== version) throw new AppError('CONFLICT', 'Someone else changed this employee. Reload and try again.');
  await check(ctx, b, id);
  await db().employee.update({ where: { id }, data: { ...data(b), version: { increment: 1 } } });
  await audit({ action: 'hr.employee.update', entity: 'employee', entityId: id, before: { basicPaise: e.basicPaise, departmentId: e.departmentId, designationId: e.designationId }, after: { basicPaise: b.basicPaise, departmentId: b.departmentId, designationId: b.designationId } });
  return getEmployee(ctx, id);
}

export const ExitInput = z.object({ exitOn: DateStr, exitReason: z.string().trim().min(3, 'Say why they are leaving').max(500) });
export async function exitEmployee(ctx: TenantCtx, id: string, b: z.infer<typeof ExitInput>) {
  const e = await db().employee.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!e) throw notFound('Employee');
  if (b.exitOn < e.joinedOn.toISOString().slice(0, 10)) throw new AppError('VALIDATION_FAILED', 'The last day cannot be before joining.', { fields: { exitOn: 'Before joining' } });
  const today = new Date().toISOString().slice(0, 10);
  await db().employee.update({ where: { id }, data: { exitOn: dateOf(b.exitOn)!, exitReason: b.exitReason, status: b.exitOn <= today ? 'exited' : 'on_notice', version: { increment: 1 } } });
  await audit({ action: 'hr.employee.exit', entity: 'employee', entityId: id, after: b });
  return getEmployee(ctx, id);
}

export async function rejoinEmployee(ctx: TenantCtx, id: string) {
  const e = await db().employee.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!e) throw notFound('Employee');
  await db().employee.update({ where: { id }, data: { exitOn: null, exitReason: null, status: 'active', version: { increment: 1 } } });
  return getEmployee(ctx, id);
}

export async function deleteEmployee(ctx: TenantCtx, id: string) {
  const e = await db().employee.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!e) throw notFound('Employee');
  const slips = await db().payslip.count({ where: { tenantId: ctx.tenantId, employeeId: id } });
  if (slips) throw new AppError('CONFLICT', 'This employee has payslips. Mark them as left instead of deleting.');
  await Promise.all([
    db().attendance.deleteMany({ where: { tenantId: ctx.tenantId, employeeId: id } }),
    db().leaveApplication.deleteMany({ where: { tenantId: ctx.tenantId, employeeId: id } }),
    db().hrSalaryItem.deleteMany({ where: { tenantId: ctx.tenantId, employeeId: id } }),
    db().hrOvertime.deleteMany({ where: { tenantId: ctx.tenantId, employeeId: id } }),
  ]);
  await db().employee.delete({ where: { id } });
  await audit({ action: 'hr.employee.delete', entity: 'employee', entityId: id, before: { code: e.code, name: e.name } });
}

/** Names of the people (logins) who made or approved something */
export async function userNames(ids: (string | null | undefined)[]) {
  const want = [...new Set(ids.filter(Boolean))] as string[];
  if (!want.length) return new Map<string, string>();
  const users = await db().user.findMany({ where: { id: { in: want } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Lookup names for ids, for lists and detail pages (one database round trip) */
export async function names(ctx: TenantCtx) {
  return namesFrom(await bundle(nameParts(ctx.tenantId)));
}

export async function listEmployees(ctx: TenantCtx, q: z.infer<typeof EmployeeList>) {
  // One round trip: every employee of the business plus the names, then filtered here
  const b = await bundle({ ...nameParts(ctx.tenantId), rows: Prisma.sql`select * from employees where tenant_id = ${ctx.tenantId}::uuid order by name` });
  const n = namesFrom(b);
  const reach = await hrReach(ctx);
  const all = b.rows.filter((e) => !reach || reach.includes(e.id as string));
  const text = q.q?.toLowerCase();
  const rows = all
    .filter((e) => (q.status === 'current' ? e.status !== 'exited' : !q.status || e.status === q.status))
    .filter((e) => !text || [e.name, e.code, e.phone, e.email].some((v) => typeof v === 'string' && v.toLowerCase().includes(text)))
    .filter((e) => (!q.employmentType || e.employmentType === q.employmentType) && (!q.departmentId || e.departmentId === q.departmentId) && (!q.designationId || e.designationId === q.designationId) && (!q.branchId || e.branchId === q.branchId))
    .sort((x, y) => (x.status === y.status ? 0 : x.status < y.status ? -1 : 1));
  const cur = all.filter((e) => e.status !== 'exited');
  const type = (t: string[]) => cur.filter((e) => t.includes(e.employmentType)).length;
  return {
    data: rows.map((e) => ({ ...e, department: e.departmentId ? n.dept.get(e.departmentId) ?? null : null, designation: e.designationId ? n.desig.get(e.designationId) ?? null : null, branch: e.branchId ? n.branch.get(e.branchId) ?? null : null, manager: e.managerId ? n.emp.get(e.managerId) ?? null : null, shift: e.shiftId ? n.shift.get(e.shiftId) ?? null : null })),
    counts: {
      current: cur.length, full_time: type(['full_time']), part_time: type(['part_time']), contract: type(['contract', 'temporary']), intern: type(['intern']),
      on_notice: all.filter((e) => e.status === 'on_notice').length, exited: all.filter((e) => e.status === 'exited').length,
    },
  };
}

export async function getEmployee(ctx: TenantCtx, id: string) {
  const e = await db().employee.findFirst({ where: { AND: [await employeeScope(ctx), { id }] } });
  if (!e) throw notFound('Employee');
  const [n, items, member] = await Promise.all([
    names(ctx),
    db().hrSalaryItem.findMany({ where: { tenantId: ctx.tenantId, employeeId: id }, orderBy: [{ kind: 'asc' }, { position: 'asc' }] }),
    e.memberId ? db().tenantMember.findFirst({ where: { id: e.memberId }, select: { id: true, user: { select: { name: true, email: true, mobile: true } } } }) : null,
  ]);
  return {
    ...e,
    department: e.departmentId ? n.dept.get(e.departmentId) ?? null : null,
    designation: e.designationId ? n.desig.get(e.designationId) ?? null : null,
    branch: e.branchId ? n.branch.get(e.branchId) ?? null : null,
    manager: e.managerId ? n.emp.get(e.managerId) ?? null : null,
    shift: e.shiftId ? n.shift.get(e.shiftId) ?? null : null,
    member: member ? { id: member.id, name: member.user.name, email: member.user.email, mobile: member.user.mobile } : null,
    salaryItems: items,
  };
}

// ── Salary structure: allowances and deductions on top of basic ──

export const SalaryInput = z.object({
  basicPaise: Paise,
  payType: z.enum(['monthly', 'daily']).default('monthly'),
  pf: z.boolean().default(false),
  esi: z.boolean().default(false),
  pt: z.boolean().default(false),
  items: z.array(z.object({
    kind: z.enum(['allowance', 'deduction']),
    name: z.string().trim().min(1, 'Name it').max(60),
    calc: z.enum(['fixed', 'percent']).default('fixed'),
    /** paise when fixed; basis points of basic when percent (1000 = 10%) */
    amount: z.number().int().min(0),
  })).max(30).default([]),
});

export async function setSalary(ctx: TenantCtx, id: string, b: z.infer<typeof SalaryInput>) {
  const e = await db().employee.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!e) throw notFound('Employee');
  const fields: Record<string, string> = {};
  if (b.pf && !b.basicPaise) fields.basicPaise = 'Enter basic pay to deduct PF';
  b.items.forEach((it, i) => {
    if (!it.amount) fields[`items.${i}.amount`] = 'Enter the amount';
    if (it.calc === 'percent' && it.amount > 10_000) fields[`items.${i}.amount`] = 'At most 100%';
  });
  if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', Object.values(fields)[0], { fields });
  await db().hrSalaryItem.deleteMany({ where: { tenantId: ctx.tenantId, employeeId: id } });
  if (b.items.length) await db().hrSalaryItem.createMany({ data: b.items.map((it, position) => ({ ...it, amount: BigInt(it.amount), position, tenantId: ctx.tenantId, employeeId: id })) });
  await db().employee.update({ where: { id }, data: { basicPaise: BigInt(b.basicPaise), payType: b.payType, pf: b.pf, esi: b.esi, pt: b.pt, version: { increment: 1 } } });
  await audit({ action: 'hr.salary.update', entity: 'employee', entityId: id, before: { basicPaise: e.basicPaise }, after: { basicPaise: b.basicPaise, items: b.items.length } });
  return getEmployee(ctx, id);
}

/** Every employee's monthly pay at a glance, for Payroll → Salary structure */
export async function salaryList(ctx: TenantCtx) {
  const t = ctx.tenantId;
  const b = await bundle({
    ...nameParts(t),
    rows: Prisma.sql`select id, code, name, email, phone, branch_id, department_id, designation_id, pay_type, basic_paise, pf, esi, pt from employees where tenant_id = ${t}::uuid and status <> 'exited' order by name`,
    items: Prisma.sql`select employee_id, kind, calc, amount from hr_salary_items where tenant_id = ${t}::uuid`,
  });
  const n = namesFrom(b);
  return {
    data: b.rows.map((e) => {
      const mine = b.items.filter((i) => i.employeeId === e.id);
      const basic = e.basicPaise as bigint;
      const value = (i: { calc: string; amount: bigint }) => (i.calc === 'percent' ? (basic * i.amount + 5000n) / 10_000n : i.amount);
      const allowances = mine.filter((i) => i.kind === 'allowance').reduce((s, i) => s + value(i as never), 0n);
      const deductions = mine.filter((i) => i.kind === 'deduction').reduce((s, i) => s + value(i as never), 0n);
      return { id: e.id, code: e.code, name: e.name, email: e.email, phone: e.phone, branch: e.branchId ? n.branch.get(e.branchId) ?? null : null, department: e.departmentId ? n.dept.get(e.departmentId) ?? null : null, designation: e.designationId ? n.desig.get(e.designationId) ?? null : null, payType: e.payType, basicPaise: basic, allowancesPaise: allowances, deductionsPaise: deductions, grossPaise: e.payType === 'daily' ? null : basic + allowances, pf: e.pf, esi: e.esi, pt: e.pt, items: mine.length };
    }),
  };
}
