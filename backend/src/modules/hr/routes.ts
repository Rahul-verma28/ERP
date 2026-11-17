import { Router } from 'express';
import { z } from 'zod';
import { DateStr, IdParam } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { requirePermission, tenantAuth, tx } from '../../middleware/auth';
import * as setup from './setup';
import * as emp from './employees';
import * as time from './time';
import * as pay from './payroll';
import * as people from './people';
import { hrDashboard } from './dashboard';
import * as rec from './records';

// HR & Payroll API.

const router = Router();
router.use(tenantAuth);
const P = requirePermission;
const id = (req: { params: Record<string, string | string[]> }) => String(req.params.id);
const Month = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') });
type Q = Record<string, string | undefined>;

// ── Dashboard and lookups ──
router.get('/hr/dashboard', P('hr.employee.view'), tx(async (req, res) => { res.json(await hrDashboard(req.ctx!)); }));
router.get('/hr/lookups', P('hr.employee.view'), tx(async (req, res) => {
  const [cfg, departments, designations, shifts, leaveTypes] = await Promise.all([setup.getConfig(req.ctx!), setup.listDepartments(req.ctx!), setup.listDesignations(req.ctx!), setup.listShifts(req.ctx!), setup.listLeaveTypes(req.ctx!)]);
  res.json({ config: cfg, departments, designations, shifts, leaveTypes });
}));

// ── Setup ──
router.get('/hr/settings', P('hr.setup.view'), tx(async (req, res) => { res.json(await setup.getConfig(req.ctx!)); }));
router.patch('/hr/settings', P('hr.setup.edit'), validate(setup.ConfigPatch), tx(async (req, res) => { res.json(await setup.updateConfig(req.ctx!, req.body)); }));
router.get('/hr/departments', P('hr.employee.view'), tx(async (req, res) => { res.json({ data: await setup.listDepartments(req.ctx!) }); }));
router.post('/hr/departments', P('hr.setup.edit'), validate(setup.DepartmentInput), tx(async (req, res) => { res.status(201).json(await setup.saveDepartment(req.ctx!, req.body)); }));
router.put('/hr/departments/:id', P('hr.setup.edit'), validate(IdParam, 'params'), validate(setup.DepartmentInput), tx(async (req, res) => { res.json(await setup.saveDepartment(req.ctx!, req.body, id(req))); }));
router.delete('/hr/departments/:id', P('hr.setup.edit'), validate(IdParam, 'params'), tx(async (req, res) => { await setup.deleteDepartment(req.ctx!, id(req)); res.status(204).end(); }));
router.get('/hr/designations', P('hr.employee.view'), tx(async (req, res) => { res.json({ data: await setup.listDesignations(req.ctx!) }); }));
router.post('/hr/designations', P('hr.setup.edit'), validate(setup.DesignationInput), tx(async (req, res) => { res.status(201).json(await setup.saveDesignation(req.ctx!, req.body)); }));
router.put('/hr/designations/:id', P('hr.setup.edit'), validate(IdParam, 'params'), validate(setup.DesignationInput), tx(async (req, res) => { res.json(await setup.saveDesignation(req.ctx!, req.body, id(req))); }));
router.delete('/hr/designations/:id', P('hr.setup.edit'), validate(IdParam, 'params'), tx(async (req, res) => { await setup.deleteDesignation(req.ctx!, id(req)); res.status(204).end(); }));
router.get('/hr/shifts', P('hr.attendance.view'), tx(async (req, res) => { res.json({ data: await setup.listShifts(req.ctx!) }); }));
router.post('/hr/shifts', P('hr.shift.create'), validate(setup.ShiftInput), tx(async (req, res) => { res.status(201).json(await setup.saveShift(req.ctx!, req.body)); }));
router.put('/hr/shifts/:id', P('hr.shift.edit'), validate(IdParam, 'params'), validate(setup.ShiftInput), tx(async (req, res) => { res.json(await setup.saveShift(req.ctx!, req.body, id(req))); }));
router.delete('/hr/shifts/:id', P('hr.shift.delete'), validate(IdParam, 'params'), tx(async (req, res) => { await setup.deleteShift(req.ctx!, id(req)); res.status(204).end(); }));
router.get('/hr/leave-types', P('hr.leave.view'), tx(async (req, res) => { res.json({ data: await setup.listLeaveTypes(req.ctx!) }); }));
router.post('/hr/leave-types', P('hr.setup.edit'), validate(setup.LeaveTypeInput), tx(async (req, res) => { res.status(201).json(await setup.saveLeaveType(req.ctx!, req.body)); }));
router.put('/hr/leave-types/:id', P('hr.setup.edit'), validate(IdParam, 'params'), validate(setup.LeaveTypeInput), tx(async (req, res) => { res.json(await setup.saveLeaveType(req.ctx!, req.body, id(req))); }));
router.delete('/hr/leave-types/:id', P('hr.setup.edit'), validate(IdParam, 'params'), tx(async (req, res) => { await setup.deleteLeaveType(req.ctx!, id(req)); res.status(204).end(); }));
router.get('/hr/holidays', P('hr.leave.view'), validate(z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }), 'query'), tx(async (req, res) => { res.json({ data: await setup.listHolidays(req.ctx!, (req.query as unknown as { year?: number }).year) }); }));
router.post('/hr/holidays', P('hr.setup.edit'), validate(setup.HolidayInput), tx(async (req, res) => { res.status(201).json(await setup.saveHoliday(req.ctx!, req.body)); }));
router.put('/hr/holidays/:id', P('hr.setup.edit'), validate(IdParam, 'params'), validate(setup.HolidayInput), tx(async (req, res) => { res.json(await setup.saveHoliday(req.ctx!, req.body, id(req))); }));
router.delete('/hr/holidays/:id', P('hr.setup.edit'), validate(IdParam, 'params'), tx(async (req, res) => { await setup.deleteHoliday(req.ctx!, id(req)); res.status(204).end(); }));

// ── Employees ──
router.get('/hr/employees', P('hr.employee.view'), validate(emp.EmployeeList, 'query'), tx(async (req, res) => { res.json(await emp.listEmployees(req.ctx!, req.query as z.infer<typeof emp.EmployeeList>)); }));
router.get('/hr/employee-counts', P('hr.employee.view'), tx(async (req, res) => { res.json((await emp.listEmployees(req.ctx!, {})).counts); }));
router.get('/hr/employees/:id', P('hr.employee.view'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await emp.getEmployee(req.ctx!, id(req))); }));
router.post('/hr/employees', P('hr.employee.create'), validate(emp.EmployeeInput), tx(async (req, res) => { res.status(201).json(await emp.createEmployee(req.ctx!, req.body)); }));
router.put('/hr/employees/:id', P('hr.employee.edit'), validate(IdParam, 'params'), validate(emp.EmployeeInput.extend({ version: z.number().int() })), tx(async (req, res) => {
  const { version, ...b } = req.body;
  res.json(await emp.updateEmployee(req.ctx!, id(req), b, version));
}));
router.post('/hr/employees/:id/exit', P('hr.employee.edit'), validate(IdParam, 'params'), validate(emp.ExitInput), tx(async (req, res) => { res.json(await emp.exitEmployee(req.ctx!, id(req), req.body)); }));
router.post('/hr/employees/:id/rejoin', P('hr.employee.edit'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await emp.rejoinEmployee(req.ctx!, id(req))); }));
router.delete('/hr/employees/:id', P('hr.employee.delete'), validate(IdParam, 'params'), tx(async (req, res) => { await emp.deleteEmployee(req.ctx!, id(req)); res.status(204).end(); }));
router.put('/hr/employees/:id/salary', P('hr.payroll.create'), validate(IdParam, 'params'), validate(emp.SalaryInput), tx(async (req, res) => { res.json(await emp.setSalary(req.ctx!, id(req), req.body)); }));
router.get('/hr/employees/:id/payslips', P('hr.payslip.view'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await pay.employeePayslips(req.ctx!, id(req))); }));
router.get('/hr/salaries', P('hr.payroll.view'), tx(async (req, res) => { res.json(await emp.salaryList(req.ctx!)); }));

// ── Attendance ──
router.get('/hr/attendance/day', P('hr.attendance.view'), validate(z.object({ date: DateStr }), 'query'), tx(async (req, res) => { res.json(await time.dayView(req.ctx!, String(req.query.date))); }));
router.get('/hr/attendance/month', P('hr.attendance.view'), validate(Month.extend({ employeeId: z.string().uuid().optional() }), 'query'), tx(async (req, res) => { const q = req.query as Q; res.json(await time.monthView(req.ctx!, q.month!, q.employeeId)); }));
router.post('/hr/attendance', P('hr.attendance.edit'), validate(time.MarkInput), tx(async (req, res) => { res.json(await time.markAttendance(req.ctx!, req.body)); }));
router.delete('/hr/attendance', P('hr.attendance.edit'), validate(z.object({ employeeId: z.string().uuid(), date: DateStr }), 'query'), tx(async (req, res) => { const q = req.query as Q; await time.clearAttendance(req.ctx!, q.employeeId!, q.date!); res.status(204).end(); }));
router.get('/hr/me', tx(async (req, res) => { res.json(await time.myToday(req.ctx!)); }));
router.post('/hr/me/clock', P('hr.attendance.create'), validate(z.object({ action: z.enum(['in', 'out']) })), tx(async (req, res) => { res.json(await time.clock(req.ctx!, req.body.action)); }));

// ── Leave ──
router.get('/hr/leave-week', P('hr.leave.view'), validate(z.object({ start: DateStr }), 'query'), tx(async (req, res) => { res.json(await time.leaveWeek(req.ctx!, (req.query as { start: string }).start)); }));
router.get('/hr/leaves', P('hr.leave.view'), validate(time.LeaveList, 'query'), tx(async (req, res) => { res.json(await time.listLeaves(req.ctx!, req.query as z.infer<typeof time.LeaveList>)); }));
router.get('/hr/leave-balances', P('hr.leave.view'), validate(z.object({ employeeId: z.string().uuid().optional(), date: DateStr.optional() }), 'query'), tx(async (req, res) => { res.json(await time.balances(req.ctx!, req.query as Q)); }));
router.post('/hr/leaves', P('hr.leave.create'), validate(time.LeaveInput), tx(async (req, res) => { res.status(201).json(await time.applyLeave(req.ctx!, req.body)); }));
router.put('/hr/leaves/:id', P('hr.leave.create'), validate(IdParam, 'params'), validate(z.intersection(time.LeaveInput, z.object({ version: z.number().int() }))), tx(async (req, res) => {
  const { version, ...b } = req.body;
  res.json(await time.updateLeave(req.ctx!, id(req), b, version));
}));
router.post('/hr/leaves/:id/decide', P('hr.leave.approve'), validate(IdParam, 'params'), validate(time.DecideInput), tx(async (req, res) => { res.json(await time.decideLeave(req.ctx!, id(req), req.body)); }));
router.post('/hr/leaves/:id/cancel', P('hr.leave.create'), validate(IdParam, 'params'), tx(async (req, res) => { await time.cancelLeave(req.ctx!, id(req)); res.status(204).end(); }));
router.delete('/hr/leaves/:id', P('hr.leave.create'), validate(IdParam, 'params'), tx(async (req, res) => { await time.deleteLeave(req.ctx!, id(req)); res.status(204).end(); }));

// ── Payroll ──
router.get('/hr/payroll', P('hr.payroll.view'), validate(z.object({ year: z.string().regex(/^\d{4}$/).optional() }), 'query'), tx(async (req, res) => { res.json(await pay.listRuns(req.ctx!, (req.query as Q).year)); }));
router.post('/hr/payroll', P('hr.payroll.create'), validate(pay.RunInput), tx(async (req, res) => { res.status(201).json(await pay.createRun(req.ctx!, req.body)); }));
router.get('/hr/payroll/:id', P('hr.payroll.view'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await pay.getRun(req.ctx!, id(req))); }));
router.post('/hr/payroll/:id/recalculate', P('hr.payroll.create'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await pay.recalculate(req.ctx!, id(req))); }));
router.post('/hr/payroll/:id/process', P('hr.payroll.approve'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await pay.processRun(req.ctx!, id(req))); }));
router.post('/hr/payroll/:id/reopen', P('hr.payroll.approve'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await pay.reopenRun(req.ctx!, id(req))); }));
router.post('/hr/payroll/:id/pay', P('hr.payroll.approve'), validate(IdParam, 'params'), validate(pay.PayInput), tx(async (req, res) => { res.json(await pay.paySalaries(req.ctx!, id(req), req.body)); }));
router.delete('/hr/payroll/:id', P('hr.payroll.create'), validate(IdParam, 'params'), tx(async (req, res) => { await pay.deleteRun(req.ctx!, id(req)); res.status(204).end(); }));
router.get('/hr/payslips/mine', P('hr.payslip.view'), tx(async (req, res) => { res.json(await pay.employeePayslips(req.ctx!)); }));
router.get('/hr/payslips/:id', P('hr.payslip.view'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await pay.getPayslip(req.ctx!, id(req))); }));
router.put('/hr/payslips/:id/adjust', P('hr.payroll.create'), validate(IdParam, 'params'), validate(pay.AdjustInput), tx(async (req, res) => { res.json(await pay.adjustSlip(req.ctx!, id(req), req.body)); }));
router.post('/hr/payslips/:id/undo-payment', P('hr.payroll.approve'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await pay.undoPayment(req.ctx!, id(req))); }));
router.delete('/hr/payslips/:id', P('hr.payroll.create'), validate(IdParam, 'params'), tx(async (req, res) => { await pay.removeSlip(req.ctx!, id(req)); res.status(204).end(); }));
router.get('/hr/loans', P('hr.payroll.view'), validate(z.object({ employeeId: z.string().uuid().optional() }), 'query'), tx(async (req, res) => { res.json(await pay.listLoans(req.ctx!, (req.query as Q).employeeId)); }));
router.post('/hr/loans', P('hr.payroll.create'), validate(pay.LoanInput), tx(async (req, res) => { res.status(201).json(await pay.createLoan(req.ctx!, req.body)); }));
router.post('/hr/loans/:id/status', P('hr.payroll.create'), validate(IdParam, 'params'), validate(z.object({ status: z.enum(['active', 'closed']) })), tx(async (req, res) => { res.json(await pay.closeLoan(req.ctx!, id(req), req.body.status)); }));
router.delete('/hr/loans/:id', P('hr.payroll.create'), validate(IdParam, 'params'), tx(async (req, res) => { await pay.deleteLoan(req.ctx!, id(req)); res.status(204).end(); }));
router.get('/hr/overtime', P('hr.payroll.view'), validate(Month.partial().extend({ employeeId: z.string().uuid().optional() }), 'query'), tx(async (req, res) => { const q = req.query as Q; res.json(await pay.listOvertime(req.ctx!, q.month, q.employeeId)); }));
router.post('/hr/overtime', P('hr.payroll.create'), validate(pay.OvertimeInput), tx(async (req, res) => { res.status(201).json(await pay.saveOvertime(req.ctx!, req.body)); }));
router.put('/hr/overtime/:id', P('hr.payroll.create'), validate(IdParam, 'params'), validate(pay.OvertimeInput), tx(async (req, res) => { res.json(await pay.saveOvertime(req.ctx!, req.body, id(req))); }));
router.delete('/hr/overtime/:id', P('hr.payroll.create'), validate(IdParam, 'params'), tx(async (req, res) => { await pay.deleteOvertime(req.ctx!, id(req)); res.status(204).end(); }));

// ── Career and conduct ──
router.get('/hr/actions', P('hr.career.view'), validate(z.object({ kind: z.enum(people.ACTION_KINDS).optional(), employeeId: z.string().uuid().optional(), status: z.string().max(20).optional() }), 'query'), tx(async (req, res) => { res.json(await people.listActions(req.ctx!, req.query as never)); }));
router.get('/hr/actions/:id', P('hr.career.view'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await people.getAction(req.ctx!, id(req))); }));
router.post('/hr/actions', P('hr.career.create'), validate(people.ActionInput), tx(async (req, res) => { res.status(201).json(await people.createAction(req.ctx!, req.body)); }));
router.put('/hr/actions/:id', P('hr.career.edit'), validate(IdParam, 'params'), validate(people.ActionInput.extend({ version: z.number().int() })), tx(async (req, res) => {
  const { version, ...b } = req.body;
  res.json(await people.updateAction(req.ctx!, id(req), b, version));
}));
router.post('/hr/actions/:id/status', P('hr.career.approve'), validate(IdParam, 'params'), validate(people.ActionStatusInput), tx(async (req, res) => { res.json(await people.setActionStatus(req.ctx!, id(req), req.body)); }));
router.delete('/hr/actions/:id', P('hr.career.delete'), validate(IdParam, 'params'), tx(async (req, res) => { await people.deleteAction(req.ctx!, id(req)); res.status(204).end(); }));

// ── Workplace ──
router.get('/hr/posts', P('hr.workplace.view'), validate(z.object({ kind: z.enum(people.POST_KINDS) }), 'query'), tx(async (req, res) => { res.json(await people.listPosts(req.ctx!, (req.query as { kind: 'announcement' }).kind)); }));
router.post('/hr/posts', P('hr.workplace.create'), validate(people.PostInput), tx(async (req, res) => { res.status(201).json(await people.savePost(req.ctx!, req.body)); }));
router.put('/hr/posts/:id', P('hr.workplace.edit'), validate(IdParam, 'params'), validate(people.PostInput), tx(async (req, res) => { res.json(await people.savePost(req.ctx!, req.body, id(req))); }));
router.delete('/hr/posts/:id', P('hr.workplace.delete'), validate(IdParam, 'params'), tx(async (req, res) => { await people.deletePost(req.ctx!, id(req)); res.status(204).end(); }));
router.post('/hr/posts/:id/status', P('hr.workplace.edit'), validate(IdParam, 'params'), validate(people.PostStatusInput), tx(async (req, res) => { res.json(await people.setPostStatus(req.ctx!, id(req), req.body.status)); }));
router.post('/hr/posts/:id/ack-for', P('hr.workplace.edit'), validate(IdParam, 'params'), validate(people.AckForInput), tx(async (req, res) => { res.json(await people.acknowledgeFor(req.ctx!, id(req), req.body)); }));
router.post('/hr/posts/:id/ack', P('hr.workplace.view'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await people.acknowledge(req.ctx!, id(req))); }));
router.get('/hr/posts/:id/acks', P('hr.workplace.edit'), validate(IdParam, 'params'), tx(async (req, res) => { res.json(await people.ackList(req.ctx!, id(req))); }));

// ── Performance ──
router.get('/hr/goals', P('hr.performance.view'), tx(async (req, res) => { res.json(await people.listGoals(req.ctx!)); }));
router.post('/hr/goals', P('hr.performance.create'), validate(people.GoalInput), tx(async (req, res) => { res.status(201).json(await people.saveGoal(req.ctx!, req.body)); }));
router.put('/hr/goals/:id', P('hr.performance.edit'), validate(IdParam, 'params'), validate(people.GoalInput), tx(async (req, res) => { res.json(await people.saveGoal(req.ctx!, req.body, id(req))); }));
router.post('/hr/goals/:id/progress', P('hr.performance.edit'), validate(IdParam, 'params'), validate(z.object({ progress: z.number().int().min(0).max(100) })), tx(async (req, res) => { res.json(await people.setGoalProgress(req.ctx!, id(req), req.body.progress)); }));
router.delete('/hr/goals/:id', P('hr.performance.delete'), validate(IdParam, 'params'), tx(async (req, res) => { await people.deleteSimple(req.ctx!, 'hrGoal', id(req)); res.status(204).end(); }));
router.get('/hr/reviews', P('hr.performance.view'), tx(async (req, res) => { res.json(await people.listReviews(req.ctx!)); }));
router.post('/hr/reviews', P('hr.performance.create'), validate(people.ReviewInput), tx(async (req, res) => { res.status(201).json(await people.saveReview(req.ctx!, req.body)); }));
router.put('/hr/reviews/:id', P('hr.performance.edit'), validate(IdParam, 'params'), validate(people.ReviewInput), tx(async (req, res) => { res.json(await people.saveReview(req.ctx!, req.body, id(req))); }));
router.post('/hr/reviews/:id/conduct', P('hr.performance.edit'), validate(IdParam, 'params'), validate(people.ConductInput), tx(async (req, res) => { res.json(await people.conductReview(req.ctx!, id(req), req.body)); }));
router.delete('/hr/reviews/:id', P('hr.performance.delete'), validate(IdParam, 'params'), tx(async (req, res) => { await people.deleteSimple(req.ctx!, 'hrReview', id(req)); res.status(204).end(); }));

// ── Training ──
router.get('/hr/trainings', P('hr.training.view'), tx(async (req, res) => { res.json(await people.listTrainings(req.ctx!)); }));
router.post('/hr/trainings', P('hr.training.create'), validate(people.TrainingInput), tx(async (req, res) => { res.status(201).json(await people.saveTraining(req.ctx!, req.body)); }));
router.put('/hr/trainings/:id', P('hr.training.edit'), validate(IdParam, 'params'), validate(people.TrainingInput), tx(async (req, res) => { res.json(await people.saveTraining(req.ctx!, req.body, id(req))); }));
router.delete('/hr/trainings/:id', P('hr.training.delete'), validate(IdParam, 'params'), tx(async (req, res) => { await people.deleteSimple(req.ctx!, 'hrTraining', id(req)); res.status(204).end(); }));

// ── Recruitment ──
router.get('/hr/jobs', P('hr.recruitment.view'), tx(async (req, res) => { res.json(await people.listJobs(req.ctx!)); }));
router.post('/hr/jobs', P('hr.recruitment.create'), validate(people.JobInput), tx(async (req, res) => { res.status(201).json(await people.saveJob(req.ctx!, req.body)); }));
router.put('/hr/jobs/:id', P('hr.recruitment.edit'), validate(IdParam, 'params'), validate(people.JobInput), tx(async (req, res) => { res.json(await people.saveJob(req.ctx!, req.body, id(req))); }));
router.delete('/hr/jobs/:id', P('hr.recruitment.delete'), validate(IdParam, 'params'), tx(async (req, res) => { await people.deleteJob(req.ctx!, id(req)); res.status(204).end(); }));
router.get('/hr/candidates', P('hr.recruitment.view'), validate(z.object({ jobId: z.string().uuid().optional() }), 'query'), tx(async (req, res) => { res.json(await people.listCandidates(req.ctx!, (req.query as Q).jobId)); }));
router.post('/hr/candidates', P('hr.recruitment.create'), validate(people.CandidateInput), tx(async (req, res) => { res.status(201).json(await people.saveCandidate(req.ctx!, req.body)); }));
router.put('/hr/candidates/:id', P('hr.recruitment.edit'), validate(IdParam, 'params'), validate(people.CandidateInput), tx(async (req, res) => { res.json(await people.saveCandidate(req.ctx!, req.body, id(req))); }));
router.post('/hr/candidates/:id/stage', P('hr.recruitment.edit'), validate(IdParam, 'params'), validate(z.object({ stage: z.enum(people.STAGES) })), tx(async (req, res) => { res.json(await people.setStage(req.ctx!, id(req), req.body.stage)); }));
router.post('/hr/candidates/:id/hire', P('hr.employee.create'), validate(IdParam, 'params'), validate(people.HireInput), tx(async (req, res) => { res.json(await people.hireCandidate(req.ctx!, id(req), req.body)); }));
router.delete('/hr/candidates/:id', P('hr.recruitment.delete'), validate(IdParam, 'params'), tx(async (req, res) => { await people.deleteCandidate(req.ctx!, id(req)); res.status(204).end(); }));
router.get('/hr/interviews', P('hr.recruitment.view'), tx(async (req, res) => { res.json(await people.listInterviews(req.ctx!)); }));
router.post('/hr/interviews', P('hr.recruitment.create'), validate(people.InterviewInput), tx(async (req, res) => { res.status(201).json(await people.saveInterview(req.ctx!, req.body)); }));
router.put('/hr/interviews/:id', P('hr.recruitment.edit'), validate(IdParam, 'params'), validate(people.InterviewInput), tx(async (req, res) => { res.json(await people.saveInterview(req.ctx!, req.body, id(req))); }));
router.post('/hr/interviews/:id/result', P('hr.recruitment.edit'), validate(IdParam, 'params'), validate(people.ResultInput), tx(async (req, res) => { res.json(await people.interviewResult(req.ctx!, id(req), req.body)); }));
router.delete('/hr/interviews/:id', P('hr.recruitment.delete'), validate(IdParam, 'params'), tx(async (req, res) => { await people.deleteSimple(req.ctx!, 'hrInterview', id(req)); res.status(204).end(); }));

// ── Trainers, assessments, offers, checklists, onboardings ──
const RECORD_PERM: Record<rec.RecordKind, string> = { emp_doc: 'hr.employee', trainer: 'hr.training', assessment: 'hr.recruitment', offer: 'hr.recruitment', checklist: 'hr.recruitment', onboarding: 'hr.recruitment' };
const recPerm = (action: 'view' | 'create' | 'edit' | 'delete') => async (req: Parameters<ReturnType<typeof P>>[0], res: Parameters<ReturnType<typeof P>>[1], next: Parameters<ReturnType<typeof P>>[2]) => {
  const kind = (req.params.kind ?? req.body?.kind ?? req.query.kind) as rec.RecordKind | undefined;
  if (!kind || !(kind in RECORD_PERM)) return next();
  return P(`${RECORD_PERM[kind]}.${action}`)(req, res, next);
};
const Kind = validate(z.object({ kind: z.enum(rec.RECORD_KINDS) }), 'params');
router.get('/hr/records/:kind', Kind, recPerm('view'), tx(async (req, res) => { res.json(await rec.listRecords(req.ctx!, req.params.kind as rec.RecordKind, typeof req.query.refId === 'string' && /^[0-9a-f-]{36}$/.test(req.query.refId) ? req.query.refId : undefined)); }));
router.post('/hr/records/:kind', Kind, recPerm('create'), tx(async (req, res) => { res.status(201).json(await rec.createRecord(req.ctx!, req.params.kind as rec.RecordKind, req.body)); }));
router.put('/hr/records/:kind/:id', Kind, recPerm('edit'), tx(async (req, res) => {
  const { version, ...b } = req.body as { version: number };
  res.json(await rec.updateRecord(req.ctx!, String(req.params.id), b, Number(version)));
}));
router.post('/hr/records/:kind/:id/status', Kind, recPerm('edit'), validate(rec.StatusInput), tx(async (req, res) => { res.json(await rec.setRecordStatus(req.ctx!, String(req.params.id), req.body.status)); }));
router.post('/hr/records/:kind/:id/convert', Kind, P('hr.employee.create'), tx(async (req, res) => { res.json(await rec.convertOffer(req.ctx!, String(req.params.id))); }));
router.post('/hr/records/:kind/:id/task', Kind, recPerm('edit'), validate(z.object({ taskId: z.string().min(1).max(60), done: z.boolean() })), tx(async (req, res) => { res.json(await rec.toggleTask(req.ctx!, String(req.params.id), req.body.taskId, req.body.done)); }));
router.delete('/hr/records/:kind/:id', Kind, recPerm('delete'), tx(async (req, res) => { await rec.deleteRecord(req.ctx!, String(req.params.id)); res.status(204).end(); }));
router.get('/hr/payslips', P('hr.payslip.view'), validate(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), status: z.enum(['paid', 'unpaid']).optional(), employeeId: z.string().uuid().optional() }), 'query'), tx(async (req, res) => { res.json(await rec.allPayslips(req.ctx!, req.query as Q)); }));
router.get('/hr/acknowledgments', P('hr.workplace.view'), tx(async (req, res) => { res.json(await rec.acknowledgments(req.ctx!)); }));

export default router;
