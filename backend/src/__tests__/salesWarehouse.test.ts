import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import * as billing from '../modules/billing/service';
import { createCreditNote } from '../modules/billing/creditNotes';
import * as inventory from '../modules/inventory/service';
import { postDocumentStock } from '../modules/inventory/engine';

// Sales revamp: a bill names the warehouse its goods leave from, a return comes back there,
// the due date follows the customer's payment terms, and a ship-to address must be complete.

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
const roleId = async (key: string) => (await prisma.role.findFirstOrThrow({ where: { key, tenantId: null }, select: { id: true } })).id;

async function setup() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Sales Tester', email: `sales-wh-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Sales WH ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09', gstin: '09AAACS1234F1Z5' } });
  const contact = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Sharma Traders', stateCode: '09', paymentDays: 15 } });
  const fan = await db().item.create({ data: { tenantId: tenant.id, name: 'Ceiling fan', unit: 'pcs', pricePaise: 150_000n, gstRateBp: 1800 } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId: await roleId('warehouse_manager'), sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const main = (await inventory.listLocations(ctx)).data[0];
  const shop = await inventory.createLocation(ctx, { name: 'Shop 2' } as Parameters<typeof inventory.createLocation>[1]);
  await inventory.postEntry(ctx, { kind: 'opening', locationId: shop.id, date: today, lines: [{ itemId: fan.id, quantity: 10, ratePaise: 100_000 }] });
  return { ctx, contact, fan, main, shop };
}
const line = (itemId: string, quantity: number) => ({ itemId, description: 'Ceiling fan', unit: 'pcs', quantity, unitPricePaise: 150_000, discountPaise: 0, gstRateBp: 1800 });
const inPlace = async (itemId: string, locationId: string) => Number((await db().stockBalance.findFirst({ where: { itemId, locationId } }))?.quantity ?? 0);

describe('sales and warehouses', () => {
  it('takes stock out of the warehouse on the invoice, and a return brings it back there', async () => {
    await rolledBack(async () => {
      const { ctx, contact, fan, main, shop } = await setup();
      const draft = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, issueDate: today, locationId: shop.id, lines: [line(fan.id, 3)] });
      expect(draft.locationId).toBe(shop.id);
      // Posting reads the plan outside this test's transaction, so post the way the stock tests do
      await db().salesDocument.update({ where: { id: draft.id }, data: { status: 'issued', number: `INV-${randomUUID().slice(0, 6)}` } });
      await postDocumentStock(ctx, draft.id);
      const invoice = await billing.getDocument(ctx, draft.id, 'invoice');
      expect(await inPlace(fan.id, shop.id)).toBe(7);
      expect(await inPlace(fan.id, main.id)).toBe(0);

      await createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: invoice.lines[0].id, quantity: 1 }] });
      expect(await inPlace(fan.id, shop.id)).toBe(8);
    });
  });

  it('uses the default warehouse when none is named, and refuses a closed one', async () => {
    await rolledBack(async () => {
      const { ctx, contact, fan, main, shop } = await setup();
      const draft = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, issueDate: today, lines: [line(fan.id, 1)] });
      expect(draft.locationId).toBe(main.id);
      await db().stockLocation.update({ where: { id: shop.id }, data: { isActive: false } });
      await expect(billing.createDocument(ctx, 'invoice', { contactId: contact.id, issueDate: today, locationId: shop.id, lines: [line(fan.id, 1)] })).rejects.toThrow('active warehouse');
    });
  });

  it("sets the due date from the customer's payment days, and keeps one typed by hand", async () => {
    await rolledBack(async () => {
      const { ctx, contact, fan } = await setup();
      const auto = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, issueDate: '2026-11-01', lines: [line(fan.id, 1)] });
      expect(auto.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-16');
      const typed = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, issueDate: '2026-11-01', dueDate: '2026-11-05', lines: [line(fan.id, 1)] });
      expect(typed.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-05');
      await expect(billing.createDocument(ctx, 'invoice', { contactId: contact.id, issueDate: '2026-11-10', dueDate: '2026-11-05', lines: [line(fan.id, 1)] })).rejects.toThrow('before the bill date');
    });
  });
});

describe('sales return reason', () => {
  it('keeps the reason, wants a note for "other", and refuses a wrong reason or a future date', async () => {
    await rolledBack(async () => {
      const { ctx, contact, fan, shop } = await setup();
      const draft = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, issueDate: today, locationId: shop.id, lines: [line(fan.id, 3)] });
      await db().salesDocument.update({ where: { id: draft.id }, data: { status: 'issued', number: `INV-${randomUUID().slice(0, 6)}` } });
      await postDocumentStock(ctx, draft.id);
      const invoice = await billing.getDocument(ctx, draft.id, 'invoice');
      const one = [{ sourceLineId: invoice.lines[0].id, quantity: 1 }];
      await expect(createCreditNote(ctx, invoice.id, { type: 'return', reason: 'other', lines: one })).rejects.toThrow('Write what happened');
      await expect(createCreditNote(ctx, invoice.id, { type: 'return', reason: 'discount', lines: one })).rejects.toThrow('does not fit');
      const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      await expect(createCreditNote(ctx, invoice.id, { type: 'return', reason: 'damaged', issueDate: tomorrow, lines: one })).rejects.toThrow('future');
      const note = await createCreditNote(ctx, invoice.id, { type: 'return', reason: 'damaged', lines: one });
      expect(note.noteReason).toBe('damaged');
      expect(note.locationId).toBe(shop.id);
    });
  });
});

describe('ship-to address', () => {
  it('must be complete when given', () => {
    const base = { contactId: randomUUID(), lines: [line(randomUUID(), 1)] };
    expect(billing.DocInput.safeParse({ ...base, shipTo: { line1: 'Plot 7', city: 'Pune', pincode: '411026', stateCode: '27' } }).success).toBe(true);
    const missing = billing.DocInput.safeParse({ ...base, shipTo: { line1: 'Plot 7', pincode: '411026', stateCode: '27' } });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues.map((i) => i.path.join('.'))).toContain('shipTo.city');
    expect(billing.DocInput.safeParse({ ...base, shipTo: null }).success).toBe(true);
  });
});
