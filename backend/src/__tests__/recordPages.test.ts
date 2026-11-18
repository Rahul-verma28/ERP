import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { recordHistory } from '../modules/audit/history';
import { getPriceList } from '../modules/catalog/lists';

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
afterAll(() => prisma.$disconnect());

async function prepare() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const owner = await db().user.create({ data: { name: 'Asha', email: `rp-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `RP ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: owner.id, billingStateCode: '09' } });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'owner', tenantId: null }, select: { id: true } })).id;
  const m = await db().tenantMember.create({ data: { tenantId: tenant.id, userId: owner.id, roleId, status: 'active' } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: owner.id, memberId: m.id, roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  return { ctx, tenantId: tenant.id, owner };
}

describe('record pages', () => {
  it('shows a record its own entries and the ones that name it, newest first, with who did it', async () => {
    await rolledBack(async () => {
      const { ctx, tenantId, owner } = await prepare();
      const id = randomUUID();
      const other = randomUUID();
      const at = (m: number) => new Date(Date.UTC(2026, 10, 1, 10, m));
      await db().auditLog.createMany({ data: [
        { tenantId, actorKind: 'user', actorId: owner.id, action: 'billing.invoice.issue', entity: 'invoice', entityId: id, after: { number: 'INV-9', totalPaise: 5000 }, at: at(1) },
        { tenantId, actorKind: 'user', actorId: owner.id, action: 'billing.payment.record', entity: 'payment', entityId: randomUUID(), after: { invoice: 'INV-9', amountPaise: 2000, method: 'upi' }, at: at(2) },
        { tenantId, actorKind: 'system', action: 'billing.invoice.issue', entity: 'invoice', entityId: other, after: { number: 'INV-10' }, at: at(3) },
      ] });
      const h = await recordHistory(ctx, { kind: 'sales_doc', id, ref: 'INV-9' });
      expect(h.data.map((x) => x.action)).toEqual(['billing.payment.record', 'billing.invoice.issue']);
      expect(h.data[0]).toMatchObject({ by: 'Asha', other: 'payment' });
      expect(h.data[1].details).toContainEqual({ key: 'totalPaise', value: 5000 });
      // Without the number, only its own entries
      expect((await recordHistory(ctx, { kind: 'sales_doc', id })).data).toHaveLength(1);
    });
  });

  it('prices every item on a list: its own price, else the list discount', async () => {
    await rolledBack(async () => {
      const { ctx, tenantId } = await prepare();
      const list = await db().priceList.create({ data: { tenantId, name: 'Wholesale', discountBp: 1000 } });
      const fan = await db().item.create({ data: { tenantId, type: 'product', name: 'Fan', pricePaise: 200_000n, costPricePaise: 150_000n, gstRateBp: 1800 } });
      const bulb = await db().item.create({ data: { tenantId, type: 'product', name: 'Bulb', pricePaise: 10_000n, costPricePaise: 12_000n, gstRateBp: 1800 } });
      await db().priceListItem.create({ data: { tenantId, priceListId: list.id, itemId: fan.id, pricePaise: 170_000n } });
      await db().contact.create({ data: { tenantId, type: 'customer', name: 'Gupta Store', priceListId: list.id } });
      const p = await getPriceList(ctx, list.id);
      const row = (id: string) => p.items.find((x) => x.id === id)!;
      expect(row(fan.id)).toMatchObject({ exactPaise: 170_000, pricePaise: 170_000, offPct: 15, marginPct: 11.8 });
      expect(row(bulb.id)).toMatchObject({ exactPaise: null, pricePaise: 9_000, offPct: 10 });
      expect(p.sums).toMatchObject({ exact: 1, customers: 1, belowCost: 1 });
      await expect(getPriceList(ctx, randomUUID())).rejects.toThrow('not found');
    });
  });
});
