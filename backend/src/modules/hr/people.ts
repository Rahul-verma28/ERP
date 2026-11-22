import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { todayIST } from '../../kernel/gst';
import { DateStr, Paise } from '../../kernel/query';
import { audit } from '../audit/service';
import { createEmployee, EmployeeInput, hrReach, myEmployee, names } from './employees';
import { Prisma } from '@prisma/client';
import { bundle, nameParts, namesFrom } from './bundle';
import { zFileRef } from '../../kernel/zodRules';

// Career and conduct records, workplace posts, performance, training and recruitment.

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const opt = <T extends z.ZodTypeAny>(t: T) => t.optional().nullable().or(z.literal('').transform(() => null));

// ── Career and conduct ──

export const ACTION_KINDS = ['promotion', 'transfer', 'award', 'warning', 'complaint', 'resignation', 'termination'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
/** Statuses each kind moves through; the first is where it starts */
export const ACTION_STATUSES: Record<ActionKind, string[]> = {
  promotion: ['pending', 'approved', 'rejected'],
  transfer: ['pending', 'approved', 'rejected'],
  award: ['given'],
  warning: ['issued', 'acknowledged', 'withdrawn'],
  complaint: ['open', 'in_review', 'resolved', 'dismissed'],
  resignation: ['pending', 'accepted', 'rejected'],
  termination: ['pending', 'approved', 'rejected'],
};
const DONE = new Set(['approved', 'accepted']);

const Move = z.object({ branchId: opt(z.string().uuid()), departmentId: opt(z.string().uuid()), designationId: opt(z.string().uuid()) });
export const ActionInput = z.object({
  kind: z.enum(ACTION_KINDS),
  employeeId: z.string().uuid({ message: 'Choose the employee' }),
  againstId: opt(z.string().uuid()),
  onDate: DateStr,
  effectiveOn: opt(DateStr),
  typeName: opt(z.string().trim().max(80)),
  subject: opt(z.string().trim().max(160)),
  description: opt(z.string().trim().max(2000)),
  severity: opt(z.enum(['low', 'medium', 'high'])),
  to: Move.optional().nullable(),
  documentUrl: opt(zFileRef),
});

async function actionCheck(ctx: TenantCtx, b: z.infer<typeof ActionInput>) {
  const fields: Record<string, string> = {};
  const e = await db().employee.findFirst({ where: { id: b.employeeId, tenantId: ctx.tenantId } });
  if (!e) fields.employeeId = 'Choose the employee';
  if (['promotion', 'transfer'].includes(b.kind)) {
    if (!b.to?.designationId && !b.to?.departmentId && !b.to?.branchId) fields['to.designationId'] = b.kind === 'promotion' ? 'Choose the new designation' : 'Choose where they move to';
    if (!b.effectiveOn) fields.effectiveOn = 'Choose the date it takes effect';
  }
  if (['award', 'warning', 'complaint', 'termination'].includes(b.kind) && !b.typeName) fields.typeName = 'Choose the type';
  if (['warning', 'complaint'].includes(b.kind) && !b.subject) fields.subject = 'Enter the subject';
  if (b.kind === 'complaint' && b.againstId === b.employeeId) fields.againstId = 'Someone other than the person complaining';
  if (['resignation', 'termination'].includes(b.kind)) {
    if (!b.effectiveOn) fields.effectiveOn = 'Choose the last working day';
    else if (b.effectiveOn < b.onDate) fields.effectiveOn = 'Must be on or after the notice date';
    if (!b.description) fields.description = 'Give the reason';
  }
  if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', Object.values(fields)[0], { fields });
  return e!;
}

export async function createAction(ctx: TenantCtx, b: z.infer<typeof ActionInput>) {
  const e = await actionCheck(ctx, b);
  const fromData = ['promotion', 'transfer'].includes(b.kind) ? { branchId: e.branchId, departmentId: e.departmentId, designationId: e.designationId } : undefined;
  const a = await db().hrAction.create({
    data: {
      tenantId: ctx.tenantId, kind: b.kind, employeeId: b.employeeId, againstId: b.againstId ?? null, onDate: day(b.onDate), effectiveOn: b.effectiveOn ? day(b.effectiveOn) : null,
      typeName: b.typeName ?? null, subject: b.subject ?? null, description: b.description ?? null, severity: b.severity ?? null, fromData, toData: b.to ?? undefined, documentUrl: b.documentUrl ?? null,
      status: ACTION_STATUSES[b.kind][0], createdBy: ctx.userId,
    },
  });
  await audit({ action: `hr.${b.kind}.create`, entity: 'hr_action', entityId: a.id, after: { employeeId: b.employeeId } });
  return a;
}

export async function updateAction(ctx: TenantCtx, id: string, b: z.infer<typeof ActionInput>, version: number) {
  const a = await db().hrAction.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Record');
  if (a.version !== version) throw new AppError('CONFLICT', 'Someone else changed this. Reload and try again.');
  if (DONE.has(a.status)) throw new AppError('CONFLICT', 'An approved record cannot be changed.');
  await actionCheck(ctx, { ...b, kind: a.kind as ActionKind });
  return db().hrAction.update({ where: { id }, data: { employeeId: b.employeeId, againstId: b.againstId ?? null, onDate: day(b.onDate), effectiveOn: b.effectiveOn ? day(b.effectiveOn) : null, typeName: b.typeName ?? null, subject: b.subject ?? null, description: b.description ?? null, severity: b.severity ?? null, toData: b.to ?? undefined, documentUrl: b.documentUrl ?? null, version: { increment: 1 } } });
}

export const ActionStatusInput = z.object({ status: z.string().min(1), response: opt(z.string().trim().max(1000)) });

/** Move a record on. Approving a promotion or transfer changes the employee; an accepted resignation or approved termination sets their last day */
export async function setActionStatus(ctx: TenantCtx, id: string, b: z.infer<typeof ActionStatusInput>) {
  const a = await db().hrAction.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Record');
  const allowed = ACTION_STATUSES[a.kind as ActionKind];
  if (!allowed.includes(b.status)) throw new AppError('VALIDATION_FAILED', 'Choose a status from the list.', { fields: { status: 'Not allowed' } });
  if (DONE.has(a.status)) throw new AppError('CONFLICT', 'This is already approved.');
  if (b.status === 'rejected' && !b.response) throw new AppError('VALIDATION_FAILED', 'Say why it is rejected.', { fields: { response: 'Needed to reject' } });
  if (DONE.has(b.status)) {
    const to = (a.toData ?? {}) as { branchId?: string | null; departmentId?: string | null; designationId?: string | null };
    if (a.kind === 'promotion' || a.kind === 'transfer') {
      await db().employee.update({ where: { id: a.employeeId }, data: { ...(to.branchId ? { branchId: to.branchId } : {}), ...(to.departmentId ? { departmentId: to.departmentId } : {}), ...(to.designationId ? { designationId: to.designationId } : {}), version: { increment: 1 } } });
    }
    if (a.kind === 'resignation' || a.kind === 'termination') {
      const last = iso(a.effectiveOn)!;
      await db().employee.update({ where: { id: a.employeeId }, data: { exitOn: a.effectiveOn, exitReason: `${a.kind === 'resignation' ? 'Resigned' : `Terminated: ${a.typeName}`}. ${a.description ?? ''}`.trim(), status: last <= todayIST() ? 'exited' : 'on_notice', version: { increment: 1 } } });
    }
  }
  await db().hrAction.update({ where: { id }, data: { status: b.status, response: b.response ?? a.response, decidedBy: ctx.userId, decidedAt: new Date(), version: { increment: 1 } } });
  await audit({ action: `hr.${a.kind}.${b.status}`, entity: 'hr_action', entityId: id, after: { response: b.response } });
  return db().hrAction.findUniqueOrThrow({ where: { id } });
}

export async function deleteAction(ctx: TenantCtx, id: string) {
  const a = await db().hrAction.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Record');
  if (DONE.has(a.status)) throw new AppError('CONFLICT', 'An approved record stays in the history. It cannot be deleted.');
  await db().hrAction.delete({ where: { id } });
}

/** One record with the same names as the list, e.g. for an award certificate */
export async function getAction(ctx: TenantCtx, id: string) {
  const a = await db().hrAction.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Record');
  const r = (await listActions(ctx, { kind: a.kind as ActionKind, employeeId: a.employeeId })).data.find((x) => x.id === id);
  if (!r) throw notFound('Record');
  return r;
}

export async function listActions(ctx: TenantCtx, q: { kind?: ActionKind; employeeId?: string; status?: string }) {
  const t = ctx.tenantId;
  const b = await bundle({
    ...nameParts(t),
    me: Prisma.sql`select id from employees where tenant_id = ${t}::uuid and member_id = ${ctx.memberId}::uuid and status <> 'exited' limit 1`,
    rows: Prisma.sql`select * from hr_actions where tenant_id = ${t}::uuid
      ${q.kind ? Prisma.sql`and kind = ${q.kind}` : Prisma.empty}
      ${q.employeeId ? Prisma.sql`and employee_id = ${q.employeeId}::uuid` : Prisma.empty}
      order by on_date desc, created_at desc limit 2000`,
  });
  const lookup = namesFrom(b);
  const reach = await hrReach(ctx);
  const mine = b.rows.filter((a) => !reach || reach.includes(a.employeeId as string));
  const place = (d: unknown) => {
    const x = (d ?? {}) as { branchId?: string; departmentId?: string; designationId?: string };
    return { branch: x.branchId ? lookup.branch.get(x.branchId) ?? null : null, department: x.departmentId ? lookup.dept.get(x.departmentId) ?? null : null, designation: x.designationId ? lookup.desig.get(x.designationId) ?? null : null };
  };
  const counts: Record<string, number> = {};
  for (const a of mine) counts[a.status] = (counts[a.status] ?? 0) + 1;
  return {
    data: mine.filter((a) => !q.status || a.status === q.status).map((a) => ({
      ...a, id: a.id as string, kind: a.kind as string, employeeId: a.employeeId as string, status: a.status as string, decidedByName: a.decidedBy ? lookup.user.get(a.decidedBy) ?? null : null, createdByName: a.createdBy ? lookup.user.get(a.createdBy) ?? null : null,
      employee: lookup.emp.get(a.employeeId) ?? '—', employeeCode: lookup.code.get(a.employeeId) ?? '', employeeSub: lookup.sub.get(a.employeeId) ?? null,
      against: a.againstId ? lookup.emp.get(a.againstId) ?? null : null, againstSub: a.againstId ? lookup.sub.get(a.againstId) ?? null : null, from: place(a.fromData), to: place(a.toData),
    })),
    counts,
  };
}

// ── Workplace: announcements, events, documents and policies ──

export const POST_KINDS = ['announcement', 'event', 'document'] as const;
export const PostInput = z.object({
  kind: z.enum(POST_KINDS),
  title: z.string().trim().min(3, 'Enter the title').max(160),
  category: opt(z.string().trim().max(60)),
  body: opt(z.string().trim().max(5000)),
  startsOn: opt(DateStr),
  endsOn: opt(DateStr),
  startsAt: opt(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')),
  endsAt: opt(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')),
  location: opt(z.string().trim().max(160)),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  departmentIds: z.array(z.string().uuid()).max(50).default([]),
  url: opt(zFileRef),
  needsAck: z.boolean().default(false),
  status: z.enum(['active', 'draft', 'inactive', 'pending', 'approved', 'rejected']).optional(),
  color: opt(z.string().max(12)),
});
/** Announcements go live or stay draft; events and documents wait for approval */
export const POST_STATUSES: Record<(typeof POST_KINDS)[number], string[]> = { announcement: ['active', 'draft', 'inactive'], event: ['pending', 'approved', 'rejected'], document: ['pending', 'approved', 'rejected'] };
export const LIVE = ['active', 'approved'];

function postCheck(b: z.infer<typeof PostInput>) {
  const fields: Record<string, string> = {};
  if (b.kind === 'event' && !b.startsOn) fields.startsOn = 'Choose the event date';
  if (b.kind === 'announcement' && !b.body) fields.body = 'Write the announcement';
  if (b.kind === 'document' && !b.url && !b.body) fields.url = 'Add the link to the document, or its text';
  if (b.startsOn && b.endsOn && b.endsOn < b.startsOn) fields.endsOn = 'Must be on or after the start';
  if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', Object.values(fields)[0], { fields });
}
const postData = (b: z.infer<typeof PostInput>) => {
  const allowed = POST_STATUSES[b.kind];
  return { ...b, status: b.status && allowed.includes(b.status) ? b.status : allowed[0], startsOn: b.startsOn ? day(b.startsOn) : null, endsOn: b.endsOn ? day(b.endsOn) : null };
};

export async function savePost(ctx: TenantCtx, b: z.infer<typeof PostInput>, id?: string) {
  postCheck(b);
  if (id) {
    const p = await db().hrPost.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!p) throw notFound('Post');
    // An edit keeps the approval decision unless the status is changed on purpose
    const { status: _s, ...rest } = postData(b);
    return db().hrPost.update({ where: { id }, data: { ...rest, ...(p.kind === 'announcement' ? { status: postData(b).status } : {}), version: { increment: 1 } } });
  }
  const p = await db().hrPost.create({ data: { ...postData(b), tenantId: ctx.tenantId, createdBy: ctx.userId } });
  await audit({ action: `hr.${b.kind}.create`, entity: 'hr_post', entityId: p.id, after: { title: b.title } });
  return p;
}

export const PostStatusInput = z.object({ status: z.string().min(1).max(12) });
export async function setPostStatus(ctx: TenantCtx, id: string, status: string) {
  const p = await db().hrPost.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!p) throw notFound('Post');
  if (!POST_STATUSES[p.kind as (typeof POST_KINDS)[number]].includes(status)) throw new AppError('VALIDATION_FAILED', 'Choose a status from the list.');
  const decided = ['approved', 'rejected', 'active'].includes(status);
  await audit({ action: `hr.${p.kind}.${status}`, entity: 'hr_post', entityId: id });
  return db().hrPost.update({ where: { id }, data: { status, approvedBy: decided ? ctx.userId : null, approvedAt: decided ? new Date() : null, version: { increment: 1 } } });
}

export async function deletePost(ctx: TenantCtx, id: string) {
  await db().hrAck.deleteMany({ where: { tenantId: ctx.tenantId, postId: id } });
  await db().hrPost.deleteMany({ where: { id, tenantId: ctx.tenantId } });
}

export async function listPosts(ctx: TenantCtx, kind: (typeof POST_KINDS)[number]) {
  // Self-service sees live posts for everyone or their department; anyone linked can confirm reading
  const t = ctx.tenantId;
  const b = await bundle({
    ...nameParts(t),
    me: Prisma.sql`select id, department_id from employees where tenant_id = ${t}::uuid and member_id = ${ctx.memberId}::uuid and status <> 'exited' limit 1`,
    rows: Prisma.sql`select * from hr_posts where tenant_id = ${t}::uuid and kind = ${kind} order by starts_on desc nulls last, created_at desc limit 1000`,
    acks: Prisma.sql`select a.post_id, a.employee_id from hr_acks a join hr_posts p on p.id = a.post_id where a.tenant_id = ${t}::uuid and p.kind = ${kind}`,
    staff: Prisma.sql`select count(*)::int as n from employees where tenant_id = ${t}::uuid and status <> 'exited'`,
  });
  const lookup = namesFrom(b);
  const me = b.me[0] as { id: string; departmentId: string | null } | undefined;
  const own = ctx.scope === 'own';
  const visible = b.rows.filter((p) => !own || (LIVE.includes(p.status) && (!p.departmentIds.length || (!!me?.departmentId && p.departmentIds.includes(me.departmentId)))));
  const staff = (b.staff[0]?.n as number | undefined) ?? 0;
  return {
    data: visible.map((p) => ({
      ...p, departments: (p.departmentIds as string[]).map((d) => lookup.dept.get(d)).filter(Boolean),
      createdByName: p.createdBy ? lookup.user.get(p.createdBy) ?? null : null, approvedByName: p.approvedBy ? lookup.user.get(p.approvedBy) ?? null : null,
      acks: b.acks.filter((a) => a.postId === p.id).length, employees: staff, ackedByMe: me ? b.acks.some((a) => a.postId === p.id && a.employeeId === me.id) : null,
    })),
  };
}

/** An employee confirms they have read a document or policy */
export async function acknowledge(ctx: TenantCtx, postId: string) {
  const me = await myEmployee(ctx);
  if (!me) throw new AppError('CONFLICT', 'Your login is not linked to an employee record.');
  const p = await db().hrPost.findFirst({ where: { id: postId, tenantId: ctx.tenantId, needsAck: true } });
  if (!p) throw notFound('Document');
  await db().hrAck.upsert({ where: { postId_employeeId: { postId, employeeId: me.id } }, create: { tenantId: ctx.tenantId, postId, employeeId: me.id }, update: {} });
  return { ok: true };
}

/** HR records a confirmation for someone (signed on paper), or takes it back */
export const AckForInput = z.object({ employeeId: z.string().uuid(), undo: z.boolean().optional() });
export async function acknowledgeFor(ctx: TenantCtx, postId: string, b: z.infer<typeof AckForInput>) {
  const p = await db().hrPost.findFirst({ where: { id: postId, tenantId: ctx.tenantId, needsAck: true } });
  if (!p) throw notFound('Document');
  const e = await db().employee.findFirst({ where: { id: b.employeeId, tenantId: ctx.tenantId } });
  if (!e) throw notFound('Employee');
  if (b.undo) await db().hrAck.deleteMany({ where: { tenantId: ctx.tenantId, postId, employeeId: e.id } });
  else await db().hrAck.upsert({ where: { postId_employeeId: { postId, employeeId: e.id } }, create: { tenantId: ctx.tenantId, postId, employeeId: e.id }, update: {} });
  await audit({ action: b.undo ? 'hr.ack.undo' : 'hr.ack.record', entity: 'hr_post', entityId: postId, after: { employeeId: e.id } });
  return { ok: true };
}

export async function ackList(ctx: TenantCtx, postId: string) {
  const [acks, emps] = await Promise.all([db().hrAck.findMany({ where: { tenantId: ctx.tenantId, postId } }), db().employee.findMany({ where: { tenantId: ctx.tenantId, status: { not: 'exited' } }, select: { id: true, name: true, code: true } })]);
  return { data: emps.map((e) => ({ ...e, ackedAt: acks.find((a) => a.employeeId === e.id)?.ackedAt ?? null })) };
}

// ── Performance: goals and reviews ──

export const GoalInput = z.object({
  employeeId: z.string().uuid({ message: 'Choose the employee' }),
  title: z.string().trim().min(3, 'Enter the goal').max(160),
  goalType: opt(z.string().trim().max(60)),
  description: opt(z.string().trim().max(2000)),
  target: opt(z.string().trim().max(160)),
  startsOn: DateStr,
  endsOn: DateStr,
  progress: z.number().int().min(0).max(100).default(0),
}).refine((g) => g.endsOn >= g.startsOn, { message: 'Must be on or after the start', path: ['endsOn'] });

const goalStatus = (progress: number, endsOn: string) => (progress >= 100 ? 'completed' : endsOn < todayIST() ? 'overdue' : progress > 0 ? 'in_progress' : 'not_started');

export async function saveGoal(ctx: TenantCtx, b: z.infer<typeof GoalInput>, id?: string) {
  if (!(await db().employee.findFirst({ where: { id: b.employeeId, tenantId: ctx.tenantId } }))) throw new AppError('VALIDATION_FAILED', 'Choose the employee.', { fields: { employeeId: 'Choose the employee' } });
  const data = { ...b, startsOn: day(b.startsOn), endsOn: day(b.endsOn), status: goalStatus(b.progress, b.endsOn) };
  if (id) {
    if (!(await db().hrGoal.findFirst({ where: { id, tenantId: ctx.tenantId } }))) throw notFound('Goal');
    return db().hrGoal.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  }
  return db().hrGoal.create({ data: { ...data, tenantId: ctx.tenantId, createdBy: ctx.userId } });
}

export async function setGoalProgress(ctx: TenantCtx, id: string, progress: number) {
  const g = await db().hrGoal.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!g) throw notFound('Goal');
  return db().hrGoal.update({ where: { id }, data: { progress, status: goalStatus(progress, iso(g.endsOn)!), version: { increment: 1 } } });
}

export async function listGoals(ctx: TenantCtx) {
  const reach = await hrReach(ctx);
  const [rows, lookup] = await Promise.all([db().hrGoal.findMany({ where: { tenantId: ctx.tenantId, ...(reach ? { employeeId: { in: reach } } : {}) }, orderBy: { endsOn: 'asc' } }), names(ctx)]);
  const today = todayIST();
  return { data: rows.map((g) => ({ ...g, status: g.status !== 'completed' && iso(g.endsOn)! < today ? 'overdue' : g.status, employee: lookup.emp.get(g.employeeId) ?? '—', employeeCode: lookup.code.get(g.employeeId) ?? '' })) };
}

export const ReviewInput = z.object({
  employeeId: z.string().uuid({ message: 'Choose the employee' }),
  reviewerId: opt(z.string().uuid()),
  cycle: z.string().trim().min(1, 'Choose the review cycle').max(60),
  reviewOn: DateStr,
});
export const ConductInput = z.object({
  ratings: z.record(z.string().max(60), z.number().int().min(1).max(5)).refine((r) => Object.keys(r).length > 0, 'Rate at least one area'),
  strengths: opt(z.string().trim().max(3000)),
  improve: opt(z.string().trim().max(3000)),
});

export async function saveReview(ctx: TenantCtx, b: z.infer<typeof ReviewInput>, id?: string) {
  if (b.reviewerId && b.reviewerId === b.employeeId) throw new AppError('VALIDATION_FAILED', 'The reviewer must be someone else.', { fields: { reviewerId: 'Someone else' } });
  const data = { ...b, reviewOn: day(b.reviewOn), reviewerId: b.reviewerId ?? null };
  if (id) {
    const r = await db().hrReview.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!r) throw notFound('Review');
    if (r.status === 'completed') throw new AppError('CONFLICT', 'A completed review cannot be changed.');
    return db().hrReview.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  }
  return db().hrReview.create({ data: { ...data, tenantId: ctx.tenantId, createdBy: ctx.userId } });
}

export async function conductReview(ctx: TenantCtx, id: string, b: z.infer<typeof ConductInput>) {
  const r = await db().hrReview.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!r) throw notFound('Review');
  if (r.status === 'completed') throw new AppError('CONFLICT', 'This review is already completed.');
  const values = Object.values(b.ratings);
  const rating = Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
  return db().hrReview.update({ where: { id }, data: { ratings: b.ratings, rating, strengths: b.strengths ?? null, improve: b.improve ?? null, status: 'completed', version: { increment: 1 } } });
}

export async function listReviews(ctx: TenantCtx) {
  const reach = await hrReach(ctx);
  const [rows, lookup] = await Promise.all([db().hrReview.findMany({ where: { tenantId: ctx.tenantId, ...(reach ? { employeeId: { in: reach } } : {}) }, orderBy: { reviewOn: 'desc' } }), names(ctx)]);
  return { data: rows.map((r) => ({ ...r, rating: r.rating === null ? null : Number(r.rating), employee: lookup.emp.get(r.employeeId) ?? '—', employeeCode: lookup.code.get(r.employeeId) ?? '', reviewer: r.reviewerId ? lookup.emp.get(r.reviewerId) ?? null : null })) };
}

// ── Training ──

export const TrainingInput = z.object({
  title: z.string().trim().min(3, 'Enter the training title').max(160),
  trainingType: opt(z.string().trim().max(60)),
  trainer: opt(z.string().trim().max(120)),
  startsOn: DateStr,
  endsOn: DateStr,
  location: opt(z.string().trim().max(160)),
  costPaise: Paise.default(0),
  employeeIds: z.array(z.string().uuid()).max(500).default([]),
  description: opt(z.string().trim().max(3000)),
  status: z.enum(['scheduled', 'ongoing', 'completed', 'cancelled']).default('scheduled'),
}).refine((t) => t.endsOn >= t.startsOn, { message: 'Must be on or after the start', path: ['endsOn'] });

export async function saveTraining(ctx: TenantCtx, b: z.infer<typeof TrainingInput>, id?: string) {
  const data = { ...b, startsOn: day(b.startsOn), endsOn: day(b.endsOn), costPaise: BigInt(b.costPaise) };
  if (id) {
    if (!(await db().hrTraining.findFirst({ where: { id, tenantId: ctx.tenantId } }))) throw notFound('Training');
    return db().hrTraining.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  }
  return db().hrTraining.create({ data: { ...data, tenantId: ctx.tenantId, createdBy: ctx.userId } });
}

export async function listTrainings(ctx: TenantCtx) {
  const reach = await hrReach(ctx);
  const [rows, lookup] = await Promise.all([db().hrTraining.findMany({ where: { tenantId: ctx.tenantId, ...(reach ? { employeeIds: { hasSome: reach.length ? reach : ['00000000-0000-0000-0000-000000000000'] } } : {}) }, orderBy: { startsOn: 'desc' } }), names(ctx)]);
  return { data: rows.map((t) => ({ ...t, participants: t.employeeIds.map((id) => ({ id, name: lookup.emp.get(id) ?? '—' })) })) };
}

// ── Recruitment: jobs, candidates, interviews ──

export const JobInput = z.object({
  title: z.string().trim().min(2, 'Enter the job title').max(120),
  departmentId: opt(z.string().uuid()),
  branchId: opt(z.string().uuid()),
  location: opt(z.string().trim().max(120)),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'intern', 'temporary']).default('full_time'),
  positions: z.number().int().min(1).max(500).default(1),
  minExp: z.number().int().min(0).max(50).optional().nullable(),
  maxExp: z.number().int().min(0).max(50).optional().nullable(),
  minSalaryPaise: Paise.optional().nullable(),
  maxSalaryPaise: Paise.optional().nullable(),
  skills: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  description: opt(z.string().trim().max(5000)),
  closesOn: opt(DateStr),
  status: z.enum(['open', 'on_hold', 'closed']).default('open'),
}).refine((j) => j.minExp == null || j.maxExp == null || j.maxExp >= j.minExp, { message: 'Must be at least the minimum', path: ['maxExp'] })
  .refine((j) => j.minSalaryPaise == null || j.maxSalaryPaise == null || j.maxSalaryPaise >= j.minSalaryPaise, { message: 'Must be at least the minimum', path: ['maxSalaryPaise'] });

const jobData = (b: z.infer<typeof JobInput>) => ({ ...b, closesOn: b.closesOn ? day(b.closesOn) : null, minSalaryPaise: b.minSalaryPaise == null ? null : BigInt(b.minSalaryPaise), maxSalaryPaise: b.maxSalaryPaise == null ? null : BigInt(b.maxSalaryPaise) });

export async function saveJob(ctx: TenantCtx, b: z.infer<typeof JobInput>, id?: string) {
  if (id) {
    if (!(await db().hrJob.findFirst({ where: { id, tenantId: ctx.tenantId } }))) throw notFound('Job');
    return db().hrJob.update({ where: { id }, data: { ...jobData(b), version: { increment: 1 } } });
  }
  return db().hrJob.create({ data: { ...jobData(b), tenantId: ctx.tenantId, createdBy: ctx.userId } });
}

export async function deleteJob(ctx: TenantCtx, id: string) {
  const n = await db().hrCandidate.count({ where: { tenantId: ctx.tenantId, jobId: id } });
  if (n) throw new AppError('CONFLICT', `${n} candidate${n === 1 ? ' has' : 's have'} applied. Close the job instead.`);
  await db().hrJob.deleteMany({ where: { id, tenantId: ctx.tenantId } });
}

export async function listJobs(ctx: TenantCtx) {
  const [rows, lookup, cands] = await Promise.all([
    db().hrJob.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] }),
    names(ctx),
    db().hrCandidate.groupBy({ by: ['jobId', 'stage'], where: { tenantId: ctx.tenantId }, _count: true }),
  ]);
  return {
    data: rows.map((j) => {
      const mine = cands.filter((c) => c.jobId === j.id);
      return { ...j, department: j.departmentId ? lookup.dept.get(j.departmentId) ?? null : null, branch: j.branchId ? lookup.branch.get(j.branchId) ?? null : null, candidates: mine.reduce((s, c) => s + c._count, 0), hired: mine.find((c) => c.stage === 'hired')?._count ?? 0 };
    }),
  };
}

export const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;
export const CandidateInput = z.object({
  jobId: z.string().uuid({ message: 'Choose the job' }),
  name: z.string().trim().min(2, 'Enter the name').max(120),
  email: opt(z.string().trim().email('Enter a valid email')),
  phone: opt(z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number')),
  source: opt(z.string().trim().max(60)),
  experience: z.number().min(0).max(60).optional().nullable(),
  currentCtcPaise: Paise.optional().nullable(),
  expectedCtcPaise: Paise.optional().nullable(),
  resumeUrl: opt(zFileRef),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  notes: opt(z.string().trim().max(3000)),
}).refine((c) => c.email || c.phone, { message: 'Enter a mobile number or email', path: ['phone'] });

/** Adding a candidate needs their resume (staff add them; editing an old one without it still works) */
export const ResumeRequired = z.object({ resumeUrl: z.string({ required_error: 'Upload the resume', invalid_type_error: 'Upload the resume' }).min(1, 'Upload the resume').pipe(zFileRef) }).passthrough();

const candData = (b: z.infer<typeof CandidateInput>) => ({ ...b, currentCtcPaise: b.currentCtcPaise == null ? null : BigInt(b.currentCtcPaise), expectedCtcPaise: b.expectedCtcPaise == null ? null : BigInt(b.expectedCtcPaise) });

export async function saveCandidate(ctx: TenantCtx, b: z.infer<typeof CandidateInput>, id?: string) {
  if (!(await db().hrJob.findFirst({ where: { id: b.jobId, tenantId: ctx.tenantId } }))) throw new AppError('VALIDATION_FAILED', 'Choose the job.', { fields: { jobId: 'Choose the job' } });
  if (id) {
    if (!(await db().hrCandidate.findFirst({ where: { id, tenantId: ctx.tenantId } }))) throw notFound('Candidate');
    return db().hrCandidate.update({ where: { id }, data: { ...candData(b), version: { increment: 1 } } });
  }
  return db().hrCandidate.create({ data: { ...candData(b), tenantId: ctx.tenantId, createdBy: ctx.userId } });
}

export async function setStage(ctx: TenantCtx, id: string, stage: (typeof STAGES)[number]) {
  const c = await db().hrCandidate.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c) throw notFound('Candidate');
  if (c.stage === 'hired') throw new AppError('CONFLICT', 'This candidate is already hired.');
  if (stage === 'hired') throw new AppError('VALIDATION_FAILED', 'Use "Hire" to make them an employee.');
  return db().hrCandidate.update({ where: { id }, data: { stage, version: { increment: 1 } } });
}

export const HireInput = z.object({ joinedOn: DateStr, basicPaise: Paise.default(0), designationId: opt(z.string().uuid()), departmentId: opt(z.string().uuid()) });

/** Hire: the candidate becomes an employee, with their details carried over */
export async function hireCandidate(ctx: TenantCtx, id: string, b: z.infer<typeof HireInput>) {
  const c = await db().hrCandidate.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c) throw notFound('Candidate');
  if (c.employeeId) throw new AppError('CONFLICT', 'This candidate is already an employee.');
  const job = await db().hrJob.findUnique({ where: { id: c.jobId } });
  const e = await createEmployee(ctx, EmployeeInput.parse({ name: c.name, email: c.email, phone: c.phone, joinedOn: b.joinedOn, basicPaise: b.basicPaise, departmentId: b.departmentId ?? job?.departmentId ?? null, designationId: b.designationId ?? null, branchId: job?.branchId ?? null, employmentType: job?.employmentType ?? 'full_time' }));
  await db().hrCandidate.update({ where: { id }, data: { stage: 'hired', employeeId: e.id, version: { increment: 1 } } });
  await audit({ action: 'hr.candidate.hire', entity: 'hr_candidate', entityId: id, after: { employeeId: e.id } });
  return e;
}

export async function deleteCandidate(ctx: TenantCtx, id: string) {
  await db().hrInterview.deleteMany({ where: { tenantId: ctx.tenantId, candidateId: id } });
  await db().hrCandidate.deleteMany({ where: { id, tenantId: ctx.tenantId, employeeId: null } });
}

export async function listCandidates(ctx: TenantCtx, jobId?: string) {
  const [rows, jobs, interviews] = await Promise.all([
    db().hrCandidate.findMany({ where: { tenantId: ctx.tenantId, ...(jobId ? { jobId } : {}) }, orderBy: { createdAt: 'desc' }, take: 3000 }),
    db().hrJob.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, title: true } }),
    db().hrInterview.groupBy({ by: ['candidateId'], where: { tenantId: ctx.tenantId }, _count: true }),
  ]);
  return { data: rows.map((c) => ({ ...c, experience: c.experience === null ? null : Number(c.experience), job: jobs.find((j) => j.id === c.jobId)?.title ?? '—', interviews: interviews.find((i) => i.candidateId === c.id)?._count ?? 0 })) };
}

export const InterviewInput = z.object({
  candidateId: z.string().uuid({ message: 'Choose the candidate' }),
  round: z.string().trim().min(1, 'Name the round, e.g. HR round').max(60),
  onDate: DateStr,
  atTime: opt(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')),
  mode: z.enum(['in_person', 'phone', 'video']).default('in_person'),
  interviewerIds: z.array(z.string().uuid()).max(10).default([]),
});
export const ResultInput = z.object({ result: z.enum(['scheduled', 'passed', 'failed', 'no_show', 'cancelled']), rating: z.number().int().min(1).max(5).optional().nullable(), feedback: opt(z.string().trim().max(3000)) });

export async function saveInterview(ctx: TenantCtx, b: z.infer<typeof InterviewInput>, id?: string) {
  const c = await db().hrCandidate.findFirst({ where: { id: b.candidateId, tenantId: ctx.tenantId } });
  if (!c) throw new AppError('VALIDATION_FAILED', 'Choose the candidate.', { fields: { candidateId: 'Choose the candidate' } });
  const data = { ...b, onDate: day(b.onDate) };
  if (id) {
    if (!(await db().hrInterview.findFirst({ where: { id, tenantId: ctx.tenantId } }))) throw notFound('Interview');
    return db().hrInterview.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  }
  if (['applied', 'screening'].includes(c.stage)) await db().hrCandidate.update({ where: { id: c.id }, data: { stage: 'interview' } });
  return db().hrInterview.create({ data: { ...data, tenantId: ctx.tenantId, createdBy: ctx.userId } });
}

export async function interviewResult(ctx: TenantCtx, id: string, b: z.infer<typeof ResultInput>) {
  const i = await db().hrInterview.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!i) throw notFound('Interview');
  if (['passed', 'failed'].includes(b.result) && !b.feedback) throw new AppError('VALIDATION_FAILED', 'Add a line of feedback.', { fields: { feedback: 'Needed' } });
  return db().hrInterview.update({ where: { id }, data: { result: b.result, rating: b.rating ?? null, feedback: b.feedback ?? null, version: { increment: 1 } } });
}

export async function listInterviews(ctx: TenantCtx) {
  const [rows, cands, jobs, lookup] = await Promise.all([
    db().hrInterview.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ onDate: 'desc' }, { atTime: 'asc' }], take: 2000 }),
    db().hrCandidate.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true, jobId: true, stage: true } }),
    db().hrJob.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, title: true } }),
    names(ctx),
  ]);
  return {
    data: rows.map((i) => {
      const c = cands.find((x) => x.id === i.candidateId);
      return { ...i, candidate: c?.name ?? '—', candidateStage: c?.stage ?? null, job: jobs.find((j) => j.id === c?.jobId)?.title ?? '—', interviewers: i.interviewerIds.map((id) => lookup.emp.get(id)).filter(Boolean) };
    }),
  };
}

export async function deleteSimple(ctx: TenantCtx, table: 'hrGoal' | 'hrReview' | 'hrTraining' | 'hrInterview', id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db()[table] as any).deleteMany({ where: { id, tenantId: ctx.tenantId } });
}
