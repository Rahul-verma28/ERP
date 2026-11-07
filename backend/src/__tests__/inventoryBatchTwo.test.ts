import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { dateOnly, todayIST } from '../kernel/gst';
import * as billing from '../modules/billing/service';
import { createCreditNote } from '../modules/billing/creditNotes';
import { postDocumentStock } from '../modules/inventory/engine';
import * as inventory from '../modules/inventory/service';
import { nearExpiry, stockAgeing } from '../modules/inventory/reports';
import { updatePreferences } from '../modules/tenancy/workspace';

// Inventory batch 2: batches with expiry and FEFO, serial numbers, a second unit, FIFO cost,
// transfers in transit, stock held for orders, stock on a past date, ageing, and import matching.

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
const day = (n: number) => new Date(dateOnly(today).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const roleId = async (key: string) => (await prisma.role.findFirstOrThrow({ where: { key, tenantId: null }, select: { id: true } })).id;

async function setup(preferences: Record<string, unknown> = {}) {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Stock Tester', email: `stock2-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Stock Two ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09', gstin: '09AAACS1234F1Z5', preferences } });
  const contact = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Sharma Medical', stateCode: '09' } });
  const item = (data: Record<string, unknown>) => db().item.create({ data: { tenantId: tenant.id, unit: 'pcs', pricePaise: 10_000n, gstRateBp: 1200, ...data } as never });
  const syrup = await item({ name: 'Cough syrup', tracking: 'batch', sku: 'SYR-1', barcode: '8901234567890' });
  const phone = await item({ name: 'Phone', tracking: 'serial' });
  const soap = await item({ name: 'Soap', altUnit: 'box', altFactor: 12 });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId: await roleId('warehouse_manager'), sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const main = (await inventory.listLocations(ctx)).data[0];
  return { ctx, tenantId: tenant.id, contact, syrup, phone, soap, main };
}
const row = async (ctx: TenantCtx, itemId: string, q: Parameters<typeof inventory.stockSummary>[1] = {}) => (await inventory.stockSummary(ctx, q)).data.find((r) => r.id === itemId)!;
const line = (itemId: string, quantity: number, over: Record<string, unknown> = {}) => ({ itemId, description: 'x', unit: 'pcs', quantity, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1200, ...over });
const issued = async (ctx: TenantCtx, id: string) => {
  await db().salesDocument.update({ where: { id }, data: { status: 'issued', number: `INV-${randomUUID().slice(0, 6)}` } });
  await postDocumentStock(ctx, id);
  return billing.getDocument(ctx, id, 'invoice');
};

describe('batches and expiry', () => {
  it('sells earliest expiry first, skips expired stock, and takes returns back into the same batch', async () => {
    await rolledBack(async () => {
      const { ctx, contact, syrup, main } = await setup();
      await inventory.postEntry(ctx, { kind: 'opening', locationId: main.id, date: today, lines: [
        { itemId: syrup.id, quantity: 5, ratePaise: 5_000, batchNo: 'OLD', expiryDate: day(-1) },
        { itemId: syrup.id, quantity: 4, ratePaise: 5_000, batchNo: 'B1', expiryDate: day(20) },
        { itemId: syrup.id, quantity: 10, ratePaise: 5_000, batchNo: 'B2', expiryDate: day(200) },
      ] });
      expect(await row(ctx, syrup.id)).toMatchObject({ quantity: 19, expired: 5, available: 14 });

      const inv = await issued(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line(syrup.id, 6)] })).id);
      expect(inv.lines[0].batches).toEqual([{ number: 'B1', expiry: day(20), quantity: 4 }, { number: 'B2', expiry: day(200), quantity: 2 }]);

      const expired = await db().stockBatch.findFirstOrThrow({ where: { itemId: syrup.id, number: 'OLD' } });
      const bad = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line(syrup.id, 1, { batchId: expired.id })] });
      await expect(issued(ctx, bad.id)).rejects.toMatchObject({ code: 'CONFLICT', details: { expired: true } });

      await createCreditNote(ctx, inv.id, { type: 'return', lines: [{ sourceLineId: inv.lines[0].id, quantity: 3 }] });
      const b1 = (await inventory.itemBatches(ctx, syrup.id, {})).data.find((b) => b.number === 'B1');
      expect(b1?.quantity).toBe(3);

      const soon = await nearExpiry(ctx, {});
      expect(soon.data.map((r) => r.batch)).toEqual(['OLD', 'B1']);
    });
  });

  it('writes off expired stock and counts batch by batch', async () => {
    await rolledBack(async () => {
      const { ctx, syrup, main } = await setup();
      await inventory.postEntry(ctx, { kind: 'opening', locationId: main.id, date: today, lines: [{ itemId: syrup.id, quantity: 5, ratePaise: 5_000, batchNo: 'OLD', expiryDate: day(-1) }, { itemId: syrup.id, quantity: 5, ratePaise: 5_000, batchNo: 'NEW', expiryDate: day(90) }] });
      await inventory.postEntry(ctx, { kind: 'adjustment', direction: 'out', reason: 'expired', locationId: main.id, date: today, lines: [{ itemId: syrup.id, quantity: 5 }] });
      expect(await row(ctx, syrup.id)).toMatchObject({ quantity: 5, expired: 0 });
      const fresh = await db().stockBatch.findFirstOrThrow({ where: { itemId: syrup.id, number: 'NEW' } });
      const count = await inventory.postCount(ctx, { locationId: main.id, lines: [{ itemId: syrup.id, batchId: fresh.id, counted: 4 }] });
      expect(count.lines).toEqual([expect.objectContaining({ batch: 'NEW', system: 5, counted: 4, difference: -1 })]);
    });
  });
});

describe('serial numbers', () => {
  it('needs the numbers to sell, refuses duplicates, and frees them on cancel and return', async () => {
    await rolledBack(async () => {
      const { ctx, contact, phone, main } = await setup();
      await inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: today, lines: [{ itemId: phone.id, quantity: 3, ratePaise: 1_000_000, serials: ['IMEI1', 'IMEI2', 'IMEI3'] }] });
      await expect(inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: today, lines: [{ itemId: phone.id, quantity: 1, ratePaise: 1_000_000, serials: ['IMEI1'] }] })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: today, lines: [{ itemId: phone.id, quantity: 2, ratePaise: 1_000_000, serials: ['IMEI9'] }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      const noNumbers = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line(phone.id, 1)] });
      await expect(issued(ctx, noNumbers.id)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      const inv = await issued(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line(phone.id, 2, { serials: ['IMEI1', 'IMEI2'] })] })).id);
      expect((await inventory.itemSerials(ctx, phone.id, {})).data).toEqual(['IMEI3']);
      await createCreditNote(ctx, inv.id, { type: 'return', lines: [{ sourceLineId: inv.lines[0].id, quantity: 1, serials: ['IMEI2'] }] });
      expect((await inventory.itemSerials(ctx, phone.id, {})).data).toEqual(['IMEI2', 'IMEI3']);
      await billing.cancelInvoice(ctx, inv.id, 'Wrong bill').catch(() => undefined);
      const found = await inventory.findSerial(ctx, 'IMEI1');
      expect(found.data[0]).toMatchObject({ item: 'Phone', status: expect.any(String) });
    });
  });
});

describe('units, cost and reports', () => {
  it('buys in boxes and sells in pieces', async () => {
    await rolledBack(async () => {
      const { ctx, contact, soap, main } = await setup();
      await inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: today, lines: [{ itemId: soap.id, quantity: 2, unit: 'alt', ratePaise: 120_000 }] });
      expect(await row(ctx, soap.id)).toMatchObject({ quantity: 24, averagePaise: 10_000n });
      await issued(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line(soap.id, 1, { unit: 'box' }), line(soap.id, 3)] })).id);
      expect((await row(ctx, soap.id)).quantity).toBe(9);
    });
  });

  it('costs an issue by FIFO when chosen, and fixes the method once stock has moved', async () => {
    await rolledBack(async () => {
      const { ctx, tenantId, soap, main } = await setup({ inventory: { valuation: 'fifo' } });
      await inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: today, lines: [{ itemId: soap.id, quantity: 10, ratePaise: 10_000 }] });
      await inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: today, lines: [{ itemId: soap.id, quantity: 10, ratePaise: 12_000 }] });
      const out = await inventory.postEntry(ctx, { kind: 'adjustment', direction: 'out', reason: 'sample', locationId: main.id, date: today, lines: [{ itemId: soap.id, quantity: 15 }] });
      expect(out.valuePaise).toBe(160_000n);
      expect(await row(ctx, soap.id)).toMatchObject({ quantity: 5, valuePaise: 60_000n });
      await expect(updatePreferences(tenantId, 'inventory', { valuation: 'average' })).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('keeps a transfer in transit until it is received', async () => {
    await rolledBack(async () => {
      const { ctx, soap, main } = await setup();
      const shop = await inventory.createLocation(ctx, { name: 'Shop' });
      await inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: today, lines: [{ itemId: soap.id, quantity: 10, ratePaise: 10_000 }] });
      const t = await inventory.postEntry(ctx, { kind: 'transfer', receiveNow: false, locationId: main.id, toLocationId: shop.id, date: today, lines: [{ itemId: soap.id, quantity: 4 }] });
      expect(t.status).toBe('in_transit');
      expect(await row(ctx, soap.id)).toMatchObject({ quantity: 6, inTransit: 4 });
      expect((await row(ctx, soap.id, { locationId: shop.id })).quantity).toBe(0);
      await inventory.receiveTransfer(ctx, t.id);
      expect(await row(ctx, soap.id)).toMatchObject({ quantity: 10, inTransit: 0 });
      await expect(inventory.receiveTransfer(ctx, t.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('holds stock for open orders until it is sent', async () => {
    await rolledBack(async () => {
      const { ctx, contact, soap, main } = await setup();
      await inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: today, lines: [{ itemId: soap.id, quantity: 10, ratePaise: 10_000 }] });
      const order = await billing.createDocument(ctx, 'sales_order', { contactId: contact.id, lines: [line(soap.id, 5)] });
      expect(await row(ctx, soap.id)).toMatchObject({ quantity: 10, reserved: 5, available: 5 });
      const { invoiceFromOrder } = await import('../modules/billing/orders');
      await invoiceFromOrder(ctx, order.id, { lines: [{ sourceLineId: order.lines[0].id, quantity: 2 }] }, 'delivery_challan');
      expect(await row(ctx, soap.id)).toMatchObject({ quantity: 8, reserved: 3, available: 5 });
    });
  });

  it('shows stock as it stood on a past day, ages it, and matches import rows to items', async () => {
    await rolledBack(async () => {
      const { ctx, contact, soap, syrup, main } = await setup();
      await inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: day(-3), lines: [{ itemId: soap.id, quantity: 10, ratePaise: 10_000 }] });
      await inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: today, lines: [{ itemId: soap.id, quantity: 5, ratePaise: 10_000 }] });
      expect((await row(ctx, soap.id, { date: day(-5) })).quantity).toBe(0);
      expect(await row(ctx, soap.id, { date: day(-1) })).toMatchObject({ quantity: 10, valuePaise: 100_000n });
      await issued(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line(soap.id, 12)] })).id);
      const ageing = await stockAgeing(ctx);
      expect(ageing.data[0]).toMatchObject({ name: 'Soap', quantity: 3, status: 'moving' });
      const matched = await inventory.resolveItems(ctx, { refs: ['SYR-1', '8901234567890', 'soap', 'Nothing'] });
      expect(matched.data).toMatchObject({ 'SYR-1': { id: syrup.id }, '8901234567890': { id: syrup.id }, soap: { id: soap.id }, Nothing: null });
    });
  });
});
