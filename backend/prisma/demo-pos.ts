// Demo data for POS: barcodes on the products, stock topped up at the main warehouse, two counters,
// a cashier login, and six days of closed shifts with counter bills (cash, UPI, card, split, on
// account), a return, cash paid out for tea, cash sent to the bank, one day short, and a bill on hold.
// Usage: npx tsx prisma/demo-pos.ts <tenantId> [<tenantId> …]
// Cashier login: rohit.yadav.<first 8 of tenant id>@example.test / POS@Demo2026
// Uses the same service code the app uses; skips a business that already has counters.
import { randomUUID } from 'node:crypto';
import { prisma, db, withPlatform } from '../src/kernel/db';
import type { TenantCtx } from '../src/kernel/context';
import { hashPassword } from '../src/kernel/crypto';
import { todayIST } from '../src/kernel/gst';
import * as inventory from '../src/modules/inventory/service';
import { defaultLocation } from '../src/modules/inventory/engine';
import * as pos from '../src/modules/pos/service';

const run = <T>(fn: () => Promise<T>) => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 });
const DAY = 86_400_000;
const PASSWORD = 'POS@Demo2026';
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);

// A small fixed random so every run makes the same kind of week
let seedNo = 7;
const rnd = () => ((seedNo = (seedNo * 16807) % 2147483647) / 2147483647);
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

async function seed(tenantId: string) {
  const t = await run(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  if (await run(() => prisma.posCounter.count({ where: { tenantId } }))) return console.log('  · counters already there, skipped');
  const member = await run(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }));
  const ctx: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: member.id, roleId: member.roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const today = todayIST();

  // Barcodes, and enough stock on the shelf
  const items = await run(() => prisma.item.findMany({ where: { tenantId, isActive: true, pricePaise: { gt: 0 } }, orderBy: { name: 'asc' } }));
  const main = await run(() => defaultLocation(ctx));
  let code = Number(BigInt(`0x${tenantId.replace(/-/g, '').slice(-6)}`) % 100000n) * 1000;
  for (const it of items.filter((i) => i.type === 'product' && !i.barcode)) {
    code += 7;
    await run(() => prisma.item.update({ where: { id: it.id }, data: { barcode: `890${String(code).padStart(10, '0')}` } }));
  }
  const sellable = items.filter((i) => i.tracking === 'none' && !/test|hello/i.test(i.name));
  const stocked = sellable.filter((i) => i.trackStock && i.type === 'product');
  const balances = await run(() => prisma.stockBalance.findMany({ where: { tenantId, locationId: main.id, itemId: { in: stocked.map((i) => i.id) } } }));
  const low = stocked.filter((i) => Number(balances.find((b) => b.itemId === i.id)?.quantity ?? 0) < 60);
  if (low.length) await run(() => inventory.postEntry(ctx, inventory.EntryInput.parse({ kind: 'stock_in', locationId: main.id, date: addDays(today, -7), party: 'Opening for the counter', lines: low.map((i) => ({ itemId: i.id, quantity: 80, ratePaise: Number(i.costPricePaise ?? (i.pricePaise * 7n) / 10n) })) })));
  console.log(`  ✔ barcodes on ${items.filter((i) => i.type === 'product' && !i.barcode).length} products, ${low.length} items topped up`);

  // Counters
  const c1 = await run(() => pos.saveCounter(ctx, null, pos.CounterInput.parse({ name: 'Counter 1', locationId: main.id, maxDiscountPct: 10, receiptNote: 'Thank you! Exchange within 7 days with this bill.' })));
  const c2 = await run(() => pos.saveCounter(ctx, null, pos.CounterInput.parse({ name: 'Express Counter', locationId: main.id, paper: '58mm', allowCredit: false, maxDiscountPct: 5 })));
  console.log('  ✔ counters: Counter 1, Express Counter');

  // A cashier who logs in to the counter
  const email = `rohit.yadav.${tenantId.slice(0, 8)}@example.test`;
  const cashierRole = await run(() => prisma.role.findFirstOrThrow({ where: { key: 'cashier', tenantId: null } }));
  const mobile = `+9197${String(parseInt(tenantId.replace(/-/g, '').slice(-8), 16) % 1e8).padStart(8, '0')}`;
  const user = (await run(() => prisma.user.findFirst({ where: { email } }))) ?? (await run(async () => db().user.create({ data: { name: 'Rohit Yadav', email, mobile, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date(), mobileVerifiedAt: new Date(), passwordChangedAt: new Date() } })));
  const cm = (await run(() => prisma.tenantMember.findFirst({ where: { tenantId, userId: user.id } }))) ?? (await run(() => db().tenantMember.create({ data: { tenantId, userId: user.id, roleId: cashierRole.id, status: 'active', joinedAt: new Date(Date.now() - 20 * DAY) } })));
  const cashier: TenantCtx = { ...ctx, userId: user.id, memberId: cm.id, roleId: cashierRole.id, scope: 'branch' };
  console.log(`  ✔ cashier login: ${email} / ${PASSWORD}`);

  const customers = await run(() => prisma.contact.findMany({ where: { tenantId, type: 'customer', isActive: true, phone: { not: null } }, take: 6, orderBy: { createdAt: 'asc' } }));
  const walkIns = [['Ramesh Gupta', '9839012345'], ['Sunita Devi', '9450112233'], ['Mohd. Arif', '9721334455'], ['Kiran Patel', '9918776655']];

  let bills = 0;
  for (let back = 6; back >= 1; back--) {
    const day = addDays(today, -back);
    const who = back % 3 === 0 ? ctx : cashier;
    const counter = back === 2 ? c2 : c1;
    const shift = await run(() => pos.openShift(who, { counterId: counter.id, openingCashPaise: 200_000 }));
    const sales: string[] = [];
    const count = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(sellable)).filter((x, k, a) => a.findIndex((y) => y.id === x.id) === k)
        .map((it) => ({ itemId: it.id, quantity: it.type === 'service' ? 1 : 1 + Math.floor(rnd() * 3), unitPricePaise: Number(it.pricePaise) }));
      const total = lines.reduce((a, l) => a + l.quantity * l.unitPricePaise, 0);
      const r = rnd();
      const credit = counter.allowCredit && i === 2 && customers.length > 0;
      const contact = credit || r > 0.8 ? pick(customers) : null;
      const walk = !contact && r > 0.5 ? pick(walkIns) : null;
      const rounded = Math.round(total / 100) * 100;
      const tenders = credit ? [{ method: 'cash' as const, amountPaise: Math.round(rounded / 200) * 100 }]
        : r < 0.4 ? [{ method: 'cash' as const, amountPaise: Math.ceil(rounded / 10_000) * 10_000 }]
        : r < 0.65 ? [{ method: 'upi' as const, amountPaise: rounded, reference: `UPI${Math.floor(rnd() * 1e9)}` }]
        : r < 0.8 ? [{ method: 'card' as const, amountPaise: rounded, reference: String(1000 + Math.floor(rnd() * 8999)) }]
        : [{ method: 'upi' as const, amountPaise: Math.floor(rounded / 200) * 100, reference: `UPI${Math.floor(rnd() * 1e9)}` }, { method: 'cash' as const, amountPaise: rounded }];
      try {
        const s = await run(() => pos.sell(who, pos.SaleInput.parse({ shiftId: shift.id, contactId: contact?.id ?? null, customer: walk ? { name: walk[0], phone: walk[1] } : null, lines, tenders, billDiscountPaise: i === 4 ? Math.min(2_000, Math.floor(total / 20)) : 0 })));
        sales.push(s.id);
        bills++;
      } catch (e) {
        console.log(`  · a sale skipped: ${(e as Error).message}`);
      }
    }
    // Tea for the staff, on most days
    if (back % 2 === 0) await run(() => pos.cashMove(who, shift.id, pos.CashMoveInput.parse({ kind: 'out', amountPaise: 6_000, reason: 'expense', category: 'Food & refreshments', note: 'Tea and snacks for staff' })));
    // A return on one day
    if (back === 4 && sales[0]) {
      const inv = await run(() => prisma.salesDocument.findUniqueOrThrow({ where: { id: sales[0] }, include: { lines: true } }));
      await run(() => pos.returnSale(ctx, pos.ReturnInput.parse({ shiftId: shift.id, invoiceId: inv.id, reason: 'damaged', notes: 'Box was damaged', lines: [{ sourceLineId: inv.lines[0].id, quantity: 1 }], refund: 'cash' }))).catch((e) => console.log(`  · return skipped: ${(e as Error).message}`));
    }
    const now = await run(() => pos.shiftSummary(ctx, shift.id));
    const short = back === 3 ? 2_000 : 0;
    const counted = Number(now.cash.expectedPaise) - short;
    await run(() => pos.closeShift(who, shift.id, pos.CloseInput.parse({ countedCashPaise: counted, note: short ? 'Gave ₹20 extra change to a customer' : null, depositPaise: back % 2 ? Math.max(0, Math.floor((counted - 200_000) / 10_000) * 10_000) : 0, version: now.version })));

    // Move the shift and everything on it back to its day
    const opened = new Date(`${day}T03:30:00Z`); // 9:00 am IST
    const closed = new Date(`${day}T15:00:00Z`); // 8:30 pm IST
    await run(async () => {
      const d = db();
      await d.$executeRaw`update pos_shifts set opened_at = ${opened}, closed_at = ${closed} where id = ${shift.id}::uuid`;
      await d.$executeRaw`update pos_cash_moves set created_at = ${new Date(`${day}T09:00:00Z`)} where shift_id = ${shift.id}::uuid`;
      const docs = await d.$queryRaw<{ id: string }[]>`select id from sales_documents where (source_type = 'pos' and source_id = ${shift.id}::uuid) or (kind = 'credit_note' and source_id in (select id from sales_documents where source_type = 'pos' and source_id = ${shift.id}::uuid))`;
      const ids = docs.map((x) => x.id);
      let k = 0;
      for (const id of ids) {
        const at = new Date(opened.getTime() + (++k) * 47 * 60_000);
        await d.$executeRaw`update sales_documents set issue_date = ${day}::date, issued_at = ${at}, created_at = ${at} where id = ${id}::uuid`;
      }
      if (ids.length) {
        await d.$executeRaw`update stock_moves set move_date = ${day}::date where source_id = any(${ids}::uuid[])`;
        await d.$executeRaw`update payments_received set paid_on = ${day}::date where pos_shift_id = ${shift.id}::uuid`;
      }
      await d.$executeRaw`update expenses set paid_on = ${day}::date where id in (select expense_id from pos_cash_moves where shift_id = ${shift.id}::uuid and expense_id is not null)`;
      await d.$executeRaw`update fin_transfers set transfer_on = ${day}::date where id in (select deposit_transfer_id from pos_shifts where id = ${shift.id}::uuid and deposit_transfer_id is not null)`;
    });
  }
  console.log(`  ✔ 6 closed shifts with ${bills} counter bills, a return, tea paid out, one day ₹20 short`);

  // A bill waiting on hold at Counter 1
  const it = sellable.slice(0, 2);
  await run(() => pos.hold(ctx, pos.HoldInput.parse({ counterId: c1.id, label: 'Customer went to get cash', totalPaise: it.reduce((a, x) => a + Number(x.pricePaise), 0), lines: it.length, cart: { lines: it.map((x) => ({ key: `${x.id}-held`, itemId: x.id, name: x.name, unit: x.unit, gstRateBp: x.gstRateBp, hsnSac: x.hsnSac, listPricePaise: Number(x.pricePaise), unitPricePaise: Number(x.pricePaise), quantity: 1, discountPaise: 0, tracking: x.tracking, trackStock: x.trackStock, stock: 50, serials: [] })), customer: null, billDiscountPaise: 0, notes: '' } })));
  console.log('  ✔ one bill on hold');
}

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Pass one or more tenant ids');
  for (const id of ids) await seed(id);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
