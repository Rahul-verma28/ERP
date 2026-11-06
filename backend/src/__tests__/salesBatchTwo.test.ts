import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { dateOnly, todayIST } from '../kernel/gst';
import * as billing from '../modules/billing/service';
import { createCreditNote } from '../modules/billing/creditNotes';
import { dues, eInvoiceJson, ewayBillJson, markReminded, saveGstRefs, unitCode } from '../modules/billing/gstFiles';

// Sales & Billing batch 2 without outside accounts: e-way bill and e-invoice JSON files,
// the numbers the portals give back, and the dues list for reminders sent by hand.

class Rollback extends Error {}
async function rolledBack(fn: () => Promise<void>) {
  try {
    await withPlatform(async () => { await fn(); throw new Rollback(); }, { kind: 'platform' }, { timeoutMs: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

afterAll(() => prisma.$disconnect());

const address = { line1: '12 Station Road', city: 'Noida', pincode: '201301' };
async function setup(contactData: Record<string, unknown> = {}) {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Batch Tester', email: `batch2-${n}@example.test`, mobile: `+917${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Batch Two ${n}`, legalName: 'Batch Two Traders', industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09', gstin: '09AAACS1234F1Z5', address } });
  const contact = await db().contact.create({ data: { tenantId: tenant.id, type: 'customer', name: 'Sharma Traders', stateCode: '09', address: { line1: 'Shop 4, Main Bazar', city: 'Ghaziabad', pincode: '201001' }, ...contactData } });
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId: randomUUID(), sessionId: randomUUID(), branchIds: [], scope: 'all' };
  return { ctx, contact };
}
const line = (over: Record<string, unknown> = {}) => ({ description: 'Ceiling fan', hsnSac: '8414', unit: 'pcs', quantity: 2, unitPricePaise: 100_000, discountPaise: 0, gstRateBp: 1800, ...over });
const issued = async (ctx: TenantCtx, id: string) => {
  await db().salesDocument.update({ where: { id }, data: { status: 'issued', number: `INV-${randomUUID().slice(0, 6)}`, seller: { name: 'Batch Two' } } });
  return billing.getDocument(ctx, id, 'invoice');
};
const road = { transMode: '1' as const, distanceKm: 25, vehicleNo: 'UP16AB1234', vehicleType: 'R' as const, challanReason: 8 as const };

describe('e-way bill JSON', () => {
  it('builds the portal file for an invoice, with services and round-off outside the goods', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const draft = await billing.createDocument(ctx, 'invoice', {
        contactId: contact.id, roundOff: true,
        lines: [line({ freeQuantity: 1 }), line({ description: 'Fitting charges', hsnSac: '995461', unit: 'nos', quantity: 1, unitPricePaise: 10_050 })],
      });
      const inv = await issued(ctx, draft.id);
      const file = await ewayBillJson(ctx, { ids: [inv.id], ...road });
      expect(file.version).toBe('1.0.0621');
      const bill = file.billLists[0];
      expect(bill).toMatchObject({
        userGstin: '09AAACS1234F1Z5', supplyType: 'O', subSupplyType: 1, docType: 'INV', docNo: inv.number, transType: 1,
        fromPincode: 201301, fromStateCode: 9, toGstin: 'URP', toPincode: 201001, toStateCode: 9, actualToStateCode: 9,
        totalValue: 2000, cgstValue: 180, sgstValue: 180, igstValue: 0, transMode: 1, transDistance: '25', vehicleNo: 'UP16AB1234', mainHsnCode: 8414,
      });
      expect(bill.docDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      // The service line is not in the item list; it and the round-off make up the rest of the bill
      expect(bill.itemList).toEqual([expect.objectContaining({ itemNo: 1, hsnCode: 8414, quantity: 3, qtyUnit: 'PCS', taxableAmount: 2000, cgstRate: 9, sgstRate: 9, igstRate: 0 })]);
      expect(bill.totalValue + bill.cgstValue + bill.sgstValue + bill.igstValue + bill.OthValue).toBeCloseTo(bill.totInvValue, 2);
      expect(bill.totInvValue).toBe(Number(inv.totalPaise) / 100);
    });
  });

  it('sends goods to the ship-to address and IGST when it is in another state', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup({ gstin: '09AABCT1332L1ZQ' });
      const draft = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, shipTo: { name: 'Godown', line1: 'Plot 7, MIDC', city: 'Pune', pincode: '411019', stateCode: '27' }, lines: [line()] });
      const inv = await issued(ctx, draft.id);
      const [bill] = (await ewayBillJson(ctx, { ids: [inv.id], ...road })).billLists;
      expect(bill).toMatchObject({ transType: 2, toGstin: '09AABCT1332L1ZQ', toStateCode: 9, actualToStateCode: 27, toPincode: 411019, toPlace: 'Pune', igstValue: 360 });
      expect(bill.itemList[0]).toMatchObject({ igstRate: 18, cgstRate: 0 });
    });
  });

  it('marks challans as CHL with the reason given', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup();
      const challan = await billing.createDocument(ctx, 'delivery_challan', { contactId: contact.id, lines: [line()] });
      const [bill] = (await ewayBillJson(ctx, { ids: [challan.id], ...road, challanReason: 4 })).billLists;
      expect(bill).toMatchObject({ docType: 'CHL', subSupplyType: 4, docNo: challan.number });
    });
  });

  it('lists every bill that is not ready, and why', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup({ address: null });
      const a = await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line({ hsnSac: null })] });
      const b = await issued(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line()] })).id);
      const err = await ewayBillJson(ctx, { ids: [a.id, b.id], ...road }).catch((e) => e);
      expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
      const docs = err.details.documents as { id: string; problems: string[] }[];
      expect(docs.find((d) => d.id === a.id)!.problems).toEqual(expect.arrayContaining(['issue it first', "add the customer's PIN code", 'add the HSN code on Ceiling fan']));
      expect(docs.find((d) => d.id === b.id)!.problems).toEqual(["add the customer's PIN code"]);
    });
  });

  it('maps unit names to GST unit codes', () => {
    expect([unitCode('pcs'), unitCode('Kg'), unitCode('box'), unitCode('ltr.'), unitCode('bunch')]).toEqual(['PCS', 'KGS', 'BOX', 'LTR', 'OTH']);
  });
});

describe('e-invoice JSON', () => {
  it('builds INV and CRN with the original invoice for business customers only', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup({ gstin: '09AABCT1332L1ZQ' });
      const inv = await issued(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line()] })).id);
      const note = await createCreditNote(ctx, inv.id, { type: 'amount', lines: [{ sourceLineId: inv.lines[0].id, taxablePaise: 10_000 }] });
      const [i, c] = await eInvoiceJson(ctx, { ids: [inv.id, note.id] });
      expect(i).toMatchObject({
        Version: '1.1', TranDtls: { TaxSch: 'GST', SupTyp: 'B2B' }, DocDtls: { Typ: 'INV', No: inv.number },
        SellerDtls: { Gstin: '09AAACS1234F1Z5', Pin: 201301, Stcd: '09' }, BuyerDtls: { Gstin: '09AABCT1332L1ZQ', Pos: '09', Pin: 201001 },
        ValDtls: { AssVal: 2000, CgstVal: 180, SgstVal: 180, IgstVal: 0, TotInvVal: 2360 },
      });
      expect((i.ItemList as unknown[])[0]).toMatchObject({ SlNo: '1', HsnCd: '8414', Qty: 2, Unit: 'PCS', UnitPrice: 1000, TotAmt: 2000, AssAmt: 2000, GstRt: 18, TotItemVal: 2360 });
      expect(i.RefDtls).toBeUndefined();
      expect(c).toMatchObject({ DocDtls: { Typ: 'CRN' }, RefDtls: { PrecDocDtls: [{ InvNo: inv.number }] } });

      const walkIn = await db().contact.create({ data: { tenantId: ctx.tenantId, type: 'customer', name: 'Walk-in buyer', stateCode: '09', address: { line1: 'Lane 2', city: 'Noida', pincode: '201301' } } });
      const b2c = await issued(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: walkIn.id, lines: [line()] })).id);
      await expect(eInvoiceJson(ctx, { ids: [b2c.id] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });
});

describe('numbers given back by the portals', () => {
  it('saves the e-way bill number and IRN, and checks them', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup({ gstin: '09AABCT1332L1ZQ' });
      const inv = await issued(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line()] })).id);
      const today = todayIST();
      await expect(saveGstRefs(ctx, inv.id, { ewayBillNo: '181234567890', version: inv.version })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const saved = await saveGstRefs(ctx, inv.id, { ewayBillNo: '181234567890', ewayBillDate: today, irn: 'a'.repeat(64), irnAckNo: '112410000123456', irnAckDate: today, version: inv.version });
      expect(saved).toMatchObject({ ewayBillNo: '181234567890', irn: 'a'.repeat(64), irnAckNo: '112410000123456' });
      expect(saved.ewayBillDate).toEqual(dateOnly(today));
      const cleared = await saveGstRefs(ctx, inv.id, { ewayBillNo: null, version: saved.version });
      expect(cleared).toMatchObject({ ewayBillNo: null, ewayBillDate: null, irn: 'a'.repeat(64) });
      await expect(saveGstRefs(ctx, inv.id, { ewayBillNo: null, version: inv.version })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    });
  });
});

describe('dues', () => {
  it('shows what each customer owes after advances, and notes reminders', async () => {
    await rolledBack(async () => {
      const { ctx, contact } = await setup({ phone: '9820111223' });
      const inv = await issued(ctx, (await billing.createDocument(ctx, 'invoice', { contactId: contact.id, lines: [line()] })).id);
      await db().salesDocument.update({ where: { id: inv.id }, data: { dueDate: dateOnly('2026-01-01') } });
      await billing.recordAdvance(ctx, { contactId: contact.id, amountPaise: 36_000, method: 'cash', paidOn: todayIST() });
      const today = dateOnly(todayIST());
      const list = await dues(ctx, {}, today);
      expect(list.data).toHaveLength(1);
      expect(list.data[0]).toMatchObject({ id: contact.id, duePaise: 200_000n, overduePaise: 236_000n, heldPaise: 36_000n, bills: 1, phone: '9820111223' });
      expect((await dues(ctx, { q: 'nobody' }, today)).data).toHaveLength(0);

      await markReminded(ctx, contact.id, 'whatsapp');
      expect((await dues(ctx, {}, today)).data[0]).toMatchObject({ lastReminderVia: 'whatsapp' });

      await billing.recordAdvance(ctx, { contactId: contact.id, amountPaise: 200_000, method: 'cash', paidOn: todayIST() });
      expect((await dues(ctx, {}, today)).data).toHaveLength(0);
    });
  });
});
