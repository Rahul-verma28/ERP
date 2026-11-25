import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import { MODULE_KEYS } from '../contracts/modules';
import * as inventory from '../modules/inventory/service';
import * as pos from '../modules/pos/service';

// POS: a counter sale is a GST invoice from the counter's warehouse, paid into the counter's
// accounts and tied to the shift; returns bring stock and money back; the shift closes on the
// cash counted against the cash expected.

// The test business lives inside a rolled-back transaction the entitlement cache can't see
vi.mock('../modules/licensing/entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../modules/licensing/entitlements')>()),
  getEntitlements: async () => ({ modules: Object.fromEntries(MODULE_KEYS.map((k) => [k, { status: 'active', tier: 'full' }])), limits: { users: 10, invoicesPerMonth: null } }),
}));

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
  const owner = await db().user.create({ data: { name: 'Owner', email: `pos-${n}@example.test`, mobile: `+917${n}` } });
  const cashierUser = await db().user.create({ data: { name: 'Cashier', email: `posc-${n}@example.test`, mobile: `+918${n}` } });
  const tenant = await db().tenant.create({ data: { name: `POS ${n}`, industryKey: 'retail', templateVersion: 1, ownerUserId: owner.id, billingStateCode: '09', gstin: '09AAACS1234F1Z5', preferences: { taxes: { pricesIncludeTax: true } } } });
  const t = tenant.id;
  const ctx: TenantCtx = { kind: 'tenant', tenantId: t, userId: owner.id, memberId: randomUUID(), roleId: await roleId('owner'), sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const cashier: TenantCtx = { ...ctx, userId: cashierUser.id, roleId: await roleId('cashier'), scope: 'branch' };
  const soap = await db().item.create({ data: { tenantId: t, name: 'Soap', unit: 'pcs', pricePaise: 5_900n, gstRateBp: 1800, trackStock: true, barcode: '8901' } });
  const rice = await db().item.create({ data: { tenantId: t, name: 'Rice 5kg', unit: 'pcs', pricePaise: 45_000n, gstRateBp: 500, trackStock: true } });
  const shop = (await inventory.listLocations(ctx)).data[0];
  await inventory.postEntry(ctx, { kind: 'opening', locationId: shop.id, date: today, lines: [{ itemId: soap.id, quantity: 50, ratePaise: 4_000 }, { itemId: rice.id, quantity: 20, ratePaise: 38_000 }] });
  const counter = await pos.saveCounter(ctx, null, pos.CounterInput.parse({ name: 'Counter 1', locationId: shop.id, maxDiscountPct: 10 }));
  const customer = await db().contact.create({ data: { tenantId: t, type: 'customer', name: 'Sharma Ji', phone: '9811000000', creditLimitPaise: 100_000n } });
  return { t, ctx, cashier, soap, rice, shop, counter, customer };
}
const stock = async (itemId: string) => Number((await db().stockBalance.findFirst({ where: { itemId } }))?.quantity ?? 0);

describe('POS counter', () => {
  it('sells from the counter: GST invoice, stock out, cash with change, all on the shift', async () => {
    await rolledBack(async () => {
      const { cashier, soap, rice, counter } = await setup();
      const shift = await pos.openShift(cashier, { counterId: counter.id, openingCashPaise: 100_000 });
      expect(shift.number).toMatch(/^SH-\d{5}$/);
      await expect(pos.openShift(cashier, { counterId: counter.id, openingCashPaise: 0 })).rejects.toThrow('already have a shift');

      const sale = await pos.sell(cashier, pos.SaleInput.parse({
        shiftId: shift.id,
        lines: [{ itemId: soap.id, quantity: 2, unitPricePaise: 5_900 }, { itemId: rice.id, quantity: 1, unitPricePaise: 45_000 }],
        tenders: [{ method: 'cash', amountPaise: 60_000 }],
      }));
      // 2 × 59 + 450 = 568, prices include GST
      expect(sale.totalPaise).toBe(56_800);
      expect(sale.changePaise).toBe(3_200);
      expect(sale.duePaise).toBe(0);
      expect(await stock(soap.id)).toBe(48);
      const inv = await db().salesDocument.findUniqueOrThrow({ where: { id: sale.id }, include: { payments: true } });
      expect(inv.status).toBe('paid');
      expect(inv.sourceType).toBe('pos');
      expect(inv.payments.every((p) => p.posShiftId === shift.id)).toBe(true);
      // Taxable + GST adds up to the price paid (inclusive), split CGST + SGST inside the state
      expect(Number(inv.taxablePaise + inv.cgstPaise + inv.sgstPaise + inv.roundOffPaise)).toBe(56_800);

      const now = await pos.shiftSummary(cashier, shift.id);
      expect(now.cash.expectedPaise).toBe(100_000n + 56_800n);
      expect(now.totals.bills).toBe(1);
    });
  });

  it('splits a bill over UPI and cash, and refuses an unpaid walk-in bill', async () => {
    await rolledBack(async () => {
      const { cashier, rice, counter } = await setup();
      const shift = await pos.openShift(cashier, { counterId: counter.id, openingCashPaise: 0 });
      const split = await pos.sell(cashier, pos.SaleInput.parse({ shiftId: shift.id, lines: [{ itemId: rice.id, quantity: 2, unitPricePaise: 45_000 }], tenders: [{ method: 'upi', amountPaise: 50_000, reference: 'UPI123' }, { method: 'cash', amountPaise: 40_000 }] }));
      expect(split.duePaise).toBe(0);
      const sum = await pos.shiftSummary(cashier, shift.id);
      expect(sum.methods.upi.inPaise).toBe(50_000n);
      expect(sum.cash.expectedPaise).toBe(40_000n);
      await expect(pos.sell(cashier, pos.SaleInput.parse({ shiftId: shift.id, lines: [{ itemId: rice.id, quantity: 1, unitPricePaise: 45_000 }], tenders: [{ method: 'cash', amountPaise: 10_000 }] }))).rejects.toThrow('still to be paid');
    });
  });

  it('puts the rest on a known customer within their credit limit', async () => {
    await rolledBack(async () => {
      const { cashier, rice, counter, customer } = await setup();
      const shift = await pos.openShift(cashier, { counterId: counter.id, openingCashPaise: 0 });
      const udhaar = await pos.sell(cashier, pos.SaleInput.parse({ shiftId: shift.id, contactId: customer.id, lines: [{ itemId: rice.id, quantity: 2, unitPricePaise: 45_000 }], tenders: [{ method: 'cash', amountPaise: 20_000 }] }));
      expect(udhaar.duePaise).toBe(70_000);
      // Limit ₹1,000: owes 700, another 450 unpaid goes over
      await expect(pos.sell(cashier, pos.SaleInput.parse({ shiftId: shift.id, contactId: customer.id, lines: [{ itemId: rice.id, quantity: 1, unitPricePaise: 45_000 }] }))).rejects.toThrow('credit limit');
    });
  });

  it("holds the cashier to the counter's discount limit; a manager may give more", async () => {
    await rolledBack(async () => {
      const { ctx, cashier, rice, counter } = await setup();
      const shift = await pos.openShift(cashier, { counterId: counter.id, openingCashPaise: 0 });
      const big = { shiftId: shift.id, lines: [{ itemId: rice.id, quantity: 1, unitPricePaise: 45_000 }], billDiscountPaise: 9_000, tenders: [{ method: 'cash' as const, amountPaise: 36_000 }] };
      await expect(pos.sell(cashier, pos.SaleInput.parse(big))).rejects.toThrow('up to 10% off');
      // Owner has approve and may sell on this shift
      const ok = await pos.sell(ctx, pos.SaleInput.parse(big));
      expect(ok.totalPaise).toBe(36_000);
    });
  });

  it('takes goods back: stock returns, cash goes out of the drawer, the shift knows', async () => {
    await rolledBack(async () => {
      const { ctx, soap, counter } = await setup();
      const shift = await pos.openShift(ctx, { counterId: counter.id, openingCashPaise: 50_000 });
      const sale = await pos.sell(ctx, pos.SaleInput.parse({ shiftId: shift.id, lines: [{ itemId: soap.id, quantity: 4, unitPricePaise: 5_900 }], tenders: [{ method: 'cash', amountPaise: 23_600 }] }));
      const bill = await pos.findBill(ctx, sale.number!);
      expect(bill.lines[0].quantityLeft).toBe(4);
      const back = await pos.returnSale(ctx, pos.ReturnInput.parse({ shiftId: shift.id, invoiceId: sale.id, reason: 'damaged', lines: [{ sourceLineId: bill.lines[0].id, quantity: 1 }], refund: 'cash' }));
      expect(back.refundPaise).toBe(5_900n);
      expect(await stock(soap.id)).toBe(47);
      const sum = await pos.shiftSummary(ctx, shift.id);
      expect(sum.cash.expectedPaise).toBe(50_000n + 23_600n - 5_900n);
      expect(sum.totals.returns).toBe(1);
      // A walk-in can't keep it as credit
      await expect(pos.returnSale(ctx, pos.ReturnInput.parse({ shiftId: shift.id, invoiceId: sale.id, reason: 'damaged', lines: [{ sourceLineId: bill.lines[0].id, quantity: 1 }], refund: 'credit' }))).rejects.toThrow('walk-in');
    });
  });

  it('closes the shift on counted cash: short needs a word, an expense paid out goes to Finance', async () => {
    await rolledBack(async () => {
      const { cashier, rice, counter } = await setup();
      const shift = await pos.openShift(cashier, { counterId: counter.id, openingCashPaise: 20_000 });
      await pos.sell(cashier, pos.SaleInput.parse({ shiftId: shift.id, lines: [{ itemId: rice.id, quantity: 1, unitPricePaise: 45_000 }], tenders: [{ method: 'cash', amountPaise: 50_000 }] }));
      const out = await pos.cashMove(cashier, shift.id, pos.CashMoveInput.parse({ kind: 'out', amountPaise: 3_000, reason: 'expense', category: 'Food & refreshments', note: 'Tea' }));
      expect(out.expenseId).toBeTruthy();
      expect(Number((await db().expense.findUniqueOrThrow({ where: { id: out.expenseId! } })).amountPaise)).toBe(3_000);
      await expect(pos.cashMove(cashier, shift.id, pos.CashMoveInput.parse({ kind: 'out', amountPaise: 10_000_000, reason: 'owner' }))).rejects.toThrow('drawer');
      const expected = 20_000 + 45_000 - 3_000;
      const summary = await pos.shiftSummary(cashier, shift.id);
      expect(summary.cash.expectedPaise).toBe(BigInt(expected));
      await expect(pos.closeShift(cashier, shift.id, pos.CloseInput.parse({ countedCashPaise: expected - 1_000, version: summary.version }))).rejects.toThrow('short');
      await expect(pos.closeShift(cashier, shift.id, pos.CloseInput.parse({ countedCashPaise: expected, denominations: { '500': 1 }, version: summary.version }))).rejects.toThrow('add up');
      const closed = await pos.closeShift(cashier, shift.id, pos.CloseInput.parse({ countedCashPaise: expected - 1_000, note: 'Gave extra change', version: summary.version }));
      expect(closed.status).toBe('closed');
      expect(closed.counted?.differencePaise).toBe(-1_000n);
      await expect(pos.sell(cashier, pos.SaleInput.parse({ shiftId: shift.id, lines: [{ itemId: rice.id, quantity: 1, unitPricePaise: 45_000 }], tenders: [{ method: 'cash', amountPaise: 45_000 }] }))).rejects.toThrow('closed');
      const list = await pos.listShifts(cashier, pos.ShiftList.parse({ view: 'short' }));
      expect(list.data.map((s) => s.id)).toEqual([shift.id]);
    });
  });

  it('keeps bills on hold per counter and lists counter bills with how they were paid', async () => {
    await rolledBack(async () => {
      const { cashier, soap, counter } = await setup();
      const shift = await pos.openShift(cashier, { counterId: counter.id, openingCashPaise: 0 });
      const h = await pos.hold(cashier, pos.HoldInput.parse({ counterId: counter.id, label: 'Blue shirt man', cart: { lines: [] }, totalPaise: 5_900, lines: 1 }));
      expect((await pos.listHeld(cashier, counter.id)).data).toHaveLength(1);
      await pos.sell(cashier, pos.SaleInput.parse({ shiftId: shift.id, heldId: h.id, lines: [{ itemId: soap.id, quantity: 1, unitPricePaise: 5_900 }], tenders: [{ method: 'card', amountPaise: 5_900, reference: '4421' }] }));
      expect((await pos.listHeld(cashier, counter.id)).data).toHaveLength(0);
      const sales = await pos.listSales(cashier, pos.SalesList.parse({}));
      expect(sales.data[0].paidBy).toBe('card');
      expect(sales.sums.bills).toBe(1);
      const rep = await pos.report(cashier, pos.ReportQuery.parse({ from: today, to: today, by: 'item' }));
      expect(rep.rows[0].label).toBe('Soap');
    });
  });
});
