import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import * as billing from '../modules/billing/service';
import { createCreditNote } from '../modules/billing/creditNotes';
import { cancelOrder, invoiceFromOrder, orderLines } from '../modules/billing/orders';
import { collectionReport, gstReport, gstWorkbook, itemReport, salesReport } from '../modules/reports/sales';

// Sales & Billing steps 4 to 7: cash bill, sales orders, reports and the GST sheet.
// Database tests run in a rolled-back transaction.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

afterAll(() => prisma.$disconnect());

async function setup() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Sales Tester', email: `sales-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Sales Test ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09' } });
  const contact = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Sharma Traders', gstin: '09AAACS1234F1Z5', stateCode: '09' } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId: randomUUID(), sessionId: randomUUID(), branchIds: [], scope: 'all' };
  return { ctx, contact };
}
const line = (over: Record<string, unknown> = {}) => ({ description: 'Ceiling fan', unit: 'pcs', quantity: 1, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800, ...over });
const walkIn = { buyer: { name: 'Walk-in customer' } };
const today = todayIST();
const period = { from: today, to: today };

describe('quick cash bill', () => {
  it('takes GST out of an inclusive rate', async () => {
    await rolledBack(async () => {
      const { ctx } = await setup();
      const doc = await billing.createDocument(ctx, 'quotation', { ...walkIn, pricesIncludeGst: true, lines: [line({ unitPricePaise: 11_800 })] });
      expect(doc).toMatchObject({ taxablePaise: 10_000n, cgstPaise: 900n, sgstPaise: 900n, totalPaise: 11_800n, roundOffPaise: 0n });
    });
  });

  it('rounds to the whole rupee either way, and keeps the tax as it is', async () => {
    await rolledBack(async () => {
      const { ctx } = await setup();
      const up = await billing.createDocument(ctx, 'quotation', { ...walkIn, roundOff: true, lines: [line({ unitPricePaise: 9_966 })] }); // 117.60
      expect(up).toMatchObject({ taxablePaise: 9_966n, roundOffPaise: 40n, totalPaise: 11_800n });
      const down = await billing.createDocument(ctx, 'quotation', { ...walkIn, roundOff: true, lines: [line({ unitPricePaise: 10_000, quantity: 1, discountPaise: 170 })] }); // 115.99
      expect(down.totalPaise % 100n).toBe(0n);
      expect(down.roundOffPaise).toBe(down.totalPaise - (down.taxablePaise + down.cgstPaise + down.sgstPaise));
    });
  });

  it('a full return takes the round-off back, so nothing stays owed', async () => {
    await rolledBack(async () => {
      const { ctx } = await setup();
      const inv = await db().salesDocument.create({ data: { tenantId: ctx.tenantId, kind: 'invoice', status: 'issued', number: `INV-${randomUUID().slice(0, 6)}`, buyer: walkIn.buyer, issueDate: new Date(today), taxablePaise: 9_966n, cgstPaise: 897n, sgstPaise: 897n, roundOffPaise: 40n, totalPaise: 11_800n, lines: { create: [{ tenantId: ctx.tenantId, description: 'Fan', quantity: '2.000', unitPricePaise: 4_983n, taxablePaise: 9_966n, gstRateBp: 1800, cgstPaise: 897n, sgstPaise: 897n, totalPaise: 11_760n }] } }, include: { lines: true } });
      const first = await createCreditNote(ctx, inv.id, { type: 'return', lines: [{ sourceLineId: inv.lines[0].id, quantity: 1 }] });
      expect(first.roundOffPaise).toBe(0n);
      const last = await createCreditNote(ctx, inv.id, { type: 'return', lines: [{ sourceLineId: inv.lines[0].id, quantity: 1 }] });
      expect(last.roundOffPaise).toBe(40n);
      expect(await billing.getDocument(ctx, inv.id, 'invoice')).toMatchObject({ status: 'paid', paidPaise: 11_800n });
    });
  });
});

describe('sales order', () => {
  it('is numbered, invoiced in parts, and completes when all is invoiced', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const order = await billing.createDocument(ctx, 'sales_order', { contactId: contact.id, lines: [line({ quantity: 10, discountPaise: 1_000 })] });
      expect(order).toMatchObject({ kind: 'sales_order', status: 'open' });
      expect(order.number).toMatch(/^SO\//);
      const id = order.lines[0].id;

      await expect(invoiceFromOrder(ctx, order.id, { lines: [{ sourceLineId: id, quantity: 11 }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const part = await invoiceFromOrder(ctx, order.id, { lines: [{ sourceLineId: id, quantity: 4 }] });
      expect(part).toMatchObject({ status: 'draft', sourceType: 'sales_order', sourceId: order.id });
      expect(part.lines[0]).toMatchObject({ sourceLineId: id, discountPaise: 400n });
      expect((await billing.getDocument(ctx, order.id, 'sales_order')).status).toBe('part_invoiced');
      expect((await orderLines(ctx, order.id))[0]).toMatchObject({ quantityInvoiced: 4, quantityLeft: 6 });

      await expect(billing.updateDocument(ctx, order.id, 'sales_order', { contactId: contact.id, lines: [line()] }, 99)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(cancelOrder(ctx, order.id, 'mistake')).rejects.toMatchObject({ code: 'CONFLICT' });

      const rest = await invoiceFromOrder(ctx, order.id, { lines: [{ sourceLineId: id, quantity: 6 }] });
      expect((await billing.getDocument(ctx, order.id, 'sales_order')).status).toBe('completed');
      await expect(invoiceFromOrder(ctx, order.id, { lines: [{ sourceLineId: id, quantity: 1 }] })).rejects.toMatchObject({ code: 'CONFLICT' });

      // Cancelling an invoice opens that part again
      await db().salesDocument.update({ where: { id: rest.id }, data: { status: 'issued', number: 'INV-X' } });
      await billing.cancelInvoice(ctx, rest.id, 'wrong qty');
      expect((await billing.getDocument(ctx, order.id, 'sales_order')).status).toBe('part_invoiced');
      expect((await orderLines(ctx, order.id))[0].quantityLeft).toBe(6);
    });
  });

  it('comes from a quotation, and can be edited or cancelled until invoiced', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const q = await billing.createDocument(ctx, 'quotation', { contactId: contact.id, lines: [line()] });
      const order = await billing.convertQuotation(ctx, q.id, 'sales_order');
      expect(order).toMatchObject({ kind: 'sales_order', sourceType: 'quotation', sourceId: q.id });
      expect((await billing.getDocument(ctx, q.id, 'quotation')).status).toBe('converted');

      const edited = await billing.updateDocument(ctx, order.id, 'sales_order', { contactId: contact.id, lines: [line({ quantity: 3 })] }, order.version);
      expect(edited.taxablePaise).toBe(30_000n);
      expect(await cancelOrder(ctx, order.id, 'customer changed mind')).toMatchObject({ status: 'cancelled' });
      await expect(invoiceFromOrder(ctx, order.id, { lines: [{ sourceLineId: edited.lines[0].id, quantity: 1 }] })).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('never counts as a sale', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      await billing.createDocument(ctx, 'sales_order', { contactId: contact.id, lines: [line()] });
      expect((await salesReport(ctx, 'day', period)).rows).toEqual([]);
      expect((await gstReport(ctx, period)).totals.invoices).toBe(0);
    });
  });
});

describe('sales reports', () => {
  it('net off credit notes by day, customer and item, and read collection by method', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const inv = await db().salesDocument.create({ data: { tenantId: ctx.tenantId, kind: 'invoice', status: 'issued', number: 'INV-1', contactId: contact.id, buyer: { name: 'Sharma Traders', gstin: contact.gstin }, placeOfSupply: '09', issueDate: new Date(today), taxablePaise: 100_000n, cgstPaise: 9_000n, sgstPaise: 9_000n, totalPaise: 118_000n, lines: { create: [{ tenantId: ctx.tenantId, description: 'Fan', hsnSac: '8414', unit: 'pcs', quantity: '10.000', unitPricePaise: 10_000n, taxablePaise: 100_000n, gstRateBp: 1800, cgstPaise: 9_000n, sgstPaise: 9_000n, totalPaise: 118_000n }] } }, include: { lines: true } });
      await db().salesDocument.create({ data: { tenantId: ctx.tenantId, kind: 'invoice', status: 'draft', buyer: { name: 'Draft' }, issueDate: new Date(today), totalPaise: 5_000n } });
      await createCreditNote(ctx, inv.id, { type: 'return', lines: [{ sourceLineId: inv.lines[0].id, quantity: 2 }] });
      await billing.recordPayment(ctx, inv.id, { amountPaise: 50_000, method: 'upi' });
      await billing.recordPayment(ctx, inv.id, { amountPaise: 10_000, method: 'cash' });

      const byDay = await salesReport(ctx, 'day', period);
      expect(byDay.rows).toHaveLength(1);
      expect(byDay.rows[0]).toMatchObject({ key: today, invoices: 1, creditNotes: 1, taxablePaise: 80_000n, totalPaise: 94_400n });
      expect((await salesReport(ctx, 'month', period)).rows[0].key).toBe(today.slice(0, 7));
      expect((await salesReport(ctx, 'customer', period)).rows[0]).toMatchObject({ label: 'Sharma Traders', totalPaise: 94_400n });
      expect((await itemReport(ctx, period)).rows[0]).toMatchObject({ label: 'Fan', unit: 'pcs', quantity: 8, totalPaise: 94_400n });
      expect((await collectionReport(ctx, period)).rows[0]).toMatchObject({ date: today, upi: 50_000n, cash: 10_000n, totalPaise: 60_000n });
    });
  });
});

describe('GST sheet', () => {
  it('splits B2B, B2C, credit notes and HSN, and its totals match the documents', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const inv = await db().salesDocument.create({ data: { tenantId: ctx.tenantId, kind: 'invoice', status: 'issued', number: 'INV-1', contactId: contact.id, buyer: { name: 'Sharma Traders', gstin: contact.gstin }, placeOfSupply: '09', issueDate: new Date(today), taxablePaise: 150_000n, cgstPaise: 11_000n, sgstPaise: 11_000n, totalPaise: 172_000n, lines: { create: [
        { tenantId: ctx.tenantId, description: 'Fan', hsnSac: '8414', unit: 'pcs', quantity: '10.000', unitPricePaise: 10_000n, taxablePaise: 100_000n, gstRateBp: 1800, cgstPaise: 9_000n, sgstPaise: 9_000n, totalPaise: 118_000n },
        { tenantId: ctx.tenantId, description: 'Wire', hsnSac: '8544', unit: 'm', quantity: '10.000', unitPricePaise: 5_000n, taxablePaise: 50_000n, gstRateBp: 800, cgstPaise: 2_000n, sgstPaise: 2_000n, totalPaise: 54_000n },
      ] } }, include: { lines: true } });
      await db().salesDocument.create({ data: { tenantId: ctx.tenantId, kind: 'invoice', status: 'paid', number: 'INV-2', buyer: { name: 'Walk-in customer' }, placeOfSupply: '09', issueDate: new Date(today), taxablePaise: 10_000n, cgstPaise: 900n, sgstPaise: 900n, roundOffPaise: 0n, totalPaise: 11_800n, lines: { create: [{ tenantId: ctx.tenantId, description: 'Fan', hsnSac: '8414', unit: 'pcs', quantity: '1.000', unitPricePaise: 10_000n, taxablePaise: 10_000n, gstRateBp: 1800, cgstPaise: 900n, sgstPaise: 900n, totalPaise: 11_800n }] } } });
      await db().salesDocument.create({ data: { tenantId: ctx.tenantId, kind: 'invoice', status: 'cancelled', number: 'INV-3', buyer: { name: 'Gone' }, issueDate: new Date(today), taxablePaise: 999n, totalPaise: 999n } });
      await createCreditNote(ctx, inv.id, { type: 'return', lines: [{ sourceLineId: inv.lines[0].id, quantity: 1 }] });

      const r = await gstReport(ctx, period);
      expect(r.b2b.map((x) => x.gstRateBp).sort()).toEqual([1800, 800].sort());
      expect(r.b2b.every((x) => x.gstin === contact.gstin)).toBe(true);
      expect(r.b2c).toEqual([expect.objectContaining({ placeOfSupply: '09', gstRateBp: 1800, taxablePaise: 10_000n })]);
      expect(r.creditNotes).toEqual([expect.objectContaining({ invoiceNumber: 'INV-1', noteType: 'return', taxablePaise: 10_000n, cgstPaise: 900n })]);
      const fan = r.hsn.find((x) => x.hsnSac === '8414')!;
      expect(fan).toMatchObject({ quantity: 10, taxablePaise: 100_000n, cgstPaise: 9_000n });
      expect(r.totals).toMatchObject({ invoices: 2, creditNotes: 1, taxablePaise: 150_000n, cgstPaise: 11_000n, sgstPaise: 11_000n, igstPaise: 0n, totalPaise: 172_000n });
      // HSN adds back up to the same totals
      expect(r.hsn.reduce((s, x) => s + x.taxablePaise, 0n)).toBe(r.totals.taxablePaise);

      const file = await gstWorkbook(ctx, period);
      expect(file.filename).toContain(today);
      expect(file.body.length).toBeGreaterThan(100);
    });
  });
});
