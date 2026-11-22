import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { todayIST } from '../../kernel/gst';
import { DateStr, Paise } from '../../kernel/query';
import { audit } from '../audit/service';
import { hrReach, myEmployee, names } from './employees';
import { hireCandidate } from './people';
import { Prisma } from '@prisma/client';
import { bundle, nameParts, namesFrom } from './bundle';
import { zFileRef } from '../../kernel/zodRules';

// Trainers, candidate assessments, offers, onboarding checklists and candidate onboardings.
// They share one table; each kind has its own fields and statuses, checked here.

export const RECORD_KINDS = ['trainer', 'assessment', 'offer', 'checklist', 'onboarding', 'emp_doc'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
const opt = <T extends z.ZodTypeAny>(t: T) => t.optional().nullable().or(z.literal('').transform(() => null));

const Trainer = z.object({
  name: z.string().trim().min(2, 'Enter the trainer name').max(120),
  phone: opt(z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number')),
  email: opt(z.string().trim().email('Enter a valid email')),
  company: opt(z.string().trim().max(120)),
  expertise: opt(z.string().trim().max(200)),
  qualification: opt(z.string().trim().max(200)),
  experienceYears: z.number().min(0).max(60).optional().nullable(),
  departmentId: opt(z.string().uuid()),
  employeeId: opt(z.string().uuid()),
});
const Assessment = z.object({
  candidateId: z.string().uuid({ message: 'Choose the candidate' }),
  title: z.string().trim().min(2, 'Choose the assessment').max(80),
  onDate: DateStr,
  conductedById: opt(z.string().uuid()),
  score: z.number().min(0).max(1000).optional().nullable(),
  maxScore: z.number().positive().max(1000).optional().nullable(),
  remarks: opt(z.string().trim().max(2000)),
}).refine((a) => a.score == null || a.maxScore == null || a.score <= a.maxScore, { message: 'More than the maximum', path: ['score'] });
const Offer = z.object({
  candidateId: z.string().uuid({ message: 'Choose the candidate' }),
  designationId: opt(z.string().uuid()),
  departmentId: opt(z.string().uuid()),
  position: z.string().trim().min(2, 'Enter the position').max(120),
  salaryPaise: Paise.refine((v) => v > 0, 'Enter the monthly salary'),
  joiningOn: DateStr,
  expiresOn: opt(DateStr),
  benefits: opt(z.string().trim().max(2000)),
  notes: opt(z.string().trim().max(2000)),
}).refine((o) => !o.expiresOn || o.expiresOn <= o.joiningOn, { message: 'Must be on or before the joining date', path: ['expiresOn'] });
const Item = z.object({ task: z.string().trim().min(2, 'Name the task').max(160), category: z.string().trim().max(60).optional().nullable(), dueDay: z.number().int().min(0).max(365).default(0), required: z.boolean().default(true) });
const Checklist = z.object({ name: z.string().trim().min(2, 'Name the checklist').max(80), isDefault: z.boolean().default(false), items: z.array(Item).min(1, 'Add at least one task').max(60) });
const Onboarding = z.object({
  candidateId: z.string().uuid({ message: 'Choose the hired candidate' }),
  checklistId: z.string().min(1, 'Choose the checklist'),
  startOn: DateStr,
  buddyId: opt(z.string().uuid()),
  notes: opt(z.string().trim().max(2000)),
});

const EmpDoc = z.object({
  employeeId: z.string().uuid({ message: 'Choose the employee' }),
  documentType: z.string().trim().min(2, 'Choose the document type').max(60),
  number: opt(z.string().trim().max(40)),
  url: opt(zFileRef),
  issuedOn: opt(DateStr),
  expiresOn: opt(DateStr),
  notes: opt(z.string().trim().max(500)),
}).refine((d) => !d.issuedOn || !d.expiresOn || d.expiresOn >= d.issuedOn, { message: 'Must be after the issue date', path: ['expiresOn'] });

export const SCHEMAS = { emp_doc: EmpDoc, trainer: Trainer, assessment: Assessment, offer: Offer, checklist: Checklist, onboarding: Onboarding };
export const STATUSES: Record<RecordKind, string[]> = {
  trainer: ['active', 'inactive'],
  assessment: ['pending', 'passed', 'failed'],
  offer: ['draft', 'sent', 'accepted', 'declined', 'withdrawn'],
  checklist: ['active', 'inactive'],
  onboarding: ['in_progress', 'completed'],
  emp_doc: ['pending', 'verified', 'rejected'],
};
export const RecordInput = z.object({ kind: z.enum(RECORD_KINDS), data: z.record(z.unknown()) });

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const addDays = (s: string, n: number) => new Date(day(s).getTime() + n * 86_400_000).toISOString().slice(0, 10);

async function candidate(ctx: TenantCtx, id: string) {
  const c = await db().hrCandidate.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c) throw new AppError('VALIDATION_FAILED', 'Choose the candidate.', { fields: { candidateId: 'Choose the candidate' } });
  return c;
}

/** Check one record's fields for its kind; returns the clean data and what it points at */
async function clean(ctx: TenantCtx, kind: RecordKind, raw: unknown, id?: string) {
  const data = SCHEMAS[kind].parse(raw) as Record<string, unknown>;
  let refId: string | null = null;
  if (kind === 'emp_doc') {
    const e = await db().employee.findFirst({ where: { id: data.employeeId as string, tenantId: ctx.tenantId } });
    if (!e) throw new AppError('VALIDATION_FAILED', 'Choose the employee.', { fields: { employeeId: 'Choose the employee' } });
    refId = e.id;
  }
  if (kind === 'trainer') {
    const dup = await db().hrRecord.findFirst({ where: { tenantId: ctx.tenantId, kind, id: id ? { not: id } : undefined, data: { path: ['name'], equals: data.name as string } } });
    if (dup) throw new AppError('VALIDATION_FAILED', 'A trainer with this name already exists.', { fields: { name: 'Already used' } });
  }
  if (kind === 'assessment' || kind === 'offer' || kind === 'onboarding') {
    const c = await candidate(ctx, data.candidateId as string);
    refId = c.id;
    if (kind !== 'onboarding' && ['hired', 'rejected'].includes(c.stage) && !id) throw new AppError('VALIDATION_FAILED', `${c.name} is already ${c.stage}.`, { fields: { candidateId: 'Not open' } });
    if (kind === 'onboarding' && c.stage !== 'hired') throw new AppError('VALIDATION_FAILED', 'Hire the candidate first, then start onboarding.', { fields: { candidateId: 'Not hired yet' } });
  }
  if (kind === 'offer' && (data.joiningOn as string) < todayIST() && !id) throw new AppError('VALIDATION_FAILED', 'The joining date has passed.', { fields: { joiningOn: 'In the past' } });
  if (kind === 'checklist') {
    data.items = (data.items as z.infer<typeof Item>[]).map((it) => ({ ...it, id: randomUUID() }));
    if (data.isDefault) {
      const others = await db().hrRecord.findMany({ where: { tenantId: ctx.tenantId, kind: 'checklist', id: id ? { not: id } : undefined } });
      for (const o of others) if ((o.data as { isDefault?: boolean }).isDefault) await db().hrRecord.update({ where: { id: o.id }, data: { data: { ...(o.data as object), isDefault: false } } });
    }
  }
  if (kind === 'onboarding') {
    const list = await db().hrRecord.findFirst({ where: { id: data.checklistId as string, tenantId: ctx.tenantId, kind: 'checklist' } });
    if (!list) throw new AppError('VALIDATION_FAILED', 'Choose a checklist.', { fields: { checklistId: 'Choose a checklist' } });
    if (!id) {
      const busy = await db().hrRecord.findFirst({ where: { tenantId: ctx.tenantId, kind: 'onboarding', refId } });
      if (busy) throw new AppError('VALIDATION_FAILED', 'This person already has an onboarding.', { fields: { candidateId: 'Already started' } });
      // Each task gets its own due date from the start
      data.tasks = ((list.data as { items: (z.infer<typeof Item> & { id: string })[] }).items).map((it) => ({ ...it, id: randomUUID(), dueOn: addDays(data.startOn as string, it.dueDay), doneAt: null }));
      data.checklist = (list.data as { name: string }).name;
    }
  }
  return { data, refId };
}

export async function createRecord(ctx: TenantCtx, kind: RecordKind, raw: unknown) {
  const { data, refId } = await clean(ctx, kind, raw);
  const r = await db().hrRecord.create({ data: { tenantId: ctx.tenantId, kind, refId, status: STATUSES[kind][0], data: data as object, createdBy: ctx.userId } });
  // An offer moves the candidate to the offer stage
  if (kind === 'offer') await db().hrCandidate.update({ where: { id: refId! }, data: { stage: 'offer' } });
  await audit({ action: `hr.${kind}.create`, entity: 'hr_record', entityId: r.id });
  return r;
}

async function find(ctx: TenantCtx, id: string) {
  const r = await db().hrRecord.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!r) throw notFound('Record');
  return r;
}

export async function updateRecord(ctx: TenantCtx, id: string, raw: unknown, version: number) {
  const r = await find(ctx, id);
  if (r.version !== version) throw new AppError('CONFLICT', 'Someone else changed this. Reload and try again.');
  if (r.kind === 'offer' && ['accepted'].includes(r.status)) throw new AppError('CONFLICT', 'An accepted offer cannot be changed.');
  const { data, refId } = await clean(ctx, r.kind as RecordKind, raw, id);
  // Onboarding keeps its tasks and their progress
  const keep = r.kind === 'onboarding' ? { tasks: (r.data as { tasks?: unknown }).tasks, checklist: (r.data as { checklist?: unknown }).checklist } : {};
  return db().hrRecord.update({ where: { id }, data: { data: { ...data, ...keep } as object, refId, version: { increment: 1 } } });
}

export const StatusInput = z.object({ status: z.string().min(1).max(16) });
export async function setRecordStatus(ctx: TenantCtx, id: string, status: string) {
  const r = await find(ctx, id);
  if (!STATUSES[r.kind as RecordKind].includes(status)) throw new AppError('VALIDATION_FAILED', 'Choose a status from the list.');
  if (r.kind === 'offer') {
    const d = r.data as { employeeId?: string };
    if (d.employeeId) throw new AppError('CONFLICT', 'This offer is already turned into an employee.');
    if (status === 'declined' || status === 'withdrawn') await db().hrCandidate.updateMany({ where: { id: r.refId!, stage: 'offer' }, data: { stage: 'rejected' } });
    if (status === 'sent' || status === 'draft' || status === 'accepted') await db().hrCandidate.updateMany({ where: { id: r.refId!, stage: { in: ['rejected', 'interview', 'screening', 'applied'] } }, data: { stage: 'offer' } });
  }
  await audit({ action: `hr.${r.kind}.${status}`, entity: 'hr_record', entityId: id });
  return db().hrRecord.update({ where: { id }, data: { status, version: { increment: 1 } } });
}

export async function deleteRecord(ctx: TenantCtx, id: string) {
  const r = await find(ctx, id);
  if (r.kind === 'offer' && (r.data as { employeeId?: string }).employeeId) throw new AppError('CONFLICT', 'This offer made an employee. It stays in the history.');
  if (r.kind === 'checklist' && (await db().hrRecord.count({ where: { tenantId: ctx.tenantId, kind: 'onboarding', data: { path: ['checklistId'], equals: id } } }))) throw new AppError('CONFLICT', 'Onboardings use this checklist. Mark it inactive instead.');
  await db().hrRecord.delete({ where: { id } });
}

/** Accepted offer → employee, with the offered salary, position and joining date */
export async function convertOffer(ctx: TenantCtx, id: string) {
  const r = await find(ctx, id);
  if (r.kind !== 'offer') throw notFound('Offer');
  if (r.status !== 'accepted') throw new AppError('CONFLICT', 'Mark the offer as accepted first.');
  const d = r.data as z.infer<typeof Offer> & { employeeId?: string };
  if (d.employeeId) throw new AppError('CONFLICT', 'Already an employee.');
  const e = await hireCandidate(ctx, r.refId!, { joinedOn: d.joiningOn, basicPaise: d.salaryPaise, designationId: d.designationId ?? null, departmentId: d.departmentId ?? null });
  await db().hrRecord.update({ where: { id }, data: { data: { ...d, employeeId: e.id }, version: { increment: 1 } } });
  return e;
}

/** Tick an onboarding task done (or not); all required done completes the onboarding */
export async function toggleTask(ctx: TenantCtx, id: string, taskId: string, done: boolean) {
  const r = await find(ctx, id);
  if (r.kind !== 'onboarding') throw notFound('Onboarding');
  const d = r.data as { tasks: { id: string; required: boolean; doneAt: string | null }[] };
  const tasks = d.tasks.map((t) => (t.id === taskId ? { ...t, doneAt: done ? new Date().toISOString() : null } : t));
  if (!tasks.some((t) => t.id === taskId)) throw notFound('Task');
  const complete = tasks.filter((t) => t.required).every((t) => t.doneAt);
  return db().hrRecord.update({ where: { id }, data: { data: { ...d, tasks }, status: complete ? 'completed' : 'in_progress', version: { increment: 1 } } });
}

/** Records of one kind, with the names they point at */
export async function listRecords(ctx: TenantCtx, kind: RecordKind, refId?: string) {
  const [rows, lookup, cands, jobs] = await Promise.all([
    db().hrRecord.findMany({ where: { tenantId: ctx.tenantId, kind, ...(refId ? { refId } : {}) }, orderBy: { createdAt: 'desc' }, take: 3000 }),
    names(ctx),
    db().hrCandidate.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true, jobId: true, stage: true, employeeId: true, phone: true, email: true } }),
    db().hrJob.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, title: true } }),
  ]);
  const emp = (id?: string | null) => (id ? lookup.emp.get(id) ?? null : null);
  return {
    data: rows.map((r) => {
      const d = r.data as Record<string, unknown>;
      const c = r.refId ? cands.find((x) => x.id === r.refId) : null;
      return {
        id: r.id, kind: r.kind, status: r.status, version: r.version, createdAt: r.createdAt, refId: r.refId, data: d,
        candidate: c ? { id: c.id, name: c.name, stage: c.stage, employeeId: c.employeeId, phone: c.phone, email: c.email, job: jobs.find((j) => j.id === c.jobId)?.title ?? null } : null,
        names: {
          conductedBy: emp(d.conductedById as string), buddy: emp(d.buddyId as string), employee: emp((d.employeeId as string) ?? c?.employeeId ?? (r.kind === 'emp_doc' ? r.refId : null)),
          department: d.departmentId ? lookup.dept.get(d.departmentId as string) ?? null : null, designation: d.designationId ? lookup.desig.get(d.designationId as string) ?? null : null,
        },
      };
    }),
  };
}

// ── Payslips across all runs, and acknowledgments across all documents ──

export async function allPayslips(ctx: TenantCtx, q: { month?: string; status?: string; employeeId?: string }) {
  // Salaries stay private: below "all" a person sees only their own payslips
  const self = (ctx.scope ?? 'own') !== 'all';
  const own = self ? await myEmployee(ctx) : null;
  if (self && !own) return { data: [] };
  const [rows, lookup] = await Promise.all([
    db().payslip.findMany({
      where: { tenantId: ctx.tenantId, ...(own ? { employeeId: own.id, run: { status: { not: 'draft' } } } : q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.month ? { run: { month: q.month } } : {}) },
      include: { run: { select: { month: true, status: true, payDate: true, number: true } } }, orderBy: [{ createdAt: 'desc' }], take: 5000,
    }),
    names(ctx),
  ]);
  return { data: rows.map((s) => ({ ...s, payableDays: Number(s.payableDays), lopDays: Number(s.lopDays), month: s.run.month, runStatus: s.run.status, employee: lookup.emp.get(s.employeeId) ?? (s.snapshot as { name?: string })?.name ?? '—', employeeCode: lookup.code.get(s.employeeId) ?? '' })) };
}

export async function acknowledgments(ctx: TenantCtx) {
  const t = ctx.tenantId;
  const b = await bundle({
    ...nameParts(t),
    me: Prisma.sql`select id from employees where tenant_id = ${t}::uuid and member_id = ${ctx.memberId}::uuid and status <> 'exited' limit 1`,
    docs: Prisma.sql`select id, title, category, url, starts_on, department_ids, created_by, created_at, approved_by, approved_at from hr_posts where tenant_id = ${t}::uuid and kind = 'document' and needs_ack and status in ('active', 'approved')`,
    acks: Prisma.sql`select post_id, employee_id, acked_at from hr_acks where tenant_id = ${t}::uuid`,
    emps: Prisma.sql`select id, name, code, department_id from employees where tenant_id = ${t}::uuid and status <> 'exited' order by name`,
  });
  const lookup = namesFrom(b);
  const reach = await hrReach(ctx);
  const rows = b.docs.flatMap((d) => b.emps.filter((e) => (!reach || reach.includes(e.id as string)) && (!d.departmentIds.length || (e.departmentId && d.departmentIds.includes(e.departmentId)))).map((e) => {
    const a = b.acks.find((x) => x.postId === d.id && x.employeeId === e.id);
    const by = d.approvedBy ?? d.createdBy;
    return { id: `${d.id}:${e.id}`, postId: d.id, document: d.title, category: d.category, url: d.url, effectiveOn: d.startsOn, employeeId: e.id, employee: e.name, employeeCode: e.code, employeeSub: lookup.sub.get(e.id) ?? null, department: e.departmentId ? lookup.dept.get(e.departmentId) ?? null : null, status: a ? 'acknowledged' : 'pending', ackedAt: a?.ackedAt ?? null, assignedOn: d.approvedAt ?? d.createdAt, assignedBy: by ? lookup.user.get(by) ?? null : null };
  }));
  return { data: rows };
}
