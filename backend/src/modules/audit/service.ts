import type { Prisma } from '@prisma/client';
import { currentCtx, db } from '../../kernel/db';
import { AUDIT_AREAS, areaOf, describeAction } from './describe';

// PLT-09: logins, role changes, plan changes, deletes, exports and financial actions.

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  tenantId?: string | null;
  actorId?: string | null;
  ip?: string;
  requestId?: string;
}

const json = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x))) as Prisma.InputJsonValue));

export async function audit(entry: AuditEntry) {
  const ctx = currentCtx();
  await db().auditLog.create({
    data: {
      tenantId: entry.tenantId !== undefined ? entry.tenantId : (ctx?.tenantId ?? null),
      actorKind: ctx?.kind === 'tenant' ? 'user' : (ctx?.kind ?? 'system'),
      actorId: entry.actorId !== undefined ? entry.actorId : (ctx?.userId ?? null),
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: json(entry.before),
      after: json(entry.after),
      ip: entry.ip ?? (ctx?.kind === 'tenant' ? ctx.ip : undefined),
      requestId: entry.requestId ?? (ctx?.kind === 'tenant' ? ctx.requestId : undefined),
    },
  });
}

export interface AuditQuery {
  limit: number;
  cursor?: string;
  action?: string;
  /** AUDIT_AREAS key */
  area?: string;
  actorId?: string;
  from?: string;
  to?: string;
  /** Who or what, in words */
  q?: string;
}

/** Settings › Audit log: newest first, in plain words, with filters by area, person, date and search */
export async function listAudit(opts: AuditQuery) {
  const area = opts.area ? AUDIT_AREAS[opts.area] : null;
  const where: Prisma.AuditLogWhereInput = {
    ...(opts.action ? { action: { startsWith: opts.action } } : {}),
    ...(area ? { OR: area.prefixes.map((p) => ({ action: { startsWith: p } })) } : {}),
    ...(opts.actorId ? { actorId: opts.actorId } : {}),
    // Dates are days in India
    ...(opts.from || opts.to ? { at: { ...(opts.from ? { gte: new Date(`${opts.from}T00:00:00+05:30`) } : {}), ...(opts.to ? { lte: new Date(`${opts.to}T23:59:59.999+05:30`) } : {}) } } : {}),
  };
  // A search is on the words people see (who, what), so it filters after the rows are read
  const q = opts.q?.trim().toLowerCase();
  const rows = await db().auditLog.findMany({
    where,
    orderBy: { id: 'desc' }, // UUID v7 ids sort by time
    take: q ? 2000 : opts.limit + 1,
    ...(!q && opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
  const actors = await db().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const names = new Map(actors.map((a) => [a.id, a.name]));
  const shaped = rows.map((r) => {
    const after = (r.after ?? {}) as Record<string, unknown>;
    const detail = ['number', 'name', 'title', 'email', 'section', 'kind'].map((k) => after[k]).find((v) => typeof v === 'string' && v.length < 80) as string | undefined;
    return { ...r, actorName: r.actorId ? names.get(r.actorId) ?? null : null, what: describeAction(r.action), area: areaOf(r.action), detail: detail ?? null };
  });
  const matched = q ? shaped.filter((r) => `${r.what} ${r.actorName ?? ''} ${r.detail ?? ''} ${r.action}`.toLowerCase().includes(q)) : shaped;
  const start = q && opts.cursor ? Math.max(0, matched.findIndex((r) => r.id === opts.cursor) + 1) : 0;
  const page = matched.slice(start, start + opts.limit);
  const more = q ? start + opts.limit < matched.length : rows.length > opts.limit;
  return { data: page, nextCursor: more ? page[page.length - 1]?.id ?? null : null };
}

/** The people who appear in the log, for the Who filter */
export async function auditPeople() {
  const ids = await db().auditLog.findMany({ where: { actorId: { not: null } }, distinct: ['actorId'], select: { actorId: true }, take: 500 });
  const users = await db().user.findMany({ where: { id: { in: ids.map((i) => i.actorId!) } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  return users;
}
