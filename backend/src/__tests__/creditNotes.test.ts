import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import * as billing from '../modules/billing/service';
import { cancelCreditNote, createCreditNote, creditableLines, refundCreditNote } from '../modules/billing/creditNotes';

// Sales & Billing step 2: credit notes and sales returns. Database tests run in a rolled-back
// transaction. The invoice line is 20 fans at ₹100 + 18% GST = ₹2,360.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

afterAll(() => prisma.$disconnect());

async function setup(igst = false) {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Credit Tester', email: `cn-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `CN Test ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09' } });
  const contact = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Sharma Traders' } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId: randomUUID(), sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const tax = igst ? { igstPaise: 36_000n } : { cgstPaise: 18_000n, sgstPaise: 18_000n };
  const invoice = await db().salesDocument.create({
    data: {
      tenantId: tenant.id, kind: 'invoice', status: 'issued', number: `INV-${n}`, contactId: contact.id, buyer: { name: 'Sharma Traders' }, seller: { name: 'Test Co' }, placeOfSupply: igst ? '27' : '09',
      issueDate: new Date('2026-10-12'), subtotalPaise: 200_000n, taxablePaise: 200_000n, ...tax, totalPaise: 236_000n,
      lines: { create: [{ tenantId: tenant.id, description: 'Ceiling fan', unit: 'pcs', quantity: '20.000', unitPricePaise: 10_000n, taxablePaise: 200_000n, gstRateBp: 1800, ...tax, totalPaise: 236_000n }] },
    },
    include: { lines: true },
  });
  return { ctx, contact, invoice, lineId: invoice.lines[0].id };
}
const cash = (amountPaise: number) => ({ amountPaise, method: 'cash' as const });

describe('sales return', () => {
  it('takes GST from the invoice line and lowers what the invoice owes', async () => {
    await rolledBack(async () => {
      const { ctx, invoice, lineId } = await setup();
      const note = await createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: lineId, quantity: 1 }] });
      expect(note).toMatchObject({ kind: 'credit_note', noteType: 'return', sourceNumber: invoice.number, taxablePaise: 10_000n, cgstPaise: 900n, sgstPaise: 900n, igstPaise: 0n, totalPaise: 11_800n, paidPaise: 11_800n });
      expect(note.number).toMatch(/^CN\//);
      const after = await billing.getDocument(ctx, invoice.id, 'invoice');
      expect(after).toMatchObject({ status: 'partially_paid', paidPaise: 11_800n, creditedPaise: 11_800n });
    });
  });

  it('uses IGST when the invoice did', async () => {
    await rolledBack(async () => {
      const { ctx, invoice, lineId } = await setup(true);
      const note = await createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: lineId, quantity: 2 }] });
      expect(note).toMatchObject({ cgstPaise: 0n, sgstPaise: 0n, igstPaise: 3_600n, totalPaise: 23_600n });
    });
  });

  it('never returns more than was sold, across credit notes', async () => {
    await rolledBack(async () => {
      const { ctx, invoice, lineId } = await setup();
      await expect(createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: lineId, quantity: 21 }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: lineId, quantity: 15 }] });
      expect((await creditableLines(ctx, invoice.id))[0].quantityLeft).toBe(5);
      await expect(createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: lineId, quantity: 6 }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const last = await createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: lineId, quantity: 5 }] });
      expect(last.totalPaise).toBe(59_000n);
      expect(await billing.getDocument(ctx, invoice.id, 'invoice')).toMatchObject({ status: 'paid', paidPaise: 236_000n });
      expect((await creditableLines(ctx, invoice.id))[0].taxableLeftPaise).toBe(0n);
    });
  });

  it('clears the line to the paisa when rounding would leave some behind', async () => {
    await rolledBack(async () => {
      const { ctx, invoice, lineId } = await setup();
      // 3 × ₹33.33 style split: 20 pieces in odd lots
      for (const quantity of [3, 7]) await createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: lineId, quantity }] });
      await createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: lineId, quantity: 10 }] });
      const notes = await db().salesDocument.aggregate({ where: { kind: 'credit_note', sourceId: invoice.id }, _sum: { totalPaise: true, cgstPaise: true } });
      expect(notes._sum).toMatchObject({ totalPaise: 236_000n, cgstPaise: 18_000n });
    });
  });
});

describe('reducing the amount only', () => {
  it('credits value without touching quantity', async () => {
    await rolledBack(async () => {
      const { ctx, invoice, lineId } = await setup();
      const note = await createCreditNote(ctx, invoice.id, { type: 'amount', lines: [{ sourceLineId: lineId, taxablePaise: 20_000 }] });
      expect(note.totalPaise).toBe(23_600n);
      const [open] = await creditableLines(ctx, invoice.id);
      expect(open.quantityLeft).toBe(20);
      expect(open.taxableLeftPaise).toBe(180_000n);
      await expect(createCreditNote(ctx, invoice.id, { type: 'amount', lines: [{ sourceLineId: lineId, taxablePaise: 180_001 }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });
});

describe('credit beyond what the invoice owes', () => {
  it('stays with the customer and can go on another invoice', async () => {
    await rolledBack(async () => {
      const { ctx, contact, invoice, lineId } = await setup();
      await billing.recordPayment(ctx, invoice.id, cash(236_000));
      const note = await createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: lineId, quantity: 1 }] });
      expect(note.paidPaise).toBe(0n);
      const list = await billing.listAdvances(ctx, contact.id);
      expect(list.creditPaise).toBe(11_800n);

      const next = await db().salesDocument.create({ data: { tenantId: ctx.tenantId, kind: 'invoice', status: 'issued', number: `INV-${randomUUID().slice(0, 6)}`, contactId: contact.id, buyer: { name: 'Sharma Traders' }, issueDate: new Date(), totalPaise: 50_000n } });
      const used = await billing.useAdvance(ctx, next.id, { creditNoteId: note.id, amountPaise: 11_800 });
      expect(used).toMatchObject({ paidPaise: 11_800n, creditedPaise: 11_800n, status: 'partially_paid' });
      expect(used.adjustments[0].creditNote?.number).toBe(note.number);
      expect((await billing.listAdvances(ctx, contact.id)).creditPaise).toBe(0n);
      await expect(cancelCreditNote(ctx, note.id, 'mistake')).rejects.toMatchObject({ code: 'CONFLICT' });

      expect(await billing.removeAdvanceUse(ctx, used.adjustments[0].id)).toMatchObject({ paidPaise: 0n, creditedPaise: 0n, status: 'issued' });
      expect((await billing.listAdvances(ctx, contact.id)).creditPaise).toBe(11_800n);
    });
  });

  it('can be refunded, which counts as money out, and the refund can be undone', async () => {
    await rolledBack(async () => {
      const { ctx, invoice, lineId } = await setup();
      await billing.recordPayment(ctx, invoice.id, cash(236_000));
      const note = await createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: lineId, quantity: 1 }] });
      await expect(refundCreditNote(ctx, note.id, cash(11_801))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const refunded = await refundCreditNote(ctx, note.id, cash(11_800));
      expect(refunded.paidPaise).toBe(11_800n);
      expect(refunded.payments[0].amountPaise).toBe(-11_800n);
      const received = await db().payment.aggregate({ where: { tenantId: ctx.tenantId }, _sum: { amountPaise: true } });
      expect(received._sum.amountPaise).toBe(224_200n);
      await expect(cancelCreditNote(ctx, note.id, 'mistake')).rejects.toMatchObject({ code: 'CONFLICT' });

      const undone = await billing.reversePayment(ctx, refunded.payments[0].id);
      expect(undone).toMatchObject({ kind: 'credit_note', paidPaise: 0n });
      const after = await db().payment.aggregate({ where: { tenantId: ctx.tenantId }, _sum: { amountPaise: true } });
      expect(after._sum.amountPaise).toBe(236_000n);
    });
  });
});

describe('cancelling a credit note', () => {
  it('puts the invoice back and frees the quantity again', async () => {
    await rolledBack(async () => {
      const { ctx, invoice, lineId } = await setup();
      const note = await createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: lineId, quantity: 20 }] });
      expect((await billing.getDocument(ctx, invoice.id, 'invoice')).status).toBe('paid');
      // The credit note's own use cannot be pulled off the invoice piecemeal
      const inv = await billing.getDocument(ctx, invoice.id, 'invoice');
      await expect(billing.removeAdvanceUse(ctx, inv.adjustments[0].id)).rejects.toMatchObject({ code: 'CONFLICT' });
      // The invoice cannot be cancelled while it carries the credit
      await expect(billing.cancelInvoice(ctx, invoice.id, 'mistake')).rejects.toMatchObject({ code: 'CONFLICT' });

      expect(await cancelCreditNote(ctx, note.id, 'wrong invoice')).toMatchObject({ status: 'cancelled', paidPaise: 0n });
      expect(await billing.getDocument(ctx, invoice.id, 'invoice')).toMatchObject({ status: 'issued', paidPaise: 0n, creditedPaise: 0n });
      expect((await creditableLines(ctx, invoice.id))[0].quantityLeft).toBe(20);
      await expect(cancelCreditNote(ctx, note.id, 'again')).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('is refused on a draft or cancelled invoice', async () => {
    await rolledBack(async () => {
      const { ctx, invoice, lineId } = await setup();
      await db().salesDocument.update({ where: { id: invoice.id }, data: { status: 'cancelled' } });
      await expect(createCreditNote(ctx, invoice.id, { type: 'return', lines: [{ sourceLineId: lineId, quantity: 1 }] })).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });
});
