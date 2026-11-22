import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { DateStr, Paise } from '../../kernel/query';
import { audit } from '../audit/service';

// HR setup: working days, payroll rules (PF, ESI, Professional Tax), departments, designations,
// shifts, leave types, holidays, and the short lists the HR forms pick from.

// ── Settings ──

const Slab = z.object({ abovePaise: Paise, amountPaise: Paise });
export const HrConfig = z.object({
  /** 0 = Sunday … 6 = Saturday */
  workingDays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one working day').default([1, 2, 3, 4, 5, 6]),
  employeePrefix: z.string().trim().min(1).max(8).default('EMP-'),
  /** Leave balances run from this month (1 = January) */
  leaveYearStart: z.number().int().min(1).max(12).default(1),
  /** EPF Act 1952: 12% of basic from the employee and 12% from the employer, on wages up to ₹15,000 when capped */
  pf: z.object({ enabled: z.boolean().default(true), employeeBp: z.number().int().min(0).max(2500).default(1200), employerBp: z.number().int().min(0).max(2500).default(1200), capped: z.boolean().default(true), wageCapPaise: Paise.default(1_500_000) }).default({}),
  /** ESI Act 1948: 0.75% employee + 3.25% employer, for gross wages up to ₹21,000 a month */
  esi: z.object({ enabled: z.boolean().default(true), employeeBp: z.number().int().min(0).max(1000).default(75), employerBp: z.number().int().min(0).max(1000).default(325), grossLimitPaise: Paise.default(2_100_000) }).default({}),
  /** Professional Tax: set by each state; a monthly amount above a gross salary */
  pt: z.object({ enabled: z.boolean().default(false), state: z.string().max(40).default(''), slabs: z.array(Slab).max(10).default([{ abovePaise: 1_000_000, amountPaise: 20_000 }]) }).default({}),
  lists: z.object({
    awardTypes: z.array(z.string().trim().min(1).max(60)).default(['Employee of the month', 'Best performer', 'Long service', 'Customer hero', 'Team player']),
    warningTypes: z.array(z.string().trim().min(1).max(60)).default(['Late coming', 'Absent without notice', 'Misconduct', 'Poor performance', 'Policy breach']),
    complaintTypes: z.array(z.string().trim().min(1).max(60)).default(['Harassment', 'Workplace conduct', 'Pay or benefits', 'Safety', 'Other']),
    terminationTypes: z.array(z.string().trim().min(1).max(60)).default(['Misconduct', 'Poor performance', 'Redundancy', 'End of contract', 'Absconding']),
    documentCategories: z.array(z.string().trim().min(1).max(60)).default(['Policy', 'Handbook', 'Form', 'Notice', 'Agreement']),
    announcementCategories: z.array(z.string().trim().min(1).max(60)).default(['General', 'Policy', 'Celebration', 'Holiday', 'Urgent']),
    eventTypes: z.array(z.string().trim().min(1).max(60)).default(['Meeting', 'Celebration', 'Training', 'Outing', 'Other']),
    goalTypes: z.array(z.string().trim().min(1).max(60)).default(['Sales target', 'Quality', 'Learning', 'Customer', 'Other']),
    trainingTypes: z.array(z.string().trim().min(1).max(60)).default(['Product', 'Sales', 'Safety', 'Soft skills', 'Software']),
    reviewCycles: z.array(z.string().trim().min(1).max(60)).default(['Quarterly', 'Half-yearly', 'Yearly', 'Probation']),
    reviewIndicators: z.array(z.string().trim().min(1).max(60)).default(['Quality of work', 'Productivity', 'Punctuality', 'Teamwork', 'Customer handling']),
    allowanceTypes: z.array(z.string().trim().min(1).max(60)).default(['HRA', 'Conveyance', 'Special allowance', 'Medical', 'Incentive']),
    deductionTypes: z.array(z.string().trim().min(1).max(60)).default(['TDS', 'Canteen', 'Uniform', 'Other']),
    candidateSources: z.array(z.string().trim().min(1).max(60)).default(['Walk-in', 'Referral', 'Job portal', 'Social media', 'Consultant']),
    indicatorCategories: z.array(z.string().trim().min(1).max(60)).default(['Work quality', 'Productivity', 'Behaviour', 'Customer', 'Learning']),
    jobLocations: z.array(z.string().trim().min(1).max(60)).default(['Main shop', 'Warehouse', 'Head office', 'Field', 'Remote']),
    jobCategories: z.array(z.string().trim().min(1).max(60)).default(['Sales', 'Accounts', 'Operations', 'Delivery', 'Support']),
    assessmentTypes: z.array(z.string().trim().min(1).max(60)).default(['Technical test', 'Aptitude test', 'Practical task', 'HR discussion', 'Typing test']),
    onboardingCategories: z.array(z.string().trim().min(1).max(60)).default(['Documents', 'IT setup', 'Training', 'HR', 'Workplace']),
    holidayTypes: z.array(z.string().trim().min(1).max(60)).default(['National', 'Festival', 'Regional', 'Company', 'Optional']),
    loanTypes: z.array(z.string().trim().min(1).max(60)).default(['Salary advance', 'Personal loan', 'Medical loan', 'Festival advance', 'Vehicle loan']),
  }).default({}),
  /** A line about each list item, keyed "list::name" (e.g. "awardTypes::Long service") */
  listNotes: z.record(z.string().max(300)).default({}),
  /** Papers each employee should hand in; required ones show as missing on their profile */
  documentTypes: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(2).max(60), description: z.string().trim().max(300).nullable().optional(), required: z.boolean().default(false) })).max(40).default([
    { id: 'pan', name: 'PAN card', description: 'For TDS and Form 16', required: true },
    { id: 'aadhaar', name: 'Aadhaar card', description: 'Identity and address proof', required: true },
    { id: 'bank', name: 'Cancelled cheque or passbook', description: 'To pay salary into the right account', required: true },
    { id: 'photo', name: 'Passport photo', description: 'For the ID card', required: false },
    { id: 'education', name: 'Education certificate', description: 'Highest qualification', required: false },
    { id: 'experience', name: 'Experience or relieving letter', description: 'From the last job', required: false },
  ]),
  /** Review cycles: how often people are reviewed */
  cycles: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(2).max(60), frequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'yearly', 'one_time']), description: z.string().trim().max(300).nullable().optional(), active: z.boolean().default(true) })).max(30).default([
    { id: 'quarterly', name: 'Quarterly', frequency: 'quarterly', active: true },
    { id: 'half-yearly', name: 'Half-yearly', frequency: 'half_yearly', active: true },
    { id: 'yearly', name: 'Yearly', frequency: 'yearly', active: true },
    { id: 'probation', name: 'Probation', frequency: 'one_time', active: true },
  ]),
  /** What a review rates, each out of 5 */
  indicators: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(2).max(60), category: z.string().trim().max(60).nullable().optional(), unit: z.enum(['rating', 'percent', 'number', 'amount']).default('rating'), target: z.string().trim().max(40).nullable().optional(), description: z.string().trim().max(300).nullable().optional(), active: z.boolean().default(true) })).max(50).default([
    { id: 'quality', name: 'Quality of work', category: 'Work quality', unit: 'rating', active: true },
    { id: 'productivity', name: 'Productivity', category: 'Productivity', unit: 'rating', active: true },
    { id: 'punctuality', name: 'Punctuality', category: 'Behaviour', unit: 'rating', active: true },
    { id: 'teamwork', name: 'Teamwork', category: 'Behaviour', unit: 'rating', active: true },
    { id: 'customer', name: 'Customer handling', category: 'Customer', unit: 'rating', active: true },
  ]),
  /** Offer letter, with {{name}}, {{position}}, {{department}}, {{salary}}, {{joining}}, {{company}}, {{expires}} */
  offerTemplate: z.string().max(6000).default(
    'Dear {{name}},\n\nWe are happy to offer you the position of {{position}} in our {{department}} team at {{company}}.\n\nYour monthly salary will be {{salary}}, and your joining date is {{joining}}.\n\nPlease confirm your acceptance by {{expires}}.\n\nWe look forward to working with you.\n\nFor {{company}}',
  ),
});
export type HrConfig = z.infer<typeof HrConfig>;

export async function getConfig(ctx: Pick<TenantCtx, 'tenantId'>): Promise<HrConfig> {
  const row = await db().hrSettings.findUnique({ where: { tenantId: ctx.tenantId } });
  return HrConfig.parse(row?.data ?? {});
}

export const ConfigPatch = HrConfig.partial();
export async function updateConfig(ctx: TenantCtx, patch: z.infer<typeof ConfigPatch>) {
  const current = await getConfig(ctx);
  const next = HrConfig.parse({ ...current, ...patch, lists: { ...current.lists, ...(patch.lists ?? {}) }, listNotes: { ...current.listNotes, ...(patch.listNotes ?? {}) } });
  const dupName = (rows: { name: string }[]) => rows.find((r, i) => rows.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase()) !== i);
  if (patch.cycles && dupName(next.cycles)) throw new AppError('VALIDATION_FAILED', `There are two review cycles called "${dupName(next.cycles)!.name}".`);
  if (patch.documentTypes && dupName(next.documentTypes)) throw new AppError('VALIDATION_FAILED', `There are two document types called "${dupName(next.documentTypes)!.name}".`);
  if (patch.indicators && dupName(next.indicators)) throw new AppError('VALIDATION_FAILED', `There are two indicators called "${dupName(next.indicators)!.name}".`);
  await db().hrSettings.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, data: next }, update: { data: next, updatedAt: new Date() } });
  await audit({ action: 'hr.settings.update', entity: 'hr_settings', entityId: ctx.tenantId, after: Object.keys(patch) });
  return next;
}

/** The first time HR is used: a general shift and the usual leave types */
export async function ensureHr(ctx: Pick<TenantCtx, 'tenantId'>) {
  const [shifts, types] = await Promise.all([db().hrShift.count({ where: { tenantId: ctx.tenantId } }), db().leaveType.count({ where: { tenantId: ctx.tenantId } })]);
  if (!shifts) await db().hrShift.create({ data: { tenantId: ctx.tenantId, name: 'General', startsAt: '09:30', endsAt: '18:30', breakMinutes: 60, graceMinutes: 15, isDefault: true } });
  if (!types) {
    await db().leaveType.createMany({
      data: [
        { tenantId: ctx.tenantId, name: 'Casual leave', code: 'CL', daysPerYear: 12, paid: true, color: 'blue', position: 0 },
        { tenantId: ctx.tenantId, name: 'Sick leave', code: 'SL', daysPerYear: 7, paid: true, color: 'rose', position: 1 },
        { tenantId: ctx.tenantId, name: 'Earned leave', code: 'EL', daysPerYear: 15, paid: true, carryForward: true, color: 'emerald', position: 2 },
        { tenantId: ctx.tenantId, name: 'Loss of pay', code: 'LOP', daysPerYear: 0, paid: false, color: 'slate', position: 3 },
      ],
      skipDuplicates: true,
    });
  }
}

// ── Departments and designations ──

export const DepartmentInput = z.object({ name: z.string().trim().min(2, 'Enter the department name').max(80), branchId: z.string().uuid().nullable().optional(), headId: z.string().uuid().nullable().optional(), isActive: z.boolean().optional() });
export const DesignationInput = z.object({ name: z.string().trim().min(2, 'Enter the designation').max(80), departmentId: z.string().uuid().nullable().optional(), isActive: z.boolean().optional() });

export async function listDepartments(ctx: TenantCtx) {
  const [rows, counts] = await Promise.all([
    db().hrDepartment.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } }),
    db().employee.groupBy({ by: ['departmentId'], where: { tenantId: ctx.tenantId, status: { not: 'exited' } }, _count: true }),
  ]);
  return rows.map((d) => ({ ...d, employees: counts.find((c) => c.departmentId === d.id)?._count ?? 0 }));
}

const dup = (what: string) => new AppError('VALIDATION_FAILED', `This ${what} already exists.`, { fields: { name: 'Already used' } });

export async function saveDepartment(ctx: TenantCtx, input: z.infer<typeof DepartmentInput>, id?: string) {
  const same = await db().hrDepartment.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: input.name, mode: 'insensitive' }, id: id ? { not: id } : undefined } });
  if (same) throw dup('department');
  if (id) {
    if (!(await db().hrDepartment.findFirst({ where: { id, tenantId: ctx.tenantId } }))) throw notFound('Department');
    return db().hrDepartment.update({ where: { id }, data: input });
  }
  return db().hrDepartment.create({ data: { ...input, tenantId: ctx.tenantId } });
}

export async function deleteDepartment(ctx: TenantCtx, id: string) {
  const used = await db().employee.count({ where: { tenantId: ctx.tenantId, departmentId: id } });
  if (used) throw new AppError('CONFLICT', `${used} employee${used === 1 ? ' is' : 's are'} in this department. Move them first, or mark it inactive.`);
  await db().hrDesignation.updateMany({ where: { tenantId: ctx.tenantId, departmentId: id }, data: { departmentId: null } });
  await db().hrDepartment.deleteMany({ where: { id, tenantId: ctx.tenantId } });
}

export async function listDesignations(ctx: TenantCtx) {
  const [rows, counts] = await Promise.all([
    db().hrDesignation.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } }),
    db().employee.groupBy({ by: ['designationId'], where: { tenantId: ctx.tenantId, status: { not: 'exited' } }, _count: true }),
  ]);
  return rows.map((d) => ({ ...d, employees: counts.find((c) => c.designationId === d.id)?._count ?? 0 }));
}

export async function saveDesignation(ctx: TenantCtx, input: z.infer<typeof DesignationInput>, id?: string) {
  const same = await db().hrDesignation.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: input.name, mode: 'insensitive' }, id: id ? { not: id } : undefined } });
  if (same) throw dup('designation');
  if (id) {
    if (!(await db().hrDesignation.findFirst({ where: { id, tenantId: ctx.tenantId } }))) throw notFound('Designation');
    return db().hrDesignation.update({ where: { id }, data: input });
  }
  return db().hrDesignation.create({ data: { ...input, tenantId: ctx.tenantId } });
}

export async function deleteDesignation(ctx: TenantCtx, id: string) {
  const used = await db().employee.count({ where: { tenantId: ctx.tenantId, designationId: id } });
  if (used) throw new AppError('CONFLICT', `${used} employee${used === 1 ? ' has' : 's have'} this designation. Change them first, or mark it inactive.`);
  await db().hrDesignation.deleteMany({ where: { id, tenantId: ctx.tenantId } });
}

// ── Shifts ──

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 09:30');
export const ShiftInput = z.object({
  name: z.string().trim().min(2, 'Enter the shift name').max(60),
  startsAt: Time, endsAt: Time,
  breakMinutes: z.number().int().min(0).max(240).default(0),
  graceMinutes: z.number().int().min(0).max(120).default(0),
  isNight: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Working minutes in a shift, after the break; a night shift runs past midnight */
export function shiftMinutes(s: { startsAt: string; endsAt: string; breakMinutes: number }) {
  let span = toMinutes(s.endsAt) - toMinutes(s.startsAt);
  if (span <= 0) span += 24 * 60;
  return Math.max(0, span - s.breakMinutes);
}

export async function listShifts(ctx: TenantCtx) {
  await ensureHr(ctx);
  const [rows, counts] = await Promise.all([
    db().hrShift.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
    db().employee.groupBy({ by: ['shiftId'], where: { tenantId: ctx.tenantId, status: { not: 'exited' } }, _count: true }),
  ]);
  return rows.map((s) => ({ ...s, workingMinutes: shiftMinutes(s), employees: counts.find((c) => c.shiftId === s.id)?._count ?? 0 }));
}

export async function saveShift(ctx: TenantCtx, input: z.infer<typeof ShiftInput>, id?: string) {
  const night = toMinutes(input.endsAt) <= toMinutes(input.startsAt);
  if (night && !input.isNight) throw new AppError('VALIDATION_FAILED', 'The shift ends before it starts. Turn on "Night shift" if it runs past midnight.', { fields: { endsAt: 'Before the start' } });
  if (shiftMinutes(input) < 60) throw new AppError('VALIDATION_FAILED', 'A shift needs at least one working hour after the break.', { fields: { breakMinutes: 'Too long' } });
  if (input.isDefault) await db().hrShift.updateMany({ where: { tenantId: ctx.tenantId }, data: { isDefault: false } });
  if (id) {
    const s = await db().hrShift.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!s) throw notFound('Shift');
    if (s.isDefault && !input.isDefault) throw new AppError('VALIDATION_FAILED', 'Make another shift the default first.', { fields: { isDefault: 'Needed' } });
    return db().hrShift.update({ where: { id }, data: { ...input, version: { increment: 1 } } });
  }
  return db().hrShift.create({ data: { ...input, tenantId: ctx.tenantId } });
}

export async function deleteShift(ctx: TenantCtx, id: string) {
  const s = await db().hrShift.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!s) throw notFound('Shift');
  if (s.isDefault) throw new AppError('CONFLICT', 'The default shift cannot be deleted.');
  const used = await db().employee.count({ where: { tenantId: ctx.tenantId, shiftId: id } });
  if (used) throw new AppError('CONFLICT', `${used} employee${used === 1 ? ' works' : 's work'} this shift. Move them first.`);
  await db().hrShift.delete({ where: { id } });
}

// ── Leave types ──

export const LeaveTypeInput = z.object({
  name: z.string().trim().min(2, 'Enter the leave name').max(60),
  code: z.string().trim().min(1, 'Enter a short code').max(6).transform((s) => s.toUpperCase()),
  daysPerYear: z.number().min(0).max(366),
  paid: z.boolean().default(true),
  carryForward: z.boolean().default(false),
  color: z.string().max(12).default('blue'),
  isActive: z.boolean().default(true),
  description: z.string().trim().max(300).optional().nullable().or(z.literal('').transform(() => null)),
  /** Ask for proof (e.g. a medical certificate) when the leave is longer than this many days */
  proofAfterDays: z.number().min(0).max(366).optional().nullable(),
});

export async function listLeaveTypes(ctx: TenantCtx) {
  await ensureHr(ctx);
  return (await db().leaveType.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] })).map((t) => ({ ...t, daysPerYear: Number(t.daysPerYear), proofAfterDays: t.proofAfterDays == null ? null : Number(t.proofAfterDays) }));
}

export async function saveLeaveType(ctx: TenantCtx, input: z.infer<typeof LeaveTypeInput>, id?: string) {
  const same = await db().leaveType.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: input.name, mode: 'insensitive' }, id: id ? { not: id } : undefined } });
  if (same) throw dup('leave type');
  if (id) {
    if (!(await db().leaveType.findFirst({ where: { id, tenantId: ctx.tenantId } }))) throw notFound('Leave type');
    return db().leaveType.update({ where: { id }, data: input });
  }
  const position = await db().leaveType.count({ where: { tenantId: ctx.tenantId } });
  return db().leaveType.create({ data: { ...input, tenantId: ctx.tenantId, position } });
}

export async function deleteLeaveType(ctx: TenantCtx, id: string) {
  const used = await db().leaveApplication.count({ where: { tenantId: ctx.tenantId, leaveTypeId: id } });
  if (used) throw new AppError('CONFLICT', `${used} leave application${used === 1 ? ' uses' : 's use'} this type. Mark it inactive instead.`);
  await db().leaveType.deleteMany({ where: { id, tenantId: ctx.tenantId } });
}

// ── Holidays ──

export const HolidayInput = z.object({
  name: z.string().trim().min(2, 'Enter the holiday name').max(80),
  fromDate: DateStr,
  toDate: DateStr.optional().nullable(),
  kind: z.string().trim().min(1, 'Choose the holiday type').max(60).default('Festival'),
  paid: z.boolean().default(true),
  optional: z.boolean().default(false),
  notes: z.string().trim().max(300).optional().nullable(),
}).refine((h) => !h.toDate || h.toDate >= h.fromDate, { message: 'The end date must be on or after the start', path: ['toDate'] });

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

export async function listHolidays(ctx: TenantCtx, year?: number) {
  const where = year ? { fromDate: { gte: day(`${year}-01-01`), lte: day(`${year}-12-31`) } } : {};
  return db().holiday.findMany({ where: { tenantId: ctx.tenantId, ...where }, orderBy: { fromDate: 'asc' } });
}

export async function saveHoliday(ctx: TenantCtx, input: z.infer<typeof HolidayInput>, id?: string) {
  const data = { ...input, fromDate: day(input.fromDate), toDate: day(input.toDate || input.fromDate) };
  if (id) {
    if (!(await db().holiday.findFirst({ where: { id, tenantId: ctx.tenantId } }))) throw notFound('Holiday');
    return db().holiday.update({ where: { id }, data });
  }
  return db().holiday.create({ data: { ...data, tenantId: ctx.tenantId } });
}

export async function deleteHoliday(ctx: TenantCtx, id: string) {
  await db().holiday.deleteMany({ where: { id, tenantId: ctx.tenantId } });
}
