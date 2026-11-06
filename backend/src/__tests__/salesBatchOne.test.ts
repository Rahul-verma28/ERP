import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import * as billing from '../modules/billing/service';
import { cancelDebitNote, createCreditNote, createDebitNote } from '../modules/billing/creditNotes';
import { cancelChallan, invoiceFromChallan, invoiceFromOrder, orderLines } from '../modules/billing/orders';
import { customerLedger } from '../modules/billing/ledger';
import { gstReport, itemReport, pendingOrders, salesReport } from '../modules/reports/sales';

// Sales & Billing batch 1: bill of supply, credit limit, challans, ship-to, proforma, debit notes,
// pending orders and free quantity. Database tests run in a rolled-back transaction.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

afterAll(() => prisma.$disconnect());

async function setup(tenantData: Record<string, unknown> = { gstin: '09AAACS1234F1Z5' }) {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Batch Tester', email: `batch-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Batch Test ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09', ...tenantData } });
  const contact = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Sharma Traders', stateCode: '09' } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId: randomUUID(), sessionId: randomUUID(), branchIds: [], scope: 'all' };
  return { ctx, contact };
}
const line = (over: Record<string, unknown> = {}) => ({ description: 'Fan', unit: 'pcs', quantity: 1, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800, ...over });
const today = todayIST();
const period = { from: today, to: today };

// issueInvoice counts against the plan, which needs a subscription these tenants don't have
const issued = async (ctx: TenantCtx, id: string, seller: Record<string, unknown> = { name: 'Test' }) => {
  await db().salesDocument.update({ where: { id }, data: { status: 'issued', number: `INV-${randomUUID().slice(0, 6)}`, seller: seller as object } });
  return billing.getDocument(ctx, id, 'invoice');
};

describe('bill of supply', () => {
  it('charges no GST when the business has no GSTIN', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup({ gstin: null });
      const doc = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, pricesIncludeGst: true, lines: [line({ unitPricePaise: 11_800 })] });
      expect(doc).toMatchObject({ taxablePaise: 11_800n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n, totalPaise: 11_800n });
      expect(doc.lines[0].gstRateBp).toBe(0);
    });
  });

  it('charges no GST on the composition scheme', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup({ gstin: '09AAACS1234F1Z5', preferences: { taxes: { composition: true, compositionRateBp: 100 } } });
      const doc = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line()] });
      expect(doc).toMatchObject({ cgstPaise: 0n, totalPaise: 10_000n });
    });
  });

  it('still charges GST for a registered business, and stays out of the GST sheet', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const doc = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line()] });
      expect(doc.cgstPaise).toBe(900n);
      await issued(ctx, doc.id);
      const other = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line({ gstRateBp: 0 })] });
      await issued(ctx, other.id, { name: 'Test', billOfSupply: true });
      const r = await gstReport(ctx, period);
      expect(r.totals).toMatchObject({ invoices: 1, taxablePaise: 10_000n, billOfSupplyPaise: 10_000n });
    });
  });
});

describe('credit limit', () => {
  it('stops an invoice that goes over the limit, and allows it when told to', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      await db().contact.update({ where: { id: contact.id }, data: { creditLimitPaise: 15_000n } });
      const first = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line()] });
      await issued(ctx, first.id);
      const next = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line()] });
      await expect(billing.issueInvoice(ctx, next.id)).rejects.toMatchObject({ code: 'CONFLICT', details: { creditLimit: true } });
    });
  });

  it('takes advances off what the customer owes', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      await db().contact.update({ where: { id: contact.id }, data: { creditLimitPaise: 15_000n } });
      const first = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line()] });
      await issued(ctx, first.id);
      await billing.recordAdvance(ctx, { contactId: contact.id, amountPaise: 10_000, method: 'cash', paidOn: today });
      const next = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line()] });
      await expect(billing.issueInvoice(ctx, next.id)).rejects.not.toMatchObject({ details: { creditLimit: true } });
    });
  });

  it('counts what is paid, and leaves customers without a limit alone', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const first = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line({ quantity: 10 })] });
      await issued(ctx, first.id);
      await billing.recordPayment(ctx, first.id, { amountPaise: 118_000, method: 'cash' });
      await db().contact.update({ where: { id: contact.id }, data: { creditLimitPaise: 50_000n } });
      const next = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line()] });
      // Reaches the plan check, which comes after the limit: the limit did not stop it
      await expect(billing.issueInvoice(ctx, next.id)).rejects.not.toMatchObject({ details: { creditLimit: true } });
    });
  });
});

describe('delivery challan', () => {
  it('goes out against an order, counts towards it, and bills as a draft invoice', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const order = await billing.createDocument(ctx, 'sales_order', { contactId: contact.id, lines: [line({ quantity: 10 })] });
      const id = order.lines[0].id;
      const challan = await invoiceFromOrder(ctx, order.id, { lines: [{ sourceLineId: id, quantity: 4 }] }, 'delivery_challan');
      expect(challan).toMatchObject({ kind: 'delivery_challan', status: 'issued', sourceId: order.id });
      expect(challan.number).toMatch(/^DC\//);
      expect((await billing.getDocument(ctx, order.id, 'sales_order')).status).toBe('part_invoiced');
      expect((await orderLines(ctx, order.id))[0].quantityLeft).toBe(6);

      // Never a sale until billed
      expect((await salesReport(ctx, 'day', period)).rows).toEqual([]);

      const invoice = await invoiceFromChallan(ctx, challan.id);
      expect(invoice).toMatchObject({ status: 'draft', sourceType: 'delivery_challan', sourceId: challan.id, taxablePaise: 40_000n });
      expect((await billing.getDocument(ctx, challan.id, 'delivery_challan')).status).toBe('converted');
      expect((await orderLines(ctx, order.id))[0].quantityLeft).toBe(6);
      await expect(invoiceFromChallan(ctx, challan.id)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(cancelChallan(ctx, challan.id, 'mistake')).rejects.toMatchObject({ code: 'CONFLICT' });

      // Cancelling the invoice frees the challan; cancelling the challan frees the order
      await issued(ctx, invoice.id);
      await billing.cancelInvoice(ctx, invoice.id, 'wrong');
      expect((await billing.getDocument(ctx, challan.id, 'delivery_challan')).status).toBe('issued');
      await cancelChallan(ctx, challan.id, 'not sent');
      expect((await billing.getDocument(ctx, order.id, 'sales_order')).status).toBe('open');
      expect((await orderLines(ctx, order.id))[0].quantityLeft).toBe(10);
    });
  });

  it('can be made directly', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const challan = await billing.createDocument(ctx, 'delivery_challan', { contactId: contact.id, lines: [line()] });
      expect(challan.status).toBe('issued');
      const edited = await billing.updateDocument(ctx, challan.id, 'delivery_challan', { contactId: contact.id, lines: [line({ quantity: 2 })] }, challan.version);
      expect(edited.taxablePaise).toBe(20_000n);
    });
  });
});

describe('ship-to address', () => {
  it('sets the place of supply and survives into the invoice', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const shipTo = { name: 'Pune godown', line1: 'MIDC', city: 'Pune', pincode: '411001', stateCode: '27' };
      const order = await billing.createDocument(ctx, 'sales_order', { contactId: contact.id, shipTo, lines: [line()] });
      expect(order).toMatchObject({ placeOfSupply: '27', cgstPaise: 0n, igstPaise: 1_800n, shipTo });
      const invoice = await invoiceFromOrder(ctx, order.id, { lines: [{ sourceLineId: order.lines[0].id, quantity: 1 }] });
      expect(invoice).toMatchObject({ placeOfSupply: '27', igstPaise: 1_800n, shipTo });
    });
  });

  it('stays with the billing state when it is not given', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const doc = await billing.createDocument(ctx, 'quotation', { contactId: contact.id, lines: [line()] });
      expect(doc).toMatchObject({ placeOfSupply: '09', cgstPaise: 900n, shipTo: null });
    });
  });
});

describe('proforma invoice', () => {
  it('is a quotation marked proforma, and converts to an invoice', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const p = await billing.createDocument(ctx, 'quotation', { contactId: contact.id, proforma: true, lines: [line()] });
      expect(p.noteType).toBe('proforma');
      const kept = await billing.updateDocument(ctx, p.id, 'quotation', { contactId: contact.id, lines: [line({ quantity: 2 })] }, p.version);
      expect(kept.noteType).toBe('proforma');
      const invoice = await billing.convertQuotation(ctx, p.id);
      expect(invoice).toMatchObject({ kind: 'invoice', noteType: null });
    });
  });
});

describe('debit note', () => {
  it('adds to what the customer owes, takes payments, and counts as a sale', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const draft = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line()] });
      const inv = await issued(ctx, draft.id);
      const note = await createDebitNote(ctx, inv.id, { lines: [{ sourceLineId: inv.lines[0].id, taxablePaise: 5_000 }] });
      expect(note).toMatchObject({ kind: 'debit_note', status: 'issued', sourceNumber: inv.number, taxablePaise: 5_000n, cgstPaise: 450n, totalPaise: 5_900n });
      expect(note.number).toMatch(/^DN\//);

      const l = await customerLedger(ctx, contact.id, {});
      expect(l.balancePaise).toBe(11_800n + 5_900n);
      expect((await salesReport(ctx, 'day', period)).rows[0]).toMatchObject({ invoices: 1, totalPaise: 17_700n });
      const gst = await gstReport(ctx, period);
      expect(gst.totals).toMatchObject({ invoices: 1, debitNotes: 1, cgstPaise: 1_350n, totalPaise: 17_700n });
      expect(gst.creditNotes[0]).toMatchObject({ noteType: 'debit', invoiceNumber: inv.number });
      expect((await itemReport(ctx, period)).rows[0].quantity).toBe(1);

      const paid = await billing.recordPayment(ctx, note.id, { amountPaise: 5_900, method: 'upi' }, 'debit_note');
      expect(paid.status).toBe('paid');
      await expect(cancelDebitNote(ctx, note.id, 'mistake')).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await billing.reversePayment(ctx, paid.payments[0].id)).toMatchObject({ kind: 'debit_note', status: 'issued' });
      expect(await cancelDebitNote(ctx, note.id, 'mistake')).toMatchObject({ status: 'cancelled' });
      expect((await customerLedger(ctx, contact.id, {})).balancePaise).toBe(11_800n);
    });
  });
});

describe('pending orders', () => {
  it('lists what is left on open orders, line by line', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const order = await billing.createDocument(ctx, 'sales_order', { contactId: contact.id, lines: [line({ quantity: 10 }), line({ description: 'Wire', quantity: 2 })] });
      await invoiceFromOrder(ctx, order.id, { lines: [{ sourceLineId: order.lines[0].id, quantity: 4 }, { sourceLineId: order.lines[1].id, quantity: 2 }] });
      const { rows } = await pendingOrders(ctx);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ number: order.number, item: 'Fan', ordered: 10, billed: 4, left: 6, valuePaise: 70_800 });
    });
  });
});

describe('free quantity', () => {
  it('carries no price or tax, and counts in quantity reports and on the invoice', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const draft = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line({ quantity: 10, freeQuantity: 2 })] });
      expect(draft).toMatchObject({ taxablePaise: 100_000n });
      expect(Number(draft.lines[0].freeQuantity)).toBe(2);
      await issued(ctx, draft.id);
      expect((await itemReport(ctx, period)).rows[0]).toMatchObject({ quantity: 12, taxablePaise: 100_000n });
    });
  });

  it('is shared out when an order is billed in parts', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const order = await billing.createDocument(ctx, 'sales_order', { contactId: contact.id, lines: [line({ quantity: 10, freeQuantity: 2 })] });
      const part = await invoiceFromOrder(ctx, order.id, { lines: [{ sourceLineId: order.lines[0].id, quantity: 5 }] });
      expect(Number(part.lines[0].freeQuantity)).toBe(1);
    });
  });
});

describe('credit notes on a bill with round-off still work', () => {
  it('after this batch', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const draft = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, roundOff: true, lines: [line({ unitPricePaise: 9_966 })] });
      const inv = await issued(ctx, draft.id);
      const note = await createCreditNote(ctx, inv.id, { type: 'return', lines: [{ sourceLineId: inv.lines[0].id, quantity: 1 }] });
      expect(note.totalPaise).toBe(inv.totalPaise);
    });
  });
});
