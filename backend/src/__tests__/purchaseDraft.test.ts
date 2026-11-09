import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import * as purchase from '../modules/purchase/service';
import * as reports from '../modules/purchase/reports';

// A draft purchase invoice counts for nothing until it is posted.

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
async function setup() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Buyer', email: `draft-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Draft ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09', gstin: '09AAACS1234F1Z5' } });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'warehouse_manager', tenantId: null }, select: { id: true } })).id;
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const supplier = await purchase.createSupplier(ctx, { name: 'Gupta Wholesale', gstin: '09AABCG1234K1Z2', stateCode: '09' });
  const fan = await db().item.create({ data: { tenantId: tenant.id, name: 'Fan', unit: 'pcs', pricePaise: 20_000n, gstRateBp: 1800 } });
  return { ctx, supplier, fan };
}
const base = { reverseCharge: false, chargesPaise: 0, chargesGstBp: 0, roundOff: false };
const line = (itemId: string, quantity: number) => ({ itemId, quantity, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800 });

describe('purchase return: draft, approved, completed', () => {
  it('moves stock and money only on completion, holds quantity once approved', async () => {
    await rolledBack(async () => {
      const { ctx, supplier, fan } = await setup();
      const bill = await purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: supplier.id, supplierRef: 'GW/2', supplierDate: today, lines: [line(fan.id, 5)] });
      const ret = (quantity: number) => ({ ...base, contactId: supplier.id, sourceId: bill.id, returnReason: 'Defective', lines: [{ ...line(fan.id, quantity), sourceLineId: bill.lines[0].id }] });
      const qty = async () => Number((await db().stockBalance.findFirstOrThrow({ where: { itemId: fan.id } })).quantity);

      const draft = await purchase.createPurchase(ctx, 'purchase_return', ret(3), { draft: true });
      expect(draft).toMatchObject({ status: 'draft', returnReason: 'Defective' });
      expect(await qty()).toBe(5);

      const edited = await purchase.updateBillDraft(ctx, draft.id, ret(4), draft.version);
      const approved = await purchase.approveReturn(ctx, draft.id, edited.version);
      expect(approved.status).toBe('approved');
      expect(await qty()).toBe(5);
      expect((await purchase.getPurchase(ctx, bill.id)).returnedPaise).toBe(0n);
      expect((await reports.purchaseRegister(ctx, { from: today, to: today } as never)).totals.returns).toBe(0);

      // An approved return holds its quantity: only 1 of 5 is left for another
      await expect(purchase.createPurchase(ctx, 'purchase_return', ret(2), { draft: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      const done = await purchase.completeReturn(ctx, draft.id, approved.version);
      expect(done.status).toBe('issued');
      expect(await qty()).toBe(1);
      const after = await purchase.purchaseView(ctx, bill.id);
      expect(after.returnedPaise).toBe(47_200n);
      expect(after).toMatchObject({ status: 'part_paid', balancePaise: 11_800n });
      await expect(purchase.completeReturn(ctx, draft.id, done.version)).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  }, 180_000);

  it('cancels an approved return without touching stock or the invoice', async () => {
    await rolledBack(async () => {
      const { ctx, supplier, fan } = await setup();
      const bill = await purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: supplier.id, supplierRef: 'GW/3', supplierDate: today, lines: [line(fan.id, 2)] });
      const draft = await purchase.createPurchase(ctx, 'purchase_return', { ...base, contactId: supplier.id, sourceId: bill.id, returnReason: 'Other', lines: [{ ...line(fan.id, 1), sourceLineId: bill.lines[0].id }] }, { draft: true });
      const approved = await purchase.approveReturn(ctx, draft.id, draft.version);
      await purchase.cancelPurchase(ctx, approved.id, 'not needed');
      expect(Number((await db().stockBalance.findFirstOrThrow({ where: { itemId: fan.id } })).quantity)).toBe(2);
      expect(await purchase.purchaseView(ctx, bill.id)).toMatchObject({ status: 'unpaid', returnedPaise: 0n });
    });
  }, 180_000);
});

describe('draft purchase invoice', () => {
  it('moves no stock and owes nothing until posted, then posts once', async () => {
    await rolledBack(async () => {
      const { ctx, supplier, fan } = await setup();
      const draft = await purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: supplier.id, lines: [line(fan.id, 2)] }, { draft: true });
      expect(draft).toMatchObject({ status: 'draft', balancePaise: 0n });
      expect(await db().stockBalance.findFirst({ where: { itemId: fan.id } })).toBeNull();
      expect((await purchase.getSupplier(ctx, supplier.id)).balancePaise).toBe(0n);
      await expect(purchase.paySupplier(ctx, draft.id, { amountPaise: 100, method: 'bank' })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(purchase.cancelPurchase(ctx, draft.id, 'wrong')).rejects.toMatchObject({ code: 'CONFLICT' });

      // Posting needs the supplier's paper
      await expect(purchase.postBill(ctx, draft.id, draft.version)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      const posted = await purchase.updateBillDraft(ctx, draft.id, { ...base, contactId: supplier.id, supplierRef: 'GW/1', supplierDate: today, lines: [line(fan.id, 3)] }, draft.version, true);
      expect(posted).toMatchObject({ status: 'unpaid', totalPaise: 35_400n, balancePaise: 35_400n });
      expect(Number((await db().stockBalance.findFirstOrThrow({ where: { itemId: fan.id } })).quantity)).toBe(3);
      expect((await purchase.getSupplier(ctx, supplier.id)).balancePaise).toBe(35_400n);

      await expect(purchase.postBill(ctx, draft.id, posted.version)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(purchase.deleteBillDraft(ctx, draft.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  }, 180_000);

  it('stays out of reports, refuses a repeated supplier invoice at posting, and can be deleted', async () => {
    await rolledBack(async () => {
      const { ctx, supplier, fan } = await setup();
      await purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: supplier.id, supplierRef: 'GW/9', supplierDate: today, lines: [line(fan.id, 1)] });
      const draft = await purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: supplier.id, supplierRef: 'GW/9', supplierDate: today, lines: [line(fan.id, 1)] }, { draft: true });
      await expect(purchase.postBill(ctx, draft.id, draft.version)).rejects.toMatchObject({ code: 'CONFLICT' });
      const register = await reports.purchaseRegister(ctx, { from: today, to: today } as never);
      expect(register.totals.bills).toBe(1);
      await purchase.deleteBillDraft(ctx, draft.id);
      expect(await db().purchaseDocument.findUnique({ where: { id: draft.id } })).toBeNull();
    });
  }, 180_000);
});
