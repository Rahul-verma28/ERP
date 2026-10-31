import { z } from 'zod';
import type { TenantCtx } from './context';
import { AppError } from './errors';
import { db } from './db';
import { getEntitlements } from '../modules/subscription/entitlements';
import { getFieldAccess } from '../modules/access/service';
import type { PlanLimits } from '../contracts/plans';

// Shared helpers for business modules: data scope, pagination, limits, field access.

/**
 * LLD §4.3 — extra filter for the permission's data scope.
 * own: created by or assigned to the user · branch: in the member's branches (empty = all) · all: none.
 * `team` needs reporting lines from HR; until then it behaves like `own`.
 */
export function scopeWhere(ctx: TenantCtx, fields: { owner?: string[]; branch?: string } = {}): Record<string, unknown> {
  const scope = ctx.scope ?? 'own';
  if (scope === 'all') return {};
  if (scope === 'branch') {
    if (!fields.branch || ctx.branchIds.length === 0) return {};
    return { OR: [{ [fields.branch]: { in: ctx.branchIds } }, { [fields.branch]: null }] };
  }
  const owners = fields.owner ?? ['createdBy'];
  return { OR: owners.map((f) => ({ [f]: ctx.userId })) };
}

/** True when the record passes the scope check (for single-record reads/updates). */
export function inScope(ctx: TenantCtx, record: Record<string, unknown>, fields: { owner?: string[]; branch?: string } = {}) {
  const scope = ctx.scope ?? 'own';
  if (scope === 'all') return true;
  if (scope === 'branch') {
    if (!fields.branch || ctx.branchIds.length === 0) return true;
    const b = record[fields.branch] as string | null;
    return !b || ctx.branchIds.includes(b);
  }
  return (fields.owner ?? ['createdBy']).some((f) => record[f] === ctx.userId);
}

export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  /** Numbered pages (Console tables): skip/take and a total instead of a cursor */
  page: z.coerce.number().int().min(1).max(100_000).optional(),
});
export type ListQuery = z.infer<typeof ListQuery>;

/** Prisma paging args for a list: numbered page, or cursor over UUID v7 ids (newest first). */
export function listArgs<O>(q: { limit: number; cursor?: string; page?: number }, orderBy: O) {
  return q.page ? { orderBy, skip: (q.page - 1) * q.limit, take: q.limit } : { orderBy, take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) };
}

/** The rows to return and the next cursor (numbered pages have none; they carry a total). */
export function listPage<T extends { id: string }>(rows: T[], q: { limit: number; page?: number }) {
  const data = q.page ? rows : rows.slice(0, q.limit);
  return { data, nextCursor: !q.page && rows.length > q.limit ? data[data.length - 1].id : null };
}

/** Cursor pagination over UUID v7 ids (newest first). */
export function pageArgs(q: { limit: number; cursor?: string }) {
  return { take: q.limit + 1, orderBy: { id: 'desc' as const }, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) };
}

export function page<T extends { id: string }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit);
  return { data, nextCursor: rows.length > limit ? data[data.length - 1].id : null };
}

/** Records limit on create (contacts, items) — LLD §6.4 */
export async function assertRecordLimit(ctx: Pick<TenantCtx, 'tenantId'>, key: keyof PlanLimits, count: () => Promise<number>, label: string) {
  const ent = await getEntitlements(ctx.tenantId);
  const limit = ent.limits[key];
  if (limit === null || limit === undefined) return;
  if ((await count()) >= limit) {
    throw new AppError('LIMIT_REACHED', `Your plan allows up to ${limit.toLocaleString('en-IN')} ${label}. Upgrade to add more.`, { limit: key });
  }
}

/**
 * Monthly usage counter, incremented in the caller's transaction:
 * UPDATE ... SET used = used + 1 WHERE used < limit; zero rows = LIMIT_REACHED.
 */
export async function consumeMonthly(ctx: TenantCtx, metric: string, limit: number | null, label: string) {
  const period = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
  const tx = db();
  await tx.$executeRaw`INSERT INTO usage_counters (tenant_id, metric, period, used) VALUES (${ctx.tenantId}::uuid, ${metric}, ${period}, 0) ON CONFLICT DO NOTHING`;
  if (limit === null) {
    await tx.$executeRaw`UPDATE usage_counters SET used = used + 1 WHERE tenant_id = ${ctx.tenantId}::uuid AND metric = ${metric} AND period = ${period}`;
    return;
  }
  const n = await tx.$executeRaw`UPDATE usage_counters SET used = used + 1 WHERE tenant_id = ${ctx.tenantId}::uuid AND metric = ${metric} AND period = ${period} AND used < ${limit}`;
  if (n === 0) throw new AppError('LIMIT_REACHED', `Your plan allows ${limit} ${label} per month. Upgrade for unlimited.`, { limit: metric });
}

/** Remove sensitive fields the role may not see (ROL-04). */
export async function stripHidden<T extends Record<string, unknown>>(ctx: TenantCtx, entity: string, rows: T[], fields: Record<string, string>) {
  const access = await getFieldAccess(ctx.roleId);
  const hidden = Object.entries(fields).filter(([field]) => !access[`${entity}.${field}`] || access[`${entity}.${field}`] === 'hidden');
  if (!hidden.length) return rows;
  return rows.map((r) => {
    const copy = { ...r };
    for (const [, prop] of hidden) delete copy[prop];
    return copy;
  });
}

export async function canWriteField(ctx: TenantCtx, entity: string, field: string) {
  const access = await getFieldAccess(ctx.roleId);
  return access[`${entity}.${field}`] === 'write';
}

/** Mark an onboarding checklist step as done (merges into tenants.onboarding). */
export async function markOnboarding(ctx: Pick<TenantCtx, 'tenantId'>, key: 'firstCustomer' | 'firstItem' | 'firstInvoice') {
  await db().$executeRaw`UPDATE tenants SET onboarding = onboarding || jsonb_build_object(${key}::text, true) WHERE id = ${ctx.tenantId}::uuid AND NOT (onboarding ? ${key}::text)`;
}

/** Optimistic concurrency (LLD §1.1) */
export function assertVersion(current: number, sent: number | undefined, what = 'record') {
  if (sent !== undefined && current !== sent) {
    throw new AppError('VERSION_CONFLICT', `This ${what} was changed by someone else. Reload and try again.`);
  }
}

export const uuid = z.string().uuid();
export const IdParam = z.object({ id: uuid });
export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const Paise = z.number().int().min(0).max(1e13);
