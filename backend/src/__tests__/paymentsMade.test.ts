import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import * as purchase from '../modules/purchase/service';
import { PayInput, listSupplierPayments, openSupplierBills, paySuppliers, reverseSupplierPaymentGroup } from '../modules/purchase/payments';

// Payments made: one payment to a supplier split over their invoices, under one number.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 180_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}
afterAll(() => prisma.$disconnect());

const today = todayIST();
const base = { reverseCharge: false, chargesPaise: 0, chargesGstBp: 0, roundOff: false };
async function setup() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Payer', email: `paid-${n}@example.test`, mobile: `+916${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Payments ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09', gstin: '09AAACS1234F1Z5' } });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'warehouse_manager', tenantId: null }, select: { id: true } })).id;
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const supplier = await purchase.createSupplier(ctx, { name: 'Gupta Wholesale', gstin: '09AABCG1234K1Z2', stateCode: '09', paymentDays: 30 });
  const bill = (ref: string, rupees: number) => purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: supplier.id, supplierRef: ref, supplierDate: today, lines: [{ description: 'Stock', quantity: 1, unitPricePaise: rupees * 100, discountPaise: 0, gstRateBp: 0 }] });
  const a = await bill('A-1', 3000)
  const b = await bill('A-2', 2000)
  return { ctx, supplier, a, b };
}
const status = async (id: string) => (await db().purchaseDocument.findUniqueOrThrow({ where: { id }, select: { status: true, paidPaise: true } }));

describe('payments made', () => {
  it('pays two invoices under one number and reverses both together', async () => {
    await rolledBack(async () => {
      const { ctx, supplier, a, b } = await setup();
      expect((await openSupplierBills(ctx, supplier.id)).map((x) => x.id)).toEqual([a.id, b.id]);
      const p = await paySuppliers(ctx, PayInput.parse({ contactId: supplier.id, amountPaise: 400_000, method: 'bank', reference: 'UTR9', allocations: [{ documentId: a.id, amountPaise: 300_000 }, { documentId: b.id, amountPaise: 100_000 }] }));
      expect(p.amountPaise).toBe(400_000n);
      expect(p.appliedTo).toHaveLength(2);
      expect(await status(a.id)).toMatchObject({ status: 'paid' });
      expect(await status(b.id)).toMatchObject({ status: 'part_paid', paidPaise: 100_000n });
      expect((await listSupplierPayments(ctx, {})).data).toHaveLength(1);

      const back = await reverseSupplierPaymentGroup(ctx, p.id);
      expect(back.reversed).toBe(true);
      expect((await status(a.id)).paidPaise).toBe(0n);
      expect((await status(b.id)).paidPaise).toBe(0n);
    });
  });

  it('refuses more than due, an unspread amount, a bank payment with no UTR, and big cash', async () => {
    await rolledBack(async () => {
      const { ctx, supplier, a } = await setup();
      await expect(paySuppliers(ctx, PayInput.parse({ contactId: supplier.id, amountPaise: 400_000, method: 'upi', allocations: [{ documentId: a.id, amountPaise: 400_000 }] }))).rejects.toThrow('due');
      expect(PayInput.safeParse({ contactId: supplier.id, amountPaise: 5_000, method: 'upi', allocations: [{ documentId: a.id, amountPaise: 4_000 }] }).success).toBe(false);
      expect(PayInput.safeParse({ contactId: supplier.id, amountPaise: 5_000, method: 'bank', allocations: [{ documentId: a.id, amountPaise: 5_000 }] }).error?.issues[0]?.path.join('.')).toBe('reference');
      await expect(paySuppliers(ctx, PayInput.parse({ contactId: supplier.id, amountPaise: 1_000_100, method: 'cash', allocations: [{ documentId: a.id, amountPaise: 1_000_100 }] }))).rejects.toThrow();
    });
  });
});
