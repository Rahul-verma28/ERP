import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import * as billing from '../modules/billing/service';
import { cancelCreditNote, createCreditNote } from '../modules/billing/creditNotes';
import { cancelChallan, invoiceFromChallan } from '../modules/billing/orders';
import { postDocumentStock } from '../modules/inventory/engine';
import * as inventory from '../modules/inventory/service';

// Inventory batch 1: godowns, the stock ledger with moving average cost, entries by hand,
// and stock moved by invoices, challans, returns and cancellations.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

afterAll(() => prisma.$disconnect());

const today = todayIST();
// Permissions are read outside the test transaction, so these use the seeded roles
const roleId = async (key: string) => (await prisma.role.findFirstOrThrow({ where: { key, tenantId: null }, select: { id: true } })).id;

async function setup(preferences: Record<string, unknown> = {}, role = 'warehouse_manager') {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Stock Tester', email: `stock-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Stock Test ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09', gstin: '09AAACS1234F1Z5', preferences } });
  const contact = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Sharma Traders', stateCode: '09' } });
  const fan = await db().item.create({ data: { tenantId: tenant.id, name: 'Ceiling fan', unit: 'pcs', pricePaise: 150_000n, gstRateBp: 1800, reorderLevel: 5 } });
  const bulb = await db().item.create({ data: { tenantId: tenant.id, name: 'LED bulb', unit: 'pcs', pricePaise: 10_000n, gstRateBp: 1800 } });
  const fitting = await db().item.create({ data: { tenantId: tenant.id, type: 'service', name: 'Fitting', unit: 'nos', pricePaise: 20_000n, gstRateBp: 1800 } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId: await roleId(role), sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const main = (await inventory.listLocations(ctx)).data[0];
  return { ctx, contact, fan, bulb, fitting, main };
}
const qtyOf = async (ctx: TenantCtx, itemId: string) => (await inventory.stockSummary(ctx, {})).data.find((r) => r.id === itemId)?.quantity;
const issued = async (ctx: TenantCtx, id: string) => {
  await db().salesDocument.update({ where: { id }, data: { status: 'issued', number: `INV-${randomUUID().slice(0, 6)}` } });
  await postDocumentStock(ctx, id);
  return billing.getDocument(ctx, id, 'invoice');
};
const line = (itemId: string, quantity: number, over: Record<string, unknown> = {}) => ({ itemId, description: 'x', unit: 'pcs', quantity, unitPricePaise: 150_000, discountPaise: 0, gstRateBp: 1800, ...over });

describe('stock entries and cost', () => {
  it('starts from opening stock, averages the cost on stock in, and flags low stock', async () => {
    await rolledBack(async () => {
      const { ctx, fan, main } = await setup();
      expect(main).toMatchObject({ name: 'Main godown', isDefault: true });
      await inventory.postEntry(ctx, { kind: 'opening', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 10, ratePaise: 100_000 }] });
      await inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: today, party: 'Havells dealer', lines: [{ itemId: fan.id, quantity: 10, ratePaise: 120_000 }] });
      let row = (await inventory.stockSummary(ctx, {})).data[0];
      expect(row).toMatchObject({ quantity: 20, valuePaise: 2_200_000n, averagePaise: 110_000n, low: false });
      await inventory.postEntry(ctx, { kind: 'adjustment', direction: 'out', reason: 'damage', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 15 }] });
      row = (await inventory.stockSummary(ctx, {})).data[0];
      // 15 out at the 1,100 average leaves 5 worth 5,500
      expect(row).toMatchObject({ quantity: 5, valuePaise: 550_000n, low: true });
      expect((await inventory.stockSummary(ctx, { low: 'true' })).data).toHaveLength(1);
      const ledger = await inventory.itemLedger(ctx, fan.id, {});
      expect(ledger.rows.map((r) => [r.kind, r.quantity, r.balance])).toEqual([['opening', 10, 10], ['stock_in', 10, 20], ['adjustment', -15, 5]]);
    });
  });

  it('refuses a second opening, future or old dates, and untracked items on adjustments', async () => {
    await rolledBack(async () => {
      const { ctx, fan, bulb, fitting, main } = await setup();
      await inventory.postEntry(ctx, { kind: 'opening', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 1, ratePaise: 100 }] });
      await expect(inventory.postEntry(ctx, { kind: 'opening', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 1, ratePaise: 100 }] })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: '2026-01-01', lines: [{ itemId: fan.id, quantity: 1, ratePaise: 100 }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(inventory.postEntry(ctx, { kind: 'adjustment', direction: 'out', reason: 'loss', locationId: main.id, date: today, lines: [{ itemId: bulb.id, quantity: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: today, lines: [{ itemId: fitting.id, quantity: 1, ratePaise: 100 }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  it('moves stock between godowns at cost, and counts post the difference', async () => {
    await rolledBack(async () => {
      const { ctx, fan, main } = await setup();
      const shop = await inventory.createLocation(ctx, { name: 'Shop counter' });
      await inventory.postEntry(ctx, { kind: 'opening', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 10, ratePaise: 100_000 }] });
      await inventory.postEntry(ctx, { kind: 'transfer', locationId: main.id, toLocationId: shop.id, date: today, lines: [{ itemId: fan.id, quantity: 4 }] });
      expect((await inventory.stockSummary(ctx, { locationId: shop.id })).data[0]).toMatchObject({ quantity: 4, valuePaise: 400_000n });
      expect((await inventory.stockSummary(ctx, { locationId: main.id })).data[0]).toMatchObject({ quantity: 6 });
      const count = await inventory.postCount(ctx, { locationId: shop.id, lines: [{ itemId: fan.id, counted: 3 }] });
      expect(count.lines).toEqual([expect.objectContaining({ system: 4, counted: 3, difference: -1 })]);
      expect(await qtyOf(ctx, fan.id)).toBe(9);
      await expect(inventory.updateLocation(ctx, shop.id, { isActive: false })).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('needs approval for a large adjustment', async () => {
    await rolledBack(async () => {
      const { ctx, fan, main } = await setup({ inventory: { adjustmentApprovalPaise: 100_000 } }, 'warehouse_staff');
      await inventory.postEntry(ctx, { kind: 'opening', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 10, ratePaise: 100_000 }] });
      await expect(inventory.postEntry(ctx, { kind: 'adjustment', direction: 'out', reason: 'loss', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 2 }] })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });
});

describe('stock moved by sales', () => {
  it('takes stock out on an invoice, free quantity too, and puts it back on cancel', async () => {
    await rolledBack(async () => {
      const { ctx, contact, fan, bulb, fitting, main } = await setup();
      await inventory.postEntry(ctx, { kind: 'opening', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 10, ratePaise: 100_000 }] });
      const draft = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line(fan.id, 3, { freeQuantity: 1 }), line(bulb.id, 5), line(fitting.id, 1)] });
      expect(await qtyOf(ctx, fan.id)).toBe(10);
      const inv = await issued(ctx, draft.id);
      await postDocumentStock(ctx, inv.id); // twice is harmless
      expect(await qtyOf(ctx, fan.id)).toBe(6);
      // The bulb is not tracked and the fitting is a service: neither has moves
      expect(await db().stockMove.count({ where: { sourceId: inv.id } })).toBe(1);
      await billing.cancelInvoice(ctx, inv.id, 'Wrong customer');
      expect(await qtyOf(ctx, fan.id)).toBe(10);
      expect((await inventory.itemLedger(ctx, fan.id, {})).rows.at(-1)).toMatchObject({ label: 'Sale undone', quantity: 4 });
    });
  });

  it('takes stock out on a challan only, and returns it when the challan is cancelled', async () => {
    await rolledBack(async () => {
      const { ctx, contact, fan, main } = await setup();
      await inventory.postEntry(ctx, { kind: 'opening', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 10, ratePaise: 100_000 }] });
      const challan = await billing.createDocument(ctx, 'delivery_challan', { contactId: contact.id, lines: [line(fan.id, 4)] });
      expect(await qtyOf(ctx, fan.id)).toBe(6);
      await billing.updateDocument(ctx, challan.id, 'delivery_challan', { contactId: contact.id, lines: [line(fan.id, 2)] }, challan.version);
      expect(await qtyOf(ctx, fan.id)).toBe(8);
      const inv = await invoiceFromChallan(ctx, challan.id);
      await issued(ctx, inv.id);
      expect(await qtyOf(ctx, fan.id)).toBe(8);
      const other = await billing.createDocument(ctx, 'delivery_challan', { contactId: contact.id, lines: [line(fan.id, 3)] });
      await cancelChallan(ctx, other.id, 'Not sent');
      expect(await qtyOf(ctx, fan.id)).toBe(8);
    });
  });

  it('brings returned goods back at the cost they went out at', async () => {
    await rolledBack(async () => {
      const { ctx, contact, fan, main } = await setup();
      await inventory.postEntry(ctx, { kind: 'opening', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 10, ratePaise: 100_000 }] });
      const inv = await issued(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line(fan.id, 4)] })).id);
      await inventory.postEntry(ctx, { kind: 'stock_in', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 6, ratePaise: 200_000 }] });
      const note = await createCreditNote(ctx, inv.id, { type: 'return', lines: [{ sourceLineId: inv.lines[0].id, quantity: 2 }] });
      const back = (await inventory.itemLedger(ctx, fan.id, {})).rows.at(-1)!;
      expect(back).toMatchObject({ kind: 'sale_return', quantity: 2, ratePaise: 100_000n });
      expect(await qtyOf(ctx, fan.id)).toBe(14);
      await cancelCreditNote(ctx, note.id, 'Entered by mistake');
      expect(await qtyOf(ctx, fan.id)).toBe(12);
      const amount = await createCreditNote(ctx, inv.id, { type: 'amount', lines: [{ sourceLineId: inv.lines[0].id, taxablePaise: 1_000 }] });
      expect(await db().stockMove.count({ where: { sourceId: amount.id } })).toBe(0);
    });
  });

  it('lets stock go below zero unless the owner blocks it', async () => {
    await rolledBack(async () => {
      const { ctx, contact, fan, main } = await setup();
      await inventory.postEntry(ctx, { kind: 'opening', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 1, ratePaise: 100_000 }] });
      await issued(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line(fan.id, 3)] })).id);
      expect(await qtyOf(ctx, fan.id)).toBe(-2);

      const blocked = await setup({ inventory: { blockNegative: true } });
      await inventory.postEntry(blocked.ctx, { kind: 'opening', locationId: blocked.main.id, date: today, lines: [{ itemId: blocked.fan.id, quantity: 1, ratePaise: 100_000 }] });
      await expect(billing.createDocument(blocked.ctx, 'delivery_challan', { contactId: blocked.contact.id, lines: [line(blocked.fan.id, 3)] })).rejects.toMatchObject({ code: 'CONFLICT', details: { stock: true } });
    });
  });
});
