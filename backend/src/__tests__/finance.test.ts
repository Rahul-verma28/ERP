import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, db, withPlatform } from '../kernel/db';
import type { TenantCtx } from '../kernel/context';
import { todayIST } from '../kernel/gst';
import * as fin from '../modules/finance/service';
import * as books from '../modules/finance/books';
import * as rec from '../modules/finance/recurring';
import * as billing from '../modules/billing/service';

// Finance: default accounts, expenses with GST bills, other income, transfers, balances and reports.

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
async function prepare() {
  const n = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db().user.create({ data: { name: 'Accounts', email: `fin-${n}@example.test`, mobile: `+916${n}` } });
  const tenant = await db().tenant.create({ data: { name: `Finance ${n}`, industryKey: 'general', templateVersion: 1, ownerUserId: user.id, billingStateCode: '09', gstin: '09AAACH7409R1ZZ' } });
  const roleId = (await prisma.role.findFirstOrThrow({ where: { key: 'owner', tenantId: null }, select: { id: true } })).id;
  const ctx: TenantCtx = { kind: 'tenant', tenantId: tenant.id, userId: user.id, memberId: randomUUID(), roleId, sessionId: randomUUID(), branchIds: [], scope: 'all' };
  const accounts = await fin.ensureFinance(ctx);
  const cash = accounts.find((a) => a.kind === 'cash')!;
  const bank = accounts.find((a) => a.kind === 'bank')!;
  return { ctx, cash, bank };
}
const balance = async (ctx: TenantCtx, id: string) => (await fin.listAccounts(ctx)).find((a) => a.id === id)!.balancePaise;

describe('finance', () => {
  it('makes a cash and a default bank account, and the usual categories', async () => {
    await rolledBack(async () => {
      const { ctx, bank } = await prepare();
      expect(bank.isDefault).toBe(true);
      expect((await fin.listCategories(ctx, 'expense')).map((c) => c.name)).toContain('Rent');
      expect((await fin.listCategories(ctx, 'income')).map((c) => c.name)).toContain('Interest received');
    });
  });

  it('splits a GST bill, needs its details, and takes money out of the account', async () => {
    await rolledBack(async () => {
      const { ctx, bank } = await prepare();
      await expect(fin.createExpense(ctx, fin.ExpenseInput.parse({ category: 'Rent', amountPaise: 1_180_000, paidOn: today, accountId: bank.id, gstBill: true }))).rejects.toThrow('bill number');
      const e = await fin.createExpense(ctx, fin.ExpenseInput.parse({ category: 'Rent', amountPaise: 1_180_000, paidOn: today, accountId: bank.id, gstBill: true, billNo: 'R-11', vendorGstin: '27AAPFU0939F1ZV', gstRateBp: 1800 }));
      expect(e.taxablePaise).toBe(1_000_000n);
      expect(e.gstPaise).toBe(180_000n);
      expect(e.number).toMatch(/^EXP\//);
      expect(await balance(ctx, bank.id)).toBe(-1_180_000n);
      await expect(fin.createExpense(ctx, fin.ExpenseInput.parse({ category: 'Not a category', amountPaise: 100, paidOn: today, accountId: bank.id }))).rejects.toThrow('category');

      const pnl = await books.profitAndLoss(ctx, { from: today, to: today });
      // GST on the bill is claimed back: only ₹10,000 is the cost
      expect(pnl.expenses.totalPaise).toBe(1_000_000n);
      expect(pnl.netProfitPaise).toBe(-1_000_000n);
    });
  });

  it('counts customer payments, income and transfers in each account, with a running balance', async () => {
    await rolledBack(async () => {
      const { ctx, cash, bank } = await prepare();
      await fin.updateAccount(ctx, cash.id, { openingPaise: 500_000, openingDate: today, version: cash.version });
      await billing.recordAdvance(ctx, { contactId: (await db().contact.create({ data: { tenantId: ctx.tenantId, type: 'customer', name: 'Verma' } })).id, amountPaise: 200_000, method: 'cash' });
      await fin.createIncome(ctx, fin.IncomeInput.parse({ category: 'Interest received', amountPaise: 15_000, receivedOn: today, accountId: bank.id }));
      expect(await balance(ctx, cash.id)).toBe(700_000n);

      await expect(fin.createTransfer(ctx, fin.TransferInput.parse({ transferOn: today, fromAccountId: cash.id, toAccountId: bank.id, amountPaise: 800_000 }))).rejects.toThrow('Only');
      await expect(fin.createTransfer(ctx, fin.TransferInput.parse({ transferOn: today, fromAccountId: cash.id, toAccountId: cash.id, amountPaise: 100 }))).rejects.toThrow('two different');
      await fin.createTransfer(ctx, fin.TransferInput.parse({ transferOn: today, fromAccountId: cash.id, toAccountId: bank.id, amountPaise: 600_000, chargesPaise: 0 }));
      expect(await balance(ctx, cash.id)).toBe(100_000n);
      expect(await balance(ctx, bank.id)).toBe(615_000n);

      const st = await fin.statement(ctx, cash.id);
      expect(st.data.map((r) => r.kind)).toEqual(['opening', 'receipt', 'transfer_out']);
      expect(st.closingPaise).toBe(100_000n);

      // Moving money between own accounts is not money in or out of the business
      const flow = await fin.cashFlow(ctx, { from: today, to: today });
      expect(flow.inPaise).toBe(215_000n);
      expect(flow.outPaise).toBe(0n);

      await expect(fin.updateAccount(ctx, cash.id, { isActive: false, version: (await db().finAccount.findUniqueOrThrow({ where: { id: cash.id } })).version })).rejects.toThrow('still has');
    });
  });

  it('keeps balanced books: trial balance, balance sheet, P&L and GST from what was recorded', async () => {
    await rolledBack(async () => {
      const { ctx, cash, bank } = await prepare();
      await fin.updateAccount(ctx, cash.id, { openingPaise: 500_000, openingDate: today, version: cash.version });
      const customer = await db().contact.create({ data: { tenantId: ctx.tenantId, type: 'customer', name: 'Verma' } });
      await db().salesDocument.create({ data: { tenantId: ctx.tenantId, kind: 'invoice', status: 'issued', number: 'INV/T/1', issueDate: new Date(`${today}T00:00:00Z`), contactId: customer.id, buyer: { name: 'Verma' }, taxablePaise: 1_000_000n, cgstPaise: 90_000n, sgstPaise: 90_000n, totalPaise: 1_180_000n } });
      await billing.recordAdvance(ctx, { contactId: customer.id, amountPaise: 500_000, method: 'cash' });
      await fin.createExpense(ctx, fin.ExpenseInput.parse({ category: 'Rent', amountPaise: 1_180_000, paidOn: today, accountId: bank.id, gstBill: true, billNo: 'R-1', vendorGstin: '09AAACH7409R1ZZ', gstRateBp: 1800 }));

      // A loan into the bank: a journal entry on a ledger of your own
      const loan = await books.createLedger(ctx, books.LedgerInput.parse({ name: 'Loan from SBI', group: 'liability' }));
      await expect(books.createJournal(ctx, books.JournalInput.parse({ journalOn: today, narration: 'Loan', lines: [{ ledgerKey: `cash:${bank.id}`, debitPaise: 1_000_000 }, { ledgerKey: `led:${loan.id}`, creditPaise: 900_000 }] }))).rejects.toThrow('must be equal');
      await expect(books.createJournal(ctx, books.JournalInput.parse({ journalOn: today, narration: 'Fix', lines: [{ ledgerKey: 'receivables', debitPaise: 100 }, { ledgerKey: 'capital', creditPaise: 100 }] }))).rejects.toThrow('own documents');
      const j = await books.createJournal(ctx, books.JournalInput.parse({ journalOn: today, narration: 'Loan received', lines: [{ ledgerKey: `cash:${bank.id}`, debitPaise: 1_000_000 }, { ledgerKey: `led:${loan.id}`, creditPaise: 1_000_000 }] }));
      expect(j.number).toMatch(/^JV\//);
      expect(await balance(ctx, bank.id)).toBe(1_000_000n - 1_180_000n);
      await expect(books.deleteLedger(ctx, loan.id)).rejects.toThrow('Close it instead');

      const tb = await books.trialBalance(ctx, { from: today, to: today });
      expect(tb.debitPaise).toBe(tb.creditPaise);
      expect(tb.data.find((r) => r.key === 'receivables')?.debitPaise).toBe(680_000n);

      const bs = await books.balanceSheet(ctx, today);
      expect(bs.assetsPaise).toBe(bs.liabilitiesPaise + bs.equityPaise);

      const pnl = await books.profitAndLoss(ctx, { from: today, to: today });
      expect(pnl.sales.netPaise).toBe(1_000_000n);
      expect(pnl.netProfitPaise).toBe(0n);

      const gst = await books.gstSummary(ctx, { from: today, to: today });
      expect(gst.outputTotal.cgstPaise + gst.outputTotal.sgstPaise).toBe(180_000n);
      expect(gst.inputTotal.cgstPaise + gst.inputTotal.sgstPaise).toBe(180_000n);
      expect(gst.netPaise).toBe(0n);

      const led = await books.ledgerStatement(ctx, `led:${loan.id}`, { from: today, to: today });
      expect(led.closingPaise).toBe(1_000_000n);
    });
  });

  it('records a repeating expense when due, moves the date on, and keeps budgets', async () => {
    expect(rec.nextDate('2026-01-31', 'month', 31)).toBe('2026-02-28');
    expect(rec.nextDate('2026-02-28', 'month', 31)).toBe('2026-03-31');
    expect(rec.nextDate('2026-11-15', 'quarter', 15)).toBe('2027-02-15');
    await rolledBack(async () => {
      const { ctx, bank } = await prepare();
      const r = await rec.createRecurring(ctx, rec.RecurringInput.parse({ name: 'Shop rent', every: 'month', nextOn: today, template: { category: 'Rent', amountPaise: 2_000_000, accountId: bank.id, payee: 'Landlord' } }));
      expect((await rec.listRecurring(ctx)).due).toBe(1);
      const { expense, recurring } = await rec.runRecurring(ctx, r.id, 'record');
      expect(expense?.amountPaise).toBe(2_000_000n);
      expect(recurring.isDue).toBe(false);
      await expect(rec.runRecurring(ctx, r.id, 'record')).rejects.toThrow('next due');

      const rent = (await fin.listCategories(ctx, 'expense')).find((c) => c.name === 'Rent')!;
      await rec.setBudget(ctx, rent.id, 1_500_000);
      const b = await rec.budgetReport(ctx, today.slice(0, 7));
      expect(b.data.find((x) => x.name === 'Rent')?.spentPaise).toBe(2_000_000n);
      expect(b.over).toBe(1);

      // Ticking the rent off against the bank statement
      const st = await fin.statement(ctx, bank.id);
      await fin.reconcile(ctx, bank.id, { entryIds: [st.data[0].id], cleared: true });
      const after = await fin.statement(ctx, bank.id);
      expect(after.clearedPaise).toBe(-2_000_000n);
      expect(after.unclearedCount).toBe(0);
    });
  });

  it('renames a category everywhere and refuses to delete one in use', async () => {
    await rolledBack(async () => {
      const { ctx, cash } = await prepare();
      await fin.createExpense(ctx, fin.ExpenseInput.parse({ category: 'Rent', amountPaise: 5_000, paidOn: today, accountId: cash.id }));
      const rent = (await fin.listCategories(ctx, 'expense')).find((c) => c.name === 'Rent')!;
      await expect(fin.deleteCategory(ctx, rent.id)).rejects.toThrow('Rename it instead');
      await fin.renameCategory(ctx, rent.id, 'Shop rent');
      expect((await db().expense.findFirstOrThrow({ where: { tenantId: ctx.tenantId } })).category).toBe('Shop rent');
    });
  });
});
