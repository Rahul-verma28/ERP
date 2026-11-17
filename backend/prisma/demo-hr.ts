// Demo data for HR & Payroll, so every HR page shows real-looking rows.
// Usage: npx tsx prisma/demo-hr.ts <tenantId> [<tenantId> …]
// Skips a business that already has employees. Uses the same service code the app uses,
// so payroll, leave, attendance and the books all line up.
import { randomUUID } from 'node:crypto';
import { prisma, db, withPlatform } from '../src/kernel/db';
import type { TenantCtx } from '../src/kernel/context';
import * as fin from '../src/modules/finance/service';
import * as setup from '../src/modules/hr/setup';
import * as emp from '../src/modules/hr/employees';
import * as time from '../src/modules/hr/time';
import * as pay from '../src/modules/hr/payroll';
import * as people from '../src/modules/hr/people';
import * as rec from '../src/modules/hr/records';

const step = <T>(label: string, fn: () => Promise<T>) => {
  const t = Date.now();
  return withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 }).then((r) => { console.log(`  ✔ ${label} (${Math.round((Date.now() - t) / 1000)}s)`); return r; });
};
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86_400_000));
/** A steady "random" number 0–99 for a name and a date, so reruns look the same */
const roll = (key: string) => { let h = 7; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 100; };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

async function seed(tenantId: string) {
  const t = await withPlatform(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  const existing = await withPlatform(() => prisma.employee.count({ where: { tenantId } }));
  if (existing) return console.log(`  · already has ${existing} employees, skipped`);
  const member = await withPlatform(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }));
  const ctx: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: member.id, roleId: member.roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };

  // ── Setup: departments, designations, shifts, holidays ──
  const ids = await step('departments, designations, shifts, holidays', async () => {
    await setup.ensureHr(ctx);
    await fin.ensureFinance(ctx);
    const dept: Record<string, string> = {};
    for (const name of ['Management', 'Sales', 'Billing & Accounts', 'Warehouse', 'Delivery']) dept[name] = (await setup.saveDepartment(ctx, setup.DepartmentInput.parse({ name }))).id;
    const desig: Record<string, string> = {};
    for (const [name, d] of [['Store Manager', 'Management'], ['Senior Sales Executive', 'Sales'], ['Sales Executive', 'Sales'], ['Accountant', 'Billing & Accounts'], ['Cashier', 'Billing & Accounts'], ['Store Keeper', 'Warehouse'], ['Helper', 'Warehouse'], ['Delivery Executive', 'Delivery']] as const) {
      desig[name] = (await setup.saveDesignation(ctx, setup.DesignationInput.parse({ name, departmentId: dept[d] }))).id;
    }
    const general = (await db().hrShift.findFirstOrThrow({ where: { tenantId, isDefault: true } })).id;
    const morning = (await setup.saveShift(ctx, setup.ShiftInput.parse({ name: 'Morning', startsAt: '08:00', endsAt: '16:00', breakMinutes: 30, graceMinutes: 10 }))).id;
    await setup.saveShift(ctx, setup.ShiftInput.parse({ name: 'Evening', startsAt: '13:00', endsAt: '21:00', breakMinutes: 30, graceMinutes: 10 }));
    for (const [name, from, to, kind, optional] of [
      ['Republic Day', '2026-01-26', null, 'national', false], ['Holi', '2026-03-04', null, 'festival', false], ['Good Friday', '2026-04-03', null, 'festival', true],
      ['Independence Day', '2026-08-15', null, 'national', false], ['Raksha Bandhan', '2026-08-28', null, 'festival', false], ['Gandhi Jayanti', '2026-10-02', null, 'national', false],
      ['Dussehra', '2026-10-20', null, 'festival', false], ['Diwali', '2026-11-08', '2026-11-09', 'festival', false], ['Guru Nanak Jayanti', '2026-11-24', null, 'festival', true], ['Christmas', '2026-12-25', null, 'festival', false],
    ] as const) await setup.saveHoliday(ctx, setup.HolidayInput.parse({ name, fromDate: from, toDate: to, kind, optional }));
    return { dept, desig, general, morning };
  });

  // ── Employees and their salary structure ──
  type P = { name: string; phone: string; gender: 'male' | 'female'; dob: string; joined: string; dept: string; desig: string; type?: 'full_time' | 'part_time' | 'contract' | 'intern'; basic: number; payType?: 'daily'; pf?: boolean; esi?: boolean; shift?: 'morning'; allow?: [string, 'fixed' | 'percent', number][]; ded?: [string, number][]; pan?: string; uan?: string; bank: string }
  const staff: P[] = [
    { name: 'Rakesh Sharma', phone: '9415011201', gender: 'male', dob: '1984-06-12', joined: '2022-04-01', dept: 'Management', desig: 'Store Manager', basic: 3_000_000, pf: true, allow: [['HRA', 'percent', 4000], ['Special allowance', 'fixed', 500_000]], pan: 'ABKPS4521K', uan: '100845213377', bank: 'State Bank of India' },
    { name: 'Priya Verma', phone: '9415011202', gender: 'female', dob: '1996-02-03', joined: '2023-06-15', dept: 'Sales', desig: 'Sales Executive', basic: 1_800_000, pf: true, esi: true, allow: [['HRA', 'percent', 2000], ['Conveyance', 'fixed', 160_000]], pan: 'BQRPV7812M', uan: '100845213378', bank: 'HDFC Bank' },
    { name: 'Amit Kumar', phone: '9415011203', gender: 'male', dob: '1999-11-21', joined: '2024-02-01', dept: 'Sales', desig: 'Sales Executive', basic: 1_400_000, pf: true, esi: true, allow: [['HRA', 'percent', 2000]], uan: '100845213379', bank: 'Punjab National Bank' },
    { name: 'Sneha Gupta', phone: '9415011204', gender: 'female', dob: '1993-08-30', joined: '2023-09-10', dept: 'Billing & Accounts', desig: 'Accountant', basic: 2_200_000, pf: true, allow: [['HRA', 'percent', 3000], ['Medical', 'fixed', 125_000]], pan: 'CGHPG1290Q', uan: '100845213380', bank: 'ICICI Bank' },
    { name: 'Mohd. Imran', phone: '9415011205', gender: 'male', dob: '1998-04-17', joined: '2024-07-01', dept: 'Billing & Accounts', desig: 'Cashier', basic: 1_300_000, pf: true, esi: true, allow: [['HRA', 'percent', 1500]], ded: [['Canteen', 30_000]], uan: '100845213381', bank: 'Bank of Baroda' },
    { name: 'Suresh Yadav', phone: '9415011206', gender: 'male', dob: '1988-01-09', joined: '2022-11-20', dept: 'Warehouse', desig: 'Store Keeper', basic: 1_500_000, pf: true, esi: true, shift: 'morning', allow: [['HRA', 'percent', 2000]], uan: '100845213382', bank: 'State Bank of India' },
    { name: 'Raju Pal', phone: '9415011207', gender: 'male', dob: '2000-07-25', joined: '2025-03-10', dept: 'Warehouse', desig: 'Helper', basic: 60_000, payType: 'daily', shift: 'morning', bank: 'Union Bank of India' },
    { name: 'Vikas Singh', phone: '9415011208', gender: 'male', dob: '2001-12-02', joined: '2025-01-05', dept: 'Delivery', desig: 'Delivery Executive', basic: 1_200_000, esi: true, shift: 'morning', allow: [['Fuel allowance', 'fixed', 200_000]], bank: 'Canara Bank' },
    { name: 'Neha Joshi', phone: '9415011209', gender: 'female', dob: '2004-05-14', joined: '2026-08-01', dept: 'Sales', desig: 'Sales Executive', type: 'intern', basic: 800_000, bank: 'Axis Bank' },
    { name: 'Anil Mehta', phone: '9415011210', gender: 'male', dob: '1991-10-05', joined: '2025-05-01', dept: 'Sales', desig: 'Sales Executive', type: 'contract', basic: 1_500_000, esi: true, allow: [['HRA', 'percent', 2000]], bank: 'Kotak Mahindra Bank' },
    { name: 'Deepak Rao', phone: '9415011211', gender: 'male', dob: '1995-03-19', joined: '2024-05-15', dept: 'Delivery', desig: 'Delivery Executive', basic: 1_100_000, esi: true, bank: 'Indian Bank' },
  ];
  const E = await step(`${staff.length} employees with salary`, async () => {
    const out: Record<string, string> = {};
    let manager: string | null = null;
    for (const [i, p] of staff.entries()) {
      const e = await emp.createEmployee(ctx, emp.EmployeeInput.parse({
        name: p.name, phone: p.phone, email: `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.in`, gender: p.gender, dob: p.dob, joinedOn: p.joined, employmentType: p.type ?? 'full_time',
        departmentId: ids.dept[p.dept], designationId: ids.desig[p.desig], managerId: i === 0 ? null : manager, shiftId: p.shift === 'morning' ? ids.morning : ids.general,
        probationEndsOn: p.joined >= '2026-01-01' ? addDays(p.joined, 90) : null,
        address: { line1: `${10 + i * 7}, ${['Gomti Nagar', 'Aliganj', 'Indira Nagar', 'Hazratganj', 'Chinhat'][i % 5]}`, city: 'Lucknow', state: 'Uttar Pradesh', pincode: `2260${10 + i}` },
        emergency: { name: `${p.gender === 'female' ? 'Mr.' : 'Mrs.'} ${p.name.split(' ').slice(-1)[0]}`, relation: p.gender === 'female' ? 'Father' : 'Wife', phone: `98390${String(11000 + i * 37).padStart(5, '0')}` },
        bank: { holder: p.name, bankName: p.bank, accountNo: `${30_000_000_000 + i * 7_919_311}`, ifsc: `SBIN000${1200 + i}` },
        pan: p.pan ?? null, uan: p.uan ?? null, esiNo: p.esi ? `311234${String(5600 + i).padStart(6, '0')}` : null, aadhaarLast4: String(4000 + i * 113).slice(-4),
      }));
      await emp.setSalary(ctx, e.id, emp.SalaryInput.parse({ basicPaise: p.basic, payType: p.payType ?? 'monthly', pf: !!p.pf, esi: !!p.esi, items: [...(p.allow ?? []).map(([name, calc, amount]) => ({ kind: 'allowance', name, calc, amount })), ...(p.ded ?? []).map(([name, amount]) => ({ kind: 'deduction', name, calc: 'fixed', amount }))] }));
      out[p.name] = e.id;
      if (i === 0) manager = e.id;
    }
    return out;
  });

  // ── Career: promotion, transfer, awards, warnings, complaints, resignation, termination ──
  await step('career records', async () => {
    const add = (b: Record<string, unknown>) => people.createAction(ctx, people.ActionInput.parse(b));
    const promo = await add({ kind: 'promotion', employeeId: E['Priya Verma'], onDate: '2026-09-25', effectiveOn: '2026-10-01', to: { designationId: ids.desig['Senior Sales Executive'], departmentId: ids.dept.Sales }, description: 'Top seller for two quarters running' });
    await people.setActionStatus(ctx, promo.id, { status: 'approved', response: 'Well deserved' });
    await add({ kind: 'promotion', employeeId: E['Amit Kumar'], onDate: '2026-11-10', effectiveOn: '2026-12-01', to: { designationId: ids.desig['Senior Sales Executive'] }, description: 'Recommended by the store manager' });
    await add({ kind: 'transfer', employeeId: E['Neha Joshi'], onDate: '2026-11-12', effectiveOn: '2026-12-01', to: { departmentId: ids.dept['Billing & Accounts'], designationId: ids.desig.Cashier }, description: 'Needed at the billing counter for the wedding season' });
    await add({ kind: 'award', employeeId: E['Priya Verma'], onDate: '2026-11-01', typeName: 'Employee of the month', description: 'Highest sales in Diwali week: ₹4.2 lakh' });
    await add({ kind: 'award', employeeId: E['Suresh Yadav'], onDate: '2026-11-01', typeName: 'Long service', description: 'Four years with zero stock mismatch' });
    await add({ kind: 'warning', employeeId: E['Amit Kumar'], onDate: '2026-10-29', typeName: 'Late coming', subject: 'Late on 5 days in October', severity: 'medium', description: 'Came after 10:00 on five working days.' });
    const w = await add({ kind: 'warning', employeeId: E['Vikas Singh'], onDate: '2026-10-15', typeName: 'Absent without notice', subject: 'Did not come on 13 Oct without telling', severity: 'high' });
    await people.setActionStatus(ctx, w.id, { status: 'acknowledged', response: 'Phone was off, will inform next time' });
    const c = await add({ kind: 'complaint', employeeId: E['Sneha Gupta'], againstId: E['Amit Kumar'], onDate: '2026-11-05', typeName: 'Workplace conduct', subject: 'Rude remarks at the billing counter', description: 'Raised voice in front of customers twice.' });
    await people.setActionStatus(ctx, c.id, { status: 'in_review' });
    await add({ kind: 'complaint', employeeId: E['Mohd. Imran'], onDate: '2026-11-11', typeName: 'Pay or benefits', subject: 'Overtime for Diwali week not added', description: 'Worked till 22:00 on 6 and 7 Nov.' });
    const r = await add({ kind: 'resignation', employeeId: E['Anil Mehta'], onDate: '2026-10-31', effectiveOn: '2026-11-30', description: 'Joining family business in Kanpur' });
    await people.setActionStatus(ctx, r.id, { status: 'accepted', response: 'Notice period till 30 Nov' });
    const term = await add({ kind: 'termination', employeeId: E['Deepak Rao'], onDate: '2026-09-05', effectiveOn: '2026-09-15', typeName: 'Absconding', description: 'Not reachable since 1 Sep, collected cash not deposited.' });
    await people.setActionStatus(ctx, term.id, { status: 'approved' });
  });

  // ── Leave: approved (paid and unpaid), waiting, rejected ──
  await step('leave applications', async () => {
    const types = await setup.listLeaveTypes(ctx);
    const T = (code: string) => types.find((x) => x.code === code)!.id;
    const apply = (name: string, code: string, from: string, to: string, reason: string, half = false) => time.applyLeave(ctx, time.LeaveInput.parse({ employeeId: E[name], leaveTypeId: T(code), fromDate: from, toDate: to, halfDay: half, reason }));
    const ok = async (l: { id: string }, comment?: string) => time.decideLeave(ctx, l.id, { status: 'approved', comment: comment ?? null });
    await ok(await apply('Priya Verma', 'CL', '2026-10-23', '2026-10-24', "Cousin's wedding in Varanasi"));
    await ok(await apply('Sneha Gupta', 'SL', '2026-11-03', '2026-11-03', 'Fever, doctor advised rest'));
    await ok(await apply('Amit Kumar', 'LOP', '2026-10-27', '2026-10-28', 'Personal work at home town'), 'No paid leave left this month');
    await ok(await apply('Rakesh Sharma', 'EL', '2026-10-12', '2026-10-14', 'Family trip to Nainital'));
    await ok(await apply('Mohd. Imran', 'CL', '2026-11-12', '2026-11-12', 'Bank work', true));
    await apply('Suresh Yadav', 'CL', '2026-11-18', '2026-11-20', "Daughter's school admission in Barabanki");
    await apply('Neha Joshi', 'CL', '2026-11-21', '2026-11-21', 'College exam', true);
    await apply('Mohd. Imran', 'CL', '2026-11-25', '2026-11-25', 'Going to Ajmer');
    const no = await apply('Vikas Singh', 'EL', '2026-12-01', '2026-12-05', 'Trip to Goa with friends');
    await time.decideLeave(ctx, no.id, { status: 'rejected', comment: 'Wedding season, all delivery staff needed. Please take it in January.' });
  });

  // ── Attendance for October and 1–14 November (leave days are already marked) ──
  await step('attendance register', async () => {
    const cfg = await setup.getConfig(ctx);
    const holidays = await db().holiday.findMany({ where: { tenantId } });
    const emps = await db().employee.findMany({ where: { tenantId } });
    const taken = new Set((await db().attendance.findMany({ where: { tenantId }, select: { employeeId: true, date: true } })).map((a) => `${a.employeeId}:${iso(a.date)}`));
    const shifts = await db().hrShift.findMany({ where: { tenantId } });
    const rows = [];
    const careless = new Set([E['Amit Kumar'], E['Vikas Singh'], E['Raju Pal']]);
    for (let d = '2026-10-01'; d <= '2026-11-14'; d = addDays(d, 1)) {
      if (!time.isWorkingDay(cfg, holidays, d)) continue;
      for (const e of emps) {
        if (iso(e.joinedOn) > d || (e.exitOn && iso(e.exitOn) < d) || taken.has(`${e.id}:${d}`)) continue;
        const s = shifts.find((x) => x.id === e.shiftId)!;
        const start = setup.toMinutes(s.startsAt);
        const r = roll(`${e.code}${d}`);
        const absent = careless.has(e.id) ? r < 6 : r < 2;
        const half = !absent && r >= 94;
        const late = !absent && !half && (careless.has(e.id) ? r < 25 : r < 10);
        const inAt = start - 12 + (r % 20) + (late ? s.graceMinutes + 15 + (r % 30) : 0);
        const outAt = half ? start + 240 + (r % 15) : start + setup.shiftMinutes(s) + s.breakMinutes + (r % 50) - 10;
        const worked = absent ? 0 : outAt - inAt - (half ? 0 : s.breakMinutes);
        rows.push({
          tenantId, employeeId: e.id, date: day(d), status: absent ? 'absent' : half ? 'half_day' : 'present', source: 'manual', createdBy: ctx.userId,
          clockIn: absent ? null : hhmm(inAt), clockOut: absent ? null : hhmm(outAt), workedMinutes: worked,
          lateMinutes: absent ? 0 : Math.max(0, inAt - start - s.graceMinutes), overtimeMinutes: absent || half ? 0 : Math.max(0, worked - setup.shiftMinutes(s)),
          notes: absent ? (r % 2 ? 'Informed in the morning' : 'No call, no show') : null,
        });
      }
    }
    await db().attendance.createMany({ data: rows, skipDuplicates: true });
    return rows.length;
  });

  // ── Overtime, loans and advances ──
  await step('overtime, loans and advances', async () => {
    const bank = (await fin.ensureFinance(ctx)).find((a) => a.kind === 'bank' && a.isActive) ?? (await fin.ensureFinance(ctx))[0];
    const cash = (await fin.ensureFinance(ctx)).find((a) => a.kind === 'cash') ?? bank;
    for (const [name, on, hours, rate, notes] of [['Suresh Yadav', '2026-10-18', 3, 14_500, 'Diwali stock unloading'], ['Raju Pal', '2026-10-25', 4, 15_000, 'Diwali stock unloading'], ['Mohd. Imran', '2026-11-07', 3.5, 12_500, 'Diwali rush, counter open till 22:00'], ['Vikas Singh', '2026-11-10', 2, 11_500, 'Late deliveries after Diwali']] as const) {
      await pay.saveOvertime(ctx, pay.OvertimeInput.parse({ employeeId: E[name], workOn: on, hours, ratePaise: rate, notes }));
    }
    await pay.createLoan(ctx, pay.LoanInput.parse({ employeeId: E['Vikas Singh'], title: 'Salary advance', kind: 'advance', amountPaise: 600_000, emiPaise: 200_000, givenOn: '2026-09-28', startsMonth: '2026-10', accountId: cash.id, reason: 'Bike repair' }));
    await pay.createLoan(ctx, pay.LoanInput.parse({ employeeId: E['Suresh Yadav'], title: 'Personal loan', kind: 'loan', amountPaise: 2_000_000, emiPaise: 250_000, givenOn: '2026-10-30', startsMonth: '2026-11', accountId: bank.id, reason: "Daughter's school fees" }));
    return bank.id;
  });

  // ── Payroll: September and October, processed and paid (two October payslips left unpaid) ──
  await step('payroll for September and October', async () => {
    const bank = (await fin.ensureFinance(ctx)).find((a) => a.kind === 'bank' && a.isActive)!;
    const sep = await pay.createRun(ctx, pay.RunInput.parse({ month: '2026-09', payDate: '2026-10-01', accountId: bank.id, notes: 'September salaries' }));
    await pay.processRun(ctx, sep.id);
    await pay.paySalaries(ctx, sep.id, pay.PayInput.parse({ paidOn: '2026-10-01', accountId: bank.id }));
    const oct = await pay.createRun(ctx, pay.RunInput.parse({ month: '2026-10', payDate: '2026-11-01', accountId: bank.id, notes: 'October salaries, Diwali bonus added' }));
    for (const s of oct.payslips.filter((p) => ['Priya Verma', 'Rakesh Sharma', 'Suresh Yadav'].includes(p.employee))) {
      await pay.adjustSlip(ctx, s.id, pay.AdjustInput.parse({ earnings: [{ name: 'Diwali bonus', amountPaise: s.employee === 'Priya Verma' ? 300_000 : 200_000 }] }));
    }
    await pay.processRun(ctx, oct.id);
    const unpaid = (await pay.getRun(ctx, oct.id)).payslips.filter((p) => ['Raju Pal', 'Vikas Singh'].includes(p.employee)).map((p) => p.id);
    const toPay = (await pay.getRun(ctx, oct.id)).payslips.filter((p) => !unpaid.includes(p.id)).map((p) => p.id);
    await pay.paySalaries(ctx, oct.id, pay.PayInput.parse({ payslipIds: toPay, paidOn: '2026-11-01', accountId: bank.id }));
  });

  // ── Workplace: announcements, events, documents and who has read them ──
  await step('announcements, events, documents', async () => {
    const post = (b: Record<string, unknown>) => people.savePost(ctx, people.PostInput.parse(b));
    await post({ kind: 'announcement', title: 'Diwali bonus paid with October salary', category: 'Celebration', priority: 'high', startsOn: '2026-11-01', endsOn: '2026-11-30', body: 'Everyone who worked through Diwali week gets a bonus with the October salary. Thank you for the record sales!' });
    await post({ kind: 'announcement', title: 'New billing counter timings from 1 December', category: 'General', startsOn: '2026-11-10', endsOn: '2026-12-15', body: 'Billing counter opens at 9:30 and closes at 21:00 during the wedding season. Cashiers will work in two shifts.', departmentIds: [ids.dept['Billing & Accounts']] });
    await post({ kind: 'announcement', title: 'Uniform must be worn on the shop floor', category: 'Policy', priority: 'normal', startsOn: '2026-11-14', body: 'From Monday, uniform and ID card are compulsory on the shop floor.' });
    await post({ kind: 'announcement', title: 'Year-end stock-taking plan', category: 'General', status: 'draft', body: 'Draft: stock-taking on 28–29 December, shop closed to customers.' });
    await post({ kind: 'event', title: 'Diwali puja at the shop', category: 'Celebration', startsOn: '2026-11-07', startsAt: '18:00', endsAt: '20:00', location: 'Main shop', body: 'Puja followed by dinner. Families welcome.' });
    await post({ kind: 'event', title: 'Monthly sales meeting', category: 'Meeting', startsOn: '2026-11-28', startsAt: '10:00', endsAt: '11:00', location: 'First floor', departmentIds: [ids.dept.Sales] });
    await post({ kind: 'event', title: 'Team outing to Chhota Imambara', category: 'Outing', startsOn: '2026-12-14', startsAt: '09:00', endsAt: '17:00', location: 'Old Lucknow' });
    const leavePolicy = await post({ kind: 'document', title: 'Leave policy 2026', category: 'Policy', startsOn: '2026-01-01', url: 'https://example.in/docs/leave-policy-2026.pdf', needsAck: true, body: '12 casual, 7 sick and 15 earned leave a year. Apply at least 3 days before.' });
    const handbook = await post({ kind: 'document', title: 'Employee handbook', category: 'Handbook', startsOn: '2025-04-01', url: 'https://example.in/docs/handbook.pdf', needsAck: true });
    await post({ kind: 'document', title: 'Uniform and ID card rules', category: 'Notice', startsOn: '2026-11-14', body: 'Blue shirt, black trousers, ID card on the left pocket.' });
    const current = await db().employee.findMany({ where: { tenantId, status: { not: 'exited' } }, select: { id: true } });
    await db().hrAck.createMany({ data: current.filter((_, i) => i % 3 !== 2).map((e) => ({ tenantId, postId: handbook.id, employeeId: e.id })), skipDuplicates: true });
    await db().hrAck.createMany({ data: current.filter((_, i) => i % 2 === 0).map((e) => ({ tenantId, postId: leavePolicy.id, employeeId: e.id })), skipDuplicates: true });
  });

  // ── Performance: goals and reviews ──
  await step('goals and reviews', async () => {
    const goal = (b: Record<string, unknown>) => people.saveGoal(ctx, people.GoalInput.parse(b));
    await goal({ employeeId: E['Priya Verma'], title: 'Sell ₹6 lakh in November', goalType: 'Sales target', target: '₹6,00,000', startsOn: '2026-11-01', endsOn: '2026-11-30', progress: 60 });
    await goal({ employeeId: E['Amit Kumar'], title: 'Learn the new billing software', goalType: 'Learning', target: 'Bill without help', startsOn: '2026-10-01', endsOn: '2026-10-31', progress: 100 });
    await goal({ employeeId: E['Vikas Singh'], title: 'Zero late deliveries', goalType: 'Customer', target: '0 complaints', startsOn: '2026-10-01', endsOn: '2026-10-31', progress: 40 });
    await goal({ employeeId: E['Sneha Gupta'], title: 'File GSTR-3B before the 15th every month', goalType: 'Quality', target: 'Before 15th', startsOn: '2026-11-01', endsOn: '2027-03-31', progress: 0 });
    await goal({ employeeId: E['Suresh Yadav'], title: 'Stock count matches books at year end', goalType: 'Quality', target: '100% match', startsOn: '2026-10-01', endsOn: '2027-03-31', progress: 35 });
    const cfg = await setup.getConfig(ctx);
    const areas = cfg.indicators.filter((i) => i.active).map((i) => i.name);
    const review = (b: Record<string, unknown>) => people.saveReview(ctx, people.ReviewInput.parse(b));
    const r1 = await review({ employeeId: E['Priya Verma'], reviewerId: E['Rakesh Sharma'], cycle: 'Quarterly', reviewOn: '2026-10-05' });
    await people.conductReview(ctx, r1.id, people.ConductInput.parse({ ratings: Object.fromEntries(areas.map((a, i) => [a, i % 3 ? 5 : 4])), strengths: 'Brings repeat customers, very patient with them.', improve: 'Update the stock register after each sale.' }));
    const r2 = await review({ employeeId: E['Sneha Gupta'], reviewerId: E['Rakesh Sharma'], cycle: 'Quarterly', reviewOn: '2026-10-06' });
    await people.conductReview(ctx, r2.id, people.ConductInput.parse({ ratings: Object.fromEntries(areas.map((a, i) => [a, i % 2 ? 4 : 3])), strengths: 'Accurate books, GST filed on time.', improve: 'Share reports with the manager every Monday.' }));
    await review({ employeeId: E['Amit Kumar'], reviewerId: E['Rakesh Sharma'], cycle: 'Quarterly', reviewOn: '2026-11-20' });
    await review({ employeeId: E['Neha Joshi'], reviewerId: E['Priya Verma'], cycle: 'Probation', reviewOn: '2026-10-30' });
  });

  // ── Recruitment: jobs, candidates in every stage, interviews, assessments, offers, onboarding ──
  await step('recruitment', async () => {
    const job = (b: Record<string, unknown>) => people.saveJob(ctx, people.JobInput.parse(b));
    const sales = await job({ title: 'Sales Executive', departmentId: ids.dept.Sales, location: 'Main shop', positions: 2, minExp: 1, maxExp: 4, minSalaryPaise: 1_200_000, maxSalaryPaise: 1_800_000, skills: ['Hindi', 'Customer handling', 'Billing'], closesOn: '2026-12-15', description: 'Help customers choose, bill and pack. 10:00–19:00, Sunday off.' });
    const acct = await job({ title: 'Junior Accountant', departmentId: ids.dept['Billing & Accounts'], location: 'Head office', minExp: 1, maxExp: 3, minSalaryPaise: 1_600_000, maxSalaryPaise: 2_200_000, skills: ['Tally', 'GST returns'], status: 'on_hold' });
    const del = await job({ title: 'Delivery Executive', departmentId: ids.dept.Delivery, location: 'Field', positions: 2, minExp: 0, maxExp: 5, minSalaryPaise: 1_100_000, maxSalaryPaise: 1_400_000, skills: ['Two-wheeler', 'Driving licence'], closesOn: '2026-11-30' });
    await job({ title: 'Store Keeper', departmentId: ids.dept.Warehouse, location: 'Warehouse', minExp: 2, status: 'closed' });
    const cand = (b: Record<string, unknown>) => people.saveCandidate(ctx, people.CandidateInput.parse(b));
    const C = {
      rohit: await cand({ jobId: sales.id, name: 'Rohit Tiwari', phone: '9935500101', source: 'Walk-in', experience: 2, currentCtcPaise: 1_300_000, expectedCtcPaise: 1_600_000, rating: 4 }),
      kavya: await cand({ jobId: sales.id, name: 'Kavya Srivastava', phone: '9935500102', email: 'kavya.s@example.in', source: 'Referral', experience: 3, currentCtcPaise: 1_500_000, expectedCtcPaise: 1_750_000, rating: 5 }),
      pooja: await cand({ jobId: sales.id, name: 'Pooja Rani', phone: '9935500103', source: 'Job portal', experience: 1.5, expectedCtcPaise: 1_400_000, rating: 4 }),
      sanjay: await cand({ jobId: sales.id, name: 'Sanjay Maurya', phone: '9935500104', source: 'Social media', experience: 0.5, expectedCtcPaise: 1_200_000 }),
      farhan: await cand({ jobId: del.id, name: 'Farhan Ali', phone: '9935500105', source: 'Walk-in', experience: 3, expectedCtcPaise: 1_300_000, rating: 3 }),
      gopal: await cand({ jobId: del.id, name: 'Gopal Nishad', phone: '9935500106', source: 'Referral', experience: 1, expectedCtcPaise: 1_150_000 }),
      ritu: await cand({ jobId: acct.id, name: 'Ritu Agarwal', phone: '9935500107', email: 'ritu.agarwal@example.in', source: 'Consultant', experience: 2, currentCtcPaise: 1_700_000, expectedCtcPaise: 2_000_000, rating: 4 }),
      manoj: await cand({ jobId: del.id, name: 'Manoj Kushwaha', phone: '9935500108', source: 'Walk-in', experience: 0 }),
      shreya: await cand({ jobId: sales.id, name: 'Shreya Dubey', phone: '9935500109', source: 'Job portal', experience: 1, expectedCtcPaise: 1_350_000 }),
    };
    await people.setStage(ctx, C.sanjay.id, 'screening');
    await people.setStage(ctx, C.ritu.id, 'screening');
    const iv = (b: Record<string, unknown>) => people.saveInterview(ctx, people.InterviewInput.parse(b));
    const i1 = await iv({ candidateId: C.kavya.id, round: 'HR round', onDate: '2026-11-06', atTime: '11:00', interviewerIds: [E['Rakesh Sharma']] });
    await people.interviewResult(ctx, i1.id, people.ResultInput.parse({ result: 'passed', rating: 5, feedback: 'Confident, knows sarees and lehengas well.' }));
    const i2 = await iv({ candidateId: C.pooja.id, round: 'HR round', onDate: '2026-11-07', atTime: '12:00', interviewerIds: [E['Rakesh Sharma']] });
    await people.interviewResult(ctx, i2.id, people.ResultInput.parse({ result: 'passed', rating: 4, feedback: 'Good with customers, can start this month.' }));
    const i3 = await iv({ candidateId: C.farhan.id, round: 'Practical test', onDate: '2026-11-13', atTime: '10:30', mode: 'in_person', interviewerIds: [E['Suresh Yadav']] });
    await people.interviewResult(ctx, i3.id, people.ResultInput.parse({ result: 'passed', rating: 3, feedback: 'Knows the city routes, bike in good shape.' }));
    await iv({ candidateId: C.rohit.id, round: 'HR round', onDate: '2026-11-18', atTime: '11:30', interviewerIds: [E['Rakesh Sharma'], E['Priya Verma']] });
    await iv({ candidateId: C.gopal.id, round: 'Phone screening', onDate: '2026-11-17', atTime: '16:00', mode: 'phone' });
    const i6 = await iv({ candidateId: C.manoj.id, round: 'Practical test', onDate: '2026-11-04', atTime: '10:00', interviewerIds: [E['Suresh Yadav']] });
    await people.interviewResult(ctx, i6.id, people.ResultInput.parse({ result: 'failed', rating: 2, feedback: 'No driving licence yet.' }));
    await people.setStage(ctx, C.manoj.id, 'rejected');
    const as = (b: Record<string, unknown>) => rec.createRecord(ctx, 'assessment', b);
    const a1 = await as({ candidateId: C.kavya.id, title: 'Practical task', onDate: '2026-11-06', conductedById: E['Priya Verma'], score: 9, maxScore: 10, remarks: 'Billed 5 items in 3 minutes, no mistakes.' });
    await rec.setRecordStatus(ctx, a1.id, 'passed');
    const a2 = await as({ candidateId: C.farhan.id, title: 'Practical task', onDate: '2026-11-13', conductedById: E['Vikas Singh'], score: 6, maxScore: 10, remarks: 'Found 4 of 5 addresses on time.' });
    await rec.setRecordStatus(ctx, a2.id, 'passed');
    await as({ candidateId: C.rohit.id, title: 'Aptitude test', onDate: '2026-11-18', maxScore: 20 });
    await as({ candidateId: C.ritu.id, title: 'Technical test', onDate: '2026-11-19', maxScore: 50, remarks: 'Tally and GST questions' });
    const offer = (b: Record<string, unknown>) => rec.createRecord(ctx, 'offer', b);
    const o1 = await offer({ candidateId: C.pooja.id, position: 'Sales Executive', departmentId: ids.dept.Sales, designationId: ids.desig['Sales Executive'], salaryPaise: 1_400_000, joiningOn: '2026-11-20', expiresOn: '2026-11-17', benefits: 'PF, ESI, Diwali bonus' });
    await rec.setRecordStatus(ctx, o1.id, 'sent');
    await rec.setRecordStatus(ctx, o1.id, 'accepted');
    await rec.convertOffer(ctx, o1.id);
    const o2 = await offer({ candidateId: C.kavya.id, position: 'Senior Sales Executive', departmentId: ids.dept.Sales, designationId: ids.desig['Senior Sales Executive'], salaryPaise: 1_750_000, joiningOn: '2026-12-01', expiresOn: '2026-11-22', benefits: 'PF, ESI, sales incentive' });
    await rec.setRecordStatus(ctx, o2.id, 'sent');
    const o3 = await offer({ candidateId: C.farhan.id, position: 'Delivery Executive', departmentId: ids.dept.Delivery, designationId: ids.desig['Delivery Executive'], salaryPaise: 1_200_000, joiningOn: '2026-11-25', benefits: 'ESI, fuel allowance' });
    await rec.setRecordStatus(ctx, o3.id, 'sent');
    await rec.setRecordStatus(ctx, o3.id, 'declined');
    await offer({ candidateId: C.shreya.id, position: 'Sales Executive', departmentId: ids.dept.Sales, salaryPaise: 1_300_000, joiningOn: '2026-12-05', notes: 'Waiting for manager to approve' });
    const list = await rec.createRecord(ctx, 'checklist', { name: 'Shop staff joining', isDefault: true, items: [
      { task: 'Collect PAN, Aadhaar and bank details', category: 'Documents', dueDay: 0 },
      { task: 'Give uniform and ID card', category: 'Workplace', dueDay: 0 },
      { task: 'Add to the billing software', category: 'IT setup', dueDay: 1 },
      { task: 'Product training with a senior', category: 'Training', dueDay: 2 },
      { task: 'Explain leave and attendance rules', category: 'HR', dueDay: 3 },
      { task: 'Lunch with the team', category: 'Workplace', dueDay: 5, required: false },
    ] });
    await rec.createRecord(ctx, 'checklist', { name: 'Delivery staff joining', items: [
      { task: 'Check driving licence and RC', category: 'Documents', dueDay: 0 },
      { task: 'Ride along on two routes', category: 'Training', dueDay: 1 },
      { task: 'Add to the delivery WhatsApp group', category: 'IT setup', dueDay: 1 },
    ] });
    const ob = await rec.createRecord(ctx, 'onboarding', { candidateId: C.pooja.id, checklistId: list.id, startOn: '2026-11-20', buddyId: E['Priya Verma'], notes: 'Starts on the sarees counter' });
    const tasks = (ob.data as { tasks: { id: string }[] }).tasks;
    await rec.toggleTask(ctx, ob.id, tasks[0].id, true);
    await rec.toggleTask(ctx, ob.id, tasks[1].id, true);
  });

  const counts = await withPlatform(() => prisma.$queryRaw<{ t: string; n: bigint }[]>`
    select 'employees' t, count(*) n from employees where tenant_id = ${tenantId}::uuid union all
    select 'attendance', count(*) from attendance where tenant_id = ${tenantId}::uuid union all
    select 'leave', count(*) from leave_applications where tenant_id = ${tenantId}::uuid union all
    select 'payslips', count(*) from payslips where tenant_id = ${tenantId}::uuid union all
    select 'career', count(*) from hr_actions where tenant_id = ${tenantId}::uuid union all
    select 'candidates', count(*) from hr_candidates where tenant_id = ${tenantId}::uuid`);
  console.log('  =', counts.map((c) => `${c.t} ${c.n}`).join(' · '));
}

async function main() {
  const tenants = process.argv.slice(2);
  if (!tenants.length) throw new Error('Usage: npx tsx prisma/demo-hr.ts <tenantId> [...]');
  for (const id of tenants) await seed(id);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
