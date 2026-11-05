import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import * as billing from '../modules/billing/service';
import { expandGrants, ROLES } from '../contracts/roles';

// Sales & Billing step 1: wrong receipts are reversed, advances are taken and used.
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
  const user = await db().user.create({ data: { name: 'Pay Tester', email: `pay-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Pay Test ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09' } });
  const contact = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Sharma Traders' } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId: randomUUID(), sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const invoice = async (totalPaise: number, contactId: string | null = contact.id) => db().salesDocument.create({
    data: { tenantId: tenant.id, kind: 'invoice', status: 'issued', number: `INV-${randomUUID().slice(0, 8)}`, contactId, buyer: { name: 'Sharma Traders' }, issueDate: new Date(), totalPaise: BigInt(totalPaise) },
  });
  const cash = (amountPaise: number) => ({ amountPaise, method: 'cash' as const });
  return { ctx, contact, invoice, cash };
}

describe('reversing a payment', () => {
  it('puts the balance back with an opposite entry and keeps the original', async () => {
    await rolledBack(async () => {
      const { ctx, invoice, cash } = await setup();
      const inv = await invoice(100_000);
      const paid = await billing.recordPayment(ctx, inv.id, cash(100_000));
      expect(paid).toMatchObject({ status: 'paid', paidPaise: 100_000n });

      const { id } = paid.payments[0];
      const after = (await billing.reversePayment(ctx, id))!;
      expect(after).toMatchObject({ status: 'issued', paidPaise: 0n });
      expect(after.payments).toHaveLength(2);
      expect(after.payments[1]).toMatchObject({ amountPaise: -100_000n, reversesId: id, number: `${paid.payments[0].number}-R` });

      // Money received nets to nothing
      const sum = await db().payment.aggregate({ where: { documentId: inv.id }, _sum: { amountPaise: true } });
      expect(sum._sum.amountPaise).toBe(0n);
    });
  });

  it('goes back to part paid when another payment stays', async () => {
    await rolledBack(async () => {
      const { ctx, invoice, cash } = await setup();
      const inv = await invoice(100_000);
      await billing.recordPayment(ctx, inv.id, cash(40_000));
      const paid = await billing.recordPayment(ctx, inv.id, cash(60_000));
      expect(paid.status).toBe('paid');
      expect((await billing.reversePayment(ctx, paid.payments[1].id))).toMatchObject({ status: 'partially_paid', paidPaise: 40_000n });
    });
  });

  it('cannot be done twice, or on a reversal', async () => {
    await rolledBack(async () => {
      const { ctx, invoice, cash } = await setup();
      const inv = await invoice(100_000);
      const paid = await billing.recordPayment(ctx, inv.id, cash(10_000));
      const after = (await billing.reversePayment(ctx, paid.payments[0].id))!;
      await expect(billing.reversePayment(ctx, paid.payments[0].id)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(billing.reversePayment(ctx, after.payments[1].id)).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it("stays out of reach of someone who only sees their own, and of a stale invoice", async () => {
    await rolledBack(async () => {
      const { ctx, invoice, cash } = await setup();
      const inv = await invoice(100_000);
      const paid = await billing.recordPayment(ctx, inv.id, cash(10_000));
      await expect(billing.reversePayment({ ...ctx, userId: randomUUID(), scope: 'own' }, paid.payments[0].id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

describe('advance payments', () => {
  it('takes an advance and uses it on an invoice, leaving the rest', async () => {
    await rolledBack(async () => {
      const { ctx, contact, invoice, cash } = await setup();
      const advance = await billing.recordAdvance(ctx, { ...cash(1_000_000), contactId: contact.id });
      expect(advance.documentId).toBeNull();
      expect((await billing.listAdvances(ctx, contact.id)).balancePaise).toBe(1_000_000n);

      const inv = await invoice(2_500_000);
      const used = await billing.useAdvance(ctx, inv.id, { paymentId: advance.id, amountPaise: 1_000_000 });
      expect(used).toMatchObject({ status: 'partially_paid', paidPaise: 1_000_000n });
      expect(used.adjustments[0].payment.number).toBe(advance.number);
      expect((await billing.listAdvances(ctx, contact.id)).balancePaise).toBe(0n);

      // Using an advance is not new money
      const received = await db().payment.aggregate({ where: { tenantId: ctx.tenantId }, _sum: { amountPaise: true } });
      expect(received._sum.amountPaise).toBe(1_000_000n);
    });
  });

  it('refuses more than the advance, more than the balance, or another customer', async () => {
    await rolledBack(async () => {
      const { ctx, contact, invoice, cash } = await setup();
      const advance = await billing.recordAdvance(ctx, { ...cash(50_000), contactId: contact.id });
      const inv = await invoice(30_000);
      await expect(billing.useAdvance(ctx, inv.id, { paymentId: advance.id, amountPaise: 60_000 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(billing.useAdvance(ctx, inv.id, { paymentId: advance.id, amountPaise: 40_000 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const other = await db().contact.create({ data: { tenantId: ctx.tenantId, type: 'customer', name: 'Other Co' } });
      const theirs = await invoice(30_000, other.id);
      await expect(billing.useAdvance(ctx, theirs.id, { paymentId: advance.id, amountPaise: 10_000 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  it('removing it from the invoice returns the money, and only then can it be reversed', async () => {
    await rolledBack(async () => {
      const { ctx, contact, invoice, cash } = await setup();
      const advance = await billing.recordAdvance(ctx, { ...cash(50_000), contactId: contact.id });
      const inv = await invoice(50_000);
      const used = await billing.useAdvance(ctx, inv.id, { paymentId: advance.id, amountPaise: 50_000 });
      expect(used.status).toBe('paid');
      await expect(billing.reversePayment(ctx, advance.id)).rejects.toMatchObject({ code: 'CONFLICT' });

      const removed = await billing.removeAdvanceUse(ctx, used.adjustments[0].id);
      expect(removed).toMatchObject({ status: 'issued', paidPaise: 0n });
      await expect(billing.removeAdvanceUse(ctx, used.adjustments[0].id)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await billing.listAdvances(ctx, contact.id)).balancePaise).toBe(50_000n);

      expect(await billing.reversePayment(ctx, advance.id)).toBeNull();
      const list = await billing.listAdvances(ctx, contact.id);
      expect(list.balancePaise).toBe(0n);
      expect(list.data[0]).toMatchObject({ reversed: true, balancePaise: 0n });
      await expect(billing.useAdvance(ctx, inv.id, { paymentId: advance.id, amountPaise: 1_000 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });
});

describe('who can reverse', () => {
  const grants = (key: string) => expandGrants(ROLES.find((r) => r.key === key)!);
  it('gives it to owners and accounts people, not to the counter or staff', () => {
    for (const key of ['owner', 'admin', 'finance_manager', 'ar_manager']) expect(grants(key).has('billing.payment.approve')).toBe(true);
    for (const key of ['cashier', 'staff', 'sales_manager']) expect(grants(key).has('billing.payment.approve')).toBe(false);
    expect(grants('cashier').has('billing.payment.create')).toBe(true);
  });
});
