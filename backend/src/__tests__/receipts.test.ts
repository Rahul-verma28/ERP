import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import * as billing from '../modules/billing/service';
import { ReceiveInput, listReceipts, openBills, receivePayment, reverseReceipt } from '../modules/billing/receipts';

// Payments received: one receipt split over a customer's open bills, the rest kept as advance.

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
  const user = await db().user.create({ data: { name: 'Receipt Tester', email: `receipt-${n}@example.test`, mobile: `+918${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Receipts ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09' } });
  const contact = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Verma Stores', stateCode: '09' } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId: await roleId('owner'), sessionId: randomUUID(), branchIds: [], scope: 'all' };
  // Two posted invoices of ₹1,000 and ₹500, the older first
  const bill = async (date: string, rupees: number) => {
    const d = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, issueDate: date, lines: [{ description: 'Service', unit: 'nos', quantity: 1, unitPricePaise: rupees * 100, discountPaise: 0, gstRateBp: 0 }] });
    await db().salesDocument.update({ where: { id: d.id }, data: { status: 'issued', number: `INV-${randomUUID().slice(0, 6)}` } });
    return d.id;
  };
  const older = await bill('2026-10-01', 1000);
  const newer = await bill('2026-10-20', 500);
  return { ctx, contact, older, newer };
}
const paid = async (id: string) => (await db().salesDocument.findUniqueOrThrow({ where: { id }, select: { paidPaise: true, status: true } }));

describe('payments received', () => {
  it('splits one receipt over two invoices and keeps the rest as advance', async () => {
    await rolledBack(async () => {
      const { ctx, contact, older, newer } = await setup();
      expect((await openBills(ctx, contact.id)).map((b) => b.id)).toEqual([older, newer]);
      const r = await receivePayment(ctx, ReceiveInput.parse({ contactId: contact.id, amountPaise: 200_000, method: 'upi', paidOn: today, allocations: [{ documentId: older, amountPaise: 100_000 }, { documentId: newer, amountPaise: 30_000 }] }));
      expect(r.advance).toBe(true);
      expect(r.appliedTo.map((a) => a.id).sort()).toEqual([older, newer].sort());
      expect(r.unusedPaise).toBe(70_000n);
      expect(await paid(older)).toMatchObject({ paidPaise: 100_000n, status: 'paid' });
      expect(await paid(newer)).toMatchObject({ paidPaise: 30_000n, status: 'partially_paid' });
      const list = await listReceipts(ctx, { limit: 25 });
      expect(list.data).toHaveLength(1);

      // Reversing takes it off both invoices and adds the opposite entry
      const back = await reverseReceipt(ctx, r.id);
      expect(back.reversed).toBe(true);
      expect((await paid(older)).paidPaise).toBe(0n);
      expect((await paid(newer)).paidPaise).toBe(0n);
      expect((await listReceipts(ctx, { limit: 25, view: 'reversed' })).data).toHaveLength(1);
    });
  });

  it('records all of it on one bill as a plain payment', async () => {
    await rolledBack(async () => {
      const { ctx, contact, newer } = await setup();
      const r = await receivePayment(ctx, ReceiveInput.parse({ contactId: contact.id, amountPaise: 50_000, method: 'cash', allocations: [{ documentId: newer, amountPaise: 50_000 }] }));
      expect(r.advance).toBe(false);
      expect(r.document?.id).toBe(newer);
      expect((await paid(newer)).status).toBe('paid');
    });
  });

  it('refuses more than is due, more than received, and a cheque with no number', async () => {
    await rolledBack(async () => {
      const { ctx, contact, newer } = await setup();
      await expect(receivePayment(ctx, ReceiveInput.parse({ contactId: contact.id, amountPaise: 90_000, method: 'cash', allocations: [{ documentId: newer, amountPaise: 60_000 }] }))).rejects.toThrow('only ₹500.00 is due');
      expect(ReceiveInput.safeParse({ contactId: contact.id, amountPaise: 10_000, method: 'cash', allocations: [{ documentId: newer, amountPaise: 20_000 }] }).success).toBe(false);
      const cheque = ReceiveInput.safeParse({ contactId: contact.id, amountPaise: 10_000, method: 'cheque', allocations: [] });
      expect(cheque.error?.issues[0]?.path.join('.')).toBe('reference');
    });
  });
});
