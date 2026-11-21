import { scopeSql } from '../../kernel/query';
import { Prisma } from '@prisma/client';
import { bundle, userNames, userPart, type Row } from '../../kernel/bundle';
import type { TenantCtx } from '../../kernel/context';
import { todayIST } from '../../kernel/gst';

// CRM lists in ONE database round trip each (kernel/bundle): leads, deals and tasks with their
// stage, owner, contact, tasks and last activity, plus the counts and totals for the tabs and cards.
// Filters run here, so counts describe the whole pipeline, not the page.

const DAY = 86_400_000;
const big = (v: unknown) => (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v ?? 0))));
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
function page<T extends { id: string }>(rows: T[], limit: number, cursor?: string) {
  const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
  const data = rows.slice(start, start + limit);
  return { data, nextCursor: start + limit < rows.length ? data[data.length - 1]?.id ?? null : null, total: rows.length };
}
/** Data scope as SQL: own = created by or owned by the user */
function ownerScope(ctx: TenantCtx, alias: string, owner: string[], branch?: string) {
  return scopeSql(ctx, owner.map((f) => `${alias}.${f}`), branch ? `${alias}.${branch}` : undefined);
}
/** Tasks done and total per contact or deal, and the last activity of any kind */
const taskPart = (t: string, key: 'contact_id' | 'deal_id') => Prisma.sql`
  select ${Prisma.raw(key)} as id, count(*) filter (where type::text in ('task', 'follow_up'))::int as total,
    count(*) filter (where type::text in ('task', 'follow_up') and completed_at is not null)::int as done,
    count(*) filter (where type::text in ('task', 'follow_up') and completed_at is null and due_at < now())::int as late,
    max(created_at) as last_activity_at
  from activities where tenant_id = ${t}::uuid and ${Prisma.raw(key)} is not null ${key === 'contact_id' ? Prisma.sql`and deal_id is null` : Prisma.empty}
  group by ${Prisma.raw(key)}`;

// ---------------------------------------------------------------- leads

export interface LeadQuery {
  status?: string; pipelineId?: string; stageId?: string; ownerId?: string; source?: string; label?: string;
  followUp?: 'today' | 'overdue' | 'week' | 'none'; q?: string; limit: number; cursor?: string;
}

export async function listLeads(ctx: TenantCtx, q: LeadQuery) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`select c.* from contacts c where c.tenant_id = ${t}::uuid and c.type = 'lead' ${ownerScope(ctx, 'c', ['created_by', 'owner_id'], 'branch_id')} order by c.id desc limit 5000`,
    stages: Prisma.sql`select id, name, color, position, probability, kind from crm_stages where tenant_id = ${t}::uuid`,
    tasks: taskPart(t, 'contact_id'),
    deals: Prisma.sql`select lead_id as id, count(*)::int as n, sum(value_paise) as value_paise from deals where tenant_id = ${t}::uuid and lead_id is not null group by lead_id`,
    ...userPart(t),
  });
  const stage = new Map(b.stages.map((s) => [s.id as string, s]));
  const tasks = new Map(b.tasks.map((x) => [x.id as string, x]));
  const deals = new Map(b.deals.map((x) => [x.id as string, x]));
  const user = userNames(b);
  const today = day(todayIST());
  const week = new Date(today.getTime() + 7 * DAY);
  const monthStart = new Date(today.getTime() - (today.getUTCDate() - 1) * DAY);

  type Lead = Row & { id: string; leadStatus: string; followUpOn: Date | null; createdAt: Date; valuePaise: bigint | null; ownerId: string | null };
  const all: Lead[] = b.rows.map((c) => {
    const x = tasks.get(c.id);
    const d = deals.get(c.id);
    return {
      ...c, id: c.id as string, leadStatus: c.leadStatus as string, followUpOn: c.followUpOn ?? null, createdAt: c.createdAt as Date, valuePaise: c.valuePaise == null ? null : big(c.valuePaise), ownerId: c.ownerId ?? null,
      stage: c.stageId ? stage.get(c.stageId) ?? null : null,
      owner: c.ownerId ? { id: c.ownerId, name: user.get(c.ownerId) ?? '' } : null,
      tasks: { done: x?.done ?? 0, total: x?.total ?? 0 }, lateTasks: x?.late ?? 0,
      lastActivityAt: x?.lastActivityAt ?? null,
      ageDays: Math.max(0, Math.round((today.getTime() - day((c.createdAt as Date).toISOString().slice(0, 10)).getTime()) / DAY)),
      dealCount: d?.n ?? 0, dealValuePaise: d ? big(d.valuePaise) : 0n,
    };
  });

  // Tabs count within the pipeline and the other filters; the status/follow-up tabs are what differ
  const isOpen = (l: Lead) => l.leadStatus !== 'converted' && l.leadStatus !== 'lost';
  const s = q.q?.toLowerCase();
  const base = all.filter((l) =>
    (!q.pipelineId || l.pipelineId === q.pipelineId) && (!q.stageId || l.stageId === q.stageId) && (!q.source || l.leadSource === q.source)
    && (!q.label || (l.labels ?? []).includes(q.label))
    && (!s || [l.name, l.companyName, l.subject, l.phone, l.email].some((v) => typeof v === 'string' && v.toLowerCase().includes(s))));
  const open = base.filter(isOpen);
  const counts = {
    open: open.length, mine: open.filter((l) => l.ownerId === ctx.userId).length,
    today: open.filter((l) => l.followUpOn?.getTime() === today.getTime()).length,
    overdue: open.filter((l) => !!l.followUpOn && l.followUpOn < today).length,
    nofollow: open.filter((l) => !l.followUpOn).length,
    converted: base.filter((l) => l.leadStatus === 'converted').length, lost: base.filter((l) => l.leadStatus === 'lost').length, all: base.length,
  };
  const closed = counts.converted + counts.lost;
  const sums = {
    openValue: open.reduce((a, l) => a + (l.valuePaise ?? 0n), 0n),
    newThisMonth: base.filter((l) => l.createdAt >= monthStart).length,
    convertedThisMonth: base.filter((l) => l.leadStatus === 'converted' && l.convertedAt && new Date(l.convertedAt) >= monthStart).length,
    conversionPct: closed ? Math.round((counts.converted / closed) * 100) : 0,
    lateTasks: open.reduce((a, l) => a + (l.lateTasks as number), 0),
  };
  const rows = base.filter((l) =>
    (!q.status || q.status === 'open' ? isOpen(l) : q.status === 'all' ? true : l.leadStatus === q.status)
    && (!q.ownerId || l.ownerId === q.ownerId)
    && (q.followUp === 'today' ? l.followUpOn?.getTime() === today.getTime() : q.followUp === 'overdue' ? !!l.followUpOn && l.followUpOn < today
      : q.followUp === 'week' ? !!l.followUpOn && l.followUpOn >= today && l.followUpOn <= week : q.followUp === 'none' ? !l.followUpOn : true));
  return { ...page(rows, q.limit, q.cursor), counts, sums };
}

// ---------------------------------------------------------------- deals

export interface DealQuery {
  pipelineId?: string; stageId?: string; status?: 'open' | 'won' | 'lost'; ownerId?: string; contactId?: string; due?: 'closing' | 'late';
  q?: string; limit: number; cursor?: string;
}

export async function listDeals(ctx: TenantCtx, q: DealQuery) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`select d.* from deals d where d.tenant_id = ${t}::uuid ${ownerScope(ctx, 'd', ['created_by', 'owner_id'])} ${q.contactId ? Prisma.sql`and d.contact_id = ${q.contactId}::uuid` : Prisma.empty} order by d.id desc limit 5000`,
    contacts: Prisma.sql`select id, name, company_name, phone, email, type from contacts where tenant_id = ${t}::uuid and id in (select contact_id from deals where tenant_id = ${t}::uuid)`,
    stages: Prisma.sql`select * from crm_stages where tenant_id = ${t}::uuid`,
    tasks: taskPart(t, 'deal_id'),
    ...userPart(t),
  });
  const contact = new Map(b.contacts.map((c) => [c.id as string, c]));
  const stage = new Map(b.stages.map((s) => [s.id as string, s]));
  const tasks = new Map(b.tasks.map((x) => [x.id as string, x]));
  const user = userNames(b);
  const today = day(todayIST());
  const in30 = new Date(today.getTime() + 30 * DAY);
  const monthStart = new Date(today.getTime() - (today.getUTCDate() - 1) * DAY);

  type Deal = Row & { id: string; status: string; valuePaise: bigint; expectedCloseOn: Date | null; ownerId: string | null };
  const all: Deal[] = b.rows.map((d) => {
    const x = tasks.get(d.id);
    const st = stage.get(d.stageId) ?? null;
    const c = contact.get(d.contactId);
    const value = big(d.valuePaise);
    return {
      ...d, id: d.id as string, status: d.status as string, valuePaise: value, expectedCloseOn: d.expectedCloseOn ?? null, ownerId: d.ownerId ?? null,
      contact: c ? { id: c.id, name: c.name, companyName: c.companyName ?? null, phone: c.phone ?? null, email: c.email ?? null, type: c.type } : null,
      stage: st, owner: d.ownerId ? { id: d.ownerId, name: user.get(d.ownerId) ?? '' } : null,
      tasks: { done: x?.done ?? 0, total: x?.total ?? 0 }, lateTasks: x?.late ?? 0, lastActivityAt: x?.lastActivityAt ?? null,
      // What the deal is worth at its stage's chance of winning
      weightedPaise: d.status === 'open' && st?.probability != null ? (value * BigInt(st.probability)) / 100n : d.status === 'won' ? value : 0n,
      late: d.status === 'open' && !!d.expectedCloseOn && d.expectedCloseOn < today,
      ageDays: Math.max(0, Math.round((today.getTime() - day((d.createdAt as Date).toISOString().slice(0, 10)).getTime()) / DAY)),
    };
  });

  const s = q.q?.toLowerCase();
  const base = all.filter((d) =>
    (!q.pipelineId || d.pipelineId === q.pipelineId) && (!q.stageId || d.stageId === q.stageId) && (!q.ownerId || d.ownerId === q.ownerId)
    && (!s || [d.title, d.contact?.name, d.contact?.companyName, d.contact?.phone].some((v) => typeof v === 'string' && v.toLowerCase().includes(s))));
  const open = base.filter((d) => d.status === 'open');
  const won = base.filter((d) => d.status === 'won');
  const lost = base.filter((d) => d.status === 'lost');
  const closing = open.filter((d) => !!d.expectedCloseOn && d.expectedCloseOn >= today && d.expectedCloseOn <= in30);
  const counts = { all: base.length, open: open.length, mine: open.filter((d) => d.ownerId === ctx.userId).length, won: won.length, lost: lost.length, closing: closing.length, late: open.filter((d) => d.late).length };
  const sum = (xs: Deal[], k: 'valuePaise' | 'weightedPaise' = 'valuePaise') => xs.reduce((a, d) => a + (d[k] as bigint), 0n);
  const wonMonth = won.filter((d) => d.closedAt && new Date(d.closedAt) >= monthStart);
  const sums = {
    open: sum(open), weighted: sum(open, 'weightedPaise'), won: sum(won), wonMonth: sum(wonMonth), wonMonthCount: wonMonth.length, lost: sum(lost), closing: sum(closing),
    winPct: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0,
    avgWon: won.length ? sum(won) / BigInt(won.length) : 0n,
  };
  const rows = base.filter((d) =>
    (!q.status || d.status === q.status)
    && (q.due === 'closing' ? closing.includes(d) : q.due === 'late' ? d.late : true));
  return { ...page(rows, q.limit, q.cursor), counts, sums };
}

// ---------------------------------------------------------------- tasks and follow-ups

export async function listFollowUps(ctx: TenantCtx, done: boolean) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`
      select a.*, a.type::text as type, c.name as contact_name, c.company_name as contact_company, c.phone as contact_phone, c.type as contact_type, d.title as deal_title
      from activities a
      left join contacts c on c.id = a.contact_id
      left join deals d on d.id = a.deal_id
      where a.tenant_id = ${t}::uuid and a.type::text in ('follow_up', 'task') ${ownerScope(ctx, 'a', ['assignee_id', 'created_by'])}
      order by a.due_at asc nulls last limit 3000`,
    ...userPart(t),
  });
  const user = userNames(b);
  const today = todayIST();
  const all = b.rows.map((a) => ({
    ...a, id: a.id as string, assigneeId: (a.assigneeId as string | null) ?? null, completedAt: a.completedAt ?? null, dueAt: a.dueAt ?? null,
    contact: a.contactId ? { id: a.contactId, name: a.contactCompany || a.contactName, phone: a.contactPhone ?? null, type: a.contactType } : null,
    deal: a.dealId ? { id: a.dealId, title: a.dealTitle } : null,
    assigneeName: a.assigneeId ? user.get(a.assigneeId) ?? null : null,
    createdByName: a.createdBy ? user.get(a.createdBy) ?? null : null,
  }));
  const open = all.filter((a) => !a.completedAt);
  const dayOf = (d: Date | null) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10) : null);
  const weekEnd = new Date(day(today).getTime() + 7 * DAY).toISOString().slice(0, 10);
  const counts = {
    open: open.length, done: all.length - open.length,
    overdue: open.filter((a) => (dayOf(a.dueAt) ?? '9999') < today).length,
    today: open.filter((a) => dayOf(a.dueAt) === today).length,
    week: open.filter((a) => { const d = dayOf(a.dueAt); return !!d && d > today && d <= weekEnd; }).length,
    mine: open.filter((a) => a.assigneeId === ctx.userId).length,
    doneThisWeek: all.filter((a) => a.completedAt && new Date(a.completedAt).getTime() >= Date.now() - 7 * DAY).length,
  };
  return { data: done ? all.filter((a) => a.completedAt) : open, counts };
}
