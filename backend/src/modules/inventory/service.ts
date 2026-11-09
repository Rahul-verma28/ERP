import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { DateStr } from '../../kernel/query';
import { dateOnly, todayIST } from '../../kernel/gst';
import { getRolePermissions } from '../access/service';
import { audit } from '../audit/service';
import { allocateBatches, applyMove, batchesWithStock, defaultLocation, fromMilli, loadRules, milli, unitFactor, type MoveKind, type Rules } from './engine';

// Warehouses, the stock list, an item's ledger, and the entries people make by hand:
// opening stock, stock in (until Purchase), adjustments, transfers (now or in transit) and counts.
// Batch items carry a batch number and expiry, serial items their numbers, and a line may be
// typed in the item's second unit (boxes); stock is always kept in the base unit.

const DAY = 86_400_000;
const Qty = z.number().positive('Enter more than 0').max(1e9);
const Serials = z.array(z.string().trim().min(1).max(40)).max(1000);

// ---------------------------------------------------------------- warehouses

const Blank = (schema: z.ZodString) => schema.optional().nullable().or(z.literal('').transform(() => null));
export const LocationInput = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(60),
  isDefault: z.boolean().optional(),
  address: Blank(z.string().trim().max(300)),
  city: Blank(z.string().trim().max(80)),
  zipCode: Blank(z.string().trim().max(10)),
  phone: Blank(z.string().trim().max(20)),
  email: Blank(z.string().trim().email('Enter a valid email').max(200)),
});

export async function listLocations(ctx: TenantCtx) {
  await defaultLocation(ctx);
  const [rows, sums, items] = await Promise.all([
    db().stockLocation.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ isActive: 'desc' }, { isDefault: 'desc' }, { name: 'asc' }] }),
    db().stockBalance.groupBy({ by: ['locationId'], where: { tenantId: ctx.tenantId }, _sum: { valuePaise: true } }),
    db().stockBalance.groupBy({ by: ['locationId'], where: { tenantId: ctx.tenantId, quantity: { not: 0 } }, _count: { _all: true } }),
  ]);
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
    throw new AppError('VALIDATION_FAILED', 'A warehouse with this name already exists.', { fields: { name: 'Already used' } });
  }
  if (input.isDefault) await db().stockLocation.updateMany({ where: { tenantId: ctx.tenantId }, data: { isDefault: false } });
  const row = await db().stockLocation.create({ data: { tenantId: ctx.tenantId, name: input.name, isDefault: !!input.isDefault, address: input.address ?? null, city: input.city ?? null, zipCode: input.zipCode ?? null, phone: input.phone ?? null, email: input.email ?? null } });
  await audit({ action: 'inventory.warehouse.create', entity: 'stock_location', entityId: row.id, after: { name: row.name } });
  return row;
}

export const LocationPatch = LocationInput.partial().extend({ isActive: z.boolean().optional() });

export async function updateLocation(ctx: TenantCtx, id: string, input: z.infer<typeof LocationPatch>) {
  const loc = await db().stockLocation.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!loc) throw notFound('Warehouse');
  if (input.name && input.name.toLowerCase() !== loc.name.toLowerCase() && (await db().stockLocation.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: input.name, mode: 'insensitive' } } }))) {
    throw new AppError('VALIDATION_FAILED', 'A warehouse with this name already exists.', { fields: { name: 'Already used' } });
  }
  if (input.isActive === false) {
    if (loc.isDefault) throw new AppError('CONFLICT', 'Make another warehouse the default before closing this one.');
    if (await db().stockBalance.count({ where: { locationId: id, quantity: { not: 0 } } })) throw new AppError('CONFLICT', 'This warehouse still has stock. Transfer it or write it off first.');
    if (await db().stockEntry.count({ where: { tenantId: ctx.tenantId, toLocationId: id, status: 'in_transit' } })) throw new AppError('CONFLICT', 'Stock is on its way to this warehouse. Receive it first.');
  }
  if (input.isDefault) {
    if (input.isActive === false || !loc.isActive) throw new AppError('CONFLICT', 'A closed warehouse cannot be the default.');
    await db().stockLocation.updateMany({ where: { tenantId: ctx.tenantId }, data: { isDefault: false } });
  }
  const row = await db().stockLocation.update({ where: { id }, data: { name: input.name, isDefault: input.isDefault || undefined, isActive: input.isActive, address: input.address, city: input.city, zipCode: input.zipCode, phone: input.phone, email: input.email } });
  await audit({ action: 'inventory.warehouse.edit', entity: 'stock_location', entityId: id, before: { name: loc.name, isActive: loc.isActive }, after: input });
  return row;
}

// ---------------------------------------------------------------- stock list

export const StockQuery = z.object({
  q: z.string().trim().max(100).optional(),
  locationId: z.string().uuid().optional(),
  low: z.enum(['true', 'false']).optional(),
  /** Stock and value as they stood at the end of this day */
  date: DateStr.optional(),
});

/** Ordered on open sales orders and not yet sent or billed: held for those customers. */
export async function reservedByItem(tenantId: string) {
  const rows = await db().$queryRaw<{ item_id: string; reserved: Prisma.Decimal }[]>`
    SELECT ol.item_id, SUM(GREATEST(ol.quantity - COALESCE(d.done, 0), 0)) AS reserved
    FROM sales_document_lines ol
    JOIN sales_documents o ON o.id = ol.document_id
    LEFT JOIN (
      SELECT dl.source_line_id, SUM(dl.quantity) AS done FROM sales_document_lines dl JOIN sales_documents dd ON dd.id = dl.document_id
      WHERE dd.tenant_id = ${tenantId}::uuid AND dd.kind IN ('invoice', 'delivery_challan') AND dd.status <> 'cancelled' AND dl.source_line_id IS NOT NULL
      GROUP BY dl.source_line_id
    ) d ON d.source_line_id = ol.id
    WHERE o.tenant_id = ${tenantId}::uuid AND o.kind = 'sales_order' AND o.status IN ('open', 'part_invoiced') AND ol.item_id IS NOT NULL
    GROUP BY ol.item_id`;
  return new Map(rows.map((r) => [r.item_id, fromMilli(milli(r.reserved))]));
}

async function expiredByItem(tenantId: string, locationId?: string) {
  const rows = await db().$queryRaw<{ item_id: string; qty: Prisma.Decimal }[]>`
    SELECT b.item_id, SUM(bb.quantity) AS qty FROM stock_batch_balances bb JOIN stock_batches b ON b.id = bb.batch_id
    WHERE bb.tenant_id = ${tenantId}::uuid AND bb.quantity > 0 AND b.expiry_date < ${dateOnly(todayIST())}
      AND (${locationId ?? null}::uuid IS NULL OR bb.location_id = ${locationId ?? null}::uuid)
    GROUP BY b.item_id`;
  return new Map(rows.map((r) => [r.item_id, fromMilli(milli(r.qty))]));
}

async function inTransitByItem(tenantId: string) {
  const entries = await db().stockEntry.findMany({ where: { tenantId, kind: 'transfer', status: 'in_transit' }, select: { lines: true } });
  const out = new Map<string, number>();
  for (const e of entries) for (const l of e.lines as { itemId: string; baseQuantity?: number; quantity: number }[]) out.set(l.itemId, (out.get(l.itemId) ?? 0) + (l.baseQuantity ?? l.quantity));
  return out;
}

/** Every tracked item with stock, value, held for orders, expired, on the way, and its low-stock flag. */
export async function stockSummary(ctx: TenantCtx, query: z.infer<typeof StockQuery>) {
  const items = await db().item.findMany({
    where: { tenantId: ctx.tenantId, trackStock: true, ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { sku: { contains: query.q, mode: 'insensitive' } }, { barcode: query.q }] } : {}) },
    select: { id: true, name: true, sku: true, unit: true, reorderLevel: true, isActive: true, tracking: true, altUnit: true, altFactor: true },
    orderBy: { name: 'asc' },
  });
  const ids = items.map((i) => i.id);
  let qtyBy: Map<string, bigint>;
  let valueBy: Map<string, bigint>;
  if (query.date) {
    // As it stood: the ledger summed up to that day
    const rows = await db().stockMove.groupBy({ by: ['itemId'], where: { tenantId: ctx.tenantId, itemId: { in: ids }, moveDate: { lte: dateOnly(query.date) }, ...(query.locationId ? { locationId: query.locationId } : {}) }, _sum: { quantity: true, valuePaise: true } });
    qtyBy = new Map(rows.map((r) => [r.itemId, milli(r._sum.quantity ?? 0)]));
    valueBy = new Map(rows.map((r) => [r.itemId, r._sum.valuePaise ?? 0n]));
  } else {
    const rows = await db().stockBalance.findMany({ where: { tenantId: ctx.tenantId, itemId: { in: ids }, ...(query.locationId ? { locationId: query.locationId } : {}) } });
    qtyBy = new Map();
    valueBy = new Map();
    for (const b of rows) {
      qtyBy.set(b.itemId, (qtyBy.get(b.itemId) ?? 0n) + milli(b.quantity));
      valueBy.set(b.itemId, (valueBy.get(b.itemId) ?? 0n) + b.valuePaise);
    }
  }
  const [reserved, expired, transit] = query.date ? [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()] : await Promise.all([reservedByItem(ctx.tenantId), expiredByItem(ctx.tenantId, query.locationId), inTransitByItem(ctx.tenantId)]);
  const places = query.date ? new Map<string, { id: string; name: string; quantity: number }[]>() : await stockByWarehouse(ctx.tenantId, ids);
  const rows = items.map((i) => {
    const qty = qtyBy.get(i.id) ?? 0n;
    const value = valueBy.get(i.id) ?? 0n;
    const reorder = i.reorderLevel === null ? null : fromMilli(milli(i.reorderLevel));
    const held = reserved.get(i.id) ?? 0;
    const gone = expired.get(i.id) ?? 0;
    const available = fromMilli(qty) - held - gone;
    return {
      id: i.id, name: i.name, sku: i.sku, unit: i.unit, isActive: i.isActive, tracking: i.tracking, altUnit: i.altUnit, altFactor: i.altFactor === null ? null : Number(i.altFactor),
      warehouses: places.get(i.id) ?? [],
      quantity: fromMilli(qty), reserved: held, expired: gone, available, inTransit: transit.get(i.id) ?? 0,
      valuePaise: value, averagePaise: qty > 0n ? (value * 1000n) / qty : 0n, reorderLevel: reorder, low: reorder !== null && available <= reorder,
    };
  });
  const data = query.low === 'true' ? rows.filter((r) => r.low) : rows;
  return { data, nextCursor: null, total: data.length, totals: { valuePaise: rows.reduce((s, r) => s + r.valuePaise, 0n), low: rows.filter((r) => r.low).length } };
}

/** In stock and held for orders, per item, all warehouses together (for the item list and bill picker). */
export async function stockByItem(tenantId: string, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, number>();
  const sums = await db().stockBalance.groupBy({ by: ['itemId'], where: { tenantId, itemId: { in: itemIds } }, _sum: { quantity: true } });
  return new Map(sums.map((s) => [s.itemId, fromMilli(milli(s._sum.quantity ?? 0))]));
}

/** Each item's stock by warehouse, only where there is some */
export async function stockByWarehouse(tenantId: string, itemIds: string[]) {
  const out = new Map<string, { id: string; name: string; quantity: number }[]>();
  if (!itemIds.length) return out;
  const [rows, places] = await Promise.all([
    db().stockBalance.findMany({ where: { tenantId, itemId: { in: itemIds }, quantity: { not: 0 } }, select: { itemId: true, locationId: true, quantity: true } }),
    db().stockLocation.findMany({ where: { tenantId }, select: { id: true, name: true } }),
  ]);
  const names = new Map(places.map((p) => [p.id, p.name]));
  for (const r of rows) out.set(r.itemId, [...(out.get(r.itemId) ?? []), { id: r.locationId, name: names.get(r.locationId) ?? 'Warehouse', quantity: fromMilli(milli(r.quantity)) }]);
  for (const list of out.values()) list.sort((a, b) => b.quantity - a.quantity);
  return out;
}

// ---------------------------------------------------------------- ledger, batches, serials

export const LedgerQuery = z.object({ locationId: z.string().uuid().optional(), from: DateStr.optional(), to: DateStr.optional() });

const SOURCE_LABEL: Record<string, string> = { purchase: 'Purchase', purchase_return: 'Purchase return', opening: 'Opening stock', stock_in: 'Stock in', sale: 'Sale', sale_return: 'Return', adjustment: 'Adjustment', transfer_in: 'Transfer in', transfer_out: 'Transfer out', count: 'Stock count' };

/** Every move of one item, newest last, with the document it came from. */
export async function itemLedger(ctx: TenantCtx, itemId: string, query: z.infer<typeof LedgerQuery>) {
  const item = await db().item.findFirst({ where: { id: itemId, tenantId: ctx.tenantId }, select: { id: true, name: true, sku: true, unit: true, trackStock: true, reorderLevel: true, tracking: true, altUnit: true, altFactor: true, barcode: true } });
  if (!item) throw notFound('Item');
  const moves = await db().stockMove.findMany({
    where: {
      tenantId: ctx.tenantId, itemId, ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.from || query.to ? { moveDate: { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 2000,
  });
  const docIds = [...new Set(moves.filter((m) => m.sourceType !== 'stock_entry' && m.sourceType !== 'purchase').map((m) => m.sourceId))];
  const purchaseIds = [...new Set(moves.filter((m) => m.sourceType === 'purchase').map((m) => m.sourceId))];
  const purchases = purchaseIds.length ? await db().purchaseDocument.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, number: true, kind: true, supplier: true } }) : [];
  const entryIds = [...new Set(moves.filter((m) => m.sourceType === 'stock_entry').map((m) => m.sourceId))];
  const batchIds = [...new Set(moves.map((m) => m.batchId).filter(Boolean))] as string[];
  const [docs, entries, locations, batches, balances] = await Promise.all([
    db().salesDocument.findMany({ where: { id: { in: docIds } }, select: { id: true, number: true, kind: true, buyer: true } }),
    db().stockEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, kind: true, party: true, reason: true, reference: true } }),
    db().stockLocation.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    db().stockBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, number: true } }),
    db().stockBalance.findMany({ where: { tenantId: ctx.tenantId, itemId } }),
  ]);
  const qty = balances.reduce((s, b) => s + milli(b.quantity), 0n);
  const value = balances.reduce((s, b) => s + b.valuePaise, 0n);
  const reserved = (await reservedByItem(ctx.tenantId)).get(itemId) ?? 0;
  return {
    item: { ...item, reorderLevel: item.reorderLevel === null ? null : Number(item.reorderLevel), altFactor: item.altFactor === null ? null : Number(item.altFactor) },
    quantity: fromMilli(qty), reserved, valuePaise: value, averagePaise: qty > 0n ? (value * 1000n) / qty : 0n,
    byLocation: balances.map((b) => ({ locationId: b.locationId, location: locations.find((l) => l.id === b.locationId)?.name ?? '—', quantity: fromMilli(milli(b.quantity)), valuePaise: b.valuePaise })),
    rows: moves.map((m) => {
      const doc = docs.find((d) => d.id === m.sourceId) ?? purchases.find((d) => d.id === m.sourceId);
      const entry = entries.find((e) => e.id === m.sourceId);
      return {
        id: m.id, date: m.moveDate, kind: m.kind, label: m.reversesId ? `${SOURCE_LABEL[m.kind] ?? m.kind} undone` : SOURCE_LABEL[m.kind] ?? m.kind,
        location: locations.find((l) => l.id === m.locationId)?.name ?? '—', quantity: fromMilli(milli(m.quantity)), ratePaise: m.ratePaise, valuePaise: m.valuePaise,
        balance: fromMilli(milli(m.balanceQty)), sourceType: m.sourceType, sourceId: m.sourceId, reversal: !!m.reversesId,
        batch: batches.find((b) => b.id === m.batchId)?.number ?? null, serials: m.serials,
        document: doc ? { number: doc.number, kind: doc.kind, party: ((('buyer' in doc ? doc.buyer : doc.supplier) as { name?: string }) ?? {}).name ?? null } : entry ? { number: null, kind: entry.kind, party: entry.party ?? entry.reason ?? null } : null,
      };
    }),
  };
}

export const BatchQuery = z.object({ locationId: z.string().uuid().optional(), expired: z.enum(['true', 'false']).optional() });

/** Batches with stock for one item, earliest expiry first. */
export async function itemBatches(ctx: TenantCtx, itemId: string, query: z.infer<typeof BatchQuery>) {
  const loc = query.locationId ?? (await defaultLocation(ctx)).id;
  const rows = await batchesWithStock(itemId, loc, dateOnly(todayIST()), query.expired === 'true');
  return { data: rows.map((r) => ({ id: r.id, number: r.number, mfgDate: r.mfgDate, expiryDate: r.expiryDate, quantity: fromMilli(r.qtyMilli), expired: r.expired })) };
}

/** Serial numbers of one item in stock at a warehouse. */
export async function itemSerials(ctx: TenantCtx, itemId: string, query: { locationId?: string; status?: string }) {
  const loc = query.locationId ?? (await defaultLocation(ctx)).id;
  const rows = await db().stockSerial.findMany({ where: { tenantId: ctx.tenantId, itemId, status: query.status ?? 'in_stock', ...(query.status && query.status !== 'in_stock' ? {} : { locationId: loc }) }, orderBy: { serial: 'asc' }, take: 2000 });
  return { data: rows.map((r) => r.serial) };
}

/** Where a serial number is now, and every move it took. */
export async function findSerial(ctx: TenantCtx, serial: string) {
  const rows = await db().stockSerial.findMany({ where: { tenantId: ctx.tenantId, serial } });
  const items = await db().item.findMany({ where: { id: { in: rows.map((r) => r.itemId) } }, select: { id: true, name: true } });
  const moves = await db().stockMove.findMany({ where: { tenantId: ctx.tenantId, serials: { has: serial } }, orderBy: { createdAt: 'asc' } });
  return { data: rows.map((r) => ({ itemId: r.itemId, item: items.find((i) => i.id === r.itemId)?.name ?? '—', status: r.status, locationId: r.locationId })), moves: moves.map((m) => ({ id: m.id, date: m.moveDate, kind: m.kind, sourceType: m.sourceType, sourceId: m.sourceId })) };
}

// ---------------------------------------------------------------- entries

const Line = z.object({
  itemId: z.string().uuid(),
  quantity: Qty,
  /** Cost per unit typed, in the unit of the line */
  ratePaise: z.number().int().min(0).max(1e12).optional(),
  /** "alt": the quantity and cost are in the item's second unit (boxes) */
  unit: z.enum(['base', 'alt']).optional(),
  /** Stock coming in: the batch it belongs to (made if new) */
  batchNo: z.string().trim().min(1).max(40).optional().nullable(),
  mfgDate: DateStr.optional().nullable(),
  expiryDate: DateStr.optional().nullable(),
  /** Stock going out: a chosen batch; none means earliest expiry first */
  batchId: z.string().uuid().optional().nullable(),
  serials: Serials.optional(),
});

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
    /** Transfer: false keeps it in transit until the other warehouse receives it */
    receiveNow: z.boolean().optional(),
    lines: z.array(Line).min(1, 'Add at least one item').max(300),
  })
  .superRefine((v, c) => {
    if (v.kind === 'transfer' && !v.toLocationId) c.addIssue({ code: z.ZodIssueCode.custom, path: ['toLocationId'], message: 'Choose where it goes' });
    if (v.kind === 'transfer' && v.toLocationId === v.locationId) c.addIssue({ code: z.ZodIssueCode.custom, path: ['toLocationId'], message: 'Choose a different warehouse' });
    if (v.kind === 'adjustment' && !v.reason) c.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Choose a reason' });
    if (v.kind === 'adjustment' && !v.direction) c.addIssue({ code: z.ZodIssueCode.custom, path: ['direction'], message: 'Choose add or remove' });
    v.lines.forEach((l, i) => {
      if ((v.kind === 'opening' || v.kind === 'stock_in') && l.ratePaise === undefined) c.addIssue({ code: z.ZodIssueCode.custom, path: ['lines', i, 'ratePaise'], message: 'Enter the cost' });
    });
  });

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
  if (!loc) throw new AppError('VALIDATION_FAILED', 'Unknown warehouse.', { fields: { [field]: 'Unknown warehouse' } });
  if (!loc.isActive) throw new AppError('VALIDATION_FAILED', 'This warehouse is closed.', { fields: { [field]: 'Closed' } });
  return loc;
}

async function stockItems(ctx: TenantCtx, ids: string[]) {
  const items = await db().item.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } }, select: { id: true, name: true, type: true, trackStock: true, unit: true, tracking: true, altUnit: true, altFactor: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  ids.forEach((id, i) => {
    const it = byId.get(id);
    if (!it) throw new AppError('VALIDATION_FAILED', 'Unknown item.', { fields: { [`lines.${i}.itemId`]: 'Unknown item' } });
    if (it.type !== 'product') throw new AppError('VALIDATION_FAILED', `${it.name} is a service, so it has no stock.`, { fields: { [`lines.${i}.itemId`]: 'A service' } });
  });
  return byId;
}
type StockItem = Awaited<ReturnType<typeof stockItems>> extends Map<string, infer T> ? T : never;

async function needsApproval(ctx: TenantCtx, valuePaise: bigint, limit: number) {
  if (valuePaise <= BigInt(limit)) return;
  const perms = await getRolePermissions(ctx.roleId);
  if (!perms.has('inventory.stock_adjustment.approve')) {
    throw new AppError('PERMISSION_DENIED', `This changes stock worth more than ₹${(limit / 100).toLocaleString('en-IN')}. Ask a stock manager to post it.`, { approval: true });
  }
}

/** The batch of an item with this number, made if new; dates fill in when given. */
export async function ensureBatch(ctx: TenantCtx, itemId: string, number: string, mfgDate?: Date | null, expiryDate?: Date | null) {
  const found = await db().stockBatch.findUnique({ where: { itemId_number: { itemId, number } } });
  const data = { ...(mfgDate ? { mfgDate } : {}), ...(expiryDate ? { expiryDate } : {}) };
  if (found) return Object.keys(data).length ? db().stockBatch.update({ where: { id: found.id }, data }) : found;
  return db().stockBatch.create({ data: { tenantId: ctx.tenantId, itemId, number, ...data } });
}

/** The batch stock comes into: found by number, made if new. Dates fill in when given. */
async function batchFor(ctx: TenantCtx, item: StockItem, l: z.infer<typeof Line>, i: number) {
  if (!l.batchNo) throw new AppError('VALIDATION_FAILED', `Enter the batch number for ${item.name}.`, { fields: { [`lines.${i}.batchNo`]: 'Batch needed' } });
  const found = await db().stockBatch.findUnique({ where: { itemId_number: { itemId: item.id, number: l.batchNo } } });
  const data = { ...(l.mfgDate ? { mfgDate: dateOnly(l.mfgDate) } : {}), ...(l.expiryDate ? { expiryDate: dateOnly(l.expiryDate) } : {}) };
  if (found) return Object.keys(data).length ? db().stockBatch.update({ where: { id: found.id }, data }) : found;
  return db().stockBatch.create({ data: { tenantId: ctx.tenantId, itemId: item.id, number: l.batchNo, ...data } });
}

/** Quantity in base units, and the serials checked against it */
function lineQty(item: StockItem, l: z.infer<typeof Line>, i: number) {
  const factor = l.unit === 'alt' ? unitFactor(item.altUnit ?? '', item) : 1000n;
  if (l.unit === 'alt' && factor === 1000n) throw new AppError('VALIDATION_FAILED', `${item.name} has no second unit.`, { fields: { [`lines.${i}.unit`]: 'No second unit' } });
  const q = (milli(l.quantity) * factor) / 1000n;
  if (item.tracking === 'serial') {
    const serials = [...new Set(l.serials ?? [])];
    if (serials.length * 1000 !== Number(q)) throw new AppError('VALIDATION_FAILED', `Enter ${fromMilli(q)} serial numbers for ${item.name}.`, { fields: { [`lines.${i}.serials`]: 'Count does not match' } });
  }
  // Cost typed per box becomes cost per piece
  const rate = l.ratePaise === undefined ? undefined : (BigInt(l.ratePaise) * 1000n) / factor;
  return { q, rate };
}

/** Opening stock, stock in, an adjustment or a transfer: one entry, its moves posted now. */
export async function postEntry(ctx: TenantCtx, input: z.infer<typeof EntryInput>) {
  const rules = await loadRules(ctx);
  const date = checkDate(input.date, input.kind === 'opening' ? 3650 : rules.backdateDays);
  const from = await activeLocation(ctx, input.locationId, 'locationId');
  const to = input.kind === 'transfer' ? await activeLocation(ctx, input.toLocationId!, 'toLocationId') : null;
  const seen = new Set<string>();
  input.lines.forEach((l, i) => {
    const key = `${l.itemId}|${l.batchNo ?? l.batchId ?? ''}`;
    if (seen.has(key)) throw new AppError('VALIDATION_FAILED', 'This item is already on the entry.', { fields: { [`lines.${i}.itemId`]: 'Listed twice' } });
    seen.add(key);
  });
  const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
  const items = await stockItems(ctx, itemIds);

  if (input.kind === 'opening') {
    const had = await db().stockMove.findMany({ where: { tenantId: ctx.tenantId, locationId: from.id, itemId: { in: itemIds } }, select: { itemId: true }, distinct: ['itemId'] });
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
    await db().item.updateMany({ where: { id: { in: itemIds }, trackStock: false }, data: { trackStock: true } });
  }

  const incoming = input.kind === 'opening' || input.kind === 'stock_in' || (input.kind === 'adjustment' && input.direction === 'in');
  const inTransit = input.kind === 'transfer' && input.receiveNow === false;
  const entry = await db().stockEntry.create({
    data: {
      tenantId: ctx.tenantId, kind: input.kind, locationId: from.id, toLocationId: to?.id ?? null, entryDate: date, status: inTransit ? 'in_transit' : 'posted',
      party: input.party || null, reference: input.reference || null, reason: input.kind === 'adjustment' ? input.reason : null, note: input.note || null,
      createdBy: ctx.userId,
    },
  });

  let value = 0n;
  const saved: Record<string, unknown>[] = [];
  for (const [i, l] of input.lines.entries()) {
    const item = items.get(l.itemId)!;
    const { q, rate } = lineQty(item, l, i);
    const serials = l.serials?.length ? [...new Set(l.serials)] : undefined;
    const base = { itemId: item.id, date, sourceType: 'stock_entry' as const, sourceId: entry.id, rules };
    const snapshot = { itemId: item.id, name: item.name, quantity: l.quantity, unit: l.unit === 'alt' ? item.altUnit : item.unit, baseQuantity: fromMilli(q), ratePaise: l.ratePaise ?? null, serials: serials ?? [] };

    if (incoming) {
      const batch = item.tracking === 'batch' ? await batchFor(ctx, item, l, i) : null;
      const kind = (input.kind === 'adjustment' ? 'adjustment' : input.kind) as MoveKind;
      const mv = await applyMove(ctx, { ...base, locationId: from.id, kind, qtyMilli: q, ratePaise: rate, batchId: batch?.id, serials });
      value += mv!.valuePaise;
      saved.push({ ...snapshot, batches: batch ? [{ id: batch.id, number: batch.number, expiry: batch.expiryDate?.toISOString().slice(0, 10) ?? null, quantity: fromMilli(q) }] : [] });
      continue;
    }

    // Going out: from the chosen batch, or earliest expiry first
    const parts = item.tracking === 'batch'
      ? l.batchId
        ? [{ batchId: l.batchId, number: (await db().stockBatch.findFirst({ where: { id: l.batchId, itemId: item.id } }))?.number ?? '', expiryDate: null as Date | null, qtyMilli: q }]
        : await allocateBatches(item.id, item.name, from.id, q, input.reason === 'expired' ? new Date(0) : date)
      : [{ batchId: null as string | null, number: '', expiryDate: null as Date | null, qtyMilli: q }];
    if (item.tracking === 'batch' && l.batchId && !parts[0].number) throw new AppError('VALIDATION_FAILED', `Unknown batch for ${item.name}.`, { fields: { [`lines.${i}.batchId`]: 'Unknown batch' } });
    for (const p of parts) {
      const kind: MoveKind = input.kind === 'transfer' ? 'transfer_out' : 'adjustment';
      const out = await applyMove(ctx, { ...base, locationId: from.id, kind, qtyMilli: -p.qtyMilli, batchId: p.batchId, serials });
      value += -out!.valuePaise;
      if (input.kind === 'transfer' && !inTransit) {
        await applyMove(ctx, { ...base, locationId: to!.id, kind: 'transfer_in', qtyMilli: p.qtyMilli, ratePaise: out!.ratePaise, batchId: p.batchId, serials });
      }
    }
    saved.push({ ...snapshot, batches: parts.filter((p) => p.batchId).map((p) => ({ id: p.batchId, number: p.number, quantity: fromMilli(p.qtyMilli) })) });
  }
  if (input.kind === 'adjustment') await needsApproval(ctx, value < 0n ? -value : value, rules.adjustmentApprovalPaise);
  await db().stockEntry.update({ where: { id: entry.id }, data: { valuePaise: value < 0n ? -value : value, lines: saved as Prisma.InputJsonValue } });
  await audit({ action: `inventory.${input.kind === 'adjustment' ? 'stock_adjustment' : input.kind === 'transfer' ? 'transfer' : 'receipt'}.create`, entity: 'stock_entry', entityId: entry.id, after: { kind: input.kind, lines: input.lines.length, valuePaise: value, inTransit } });
  return getEntry(ctx, entry.id);
}

/** The other warehouse got a transfer that was in transit: stock comes in there now, at the cost it left at. */
export async function receiveTransfer(ctx: TenantCtx, id: string) {
  const entry = await db().stockEntry.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!entry || entry.kind !== 'transfer') throw notFound('Transfer');
  if (entry.status !== 'in_transit') throw new AppError('CONFLICT', 'This transfer is already received.');
  await activeLocation(ctx, entry.toLocationId!, 'toLocationId');
  const rules = await loadRules(ctx);
  const outs = await db().stockMove.findMany({ where: { tenantId: ctx.tenantId, sourceId: id, kind: 'transfer_out', reversesId: null }, orderBy: { createdAt: 'asc' } });
  const date = dateOnly(todayIST());
  for (const o of outs) {
    await applyMove(ctx, { itemId: o.itemId, locationId: entry.toLocationId!, date, kind: 'transfer_in', qtyMilli: -milli(o.quantity), ratePaise: o.ratePaise, sourceType: 'stock_entry', sourceId: id, batchId: o.batchId, serials: o.serials, rules });
  }
  await db().stockEntry.update({ where: { id }, data: { status: 'received', receivedAt: new Date() } });
  await audit({ action: 'inventory.transfer.create', entity: 'stock_entry', entityId: id, after: { received: true } });
  return getEntry(ctx, id);
}

export const CountInput = z.object({
  locationId: z.string().uuid(),
  note: z.string().trim().max(500).optional().nullable(),
  lines: z.array(z.object({ itemId: z.string().uuid(), batchId: z.string().uuid().optional().nullable(), counted: z.number().min(0, 'Enter 0 or more').max(1e9) })).min(1, 'Count at least one item').max(1000),
});

/** Post a count: each difference against the books becomes a count move, today. Batch items are counted per batch. */
export async function postCount(ctx: TenantCtx, input: z.infer<typeof CountInput>) {
  const rules = await loadRules(ctx);
  const loc = await activeLocation(ctx, input.locationId, 'locationId');
  const items = await stockItems(ctx, [...new Set(input.lines.map((l) => l.itemId))]);
  const date = dateOnly(todayIST());
  const serialItem = input.lines.find((l) => items.get(l.itemId)!.tracking === 'serial');
  if (serialItem) throw new AppError('VALIDATION_FAILED', `${items.get(serialItem.itemId)!.name} is counted by serial number. Use an adjustment with the numbers instead.`);
  input.lines.forEach((l, i) => {
    if (items.get(l.itemId)!.tracking === 'batch' && !l.batchId) throw new AppError('VALIDATION_FAILED', `Count ${items.get(l.itemId)!.name} batch by batch.`, { fields: { [`lines.${i}.batchId`]: 'Batch needed' } });
  });
  const [balances, batchBalances, batches] = await Promise.all([
    db().stockBalance.findMany({ where: { locationId: loc.id, itemId: { in: [...items.keys()] } } }),
    db().stockBatchBalance.findMany({ where: { locationId: loc.id, batchId: { in: input.lines.map((l) => l.batchId).filter(Boolean) as string[] } } }),
    db().stockBatch.findMany({ where: { id: { in: input.lines.map((l) => l.batchId).filter(Boolean) as string[] } }, select: { id: true, number: true } }),
  ]);
  const lines = input.lines.map((l) => {
    const system = l.batchId ? milli(batchBalances.find((b) => b.batchId === l.batchId)?.quantity ?? 0) : milli(balances.find((b) => b.itemId === l.itemId)?.quantity ?? 0);
    return { itemId: l.itemId, batchId: l.batchId ?? null, batch: batches.find((b) => b.id === l.batchId)?.number ?? null, name: items.get(l.itemId)!.name, system, counted: milli(l.counted), diff: milli(l.counted) - system };
  });
  const entry = await db().stockEntry.create({
    data: {
      tenantId: ctx.tenantId, kind: 'count', locationId: loc.id, entryDate: date, note: input.note || null, createdBy: ctx.userId,
      lines: lines.map((l) => ({ itemId: l.itemId, name: l.name, batch: l.batch, system: fromMilli(l.system), counted: fromMilli(l.counted), difference: fromMilli(l.diff) })) as Prisma.InputJsonValue,
    },
  });
  let value = 0n;
  for (const l of lines.filter((x) => x.diff !== 0n)) {
    await db().item.updateMany({ where: { id: l.itemId, trackStock: false }, data: { trackStock: true } });
    const mv = await applyMove(ctx, { itemId: l.itemId, locationId: loc.id, date, kind: 'count', qtyMilli: l.diff, sourceType: 'stock_entry', sourceId: entry.id, batchId: l.batchId, allowNegative: true, rules });
    value += mv!.valuePaise < 0n ? -mv!.valuePaise : mv!.valuePaise;
  }
  await needsApproval(ctx, value, rules.adjustmentApprovalPaise);
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

export const EntryList = z.object({ kind: z.string().max(20).optional(), notKind: z.string().max(20).optional(), status: z.string().max(12).optional(), q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().uuid().optional() });

export async function listEntries(ctx: TenantCtx, query: z.infer<typeof EntryList>) {
  const rows = await db().stockEntry.findMany({
    where: {
      tenantId: ctx.tenantId, ...(query.kind ? { kind: query.kind } : query.notKind ? { kind: { not: query.notKind } } : {}), ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { OR: [{ party: { contains: query.q, mode: 'insensitive' } }, { reference: { contains: query.q, mode: 'insensitive' } }, { note: { contains: query.q, mode: 'insensitive' } }] } : {}),
    },
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

// ---------------------------------------------------------------- import helpers

export const ResolveInput = z.object({ refs: z.array(z.string().trim().min(1).max(160)).min(1).max(2000) });

/** Match names, SKUs or barcodes from a spreadsheet to items. Unmatched ones come back as null. */
export async function resolveItems(ctx: TenantCtx, input: z.infer<typeof ResolveInput>) {
  const refs = [...new Set(input.refs)];
  const items = await db().item.findMany({
    where: { tenantId: ctx.tenantId, type: 'product', OR: [{ sku: { in: refs } }, { barcode: { in: refs } }, { name: { in: refs, mode: 'insensitive' } }] },
    select: { id: true, name: true, sku: true, barcode: true, unit: true, tracking: true },
  });
  const lower = (s: string | null) => (s ?? '').toLowerCase();
  return { data: Object.fromEntries(refs.map((r) => [r, items.find((i) => i.sku === r || i.barcode === r) ?? items.find((i) => lower(i.name) === r.toLowerCase()) ?? null])) };
}

export type { Rules };
