// Demo data for Accounting & Finance, so Cash & Bank, Expenses, Other income and Transfers show
// real-looking rows: a current account, a UPI wallet and a credit card with opening balances, monthly
// budgets, three months of expenses (rent, salaries, power, GST bills for internet, ads and the CA),
// other income (interest, commission, scrap) and money moved between accounts.
// Usage: npx tsx prisma/demo-finance.ts <tenantId> [<tenantId> …]
// Skips a business that already has these accounts. Uses the same service code the app uses.
import { randomUUID } from 'node:crypto';
import { prisma, db, withPlatform } from '../src/kernel/db';
import type { TenantCtx } from '../src/kernel/context';
import { gstinCheckChar } from '../src/contracts/validation';
import { todayIST } from '../src/kernel/gst';
import * as fin from '../src/modules/finance/service';

const run = <T>(fn: () => Promise<T>) => withPlatform(fn, { kind: 'platform' }, { timeoutMs: 600_000 });
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00.000Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const gstin = (state: string, pan: string) => { const first = `${state}${pan}1Z`; return first + gstinCheckChar(first); };
/** The given day of a month n months back (0 = this month), never after today */
const dayOf = (monthsBack: number, day: number) => {
  const [y, m] = todayIST().slice(0, 7).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - monthsBack, day)).toISOString().slice(0, 10);
  return d > todayIST() ? todayIST() : d;
};

async function seed(tenantId: string) {
  const t = await run(() => prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, ownerUserId: true } }));
  console.log(`\n${t.name} (${tenantId})`);
  if (await run(() => prisma.finAccount.count({ where: { tenantId, name: 'HDFC Current Account' } }))) return console.log('  · demo accounts already there, skipped');
  const member = await run(() => prisma.tenantMember.findFirstOrThrow({ where: { tenantId, userId: t.ownerUserId! } }));
  const ctx: TenantCtx = { kind: 'tenant', tenantId, userId: t.ownerUserId!, memberId: member.id, roleId: member.roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const today = todayIST();
  const opening = addDays(today, -100);

  // Accounts
  const acc = await run(async () => {
    const base = await fin.ensureFinance(ctx);
    const cash = base.find((a) => a.kind === 'cash')!;
    const hdfc = await fin.createAccount(ctx, fin.AccountInput.parse({ name: 'HDFC Current Account', kind: 'bank', bankName: 'HDFC Bank', accountNo: '50200041235567', ifsc: 'HDFC0001234', openingPaise: 150_000_000, openingDate: opening, isDefault: true, notes: 'Main account for customer and supplier payments.' }));
    const upi = await fin.createAccount(ctx, fin.AccountInput.parse({ name: 'PhonePe Business', kind: 'wallet', upiId: 'aheadstore@ybl', openingPaise: 1_250_000, openingDate: opening }));
    const card = await fin.createAccount(ctx, fin.AccountInput.parse({ name: 'ICICI Credit Card', kind: 'card', bankName: 'ICICI Bank', notes: 'Used for online ads and software.' }));
    for (const [name, budget] of [['Rent', 3_000_000], ['Salaries & wages', 15_000_000], ['Electricity & utilities', 1_000_000], ['Marketing & ads', 1_500_000], ['Travel & fuel', 800_000], ['Office supplies', 500_000]] as const) {
      await db().finCategory.updateMany({ where: { tenantId, kind: 'expense', name }, data: { budgetPaise: BigInt(budget) } });
    }
    // The first bank account took the payments made so far; give it the money it started with
    await db().finAccount.updateMany({ where: { tenantId, name: 'Bank account', openingPaise: 0n }, data: { openingPaise: 80_000_000n, openingDate: new Date(`${opening}T00:00:00.000Z`) } });
    return { cash: cash.id, hdfc: hdfc.id, upi: upi.id, card: card.id };
  });
  console.log('  ✔ 3 accounts (bank, UPI, card) and 6 monthly budgets');

  // Money moved: cash from the bank first, so cash expenses have something to come from
  const TRANSFERS: [string, keyof typeof acc, keyof typeof acc, number, number, string, string | null][] = [
    [dayOf(2, 3), 'hdfc', 'cash', 6_000_000, 0, 'ATM / CHQ 004211', 'Cash for the shop counter'],
    [dayOf(2, 18), 'cash', 'hdfc', 2_500_000, 0, 'Deposit slip 7781', 'Week’s cash sales deposited'],
    [dayOf(1, 2), 'hdfc', 'upi', 1_000_000, 0, 'IMPS 412233', 'Top-up for small UPI payments'],
    [dayOf(1, 5), 'hdfc', 'cash', 5_000_000, 0, 'ATM / CHQ 004219', null],
    [dayOf(1, 20), 'hdfc', 'card', 2_006_000, 0, 'Card bill Oct', 'Credit card bill paid in full'],
    [dayOf(0, 4), 'cash', 'hdfc', 3_000_000, 0, 'Deposit slip 7790', 'Cash sales deposited'],
    [dayOf(0, 8), 'hdfc', 'upi', 500_000, 590, 'IMPS 418870', null],
  ];
  for (const [on, from, to, amount, charges, reference, notes] of TRANSFERS) {
    await run(() => fin.createTransfer(ctx, fin.TransferInput.parse({ transferOn: on, fromAccountId: acc[from], toAccountId: acc[to], amountPaise: amount, chargesPaise: charges, reference, notes })));
  }
  console.log(`  ✔ ${TRANSFERS.length} transfers`);

  // Expenses, three months: [months back, day, category, amount, account, paid to, notes, GST bill (bill no, PAN, state, rate)]
  type E = [number, number, string, number, keyof typeof acc, string, string | null, [string, string, string, number] | null];
  const EXP: E[] = [];
  for (const m of [2, 1, 0]) {
    EXP.push([m, 1, 'Rent', 2_500_000, 'hdfc', 'Sharma Properties', 'Shop rent', null]);
    EXP.push([m, 7, 'Salaries & wages', 13_800_000, 'hdfc', 'Staff salaries', 'Salaries paid by NEFT', null]);
    EXP.push([m, 10, 'Electricity & utilities', 640_000 + m * 45_000, 'upi', 'UPPCL', 'Electricity bill', null]);
    EXP.push([m, 12, 'Internet & phone', 118_000, 'card', 'Airtel Business', 'Broadband 100 Mbps', [`AB${m}4471`, 'AAACB2894G', '09', 1800]]);
    EXP.push([m, 15, 'Travel & fuel', 210_000 + m * 30_000, 'cash', 'Indian Oil, Kapoorthala', 'Delivery bike fuel', null]);
    EXP.push([m, 20, 'Food & refreshments', 85_000, 'cash', 'Sharma Tea Stall', 'Tea and snacks for staff', null]);
  }
  EXP.push([2, 9, 'Marketing & ads', 1_180_000, 'card', 'Google India', 'Search ads, festive season', ['GIN2611042', 'AACCG0527D', '29', 1800]]);
  EXP.push([1, 14, 'Marketing & ads', 590_000, 'card', 'Meta Platforms', 'Instagram ads', ['FBADS77120', 'AAICM9812K', '27', 1800]]);
  EXP.push([2, 22, 'Repairs & maintenance', 354_000, 'cash', 'Verma Electricals', 'Shutter motor repaired', null]);
  EXP.push([1, 11, 'Office supplies', 236_000, 'upi', 'Mahalaxmi Stationery Mart', 'Bill books, pens, printer paper', ['MSM/1182', 'ABDPA6271Q', '09', 1800]]);
  EXP.push([1, 25, 'Professional fees', 1_180_000, 'hdfc', 'Gupta & Associates, CA', 'GST returns and books, quarter', ['GA/26-27/041', 'AAKFG4410M', '09', 1800]]);
  EXP.push([0, 3, 'Bank charges', 29_500, 'hdfc', 'HDFC Bank', 'Quarterly account charges', null]);
  EXP.push([0, 6, 'Transport & delivery', 450_000, 'upi', 'Porter', 'Deliveries to Kanpur', null]);
  EXP.push([0, 9, 'Taxes & licences', 250_000, 'hdfc', 'Nagar Nigam Lucknow', 'Trade licence renewal', null]);
  for (const [m, day, category, amount, a, payee, notes, gst] of EXP) {
    await run(() => fin.createExpense(ctx, fin.ExpenseInput.parse({
      category, amountPaise: amount, paidOn: dayOf(m, day), accountId: acc[a], payee, notes,
      ...(gst ? { gstBill: true, billNo: gst[0], vendorGstin: gstin(gst[2], gst[1]), gstRateBp: gst[3] } : {}),
    })));
  }
  console.log(`  ✔ ${EXP.length} expenses`);

  // Other income
  const INC: [number, number, string, number, keyof typeof acc, string, string | null][] = [
    [2, 30, 'Interest received', 186_000, 'hdfc', 'HDFC Bank', 'Savings sweep interest'],
    [2, 16, 'Scrap sale', 420_000, 'cash', 'Raju Kabadiwala', 'Old cartons and plastic sold'],
    [1, 12, 'Commission received', 1_250_000, 'hdfc', 'Hindustan Unilever', 'Display incentive, festive scheme'],
    [1, 30, 'Interest received', 191_500, 'hdfc', 'HDFC Bank', null],
    [1, 22, 'Rent received', 800_000, 'upi', 'Verma Mobile Repair', 'Counter space rent'],
    [0, 5, 'Discount received', 150_000, 'hdfc', 'Bharat Electricals Pvt Ltd', 'Early payment discount'],
    [0, 10, 'Scrap sale', 265_000, 'cash', 'Raju Kabadiwala', null],
  ];
  for (const [m, day, category, amount, a, payer, notes] of INC) {
    await run(() => fin.createIncome(ctx, fin.IncomeInput.parse({ category, amountPaise: amount, receivedOn: dayOf(m, day), accountId: acc[a], payer, notes })));
  }
  console.log(`  ✔ ${INC.length} other income entries`);
}

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('Usage: npx tsx prisma/demo-finance.ts <tenantId> [<tenantId> …]');
  for (const id of ids) await seed(id);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
