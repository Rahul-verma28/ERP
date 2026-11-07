import { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { withDefaults } from '../../contracts/workspace';

// The one writer of stock. Every change is a row in stock_moves (never edited or deleted) and the
// running stock_balances row is updated in the same transaction. Cost is moving weighted average:
// a receipt adds its value, an issue takes value at the current average rate.

/** Quantities are kept in thousandths so 0.1 + 0.2 stays exact */
export const milli = (q: unknown) => BigInt(Math.round(Number(q) * 1000));
export const fromMilli = (m: bigint) => Number(m) / 1000;
const dec = (m: bigint) => new Prisma.Decimal(fromMilli(m).toFixed(3));
const valueOf = (rate: bigint, qtyMilli: bigint) => (rate * qtyMilli + (qtyMilli >= 0n ? 500n : -500n)) / 1000n;

export interface MoveInput {
  itemId: string;
  locationId: string;
  date: Date;
  kind: 'opening' | 'stock_in' | 'sale' | 'sale_return' | 'adjustment' | 'transfer_in' | 'transfer_out' | 'count';
  /** Signed, in thousandths: positive comes in */
  qtyMilli: bigint;
  /** For receipts: the cost per unit. Issues use the average and ignore it */
  ratePaise?: bigint;
  sourceType: 'stock_entry' | 'invoice' | 'delivery_challan' | 'credit_note';
  sourceId: string;
  sourceLineId?: string | null;
  reversesId?: string | null;
  /** The owner's "block negative stock" is checked unless this is a reversal */
  allowNegative?: boolean;
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

/** The rate an issue is costed at: the average while there is stock, else the last or item cost */
async function currentRate(itemId: string, bal: { qty: bigint; value: bigint; lastRate: bigint }) {
  if (bal.qty > 0n) return (bal.value * 1000n) / bal.qty;
  if (bal.lastRate > 0n) return bal.lastRate;
  const item = await db().item.findUnique({ where: { id: itemId }, select: { costPricePaise: true } });
  return item?.costPricePaise ?? 0n;
}

export async function applyMove(ctx: TenantCtx, m: MoveInput) {
  if (m.qtyMilli === 0n) return null;
  const bal = await lockBalance(ctx, m.itemId, m.locationId);
  const incoming = m.qtyMilli > 0n;
  const rate = incoming && m.ratePaise !== undefined ? m.ratePaise : await currentRate(m.itemId, bal);
  const value = valueOf(rate, m.qtyMilli);
  const qty = bal.qty + m.qtyMilli;
  if (!incoming && qty < 0n && !m.allowNegative) {
    const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { preferences: true } });
    if (withDefaults(tenant.preferences).inventory.blockNegative) {
      const item = await db().item.findUnique({ where: { id: m.itemId }, select: { name: true, unit: true } });
      throw new AppError('CONFLICT', `Only ${fromMilli(bal.qty)} ${item?.unit ?? ''} of ${item?.name ?? 'this item'} is in stock.`.replace('  ', ' '), { stock: true, itemId: m.itemId });
    }
  }
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
      reversesId: m.reversesId ?? null, createdBy: ctx.userId,
    },
  });
}

/** Undo every live move of a document with opposite moves at the same rate. */
export async function reverseSource(ctx: TenantCtx, sourceId: string) {
  const moves = await db().stockMove.findMany({ where: { tenantId: ctx.tenantId, sourceId, reversesId: null }, orderBy: { createdAt: 'asc' } });
  const undone = new Set((await db().stockMove.findMany({ where: { reversesId: { in: moves.map((x) => x.id) } }, select: { reversesId: true } })).map((x) => x.reversesId));
  for (const mv of moves.filter((x) => !undone.has(x.id))) {
    await applyMove(ctx, {
      itemId: mv.itemId, locationId: mv.locationId, date: mv.moveDate, kind: mv.kind as MoveInput['kind'], qtyMilli: -milli(mv.quantity),
      ratePaise: mv.ratePaise, sourceType: mv.sourceType as MoveInput['sourceType'], sourceId: mv.sourceId, sourceLineId: mv.sourceLineId, reversesId: mv.id, allowNegative: true,
    });
  }
}

async function hasLiveMoves(ctx: TenantCtx, sourceId: string) {
  const rows = await db().$queryRaw<{ live: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM stock_moves m WHERE m.tenant_id = ${ctx.tenantId}::uuid AND m.source_id = ${sourceId}::uuid AND m.reverses_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM stock_moves r WHERE r.reverses_id = m.id)) AS live`;
  return rows[0].live;
}

/**
 * Stock goes out for an issued invoice or a delivery challan, and comes back for a goods-returned
 * credit note. Only lines of tracked items move stock; services and typed lines never do. An invoice
 * made from a challan moves nothing: the challan already took the goods out. Safe to call twice.
 */
export async function postDocumentStock(ctx: TenantCtx, documentId: string) {
  if (await hasLiveMoves(ctx, documentId)) return;
  const doc = await db().salesDocument.findUnique({ where: { id: documentId }, include: { lines: true } });
  if (!doc || ['draft', 'cancelled'].includes(doc.status)) return;
  if (doc.kind === 'invoice' && doc.sourceType === 'delivery_challan') return;
  if (doc.kind === 'credit_note' && doc.noteType !== 'return') return;
  if (!['invoice', 'delivery_challan', 'credit_note'].includes(doc.kind)) return;
  const ids = [...new Set(doc.lines.map((l) => l.itemId).filter(Boolean))] as string[];
  if (!ids.length) return;
  const tracked = new Set((await db().item.findMany({ where: { id: { in: ids }, trackStock: true, type: 'product' }, select: { id: true } })).map((i) => i.id));
  const lines = doc.lines.filter((l) => l.itemId && tracked.has(l.itemId));
  if (!lines.length) return;
  const location = await defaultLocation(ctx);
  const back = doc.kind === 'credit_note';
  for (const l of lines) {
    // Free goods leave the shelf too
    const q = milli(l.quantity) + (back ? 0n : milli(l.freeQuantity));
    // A return comes back at the cost it went out at, when the sale is on record
    const sold = back && l.sourceLineId ? await db().stockMove.findFirst({ where: { tenantId: ctx.tenantId, sourceLineId: l.sourceLineId, reversesId: null, kind: 'sale' } }) : null;
    await applyMove(ctx, {
      itemId: l.itemId!, locationId: location.id, date: doc.issueDate, kind: back ? 'sale_return' : 'sale', qtyMilli: back ? q : -q,
      ratePaise: sold?.ratePaise, sourceType: doc.kind as MoveInput['sourceType'], sourceId: doc.id, sourceLineId: l.id,
    });
  }
}
