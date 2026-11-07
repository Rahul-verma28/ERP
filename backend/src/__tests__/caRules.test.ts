import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { dateOnly, todayIST } from '../kernel/gst';
import * as billing from '../modules/billing/service';
import { createCreditNote, createDebitNote, creditNoteDeadline } from '../modules/billing/creditNotes';
import * as inventory from '../modules/inventory/service';
import { gstReport } from '../modules/reports/sales';

// Tax rules settled on 7 Nov 2026: plain invoices for unregistered businesses (outside GST),
// credit note time limit (Section 34(2)), note shows the invoice date (Rule 53(1A)),
// and stock written off listed for ITC reversal (Section 17(5)(h)).

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
async function setup() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Rule Tester', email: `rules-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Rules ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09', gstin: '09AAACS1234F1Z5' } });
  const contact = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Sharma Traders', stateCode: '09' } });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'warehouse_manager', tenantId: null }, select: { id: true } })).id;
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  return { ctx, contact };
}
const line = { description: 'Fan', unit: 'pcs', quantity: 1, unitPricePaise: 10_000, discountPaise: 0, gstRateBp: 1800 };
const issuedOn = async (ctx: TenantCtx, id: string, date: string, seller: Record<string, unknown> = { name: 'Test', gstin: '09AAACS1234F1Z5' }) => {
  await db().salesDocument.update({ where: { id }, data: { status: 'issued', number: `INV-${randomUUID().slice(0, 6)}`, issueDate: dateOnly(date), seller: seller as object } });
  return billing.getDocument(ctx, id, 'invoice');
};

describe('credit note time limit', () => {
  it('is 30 November after the April–March year of the invoice', () => {
    expect(creditNoteDeadline(dateOnly('2026-05-10')).toISOString().slice(0, 10)).toBe('2027-11-30');
    expect(creditNoteDeadline(dateOnly('2027-02-01')).toISOString().slice(0, 10)).toBe('2027-11-30');
    expect(creditNoteDeadline(dateOnly('2026-04-01')).toISOString().slice(0, 10)).toBe('2027-11-30');
  });

  it('refuses a GST credit note after it, and notes carry the invoice date', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const old = await issuedOn(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line] })).id, '2025-03-01');
      await expect(createCreditNote(ctx, old.id, { type: 'amount', lines: [{ sourceLineId: old.lines[0].id, taxablePaise: 1_000 }] })).rejects.toMatchObject({ code: 'CONFLICT', details: { deadline: '2025-11-30' } });
      const recent = await issuedOn(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line] })).id, today);
      const cn = await createCreditNote(ctx, recent.id, { type: 'amount', lines: [{ sourceLineId: recent.lines[0].id, taxablePaise: 1_000 }] });
      expect(cn.sourceDate).toEqual(dateOnly(today));
      const dn = await createDebitNote(ctx, recent.id, { lines: [{ sourceLineId: recent.lines[0].id, taxablePaise: 1_000 }] });
      expect(dn.sourceDate).toEqual(dateOnly(today));
    });
  });
});

describe('GST sheet', () => {
  it('leaves out invoices of an unregistered business, and lists stock written off for ITC reversal', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const a = await issuedOn(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line] })).id, today);
      await issuedOn(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line] })).id, today, { name: 'Old', unregistered: true });
      const fan = await db().item.create({ data: { tenantId: ctx.tenantId, name: 'Fan', unit: 'pcs', pricePaise: 10_000n, gstRateBp: 1800 } });
      const main = (await inventory.listLocations(ctx)).data[0];
      await inventory.postEntry(ctx, { kind: 'opening', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 10, ratePaise: 5_000 }] });
      await inventory.postEntry(ctx, { kind: 'adjustment', direction: 'out', reason: 'damage', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 2 }] });
      await inventory.postEntry(ctx, { kind: 'adjustment', direction: 'in', reason: 'found', locationId: main.id, date: today, lines: [{ itemId: fan.id, quantity: 1 }] });
      const r = await gstReport(ctx, { from: today, to: today });
      expect(r.totals).toMatchObject({ invoices: 1, taxablePaise: a.taxablePaise, billOfSupplyPaise: 11_800n, stockWrittenOffPaise: 10_000n });
    });
  });
});
