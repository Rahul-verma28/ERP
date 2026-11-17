import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import * as fin from '../modules/finance/service';
import * as books from '../modules/finance/books';
import * as setup from '../modules/hr/setup';
import * as emp from '../modules/hr/employees';
import * as time from '../modules/hr/time';
import * as pay from '../modules/hr/payroll';
import * as people from '../modules/hr/people';
import * as rec from '../modules/hr/records';

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
afterAll(() => prisma.$disconnect());

async function prepare() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'HR', email: `hr-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `HR ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09', gstin: '09AAACH7409R1ZZ' } });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'owner', tenantId: null }, select: { id: true } })).id;
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  await setup.ensureHr(ctx);
  // Monday to Saturday working, no holidays: a 30-day month has a known count of Sundays
  await setup.updateConfig(ctx, { workingDays: [1, 2, 3, 4, 5, 6] });
  return { ctx };
}

// A past month, so nothing is "in the future"
const MONTH = '2026-09';

describe('hr & payroll', () => {
  it('pays a month with PF, ESI, loss of pay, an allowance and an advance, and posts it to the books', async () => {
    await rolledBack(async () => {
      const { ctx } = await prepare();
      const e = await emp.createEmployee(ctx, emp.EmployeeInput.parse({ name: 'Asha Verma', phone: '9876543210', joinedOn: '2026-01-10', basicPaise: 1_500_000, pf: true, esi: true }));
      expect(e.code).toBe('EMP-0001');
      await expect(emp.createEmployee(ctx, emp.EmployeeInput.parse({ name: 'Copy', phone: '9876543210', joinedOn: '2026-01-10' }))).rejects.toThrow('mobile number');
      await emp.setSalary(ctx, e.id, emp.SalaryInput.parse({ basicPaise: 1_500_000, pf: true, esi: true, items: [{ kind: 'allowance', name: 'HRA', calc: 'percent', amount: 2000 }] }));

      // Two days absent in September: 28 of 30 days are paid
      await time.markAttendance(ctx, time.MarkInput.parse({ date: '2026-09-07', rows: [{ employeeId: e.id, status: 'absent' }] }));
      await time.markAttendance(ctx, time.MarkInput.parse({ date: '2026-09-08', rows: [{ employeeId: e.id, status: 'absent' }] }));
      const bank = (await fin.ensureFinance(ctx)).find((a) => a.kind === 'bank')!;
      await pay.createLoan(ctx, pay.LoanInput.parse({ employeeId: e.id, title: 'Salary advance', amountPaise: 300_000, emiPaise: 100_000, givenOn: '2026-08-20', startsMonth: '2026-09', accountId: bank.id }));

      const run = await pay.createRun(ctx, pay.RunInput.parse({ month: MONTH, payDate: '2026-10-01' }));
      const slip = run.payslips[0];
      expect(slip.lopDays).toBe(2);
      expect(slip.payableDays).toBe(28);
      expect(slip.basicPaise).toBe(1_400_000n); // 15,000 × 28/30
      const earnings = slip.earnings as unknown as pay.Line[];
      expect(earnings.find((x) => x.name === 'HRA')?.amountPaise).toBe(280_000); // 20% of the paid basic
      const ded = slip.deductions as unknown as pay.Line[];
      expect(ded.find((x) => x.code === 'pf')?.amountPaise).toBe(168_000); // 12% of 14,000
      expect(ded.find((x) => x.code === 'esi')?.amountPaise).toBe(12_600); // 0.75% of 16,800, up to the rupee
      expect(ded.find((x) => x.code === 'loan')?.amountPaise).toBe(100_000);
      expect(slip.netPaise).toBe(1_680_000n - 168_000n - 12_600n - 100_000n);

      await expect(pay.paySalaries(ctx, run.id, pay.PayInput.parse({ paidOn: '2026-10-01', accountId: bank.id }))).rejects.toThrow('Process');
      await pay.processRun(ctx, run.id);
      const paid = await pay.paySalaries(ctx, run.id, pay.PayInput.parse({ paidOn: '2026-10-01', accountId: bank.id }));
      expect(paid.status).toBe('paid');

      // The books stay balanced and the bank paid the net salary (and the advance)
      const tb = await books.trialBalance(ctx, { from: '2026-04-01', to: '2026-10-31' });
      expect(tb.debitPaise).toBe(tb.creditPaise);
      const bal = (await fin.listAccounts(ctx)).find((a) => a.id === bank.id)!.balancePaise;
      expect(bal).toBe(-(300_000n + slip.netPaise));
      const loans = await pay.listLoans(ctx);
      expect(loans.data[0].leftPaise).toBe(200_000n);

      await pay.undoPayment(ctx, slip.id);
      expect((await pay.getRun(ctx, run.id)).status).toBe('processed');
    });
  });

  it('counts leave on working days only, checks the balance, and fills attendance when approved', async () => {
    await rolledBack(async () => {
      const { ctx } = await prepare();
      const e = await emp.createEmployee(ctx, emp.EmployeeInput.parse({ name: 'Ravi', joinedOn: '2026-01-01', basicPaise: 1_000_000 }));
      const types = await setup.listLeaveTypes(ctx);
      const cl = types.find((t) => t.code === 'CL')!;
      await setup.saveHoliday(ctx, setup.HolidayInput.parse({ name: 'Festival', fromDate: '2026-09-15' }));
      // 14th Mon … 20th Sun: Sunday off and the 15th a holiday → 5 days
      const l = await time.applyLeave(ctx, time.LeaveInput.parse({ employeeId: e.id, leaveTypeId: cl.id, fromDate: '2026-09-14', toDate: '2026-09-20', reason: 'Family function' }));
      expect(Number(l.days)).toBe(5);
      await expect(time.applyLeave(ctx, time.LeaveInput.parse({ employeeId: e.id, leaveTypeId: cl.id, fromDate: '2026-09-16', toDate: '2026-09-16', reason: 'Again' }))).rejects.toThrow('already leave');
      await expect(time.applyLeave(ctx, time.LeaveInput.parse({ employeeId: e.id, leaveTypeId: cl.id, fromDate: '2026-10-01', toDate: '2026-10-10', reason: 'Long trip' }))).rejects.toThrow('left');
      await expect(time.decideLeave(ctx, l.id, { status: 'rejected' })).rejects.toThrow('why');
      await time.decideLeave(ctx, l.id, { status: 'approved' });
      const month = await time.monthView(ctx, MONTH, e.id);
      expect(month.data[0].totals.leave).toBe(5);
      const bal = await time.balances(ctx, { employeeId: e.id, date: '2026-09-14' });
      expect(bal.data[0].leave.find((x) => x.typeId === cl.id)?.left).toBe(7);
      // Paid leave is not loss of pay
      expect((await time.lopDays(ctx, e.id, '2026-09-01', '2026-09-30')).lop).toBe(0);
      await time.cancelLeave(ctx, l.id);
      expect((await time.monthView(ctx, MONTH, e.id)).data[0].totals.leave).toBe(0);
    });
  });

  it('applies an approved promotion and an accepted resignation to the employee', async () => {
    await rolledBack(async () => {
      const { ctx } = await prepare();
      const sales = await setup.saveDepartment(ctx, setup.DepartmentInput.parse({ name: 'Sales' }));
      const senior = await setup.saveDesignation(ctx, setup.DesignationInput.parse({ name: 'Senior executive', departmentId: sales.id }));
      const e = await emp.createEmployee(ctx, emp.EmployeeInput.parse({ name: 'Neha', joinedOn: '2025-04-01' }));
      await expect(people.createAction(ctx, people.ActionInput.parse({ kind: 'promotion', employeeId: e.id, onDate: '2026-09-01' }))).rejects.toThrow('designation');
      const p = await people.createAction(ctx, people.ActionInput.parse({ kind: 'promotion', employeeId: e.id, onDate: '2026-09-01', effectiveOn: '2026-09-01', to: { designationId: senior.id, departmentId: sales.id } }));
      await people.setActionStatus(ctx, p.id, { status: 'approved' });
      const after = await emp.getEmployee(ctx, e.id);
      expect(after.designation).toBe('Senior executive');
      await expect(people.deleteAction(ctx, p.id)).rejects.toThrow('history');

      const r = await people.createAction(ctx, people.ActionInput.parse({ kind: 'resignation', employeeId: e.id, onDate: '2026-09-01', effectiveOn: '2026-09-30', description: 'Moving cities' }));
      await people.setActionStatus(ctx, r.id, { status: 'accepted' });
      expect((await emp.getEmployee(ctx, e.id)).status).toBe('exited');
      await expect(setup.deleteDepartment(ctx, sales.id)).rejects.toThrow('Move them first');
    });
  });

  it('takes a candidate from offer to employee, then onboards them with a checklist', async () => {
    await rolledBack(async () => {
      const { ctx } = await prepare();
      const job = await people.saveJob(ctx, people.JobInput.parse({ title: 'Sales executive' }));
      const c = await people.saveCandidate(ctx, people.CandidateInput.parse({ jobId: job.id, name: 'Kiran', phone: '9123456780' }));
      const a = await rec.createRecord(ctx, 'assessment', { candidateId: c.id, title: 'Practical task', onDate: '2026-09-10', score: 8, maxScore: 10 });
      await expect(rec.createRecord(ctx, 'assessment', { candidateId: c.id, title: 'X', onDate: '2026-09-10', score: 11, maxScore: 10 })).rejects.toThrow();
      await rec.setRecordStatus(ctx, a.id, 'passed');

      const joining = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
      const offer = await rec.createRecord(ctx, 'offer', { candidateId: c.id, position: 'Sales executive', salaryPaise: 1_800_000, joiningOn: joining });
      expect((await db().hrCandidate.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe('offer');
      await expect(rec.convertOffer(ctx, offer.id)).rejects.toThrow('accepted');
      await rec.setRecordStatus(ctx, offer.id, 'accepted');
      const e = await rec.convertOffer(ctx, offer.id);
      expect(e.basicPaise).toBe(1_800_000n);
      expect((await db().hrCandidate.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe('hired');
      await expect(rec.deleteRecord(ctx, offer.id)).rejects.toThrow('history');

      const list = await rec.createRecord(ctx, 'checklist', { name: 'New joiner', isDefault: true, items: [{ task: 'Collect PAN and Aadhaar', dueDay: 0 }, { task: 'Billing software training', dueDay: 3 }, { task: 'Lunch with team', dueDay: 1, required: false }] });
      const ob = await rec.createRecord(ctx, 'onboarding', { candidateId: c.id, checklistId: list.id, startOn: '2026-10-01' });
      const tasks = (ob.data as { tasks: { id: string; required: boolean; dueOn: string }[] }).tasks;
      expect(tasks[1].dueOn).toBe('2026-10-04');
      await expect(rec.deleteRecord(ctx, list.id)).rejects.toThrow('inactive');
      await rec.toggleTask(ctx, ob.id, tasks[0].id, true);
      const done = await rec.toggleTask(ctx, ob.id, tasks[1].id, true);
      expect(done.status).toBe('completed');
    });
  });
});
