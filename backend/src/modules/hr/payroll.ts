import { z } from 'zod';
import type { Employee, HrSalaryItem } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { todayIST } from '../../kernel/gst';
import { DateStr, Paise } from '../../kernel/query';
import { audit } from '../audit/service';
import { ensureFinance, resolveAccount } from '../finance/service';
import { JournalInput, createJournal, deleteJournal } from '../finance/books';
import { myEmployee, names } from './employees';
import { getConfig, type HrConfig } from './setup';
import { isWorkingDay, lopDays } from './time';

// Payroll, month by month. A run makes one payslip per employee: basic and allowances for the days
// paid (loss-of-pay days off), overtime, then PF, ESI, Professional Tax, loan instalments and other
// deductions. Paying salaries posts one balanced journal entry to the books:
//   Dr Salaries & wages (gross)        Dr Employer PF & ESI (employer share)
//   Cr cash/bank (net paid)  Cr PF payable  Cr ESI payable  Cr PT payable  Cr Salary advances  Cr Other salary deductions

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pct = (base: bigint, bp: number) => (base * BigInt(bp) + 5_000n) / 10_000n;
const upToRupee = (p: bigint) => ((p + 99n) / 100n) * 100n;
const n = (b: bigint) => Number(b);

export interface Line { name: string; amountPaise: number; code?: string; loanId?: string; manual?: boolean }

function monthRange(month: string) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}`, days: last };
}

// ── Ledgers the payroll posts to (made once, if missing) ──

const LEDGERS = { pf: ['PF payable', 'liability'], esi: ['ESI payable', 'liability'], pt: ['Professional tax payable', 'liability'], advances: ['Salary advances', 'asset'], other: ['Other salary deductions', 'liability'] } as const;
const SALARY = 'Salaries & wages';
const EMPLOYER = 'Employer PF & ESI';

async function payrollLedgers(ctx: TenantCtx) {
  await ensureFinance(ctx);
  for (const name of [SALARY, EMPLOYER]) {
    if (!(await db().finCategory.findFirst({ where: { tenantId: ctx.tenantId, kind: 'expense', name } }))) {
      await db().finCategory.create({ data: { tenantId: ctx.tenantId, kind: 'expense', name, position: await db().finCategory.count({ where: { tenantId: ctx.tenantId, kind: 'expense' } }) } });
    }
  }
  const out = {} as Record<keyof typeof LEDGERS, string>;
  for (const [k, [name, group]] of Object.entries(LEDGERS) as [keyof typeof LEDGERS, readonly [string, string]][]) {
    const l = (await db().finLedger.findFirst({ where: { tenantId: ctx.tenantId, name } })) ?? (await db().finLedger.create({ data: { tenantId: ctx.tenantId, name, group, description: 'Made by payroll' } }));
    if (!l.isActive) await db().finLedger.update({ where: { id: l.id }, data: { isActive: true } });
    out[k] = `led:${l.id}`;
  }
  return out;
}

// ── One payslip ──

interface SlipCalc {
  employeeId: string; daysInMonth: number; payableDays: number; lopDays: number; basicPaise: bigint
  earnings: Line[]; deductions: Line[]; employer: Line[]; grossPaise: bigint; deductionsPaise: bigint; netPaise: bigint; employerPaise: bigint
  snapshot: Record<string, unknown>; overtimeIds: string[]
}

async function computeSlip(ctx: TenantCtx, cfg: HrConfig, month: string, e: Employee, items: HrSalaryItem[], holidays: { fromDate: Date; toDate: Date; name: string; paid: boolean; optional: boolean }[], lookup: Awaited<ReturnType<typeof names>>): Promise<SlipCalc> {
  const r = monthRange(month);
  const from = iso(e.joinedOn) > r.from ? iso(e.joinedOn) : r.from;
  const to = e.exitOn && iso(e.exitOn) < r.to ? iso(e.exitOn) : r.to;
  const employedDays = Math.max(0, Math.round((day(to).getTime() - day(from).getTime()) / 86_400_000) + 1);
  const att = await lopDays(ctx, e.id, from, to);

  let payable: number;
  let basic: bigint;
  if (e.payType === 'daily') {
    // Daily wages: days worked, paid leave and paid holidays on working days
    const rows = await db().attendance.findMany({ where: { tenantId: ctx.tenantId, employeeId: e.id, date: { gte: day(from), lte: day(to) }, status: 'leave' } });
    const paidLeave = rows.filter((x) => !x.notes?.endsWith('(unpaid)')).length;
    let paidHolidays = 0;
    for (let d = from; d <= to; d = iso(new Date(day(d).getTime() + 86_400_000))) {
      if (cfg.workingDays.includes(day(d).getUTCDay()) && !isWorkingDay(cfg, holidays, d) && holidays.some((h) => h.paid && h.fromDate <= day(d) && h.toDate >= day(d))) paidHolidays += 1;
    }
    payable = att.present + paidLeave + paidHolidays;
    basic = (e.basicPaise * BigInt(Math.round(payable * 10))) / 10n;
  } else {
    payable = Math.max(0, employedDays - att.lop);
    basic = (e.basicPaise * BigInt(Math.round(payable * 10)) + BigInt(r.days * 5)) / BigInt(r.days * 10);
  }
  const factor = (full: bigint) => (e.payType === 'daily' ? (full * BigInt(Math.round(payable * 10)) + BigInt(r.days * 5)) / BigInt(r.days * 10) : (full * BigInt(Math.round(payable * 10)) + BigInt(r.days * 5)) / BigInt(r.days * 10));
  const fullBasic = e.payType === 'daily' ? e.basicPaise * 26n : e.basicPaise;
  const value = (it: HrSalaryItem, base: bigint) => (it.calc === 'percent' ? pct(base, Number(it.amount)) : it.amount);

  const earnings: Line[] = [{ name: 'Basic', code: 'basic', amountPaise: n(basic) }];
  let fullGross = fullBasic;
  for (const it of items.filter((x) => x.kind === 'allowance')) {
    const full = value(it, fullBasic);
    fullGross += full;
    const amt = it.calc === 'percent' ? pct(basic, Number(it.amount)) : factor(full);
    if (amt > 0n) earnings.push({ name: it.name, amountPaise: n(amt) });
  }
  const ot = await db().hrOvertime.findMany({ where: { tenantId: ctx.tenantId, employeeId: e.id, status: 'approved', payslipId: null, workOn: { gte: day(r.from), lte: day(r.to) } } });
  const otPaise = ot.reduce((s, o) => s + (BigInt(Math.round(Number(o.hours) * 100)) * o.ratePaise + 50n) / 100n, 0n);
  if (otPaise > 0n) earnings.push({ name: `Overtime (${ot.reduce((s, o) => s + Number(o.hours), 0)} h)`, code: 'overtime', amountPaise: n(otPaise) });
  const gross = earnings.reduce((s, x) => s + BigInt(x.amountPaise), 0n);

  const deductions: Line[] = [];
  const employer: Line[] = [];
  if (e.pf && cfg.pf.enabled && basic > 0n) {
    const wage = cfg.pf.capped && basic > BigInt(cfg.pf.wageCapPaise) ? BigInt(cfg.pf.wageCapPaise) : basic;
    deductions.push({ name: `PF (${cfg.pf.employeeBp / 100}%)`, code: 'pf', amountPaise: n(pct(wage, cfg.pf.employeeBp)) });
    employer.push({ name: `Employer PF (${cfg.pf.employerBp / 100}%)`, code: 'pf', amountPaise: n(pct(wage, cfg.pf.employerBp)) });
  }
  // ESI covers employees whose monthly wages are within the limit; contributions round up to the rupee
  if (e.esi && cfg.esi.enabled && fullGross <= BigInt(cfg.esi.grossLimitPaise) && gross > 0n) {
    deductions.push({ name: `ESI (${cfg.esi.employeeBp / 100}%)`, code: 'esi', amountPaise: n(upToRupee((gross * BigInt(cfg.esi.employeeBp)) / 10_000n)) });
    employer.push({ name: `Employer ESI (${cfg.esi.employerBp / 100}%)`, code: 'esi', amountPaise: n(upToRupee((gross * BigInt(cfg.esi.employerBp)) / 10_000n)) });
  }
  if (e.pt && cfg.pt.enabled && gross > 0n) {
    const slab = [...cfg.pt.slabs].sort((a, b) => b.abovePaise - a.abovePaise).find((s) => gross > BigInt(s.abovePaise));
    if (slab && slab.amountPaise > 0) deductions.push({ name: 'Professional tax', code: 'pt', amountPaise: slab.amountPaise });
  }
  for (const it of items.filter((x) => x.kind === 'deduction')) {
    const amt = it.calc === 'percent' ? pct(basic, Number(it.amount)) : it.amount;
    if (amt > 0n) deductions.push({ name: it.name, code: 'other', amountPaise: n(amt) });
  }
  // Loan and advance instalments, never more than what is still owed
  const loans = await db().hrLoan.findMany({ where: { tenantId: ctx.tenantId, employeeId: e.id, status: 'active', startsMonth: { lte: month } } });
  for (const l of loans) {
    const left = l.amountPaise - (await recovered(ctx, l.id));
    const emi = left < l.emiPaise ? left : l.emiPaise;
    if (emi > 0n) deductions.push({ name: `${l.title} instalment`, code: 'loan', loanId: l.id, amountPaise: n(emi) });
  }
  const totalDed = deductions.reduce((s, x) => s + BigInt(x.amountPaise), 0n);
  return {
    employeeId: e.id, daysInMonth: r.days, payableDays: payable, lopDays: att.lop, basicPaise: basic,
    earnings, deductions, employer, grossPaise: gross, deductionsPaise: totalDed, netPaise: gross - totalDed, employerPaise: employer.reduce((s, x) => s + BigInt(x.amountPaise), 0n),
    overtimeIds: ot.map((o) => o.id),
    snapshot: {
      name: e.name, code: e.code, designation: e.designationId ? lookup.desig.get(e.designationId) ?? null : null, department: e.departmentId ? lookup.dept.get(e.departmentId) ?? null : null,
      joinedOn: iso(e.joinedOn), pan: e.pan, uan: e.uan, esiNo: e.esiNo, bank: e.bank, payType: e.payType,
    },
  };
}

/** What has been taken back of a loan through payslips (in any run not cancelled) */
async function recovered(ctx: TenantCtx, loanId: string) {
  const slips = await db().payslip.findMany({ where: { tenantId: ctx.tenantId, deductions: { array_contains: [{ loanId }] } }, select: { deductions: true } });
  return slips.reduce((s, p) => s + (p.deductions as unknown as Line[]).filter((d) => d.loanId === loanId).reduce((a, d) => a + BigInt(d.amountPaise), 0n), 0n);
}

async function buildSlips(ctx: TenantCtx, runId: string, month: string, number: (code: string) => string) {
  const r = monthRange(month);
  const [cfg, emps, items, holidays, lookup, existing] = await Promise.all([
    getConfig(ctx),
    db().employee.findMany({ where: { tenantId: ctx.tenantId, joinedOn: { lte: day(r.to) }, OR: [{ exitOn: null }, { exitOn: { gte: day(r.from) } }] }, orderBy: { name: 'asc' } }),
    db().hrSalaryItem.findMany({ where: { tenantId: ctx.tenantId } }),
    db().holiday.findMany({ where: { tenantId: ctx.tenantId, fromDate: { lte: day(r.to) }, toDate: { gte: day(r.from) } } }),
    names(ctx),
    db().payslip.findMany({ where: { runId }, select: { employeeId: true } }),
  ]);
  const have = new Set(existing.map((x) => x.employeeId));
  let made = 0;
  for (const e of emps) {
    if (have.has(e.id) || e.basicPaise <= 0n) continue;
    const s = await computeSlip(ctx, cfg, month, e, items.filter((i) => i.employeeId === e.id), holidays, lookup);
    const { overtimeIds, ...slip } = s;
    const p = await db().payslip.create({
      data: {
        ...slip, tenantId: ctx.tenantId, runId, number: number(e.code), payableDays: slip.payableDays, lopDays: slip.lopDays,
        earnings: slip.earnings as unknown as object, deductions: slip.deductions as unknown as object, employer: slip.employer as unknown as object, snapshot: slip.snapshot as object,
      },
    });
    if (overtimeIds.length) await db().hrOvertime.updateMany({ where: { id: { in: overtimeIds } }, data: { payslipId: p.id } });
    made++;
  }
  return made;
}

async function totals(runId: string) {
  const slips = await db().payslip.findMany({ where: { runId } });
  const sum = (f: (p: (typeof slips)[number]) => bigint) => slips.reduce((s, p) => s + f(p), 0n);
  const paid = slips.filter((p) => p.status === 'paid');
  await db().payrollRun.update({
    where: { id: runId },
    data: { employees: slips.length, grossPaise: sum((p) => p.grossPaise), deductionsPaise: sum((p) => p.deductionsPaise), netPaise: sum((p) => p.netPaise), employerPaise: sum((p) => p.employerPaise), paidPaise: paid.reduce((s, p) => s + p.netPaise, 0n) },
  });
}

// ── Runs ──

export const RunInput = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose the month'),
  payDate: DateStr,
  accountId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function createRun(ctx: TenantCtx, b: z.infer<typeof RunInput>) {
  if (b.month > todayIST().slice(0, 7)) throw new AppError('VALIDATION_FAILED', "Payroll can't be run for a future month.", { fields: { month: 'In the future' } });
  if (b.payDate < `${b.month}-01`) throw new AppError('VALIDATION_FAILED', 'The pay date must be in or after the month.', { fields: { payDate: 'Before the month' } });
  if (await db().payrollRun.findFirst({ where: { tenantId: ctx.tenantId, month: b.month } })) throw new AppError('VALIDATION_FAILED', 'Payroll for this month already exists. Open it to recalculate.', { fields: { month: 'Already made' } });
  if (b.accountId) await resolveAccount(ctx, b.accountId, 'bank');
  const r = monthRange(b.month);
  const run = await db().payrollRun.create({ data: { tenantId: ctx.tenantId, number: `PAY-${b.month}`, month: b.month, periodFrom: day(r.from), periodTo: day(r.to), payDate: day(b.payDate), accountId: b.accountId ?? null, notes: b.notes ?? null, createdBy: ctx.userId } });
  const made = await buildSlips(ctx, run.id, b.month, (code) => `PS/${b.month}/${code}`);
  if (!made) {
    await db().payrollRun.delete({ where: { id: run.id } });
    throw new AppError('VALIDATION_FAILED', 'No employee has a salary set for this month. Set basic pay in Payroll → Salary structure first.');
  }
  await totals(run.id);
  await audit({ action: 'hr.payroll.create', entity: 'payroll_run', entityId: run.id, after: { month: b.month, employees: made } });
  return getRun(ctx, run.id);
}

async function findRun(ctx: TenantCtx, id: string) {
  const r = await db().payrollRun.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!r) throw notFound('Payroll');
  return r;
}

/** Draft only: work every payslip out again (attendance, leave or salary changed) and add new joiners */
export async function recalculate(ctx: TenantCtx, id: string) {
  const r = await findRun(ctx, id);
  if (r.status !== 'draft') throw new AppError('CONFLICT', 'Only a draft payroll can be recalculated. Reopen it first.');
  const slips = await db().payslip.findMany({ where: { runId: id } });
  await db().hrOvertime.updateMany({ where: { payslipId: { in: slips.map((s) => s.id) } }, data: { payslipId: null } });
  // Keep manual adjustments: they are added back after the recalculation
  const manual = new Map(slips.map((s) => [s.employeeId, { earnings: (s.earnings as unknown as Line[]).filter((x) => x.manual), deductions: (s.deductions as unknown as Line[]).filter((x) => x.manual) }]));
  await db().payslip.deleteMany({ where: { runId: id } });
  await buildSlips(ctx, id, r.month, (code) => `PS/${r.month}/${code}`);
  for (const s of await db().payslip.findMany({ where: { runId: id } })) {
    const m = manual.get(s.employeeId);
    if (m && (m.earnings.length || m.deductions.length)) await applyAdjust(s.id, m.earnings, m.deductions);
  }
  await totals(id);
  return getRun(ctx, id);
}

export const AdjustInput = z.object({
  earnings: z.array(z.object({ name: z.string().trim().min(1, 'Name it').max(60), amountPaise: Paise.refine((v) => v > 0, 'Enter the amount') })).max(10).default([]),
  deductions: z.array(z.object({ name: z.string().trim().min(1, 'Name it').max(60), amountPaise: Paise.refine((v) => v > 0, 'Enter the amount') })).max(10).default([]),
});

async function applyAdjust(slipId: string, earnings: { name: string; amountPaise: number }[], deductions: { name: string; amountPaise: number }[]) {
  const s = await db().payslip.findUniqueOrThrow({ where: { id: slipId } });
  const e = [...(s.earnings as unknown as Line[]).filter((x) => !x.manual), ...earnings.map((x) => ({ ...x, manual: true, code: 'manual' }))];
  const d = [...(s.deductions as unknown as Line[]).filter((x) => !x.manual), ...deductions.map((x) => ({ ...x, manual: true, code: 'other' }))];
  const gross = e.reduce((a, x) => a + BigInt(x.amountPaise), 0n);
  const ded = d.reduce((a, x) => a + BigInt(x.amountPaise), 0n);
  if (ded > gross) throw new AppError('VALIDATION_FAILED', 'Deductions cannot be more than the gross pay.');
  await db().payslip.update({ where: { id: slipId }, data: { earnings: e as unknown as object, deductions: d as unknown as object, grossPaise: gross, deductionsPaise: ded, netPaise: gross - ded } });
}

/** Bonus, arrears or a one-off deduction on one payslip (draft payroll only) */
export async function adjustSlip(ctx: TenantCtx, slipId: string, b: z.infer<typeof AdjustInput>) {
  const s = await db().payslip.findFirst({ where: { id: slipId, tenantId: ctx.tenantId }, include: { run: true } });
  if (!s) throw notFound('Payslip');
  if (s.run.status !== 'draft') throw new AppError('CONFLICT', 'Reopen the payroll to change a payslip.');
  await applyAdjust(slipId, b.earnings, b.deductions);
  await totals(s.runId);
  return getPayslip(ctx, slipId);
}

export async function removeSlip(ctx: TenantCtx, slipId: string) {
  const s = await db().payslip.findFirst({ where: { id: slipId, tenantId: ctx.tenantId }, include: { run: true } });
  if (!s) throw notFound('Payslip');
  if (s.run.status !== 'draft') throw new AppError('CONFLICT', 'Reopen the payroll to remove a payslip.');
  await db().hrOvertime.updateMany({ where: { payslipId: slipId }, data: { payslipId: null } });
  await db().payslip.delete({ where: { id: slipId } });
  await totals(s.runId);
}

/** Lock the numbers: payslips can now be paid and shared */
export async function processRun(ctx: TenantCtx, id: string) {
  const r = await findRun(ctx, id);
  if (r.status !== 'draft') throw new AppError('CONFLICT', 'This payroll is already processed.');
  const negative = await db().payslip.count({ where: { runId: id, netPaise: { lt: 0 } } });
  if (negative) throw new AppError('CONFLICT', `${negative} payslip${negative === 1 ? ' has' : 's have'} a negative net pay. Fix the deductions first.`);
  await db().payrollRun.update({ where: { id }, data: { status: 'processed', version: { increment: 1 } } });
  await audit({ action: 'hr.payroll.process', entity: 'payroll_run', entityId: id });
  return getRun(ctx, id);
}

export async function reopenRun(ctx: TenantCtx, id: string) {
  const r = await findRun(ctx, id);
  if (r.status !== 'processed') throw new AppError('CONFLICT', 'Only a processed payroll with nothing paid can be reopened.');
  if (await db().payslip.count({ where: { runId: id, status: 'paid' } })) throw new AppError('CONFLICT', 'Some salaries are paid. Undo those payments first.');
  await db().payrollRun.update({ where: { id }, data: { status: 'draft', version: { increment: 1 } } });
  return getRun(ctx, id);
}

export async function deleteRun(ctx: TenantCtx, id: string) {
  const r = await findRun(ctx, id);
  if (await db().payslip.count({ where: { runId: id, status: 'paid' } })) throw new AppError('CONFLICT', 'Some salaries are paid. Undo those payments first.');
  const slips = await db().payslip.findMany({ where: { runId: id }, select: { id: true } });
  await db().hrOvertime.updateMany({ where: { payslipId: { in: slips.map((s) => s.id) } }, data: { payslipId: null } });
  await db().payrollRun.delete({ where: { id } });
  await audit({ action: 'hr.payroll.delete', entity: 'payroll_run', entityId: id, before: { month: r.month } });
}

export const PayInput = z.object({ payslipIds: z.array(z.string().uuid()).max(2000).optional(), paidOn: DateStr, accountId: z.string().uuid({ message: 'Choose the account salaries are paid from' }) });

/** Pay salaries: the chosen payslips (or all unpaid) are marked paid and posted to the books as one entry */
export async function paySalaries(ctx: TenantCtx, id: string, b: z.infer<typeof PayInput>) {
  const r = await findRun(ctx, id);
  if (r.status === 'draft') throw new AppError('CONFLICT', 'Process the payroll before paying salaries.');
  if (b.paidOn > todayIST()) throw new AppError('VALIDATION_FAILED', "The payment date can't be in the future.", { fields: { paidOn: 'In the future' } });
  const accountId = await resolveAccount(ctx, b.accountId, 'bank');
  const slips = await db().payslip.findMany({ where: { runId: id, status: 'unpaid', ...(b.payslipIds ? { id: { in: b.payslipIds } } : {}) } });
  if (!slips.length) throw new AppError('CONFLICT', 'Nothing left to pay in this payroll.');
  const L = await payrollLedgers(ctx);
  const sumCode = (code: string, field: 'deductions' | 'employer') => slips.reduce((s, p) => s + (p[field] as unknown as Line[]).filter((x) => x.code === code).reduce((a, x) => a + BigInt(x.amountPaise), 0n), 0n);
  const gross = slips.reduce((s, p) => s + p.grossPaise, 0n);
  const employer = slips.reduce((s, p) => s + p.employerPaise, 0n);
  const net = slips.reduce((s, p) => s + p.netPaise, 0n);
  const lines = [
    { ledgerKey: `exp:${SALARY}`, debitPaise: n(gross), creditPaise: 0, description: 'Gross salaries' },
    { ledgerKey: `exp:${EMPLOYER}`, debitPaise: n(employer), creditPaise: 0, description: "Employer's PF and ESI" },
    { ledgerKey: `cash:${accountId}`, debitPaise: 0, creditPaise: n(net), description: 'Net salaries paid' },
    { ledgerKey: L.pf, debitPaise: 0, creditPaise: n(sumCode('pf', 'deductions') + sumCode('pf', 'employer')), description: 'PF to deposit' },
    { ledgerKey: L.esi, debitPaise: 0, creditPaise: n(sumCode('esi', 'deductions') + sumCode('esi', 'employer')), description: 'ESI to deposit' },
    { ledgerKey: L.pt, debitPaise: 0, creditPaise: n(sumCode('pt', 'deductions')), description: 'Professional tax to pay' },
    { ledgerKey: L.advances, debitPaise: 0, creditPaise: n(sumCode('loan', 'deductions')), description: 'Advance instalments recovered' },
    { ledgerKey: L.other, debitPaise: 0, creditPaise: n(sumCode('other', 'deductions')), description: 'Other deductions' },
  ].filter((l) => l.debitPaise || l.creditPaise);
  const monthName = new Date(`${r.month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const j = await createJournal(ctx, JournalInput.parse({ journalOn: b.paidOn, narration: `Salaries for ${monthName} — ${slips.length} employee${slips.length === 1 ? '' : 's'}`, reference: r.number, lines }));
  await db().payslip.updateMany({ where: { id: { in: slips.map((s) => s.id) } }, data: { status: 'paid', paidOn: day(b.paidOn), accountId, journalId: j.id } });
  await totals(id);
  const unpaid = await db().payslip.count({ where: { runId: id, status: 'unpaid' } });
  await db().payrollRun.update({ where: { id }, data: { status: unpaid ? 'processed' : 'paid', accountId } });
  // A loan fully taken back closes itself
  for (const loanId of new Set(slips.flatMap((s) => (s.deductions as unknown as Line[]).map((d) => d.loanId).filter(Boolean) as string[]))) {
    const l = await db().hrLoan.findUnique({ where: { id: loanId } });
    if (l && (await recovered(ctx, loanId)) >= l.amountPaise) await db().hrLoan.update({ where: { id: loanId }, data: { status: 'closed' } });
  }
  await audit({ action: 'hr.payroll.pay', entity: 'payroll_run', entityId: id, after: { payslips: slips.length, netPaise: net, journal: j.number } });
  return getRun(ctx, id);
}

/** Undo a salary payment: every payslip paid in the same entry goes back to unpaid */
export async function undoPayment(ctx: TenantCtx, slipId: string) {
  const s = await db().payslip.findFirst({ where: { id: slipId, tenantId: ctx.tenantId } });
  if (!s) throw notFound('Payslip');
  if (s.status !== 'paid' || !s.journalId) throw new AppError('CONFLICT', 'This salary is not paid.');
  const batch = await db().payslip.findMany({ where: { journalId: s.journalId } });
  await deleteJournal(ctx, s.journalId);
  await db().payslip.updateMany({ where: { journalId: s.journalId }, data: { status: 'unpaid', paidOn: null, journalId: null } });
  for (const runId of new Set(batch.map((b) => b.runId))) {
    await totals(runId);
    await db().payrollRun.update({ where: { id: runId }, data: { status: 'processed' } });
  }
  for (const loanId of new Set(batch.flatMap((x) => (x.deductions as unknown as Line[]).map((d) => d.loanId).filter(Boolean) as string[]))) await db().hrLoan.update({ where: { id: loanId }, data: { status: 'active' } });
  await audit({ action: 'hr.payroll.unpay', entity: 'payslip', entityId: slipId, after: { payslips: batch.length } });
  return { undone: batch.length };
}

export async function listRuns(ctx: TenantCtx, year?: string) {
  const rows = await db().payrollRun.findMany({ where: { tenantId: ctx.tenantId, ...(year ? { month: { startsWith: year } } : {}) }, orderBy: { month: 'desc' } });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { data: rows, counts };
}

export async function getRun(ctx: TenantCtx, id: string) {
  const r = await findRun(ctx, id);
  const [slips, lookup] = await Promise.all([db().payslip.findMany({ where: { runId: id }, orderBy: { number: 'asc' } }), names(ctx)]);
  const accounts = await ensureFinance(ctx);
  return {
    ...r,
    account: r.accountId ? accounts.find((a) => a.id === r.accountId)?.name ?? null : null,
    payslips: slips.map((s) => ({ ...s, payableDays: Number(s.payableDays), lopDays: Number(s.lopDays), employee: lookup.emp.get(s.employeeId) ?? (s.snapshot as { name?: string })?.name ?? '—', employeeCode: lookup.code.get(s.employeeId) ?? '' })),
  };
}

export async function getPayslip(ctx: TenantCtx, id: string) {
  const s = await db().payslip.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { run: true } });
  if (!s) throw notFound('Payslip');
  if (ctx.scope === 'own') {
    const me = await myEmployee(ctx);
    if (!me || me.id !== s.employeeId || s.run.status === 'draft') throw notFound('Payslip');
  }
  const t = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true, gstin: true, profile: true } });
  return { ...s, payableDays: Number(s.payableDays), lopDays: Number(s.lopDays), company: { name: t.name, address: (t.profile as { address?: unknown })?.address ?? null } };
}

/** Payslips for one employee (self-service sees only processed ones) */
export async function employeePayslips(ctx: TenantCtx, employeeId?: string) {
  let id = employeeId;
  if (ctx.scope === 'own' || !id) {
    const me = await myEmployee(ctx);
    if (!me) return { data: [] };
    id = me.id;
  }
  const slips = await db().payslip.findMany({ where: { tenantId: ctx.tenantId, employeeId: id, ...(ctx.scope === 'own' ? { run: { status: { not: 'draft' } } } : {}) }, include: { run: { select: { month: true, status: true, payDate: true } } }, orderBy: { createdAt: 'desc' } });
  return { data: slips.map((s) => ({ ...s, payableDays: Number(s.payableDays), lopDays: Number(s.lopDays), month: s.run.month, runStatus: s.run.status })) };
}

// ── Loans and advances ──

export const LoanInput = z.object({
  employeeId: z.string().uuid({ message: 'Choose the employee' }),
  title: z.string().trim().min(2, 'Name it, e.g. Salary advance').max(80),
  kind: z.string().trim().min(1).max(60).default('Salary advance'),
  amountPaise: Paise.refine((v) => v > 0, 'Enter the amount'),
  emiPaise: Paise.refine((v) => v > 0, 'Enter the monthly instalment'),
  givenOn: DateStr,
  startsMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose the first month'),
  accountId: z.string().uuid().optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
}).refine((l) => l.emiPaise <= l.amountPaise, { message: 'The instalment cannot be more than the amount', path: ['emiPaise'] });

export async function createLoan(ctx: TenantCtx, b: z.infer<typeof LoanInput>) {
  const e = await db().employee.findFirst({ where: { id: b.employeeId, tenantId: ctx.tenantId, status: { not: 'exited' } } });
  if (!e) throw new AppError('VALIDATION_FAILED', 'Choose a current employee.', { fields: { employeeId: 'Choose the employee' } });
  if (b.givenOn > todayIST()) throw new AppError('VALIDATION_FAILED', "The date can't be in the future.", { fields: { givenOn: 'In the future' } });
  if (b.startsMonth < b.givenOn.slice(0, 7)) throw new AppError('VALIDATION_FAILED', 'Recovery starts in or after the month it is given.', { fields: { startsMonth: 'Before it was given' } });
  let journalId: string | null = null;
  if (b.accountId) {
    // Money handed over: Dr Salary advances, Cr the cash or bank account
    const accountId = await resolveAccount(ctx, b.accountId, 'bank');
    const L = await payrollLedgers(ctx);
    const j = await createJournal(ctx, JournalInput.parse({ journalOn: b.givenOn, narration: `${b.title} to ${e.name}`, lines: [{ ledgerKey: L.advances, debitPaise: b.amountPaise }, { ledgerKey: `cash:${accountId}`, creditPaise: b.amountPaise }] }));
    journalId = j.id;
  }
  const l = await db().hrLoan.create({ data: { ...b, amountPaise: BigInt(b.amountPaise), emiPaise: BigInt(b.emiPaise), givenOn: day(b.givenOn), accountId: b.accountId ?? null, journalId, tenantId: ctx.tenantId, createdBy: ctx.userId } });
  await audit({ action: 'hr.loan.create', entity: 'hr_loan', entityId: l.id, after: { employeeId: b.employeeId, amountPaise: b.amountPaise } });
  return l;
}

export async function listLoans(ctx: TenantCtx, employeeId?: string) {
  const [rows, lookup] = await Promise.all([db().hrLoan.findMany({ where: { tenantId: ctx.tenantId, ...(employeeId ? { employeeId } : {}) }, orderBy: [{ status: 'asc' }, { givenOn: 'desc' }] }), names(ctx)]);
  const out = [];
  for (const l of rows) {
    const back = await recovered(ctx, l.id);
    out.push({ ...l, employee: lookup.emp.get(l.employeeId) ?? '—', employeeCode: lookup.code.get(l.employeeId) ?? '', recoveredPaise: back, leftPaise: l.amountPaise - back });
  }
  return { data: out };
}

export async function closeLoan(ctx: TenantCtx, id: string, status: 'active' | 'closed') {
  const l = await db().hrLoan.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!l) throw notFound('Loan');
  return db().hrLoan.update({ where: { id }, data: { status } });
}

export async function deleteLoan(ctx: TenantCtx, id: string) {
  const l = await db().hrLoan.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!l) throw notFound('Loan');
  if ((await recovered(ctx, id)) > 0n) throw new AppError('CONFLICT', 'Instalments are already taken through payroll. Close it instead.');
  if (l.journalId) await deleteJournal(ctx, l.journalId);
  await db().hrLoan.delete({ where: { id } });
}

// ── Overtime ──

export const OvertimeInput = z.object({
  employeeId: z.string().uuid({ message: 'Choose the employee' }),
  workOn: DateStr,
  hours: z.number().positive('Enter the hours').max(24),
  ratePaise: Paise.refine((v) => v > 0, 'Enter the rate per hour'),
  notes: z.string().trim().max(300).optional().nullable(),
});

export async function saveOvertime(ctx: TenantCtx, b: z.infer<typeof OvertimeInput>, id?: string) {
  if (b.workOn > todayIST()) throw new AppError('VALIDATION_FAILED', "Overtime can't be for a future date.", { fields: { workOn: 'In the future' } });
  const e = await db().employee.findFirst({ where: { id: b.employeeId, tenantId: ctx.tenantId } });
  if (!e) throw new AppError('VALIDATION_FAILED', 'Choose the employee.', { fields: { employeeId: 'Choose the employee' } });
  const data = { ...b, workOn: day(b.workOn), ratePaise: BigInt(b.ratePaise) };
  if (id) {
    const o = await db().hrOvertime.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!o) throw notFound('Overtime');
    if (o.payslipId) throw new AppError('CONFLICT', 'This overtime is already on a payslip.');
    return db().hrOvertime.update({ where: { id }, data });
  }
  return db().hrOvertime.create({ data: { ...data, tenantId: ctx.tenantId, createdBy: ctx.userId } });
}

export async function listOvertime(ctx: TenantCtx, month?: string, employeeId?: string) {
  const r = month ? monthRange(month) : null;
  const [rows, lookup] = await Promise.all([db().hrOvertime.findMany({ where: { tenantId: ctx.tenantId, ...(employeeId ? { employeeId } : {}), ...(r ? { workOn: { gte: day(r.from), lte: day(r.to) } } : {}) }, orderBy: { workOn: 'desc' }, take: 2000 }), names(ctx)]);
  return { data: rows.map((o) => ({ ...o, hours: Number(o.hours), amountPaise: (BigInt(Math.round(Number(o.hours) * 100)) * o.ratePaise + 50n) / 100n, employee: lookup.emp.get(o.employeeId) ?? '—', employeeCode: lookup.code.get(o.employeeId) ?? '' })) };
}

export async function deleteOvertime(ctx: TenantCtx, id: string) {
  const o = await db().hrOvertime.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!o) throw notFound('Overtime');
  if (o.payslipId) throw new AppError('CONFLICT', 'This overtime is already on a payslip. Recalculate or remove that payslip first.');
  await db().hrOvertime.delete({ where: { id } });
}
