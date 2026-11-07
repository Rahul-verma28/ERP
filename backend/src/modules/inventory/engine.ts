import { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { withDefaults, type WorkspacePreferences } from '../../contracts/workspace';

// The one writer of stock. Every change is a row in stock_moves (never edited or deleted); the running
// stock_balances row, batch balances, serial numbers and cost layers change with it in the same
// transaction. Cost is moving weighted average or FIFO, chosen once per business. Layers (what is left
// of each receipt) are kept either way: they give FIFO its cost and every business its stock ageing.

/** Quantities are kept in thousandths so 0.1 + 0.2 stays exact */
export const milli = (q: unknown) => BigInt(Math.round(Number(q) * 1000));
export const fromMilli = (m: bigint) => Number(m) / 1000;
const dec = (m: bigint) => new Prisma.Decimal(fromMilli(m).toFixed(3));
const valueOf = (rate: bigint, qtyMilli: bigint) => (rate * qtyMilli + (qtyMilli >= 0n ? 500n : -500n)) / 1000n;
const abs = (n: bigint) => (n < 0n ? -n : n);

export type MoveKind = 'opening' | 'stock_in' | 'sale' | 'sale_return' | 'adjustment' | 'transfer_in' | 'transfer_out' | 'count';
export type Rules = WorkspacePreferences['inventory'];

export interface MoveInput {
  itemId: string;
  locationId: string;
  date: Date;
  kind: MoveKind;
  /** Signed, in thousandths of the base unit: positive comes in */
  qtyMilli: bigint;
  /** Receipts: cost per base unit. Issues ignore it unless they undo a receipt */
  ratePaise?: bigint;
  sourceType: 'stock_entry' | 'invoice' | 'delivery_challan' | 'credit_note';
  sourceId: string;
  sourceLineId?: string | null;
  reversesId?: string | null;
  batchId?: string | null;
  serials?: string[];
  /** Undoing a move never stops on the negative-stock rule */
  allowNegative?: boolean;
  rules?: Rules;
}

export async function loadRules(ctx: TenantCtx): Promise<Rules> {
  const t = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { preferences: true } });
  return withDefaults(t.preferences).inventory;
}

/** The godown sales come from: the default one, made on first use */
export async function defaultLocation(ctx: TenantCtx) {
  const found = await db().stockLocation.findFirst({ where: { tenantId: ctx.tenantId, isDefault: true, isActive: true } });
  if (found) return found;
  const any = await db().stockLocation.findFirst({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { createdAt: 'asc' } });
  if (any) return db().stockLocation.update({ where: { id: any.id }, data: { isDefault: true } });
  return db().stockLocation.create({ data: { tenantId: ctx.tenantId, name: 'Main godown', isDefault: true } });
}

/** The balance row, made if missing and locked for this transaction, in one round trip */
async function lockBalance(ctx: TenantCtx, itemId: string, locationId: string) {
  const rows = await db().$queryRaw<{ quantity: Prisma.Decimal; value_paise: bigint; last_rate_paise: bigint }[]>`
    INSERT INTO stock_balances (tenant_id, item_id, location_id) VALUES (${ctx.tenantId}::uuid, ${itemId}::uuid, ${locationId}::uuid)
    ON CONFLICT (item_id, location_id) DO UPDATE SET updated_at = stock_balances.updated_at
    RETURNING quantity, value_paise, last_rate_paise`;
  const r = rows[0];
  return { qty: milli(r.quantity), value: r.value_paise, lastRate: r.last_rate_paise };
}

async function fallbackRate(itemId: string, bal: { qty: bigint; value: bigint; lastRate: bigint }) {
  if (bal.qty > 0n) return (bal.value * 1000n) / bal.qty;
  if (bal.lastRate > 0n) return bal.lastRate;
  const item = await db().item.findUnique({ where: { id: itemId }, select: { costPricePaise: true } });
  return item?.costPricePaise ?? 0n;
}

/** Take quantity off the oldest layers. Returns what it cost and how much the layers covered. */
async function consumeLayers(itemId: string, locationId: string, qtyMilli: bigint) {
  const layers = await db().$queryRaw<{ id: string; qty_remaining: Prisma.Decimal; rate_paise: bigint }[]>`
    SELECT id, qty_remaining, rate_paise FROM stock_layers WHERE item_id = ${itemId}::uuid AND location_id = ${locationId}::uuid
    ORDER BY received_on, created_at FOR UPDATE`;
  let left = qtyMilli;
  let value = 0n;
  for (const l of layers) {
    if (left <= 0n) break;
    const have = milli(l.qty_remaining);
    const take = have < left ? have : left;
    value += valueOf(l.rate_paise, take);
    left -= take;
    if (take === have) await db().stockLayer.delete({ where: { id: l.id } });
    else await db().stockLayer.update({ where: { id: l.id }, data: { qtyRemaining: dec(have - take) } });
  }
  return { value, covered: qtyMilli - left };
}

async function lockBatch(ctx: TenantCtx, batchId: string, locationId: string, add: bigint) {
  const rows = await db().$queryRaw<{ quantity: Prisma.Decimal }[]>`
    INSERT INTO stock_batch_balances (tenant_id, batch_id, location_id, quantity) VALUES (${ctx.tenantId}::uuid, ${batchId}::uuid, ${locationId}::uuid, ${dec(add)})
    ON CONFLICT (batch_id, location_id) DO UPDATE SET quantity = stock_batch_balances.quantity + EXCLUDED.quantity
    RETURNING quantity`;
  return milli(rows[0].quantity);
}

async function moveSerials(ctx: TenantCtx, m: MoveInput, itemName: string) {
  const serials = m.serials ?? [];
  if (!serials.length) return;
  const rows = await db().stockSerial.findMany({ where: { itemId: m.itemId, serial: { in: serials } } });
  const byNo = new Map(rows.map((r) => [r.serial, r]));
  if (m.qtyMilli > 0n) {
    for (const s of serials) {
      const row = byNo.get(s);
      if (row?.status === 'in_stock') throw new AppError('CONFLICT', `Serial ${s} of ${itemName} is already in stock.`, { serial: s });
      if (row) await db().stockSerial.update({ where: { id: row.id }, data: { status: 'in_stock', locationId: m.locationId, updatedAt: new Date() } });
      else await db().stockSerial.create({ data: { tenantId: ctx.tenantId, itemId: m.itemId, serial: s, status: 'in_stock', locationId: m.locationId } });
    }
    return;
  }
  const status = m.kind === 'sale' ? 'sold' : m.kind === 'transfer_out' ? 'transit' : 'gone';
  for (const s of serials) {
    const row = byNo.get(s);
    if (!row || row.status !== 'in_stock' || row.locationId !== m.locationId) throw new AppError('CONFLICT', `Serial ${s} of ${itemName} is not in stock here.`, { serial: s });
    await db().stockSerial.update({ where: { id: row.id }, data: { status, updatedAt: new Date() } });
  }
}

export async function applyMove(ctx: TenantCtx, m: MoveInput) {
  if (m.qtyMilli === 0n) return null;
  const rules = m.rules ?? (await loadRules(ctx));
  const item = await db().item.findUniqueOrThrow({ where: { id: m.itemId }, select: { name: true, unit: true, tracking: true } });
  const bal = await lockBalance(ctx, m.itemId, m.locationId);
  const incoming = m.qtyMilli > 0n;
  const qty = bal.qty + m.qtyMilli;
  let rate: bigint;
  let value: bigint;

  if (incoming) {
    rate = m.ratePaise !== undefined ? m.ratePaise : await fallbackRate(m.itemId, bal);
    value = valueOf(rate, m.qtyMilli);
    // Stock below zero is paid back first; only the rest becomes a layer
    const debt = bal.qty < 0n ? -bal.qty : 0n;
    const layerQty = m.qtyMilli > debt ? m.qtyMilli - debt : 0n;
    if (layerQty > 0n) await db().stockLayer.create({ data: { tenantId: ctx.tenantId, itemId: m.itemId, locationId: m.locationId, receivedOn: m.date, qtyRemaining: dec(layerQty), ratePaise: rate } });
  } else {
    if (qty < 0n && !m.allowNegative && (rules.blockNegative || item.tracking !== 'none')) {
      throw new AppError('CONFLICT', `Only ${fromMilli(bal.qty)} ${item.unit} of ${item.name} is in stock.`, { stock: true, itemId: m.itemId });
    }
    const out = -m.qtyMilli;
    const fallback = await fallbackRate(m.itemId, bal);
    const used = await consumeLayers(m.itemId, m.locationId, out);
    if (m.ratePaise !== undefined) {
      rate = m.ratePaise;
      value = -valueOf(rate, out);
    } else if (rules.valuation === 'fifo') {
      value = -(used.value + valueOf(fallback, out - used.covered));
      rate = (-value * 1000n) / out;
    } else {
      rate = fallback;
      // Its share of the value on hand, so issuing everything leaves exactly nothing
      value = bal.qty > 0n && out <= bal.qty ? -((bal.value * out * 2n + bal.qty) / (bal.qty * 2n)) : -valueOf(rate, out);
    }
  }

  if (m.batchId) {
    const left = await lockBatch(ctx, m.batchId, m.locationId, m.qtyMilli);
    if (left < 0n && !m.allowNegative) {
      const batch = await db().stockBatch.findUnique({ where: { id: m.batchId }, select: { number: true } });
      throw new AppError('CONFLICT', `Only ${fromMilli(left - m.qtyMilli)} ${item.unit} of ${item.name} is left in batch ${batch?.number ?? ''}.`, { stock: true, itemId: m.itemId });
    }
  }
  await moveSerials(ctx, m, item.name);

  // Nothing left: no value left either, so rounding never leaves stray paise
  const newValue = qty === 0n ? 0n : bal.value + value;
  await db().stockBalance.update({
    where: { itemId_locationId: { itemId: m.itemId, locationId: m.locationId } },
    data: { quantity: dec(qty), valuePaise: newValue, lastRatePaise: rate > 0n ? rate : bal.lastRate, updatedAt: new Date() },
  });
  return db().stockMove.create({
    data: {
      tenantId: ctx.tenantId, itemId: m.itemId, locationId: m.locationId, moveDate: m.date, kind: m.kind, quantity: dec(m.qtyMilli),
      ratePaise: rate, valuePaise: value, balanceQty: dec(qty), sourceType: m.sourceType, sourceId: m.sourceId, sourceLineId: m.sourceLineId ?? null,
      reversesId: m.reversesId ?? null, batchId: m.batchId ?? null, serials: m.serials ?? [], createdBy: ctx.userId,
    },
  });
}

/** Undo every live move of a document with opposite moves at the same rate, batch and serials. */
export async function reverseSource(ctx: TenantCtx, sourceId: string) {
  const moves = await db().stockMove.findMany({ where: { tenantId: ctx.tenantId, sourceId, reversesId: null }, orderBy: { createdAt: 'asc' } });
  if (!moves.length) return;
  const undone = new Set((await db().stockMove.findMany({ where: { reversesId: { in: moves.map((x) => x.id) } }, select: { reversesId: true } })).map((x) => x.reversesId));
  const rules = await loadRules(ctx);
  for (const mv of moves.filter((x) => !undone.has(x.id))) {
    await applyMove(ctx, {
      itemId: mv.itemId, locationId: mv.locationId, date: mv.moveDate, kind: mv.kind as MoveKind, qtyMilli: -milli(mv.quantity),
      ratePaise: mv.ratePaise, sourceType: mv.sourceType as MoveInput['sourceType'], sourceId: mv.sourceId, sourceLineId: mv.sourceLineId, reversesId: mv.id,
      batchId: mv.batchId, serials: mv.serials, allowNegative: true, rules,
    });
  }
}

async function hasLiveMoves(ctx: TenantCtx, sourceId: string) {
  const rows = await db().$queryRaw<{ live: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM stock_moves m WHERE m.tenant_id = ${ctx.tenantId}::uuid AND m.source_id = ${sourceId}::uuid AND m.reverses_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM stock_moves r WHERE r.reverses_id = m.id)) AS live`;
  return rows[0].live;
}

/** Batches of an item at a godown with stock, earliest expiry first; expired ones only when asked. */
export async function batchesWithStock(itemId: string, locationId: string, onDate: Date, includeExpired = false) {
  const rows = await db().$queryRaw<{ id: string; number: string; expiry_date: Date | null; mfg_date: Date | null; quantity: Prisma.Decimal }[]>`
    SELECT b.id, b.number, b.expiry_date, b.mfg_date, bb.quantity FROM stock_batch_balances bb JOIN stock_batches b ON b.id = bb.batch_id
    WHERE b.item_id = ${itemId}::uuid AND bb.location_id = ${locationId}::uuid AND bb.quantity > 0
    ORDER BY b.expiry_date NULLS LAST, b.created_at`;
  return rows
    .map((r) => ({ id: r.id, number: r.number, expiryDate: r.expiry_date, mfgDate: r.mfg_date, qtyMilli: milli(r.quantity), expired: !!r.expiry_date && r.expiry_date < onDate }))
    .filter((r) => includeExpired || !r.expired);
}

/** Split an issue across batches, earliest expiry first (FEFO), skipping expired stock. */
export async function allocateBatches(itemId: string, itemName: string, locationId: string, qtyMilli: bigint, onDate: Date) {
  const batches = await batchesWithStock(itemId, locationId, onDate);
  const out: { batchId: string; number: string; expiryDate: Date | null; qtyMilli: bigint }[] = [];
  let left = qtyMilli;
  for (const b of batches) {
    if (left <= 0n) break;
    const take = b.qtyMilli < left ? b.qtyMilli : left;
    out.push({ batchId: b.id, number: b.number, expiryDate: b.expiryDate, qtyMilli: take });
    left -= take;
  }
  if (left > 0n) throw new AppError('CONFLICT', `Only ${fromMilli(qtyMilli - left)} of ${itemName} is in unexpired batches.`, { stock: true, itemId });
  return out;
}

/** Base units in one line: a line billed in the second unit (box) counts its factor (12 pcs) */
export const unitFactor = (unit: string, item: { altUnit: string | null; altFactor: Prisma.Decimal | null }) =>
  item.altUnit && item.altFactor && unit.trim().toLowerCase() === item.altUnit.trim().toLowerCase() ? milli(item.altFactor) : 1000n;

/**
 * Stock goes out for an issued invoice or a delivery challan, and comes back for a goods-returned
 * credit note. Only lines of tracked items move stock; services and typed lines never do. An invoice
 * made from a challan moves nothing: the challan already took the goods out. Batch items leave from the
 * batch chosen on the line, or earliest expiry first; serial items need their numbers. Safe to call twice.
 */
export async function postDocumentStock(ctx: TenantCtx, documentId: string) {
  if (await hasLiveMoves(ctx, documentId)) return;
  const doc = await db().salesDocument.findUnique({ where: { id: documentId }, include: { lines: { orderBy: { position: 'asc' } } } });
  if (!doc || ['draft', 'cancelled'].includes(doc.status)) return;
  if (doc.kind === 'invoice' && doc.sourceType === 'delivery_challan') return;
  if (doc.kind === 'credit_note' && doc.noteType !== 'return') return;
  if (!['invoice', 'delivery_challan', 'credit_note'].includes(doc.kind)) return;
  const ids = [...new Set(doc.lines.map((l) => l.itemId).filter(Boolean))] as string[];
  if (!ids.length) return;
  const items = await db().item.findMany({ where: { id: { in: ids }, trackStock: true, type: 'product' }, select: { id: true, name: true, tracking: true, altUnit: true, altFactor: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const lines = doc.lines.filter((l) => l.itemId && byId.has(l.itemId));
  if (!lines.length) return;
  const location = await defaultLocation(ctx);
  const rules = await loadRules(ctx);
  const back = doc.kind === 'credit_note';
  const kind = back ? 'sale_return' : 'sale';
  const base = { locationId: location.id, date: doc.issueDate, kind: kind as MoveKind, sourceType: doc.kind as MoveInput['sourceType'], sourceId: doc.id, rules };

  for (const l of lines) {
    const item = byId.get(l.itemId!)!;
    // Free goods leave the shelf too; a line in boxes moves boxes × pieces per box
    const q = ((milli(l.quantity) + (back ? 0n : milli(l.freeQuantity))) * unitFactor(l.unit, item)) / 1000n;
    if (q === 0n) continue;

    if (back) {
      // A return comes back at the cost, batch and serials it went out with, when the sale is on record
      const sold = l.sourceLineId ? await db().stockMove.findMany({ where: { tenantId: ctx.tenantId, sourceLineId: l.sourceLineId, reversesId: null, kind: 'sale' }, orderBy: { createdAt: 'asc' } }) : [];
      let serials = l.serials;
      if (item.tracking === 'serial') {
        const pool = sold.flatMap((s) => s.serials);
        if (!serials.length) {
          const still = await db().stockSerial.findMany({ where: { itemId: item.id, serial: { in: pool }, status: 'sold' }, select: { serial: true } });
          serials = still.map((s) => s.serial).slice(0, Number(q / 1000n));
        }
        if (serials.length * 1000 !== Number(q)) throw new AppError('VALIDATION_FAILED', `Choose ${fromMilli(q)} serial numbers of ${item.name} to take back.`, { fields: { serials: 'Count does not match' } });
      }
      if (item.tracking === 'batch' && sold.some((s) => s.batchId)) {
        let left = q;
        for (const s of sold) {
          if (left <= 0n) break;
          const take = -milli(s.quantity) < left ? -milli(s.quantity) : left;
          await applyMove(ctx, { ...base, itemId: item.id, qtyMilli: take, ratePaise: s.ratePaise, sourceLineId: l.id, batchId: s.batchId, allowNegative: true });
          left -= take;
        }
        continue;
      }
      if (item.tracking === 'batch') throw new AppError('VALIDATION_FAILED', `${item.name} is batch-tracked but its sale has no batch on record. Return it with a stock adjustment instead.`);
      await applyMove(ctx, { ...base, itemId: item.id, qtyMilli: q, ratePaise: sold[0]?.ratePaise, sourceLineId: l.id, serials, allowNegative: true });
      continue;
    }

    if (item.tracking === 'serial') {
      if (l.serials.length * 1000 !== Number(q)) throw new AppError('VALIDATION_FAILED', `Enter ${fromMilli(q)} serial number${q === 1000n ? '' : 's'} for ${item.name}.`, { fields: { serials: 'Serial numbers needed' }, itemId: item.id });
      await applyMove(ctx, { ...base, itemId: item.id, qtyMilli: -q, sourceLineId: l.id, serials: l.serials });
      continue;
    }
    if (item.tracking === 'batch') {
      let parts: { batchId: string; number: string; expiryDate: Date | null; qtyMilli: bigint }[];
      if (l.batchId) {
        const b = await db().stockBatch.findFirst({ where: { id: l.batchId, itemId: item.id } });
        if (!b) throw new AppError('VALIDATION_FAILED', `Unknown batch for ${item.name}.`);
        if (b.expiryDate && b.expiryDate < doc.issueDate) throw new AppError('CONFLICT', `Batch ${b.number} of ${item.name} expired on ${b.expiryDate.toISOString().slice(0, 10)}.`, { expired: true });
        parts = [{ batchId: b.id, number: b.number, expiryDate: b.expiryDate, qtyMilli: q }];
      } else {
        parts = await allocateBatches(item.id, item.name, location.id, q, doc.issueDate);
      }
      for (const p of parts) await applyMove(ctx, { ...base, itemId: item.id, qtyMilli: -p.qtyMilli, sourceLineId: l.id, batchId: p.batchId });
      await db().salesDocumentLine.update({
        where: { id: l.id },
        data: { batches: parts.map((p) => ({ number: p.number, expiry: p.expiryDate?.toISOString().slice(0, 10) ?? null, quantity: fromMilli(p.qtyMilli) })) as Prisma.InputJsonValue },
      });
      continue;
    }
    await applyMove(ctx, { ...base, itemId: item.id, qtyMilli: -q, sourceLineId: l.id });
  }
}

export { abs };
