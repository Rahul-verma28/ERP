import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db, prisma, withPlatform } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { ConsoleCtx } from '../../kernel/context';
import { normaliseMobile } from '../../kernel/crypto';
import { audit } from '../audit/service';
import { scopedTenantFilter, teamOf } from './service';

// Console › Sales (wireframe 6.5): prospects before signup, follow-ups on prospects and clients,
// and internal notes. Scope: own = mine, team = me + people reporting to me, all = everyone.

const DAY = 86_400_000;
export const STAGES = ['new', 'contacted', 'demo', 'trial', 'won', 'lost'] as const;

async function ownerIds(ctx: ConsoleCtx): Promise<string[] | null> {
  const scope = ctx.scope ?? 'own';
  if (scope === 'all') return null;
  if (scope === 'own') return [ctx.userId];
  const edges = await db().platformMember.findMany({ where: { status: 'active' }, select: { userId: true, reportsTo: true } });
  return teamOf(ctx.userId, edges);
}
const ownerWhere = (ids: string[] | null) => (ids ? { ownerUserId: { in: ids } } : {});

async function names(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length ? await db().user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return new Map(rows.map((u) => [u.id, u.name]));
}

// ── Prospects ──

export const ProspectInput = z.object({
  name: z.string().trim().min(2, 'Use 2–100 characters').max(100),
  businessName: z.string().trim().min(2, 'Use 2–120 characters').max(120),
  industryKey: z.string().trim().max(40).nullish(),
  city: z.string().trim().max(80).nullish(),
  mobile: z.union([z.literal('').transform(() => null), z.string().trim().transform(normaliseMobile).pipe(z.string().regex(/^\+91[6-9]\d{9}$/, 'Enter a 10-digit mobile starting with 6–9'))]).nullish(),
  email: z.union([z.literal('').transform(() => null), z.string().trim().toLowerCase().email('Enter a valid email')]).nullish(),
  source: z.string().trim().max(60).nullish(),
  ownerUserId: z.string().uuid().optional(),
});
export const ProspectPatch = ProspectInput.partial().extend({
  stage: z.enum(STAGES).optional(),
  lostReason: z.string().trim().min(3, 'Say why it was lost').max(300).nullish(),
});

export async function listProspects(ctx: ConsoleCtx, q: { stage?: string; search?: string }) {
  const ids = await ownerIds(ctx);
  const rows = await db().consoleProspect.findMany({
    where: {
      ...ownerWhere(ids),
      ...(q.stage ? { stage: q.stage } : {}),
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { businessName: { contains: q.search, mode: 'insensitive' } }, { mobile: { contains: q.search.replace(/\D/g, '') || q.search } }] } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 300,
    include: { followups: { where: { doneAt: null }, orderBy: { dueAt: 'asc' }, take: 1 } },
  });
  const owner = await names(rows.map((r) => r.ownerUserId));
  const tenants = await db().tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId).filter((x): x is string => !!x) } }, select: { id: true, status: true, subscription: { select: { trialEndsAt: true } } } });
  const tn = new Map(tenants.map((t) => [t.id, t]));
  return rows.map((r) => ({
    ...r,
    owner: owner.get(r.ownerUserId) ?? null,
    next: r.followups[0] ? { id: r.followups[0].id, title: r.followups[0].title, dueAt: r.followups[0].dueAt } : null,
    tenant: r.tenantId ? tn.get(r.tenantId) ?? null : null,
    followups: undefined,
  }));
}

async function prospectInScope(ctx: ConsoleCtx, id: string) {
  const ids = await ownerIds(ctx);
  const p = await db().consoleProspect.findFirst({ where: { id, ...ownerWhere(ids) } });
  if (!p) throw notFound('Prospect');
  return p;
}

async function assertOwner(ctx: ConsoleCtx, ownerUserId: string) {
  const ids = await ownerIds(ctx);
  if (ids && !ids.includes(ownerUserId)) throw new AppError('PERMISSION_DENIED', 'You can only give prospects to yourself or your team.');
  const m = await db().platformMember.findUnique({ where: { userId: ownerUserId } });
  if (!m || m.status !== 'active') throw new AppError('VALIDATION_FAILED', 'Choose an active Console user.', { fields: { ownerUserId: 'Choose an active Console user' } });
}

export async function createProspect(ctx: ConsoleCtx, input: z.infer<typeof ProspectInput>) {
  const ownerUserId = input.ownerUserId ?? ctx.userId;
  await assertOwner(ctx, ownerUserId);
  if (input.mobile) {
    const dup = await db().consoleProspect.findFirst({ where: { mobile: input.mobile, stage: { notIn: ['lost'] } }, select: { businessName: true } });
    if (dup) throw new AppError('CONFLICT', `${dup.businessName} already uses this mobile number.`, { fields: { mobile: `Already a prospect: ${dup.businessName}` } });
  }
  const row = await db().consoleProspect.create({ data: { ...input, ownerUserId, createdBy: ctx.userId, mobile: input.mobile ?? null, email: input.email ?? null } });
  await db().consoleFollowup.create({ data: { prospectId: row.id, title: 'First call', dueAt: new Date(Date.now() + DAY), ownerUserId, createdBy: ctx.userId } });
  await audit({ tenantId: null, actorId: ctx.userId, action: 'console.prospect.create', entity: 'prospect', entityId: row.id, after: { businessName: row.businessName } });
  return row;
}

export async function updateProspect(ctx: ConsoleCtx, id: string, patch: z.infer<typeof ProspectPatch>) {
  const before = await prospectInScope(ctx, id);
  if (patch.ownerUserId && patch.ownerUserId !== before.ownerUserId) await assertOwner(ctx, patch.ownerUserId);
  if (patch.stage === 'lost' && !patch.lostReason && !before.lostReason) throw new AppError('VALIDATION_FAILED', 'Say why it was lost.', { fields: { lostReason: 'Say why it was lost' } });
  const row = await db().consoleProspect.update({ where: { id }, data: { ...patch, lostReason: patch.stage && patch.stage !== 'lost' ? null : patch.lostReason } });
  if (patch.stage && patch.stage !== before.stage) {
    await audit({ tenantId: null, actorId: ctx.userId, action: 'console.prospect.stage', entity: 'prospect', entityId: id, before: { stage: before.stage }, after: { stage: patch.stage, lostReason: patch.lostReason ?? null } });
    // Done with the prospect: its open follow-ups close
    if (patch.stage === 'won' || patch.stage === 'lost') await db().consoleFollowup.updateMany({ where: { prospectId: id, doneAt: null }, data: { doneAt: new Date() } });
  }
  return row;
}

/** Link a prospect to the business that signed up with the same mobile (self signup or Console). */
export async function linkProspectsToTenants() {
  const open = await db().consoleProspect.findMany({ where: { tenantId: null, mobile: { not: null }, stage: { notIn: ['lost'] } }, select: { id: true, mobile: true } });
  let linked = 0;
  for (const p of open) {
    const user = await db().user.findUnique({ where: { mobile: p.mobile! }, select: { id: true } });
    if (!user) continue;
    const tenant = await db().tenant.findFirst({ where: { ownerUserId: user.id }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true } });
    if (!tenant) continue;
    await db().consoleProspect.update({ where: { id: p.id }, data: { tenantId: tenant.id, stage: ['active', 'past_due'].includes(tenant.status) ? 'won' : 'trial' } });
    linked++;
  }
  return linked;
}

// ── Follow-ups ──

export const FollowupInput = z.object({
  title: z.string().trim().min(2, 'Say what to do').max(200),
  dueAt: z.string().datetime({ offset: true }),
  prospectId: z.string().uuid().nullish(),
  tenantId: z.string().uuid().nullish(),
  ownerUserId: z.string().uuid().optional(),
});

export async function listFollowups(ctx: ConsoleCtx, q: { mine: boolean; days: number }) {
  const ids = q.mine ? [ctx.userId] : await ownerIds(ctx);
  const rows = await db().consoleFollowup.findMany({
    where: { ...ownerWhere(ids), doneAt: null, dueAt: { lt: new Date(Date.now() + q.days * DAY) } },
    orderBy: { dueAt: 'asc' },
    take: 100,
    include: { prospect: { select: { id: true, businessName: true } } },
  });
  const [owner, tenants] = await Promise.all([
    names(rows.map((r) => r.ownerUserId)),
    db().tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const tn = new Map(tenants.map((t) => [t.id, t.name]));
  return rows.map((r) => ({
    id: r.id, title: r.title, dueAt: r.dueAt, overdue: r.dueAt < new Date(), auto: !!r.autoKey,
    owner: owner.get(r.ownerUserId) ?? null,
    about: r.prospect ? { kind: 'prospect', id: r.prospect.id, name: r.prospect.businessName } : r.tenantId ? { kind: 'client', id: r.tenantId, name: tn.get(r.tenantId) ?? 'Client' } : null,
  }));
}

export async function createFollowup(ctx: ConsoleCtx, input: z.infer<typeof FollowupInput>) {
  if (!input.prospectId && !input.tenantId) throw new AppError('VALIDATION_FAILED', 'Pick a prospect or a client.', { fields: { tenantId: 'Pick a prospect or a client' } });
  if (input.prospectId) await prospectInScope(ctx, input.prospectId);
  if (input.tenantId) {
    const t = await db().tenant.findFirst({ where: { id: input.tenantId, ...(await scopedTenantFilter(ctx)) }, select: { id: true } });
    if (!t) throw notFound('Client');
  }
  const ownerUserId = input.ownerUserId ?? ctx.userId;
  await assertOwner(ctx, ownerUserId);
  return db().consoleFollowup.create({ data: { title: input.title, dueAt: new Date(input.dueAt), prospectId: input.prospectId ?? null, tenantId: input.tenantId ?? null, ownerUserId, createdBy: ctx.userId } });
}

export async function closeFollowup(ctx: ConsoleCtx, id: string, action: { done?: boolean; snoozeDays?: number }) {
  const ids = await ownerIds(ctx);
  const f = await db().consoleFollowup.findFirst({ where: { id, ...ownerWhere(ids) } });
  if (!f) throw notFound('Follow-up');
  if (action.snoozeDays) return db().consoleFollowup.update({ where: { id }, data: { dueAt: new Date(Math.max(Date.now(), f.dueAt.getTime()) + action.snoozeDays * DAY) } });
  return db().consoleFollowup.update({ where: { id }, data: { doneAt: action.done === false ? null : new Date() } });
}

/**
 * Automatic follow-ups (hourly with the billing jobs), each made once and given to whoever
 * brought the client in (or the first Super Admin when it signed up on its own):
 * trial with no invoice after 3 days, trial ending in 3 days, unpaid order over 7 days.
 */
export async function runAutoFollowups(now = new Date()) {
  const admin = await prisma.platformMember.findFirst({ where: { status: 'active', role: { key: 'super_admin' } }, orderBy: { joinedAt: 'asc' }, select: { userId: true } });
  const ownerOf = async (tenantId: string) => (await prisma.tenantAcquisition.findUnique({ where: { tenantId }, select: { acquiredByUserId: true } }))?.acquiredByUserId ?? admin?.userId ?? null;
  const make = async (autoKey: string, tenantId: string, title: string) => {
    const owner = await ownerOf(tenantId);
    if (!owner) return 0;
    try {
      await prisma.consoleFollowup.create({ data: { autoKey, tenantId, title, dueAt: now, ownerUserId: owner } });
      return 1;
    } catch (e) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002') return 0; // made before
      throw e;
    }
  };
  let made = 0;
  const trials = await prisma.tenant.findMany({ where: { status: 'trialing', isInternal: false, createdAt: { lt: new Date(now.getTime() - 3 * DAY) } }, select: { id: true, subscription: { select: { trialEndsAt: true } } } });
  const invoiced = new Set((await prisma.salesDocument.groupBy({ by: ['tenantId'], where: { tenantId: { in: trials.map((t) => t.id) }, kind: 'invoice', number: { not: null } } })).map((x) => x.tenantId));
  for (const t of trials) {
    if (!invoiced.has(t.id)) made += await make(`noinvoice:${t.id}`, t.id, 'No invoice 3 days after signup — offer a setup call');
    const end = t.subscription?.trialEndsAt;
    if (end && end.getTime() - now.getTime() < 3 * DAY && end > now) made += await make(`trialend:${t.id}:${end.toISOString().slice(0, 10)}`, t.id, 'Trial ends in 3 days — talk about a plan');
  }
  const unpaid = await prisma.platformOrder.findMany({ where: { status: 'awaiting_payment', createdAt: { lt: new Date(now.getTime() - 7 * DAY) } }, select: { id: true, tenantId: true } });
  for (const o of unpaid) made += await make(`unpaid:${o.id}`, o.tenantId, 'Order unpaid for 7 days — send the payment link again');
  const linked = await withPlatform(() => linkProspectsToTenants());
  return { made, linked };
}

// ── Notes ──

export const NoteInput = z.object({ body: z.string().trim().min(2, 'Write something').max(2000, 'Keep notes under 2,000 characters'), privateToTeam: z.boolean().default(false) });

export async function listNotes(ctx: ConsoleCtx, tenantId: string) {
  const team = (await ownerIds(ctx)) ?? null;
  const rows = await db().consoleNote.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100 });
  // "Private to my team" notes are visible to the author's team (and to everyone with All scope)
  const visible = rows.filter((r) => !r.privateToTeam || !team || team.includes(r.authorId) || r.authorId === ctx.userId);
  const author = await names(visible.map((r) => r.authorId));
  return visible.map((r) => ({ id: r.id, body: r.body, privateToTeam: r.privateToTeam, author: author.get(r.authorId) ?? null, mine: r.authorId === ctx.userId, createdAt: r.createdAt }));
}

export async function addNote(ctx: ConsoleCtx, tenantId: string, input: z.infer<typeof NoteInput>) {
  const row = await db().consoleNote.create({ data: { tenantId, body: input.body, privateToTeam: input.privateToTeam, authorId: ctx.userId } });
  await audit({ tenantId: null, actorId: ctx.userId, action: 'console.note.add', entity: 'tenant', entityId: tenantId });
  return row;
}
