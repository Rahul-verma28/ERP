import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import type { TenantCtx } from '../../kernel/context';
import { dateOnly, todayIST } from '../../kernel/gst';
import { fromMilli, loadRules, milli } from './engine';

// Stock reports that read the ledger, layers and batches: ageing, slow and dead stock, near expiry.

const DAY = 86_400_000;
const BANDS = [
  { key: 'd0_30', label: '0–30 days', max: 30 },
  { key: 'd31_60', label: '31–60 days', max: 60 },
  { key: 'd61_90', label: '61–90 days', max: 90 },
  { key: 'd91_180', label: '91–180 days', max: 180 },
  { key: 'd180', label: 'Over 180 days', max: Infinity },
] as const;

/**
 * How old the stock on hand is, by when each part of it came in (what is left of each receipt),
 * and when each item last sold. Slow: no sale for 90 days. Dead: no sale for 180 days, or never.
 */
export async function stockAgeing(ctx: TenantCtx) {
  const today = dateOnly(todayIST());
  const rules = await loadRules(ctx);
  const [layers, items, lastSales, balances] = await Promise.all([
    db().stockLayer.findMany({ where: { tenantId: ctx.tenantId, qtyRemaining: { gt: 0 } } }),
    db().item.findMany({ where: { tenantId: ctx.tenantId, trackStock: true }, select: { id: true, name: true, unit: true } }),
    db().stockMove.groupBy({ by: ['itemId'], where: { tenantId: ctx.tenantId, kind: 'sale', reversesId: null }, _max: { moveDate: true } }),
    db().stockBalance.groupBy({ by: ['itemId'], where: { tenantId: ctx.tenantId }, _sum: { quantity: true, valuePaise: true } }),
  ]);
  const rows = items
    .map((i) => {
      const mine = layers.filter((l) => l.itemId === i.id);
      const bands = Object.fromEntries(BANDS.map((b) => [b.key, 0])) as Record<(typeof BANDS)[number]['key'], number>;
      let qty = 0;
      let value = 0n;
      let oldest: Date | null = null;
      for (const l of mine) {
        const q = fromMilli(milli(l.qtyRemaining));
        const age = Math.floor((today.getTime() - l.receivedOn.getTime()) / DAY);
        bands[BANDS.find((b) => age <= b.max)!.key] += q;
        qty += q;
        value += (l.ratePaise * milli(l.qtyRemaining)) / 1000n;
        if (!oldest || l.receivedOn < oldest) oldest = l.receivedOn;
      }
      // Value follows the business's cost method: the layers' own rates for FIFO, the average otherwise
      if (rules.valuation === 'average') {
        const b = balances.find((x) => x.itemId === i.id);
        const onHand = milli(b?._sum.quantity ?? 0);
        value = onHand > 0n ? ((b?._sum.valuePaise ?? 0n) * milli(qty)) / onHand : 0n;
      }
      const lastSale = lastSales.find((s) => s.itemId === i.id)?._max.moveDate ?? null;
      const idle = lastSale ? Math.floor((today.getTime() - lastSale.getTime()) / DAY) : null;
      return {
        id: i.id, name: i.name, unit: i.unit, quantity: qty, valuePaise: value, bands, oldest, lastSale, daysSinceSale: idle,
        status: qty <= 0 ? 'none' : idle === null || idle > 180 ? 'dead' : idle > 90 ? 'slow' : 'moving',
      };
    })
    .filter((r) => r.quantity > 0)
    .sort((a, b) => Number(b.valuePaise - a.valuePaise));
  return { bands: BANDS.map((b) => ({ key: b.key, label: b.label })), data: rows, nextCursor: null, total: rows.length };
}

export const ExpiryQuery = z.object({ days: z.coerce.number().int().min(1).max(365).optional(), locationId: z.string().uuid().optional() });

/** Batches with stock that have expired or expire within the business's near-expiry window. */
export async function nearExpiry(ctx: TenantCtx, query: z.infer<typeof ExpiryQuery>) {
  const rules = await loadRules(ctx);
  const days = query.days ?? rules.nearExpiryDays;
  const today = dateOnly(todayIST());
  const until = new Date(today.getTime() + days * DAY);
  const rows = await db().$queryRaw<{ batch_id: string; number: string; expiry_date: Date; item_id: string; name: string; unit: string; location_id: string; location: string; quantity: Prisma.Decimal }[]>`
    SELECT b.id AS batch_id, b.number, b.expiry_date, i.id AS item_id, i.name, i.unit, l.id AS location_id, l.name AS location, bb.quantity
    FROM stock_batch_balances bb JOIN stock_batches b ON b.id = bb.batch_id JOIN items i ON i.id = b.item_id JOIN stock_locations l ON l.id = bb.location_id
    WHERE bb.tenant_id = ${ctx.tenantId}::uuid AND bb.quantity > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= ${until}
      AND (${query.locationId ?? null}::uuid IS NULL OR bb.location_id = ${query.locationId ?? null}::uuid)
    ORDER BY b.expiry_date, i.name`;
  const data = rows.map((r) => ({
    id: `${r.batch_id}:${r.location_id}`, batchId: r.batch_id, batch: r.number, expiryDate: r.expiry_date, itemId: r.item_id, item: r.name, unit: r.unit, locationId: r.location_id, location: r.location,
    quantity: fromMilli(milli(r.quantity)), daysLeft: Math.floor((r.expiry_date.getTime() - today.getTime()) / DAY),
  }));
  return { days, data, nextCursor: null, total: data.length };
}
