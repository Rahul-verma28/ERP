import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import * as billing from '../modules/billing/service';
import { createCreditNote, refundCreditNote } from '../modules/billing/creditNotes';
import { customerLedger, removeOpeningBalance, setOpeningBalance } from '../modules/billing/ledger';
import { todayIST } from '../kernel/gst';

// Sales & Billing step 3: the customer's khata. Database tests run in a rolled-back transaction.

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
  const user = await db().user.create({ data: { name: 'Ledger Tester', email: `ledger-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Ledger Test ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09' } });
  const contact = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Sharma Traders' } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId: randomUUID(), sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const invoice = (totalPaise: number, issueDate = todayIST()) => db().salesDocument.create({
    data: {
      tenantId: tenant.id, kind: 'invoice', status: 'issued', number: `INV-${randomUUID().slice(0, 8)}`, contactId: contact.id, buyer: { name: 'Sharma Traders' }, issueDate: new Date(issueDate),
      taxablePaise: BigInt(totalPaise), totalPaise: BigInt(totalPaise),
      lines: { create: [{ tenantId: tenant.id, description: 'Goods', quantity: '10.000', unitPricePaise: BigInt(totalPaise / 10), taxablePaise: BigInt(totalPaise), gstRateBp: 0, totalPaise: BigInt(totalPaise) }] },
    },
    include: { lines: true },
  });
  return { ctx, contact, invoice };
}
const cash = (amountPaise: number) => ({ amountPaise, method: 'cash' as const });

describe('the khata', () => {
  it('runs a balance through every kind of entry and matches what is owed', async () => {
    await rolledBack(async () => {
      const { ctx, contact, invoice } = await setup();
      const a = await invoice(400_000);
      const paid = await billing.recordPayment(ctx, a.id, cash(120_000));
      const note = await createCreditNote(ctx, a.id, { type: 'return', lines: [{ sourceLineId: a.lines[0].id, quantity: 1 }] });
      expect(note.totalPaise).toBe(40_000n);
      await billing.reversePayment(ctx, paid.payments[0].id);
      await billing.recordAdvance(ctx, { ...cash(50_000), contactId: contact.id });

      const l = await customerLedger(ctx, contact.id, {});
      expect(l.rows.map((r) => [r.type, r.debitPaise, r.creditPaise])).toEqual([
        ['invoice', 400_000n, 0n],
        ['receipt', 0n, 120_000n],
        ['credit_note', 0n, 40_000n],
        ['reversal', 120_000n, 0n],
        ['advance', 0n, 50_000n],
      ]);
      expect(l.rows.map((r) => r.balancePaise)).toEqual([400_000n, 280_000n, 240_000n, 360_000n, 310_000n]);
      expect(l.balancePaise).toBe(310_000n);
      expect(l.advancePaise).toBe(50_000n);
      // Owed on invoices, less the money held
      const dues = await db().salesDocument.findUniqueOrThrow({ where: { id: a.id } });
      expect(dues.totalPaise - dues.paidPaise - l.advancePaise).toBe(l.balancePaise);
    });
  });

  it('adds nothing when an advance goes on an invoice, and keeps a refund as money out', async () => {
    await rolledBack(async () => {
      const { ctx, contact, invoice } = await setup();
      const advance = await billing.recordAdvance(ctx, { ...cash(100_000), contactId: contact.id });
      const a = await invoice(100_000);
      await billing.useAdvance(ctx, a.id, { paymentId: advance.id, amountPaise: 100_000 });
      let l = await customerLedger(ctx, contact.id, {});
      expect(l.rows).toHaveLength(2);
      expect(l.balancePaise).toBe(0n);

      const note = await createCreditNote(ctx, a.id, { type: 'amount', lines: [{ sourceLineId: a.lines[0].id, taxablePaise: 10_000 }] });
      l = await customerLedger(ctx, contact.id, {});
      expect(l.balancePaise).toBe(-10_000n);
      expect(l.creditPaise).toBe(10_000n);

      await refundCreditNote(ctx, note.id, cash(10_000));
      l = await customerLedger(ctx, contact.id, {});
      expect(l.rows.at(-1)).toMatchObject({ type: 'refund', debitPaise: 10_000n });
      expect(l.balancePaise).toBe(0n);
    });
  });

  it('carries earlier entries forward into a period', async () => {
    await rolledBack(async () => {
      const { ctx, contact, invoice } = await setup();
      await invoice(100_000, '2026-04-10');
      await invoice(200_000, '2026-06-10');
      await invoice(300_000, '2026-08-10');
      const l = await customerLedger(ctx, contact.id, { from: '2026-05-01', to: '2026-07-31' });
      expect(l.broughtForwardPaise).toBe(100_000n);
      expect(l.rows).toHaveLength(1);
      expect(l.rows[0].balancePaise).toBe(300_000n);
      expect(l.closingPaise).toBe(300_000n);
      expect(l.balancePaise).toBe(600_000n);
    });
  });

  it('leaves out drafts and cancelled documents, and fills the age bands', async () => {
    await rolledBack(async () => {
      const { ctx, contact, invoice } = await setup();
      const gone = await invoice(50_000);
      await billing.cancelInvoice(ctx, gone.id, 'mistake');
      await db().salesDocument.create({ data: { tenantId: ctx.tenantId, kind: 'invoice', status: 'draft', contactId: contact.id, buyer: { name: 'X' }, issueDate: new Date(), totalPaise: 99_000n } });
      const old = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
      await invoice(70_000, old);
      await invoice(30_000);
      const l = await customerLedger(ctx, contact.id, {});
      expect(l.rows).toHaveLength(2);
      expect(l.aging.map((b) => b.amountPaise)).toEqual([30_000n, 70_000n, 0n, 0n]);
    });
  });

  it('is limited to what the person may see', async () => {
    await rolledBack(async () => {
      const { ctx, contact, invoice } = await setup();
      await invoice(100_000);
      await expect(customerLedger({ ...ctx, userId: randomUUID(), scope: 'own' }, contact.id, {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

describe('opening balance', () => {
  it('counts as owed, takes payments, and never counts as a sale', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const set = await setOpeningBalance(ctx, contact.id, { amountPaise: 1_000_000, date: '2026-04-01' });
      expect(set.rows[0]).toMatchObject({ type: 'opening_balance', debitPaise: 1_000_000n });
      expect(set.balancePaise).toBe(1_000_000n);

      const id = set.openingBalance!.id;
      const paid = await billing.recordPayment(ctx, id, cash(400_000), 'opening_balance');
      expect(paid).toMatchObject({ status: 'partially_paid', paidPaise: 400_000n });
      expect((await customerLedger(ctx, contact.id, {})).balancePaise).toBe(600_000n);

      expect(await db().salesDocument.count({ where: { tenantId: ctx.tenantId, kind: 'invoice' } })).toBe(0);
      await expect(billing.getDocument(ctx, id, 'invoice')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('can be changed or removed until a payment goes against it', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const first = await setOpeningBalance(ctx, contact.id, { amountPaise: 100_000, date: '2026-04-01' });
      const changed = await setOpeningBalance(ctx, contact.id, { amountPaise: 150_000, date: '2026-04-02' });
      expect(changed.openingBalance).toMatchObject({ id: first.openingBalance!.id, totalPaise: 150_000n });
      expect(changed.rows).toHaveLength(1);

      const paid = await billing.recordPayment(ctx, changed.openingBalance!.id, cash(10_000), 'opening_balance');
      await expect(setOpeningBalance(ctx, contact.id, { amountPaise: 90_000, date: '2026-04-01' })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(removeOpeningBalance(ctx, contact.id)).rejects.toMatchObject({ code: 'CONFLICT' });

      // Undoing the payment frees it again
      expect(await billing.reversePayment(ctx, paid.payments[0].id)).toMatchObject({ kind: 'opening_balance', status: 'issued', paidPaise: 0n });
      await removeOpeningBalance(ctx, contact.id);
      const l = await customerLedger(ctx, contact.id, {});
      expect(l.openingBalance).toBeNull();
      expect(l.rows.map((r) => r.type)).toEqual(['receipt', 'reversal']);
      expect(l.balancePaise).toBe(0n);
    });
  });

  it("refuses a future date", async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      await expect(setOpeningBalance(ctx, contact.id, { amountPaise: 100, date: '2099-01-01' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });
});
