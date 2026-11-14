import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../kernel/db';
import { notFound } from '../../kernel/errors';
import { DateStr, IdParam, inScope, scopeWhere } from '../../kernel/query';
import { validate } from '../../middleware/request';
import { requirePermission, tenantAuth, tx } from '../../middleware/auth';
import { audit } from '../audit/service';
import * as fin from './service';
import * as books from './books';
import * as rec from './recurring';

// Finance: cash and bank accounts, expenses, other income, transfers, and the money reports.

export { EXPENSE_CATEGORIES } from './service';

const router = Router();
router.use(tenantAuth);
const SCOPE = { owner: ['createdBy'], branch: 'branchId' };
const VIEW = requirePermission('finance.expense.view');

// ── Overview and accounts ──
router.get('/finance/overview', VIEW, tx(async (req, res) => {
  res.json(await fin.overview(req.ctx!));
}));
router.get('/finance/accounts', VIEW, tx(async (req, res) => {
  res.json({ data: await fin.listAccounts(req.ctx!) });
}));
router.get('/finance/accounts/:id/statement', VIEW, validate(IdParam, 'params'), validate(z.object({ from: DateStr.optional(), to: DateStr.optional() }), 'query'), tx(async (req, res) => {
  res.json(await fin.statement(req.ctx!, String(req.params.id), req.query.from as string | undefined, req.query.to as string | undefined));
}));
router.post('/finance/accounts', requirePermission('finance.expense.create'), validate(fin.AccountInput), tx(async (req, res) => {
  res.status(201).json(await fin.createAccount(req.ctx!, req.body));
}));
router.patch('/finance/accounts/:id', requirePermission('finance.expense.edit'), validate(IdParam, 'params'), validate(fin.AccountPatch), tx(async (req, res) => {
  res.json(await fin.updateAccount(req.ctx!, String(req.params.id), req.body));
}));

// ── Categories ──
router.get('/expense-categories', VIEW, tx(async (req, res) => {
  res.json({ data: (await fin.listCategories(req.ctx!, 'expense')).map((c) => c.name) });
}));
router.get('/finance/categories', VIEW, validate(z.object({ kind: z.enum(['expense', 'income']) }), 'query'), tx(async (req, res) => {
  res.json({ data: await fin.listCategories(req.ctx!, req.query.kind as 'expense' | 'income') });
}));
router.post('/finance/categories', requirePermission('finance.expense.create'), validate(fin.CategoryInput), tx(async (req, res) => {
  res.status(201).json(await fin.createCategory(req.ctx!, req.body));
}));
const CategoryPatch = z.object({ name: fin.CategoryInput.shape.name.optional(), budgetPaise: rec.BudgetInput.shape.budgetPaise.optional() }).refine((b) => b.name !== undefined || b.budgetPaise !== undefined, 'Nothing to change');
router.patch('/finance/categories/:id', requirePermission('finance.expense.edit'), validate(IdParam, 'params'), validate(CategoryPatch), tx(async (req, res) => {
  const id = String(req.params.id);
  if (req.body.name !== undefined) await fin.renameCategory(req.ctx!, id, req.body.name);
  if (req.body.budgetPaise !== undefined) await rec.setBudget(req.ctx!, id, req.body.budgetPaise);
  res.json(await db().finCategory.findFirst({ where: { id, tenantId: req.ctx!.tenantId } }));
}));
router.delete('/finance/categories/:id', requirePermission('finance.expense.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  await fin.deleteCategory(req.ctx!, String(req.params.id));
  res.status(204).end();
}));

// ── Expenses ──
router.get('/expenses', VIEW, validate(fin.ExpenseList, 'query'), tx(async (req, res) => {
  res.json(await fin.listExpenses(req.ctx!, req.query as unknown as z.infer<typeof fin.ExpenseList>, scopeWhere(req.ctx!, SCOPE)));
}));
router.get('/expenses/:id', VIEW, validate(IdParam, 'params'), tx(async (req, res) => {
  const e = await db().expense.findUnique({ where: { id: String(req.params.id) } });
  if (!e || !inScope(req.ctx!, e, SCOPE)) throw notFound('Expense');
  const r = await fin.routing(req.ctx!);
  const accountId = r.idFor(e.accountId, e.method);
  res.json({ ...e, accountId, account: r.all.find((a) => a.id === accountId)?.name ?? null });
}));
router.post('/expenses', requirePermission('finance.expense.create'), validate(fin.ExpenseInput), tx(async (req, res) => {
  res.status(201).json(await fin.createExpense(req.ctx!, req.body));
}));
router.put('/expenses/:id', requirePermission('finance.expense.edit'), validate(IdParam, 'params'), validate(fin.ExpenseInput.extend({ version: z.number().int() })), tx(async (req, res) => {
  const e = await db().expense.findUnique({ where: { id: String(req.params.id) } });
  if (!e || !inScope(req.ctx!, e, SCOPE)) throw notFound('Expense');
  const { version, ...body } = req.body as z.infer<typeof fin.ExpenseInput> & { version: number };
  res.json(await fin.updateExpense(req.ctx!, e.id, body, version));
}));
router.delete('/expenses/:id', requirePermission('finance.expense.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  const e = await db().expense.findUnique({ where: { id: String(req.params.id) } });
  if (!e || !inScope(req.ctx!, e, SCOPE)) throw notFound('Expense');
  await db().expense.delete({ where: { id: e.id } });
  await audit({ action: 'finance.expense.delete', entity: 'expense', entityId: e.id, before: { number: e.number, category: e.category, amountPaise: e.amountPaise } });
  res.status(204).end();
}));

// ── Other income ──
router.get('/incomes', VIEW, validate(z.object({ from: DateStr.optional(), to: DateStr.optional(), category: z.string().max(60).optional(), accountId: z.string().uuid().optional() }), 'query'), tx(async (req, res) => {
  const q = req.query as { from?: string; to?: string; category?: string; accountId?: string };
  const r = await fin.routing(req.ctx!);
  const rows = await db().income.findMany({
    where: { AND: [{ tenantId: req.ctx!.tenantId }, q.category ? { category: q.category } : {}, q.accountId ? { accountId: q.accountId } : {}, q.from || q.to ? { receivedOn: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } } : {}] },
    orderBy: [{ receivedOn: 'desc' }, { id: 'desc' }],
    take: 1000,
  });
  const name = new Map(r.all.map((a) => [a.id, a.name]));
  res.json({ data: rows.map((i) => ({ ...i, account: name.get(i.accountId) ?? null })) });
}));
router.post('/incomes', requirePermission('finance.expense.create'), validate(fin.IncomeInput), tx(async (req, res) => {
  res.status(201).json(await fin.createIncome(req.ctx!, req.body));
}));
router.put('/incomes/:id', requirePermission('finance.expense.edit'), validate(IdParam, 'params'), validate(fin.IncomeInput.extend({ version: z.number().int() })), tx(async (req, res) => {
  const { version, ...body } = req.body as z.infer<typeof fin.IncomeInput> & { version: number };
  res.json(await fin.updateIncome(req.ctx!, String(req.params.id), body, version));
}));
router.delete('/incomes/:id', requirePermission('finance.expense.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  const i = await db().income.findFirst({ where: { id: String(req.params.id), tenantId: req.ctx!.tenantId } });
  if (!i) throw notFound('Income');
  await db().income.delete({ where: { id: i.id } });
  await audit({ action: 'finance.income.delete', entity: 'income', entityId: i.id, before: { number: i.number, amountPaise: i.amountPaise } });
  res.status(204).end();
}));

// ── Transfers ──
router.get('/finance/transfers', VIEW, validate(z.object({ from: DateStr.optional(), to: DateStr.optional(), accountId: z.string().uuid().optional() }), 'query'), tx(async (req, res) => {
  res.json(await fin.listTransfers(req.ctx!, req.query as { from?: string; to?: string; accountId?: string }));
}));
router.post('/finance/transfers', requirePermission('finance.expense.create'), validate(fin.TransferInput), tx(async (req, res) => {
  res.status(201).json(await fin.createTransfer(req.ctx!, req.body));
}));
router.delete('/finance/transfers/:id', requirePermission('finance.expense.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  const t = await db().finTransfer.findFirst({ where: { id: String(req.params.id), tenantId: req.ctx!.tenantId } });
  if (!t) throw notFound('Transfer');
  await db().finTransfer.delete({ where: { id: t.id } });
  await audit({ action: 'finance.transfer.delete', entity: 'fin_transfer', entityId: t.id, before: { number: t.number, amountPaise: t.amountPaise } });
  res.status(204).end();
}));

// ── Reports ──
const PeriodQ = validate(books.Period, 'query');
type P = { from: string; to: string };
router.get('/finance/profit-and-loss', VIEW, PeriodQ, tx(async (req, res) => {
  res.json(await books.profitAndLoss(req.ctx!, req.query as unknown as P));
}));
router.get('/finance/trial-balance', VIEW, PeriodQ, tx(async (req, res) => {
  res.json(await books.trialBalance(req.ctx!, req.query as unknown as P));
}));
router.get('/finance/balance-sheet', VIEW, validate(z.object({ date: DateStr }), 'query'), tx(async (req, res) => {
  res.json(await books.balanceSheet(req.ctx!, String(req.query.date)));
}));
router.get('/finance/gst-summary', VIEW, PeriodQ, tx(async (req, res) => {
  res.json(await books.gstSummary(req.ctx!, req.query as unknown as P));
}));
router.get('/finance/budget', VIEW, validate(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM') }), 'query'), tx(async (req, res) => {
  res.json(await rec.budgetReport(req.ctx!, String(req.query.month)));
}));

// ── Chart of accounts, your own ledgers and journal entries ──
router.get('/finance/ledgers', VIEW, tx(async (req, res) => {
  res.json({ data: await books.chartWithBalances(req.ctx!) });
}));
router.get('/finance/ledgers/statement', VIEW, validate(z.object({ key: z.string().min(1).max(80), from: DateStr, to: DateStr }), 'query'), tx(async (req, res) => {
  const q = req.query as { key: string; from: string; to: string };
  res.json(await books.ledgerStatement(req.ctx!, q.key, q));
}));
router.post('/finance/ledgers', requirePermission('finance.expense.create'), validate(books.LedgerInput), tx(async (req, res) => {
  res.status(201).json(await books.createLedger(req.ctx!, req.body));
}));
router.patch('/finance/ledgers/:id', requirePermission('finance.expense.edit'), validate(IdParam, 'params'), validate(books.LedgerPatch), tx(async (req, res) => {
  res.json(await books.updateLedger(req.ctx!, String(req.params.id), req.body));
}));
router.delete('/finance/ledgers/:id', requirePermission('finance.expense.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  await books.deleteLedger(req.ctx!, String(req.params.id));
  res.status(204).end();
}));
router.get('/finance/journals', VIEW, validate(z.object({ from: DateStr.optional(), to: DateStr.optional(), ledgerKey: z.string().max(80).optional() }), 'query'), tx(async (req, res) => {
  res.json(await books.listJournals(req.ctx!, req.query as { from?: string; to?: string; ledgerKey?: string }));
}));
router.get('/finance/journals/:id', VIEW, validate(IdParam, 'params'), tx(async (req, res) => {
  res.json(await books.getJournal(req.ctx!, String(req.params.id)));
}));
router.post('/finance/journals', requirePermission('finance.expense.create'), validate(books.JournalInput), tx(async (req, res) => {
  res.status(201).json(await books.createJournal(req.ctx!, req.body));
}));
router.put('/finance/journals/:id', requirePermission('finance.expense.edit'), validate(IdParam, 'params'), validate(books.JournalInput.extend({ version: z.number().int() })), tx(async (req, res) => {
  const { version, ...b } = req.body;
  res.json(await books.updateJournal(req.ctx!, String(req.params.id), b, version));
}));
router.delete('/finance/journals/:id', requirePermission('finance.expense.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  await books.deleteJournal(req.ctx!, String(req.params.id));
  res.status(204).end();
}));

// ── Repeating expenses ──
router.get('/finance/recurring', VIEW, tx(async (req, res) => {
  res.json(await rec.listRecurring(req.ctx!));
}));
router.post('/finance/recurring', requirePermission('finance.expense.create'), validate(rec.RecurringInput), tx(async (req, res) => {
  res.status(201).json(await rec.createRecurring(req.ctx!, req.body));
}));
router.put('/finance/recurring/:id', requirePermission('finance.expense.edit'), validate(IdParam, 'params'), validate(rec.RecurringInput.and(z.object({ version: z.number().int(), isActive: z.boolean().optional() }))), tx(async (req, res) => {
  const { version, ...b } = req.body;
  res.json(await rec.updateRecurring(req.ctx!, String(req.params.id), b, version));
}));
router.post('/finance/recurring/:id/active', requirePermission('finance.expense.edit'), validate(IdParam, 'params'), validate(z.object({ isActive: z.boolean() })), tx(async (req, res) => {
  res.json(await rec.setRecurringActive(req.ctx!, String(req.params.id), req.body.isActive));
}));
router.post('/finance/recurring/:id/run', requirePermission('finance.expense.create'), validate(IdParam, 'params'), validate(z.object({ mode: z.enum(['record', 'skip']), amountPaise: z.number().int().positive().optional() })), tx(async (req, res) => {
  res.json(await rec.runRecurring(req.ctx!, String(req.params.id), req.body.mode, req.body.amountPaise));
}));
router.delete('/finance/recurring/:id', requirePermission('finance.expense.delete'), validate(IdParam, 'params'), tx(async (req, res) => {
  await rec.deleteRecurring(req.ctx!, String(req.params.id));
  res.status(204).end();
}));

// ── Bank reconciliation: tick off passbook entries that are on the bank statement ──
router.post('/finance/accounts/:id/reconcile', requirePermission('finance.expense.edit'), validate(IdParam, 'params'), validate(z.object({ entryIds: z.array(z.string().min(3).max(80)).min(1).max(500), cleared: z.boolean(), clearedOn: DateStr.optional() })), tx(async (req, res) => {
  res.json(await fin.reconcile(req.ctx!, String(req.params.id), req.body));
}));
router.get('/finance/cash-flow', VIEW, validate(fin.Period, 'query'), tx(async (req, res) => {
  res.json(await fin.cashFlow(req.ctx!, req.query as unknown as z.infer<typeof fin.Period>));
}));
router.get('/finance/day-book', VIEW, validate(z.object({ date: DateStr }), 'query'), tx(async (req, res) => {
  res.json(await fin.dayBook(req.ctx!, String(req.query.date)));
}));

export default router;
