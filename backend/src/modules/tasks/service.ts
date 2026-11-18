import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type Task } from '@prisma/client';
import { db } from '../../kernel/db';
import { bundle, userNames, userPart, type Row } from '../../kernel/bundle';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { DateStr, Paise, assertVersion } from '../../kernel/query';
import { todayIST } from '../../kernel/gst';
import { getRolePermissions } from '../access/service';
import { notify } from '../notifications/service';
import { audit } from '../audit/service';

// Tasks & Projects: tasks with checklists, subtasks, labels, repeats and comments; projects with a
// team, dates and budget; time logged against either; and approvals asked of a named person.
// Lists come in ONE database round trip each (kernel/bundle), with the counts for tabs and cards.

const DAY = 86_400_000;
const IST = 330 * 60_000;
/** The India date of a moment, YYYY-MM-DD */
const istDay = (d: Date | null | undefined) => (d ? new Date(d.getTime() + IST).toISOString().slice(0, 10) : null);
const big = (v: unknown) => (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v ?? 0))));
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00.000Z`).getTime() + n * DAY).toISOString().slice(0, 10);
/** Monday of the India week a date is in */
const weekStart = (s: string) => { const d = new Date(`${s}T00:00:00.000Z`); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
function page<T extends { id: string }>(rows: T[], limit: number, cursor?: string) {
  const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
  const data = rows.slice(start, start + limit);
  return { data, nextCursor: start + limit < rows.length ? data[data.length - 1]?.id ?? null : null, total: rows.length };
}
const ownScope = (ctx: TenantCtx, cols: string[]) =>
  (ctx.scope ?? 'own') === 'own' ? Prisma.sql`and (${Prisma.join(cols.map((c) => Prisma.sql`${Prisma.raw(c)} = ${ctx.userId}::uuid`), ' or ')})` : Prisma.empty;
const canDo = async (ctx: TenantCtx, key: string) => (await getRolePermissions(ctx.roleId)).has(key);

async function activeUser(id: string | null | undefined, field: string) {
  if (!id) return;
  if (!(await db().tenantMember.findFirst({ where: { userId: id, status: 'active' } }))) {
    throw new AppError('VALIDATION_FAILED', 'Choose an active user.', { fields: { [field]: 'Not an active user' } });
  }
}

// ---------------------------------------------------------------- tasks

const ChecklistItem = z.object({ id: z.string().max(40).optional(), text: z.string().trim().min(1, 'Write the step').max(200), done: z.boolean().default(false) });
export const TaskInput = z.object({
  title: z.string().trim().min(2, 'Write what needs doing').max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  startOn: DateStr.optional().nullable(),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  estimateMin: z.number().int().min(5, 'At least 5 minutes').max(100_000).optional().nullable(),
  assigneeId: z.string().uuid().optional().nullable(),
  contactId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
  labels: z.array(z.string().trim().min(1).max(30)).max(8).optional(),
  checklist: z.array(ChecklistItem).max(50).optional(),
  repeat: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
});
export type TaskInput = z.infer<typeof TaskInput>;

export const TaskList = z.object({
  status: z.enum(['open', 'todo', 'in_progress', 'done', 'cancelled', 'all']).default('open'),
  mine: z.enum(['true']).optional(),
  assigneeId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  label: z.string().max(30).optional(),
  due: z.enum(['overdue', 'today', 'week', 'none']).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().uuid().optional(),
});

const event = (ctx: TenantCtx, taskId: string, type: string, body?: string | null, data?: Prisma.InputJsonValue) =>
  db().taskEvent.create({ data: { tenantId: ctx.tenantId, taskId, actorId: ctx.userId, type, body: body ?? null, data } });

const TASK_SCOPE = ['t.created_by', 't.assignee_id'];

/** Every top-level task in scope with its project, people, subtasks, checklist, comments and time */
export async function listTasks(ctx: TenantCtx, q: z.infer<typeof TaskList>) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`
      select t.*, t.status::text as status, t.priority::text as priority,
        (select count(*)::int from tasks s where s.parent_id = t.id) as sub_total,
        (select count(*)::int from tasks s where s.parent_id = t.id and s.status = 'done') as sub_done,
        (select count(*)::int from task_events e where e.task_id = t.id and e.type = 'comment') as comments,
        (select coalesce(sum(m.minutes), 0)::int from task_times m where m.task_id = t.id) as logged_min,
        (select max(e.at) from task_events e where e.task_id = t.id) as last_activity_at
      from tasks t where t.tenant_id = ${t}::uuid and t.parent_id is null ${ownScope(ctx, TASK_SCOPE)}
      order by t.id desc limit 5000`,
    projects: Prisma.sql`select id, name, color, status from task_projects where tenant_id = ${t}::uuid`,
    contacts: Prisma.sql`select id, name, company_name, type from contacts where tenant_id = ${t}::uuid and id in (select contact_id from tasks where tenant_id = ${t}::uuid and contact_id is not null)`,
    week: Prisma.sql`select coalesce(sum(minutes), 0)::int as minutes from task_times where tenant_id = ${t}::uuid and work_date >= ${weekStart(todayIST())}::date and (user_id = ${ctx.userId}::uuid)`,
    ...userPart(t),
  });
  const project = new Map(b.projects.map((p) => [p.id as string, p]));
  const contact = new Map(b.contacts.map((c) => [c.id as string, c]));
  const user = userNames(b);
  const today = todayIST();
  const weekEnd = addDays(today, 7);
  type T = Row & { id: string; status: string; priority: string; assigneeId: string | null; dueDay: string | null; labels: string[] };
  const all: T[] = b.rows.map((r) => {
    const list = (Array.isArray(r.checklist) ? r.checklist : []) as { done: boolean }[];
    const p = r.projectId ? project.get(r.projectId) : null;
    const c = r.contactId ? contact.get(r.contactId) : null;
    const open = r.status === 'todo' || r.status === 'in_progress';
    const dueDay = istDay(r.dueAt);
    return {
      ...r, id: r.id as string, status: r.status as string, priority: r.priority as string, assigneeId: r.assigneeId ?? null, labels: (r.labels ?? []) as string[], dueDay,
      project: p ? { id: p.id, name: p.name, color: p.color } : null,
      contact: c ? { id: c.id, name: c.companyName || c.name, type: c.type } : null,
      assigneeName: r.assigneeId ? user.get(r.assigneeId) ?? null : null,
      createdByName: r.createdBy ? user.get(r.createdBy) ?? null : null,
      checklistDone: list.filter((x) => x.done).length, checklistTotal: list.length,
      subtaskCount: r.subTotal, subtaskDone: r.subDone,
      overdue: open && !!dueDay && dueDay < today,
      overdueDays: open && dueDay && dueDay < today ? Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${dueDay}T00:00:00Z`).getTime()) / DAY) : 0,
    };
  });
  const s = q.q?.toLowerCase();
  // Tabs count everything matching the project, person, priority, label and search
  const base = all.filter((r) =>
    (!q.projectId || r.projectId === q.projectId) && (!q.assigneeId || r.assigneeId === q.assigneeId) && (!q.contactId || r.contactId === q.contactId)
    && (!q.priority || r.priority === q.priority) && (!q.label || r.labels.includes(q.label))
    && (!s || [r.title, r.description, r.project?.name, r.contact?.name, ...r.labels].some((v) => typeof v === 'string' && v.toLowerCase().includes(s))));
  const isOpen = (r: T) => r.status === 'todo' || r.status === 'in_progress';
  const open = base.filter(isOpen);
  const weekAgo = Date.now() - 7 * DAY;
  const counts = {
    open: open.length, todo: base.filter((r) => r.status === 'todo').length, in_progress: base.filter((r) => r.status === 'in_progress').length,
    mine: open.filter((r) => r.assigneeId === ctx.userId).length,
    today: open.filter((r) => r.dueDay === today).length, overdue: open.filter((r) => !!r.dueDay && r.dueDay < today).length,
    week: open.filter((r) => !!r.dueDay && r.dueDay > today && r.dueDay <= weekEnd).length, nodate: open.filter((r) => !r.dueDay).length,
    done: base.filter((r) => r.status === 'done').length, cancelled: base.filter((r) => r.status === 'cancelled').length, all: base.length,
  };
  const sums = {
    doneThisWeek: base.filter((r) => r.status === 'done' && r.completedAt && new Date(r.completedAt).getTime() >= weekAgo).length,
    urgent: open.filter((r) => r.priority === 'urgent' || r.priority === 'high').length,
    myWeekMinutes: b.week[0]?.minutes ?? 0,
    labels: [...new Set(all.flatMap((r) => r.labels))].sort(),
  };
  const rows = base.filter((r) =>
    (q.status === 'open' ? isOpen(r) : q.status === 'all' ? true : r.status === q.status)
    && (q.mine !== 'true' || r.assigneeId === ctx.userId)
    && (q.due === 'overdue' ? !!r.dueDay && r.dueDay < today : q.due === 'today' ? r.dueDay === today : q.due === 'week' ? !!r.dueDay && r.dueDay > today && r.dueDay <= weekEnd : q.due === 'none' ? !r.dueDay : true))
    .sort((a, c) => (q.status === 'open' || q.due ? (a.dueDay ?? '9999').localeCompare(c.dueDay ?? '9999') || (a.position as number) - (c.position as number) : 0));
  return { ...page(rows, q.limit, q.cursor), counts, sums };
}

async function scoped(ctx: TenantCtx, id: string) {
  const task = await db().task.findUnique({ where: { id } });
  if (!task) throw notFound('Task');
  if ((ctx.scope ?? 'own') === 'own' && task.createdBy !== ctx.userId && task.assigneeId !== ctx.userId) {
    // A subtask is visible to whoever sees its parent
    const parent = task.parentId ? await db().task.findUnique({ where: { id: task.parentId } }) : null;
    if (!parent || (parent.createdBy !== ctx.userId && parent.assigneeId !== ctx.userId)) throw notFound('Task');
  }
  return task;
}

/** One task with everything its page shows, in one round trip */
export async function getTask(ctx: TenantCtx, id: string) {
  await scoped(ctx, id);
  const t = ctx.tenantId;
  const b = await bundle({
    task: Prisma.sql`select t.*, t.status::text as status, t.priority::text as priority from tasks t where t.id = ${id}::uuid`,
    subtasks: Prisma.sql`select t.*, t.status::text as status, t.priority::text as priority from tasks t where t.parent_id = ${id}::uuid order by t.created_at`,
    events: Prisma.sql`select * from task_events where task_id = ${id}::uuid order by at`,
    times: Prisma.sql`select * from task_times where task_id = ${id}::uuid order by work_date desc, created_at desc`,
    project: Prisma.sql`select p.id, p.name, p.color from task_projects p join tasks t on t.project_id = p.id where t.id = ${id}::uuid`,
    contact: Prisma.sql`select c.id, c.name, c.company_name, c.phone, c.type from contacts c join tasks t on t.contact_id = c.id where t.id = ${id}::uuid`,
    parent: Prisma.sql`select p.id, p.title from tasks p join tasks t on t.parent_id = p.id where t.id = ${id}::uuid`,
    approvals: Prisma.sql`select id, number, title, status, amount_paise from approval_requests where task_id = ${id}::uuid order by created_at desc`,
    ...userPart(t),
  });
  const user = userNames(b);
  const r = b.task[0];
  const c = b.contact[0];
  const name = (uid: string | null) => (uid ? user.get(uid) ?? null : null);
  return {
    ...r,
    assigneeName: name(r.assigneeId), createdByName: name(r.createdBy),
    project: b.project[0] ?? null, parent: b.parent[0] ?? null,
    contact: c ? { id: c.id, name: c.companyName || c.name, phone: c.phone, type: c.type } : null,
    subtasks: b.subtasks.map((s) => ({ ...s, assigneeName: name(s.assigneeId) })),
    events: b.events.map((e) => ({ ...e, actorName: name(e.actorId) })),
    times: b.times.map((m) => ({ ...m, userName: name(m.userId) })),
    loggedMin: b.times.reduce((a, m) => a + (m.minutes as number), 0),
    approvals: b.approvals,
  };
}

async function checkLinks(ctx: TenantCtx, b: Partial<TaskInput>) {
  await activeUser(b.assigneeId, 'assigneeId');
  if (b.projectId && !(await db().taskProject.findFirst({ where: { id: b.projectId, tenantId: ctx.tenantId } }))) throw new AppError('VALIDATION_FAILED', 'Choose a project from the list.', { fields: { projectId: 'Unknown project' } });
  if (b.contactId && !(await db().contact.findFirst({ where: { id: b.contactId, tenantId: ctx.tenantId } }))) throw new AppError('VALIDATION_FAILED', 'Choose a customer or lead from the list.', { fields: { contactId: 'Unknown' } });
  if (b.startOn && b.dueAt && istDay(new Date(b.dueAt))! < b.startOn) throw new AppError('VALIDATION_FAILED', "The due date can't be before the start date.", { fields: { dueAt: 'Before the start' } });
}
const cleanChecklist = (list?: z.infer<typeof ChecklistItem>[]) => list?.map((x) => ({ id: x.id || randomUUID().slice(0, 8), text: x.text, done: x.done }));
const listTitle = (t: Pick<Task, 'title'>) => (t.title.length > 60 ? `${t.title.slice(0, 57)}…` : t.title);

export async function createTask(ctx: TenantCtx, b: TaskInput) {
  await checkLinks(ctx, b);
  let projectId = b.projectId ?? null;
  if (b.parentId) {
    const parent = await scoped(ctx, b.parentId);
    if (parent.parentId) throw new AppError('VALIDATION_FAILED', 'Subtasks can only be one level deep.', { fields: { parentId: 'Invalid parent' } });
    projectId = projectId ?? parent.projectId;
  }
  const top = await db().task.aggregate({ where: { tenantId: ctx.tenantId, status: b.status ?? 'todo' }, _max: { position: true } });
  const task = await db().task.create({
    data: {
      tenantId: ctx.tenantId, title: b.title, description: b.description ?? null, status: b.status ?? 'todo', priority: b.priority ?? 'medium',
      startOn: b.startOn ? new Date(`${b.startOn}T00:00:00.000Z`) : null, dueAt: b.dueAt ? new Date(b.dueAt) : null, estimateMin: b.estimateMin ?? null,
      assigneeId: b.assigneeId === undefined ? ctx.userId : b.assigneeId, contactId: b.contactId ?? null, projectId, parentId: b.parentId ?? null,
      labels: b.labels ?? [], checklist: cleanChecklist(b.checklist) ?? [], repeat: b.repeat ?? 'none', position: (top._max.position ?? 0) + 10,
      createdBy: ctx.userId, completedAt: b.status === 'done' ? new Date() : null,
    },
  });
  await event(ctx, task.id, 'created');
  if (task.assigneeId && task.assigneeId !== ctx.userId) await notify(task.assigneeId, `New task: ${listTitle(task)}`, undefined, `/app/m/tasks/${task.id}`);
  return task;
}

/** When a repeating task is done, the next one is made with the same details and a fresh checklist */
async function nextRepeat(ctx: TenantCtx, t: Task) {
  if (t.repeat === 'none' || !t.dueAt) return;
  const due = new Date(t.dueAt);
  if (t.repeat === 'daily') due.setUTCDate(due.getUTCDate() + 1);
  else if (t.repeat === 'weekly') due.setUTCDate(due.getUTCDate() + 7);
  else due.setUTCMonth(due.getUTCMonth() + 1);
  const list = (Array.isArray(t.checklist) ? t.checklist : []) as { id: string; text: string }[];
  const next = await db().task.create({
    data: {
      tenantId: t.tenantId, title: t.title, description: t.description, status: 'todo', priority: t.priority, dueAt: due, estimateMin: t.estimateMin,
      assigneeId: t.assigneeId, contactId: t.contactId, projectId: t.projectId, labels: t.labels, checklist: list.map((x) => ({ ...x, done: false })),
      repeat: t.repeat, position: t.position, createdBy: t.createdBy,
    },
  });
  await event(ctx, next.id, 'created', `Repeats ${t.repeat}; made when the last one was done`);
}

export async function updateTask(ctx: TenantCtx, id: string, b: Partial<TaskInput> & { version?: number; position?: number }) {
  const t = await scoped(ctx, id);
  assertVersion(t.version, b.version, 'task');
  await checkLinks(ctx, { ...b, startOn: b.startOn ?? (t.startOn ? t.startOn.toISOString().slice(0, 10) : null), dueAt: b.dueAt === undefined ? t.dueAt?.toISOString() : b.dueAt });
  const { version: _v, parentId: _p, checklist, ...rest } = b;
  const updated = await db().task.update({
    where: { id: t.id },
    data: {
      ...rest,
      startOn: b.startOn === undefined ? undefined : b.startOn ? new Date(`${b.startOn}T00:00:00.000Z`) : null,
      dueAt: b.dueAt === undefined ? undefined : b.dueAt ? new Date(b.dueAt) : null,
      checklist: checklist === undefined ? undefined : cleanChecklist(checklist),
      completedAt: b.status === undefined ? undefined : b.status === 'done' ? (t.completedAt ?? new Date()) : null,
      version: { increment: 1 },
    },
  });
  if (b.status && b.status !== t.status) {
    await event(ctx, t.id, 'status', undefined, { from: t.status, to: b.status });
    if (b.status === 'done') {
      await nextRepeat(ctx, updated);
      if (t.createdBy && t.createdBy !== ctx.userId) await notify(t.createdBy, `Task done: ${listTitle(t)}`, undefined, `/app/m/tasks/${t.id}`);
    }
  }
  if (b.assigneeId !== undefined && b.assigneeId !== t.assigneeId) {
    await event(ctx, t.id, 'assigned', undefined, { to: b.assigneeId });
    if (b.assigneeId && b.assigneeId !== ctx.userId) await notify(b.assigneeId, `Task assigned to you: ${listTitle(t)}`, undefined, `/app/m/tasks/${t.id}`);
  }
  const edited = (['title', 'description', 'priority', 'dueAt', 'startOn', 'projectId', 'labels', 'estimateMin', 'repeat'] as const).filter((k) => b[k] !== undefined);
  if (edited.length) await event(ctx, t.id, 'edited', undefined, { fields: edited });
  return updated;
}

/** Tick or untick one checklist step without sending the whole task */
export async function toggleStep(ctx: TenantCtx, id: string, stepId: string, done: boolean) {
  const t = await scoped(ctx, id);
  const list = (Array.isArray(t.checklist) ? t.checklist : []) as { id: string; text: string; done: boolean }[];
  const step = list.find((x) => x.id === stepId);
  if (!step) throw notFound('Checklist step');
  step.done = done;
  await db().task.update({ where: { id: t.id }, data: { checklist: list, version: { increment: 1 } } });
  await event(ctx, t.id, 'checklist', step.text, { done });
  return { checklist: list };
}

export async function comment(ctx: TenantCtx, id: string, body: string) {
  const t = await scoped(ctx, id);
  const e = await event(ctx, t.id, 'comment', body);
  for (const uid of new Set([t.assigneeId, t.createdBy])) if (uid && uid !== ctx.userId) await notify(uid, `New comment on: ${listTitle(t)}`, body.slice(0, 120), `/app/m/tasks/${t.id}`);
  return e;
}

export async function duplicateTask(ctx: TenantCtx, id: string) {
  const t = await scoped(ctx, id);
  const list = (Array.isArray(t.checklist) ? t.checklist : []) as { id: string; text: string }[];
  return createTask(ctx, {
    title: `${t.title} (copy)`.slice(0, 200), description: t.description, priority: t.priority, dueAt: t.dueAt?.toISOString() ?? null, estimateMin: t.estimateMin,
    assigneeId: t.assigneeId, contactId: t.contactId, projectId: t.projectId, labels: t.labels, checklist: list.map((x) => ({ text: x.text, done: false })), repeat: 'none',
  });
}

/** History is kept: a task and its subtasks are cancelled, not deleted */
export async function cancelTask(ctx: TenantCtx, id: string) {
  const t = await scoped(ctx, id);
  await db().task.updateMany({ where: { OR: [{ id: t.id }, { parentId: t.id }], status: { not: 'done' } }, data: { status: 'cancelled', version: { increment: 1 } } });
  await event(ctx, t.id, 'status', undefined, { from: t.status, to: 'cancelled' });
}

// ---------------------------------------------------------------- projects

export const ProjectInput = z.object({
  name: z.string().trim().min(2, 'Name the project').max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, 'Use 2 to 12 letters, numbers or -').optional().nullable().or(z.literal('').transform(() => null)),
  description: z.string().trim().max(4000).optional().nullable(),
  contactId: z.string().uuid().optional().nullable(),
  ownerId: z.string().uuid({ message: 'Choose who runs it' }),
  memberIds: z.array(z.string().uuid()).max(100).default([]),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).default('active'),
  startOn: DateStr.optional().nullable(),
  dueOn: DateStr.optional().nullable(),
  budgetPaise: Paise.optional().nullable(),
  billable: z.boolean().default(false),
  hourlyRatePaise: Paise.optional().nullable(),
  color: z.string().max(12).default('blue'),
}).superRefine((v, c) => {
  if (v.startOn && v.dueOn && v.dueOn < v.startOn) c.addIssue({ code: 'custom', path: ['dueOn'], message: "Can't end before it starts" });
  if (v.billable && !v.hourlyRatePaise) c.addIssue({ code: 'custom', path: ['hourlyRatePaise'], message: 'Enter the rate per hour for billable work' });
});

const projectScope = (ctx: TenantCtx) =>
  (ctx.scope ?? 'own') === 'own' ? Prisma.sql`and (p.owner_id = ${ctx.userId}::uuid or p.created_by = ${ctx.userId}::uuid or ${ctx.userId}::uuid = any(p.member_ids))` : Prisma.empty;

export async function listProjects(ctx: TenantCtx, q: { status?: string; q?: string }) {
  const t = ctx.tenantId;
  const today = todayIST();
  const b = await bundle({
    rows: Prisma.sql`
      select p.*,
        (select count(*)::int from tasks k where k.project_id = p.id and k.parent_id is null and k.status <> 'cancelled') as task_total,
        (select count(*)::int from tasks k where k.project_id = p.id and k.parent_id is null and k.status = 'done') as task_done,
        (select count(*)::int from tasks k where k.project_id = p.id and k.status in ('todo', 'in_progress') and k.due_at < ${today}::date) as task_late,
        (select coalesce(sum(m.minutes), 0)::int from task_times m where m.project_id = p.id or m.task_id in (select id from tasks k where k.project_id = p.id)) as logged_min,
        (select coalesce(sum(m.minutes), 0)::int from task_times m where (m.project_id = p.id or m.task_id in (select id from tasks k where k.project_id = p.id)) and m.billable) as billable_min,
        (select max(e.at) from task_events e join tasks k on k.id = e.task_id where k.project_id = p.id) as last_activity_at
      from task_projects p where p.tenant_id = ${t}::uuid ${projectScope(ctx)} order by p.updated_at desc`,
    contacts: Prisma.sql`select id, name, company_name from contacts where tenant_id = ${t}::uuid and id in (select contact_id from task_projects where tenant_id = ${t}::uuid and contact_id is not null)`,
    ...userPart(t),
  });
  const contact = new Map(b.contacts.map((c) => [c.id as string, (c.companyName || c.name) as string]));
  const user = userNames(b);
  type P = Row & { id: string; status: string; loggedMin: number; billedPaise: bigint; late: boolean };
  const all: P[] = b.rows.map((p) => {
    const total = p.taskTotal as number;
    const loggedMin = p.loggedMin as number;
    const costPaise = p.hourlyRatePaise ? (big(p.hourlyRatePaise) * BigInt(p.billableMin as number)) / 60n : 0n;
    return {
      ...p, id: p.id as string, status: p.status as string,
      ownerName: p.ownerId ? user.get(p.ownerId) ?? null : null, customer: p.contactId ? contact.get(p.contactId) ?? null : null,
      members: ((p.memberIds ?? []) as string[]).map((m) => ({ id: m, name: user.get(m) ?? '' })),
      progress: total ? Math.round(((p.taskDone as number) / total) * 100) : 0,
      late: !['completed', 'cancelled'].includes(p.status) && !!p.dueOn && istDay(p.dueOn)! < today,
      billedPaise: costPaise,
      budgetUsedPct: p.budgetPaise && big(p.budgetPaise) > 0n ? Math.round((Number(costPaise) / Number(big(p.budgetPaise))) * 100) : null,
      loggedMin,
    };
  });
  const s = q.q?.toLowerCase();
  const base = all.filter((p) => !s || [p.name, p.code, p.customer, p.ownerName].some((v) => typeof v === 'string' && v.toLowerCase().includes(s)));
  const counts: Record<string, number> = { all: base.length, open: 0, late: 0 };
  for (const p of base) {
    counts[p.status] = (counts[p.status] ?? 0) + 1;
    if (['planning', 'active', 'on_hold'].includes(p.status)) counts.open++;
    if (p.late) counts.late++;
  }
  const open = base.filter((p) => ['planning', 'active', 'on_hold'].includes(p.status));
  const sums = {
    openTasks: open.reduce((a, p) => a + (p.taskTotal as number) - (p.taskDone as number), 0),
    lateTasks: open.reduce((a, p) => a + (p.taskLate as number), 0),
    loggedMin: base.reduce((a, p) => a + p.loggedMin, 0),
    billedPaise: base.reduce((a, p) => a + p.billedPaise, 0n),
  };
  const data = base.filter((p) => (q.status === 'open' || !q.status ? ['planning', 'active', 'on_hold'].includes(p.status) : q.status === 'all' ? true : q.status === 'late' ? p.late : p.status === q.status));
  return { data, counts, sums };
}

export async function getProject(ctx: TenantCtx, id: string) {
  const list = await listProjects(ctx, { status: 'all' });
  const p = list.data.find((x) => x.id === id);
  if (!p) throw notFound('Project');
  const b = await bundle({
    hours: Prisma.sql`
      select user_id, sum(minutes)::int as minutes, sum(minutes) filter (where billable)::int as billable_min from task_times
      where tenant_id = ${ctx.tenantId}::uuid and (project_id = ${id}::uuid or task_id in (select id from tasks where project_id = ${id}::uuid)) group by user_id`,
    events: Prisma.sql`
      select e.*, k.title as task_title from task_events e join tasks k on k.id = e.task_id
      where k.project_id = ${id}::uuid order by e.at desc limit 40`,
    ...userPart(ctx.tenantId),
  });
  const user = userNames(b);
  return {
    ...p,
    hours: b.hours.map((h) => ({ userId: h.userId, name: user.get(h.userId) ?? '', minutes: h.minutes, billableMin: h.billableMin ?? 0 })),
    events: b.events.map((e) => ({ ...e, actorName: e.actorId ? user.get(e.actorId) ?? null : null })),
  };
}

async function checkProject(ctx: TenantCtx, b: z.infer<typeof ProjectInput>, id?: string) {
  await activeUser(b.ownerId, 'ownerId');
  for (const m of b.memberIds) await activeUser(m, 'memberIds');
  if (b.contactId && !(await db().contact.findFirst({ where: { id: b.contactId, tenantId: ctx.tenantId } }))) throw new AppError('VALIDATION_FAILED', 'Choose a customer from the list.', { fields: { contactId: 'Unknown' } });
  const dup = await db().taskProject.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: b.name, mode: 'insensitive' }, id: id ? { not: id } : undefined } });
  if (dup) throw new AppError('VALIDATION_FAILED', 'A project with this name already exists.', { fields: { name: 'Already used' } });
}
const projectData = (b: z.infer<typeof ProjectInput>) => ({
  ...b, memberIds: [...new Set([...b.memberIds, b.ownerId])],
  startOn: b.startOn ? new Date(`${b.startOn}T00:00:00.000Z`) : null, dueOn: b.dueOn ? new Date(`${b.dueOn}T00:00:00.000Z`) : null,
  budgetPaise: b.budgetPaise == null ? null : BigInt(b.budgetPaise), hourlyRatePaise: b.hourlyRatePaise == null ? null : BigInt(b.hourlyRatePaise),
});

export async function createProject(ctx: TenantCtx, b: z.infer<typeof ProjectInput>) {
  await checkProject(ctx, b);
  const p = await db().taskProject.create({ data: { ...projectData(b), tenantId: ctx.tenantId, createdBy: ctx.userId } });
  for (const m of p.memberIds) if (m !== ctx.userId) await notify(m, `You are on the project: ${p.name}`, undefined, `/app/m/tasks/projects/${p.id}`);
  await audit({ action: 'tasks.project.create', entity: 'task_project', entityId: p.id, after: { name: p.name } });
  return p;
}

export async function updateProject(ctx: TenantCtx, id: string, b: z.infer<typeof ProjectInput>, version: number) {
  const p = await db().taskProject.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!p) throw notFound('Project');
  assertVersion(p.version, version, 'project');
  await checkProject(ctx, b, id);
  return db().taskProject.update({ where: { id }, data: { ...projectData(b), version: { increment: 1 } } });
}

export async function deleteProject(ctx: TenantCtx, id: string) {
  const p = await db().taskProject.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!p) throw notFound('Project');
  if (await db().task.count({ where: { projectId: id } })) throw new AppError('CONFLICT', 'This project has tasks. Mark it completed or cancelled instead.');
  await db().taskTime.updateMany({ where: { projectId: id }, data: { projectId: null } });
  await db().taskProject.delete({ where: { id } });
  await audit({ action: 'tasks.project.delete', entity: 'task_project', entityId: id, before: { name: p.name } });
}

// ---------------------------------------------------------------- time logs

export const TimeInput = z.object({
  taskId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  workDate: DateStr,
  minutes: z.number().int().min(5, 'At least 5 minutes').max(1440, 'At most 24 hours in a day'),
  note: z.string().trim().max(500).optional().nullable(),
  billable: z.boolean().default(false),
}).refine((v) => v.taskId || v.projectId, { path: ['taskId'], message: 'Choose the task or the project' });

export async function listTimes(ctx: TenantCtx, q: { from?: string; to?: string; userId?: string; projectId?: string }) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`
      select m.*, k.title as task_title, coalesce(m.project_id, k.project_id) as any_project_id
      from task_times m left join tasks k on k.id = m.task_id
      where m.tenant_id = ${t}::uuid ${ownScope(ctx, ['m.user_id', 'm.created_by'])}
        ${q.from ? Prisma.sql`and m.work_date >= ${q.from}::date` : Prisma.empty} ${q.to ? Prisma.sql`and m.work_date <= ${q.to}::date` : Prisma.empty}
      order by m.work_date desc, m.created_at desc limit 5000`,
    projects: Prisma.sql`select id, name, color, hourly_rate_paise from task_projects where tenant_id = ${t}::uuid`,
    ...userPart(t),
  });
  const project = new Map(b.projects.map((p) => [p.id as string, p]));
  const user = userNames(b);
  type M = Row & { id: string; minutes: number; workDate: Date; userId: string; userName: string; projectId: string | null; amountPaise: bigint };
  const all: M[] = b.rows.map((m) => {
    const p = m.anyProjectId ? project.get(m.anyProjectId) : null;
    return {
      ...m, id: m.id as string, minutes: m.minutes as number, workDate: m.workDate as Date, userId: m.userId as string,
      userName: user.get(m.userId) ?? '', project: p ? { id: p.id, name: p.name, color: p.color } : null, projectId: (m.anyProjectId as string | null) ?? null,
      task: m.taskId ? { id: m.taskId, title: m.taskTitle } : null,
      amountPaise: m.billable && p?.hourlyRatePaise ? (big(p.hourlyRatePaise) * BigInt(m.minutes)) / 60n : 0n,
    };
  });
  const data = all.filter((m) => (!q.userId || m.userId === q.userId) && (!q.projectId || m.projectId === q.projectId));
  const wk = weekStart(todayIST());
  const thisWeek = all.filter((m) => m.workDate.toISOString().slice(0, 10) >= wk);
  const lastWeek = all.filter((m) => { const d = m.workDate.toISOString().slice(0, 10); return d >= addDays(wk, -7) && d < wk; });
  const byPerson = new Map<string, number>();
  for (const m of thisWeek) byPerson.set(m.userName, (byPerson.get(m.userName) ?? 0) + m.minutes);
  const sum = (xs: typeof all) => xs.reduce((a, m) => a + m.minutes, 0);
  return {
    data,
    sums: {
      total: sum(data), billable: sum(data.filter((m) => m.billable)), amountPaise: data.reduce((a, m) => a + m.amountPaise, 0n),
      thisWeek: sum(thisWeek), lastWeek: sum(lastWeek), mine: sum(thisWeek.filter((m) => m.userId === ctx.userId)),
      people: [...byPerson.entries()].map(([name, minutes]) => ({ name, minutes })).sort((a, c) => c.minutes - a.minutes),
    },
  };
}

async function timeData(ctx: TenantCtx, b: z.infer<typeof TimeInput>) {
  if (b.workDate > todayIST()) throw new AppError('VALIDATION_FAILED', "Time can't be logged for a future day.", { fields: { workDate: 'In the future' } });
  const userId = b.userId ?? ctx.userId;
  if (userId !== ctx.userId && !(await canDo(ctx, 'tasks.task.edit'))) throw new AppError('PERMISSION_DENIED', 'You can log only your own time.');
  await activeUser(userId, 'userId');
  let projectId = b.projectId ?? null;
  if (b.taskId) {
    const task = await scoped(ctx, b.taskId);
    projectId = projectId ?? task.projectId;
  }
  if (projectId && !(await db().taskProject.findFirst({ where: { id: projectId, tenantId: ctx.tenantId } }))) throw new AppError('VALIDATION_FAILED', 'Choose a project from the list.', { fields: { projectId: 'Unknown project' } });
  const sameDay = await db().taskTime.aggregate({ where: { tenantId: ctx.tenantId, userId, workDate: new Date(`${b.workDate}T00:00:00.000Z`) }, _sum: { minutes: true } });
  if ((sameDay._sum.minutes ?? 0) + b.minutes > 1440) throw new AppError('VALIDATION_FAILED', 'That makes more than 24 hours on one day.', { fields: { minutes: 'Too much for one day' } });
  return { taskId: b.taskId ?? null, projectId, userId, workDate: new Date(`${b.workDate}T00:00:00.000Z`), minutes: b.minutes, note: b.note ?? null, billable: b.billable };
}

export async function logTime(ctx: TenantCtx, b: z.infer<typeof TimeInput>) {
  const data = await timeData(ctx, b);
  const m = await db().taskTime.create({ data: { ...data, tenantId: ctx.tenantId, createdBy: ctx.userId } });
  if (m.taskId) await event(ctx, m.taskId, 'time', b.note, { minutes: m.minutes, date: b.workDate });
  return m;
}

export async function deleteTime(ctx: TenantCtx, id: string) {
  const m = await db().taskTime.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!m) throw notFound('Time entry');
  if (m.userId !== ctx.userId && m.createdBy !== ctx.userId && !(await canDo(ctx, 'tasks.task.edit'))) throw new AppError('PERMISSION_DENIED', 'You can remove only your own time.');
  await db().taskTime.delete({ where: { id } });
}

// ---------------------------------------------------------------- approvals

export const ApprovalInput = z.object({
  title: z.string().trim().min(3, 'Say what needs approving').max(200),
  kind: z.enum(['expense', 'purchase', 'discount', 'leave', 'payment', 'other']).default('other'),
  amountPaise: Paise.optional().nullable(),
  details: z.string().trim().max(4000).optional().nullable(),
  attachmentUrl: z.string().url().max(500).optional().nullable().or(z.literal('').transform(() => null)),
  approverId: z.string().uuid({ message: 'Choose who approves it' }),
  needBy: DateStr.optional().nullable(),
  taskId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
}).superRefine((v, c) => {
  if (['expense', 'purchase', 'discount', 'payment'].includes(v.kind) && !v.amountPaise) c.addIssue({ code: 'custom', path: ['amountPaise'], message: 'Enter the amount' });
});

export async function listApprovals(ctx: TenantCtx, q: { view?: string; q?: string }) {
  const t = ctx.tenantId;
  const seeAll = (ctx.scope ?? 'own') === 'all' && (await canDo(ctx, 'tasks.approval.approve'));
  const b = await bundle({
    rows: Prisma.sql`
      select a.*, k.title as task_title, p.name as project_name from approval_requests a
      left join tasks k on k.id = a.task_id left join task_projects p on p.id = a.project_id
      where a.tenant_id = ${t}::uuid ${seeAll ? Prisma.empty : Prisma.sql`and (a.requested_by = ${ctx.userId}::uuid or a.approver_id = ${ctx.userId}::uuid)`}
      order by a.created_at desc limit 3000`,
    ...userPart(t),
  });
  const user = userNames(b);
  const today = todayIST();
  type A = Row & { id: string; status: string; late: boolean; mine: boolean; forMe: boolean };
  const all: A[] = b.rows.map((a) => ({
    ...a, id: a.id as string, status: a.status as string,
    requestedByName: user.get(a.requestedBy) ?? '', approverName: user.get(a.approverId) ?? '',
    task: a.taskId ? { id: a.taskId, title: a.taskTitle } : null, project: a.projectId ? { id: a.projectId, name: a.projectName } : null,
    late: a.status === 'pending' && !!a.needBy && (a.needBy as Date).toISOString().slice(0, 10) < today,
    waitingDays: a.status === 'pending' ? Math.floor((Date.now() - new Date(a.createdAt).getTime()) / DAY) : 0,
    mine: a.requestedBy === ctx.userId, forMe: a.approverId === ctx.userId,
  }));
  const s = q.q?.toLowerCase();
  const base = all.filter((a) => !s || [a.number, a.title, a.details, a.requestedByName, a.approverName].some((v) => typeof v === 'string' && v.toLowerCase().includes(s)));
  const counts = {
    waiting: base.filter((a) => a.forMe && a.status === 'pending').length, mine: base.filter((a) => a.mine).length,
    pending: base.filter((a) => a.status === 'pending').length, approved: base.filter((a) => a.status === 'approved').length,
    rejected: base.filter((a) => a.status === 'rejected').length, withdrawn: base.filter((a) => a.status === 'withdrawn').length, all: base.length,
  };
  const monthStart = `${today.slice(0, 7)}-01`;
  const sums = {
    pendingPaise: base.filter((a) => a.status === 'pending').reduce((x, a) => x + big(a.amountPaise), 0n),
    approvedMonthPaise: base.filter((a) => a.status === 'approved' && a.decidedAt && istDay(new Date(a.decidedAt))! >= monthStart).reduce((x, a) => x + big(a.amountPaise), 0n),
    late: base.filter((a) => a.late).length,
    avgHours: (() => { const done = base.filter((a) => a.decidedAt); return done.length ? Math.round(done.reduce((x, a) => x + (new Date(a.decidedAt).getTime() - new Date(a.createdAt).getTime()), 0) / done.length / 3_600_000) : 0; })(),
  };
  const data = base.filter((a) => (q.view === 'waiting' ? a.forMe && a.status === 'pending' : q.view === 'mine' ? a.mine : q.view && q.view !== 'all' ? a.status === q.view : true));
  return { data, counts, sums };
}

export async function requestApproval(ctx: TenantCtx, b: z.infer<typeof ApprovalInput>) {
  await activeUser(b.approverId, 'approverId');
  if (b.approverId === ctx.userId) throw new AppError('VALIDATION_FAILED', "You can't approve your own request. Choose someone else.", { fields: { approverId: 'Choose someone else' } });
  const approverRole = await db().tenantMember.findFirst({ where: { userId: b.approverId, status: 'active' }, select: { roleId: true } });
  if (!approverRole || !(await getRolePermissions(approverRole.roleId)).has('tasks.approval.approve')) {
    throw new AppError('VALIDATION_FAILED', 'This person is not allowed to approve. Choose someone whose role can.', { fields: { approverId: 'Cannot approve' } });
  }
  if (b.taskId) await scoped(ctx, b.taskId);
  const count = await db().approvalRequest.count({ where: { tenantId: ctx.tenantId } });
  const a = await db().approvalRequest.create({
    data: {
      tenantId: ctx.tenantId, number: `APR-${String(count + 1).padStart(4, '0')}`, title: b.title, kind: b.kind, amountPaise: b.amountPaise == null ? null : BigInt(b.amountPaise),
      details: b.details ?? null, attachmentUrl: b.attachmentUrl ?? null, requestedBy: ctx.userId, approverId: b.approverId,
      needBy: b.needBy ? new Date(`${b.needBy}T00:00:00.000Z`) : null, taskId: b.taskId ?? null, projectId: b.projectId ?? null,
    },
  });
  await notify(b.approverId, `Approval needed: ${a.title}`, b.amountPaise ? `₹${(b.amountPaise / 100).toLocaleString('en-IN')}` : undefined, '/app/m/tasks/approvals?view=waiting');
  await audit({ action: 'tasks.approval.create', entity: 'approval_request', entityId: a.id, after: { number: a.number, title: a.title } });
  return a;
}

export async function decideApproval(ctx: TenantCtx, id: string, decision: 'approved' | 'rejected', note: string | null | undefined, version: number) {
  const a = await db().approvalRequest.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Approval request');
  assertVersion(a.version, version, 'approval request');
  if (a.status !== 'pending') throw new AppError('CONFLICT', `This request is already ${a.status}.`);
  if (a.approverId !== ctx.userId) throw new AppError('PERMISSION_DENIED', 'Only the person named as approver can decide this request.');
  if (decision === 'rejected' && !note?.trim()) throw new AppError('VALIDATION_FAILED', 'Say why it is rejected.', { fields: { note: 'Required when rejecting' } });
  const done = await db().approvalRequest.update({ where: { id }, data: { status: decision, decisionNote: note?.trim() || null, decidedAt: new Date(), version: { increment: 1 } } });
  await notify(a.requestedBy, `${decision === 'approved' ? 'Approved' : 'Rejected'}: ${a.title}`, note ?? undefined, '/app/m/tasks/approvals?view=mine');
  if (a.taskId) await event(ctx, a.taskId, 'approval', note ?? null, { number: a.number, decision });
  await audit({ action: `tasks.approval.${decision}`, entity: 'approval_request', entityId: id, after: { number: a.number, note } });
  return done;
}

export async function withdrawApproval(ctx: TenantCtx, id: string) {
  const a = await db().approvalRequest.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Approval request');
  if (a.requestedBy !== ctx.userId) throw new AppError('PERMISSION_DENIED', 'Only the person who asked can withdraw it.');
  if (a.status !== 'pending') throw new AppError('CONFLICT', `This request is already ${a.status}.`);
  return db().approvalRequest.update({ where: { id }, data: { status: 'withdrawn', decidedAt: new Date(), version: { increment: 1 } } });
}

/** Active people of the business, for assignee, owner, member and approver pickers */
export async function people(ctx: TenantCtx) {
  const members = await db().tenantMember.findMany({ where: { status: 'active' }, include: { user: { select: { id: true, name: true, email: true } }, role: { select: { id: true, name: true } } } });
  const out = [];
  for (const m of members) out.push({ id: m.user.id, name: m.user.name, email: m.user.email, role: m.role.name, canApprove: (await getRolePermissions(m.role.id)).has('tasks.approval.approve') });
  return { data: out.sort((a, c) => a.name.localeCompare(c.name)), me: ctx.userId };
}
