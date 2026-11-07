import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import * as purchase from '../modules/purchase/service';
import * as reports from '../modules/purchase/reports';

// Purchase batch 1: supplier, PO → GRN → bill, direct bill with landed cost, reverse charge,
// interstate tax, returns, payments, and the payables, ITC and reorder reports.

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
async function setup(opts: { composition?: boolean } = {}) {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Buyer', email: `pur-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({
    data: { name: `Purchase ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09', gstin: '09AAACS1234F1Z5', ...(opts.composition ? { preferences: { taxes: { composition: true } } } : {}) },
  });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'warehouse_manager', tenantId: null }, select: { id: true } })).id;
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const supplier = await purchase.createSupplier(ctx, { name: 'Gupta Wholesale', gstin: '09AABCG1234K1Z2', stateCode: '09', paymentDays: 30 });
  const fan = await db().item.create({ data: { tenantId: tenant.id, name: 'Fan', unit: 'pcs', pricePaise: 20_000n, gstRateBp: 1800, reorderLevel: '5' } });
  return { ctx, supplier, fan };
}
const balance = (itemId: string) => db().stockBalance.findFirstOrThrow({ where: { itemId } });
const base = { reverseCharge: false, chargesPaise: 0, chargesGstBp: 0, roundOff: false };

describe('order to receipt to bill', () => {
  it('receives part of an order at its price, blocks over-receipt, and bills the GRN without moving stock again', async () => {
    await rolledBack(async () => {
      const { ctx, supplier, fan } = await setup();
      const po = await purchase.createPurchase(ctx, 'purchase_order', { ...base, contactId: supplier.id, lines: [{ itemId: fan.id, quantity: 10, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800 }] });
      expect(po).toMatchObject({ status: 'open', taxablePaise: 100_000n, cgstPaise: 9_000n, sgstPaise: 9_000n, totalPaise: 118_000n });

      await expect(purchase.createPurchase(ctx, 'goods_receipt', { ...base, contactId: supplier.id, sourceId: po.id, lines: [{ itemId: fan.id, quantity: 11, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800, sourceLineId: po.lines[0].id }] }))
        .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const grn = await purchase.createPurchase(ctx, 'goods_receipt', { ...base, contactId: supplier.id, sourceId: po.id, supplierRef: 'CH-11', lines: [{ itemId: fan.id, quantity: 6, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800, sourceLineId: po.lines[0].id }] });
      expect(await balance(fan.id)).toMatchObject({ valuePaise: 60_000n });
      expect((await purchase.getPurchase(ctx, po.id)).status).toBe('part_received');

      const bill = await purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: supplier.id, sourceId: grn.id, supplierRef: 'GW/101', supplierDate: today, lines: [{ itemId: fan.id, quantity: 6, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800, sourceLineId: grn.lines[0].id }] });
      expect(bill).toMatchObject({ status: 'unpaid', totalPaise: 70_800n, balancePaise: 70_800n });
      expect(bill.dueDate).not.toBeNull();
      expect(Number((await balance(fan.id)).quantity)).toBe(6);
      expect((await purchase.getPurchase(ctx, grn.id)).status).toBe('billed');
      // Same supplier bill number twice is refused
      await expect(purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: supplier.id, supplierRef: 'gw/101', supplierDate: today, lines: [{ itemId: fan.id, quantity: 1, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800 }] }))
        .rejects.toMatchObject({ code: 'CONFLICT' });
      // The GRN cannot go while its bill stands
      await expect(purchase.cancelPurchase(ctx, grn.id, 'wrong')).rejects.toMatchObject({ code: 'CONFLICT' });

      const pending = await reports.pendingOrders(ctx);
      expect(pending.data[0]).toMatchObject({ number: po.number, pending: 4 });
      await purchase.closeOrder(ctx, po.id);
      expect((await reports.pendingOrders(ctx)).data).toHaveLength(0);
    });
  });
});

describe('direct bill', () => {
  it('adds freight to stock cost, charges IGST from another state, and takes no tax under reverse charge', async () => {
    await rolledBack(async () => {
      const { ctx, fan } = await setup();
      const delhi = await purchase.createSupplier(ctx, { name: 'Delhi Fans', gstin: '07AABCD1234E1Z3' });
      const bill = await purchase.createPurchase(ctx, 'purchase_bill', { ...base, chargesPaise: 2_000, chargesGstBp: 1800, contactId: delhi.id, supplierRef: 'DF-9', supplierDate: today, lines: [{ itemId: fan.id, quantity: 4, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800 }] });
      expect(bill).toMatchObject({ cgstPaise: 0n, igstPaise: 7_560n, taxablePaise: 42_000n, totalPaise: 49_560n });
      // Freight is in the stock's cost; the GST is claimed, so it is not
      expect(await balance(fan.id)).toMatchObject({ valuePaise: 42_000n });

      const transporter = await purchase.createSupplier(ctx, { name: 'Raj Transport', gstin: '09AABCR1234F1Z1' });
      const gta = await purchase.createPurchase(ctx, 'purchase_bill', { ...base, reverseCharge: true, contactId: transporter.id, supplierRef: 'LR-5', supplierDate: today, lines: [{ description: 'Freight', quantity: 1, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 500 }] });
      expect(gta).toMatchObject({ cgstPaise: 250n, sgstPaise: 250n, totalPaise: 10_000n });

      const itc = await reports.itcRegister(ctx, { from: today, to: today });
      expect(itc.eligible).toBe(true);
      expect(itc.totals).toMatchObject({ igstPaise: 7_560n, cgstPaise: 250n, reverseChargePaise: 500n });
    });
  });

  it('puts GST into stock cost on the composition scheme, and an unregistered supplier charges none', async () => {
    await rolledBack(async () => {
      const { ctx, supplier, fan } = await setup({ composition: true });
      await purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: supplier.id, supplierRef: 'GW/1', supplierDate: today, lines: [{ itemId: fan.id, quantity: 2, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800 }] });
      expect(await balance(fan.id)).toMatchObject({ valuePaise: 23_600n });
      const local = await purchase.createSupplier(ctx, { name: 'Local Market' });
      const b = await purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: local.id, supplierRef: 'X1', supplierDate: today, lines: [{ itemId: fan.id, quantity: 1, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800 }] });
      expect(b).toMatchObject({ cgstPaise: 0n, totalPaise: 10_000n });
      expect((await reports.itcRegister(ctx, { from: today, to: today })).eligible).toBe(false);
    });
  });
});

describe('returns and payments', () => {
  it('sends goods back at their cost, lowers what is owed, and records and reverses payments', async () => {
    await rolledBack(async () => {
      const { ctx, supplier, fan } = await setup();
      const bill = await purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: supplier.id, supplierRef: 'GW/7', supplierDate: today, lines: [{ itemId: fan.id, quantity: 10, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800 }] });
      const ret = await purchase.createPurchase(ctx, 'purchase_return', { ...base, contactId: supplier.id, sourceId: bill.id, lines: [{ itemId: fan.id, quantity: 2, unitPricePaise: 0, discountPaise: 0, gstRateBp: 0, sourceLineId: bill.lines[0].id }] });
      expect(ret).toMatchObject({ taxablePaise: 20_000n, totalPaise: 23_600n });
      expect(await balance(fan.id)).toMatchObject({ valuePaise: 80_000n });
      expect(await purchase.purchaseView(ctx, bill.id)).toMatchObject({ status: 'part_paid', balancePaise: 94_400n });
      await expect(purchase.createPurchase(ctx, 'purchase_return', { ...base, contactId: supplier.id, sourceId: bill.id, lines: [{ itemId: fan.id, quantity: 9, unitPricePaise: 0, discountPaise: 0, gstRateBp: 0, sourceLineId: bill.lines[0].id }] }))
        .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      await expect(purchase.paySupplier(ctx, bill.id, { amountPaise: 94_401, method: 'bank' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      // Section 40A(3): cash over ₹10,000 a day to one supplier is refused
      const big = await purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: supplier.id, supplierRef: 'GW/8', supplierDate: today, lines: [{ description: 'Shelf', quantity: 1, unitPricePaise: 2_000_000, discountPaise: 0, gstRateBp: 0 }] });
      await expect(purchase.paySupplier(ctx, big.id, { amountPaise: 1_000_100, method: 'cash' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await purchase.cancelPurchase(ctx, big.id, 'test');
      const paid = await purchase.paySupplier(ctx, bill.id, { amountPaise: 50_000, method: 'upi', reference: 'UTR1' });
      expect(paid).toMatchObject({ paidPaise: 50_000n, balancePaise: 44_400n });
      await expect(purchase.cancelPurchase(ctx, bill.id, 'wrong')).rejects.toMatchObject({ code: 'CONFLICT' });

      const pay = paid.payments[0];
      expect(pay.number).toMatch(/^PAY\//);
      const back = await purchase.reverseSupplierPayment(ctx, pay.id);
      expect(back).toMatchObject({ paidPaise: 0n });
      await expect(purchase.reverseSupplierPayment(ctx, pay.id)).rejects.toMatchObject({ code: 'CONFLICT' });

      const ledger = await reports.supplierLedger(ctx, supplier.id, {});
      expect(ledger.closingPaise).toBe(94_400n);
      expect((await reports.payables(ctx)).totals.totalPaise).toBe(94_400n);

      // Undo the return, then the bill: stock goes back to nothing
      await purchase.cancelPurchase(ctx, ret.id, 'not sent');
      expect(await purchase.purchaseView(ctx, bill.id)).toMatchObject({ status: 'unpaid', returnedPaise: 0n });
      await purchase.cancelPurchase(ctx, bill.id, 'entered twice');
      expect(await balance(fan.id)).toMatchObject({ valuePaise: 0n });
    });
  });
});

describe('reorder', () => {
  it('lists low items with their usual supplier and makes one order per supplier', async () => {
    await rolledBack(async () => {
      const { ctx, supplier, fan } = await setup();
      await purchase.createPurchase(ctx, 'purchase_bill', { ...base, contactId: supplier.id, supplierRef: 'GW/2', supplierDate: today, lines: [{ itemId: fan.id, quantity: 3, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800 }] });
      const list = await reports.reorderList(ctx);
      expect(list.data[0]).toMatchObject({ itemId: fan.id, supplierId: supplier.id, available: 3, suggest: 7 });
      const made = await reports.ordersFromReorder(ctx, { lines: [{ itemId: fan.id, contactId: supplier.id, quantity: 7 }] });
      const po = await purchase.purchaseView(ctx, made.data[0].id);
      expect(po).toMatchObject({ kind: 'purchase_order', taxablePaise: 70_000n });
      expect((await reports.reorderList(ctx)).data[0]).toMatchObject({ onOrder: 7, suggest: 0 });
    });
  });
});
