import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { DateStr } from '../../kernel/query';
import { dateOnly, todayIST } from '../../kernel/gst';
import { withDefaults } from '../../contracts/workspace';
import { getRolePermissions } from '../access/service';
import { audit } from '../audit/service';
import { applyMove, defaultLocation, fromMilli, milli } from './engine';

// Godowns, the stock list, an item's ledger, and the entries people make by hand:
// opening stock, stock in (until Purchase), adjustments, transfers and counts.

const DAY = 86_400_000;
const Qty = z.number().positive('Enter more than 0').max(1e9);

// ---------------------------------------------------------------- godowns

export const LocationInput = z.object({ name: z.string().trim().min(2, 'Use at least 2 characters').max(60), isDefault: z.boolean().optional() });

export async function listLocations(ctx: TenantCtx) {
  await defaultLocation(ctx);
  const [rows, sums] = await Promise.all([
    db().stockLocation.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ isActive: 'desc' }, { isDefault: 'desc' }, { name: 'asc' }] }),
    db().stockBalance.groupBy({ by: ['locationId'], where: { tenantId: ctx.tenantId }, _sum: { valuePaise: true }, _count: { _all: true } }),
  ]);
  const items = await db().stockBalance.groupBy({ by: ['locationId'], where: { tenantId: ctx.tenantId, quantity: { not: 0 } }, _count: { _all: true } });
  return {
    data: rows.map((l) => ({
      ...l,
      valuePaise: sums.find((s) => s.locationId === l.id)?._sum.valuePaise ?? 0n,
      itemsInStock: items.find((s) => s.locationId === l.id)?._count._all ?? 0,
    })),
  };
}

export async function createLocation(ctx: TenantCtx, input: z.infer<typeof LocationInput>) {
  await defaultLocation(ctx);
  if (await db().stockLocation.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: input.name, mode: 'insensitive' } } })) {
    throw new AppError('VALIDATION_FAILED', 'A godown with this name already exists.', { fields: { name: 'Already used' } });
  }
  if (input.isDefault) await db().stockLocation.updateMany({ where: { tenantId: ctx.tenantId }, data: { isDefault: false } });
  const row = await db().stockLocation.create({ data: { tenantId: ctx.tenantId, name: input.name, isDefault: !!input.isDefault } });
  await audit({ action: 'inventory.warehouse.create', entity: 'stock_location', entityId: row.id, after: { name: row.name } });
  return row;
}

export const LocationPatch = LocationInput.partial().extend({ isActive: z.boolean().optional() });

export async function updateLocation(ctx: TenantCtx, id: string, input: z.infer<typeof LocationPatch>) {
  const loc = await db().stockLocation.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!loc) throw notFound('Godown');
  if (input.name && input.name.toLowerCase() !== loc.name.toLowerCase() && (await db().stockLocation.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: input.name, mode: 'insensitive' } } }))) {
    throw new AppError('VALIDATION_FAILED', 'A godown with this name already exists.', { fields: { name: 'Already used' } });
  }
  if (input.isActive === false) {
    if (loc.isDefault) throw new AppError('CONFLICT', 'Make another godown the default before closing this one.');
    if (await db().stockBalance.count({ where: { locationId: id, quantity: { not: 0 } } })) throw new AppError('CONFLICT', 'This godown still has stock. Transfer it or write it off first.');
  }
  if (input.isDefault) {
    if (input.isActive === false || !loc.isActive) throw new AppError('CONFLICT', 'A closed godown cannot be the default.');
    await db().stockLocation.updateMany({ where: { tenantId: ctx.tenantId }, data: { isDefault: false } });
  }
  const row = await db().stockLocation.update({ where: { id }, data: { name: input.name, isDefault: input.isDefault || undefined, isActive: input.isActive } });
  await audit({ action: 'inventory.warehouse.edit', entity: 'stock_location', entityId: id, before: { name: loc.name, isActive: loc.isActive }, after: input });
  return row;
}

// ---------------------------------------------------------------- stock list and ledger

export const StockQuery = z.object({ q: z.string().trim().max(100).optional(), locationId: z.string().uuid().optional(), low: z.enum(['true', 'false']).optional() });

/** Every tracked item with its stock, value and low-stock level. */
export async function stockSummary(ctx: TenantCtx, query: z.infer<typeof StockQuery>) {
  const items = await db().item.findMany({
    where: { tenantId: ctx.tenantId, trackStock: true, ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { sku: { contains: query.q, mode: 'insensitive' } }] } : {}) },
    select: { id: true, name: true, sku: true, unit: true, reorderLevel: true, isActive: true, pricePaise: true },
    orderBy: { name: 'asc' },
  });
  const balances = await db().stockBalance.findMany({ where: { tenantId: ctx.tenantId, itemId: { in: items.map((i) => i.id) }, ...(query.locationId ? { locationId: query.locationId } : {}) } });
  const rows = items.map((i) => {
    const mine = balances.filter((b) => b.itemId === i.id);
    const qty = mine.reduce((s, b) => s + milli(b.quantity), 0n);
    const value = mine.reduce((s, b) => s + b.valuePaise, 0n);
    const reorder = i.reorderLevel === null ? null : fromMilli(milli(i.reorderLevel));
    return {
      id: i.id, name: i.name, sku: i.sku, unit: i.unit, isActive: i.isActive, quantity: fromMilli(qty), valuePaise: value,
      averagePaise: qty > 0n ? (value * 1000n) / qty : 0n, reorderLevel: reorder, low: reorder !== null && fromMilli(qty) <= reorder,
    };
  });
  const data = query.low === 'true' ? rows.filter((r) => r.low) : rows;
  return { data, nextCursor: null, total: data.length, totals: { valuePaise: rows.reduce((s, r) => s + r.valuePaise, 0n), low: rows.filter((r) => r.low).length } };
}

/** How many of each item are in stock, all godowns together (for the bill editor and item list). */
export async function stockByItem(tenantId: string, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, number>();
  const sums = await db().stockBalance.groupBy({ by: ['itemId'], where: { tenantId, itemId: { in: itemIds } }, _sum: { quantity: true } });
  return new Map(sums.map((s) => [s.itemId, fromMilli(milli(s._sum.quantity ?? 0))]));
}

export const LedgerQuery = z.object({ locationId: z.string().uuid().optional(), from: DateStr.optional(), to: DateStr.optional() });

const SOURCE_LABEL: Record<string, string> = { opening: 'Opening stock', stock_in: 'Stock in', sale: 'Sale', sale_return: 'Return', adjustment: 'Adjustment', transfer_in: 'Transfer in', transfer_out: 'Transfer out', count: 'Stock count' };

/** Every move of one item, newest last, with the document it came from. */
export async function itemLedger(ctx: TenantCtx, itemId: string, query: z.infer<typeof LedgerQuery>) {
  const item = await db().item.findFirst({ where: { id: itemId, tenantId: ctx.tenantId }, select: { id: true, name: true, sku: true, unit: true, trackStock: true, reorderLevel: true } });
  if (!item) throw notFound('Item');
  const moves = await db().stockMove.findMany({
    where: {
      tenantId: ctx.tenantId, itemId, ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.from || query.to ? { moveDate: { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 2000,
  });
  const docIds = [...new Set(moves.filter((m) => m.sourceType !== 'stock_entry').map((m) => m.sourceId))];
  const entryIds = [...new Set(moves.filter((m) => m.sourceType === 'stock_entry').map((m) => m.sourceId))];
  const [docs, entries, locations] = await Promise.all([
    db().salesDocument.findMany({ where: { id: { in: docIds } }, select: { id: true, number: true, kind: true, buyer: true } }),
    db().stockEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, kind: true, party: true, reason: true, reference: true } }),
    db().stockLocation.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
  ]);
  const summary = await stockSummary(ctx, {});
  const now = summary.data.find((r) => r.id === itemId);
  return {
    item: { ...item, reorderLevel: item.reorderLevel === null ? null : Number(item.reorderLevel) },
    quantity: now?.quantity ?? 0, valuePaise: now?.valuePaise ?? 0n, averagePaise: now?.averagePaise ?? 0n,
    byLocation: (await db().stockBalance.findMany({ where: { tenantId: ctx.tenantId, itemId } })).map((b) => ({ locationId: b.locationId, location: locations.find((l) => l.id === b.locationId)?.name ?? '—', quantity: fromMilli(milli(b.quantity)), valuePaise: b.valuePaise })),
    rows: moves.map((m) => {
      const doc = docs.find((d) => d.id === m.sourceId);
      const entry = entries.find((e) => e.id === m.sourceId);
      return {
        id: m.id, date: m.moveDate, kind: m.kind, label: m.reversesId ? `${SOURCE_LABEL[m.kind] ?? m.kind} undone` : SOURCE_LABEL[m.kind] ?? m.kind,
        location: locations.find((l) => l.id === m.locationId)?.name ?? '—', quantity: fromMilli(milli(m.quantity)), ratePaise: m.ratePaise, valuePaise: m.valuePaise,
        balance: fromMilli(milli(m.balanceQty)), sourceType: m.sourceType, sourceId: m.sourceId, reversal: !!m.reversesId,
        document: doc ? { number: doc.number, kind: doc.kind, party: (doc.buyer as { name?: string })?.name ?? null } : entry ? { number: null, kind: entry.kind, party: entry.party ?? entry.reason ?? null } : null,
      };
    }),
  };
}

// ---------------------------------------------------------------- entries

const Line = z.object({ itemId: z.string().uuid(), quantity: Qty, ratePaise: z.number().int().min(0).max(1e12).optional() });

export const EntryInput = z
  .object({
    kind: z.enum(['opening', 'stock_in', 'adjustment', 'transfer']),
    locationId: z.string().uuid(),
    toLocationId: z.string().uuid().optional().nullable(),
    date: DateStr,
    /** Adjustment: stock added (found) or removed (damage, loss, sample) */
    direction: z.enum(['in', 'out']).optional(),
    reason: z.enum(['damage', 'loss', 'found', 'sample', 'expired', 'other']).optional().nullable(),
    party: z.string().trim().max(100).optional().nullable(),
    reference: z.string().trim().max(50).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
    lines: z.array(Line).min(1, 'Add at least one item').max(300),
  })
  .superRefine((v, c) => {
    if (v.kind === 'transfer' && !v.toLocationId) c.addIssue({ code: z.ZodIssueCode.custom, path: ['toLocationId'], message: 'Choose where it goes' });
    if (v.kind === 'transfer' && v.toLocationId === v.locationId) c.addIssue({ code: z.ZodIssueCode.custom, path: ['toLocationId'], message: 'Choose a different godown' });
    if (v.kind === 'adjustment' && !v.reason) c.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Choose a reason' });
    if (v.kind === 'adjustment' && !v.direction) c.addIssue({ code: z.ZodIssueCode.custom, path: ['direction'], message: 'Choose add or remove' });
    v.lines.forEach((l, i) => {
      if ((v.kind === 'opening' || v.kind === 'stock_in') && l.ratePaise === undefined) c.addIssue({ code: z.ZodIssueCode.custom, path: ['lines', i, 'ratePaise'], message: 'Enter the cost' });
    });
  });

async function rules(ctx: TenantCtx) {
  const t = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { preferences: true } });
  return withDefaults(t.preferences).inventory;
}

function checkDate(date: string, backdateDays: number) {
  const today = dateOnly(todayIST());
  const d = dateOnly(date);
  if (d > today) throw new AppError('VALIDATION_FAILED', "The date can't be in the future.", { fields: { date: 'In the future' } });
  if (today.getTime() - d.getTime() > backdateDays * DAY) {
    throw new AppError('VALIDATION_FAILED', `Stock entries can go back ${backdateDays} days at most. For older changes, make an adjustment today.`, { fields: { date: `More than ${backdateDays} days ago` } });
  }
  return d;
}

async function activeLocation(ctx: TenantCtx, id: string, field: string) {
  const loc = await db().stockLocation.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!loc) throw new AppError('VALIDATION_FAILED', 'Unknown godown.', { fields: { [field]: 'Unknown godown' } });
  if (!loc.isActive) throw new AppError('VALIDATION_FAILED', 'This godown is closed.', { fields: { [field]: 'Closed' } });
  return loc;
}

async function stockItems(ctx: TenantCtx, ids: string[]) {
  const items = await db().item.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } }, select: { id: true, name: true, type: true, trackStock: true, unit: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  ids.forEach((id, i) => {
    const it = byId.get(id);
    if (!it) throw new AppError('VALIDATION_FAILED', 'Unknown item.', { fields: { [`lines.${i}.itemId`]: 'Unknown item' } });
    if (it.type !== 'product') throw new AppError('VALIDATION_FAILED', `${it.name} is a service, so it has no stock.`, { fields: { [`lines.${i}.itemId`]: 'A service' } });
  });
  return byId;
}

async function needsApproval(ctx: TenantCtx, valuePaise: bigint, limit: number) {
  if (valuePaise <= BigInt(limit)) return;
  const perms = await getRolePermissions(ctx.roleId);
  if (!perms.has('inventory.stock_adjustment.approve')) {
    throw new AppError('PERMISSION_DENIED', `This changes stock worth more than ₹${(limit / 100).toLocaleString('en-IN')}. Ask a stock manager to post it.`, { approval: true });
  }
}

/** Opening stock, stock in, an adjustment or a transfer: one entry, its moves posted now. */
export async function postEntry(ctx: TenantCtx, input: z.infer<typeof EntryInput>) {
  const r = await rules(ctx);
  const date = checkDate(input.date, input.kind === 'opening' ? 3650 : r.backdateDays);
  const from = await activeLocation(ctx, input.locationId, 'locationId');
  const to = input.kind === 'transfer' ? await activeLocation(ctx, input.toLocationId!, 'toLocationId') : null;
  const seen = new Set<string>();
  input.lines.forEach((l, i) => {
    if (seen.has(l.itemId)) throw new AppError('VALIDATION_FAILED', 'This item is already on the entry.', { fields: { [`lines.${i}.itemId`]: 'Listed twice' } });
    seen.add(l.itemId);
  });
  const items = await stockItems(ctx, input.lines.map((l) => l.itemId));

  if (input.kind === 'opening') {
    const had = await db().stockMove.findMany({ where: { tenantId: ctx.tenantId, locationId: from.id, itemId: { in: [...seen] } }, select: { itemId: true }, distinct: ['itemId'] });
    if (had.length) {
      const names = had.map((h) => items.get(h.itemId)!.name).slice(0, 3).join(', ');
      throw new AppError('CONFLICT', `${names} already has stock history in ${from.name}. Use an adjustment to correct it.`);
    }
  } else if (input.kind !== 'stock_in') {
    const untracked = input.lines.find((l) => !items.get(l.itemId)!.trackStock);
    if (untracked) throw new AppError('VALIDATION_FAILED', `${items.get(untracked.itemId)!.name} has no stock yet. Add opening stock or a stock in first.`);
  }

  // Opening and stock in turn tracking on: the item's sales move stock from now on
  if (input.kind === 'opening' || input.kind === 'stock_in') {
    await db().item.updateMany({ where: { id: { in: [...seen] }, trackStock: false }, data: { trackStock: true } });
  }

  const sign = input.kind === 'adjustment' && input.direction === 'out' ? -1n : 1n;
  const entry = await db().stockEntry.create({
    data: {
      tenantId: ctx.tenantId, kind: input.kind, locationId: from.id, toLocationId: to?.id ?? null, entryDate: date,
      party: input.party || null, reference: input.reference || null, reason: input.kind === 'adjustment' ? input.reason : null, note: input.note || null,
      lines: input.lines.map((l) => ({ itemId: l.itemId, name: items.get(l.itemId)!.name, quantity: l.quantity, ratePaise: l.ratePaise ?? null })) as Prisma.InputJsonValue,
      createdBy: ctx.userId,
    },
  });

  let value = 0n;
  for (const l of input.lines) {
    const q = milli(l.quantity);
    const base = { itemId: l.itemId, date, sourceType: 'stock_entry' as const, sourceId: entry.id };
    if (input.kind === 'transfer') {
      const out = await applyMove(ctx, { ...base, locationId: from.id, kind: 'transfer_out', qtyMilli: -q });
      await applyMove(ctx, { ...base, locationId: to!.id, kind: 'transfer_in', qtyMilli: q, ratePaise: out!.ratePaise });
      value += -out!.valuePaise;
    } else {
      const kind = input.kind === 'adjustment' ? 'adjustment' : input.kind;
      const mv = await applyMove(ctx, { ...base, locationId: from.id, kind, qtyMilli: sign * q, ratePaise: l.ratePaise === undefined ? undefined : BigInt(l.ratePaise) });
      value += mv!.valuePaise < 0n ? -mv!.valuePaise : mv!.valuePaise;
    }
  }
  if (input.kind === 'adjustment') await needsApproval(ctx, value, r.adjustmentApprovalPaise);
  await db().stockEntry.update({ where: { id: entry.id }, data: { valuePaise: value } });
  await audit({ action: `inventory.${input.kind === 'adjustment' ? 'stock_adjustment' : input.kind === 'transfer' ? 'transfer' : 'receipt'}.create`, entity: 'stock_entry', entityId: entry.id, after: { kind: input.kind, lines: input.lines.length, valuePaise: value } });
  return getEntry(ctx, entry.id);
}

export const CountInput = z.object({
  locationId: z.string().uuid(),
  note: z.string().trim().max(500).optional().nullable(),
  lines: z.array(z.object({ itemId: z.string().uuid(), counted: z.number().min(0, 'Enter 0 or more').max(1e9) })).min(1, 'Count at least one item').max(1000),
});

/** Post a count: each difference against the books becomes a count move, today. */
export async function postCount(ctx: TenantCtx, input: z.infer<typeof CountInput>) {
  const r = await rules(ctx);
  const loc = await activeLocation(ctx, input.locationId, 'locationId');
  const items = await stockItems(ctx, input.lines.map((l) => l.itemId));
  const date = dateOnly(todayIST());
  const balances = await db().stockBalance.findMany({ where: { locationId: loc.id, itemId: { in: input.lines.map((l) => l.itemId) } } });
  const lines = input.lines.map((l) => {
    const system = milli(balances.find((b) => b.itemId === l.itemId)?.quantity ?? 0);
    return { itemId: l.itemId, name: items.get(l.itemId)!.name, system, counted: milli(l.counted), diff: milli(l.counted) - system };
  });
  const entry = await db().stockEntry.create({
    data: {
      tenantId: ctx.tenantId, kind: 'count', locationId: loc.id, entryDate: date, note: input.note || null, createdBy: ctx.userId,
      lines: lines.map((l) => ({ itemId: l.itemId, name: l.name, system: fromMilli(l.system), counted: fromMilli(l.counted), difference: fromMilli(l.diff) })) as Prisma.InputJsonValue,
    },
  });
  let value = 0n;
  for (const l of lines.filter((x) => x.diff !== 0n)) {
    await db().item.updateMany({ where: { id: l.itemId, trackStock: false }, data: { trackStock: true } });
    const mv = await applyMove(ctx, { itemId: l.itemId, locationId: loc.id, date, kind: 'count', qtyMilli: l.diff, sourceType: 'stock_entry', sourceId: entry.id, allowNegative: true });
    value += mv!.valuePaise < 0n ? -mv!.valuePaise : mv!.valuePaise;
  }
  await needsApproval(ctx, value, r.adjustmentApprovalPaise);
  await db().stockEntry.update({ where: { id: entry.id }, data: { valuePaise: value } });
  await audit({ action: 'inventory.stock_count.create', entity: 'stock_entry', entityId: entry.id, after: { lines: lines.length, differences: lines.filter((x) => x.diff !== 0n).length, valuePaise: value } });
  return getEntry(ctx, entry.id);
}

export async function getEntry(ctx: TenantCtx, id: string) {
  const entry = await db().stockEntry.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!entry) throw notFound('Stock entry');
  const locs = await db().stockLocation.findMany({ where: { id: { in: [entry.locationId, entry.toLocationId].filter(Boolean) as string[] } }, select: { id: true, name: true } });
  return { ...entry, location: locs.find((l) => l.id === entry.locationId)?.name ?? '—', toLocation: locs.find((l) => l.id === entry.toLocationId)?.name ?? null };
}

export const EntryList = z.object({ kind: z.string().max(20).optional(), q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().uuid().optional() });

export async function listEntries(ctx: TenantCtx, query: z.infer<typeof EntryList>) {
  const rows = await db().stockEntry.findMany({
    where: { tenantId: ctx.tenantId, ...(query.kind ? { kind: query.kind } : {}), ...(query.q ? { OR: [{ party: { contains: query.q, mode: 'insensitive' } }, { reference: { contains: query.q, mode: 'insensitive' } }, { note: { contains: query.q, mode: 'insensitive' } }] } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const locs = await db().stockLocation.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
  const page = rows.slice(0, query.limit);
  return {
    data: page.map((e) => ({ ...e, location: locs.find((l) => l.id === e.locationId)?.name ?? '—', toLocation: locs.find((l) => l.id === e.toLocationId)?.name ?? null, lineCount: Array.isArray(e.lines) ? e.lines.length : 0 })),
    nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
  };
}
