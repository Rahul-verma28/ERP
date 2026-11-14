import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { GST_RATES_BP, dateOnly, divRound, todayIST } from '../../kernel/gst';
import { allocateNumber } from '../../kernel/sequences';
import { DateStr, Paise } from '../../kernel/query';
import { zGstin } from '../../kernel/zodRules';
import { withDefaults } from '../../contracts/workspace';
import { audit } from '../audit/service';
import { loadSnapshot, type Snap } from './snapshot';

// Finance: the business's cash and bank accounts, and every rupee that moves through them —
// customer payments, supplier payments, refunds, expenses, other income and transfers.
// Money recorded before accounts existed (or without one) counts by its method:
// cash goes to the cash account, everything else to the default bank account.

export const EXPENSE_CATEGORIES = [
  'Rent', 'Salaries & wages', 'Electricity & utilities', 'Internet & phone', 'Office supplies', 'Repairs & maintenance',
  'Marketing & ads', 'Travel & fuel', 'Transport & delivery', 'Professional fees', 'Bank charges', 'Taxes & licences', 'Food & refreshments', 'Other',
];
export const INCOME_CATEGORIES = ['Interest received', 'Commission received', 'Rent received', 'Scrap sale', 'Discount received', 'Other income'];

export type AccountKind = 'cash' | 'bank' | 'wallet' | 'card';
const METHOD_OF: Record<AccountKind, 'cash' | 'bank' | 'upi' | 'card'> = { cash: 'cash', bank: 'bank', wallet: 'upi', card: 'card' };

/** The first cash account and a bank account, made the first time Finance is used. */
export async function ensureFinance(ctx: Pick<TenantCtx, 'tenantId'>) {
  const existing = await db().finAccount.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'asc' } });
  if (existing.length) return existing;
  const t = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { preferences: true } });
  const pay = withDefaults(t.preferences).payments;
  await db().finAccount.createMany({
    data: [
      { tenantId: ctx.tenantId, name: 'Cash in hand', kind: 'cash' },
      { tenantId: ctx.tenantId, name: 'Bank account', kind: 'bank', isDefault: true, accountNo: pay.bankAccount || null, ifsc: pay.ifsc || null, upiId: pay.upiId || null },
    ],
  });
  if (!(await db().finCategory.count({ where: { tenantId: ctx.tenantId } }))) {
    await db().finCategory.createMany({
      data: [
        ...EXPENSE_CATEGORIES.map((name, i) => ({ tenantId: ctx.tenantId, kind: 'expense', name, position: i })),
        ...INCOME_CATEGORIES.map((name, i) => ({ tenantId: ctx.tenantId, kind: 'income', name, position: i })),
      ],
      skipDuplicates: true,
    });
  }
  return db().finAccount.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'asc' } });
}

/** Where money without an account goes: cash to the cash account, the rest to the default */
export function routingFrom<A extends { id: string; kind: string; isActive: boolean; isDefault: boolean }>(all: A[]) {
  const cash = all.find((a) => a.kind === 'cash' && a.isActive) ?? all.find((a) => a.kind === 'cash') ?? all[0];
  const bank = all.find((a) => a.isDefault && a.isActive) ?? all.find((a) => a.kind !== 'cash' && a.isActive) ?? cash;
  return { all, cashId: cash.id, bankId: bank.id, idFor: (accountId: string | null | undefined, method: string) => accountId ?? (method === 'cash' ? cash.id : bank.id) };
}

export async function routing(ctx: Pick<TenantCtx, 'tenantId'>) {
  return routingFrom(await ensureFinance(ctx));
}

/** The account a payment goes through: the one chosen (must be open), or by its method */
export async function resolveAccount(ctx: Pick<TenantCtx, 'tenantId'>, accountId: string | null | undefined, method: string, field = 'accountId') {
  const r = await routing(ctx);
  if (!accountId) return r.idFor(null, method);
  const a = r.all.find((x) => x.id === accountId);
  if (!a || !a.isActive) throw new AppError('VALIDATION_FAILED', 'Choose an open cash or bank account.', { fields: { [field]: 'Choose an account' } });
  return a.id;
}

// ── Movements: one list of every rupee in or out, per account ──

export interface Movement {
  id: string
  date: Date
  kind: 'opening' | 'receipt' | 'refund' | 'supplier_payment' | 'expense' | 'income' | 'transfer_in' | 'transfer_out' | 'charges' | 'journal'
  number: string | null
  party: string | null
  details: string | null
  inPaise: bigint
  outPaise: bigint
  accountId: string
  /** Where the source opens in the app */
  href: string | null
}

/** Every movement, optionally of one account and up to a date; sorted by date */
export async function movements(ctx: TenantCtx, opts: { accountId?: string; to?: Date } = {}, given?: Snap) {
  const snap = given ?? (await loadSnapshot(ctx));
  const r = routingFrom(snap.accounts);
  const upTo = (d: Date) => !opts.to || d <= opts.to;
  const accName = new Map(r.all.map((a) => [a.id, a.name]));
  const out: Movement[] = [];
  for (const a of r.all) if (a.openingPaise !== 0n) out.push({ id: `open-${a.id}`, date: a.openingDate ?? a.createdAt, kind: 'opening', number: null, party: null, details: 'Opening balance', inPaise: a.openingPaise > 0n ? a.openingPaise : 0n, outPaise: a.openingPaise < 0n ? -a.openingPaise : 0n, accountId: a.id, href: null });
  for (const p of snap.payments) {
    if (!upTo(p.paidOn)) continue;
    // A negative receipt is a refund or a reversal: money out
    const refund = p.docKind === 'credit_note';
    out.push({
      id: `rc-${p.id}`, date: p.paidOn, kind: p.amountPaise < 0n ? 'refund' : 'receipt', number: p.number, party: p.contactId ? p.contactName : p.buyerName,
      details: p.reversesId ? 'Payment reversed' : refund ? `Refund on ${p.docNumber}` : p.documentId ? `On ${p.docNumber}` : 'Advance', inPaise: p.amountPaise > 0n ? p.amountPaise : 0n, outPaise: p.amountPaise < 0n ? -p.amountPaise : 0n,
      accountId: r.idFor(p.accountId, p.method), href: '/app/m/billing/payments',
    });
  }
  for (const p of snap.supplierPayments) if (upTo(p.paidOn)) out.push({ id: `sp-${p.id}`, date: p.paidOn, kind: 'supplier_payment', number: p.number, party: p.contactName, details: p.reversesId ? 'Payment reversed' : 'Paid to supplier', inPaise: p.amountPaise < 0n ? -p.amountPaise : 0n, outPaise: p.amountPaise > 0n ? p.amountPaise : 0n, accountId: r.idFor(p.accountId, p.method), href: p.documentId ? `/app/m/purchase/${p.documentId}` : '/app/m/purchase/payments' });
  for (const e of snap.expenses) if (upTo(e.paidOn)) out.push({ id: `ex-${e.id}`, date: e.paidOn, kind: 'expense', number: e.number, party: e.payee, details: e.category, inPaise: 0n, outPaise: e.amountPaise, accountId: r.idFor(e.accountId, e.method), href: `/app/m/finance/expenses/${e.id}` });
  for (const i of snap.incomes) if (upTo(i.receivedOn)) out.push({ id: `in-${i.id}`, date: i.receivedOn, kind: 'income', number: i.number, party: i.payer, details: i.category, inPaise: i.amountPaise, outPaise: 0n, accountId: i.accountId, href: '/app/m/finance/income' });
  for (const t of snap.transfers) {
    if (!upTo(t.transferOn)) continue;
    out.push({ id: `to-${t.id}`, date: t.transferOn, kind: 'transfer_out', number: t.number, party: accName.get(t.toAccountId) ?? null, details: `To ${accName.get(t.toAccountId) ?? 'account'}`, inPaise: 0n, outPaise: t.amountPaise, accountId: t.fromAccountId, href: '/app/m/finance/transfers' });
    out.push({ id: `ti-${t.id}`, date: t.transferOn, kind: 'transfer_in', number: t.number, party: accName.get(t.fromAccountId) ?? null, details: `From ${accName.get(t.fromAccountId) ?? 'account'}`, inPaise: t.amountPaise, outPaise: 0n, accountId: t.toAccountId, href: '/app/m/finance/transfers' });
    if (t.chargesPaise > 0n) out.push({ id: `tc-${t.id}`, date: t.transferOn, kind: 'charges', number: t.number, party: null, details: 'Transfer charges', inPaise: 0n, outPaise: t.chargesPaise, accountId: t.fromAccountId, href: '/app/m/finance/transfers' });
  }
  for (const j of snap.journals) {
    if (!upTo(j.journalOn)) continue;
    for (const l of j.lines) if (l.ledgerKey.startsWith('cash:')) out.push({ id: `jl-${l.id}`, date: j.journalOn, kind: 'journal', number: j.number, party: null, details: l.description || j.narration, inPaise: l.debitPaise, outPaise: l.creditPaise, accountId: l.ledgerKey.slice(5), href: `/app/m/finance/journals/${j.id}` });
  }
  const list = opts.accountId ? out.filter((m) => m.accountId === opts.accountId) : out;
  return list.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.kind === 'opening' ? -1 : b.kind === 'opening' ? 1 : 0));
}

/** Accounts with their balance today and this month's money in and out */
export async function listAccounts(ctx: TenantCtx, given?: Snap) {
  const snap = given ?? (await loadSnapshot(ctx));
  const r = routingFrom(snap.accounts);
  const all = await movements(ctx, {}, snap);
  const monthStart = dateOnly(`${todayIST().slice(0, 8)}01`);
  return r.all.map((a) => {
    const mine = all.filter((m) => m.accountId === a.id)
    const month = mine.filter((m) => m.date >= monthStart && m.kind !== 'opening')
    return {
      ...a,
      balancePaise: mine.reduce((s, m) => s + m.inPaise - m.outPaise, 0n),
      inThisMonthPaise: month.reduce((s, m) => s + m.inPaise, 0n),
      outThisMonthPaise: month.reduce((s, m) => s + m.outPaise, 0n),
      entries: mine.length,
      isCash: a.id === r.cashId,
      takesUnassigned: a.id === r.bankId,
    }
  });
}

/** One account's passbook for a period, with the balance brought forward */
export async function statement(ctx: TenantCtx, accountId: string, from?: string, to?: string) {
  const snap = await loadSnapshot(ctx);
  const account = snap.accounts.find((a) => a.id === accountId);
  if (!account) throw notFound('Account');
  const rows = await movements(ctx, { accountId }, snap);
  const fromD = from ? dateOnly(from) : null;
  const toD = to ? dateOnly(to) : null;
  let balance = 0n;
  let broughtForward = 0n;
  const data: (Movement & { balancePaise: bigint })[] = [];
  for (const m of rows) {
    balance += m.inPaise - m.outPaise;
    if (fromD && m.date < fromD) { broughtForward = balance; continue; }
    if (toD && m.date > toD) continue;
    data.push({ ...m, balancePaise: balance });
  }
  const closing = data.length ? data[data.length - 1].balancePaise : broughtForward;
  const marks = new Map((await db().finCleared.findMany({ where: { tenantId: ctx.tenantId, accountId } })).map((c) => [c.entryId, c.clearedOn]));
  const upTo = toD ?? new Date(8.64e15);
  const cleared = rows.filter((m) => m.kind === 'opening' || (marks.has(m.id) && m.date <= upTo));
  return {
    account, broughtForwardPaise: broughtForward, closingPaise: closing,
    clearedPaise: cleared.reduce((s, m) => s + m.inPaise - m.outPaise, 0n),
    unclearedCount: rows.filter((m) => m.kind !== 'opening' && !marks.has(m.id) && m.date <= upTo).length,
    data: data.map((m) => ({ ...m, clearedOn: m.kind === 'opening' ? m.date : marks.get(m.id) ?? null })),
    inPaise: data.reduce((s, m) => s + m.inPaise, 0n), outPaise: data.reduce((s, m) => s + m.outPaise, 0n),
  };
}

/** Tick passbook entries as on the bank statement (or untick them). Only this account's entries. */
export async function reconcile(ctx: TenantCtx, accountId: string, b: { entryIds: string[]; cleared: boolean; clearedOn?: string }) {
  const rows = await movements(ctx, { accountId });
  const mine = new Map(rows.filter((m) => m.kind !== 'opening').map((m) => [m.id, m]));
  const ids = b.entryIds.filter((id) => mine.has(id));
  if (!ids.length) throw new AppError('VALIDATION_FAILED', 'None of these entries are in this account.');
  await db().finCleared.deleteMany({ where: { tenantId: ctx.tenantId, entryId: { in: ids } } });
  if (b.cleared) {
    await db().finCleared.createMany({
      data: ids.map((entryId) => {
        const m = mine.get(entryId)!;
        // Cleared on the day the bank shows it; never before the entry itself
        const on = b.clearedOn ? dateOnly(b.clearedOn) : m.date;
        return { tenantId: ctx.tenantId, accountId, entryId, clearedOn: on < m.date ? m.date : on, createdBy: ctx.userId };
      }),
    });
  }
  return { updated: ids.length };
}

// ── Accounts ──

export const AccountInput = z.object({
  name: z.string().trim().min(2, 'Enter the account name').max(60),
  kind: z.enum(['cash', 'bank', 'wallet', 'card']),
  bankName: z.string().trim().max(80).optional().nullable(),
  accountNo: z.string().trim().regex(/^\d{6,18}$/, 'Account number has 6 to 18 digits').optional().nullable().or(z.literal('').transform(() => null)),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC has 11 characters, e.g. HDFC0001234').optional().nullable().or(z.literal('').transform(() => null)),
  upiId: z.string().trim().regex(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, 'Enter a UPI ID like name@bank').optional().nullable().or(z.literal('').transform(() => null)),
  openingPaise: z.number().int().min(-1e13).max(1e13).default(0),
  openingDate: DateStr.optional().nullable(),
  isDefault: z.boolean().optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

function checkAccount(a: Partial<z.infer<typeof AccountInput>>) {
  if (a.kind === 'bank' && !a.bankName) throw new AppError('VALIDATION_FAILED', 'Enter the bank name.', { fields: { bankName: 'Enter the bank name' } });
  if (a.openingPaise && !a.openingDate) throw new AppError('VALIDATION_FAILED', 'Choose the date of the opening balance.', { fields: { openingDate: 'Choose the date' } });
  if (a.openingDate && dateOnly(a.openingDate) > dateOnly(todayIST())) throw new AppError('VALIDATION_FAILED', "The opening date can't be in the future.", { fields: { openingDate: 'In the future' } });
}

export async function createAccount(ctx: TenantCtx, input: z.infer<typeof AccountInput>) {
  await ensureFinance(ctx);
  checkAccount(input);
  if (await db().finAccount.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: input.name, mode: 'insensitive' } } })) throw new AppError('VALIDATION_FAILED', 'An account with this name already exists.', { fields: { name: 'Already used' } });
  const makeDefault = !!input.isDefault && input.kind !== 'cash';
  if (makeDefault) await db().finAccount.updateMany({ where: { tenantId: ctx.tenantId }, data: { isDefault: false } });
  const a = await db().finAccount.create({ data: { ...input, isDefault: makeDefault, openingPaise: BigInt(input.openingPaise), openingDate: input.openingDate ? dateOnly(input.openingDate) : null, tenantId: ctx.tenantId } });
  await audit({ action: 'finance.account.create', entity: 'fin_account', entityId: a.id, after: { name: a.name, kind: a.kind } });
  return a;
}

export const AccountPatch = AccountInput.partial().extend({ isActive: z.boolean().optional(), version: z.number().int() });

export async function updateAccount(ctx: TenantCtx, id: string, input: z.infer<typeof AccountPatch>) {
  const a = await db().finAccount.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Account');
  if (a.version !== input.version) throw new AppError('VERSION_CONFLICT', 'This account was changed by someone else. Reload and try again.');
  const merged = { ...a, ...input, openingPaise: input.openingPaise ?? Number(a.openingPaise), openingDate: input.openingDate === undefined ? a.openingDate?.toISOString().slice(0, 10) : input.openingDate };
  checkAccount(merged as Partial<z.infer<typeof AccountInput>>);
  if (input.name && input.name.toLowerCase() !== a.name.toLowerCase() && (await db().finAccount.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: input.name, mode: 'insensitive' } } }))) throw new AppError('VALIDATION_FAILED', 'An account with this name already exists.', { fields: { name: 'Already used' } });
  if (input.isActive === false) {
    if (a.isDefault) throw new AppError('CONFLICT', 'Make another account the default before closing this one.');
    const bal = (await listAccounts(ctx)).find((x) => x.id === id)?.balancePaise ?? 0n;
    if (bal !== 0n) throw new AppError('CONFLICT', `This account still has ₹${(Number(bal) / 100).toFixed(2)}. Move it to another account first.`);
    const open = (await db().finAccount.count({ where: { tenantId: ctx.tenantId, isActive: true, kind: a.kind === 'cash' ? 'cash' : { not: 'cash' }, id: { not: id } } }));
    if (!open) throw new AppError('CONFLICT', a.kind === 'cash' ? 'Keep at least one cash account.' : 'Keep at least one bank account.');
  }
  if (input.isDefault) {
    if (a.kind === 'cash') throw new AppError('VALIDATION_FAILED', 'The default is for bank, UPI or card payments; cash always goes to the cash account.');
    await db().finAccount.updateMany({ where: { tenantId: ctx.tenantId }, data: { isDefault: false } });
  }
  const { version: _v, ...data } = input;
  return db().finAccount.update({
    where: { id },
    data: { ...data, isDefault: input.isDefault || undefined, openingPaise: input.openingPaise === undefined ? undefined : BigInt(input.openingPaise), openingDate: input.openingDate === undefined ? undefined : input.openingDate ? dateOnly(input.openingDate) : null, version: { increment: 1 } },
  });
}

// ── Categories ──

export const CategoryInput = z.object({ kind: z.enum(['expense', 'income']), name: z.string().trim().min(2, 'Use at least 2 characters').max(60) });

export async function listCategories(ctx: TenantCtx, kind: 'expense' | 'income') {
  await ensureFinance(ctx);
  return db().finCategory.findMany({ where: { tenantId: ctx.tenantId, kind }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
}

export async function createCategory(ctx: TenantCtx, input: z.infer<typeof CategoryInput>) {
  await ensureFinance(ctx);
  if (await db().finCategory.findFirst({ where: { tenantId: ctx.tenantId, kind: input.kind, name: { equals: input.name, mode: 'insensitive' } } })) throw new AppError('VALIDATION_FAILED', 'This category already exists.', { fields: { name: 'Already used' } });
  const position = await db().finCategory.count({ where: { tenantId: ctx.tenantId, kind: input.kind } });
  return db().finCategory.create({ data: { ...input, tenantId: ctx.tenantId, position } });
}

export async function renameCategory(ctx: TenantCtx, id: string, name: string) {
  const c = await db().finCategory.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c) throw notFound('Category');
  if (name.toLowerCase() !== c.name.toLowerCase() && (await db().finCategory.findFirst({ where: { tenantId: ctx.tenantId, kind: c.kind, name: { equals: name, mode: 'insensitive' } } }))) throw new AppError('VALIDATION_FAILED', 'This category already exists.', { fields: { name: 'Already used' } });
  // Entries keep their category by name: rename them too
  if (c.kind === 'expense') await db().expense.updateMany({ where: { tenantId: ctx.tenantId, category: c.name }, data: { category: name } });
  else await db().income.updateMany({ where: { tenantId: ctx.tenantId, category: c.name }, data: { category: name } });
  return db().finCategory.update({ where: { id }, data: { name } });
}

export async function deleteCategory(ctx: TenantCtx, id: string) {
  const c = await db().finCategory.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c) throw notFound('Category');
  const used = c.kind === 'expense' ? await db().expense.count({ where: { tenantId: ctx.tenantId, category: c.name } }) : await db().income.count({ where: { tenantId: ctx.tenantId, category: c.name } });
  if (used) throw new AppError('CONFLICT', `${used} entr${used === 1 ? 'y uses' : 'ies use'} this category. Rename it instead.`);
  await db().finCategory.delete({ where: { id } });
}

// ── Expenses ──

export const ExpenseInput = z.object({
  category: z.string().trim().min(1, 'Choose the category').max(60),
  amountPaise: Paise.refine((v) => v > 0, 'Enter the amount'),
  paidOn: DateStr,
  accountId: z.string().uuid({ message: 'Choose the account' }),
  payee: z.string().trim().max(160).optional().nullable(),
  contactId: z.string().uuid().optional().nullable(),
  reference: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  receiptUrl: z.string().url().max(500).optional().nullable().or(z.literal('').transform(() => null)),
  /** A GST bill: the supplier's bill number and GSTIN, the rate; the amount includes GST */
  gstBill: z.boolean().default(false),
  billNo: z.string().trim().max(30).optional().nullable(),
  vendorGstin: zGstin.optional().nullable().or(z.literal('').transform(() => null)),
  gstRateBp: z.number().int().optional().nullable(),
  branchId: z.string().uuid().optional().nullable(),
});

export async function expenseData(ctx: TenantCtx, b: z.infer<typeof ExpenseInput>) {
  if (dateOnly(b.paidOn) > dateOnly(todayIST())) throw new AppError('VALIDATION_FAILED', "The date can't be in the future.", { fields: { paidOn: 'In the future' } });
  const categories = await listCategories(ctx, 'expense');
  if (!categories.some((c) => c.name === b.category)) throw new AppError('VALIDATION_FAILED', 'Choose a category from the list.', { fields: { category: 'Choose a category' } });
  const accountId = await resolveAccount(ctx, b.accountId, 'bank');
  const account = await db().finAccount.findUniqueOrThrow({ where: { id: accountId } });
  let gst: { taxablePaise: bigint | null; gstPaise: bigint | null; gstRateBp: number | null; billNo: string | null; vendorGstin: string | null } = { taxablePaise: null, gstPaise: null, gstRateBp: null, billNo: null, vendorGstin: null };
  if (b.gstBill) {
    const fields: Record<string, string> = {};
    if (!b.billNo) fields.billNo = "Enter the supplier's bill number";
    if (!b.vendorGstin) fields.vendorGstin = "Enter the supplier's GSTIN";
    if (b.gstRateBp == null || !(GST_RATES_BP as readonly number[]).includes(b.gstRateBp) || b.gstRateBp === 0) fields.gstRateBp = 'Choose the GST rate on the bill';
    if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', Object.values(fields)[0], { fields });
    // The amount paid includes GST: split it into taxable value and GST
    const total = BigInt(b.amountPaise);
    const taxable = divRound(total * 10_000n, BigInt(10_000 + b.gstRateBp!));
    gst = { taxablePaise: taxable, gstPaise: total - taxable, gstRateBp: b.gstRateBp!, billNo: b.billNo!, vendorGstin: b.vendorGstin! };
  }
  const { gstBill: _g, ...rest } = b;
  return { ...rest, ...gst, accountId, method: METHOD_OF[account.kind as AccountKind], amountPaise: BigInt(b.amountPaise), paidOn: dateOnly(b.paidOn) };
}

export async function createExpense(ctx: TenantCtx, b: z.infer<typeof ExpenseInput>) {
  const data = await expenseData(ctx, b);
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { fyStartMonth: true } });
  const { number } = await allocateNumber(ctx.tenantId, 'expense', tenant.fyStartMonth, data.paidOn);
  const e = await db().expense.create({ data: { ...data, number, tenantId: ctx.tenantId, createdBy: ctx.userId, branchId: b.branchId ?? ctx.branchIds[0] ?? null } });
  await audit({ action: 'finance.expense.create', entity: 'expense', entityId: e.id, after: { number, category: e.category, amountPaise: e.amountPaise } });
  return e;
}

export async function updateExpense(ctx: TenantCtx, id: string, b: z.infer<typeof ExpenseInput>, version: number) {
  const e = await db().expense.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!e) throw notFound('Expense');
  if (e.version !== version) throw new AppError('VERSION_CONFLICT', 'This expense was changed by someone else. Reload and try again.');
  const data = await expenseData(ctx, b);
  // Older expenses got their number when first edited
  const number = e.number ?? (await allocateNumber(ctx.tenantId, 'expense', (await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { fyStartMonth: true } })).fyStartMonth, data.paidOn)).number;
  return db().expense.update({ where: { id }, data: { ...data, number, version: { increment: 1 } } });
}

export const ExpenseList = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: DateStr.optional(),
  to: DateStr.optional(),
  category: z.string().max(60).optional(),
  accountId: z.string().uuid().optional(),
  gst: z.enum(['true', 'false']).optional(),
});

export async function listExpenses(ctx: TenantCtx, q: z.infer<typeof ExpenseList>, scope: Prisma.ExpenseWhereInput) {
  const r = await routing(ctx);
  const where: Prisma.ExpenseWhereInput = {
    AND: [
      { tenantId: ctx.tenantId }, scope,
      q.category ? { category: q.category } : {},
      q.gst === 'true' ? { gstPaise: { not: null } } : q.gst === 'false' ? { gstPaise: null } : {},
      q.accountId ? (q.accountId === r.cashId ? { OR: [{ accountId: q.accountId }, { accountId: null, method: 'cash' }] } : q.accountId === r.bankId ? { OR: [{ accountId: q.accountId }, { accountId: null, method: { not: 'cash' } }] } : { accountId: q.accountId }) : {},
      q.from || q.to ? { paidOn: { gte: q.from ? dateOnly(q.from) : undefined, lte: q.to ? dateOnly(q.to) : undefined } } : {},
      q.q ? { OR: [{ payee: { contains: q.q, mode: 'insensitive' } }, { notes: { contains: q.q, mode: 'insensitive' } }, { number: { contains: q.q, mode: 'insensitive' } }, { billNo: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }] } : {},
    ],
  };
  const [rows, sum, gst] = await Promise.all([
    db().expense.findMany({ where, take: q.limit + 1, orderBy: [{ paidOn: 'desc' }, { id: 'desc' }], ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) }),
    db().expense.aggregate({ where, _sum: { amountPaise: true } }),
    db().expense.aggregate({ where, _sum: { gstPaise: true } }),
  ]);
  const accName = new Map(r.all.map((a) => [a.id, a.name]));
  const data = rows.slice(0, q.limit).map((e) => ({ ...e, accountId: r.idFor(e.accountId, e.method), account: accName.get(r.idFor(e.accountId, e.method)) ?? null }));
  return { data, nextCursor: rows.length > q.limit ? data[data.length - 1].id : null, totalPaise: sum._sum.amountPaise ?? 0n, gstPaise: gst._sum.gstPaise ?? 0n };
}

// ── Other income ──

export const IncomeInput = z.object({
  category: z.string().trim().min(1, 'Choose the category').max(60),
  amountPaise: Paise.refine((v) => v > 0, 'Enter the amount'),
  receivedOn: DateStr,
  accountId: z.string().uuid({ message: 'Choose the account' }),
  payer: z.string().trim().max(160).optional().nullable(),
  reference: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

async function incomeData(ctx: TenantCtx, b: z.infer<typeof IncomeInput>) {
  if (dateOnly(b.receivedOn) > dateOnly(todayIST())) throw new AppError('VALIDATION_FAILED', "The date can't be in the future.", { fields: { receivedOn: 'In the future' } });
  if (!(await listCategories(ctx, 'income')).some((c) => c.name === b.category)) throw new AppError('VALIDATION_FAILED', 'Choose a category from the list.', { fields: { category: 'Choose a category' } });
  return { ...b, accountId: await resolveAccount(ctx, b.accountId, 'bank'), amountPaise: BigInt(b.amountPaise), receivedOn: dateOnly(b.receivedOn) };
}

export async function createIncome(ctx: TenantCtx, b: z.infer<typeof IncomeInput>) {
  const data = await incomeData(ctx, b);
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { fyStartMonth: true } });
  const { number } = await allocateNumber(ctx.tenantId, 'income', tenant.fyStartMonth, data.receivedOn);
  const i = await db().income.create({ data: { ...data, number, tenantId: ctx.tenantId, createdBy: ctx.userId } });
  await audit({ action: 'finance.income.create', entity: 'income', entityId: i.id, after: { number, category: i.category, amountPaise: i.amountPaise } });
  return i;
}

export async function updateIncome(ctx: TenantCtx, id: string, b: z.infer<typeof IncomeInput>, version: number) {
  const i = await db().income.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!i) throw notFound('Income');
  if (i.version !== version) throw new AppError('VERSION_CONFLICT', 'This entry was changed by someone else. Reload and try again.');
  return db().income.update({ where: { id }, data: { ...(await incomeData(ctx, b)), version: { increment: 1 } } });
}

// ── Transfers ──

export const TransferInput = z.object({
  transferOn: DateStr,
  fromAccountId: z.string().uuid({ message: 'Choose where the money comes from' }),
  toAccountId: z.string().uuid({ message: 'Choose where it goes' }),
  amountPaise: Paise.refine((v) => v > 0, 'Enter the amount'),
  chargesPaise: Paise.default(0),
  reference: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function createTransfer(ctx: TenantCtx, b: z.infer<typeof TransferInput>) {
  if (b.fromAccountId === b.toAccountId) throw new AppError('VALIDATION_FAILED', 'Choose two different accounts.', { fields: { toAccountId: 'Same as the from account' } });
  if (dateOnly(b.transferOn) > dateOnly(todayIST())) throw new AppError('VALIDATION_FAILED', "The date can't be in the future.", { fields: { transferOn: 'In the future' } });
  const from = await resolveAccount(ctx, b.fromAccountId, 'bank', 'fromAccountId');
  const to = await resolveAccount(ctx, b.toAccountId, 'bank', 'toAccountId');
  const accounts = await listAccounts(ctx);
  const src = accounts.find((a) => a.id === from)!;
  // Cash can't go below zero; a bank or card can (overdraft, credit)
  if (src.kind === 'cash' && src.balancePaise < BigInt(b.amountPaise + b.chargesPaise)) {
    throw new AppError('VALIDATION_FAILED', `Only ₹${(Number(src.balancePaise) / 100).toFixed(2)} is in ${src.name}.`, { fields: { amountPaise: 'More than the cash in hand' } });
  }
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { fyStartMonth: true } });
  const { number } = await allocateNumber(ctx.tenantId, 'fin_transfer', tenant.fyStartMonth, dateOnly(b.transferOn));
  const t = await db().finTransfer.create({ data: { ...b, fromAccountId: from, toAccountId: to, amountPaise: BigInt(b.amountPaise), chargesPaise: BigInt(b.chargesPaise), transferOn: dateOnly(b.transferOn), number, tenantId: ctx.tenantId, createdBy: ctx.userId } });
  await audit({ action: 'finance.transfer.create', entity: 'fin_transfer', entityId: t.id, after: { number, amountPaise: t.amountPaise } });
  return t;
}

export async function listTransfers(ctx: TenantCtx, q: { from?: string; to?: string; accountId?: string }) {
  const r = await routing(ctx);
  const rows = await db().finTransfer.findMany({
    where: { AND: [{ tenantId: ctx.tenantId }, q.accountId ? { OR: [{ fromAccountId: q.accountId }, { toAccountId: q.accountId }] } : {}, q.from || q.to ? { transferOn: { gte: q.from ? dateOnly(q.from) : undefined, lte: q.to ? dateOnly(q.to) : undefined } } : {}] },
    orderBy: [{ transferOn: 'desc' }, { id: 'desc' }],
    take: 500,
  });
  const name = new Map(r.all.map((a) => [a.id, a.name]));
  return { data: rows.map((t) => ({ ...t, fromAccount: name.get(t.fromAccountId) ?? '—', toAccount: name.get(t.toAccountId) ?? '—' })) };
}

// ── Reports ──

export const Period = z.object({ from: DateStr, to: DateStr });

/** Money in and out by month and by kind, for a period (transfers between own accounts left out) */
export async function cashFlow(ctx: TenantCtx, p: z.infer<typeof Period>, given?: Snap) {
  const all = await movements(ctx, { to: dateOnly(p.to) }, given);
  const fromD = dateOnly(p.from);
  const before = all.filter((m) => m.date < fromD || m.kind === 'opening' && m.date < fromD);
  const inside = all.filter((m) => m.date >= fromD && m.kind !== 'opening');
  const opening = before.reduce((s, m) => s + m.inPaise - m.outPaise, 0n) + all.filter((m) => m.kind === 'opening' && m.date >= fromD).reduce((s, m) => s + m.inPaise - m.outPaise, 0n);
  const external = inside.filter((m) => m.kind !== 'transfer_in' && m.kind !== 'transfer_out');
  const LABEL: Record<string, string> = { receipt: 'From customers', income: 'Other income', refund: 'Refunds to customers', supplier_payment: 'To suppliers', expense: 'Expenses', charges: 'Bank charges', journal: 'Journal entries' };
  const byKind = new Map<string, { inPaise: bigint; outPaise: bigint }>();
  const byMonth = new Map<string, { inPaise: bigint; outPaise: bigint }>();
  for (const m of external) {
    const k = byKind.get(m.kind) ?? { inPaise: 0n, outPaise: 0n };
    k.inPaise += m.inPaise; k.outPaise += m.outPaise; byKind.set(m.kind, k);
    const key = m.date.toISOString().slice(0, 7);
    const mo = byMonth.get(key) ?? { inPaise: 0n, outPaise: 0n };
    mo.inPaise += m.inPaise; mo.outPaise += m.outPaise; byMonth.set(key, mo);
  }
  const inPaise = external.reduce((s, m) => s + m.inPaise, 0n);
  const outPaise = external.reduce((s, m) => s + m.outPaise, 0n);
  return {
    from: p.from, to: p.to, openingPaise: opening, inPaise, outPaise, closingPaise: opening + inPaise - outPaise,
    byKind: [...byKind].map(([kind, v]) => ({ kind, label: LABEL[kind] ?? kind, ...v })),
    byMonth: [...byMonth].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, v]) => ({ month, ...v, netPaise: v.inPaise - v.outPaise })),
  };
}

/** Everything that happened on one day: bills, payments, expenses, income, transfers */
export async function dayBook(ctx: TenantCtx, date: string) {
  const day = dateOnly(date);
  const [docs, bills] = await Promise.all([
    db().salesDocument.findMany({ where: { tenantId: ctx.tenantId, issueDate: day, kind: { in: ['invoice', 'credit_note', 'debit_note'] }, status: { not: 'draft' } }, select: { id: true, kind: true, number: true, buyer: true, totalPaise: true, status: true } }),
    db().purchaseDocument.findMany({ where: { tenantId: ctx.tenantId, issueDate: day, kind: { in: ['purchase_bill', 'purchase_return'] }, status: { not: 'draft' } }, select: { id: true, kind: true, number: true, supplierRef: true, supplier: true, totalPaise: true, status: true } }),
  ]);
  const snap = await loadSnapshot(ctx);
  const moves = await movements(ctx, { to: day }, snap);
  const KIND: Record<string, string> = { invoice: 'Sale', credit_note: 'Sales return', debit_note: 'Debit note', purchase_bill: 'Purchase', purchase_return: 'Purchase return' };
  const href: Record<string, (id: string) => string> = { invoice: (id) => `/app/m/billing/${id}`, credit_note: (id) => `/app/m/billing/credit-notes/${id}`, debit_note: (id) => `/app/m/billing/debit-notes/${id}`, purchase_bill: (id) => `/app/m/purchase/${id}`, purchase_return: (id) => `/app/m/purchase/${id}` };
  const accName = new Map(snap.accounts.map((a) => [a.id, a.name]));
  const MOVE: Record<string, string> = { receipt: 'Payment received', refund: 'Refund paid', supplier_payment: 'Paid to supplier', expense: 'Expense', income: 'Other income', transfer_out: 'Transfer', charges: 'Transfer charges', journal: 'Journal entry' };
  const rows = [
    ...docs.map((d) => ({ id: d.id, type: KIND[d.kind], number: d.number, party: (d.buyer as { name?: string }).name ?? null, account: null as string | null, amountPaise: d.totalPaise, direction: d.kind === 'credit_note' ? 'out' : 'in', cancelled: d.status === 'cancelled', href: href[d.kind](d.id) })),
    ...bills.map((d) => ({ id: d.id, type: KIND[d.kind], number: d.supplierRef ?? d.number, party: (d.supplier as { name?: string }).name ?? null, account: null as string | null, amountPaise: d.totalPaise, direction: d.kind === 'purchase_return' ? 'in' : 'out', cancelled: d.status === 'cancelled', href: href[d.kind](d.id) })),
    ...moves.filter((m) => m.date.getTime() === day.getTime() && m.kind !== 'opening' && m.kind !== 'transfer_in').map((m) => ({ id: m.id, type: MOVE[m.kind] ?? m.kind, number: m.number, party: m.party, account: accName.get(m.accountId) ?? null, amountPaise: m.inPaise || m.outPaise, direction: m.inPaise ? 'in' : 'out', cancelled: false, href: m.href })),
  ];
  return { date, data: rows };
}

/** The Finance home: balances, this month in and out, what customers owe and what you owe — one read */
export async function overview(ctx: TenantCtx) {
  const snap = await loadSnapshot(ctx);
  const monthStart = `${todayIST().slice(0, 8)}01`;
  const today = todayIST();
  const { profitAndLoss } = await import('./books');
  const accounts = await listAccounts(ctx, snap);
  const flow = await cashFlow(ctx, { from: monthStart, to: today }, snap);
  const pnl = await profitAndLoss(ctx, { from: monthStart, to: today }, snap);
  const recv = snap.sales.filter((d) => ['invoice', 'opening_balance', 'debit_note'].includes(d.kind) && ['issued', 'partially_paid'].includes(d.status));
  const pay = snap.purchases.filter((d) => d.kind === 'purchase_bill' && ['unpaid', 'part_paid'].includes(d.status));
  return {
    accounts,
    cashPaise: accounts.filter((a) => a.kind === 'cash').reduce((s, a) => s + a.balancePaise, 0n),
    bankPaise: accounts.filter((a) => a.kind !== 'cash').reduce((s, a) => s + a.balancePaise, 0n),
    month: { inPaise: flow.inPaise, outPaise: flow.outPaise, profitPaise: pnl.netProfitPaise, expensesPaise: pnl.expenses.totalPaise },
    receivablePaise: recv.reduce((s, d) => s + (d.totalPaise - d.paidPaise), 0n),
    payablePaise: pay.reduce((s, d) => s + (d.totalPaise - d.paidPaise - d.returnedPaise), 0n),
    byMonth: flow.byMonth,
    recentExpenses: snap.expenses.slice(0, 5).map((e) => ({ id: e.id, number: e.number, paidOn: e.paidOn, category: e.category, payee: e.payee, amountPaise: e.amountPaise })),
  };
}
