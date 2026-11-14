import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { dateOnly, todayIST } from '../../kernel/gst';
import { allocateNumber } from '../../kernel/sequences';
import { DateStr, Paise } from '../../kernel/query';
import { withDefaults } from '../../contracts/workspace';
import { audit } from '../audit/service';
import { routingFrom } from './service';
import { loadSnapshot, type Snap } from './snapshot';

// The books: double entry, made from what the business already records.
// Every invoice, bill, payment, expense, income, transfer and opening balance becomes balanced
// postings on a chart of accounts; journal entries add what no document records (a loan taken,
// capital put in, depreciation, GST paid). Stock is valued from the stock ledger at the date asked,
// so purchases − (closing − opening stock) is the cost of what was sold.
//
// Ledger keys:
//   cash:<account id>  each cash, bank, UPI or card account          (asset)
//   receivables        what customers owe, all customers together     (asset)
//   stock              stock on hand, valued from the stock ledger    (asset, computed)
//   input_gst          GST paid on bills and expenses, to claim back  (asset)
//   payables           what you owe suppliers                         (liability)
//   output_gst         GST charged on sales, to pay                   (liability)
//   rcm_gst            GST you pay yourself on reverse-charge bills   (liability)
//   capital            the owner's money in the business              (equity)
//   opening            opening balances brought in                    (equity)
//   sales, purchases, round_off, exp:<category>, inc:<category>, led:<ledger id>

export type Group = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export const GROUPS: Group[] = ['asset', 'liability', 'equity', 'income', 'expense'];

export interface Ledger {
  key: string
  code: string
  name: string
  group: Group
  section: string
  /** Made by the app (cannot be renamed or removed) */
  system: boolean
  /** Can be used on a journal entry */
  journal: boolean
  isActive: boolean
  id?: string
  description?: string | null
  version?: number
}

export interface Posting {
  date: Date
  key: string
  dr: bigint
  cr: bigint
  type: string
  sourceId: string
  number: string | null
  party: string | null
  narration: string
  href: string | null
}

const SYSTEM: Omit<Ledger, 'isActive'>[] = [
  { key: 'receivables', code: '1200', name: 'Customers (receivables)', group: 'asset', section: 'Receivables', system: true, journal: false },
  { key: 'stock', code: '1300', name: 'Stock on hand', group: 'asset', section: 'Stock', system: true, journal: false },
  { key: 'input_gst', code: '1400', name: 'GST input credit', group: 'asset', section: 'Taxes', system: true, journal: true },
  { key: 'payables', code: '2100', name: 'Suppliers (payables)', group: 'liability', section: 'Payables', system: true, journal: false },
  { key: 'output_gst', code: '2200', name: 'GST payable on sales', group: 'liability', section: 'Taxes', system: true, journal: true },
  { key: 'rcm_gst', code: '2210', name: 'GST payable on reverse charge', group: 'liability', section: 'Taxes', system: true, journal: true },
  { key: 'capital', code: '3100', name: "Owner's capital", group: 'equity', section: 'Capital', system: true, journal: true },
  { key: 'opening', code: '3200', name: 'Opening balances', group: 'equity', section: 'Capital', system: true, journal: true },
  { key: 'sales', code: '4100', name: 'Sales', group: 'income', section: 'Sales', system: true, journal: false },
  { key: 'round_off', code: '4900', name: 'Round off', group: 'income', section: 'Other income', system: true, journal: false },
  { key: 'purchases', code: '5100', name: 'Purchases', group: 'expense', section: 'Cost of goods', system: true, journal: false },
  { key: 'stock_change', code: '5200', name: 'Change in stock', group: 'expense', section: 'Cost of goods', system: true, journal: false },
];

const SECTION_OF_CUSTOM: Record<Group, string> = { asset: 'Other assets', liability: 'Loans & other liabilities', equity: 'Capital', income: 'Other income', expense: 'Expenses' };
const DEBIT_NORMAL = (g: Group) => g === 'asset' || g === 'expense';

/** The chart of accounts: system ledgers, each cash/bank account, each category, and your own ledgers */
export async function chartOfAccounts(ctx: TenantCtx, given?: Snap): Promise<Ledger[]> {
  const snap = given ?? (await loadSnapshot(ctx));
  const expenseCats = snap.categories.filter((c) => c.kind === 'expense');
  const incomeCats = snap.categories.filter((c) => c.kind === 'income');
  const own = snap.ledgers;
  const list: Ledger[] = [
    ...snap.accounts.map((a, i) => ({ key: `cash:${a.id}`, code: String(1100 + i), name: a.name, group: 'asset' as Group, section: 'Cash & bank', system: true, journal: a.isActive, isActive: a.isActive })),
    ...SYSTEM.map((l) => ({ ...l, isActive: true })),
    ...incomeCats.map((c, i) => ({ key: `inc:${c.name}`, code: String(4200 + i), name: c.name, group: 'income' as Group, section: 'Other income', system: false, journal: true, isActive: true })),
    ...expenseCats.map((c, i) => ({ key: `exp:${c.name}`, code: String(6100 + i), name: c.name, group: 'expense' as Group, section: 'Expenses', system: false, journal: true, isActive: true })),
  ];
  const base: Record<Group, number> = { asset: 1500, liability: 2300, equity: 3300, income: 4500, expense: 6500 };
  const seq: Record<Group, number> = { asset: 0, liability: 0, equity: 0, income: 0, expense: 0 };
  for (const l of own) {
    const g = l.group as Group;
    list.push({ key: `led:${l.id}`, id: l.id, code: l.code || String(base[g] + seq[g]++), name: l.name, group: g, section: SECTION_OF_CUSTOM[g], system: false, journal: l.isActive, isActive: l.isActive, description: l.description, version: l.version });
  }
  return list;
}


/** Every posting up to a date. Debits equal credits for each source. */
export async function postings(ctx: TenantCtx, to?: Date, given?: Snap): Promise<Posting[]> {
  const snap = given ?? (await loadSnapshot(ctx));
  const ok = (d: Date) => !to || d <= to;
  // Section 16 CGST Act: only a registered business outside composition claims input tax credit
  const claimsItc = !!snap.tenant.gstin && !withDefaults(snap.tenant.preferences, snap.tenant.profile).taxes.composition;
  const r = routingFrom(snap.accounts);
  const sales = snap.sales.filter((d) => ok(d.issueDate));
  const purchases = snap.purchases.filter((d) => ok(d.issueDate));
  const receipts = snap.payments.filter((p) => ok(p.paidOn));
  const supplierPays = snap.supplierPayments.filter((p) => ok(p.paidOn));
  const expenses = snap.expenses.filter((e) => ok(e.paidOn));
  const incomes = snap.incomes.filter((i) => ok(i.receivedOn));
  const transfers = snap.transfers.filter((x) => ok(x.transferOn));
  const journals = snap.journals.filter((j) => ok(j.journalOn));

  const out: Posting[] = [];
  type Src = Omit<Posting, 'key' | 'dr' | 'cr'>;
  /** One balanced set: signed amounts, positive = debit. Any difference goes to round off. */
  const post = (src: Src, lines: [string, bigint][]) => {
    const diff = lines.reduce((s, [, v]) => s + v, 0n);
    if (diff !== 0n) lines.push(['round_off', -diff]);
    for (const [key, v] of lines) if (v !== 0n) out.push({ ...src, key, dr: v > 0n ? v : 0n, cr: v < 0n ? -v : 0n });
  };

  for (const a of r.all) {
    if (a.openingPaise === 0n) continue;
    post({ date: a.openingDate ?? a.createdAt, type: 'opening', sourceId: a.id, number: null, party: null, narration: `Opening balance of ${a.name}`, href: `/app/m/finance/accounts/${a.id}` }, [[`cash:${a.id}`, a.openingPaise], ['opening', -a.openingPaise]]);
  }
  const DOC = { invoice: 'Sale', debit_note: 'Debit note', credit_note: 'Sales return', opening_balance: 'Customer opening balance' } as const;
  const docHref = (kind: string, id: string) => (kind === 'credit_note' ? `/app/m/billing/credit-notes/${id}` : kind === 'debit_note' ? `/app/m/billing/debit-notes/${id}` : `/app/m/billing/${id}`);
  for (const d of sales) {
    const tax = d.cgstPaise + d.sgstPaise + d.igstPaise;
    const src: Src = { date: d.issueDate, type: d.kind, sourceId: d.id, number: d.number, party: d.party, narration: DOC[d.kind as keyof typeof DOC], href: docHref(d.kind, d.id) };
    if (d.kind === 'opening_balance') post(src, [['receivables', d.totalPaise], ['opening', -d.totalPaise]]);
    else {
      const s = d.kind === 'credit_note' ? -1n : 1n;
      post(src, [['receivables', s * d.totalPaise], ['sales', -s * d.taxablePaise], ['output_gst', -s * tax]]);
    }
  }
  for (const d of purchases) {
    const tax = d.cgstPaise + d.sgstPaise + d.igstPaise;
    const s = d.kind === 'purchase_return' ? -1n : 1n;
    const lines: [string, bigint][] = [['payables', -s * d.totalPaise]];
    if (claimsItc) lines.push(['purchases', s * d.taxablePaise], ['input_gst', s * tax]);
    else lines.push(['purchases', s * (d.taxablePaise + tax)]);
    // Reverse charge (Section 9(3)): the supplier is paid the value; the GST is owed to the government
    if (d.reverseCharge) lines.push(['rcm_gst', -s * tax]);
    post({ date: d.issueDate, type: d.kind, sourceId: d.id, number: d.supplierRef ?? d.number, party: d.party, narration: d.kind === 'purchase_return' ? 'Purchase return' : 'Purchase', href: `/app/m/purchase/${d.id}` }, lines);
  }
  for (const p of receipts) {
    post({ date: p.paidOn, type: 'receipt', sourceId: p.id, number: p.number, party: null, narration: p.amountPaise < 0n ? 'Refund to customer' : 'Payment received', href: '/app/m/billing/payments' }, [[`cash:${r.idFor(p.accountId, p.method)}`, p.amountPaise], ['receivables', -p.amountPaise]]);
  }
  for (const p of supplierPays) {
    post({ date: p.paidOn, type: 'supplier_payment', sourceId: p.id, number: p.number, party: null, narration: p.amountPaise < 0n ? 'Refund from supplier' : 'Paid to supplier', href: p.documentId ? `/app/m/purchase/${p.documentId}` : '/app/m/purchase/payments' }, [['payables', p.amountPaise], [`cash:${r.idFor(p.accountId, p.method)}`, -p.amountPaise]]);
  }
  for (const e of expenses) {
    const gst = claimsItc ? e.gstPaise ?? 0n : 0n;
    post({ date: e.paidOn, type: 'expense', sourceId: e.id, number: e.number, party: e.payee, narration: e.category, href: `/app/m/finance/expenses/${e.id}` }, [[`exp:${e.category}`, e.amountPaise - gst], ['input_gst', gst], [`cash:${r.idFor(e.accountId, e.method)}`, -e.amountPaise]]);
  }
  for (const i of incomes) {
    post({ date: i.receivedOn, type: 'income', sourceId: i.id, number: i.number, party: i.payer, narration: i.category, href: '/app/m/finance/income' }, [[`cash:${i.accountId}`, i.amountPaise], [`inc:${i.category}`, -i.amountPaise]]);
  }
  for (const x of transfers) {
    post({ date: x.transferOn, type: 'transfer', sourceId: x.id, number: x.number, party: null, narration: 'Transfer between accounts', href: '/app/m/finance/transfers' }, [[`cash:${x.toAccountId}`, x.amountPaise], ['exp:Bank charges', x.chargesPaise], [`cash:${x.fromAccountId}`, -(x.amountPaise + x.chargesPaise)]]);
  }
  for (const j of journals) {
    for (const l of j.lines) out.push({ date: j.journalOn, key: l.ledgerKey, dr: l.debitPaise, cr: l.creditPaise, type: 'journal', sourceId: j.id, number: j.number, party: null, narration: l.description || j.narration, href: `/app/m/finance/journals/${j.id}` });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Stock value on a date from the stock ledger, and how much of it came in as opening stock */
function stockOn(snap: Snap, date: Date) {
  const upTo = snap.stock.filter((x) => x.date <= date);
  return { valuePaise: upTo.reduce((s, x) => s + x.valuePaise, 0n), openingPaise: upTo.filter((x) => x.opening).reduce((s, x) => s + x.valuePaise, 0n) };
}

const dayBefore = (d: Date) => new Date(d.getTime() - 86_400_000);
const nameOf = (chart: Ledger[], key: string) => chart.find((l) => l.key === key)?.name ?? key.replace(/^(exp|inc):/, '');
function groupOf(chart: Ledger[], key: string): Group {
  const l = chart.find((x) => x.key === key);
  if (l) return l.group;
  return key.startsWith('exp:') ? 'expense' : key.startsWith('inc:') ? 'income' : 'asset';
}

/** Balances by ledger: balance-sheet ledgers from the start, profit-and-loss ledgers within the period */
async function balances(ctx: TenantCtx, from: Date, to: Date, given?: Snap) {
  const snap = given ?? (await loadSnapshot(ctx));
  const chart = await chartOfAccounts(ctx, snap);
  const all = await postings(ctx, to, snap);
  const stockTo = stockOn(snap, to);
  const stockBefore = stockOn(snap, dayBefore(from));
  const bal = new Map<string, bigint>();
  let profitBefore = 0n;
  for (const p of all) {
    const g = groupOf(chart, p.key);
    const v = p.dr - p.cr;
    if ((g === 'income' || g === 'expense') && p.date < from) { profitBefore -= v; continue; }
    bal.set(p.key, (bal.get(p.key) ?? 0n) + v);
  }
  // Stock: on hand is an asset; opening stock brought in is capital; the rest of the change is profit
  bal.set('stock', stockTo.valuePaise);
  bal.set('opening', (bal.get('opening') ?? 0n) - stockTo.openingPaise);
  const earlierStockGain = stockBefore.valuePaise - stockBefore.openingPaise;
  profitBefore += earlierStockGain;
  const periodStockGain = stockTo.valuePaise - stockTo.openingPaise - earlierStockGain;
  bal.set('stock_change', (bal.get('stock_change') ?? 0n) - periodStockGain);
  return { snap, chart, bal, profitBefore, stock: { openingPaise: stockBefore.valuePaise + (stockTo.openingPaise - stockBefore.openingPaise), closingPaise: stockTo.valuePaise } };
}

function fyStart(date: string, fyStartMonth: number) {
  const [y, m] = date.split('-').map(Number);
  const year = m >= fyStartMonth ? y : y - 1;
  return `${year}-${String(fyStartMonth).padStart(2, '0')}-01`;
}

export const Period = z.object({ from: DateStr, to: DateStr }).refine((p) => p.from <= p.to, { message: 'From must be on or before To', path: ['from'] });
export const AsOf = z.object({ date: DateStr.optional() });

/** Trial balance for a period: every ledger's debit or credit balance; the two totals match */
export async function trialBalance(ctx: TenantCtx, p: { from: string; to: string }) {
  const { chart, bal, profitBefore } = await balances(ctx, dateOnly(p.from), dateOnly(p.to));
  const keys = new Set([...chart.map((l) => l.key), ...bal.keys()]);
  const rows = [...keys].map((key) => {
    const l = chart.find((x) => x.key === key);
    const v = bal.get(key) ?? 0n;
    return { key, code: l?.code ?? '', name: l?.name ?? nameOf(chart, key), group: groupOf(chart, key), section: l?.section ?? '', debitPaise: v > 0n ? v : 0n, creditPaise: v < 0n ? -v : 0n };
  }).filter((r) => r.debitPaise || r.creditPaise);
  if (profitBefore !== 0n) rows.push({ key: 'profit_bf', code: '3900', name: 'Profit & loss brought forward', group: 'equity', section: 'Capital', debitPaise: profitBefore < 0n ? -profitBefore : 0n, creditPaise: profitBefore > 0n ? profitBefore : 0n });
  const order = (g: Group) => GROUPS.indexOf(g);
  rows.sort((a, b) => order(a.group) - order(b.group) || a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
  return { from: p.from, to: p.to, data: rows, debitPaise: rows.reduce((s, r) => s + r.debitPaise, 0n), creditPaise: rows.reduce((s, r) => s + r.creditPaise, 0n) };
}

/** Profit and loss for a period, from the books */
export async function profitAndLoss(ctx: TenantCtx, p: { from: string; to: string }, given?: Snap) {
  const from = dateOnly(p.from);
  const to = dateOnly(p.to);
  const { snap, chart, bal, stock } = await balances(ctx, from, to, given);
  const inPeriod = (await postings(ctx, to, snap)).filter((x) => x.date >= from);
  const credit = (key: string) => -(bal.get(key) ?? 0n);
  const sumBy = (key: string, type: string) => inPeriod.filter((x) => x.key === key && x.type === type).reduce((s, x) => s + x.cr - x.dr, 0n);
  const sales = { invoicesPaise: sumBy('sales', 'invoice'), debitNotesPaise: sumBy('sales', 'debit_note'), returnsPaise: -sumBy('sales', 'credit_note'), netPaise: credit('sales') };
  const bought = -sumBy('purchases', 'purchase_bill');
  const boughtBack = sumBy('purchases', 'purchase_return');
  const purchasesNet = bal.get('purchases') ?? 0n;
  const cogs = purchasesNet + (bal.get('stock_change') ?? 0n);
  const cost = { openingStockPaise: stock.openingPaise, purchasesPaise: bought, returnsPaise: boughtBack, otherPaise: purchasesNet - bought + boughtBack, closingStockPaise: stock.closingPaise, netPaise: cogs };
  const rowsOf = (g: Group, skip: string[]) => [...bal].filter(([k, v]) => v !== 0n && !skip.includes(k) && groupOf(chart, k) === g).map(([k, v]) => ({ key: k, name: nameOf(chart, k), amountPaise: g === 'income' ? -v : v })).sort((a, b) => Number(b.amountPaise - a.amountPaise));
  const otherIncome = rowsOf('income', ['sales']);
  const expenses = rowsOf('expense', ['purchases', 'stock_change']);
  const incomeTotal = otherIncome.reduce((s, r) => s + r.amountPaise, 0n);
  const expenseTotal = expenses.reduce((s, r) => s + r.amountPaise, 0n);
  const gross = sales.netPaise - cogs;
  return {
    from: p.from, to: p.to, sales, cost, grossProfitPaise: gross,
    otherIncome: { rows: otherIncome, totalPaise: incomeTotal },
    expenses: { rows: expenses, totalPaise: expenseTotal },
    netProfitPaise: gross + incomeTotal - expenseTotal,
  };
}

/** Balance sheet on a date: what the business owns, owes, and the owner's share */
export async function balanceSheet(ctx: TenantCtx, date: string) {
  const snap = await loadSnapshot(ctx);
  const start = fyStart(date, snap.tenant.fyStartMonth);
  const { chart, bal, profitBefore } = await balances(ctx, dateOnly(start), dateOnly(date), snap);
  const yearProfit = -[...bal].filter(([k]) => ['income', 'expense'].includes(groupOf(chart, k))).reduce((s, [, v]) => s + v, 0n);
  type Row = { key: string; name: string; section: string; amountPaise: bigint };
  const assets: Row[] = [];
  const liabilities: Row[] = [];
  const equity: Row[] = [];
  // GST: what is owed on sales and reverse charge, less the credit, shown once
  const gst = (bal.get('output_gst') ?? 0n) + (bal.get('rcm_gst') ?? 0n) + (bal.get('input_gst') ?? 0n);
  if (gst < 0n) liabilities.push({ key: 'gst', name: 'GST payable (after input credit)', section: 'Taxes', amountPaise: -gst });
  if (gst > 0n) assets.push({ key: 'gst', name: 'GST credit to carry forward', section: 'Taxes', amountPaise: gst });
  for (const [key, v] of bal) {
    if (v === 0n || ['output_gst', 'rcm_gst', 'input_gst'].includes(key)) continue;
    const g = groupOf(chart, key);
    if (g === 'income' || g === 'expense') continue;
    const l = chart.find((x) => x.key === key);
    const name = l?.name ?? nameOf(chart, key);
    const section = l?.section ?? '';
    if (g === 'equity') { equity.push({ key, name, section, amountPaise: -v }); continue; }
    // A ledger on the "wrong" side moves across: customers who paid ahead are a liability, an overdrawn card too
    if (v > 0n) assets.push({ key, section, amountPaise: v, name: key === 'payables' ? 'Advances paid to suppliers' : name });
    else liabilities.push({ key, section, amountPaise: -v, name: key === 'receivables' ? 'Advances from customers' : name });
  }
  equity.push({ key: 'profit_bf', name: 'Profit of earlier years', section: 'Capital', amountPaise: profitBefore }, { key: 'profit', name: 'Profit this year', section: 'Capital', amountPaise: yearProfit });
  const total = (rows: Row[]) => rows.reduce((s, r) => s + r.amountPaise, 0n);
  const order = ['Cash & bank', 'Receivables', 'Stock', 'Taxes', 'Other assets', 'Payables', 'Loans & other liabilities', 'Capital'];
  const sort = (rows: Row[]) => rows.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section) || a.name.localeCompare(b.name));
  return {
    date, fyStart: start,
    assets: sort(assets), liabilities: sort(liabilities), equity: equity.filter((e) => e.amountPaise !== 0n || e.key === 'profit'),
    assetsPaise: total(assets), liabilitiesPaise: total(liabilities), equityPaise: total(equity),
  };
}

/** One ledger's entries with the running balance, like a party ledger */
export async function ledgerStatement(ctx: TenantCtx, key: string, p: { from: string; to: string }) {
  const snap = await loadSnapshot(ctx);
  const chart = await chartOfAccounts(ctx, snap);
  const ledger = chart.find((l) => l.key === key) ?? (key.startsWith('exp:') || key.startsWith('inc:') ? { key, code: '', name: key.slice(4), group: groupOf(chart, key), section: '', system: false, journal: false, isActive: false } : null);
  if (!ledger) throw notFound('Ledger');
  const from = dateOnly(p.from);
  const all = (await postings(ctx, dateOnly(p.to), snap)).filter((x) => x.key === key);
  const sign = DEBIT_NORMAL(ledger.group) ? 1n : -1n;
  const pl = ledger.group === 'income' || ledger.group === 'expense';
  // Income and expense ledgers start each period at nothing; the rest carry their balance
  const before = pl ? [] : all.filter((x) => x.date < from);
  const broughtForward = before.reduce((s, x) => s + sign * (x.dr - x.cr), 0n);
  let running = broughtForward;
  const data = all.filter((x) => x.date >= from).map((x, i) => {
    running += sign * (x.dr - x.cr);
    return { id: `${x.type}-${x.sourceId}-${i}`, date: x.date, type: x.type, number: x.number, party: x.party, narration: x.narration, debitPaise: x.dr, creditPaise: x.cr, balancePaise: running, href: x.href };
  });
  return {
    ledger, from: p.from, to: p.to, broughtForwardPaise: broughtForward, closingPaise: running,
    debitPaise: data.reduce((s, x) => s + x.debitPaise, 0n), creditPaise: data.reduce((s, x) => s + x.creditPaise, 0n),
    stockNote: key === 'stock' ? 'Stock is valued from the stock ledger. Open Inventory for item-wise value.' : null,
    data,
  };
}

/** The chart with each ledger's balance today (profit-and-loss ledgers: this financial year) */
export async function chartWithBalances(ctx: TenantCtx) {
  const snap = await loadSnapshot(ctx);
  const today = todayIST();
  const { chart, bal } = await balances(ctx, dateOnly(fyStart(today, snap.tenant.fyStartMonth)), dateOnly(today), snap);
  const used = new Set(snap.journals.flatMap((j) => j.lines.map((l) => l.ledgerKey)));
  return chart.map((l) => {
    const v = bal.get(l.key) ?? 0n;
    return { ...l, balancePaise: DEBIT_NORMAL(l.group) ? v : -v, usedInJournals: used.has(l.key) };
  });
}

// ── Your own ledgers ──

export const LedgerInput = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(80),
  group: z.enum(['asset', 'liability', 'equity', 'income', 'expense'], { message: 'Choose what kind of ledger it is' }),
  code: z.string().trim().max(10).regex(/^[0-9A-Za-z-]*$/, 'Letters, numbers and - only').optional().nullable().or(z.literal('').transform(() => null)),
  description: z.string().trim().max(300).optional().nullable(),
});
export const LedgerPatch = LedgerInput.partial().extend({ isActive: z.boolean().optional(), version: z.number().int() });

async function nameFree(ctx: TenantCtx, name: string, exceptId?: string) {
  const chart = await chartOfAccounts(ctx);
  if (chart.some((l) => l.name.toLowerCase() === name.toLowerCase() && l.id !== exceptId)) throw new AppError('VALIDATION_FAILED', 'A ledger with this name already exists.', { fields: { name: 'Already used' } });
}

export async function createLedger(ctx: TenantCtx, input: z.infer<typeof LedgerInput>) {
  await nameFree(ctx, input.name);
  const l = await db().finLedger.create({ data: { ...input, tenantId: ctx.tenantId } });
  await audit({ action: 'finance.ledger.create', entity: 'fin_ledger', entityId: l.id, after: { name: l.name, group: l.group } });
  return l;
}

export async function updateLedger(ctx: TenantCtx, id: string, input: z.infer<typeof LedgerPatch>) {
  const l = await db().finLedger.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!l) throw notFound('Ledger');
  if (l.version !== input.version) throw new AppError('CONFLICT', 'Someone else changed this ledger. Reload and try again.');
  if (input.name && input.name !== l.name) await nameFree(ctx, input.name, id);
  const used = await db().journalLine.count({ where: { tenantId: ctx.tenantId, ledgerKey: `led:${id}` } });
  if (input.group && input.group !== l.group && used) throw new AppError('CONFLICT', 'Journal entries use this ledger, so its kind cannot change.', { fields: { group: 'In use' } });
  const { version: _v, ...data } = input;
  return db().finLedger.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
}

export async function deleteLedger(ctx: TenantCtx, id: string) {
  const l = await db().finLedger.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!l) throw notFound('Ledger');
  const used = await db().journalLine.count({ where: { tenantId: ctx.tenantId, ledgerKey: `led:${id}` } });
  if (used) throw new AppError('CONFLICT', `${used} journal line${used === 1 ? ' uses' : 's use'} this ledger. Close it instead.`);
  await db().finLedger.delete({ where: { id } });
  await audit({ action: 'finance.ledger.delete', entity: 'fin_ledger', entityId: id, before: { name: l.name } });
}

// ── Journal entries ──

const JournalLineInput = z.object({
  ledgerKey: z.string().min(1, 'Choose the ledger').max(80),
  debitPaise: Paise.default(0),
  creditPaise: Paise.default(0),
  description: z.string().trim().max(200).optional().nullable(),
});
export const JournalInput = z.object({
  journalOn: DateStr,
  narration: z.string().trim().min(3, 'Say what this entry is for').max(500),
  reference: z.string().trim().max(60).optional().nullable(),
  lines: z.array(JournalLineInput).min(2, 'Add at least two lines').max(50),
});

async function journalData(ctx: TenantCtx, b: z.infer<typeof JournalInput>) {
  if (dateOnly(b.journalOn) > dateOnly(todayIST())) throw new AppError('VALIDATION_FAILED', "The date can't be in the future.", { fields: { journalOn: 'In the future' } });
  const chart = await chartOfAccounts(ctx);
  const fields: Record<string, string> = {};
  b.lines.forEach((l, i) => {
    const ledger = chart.find((x) => x.key === l.ledgerKey);
    if (!ledger) fields[`lines.${i}.ledgerKey`] = 'Choose the ledger';
    else if (!ledger.journal) fields[`lines.${i}.ledgerKey`] = `${ledger.name} is posted by its own documents`;
    if ((l.debitPaise > 0) === (l.creditPaise > 0)) fields[`lines.${i}.debitPaise`] = 'Enter a debit or a credit';
  });
  if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', Object.values(fields)[0], { fields });
  const dr = b.lines.reduce((s, l) => s + l.debitPaise, 0);
  const cr = b.lines.reduce((s, l) => s + l.creditPaise, 0);
  if (dr !== cr) throw new AppError('VALIDATION_FAILED', `Debits (₹${(dr / 100).toFixed(2)}) and credits (₹${(cr / 100).toFixed(2)}) must be equal.`, { fields: { lines: 'Not balanced' } });
  return {
    journalOn: dateOnly(b.journalOn), narration: b.narration, reference: b.reference || null, totalPaise: BigInt(dr),
    lines: b.lines.map((l, position) => ({ tenantId: ctx.tenantId, position, ledgerKey: l.ledgerKey, debitPaise: BigInt(l.debitPaise), creditPaise: BigInt(l.creditPaise), description: l.description || null })),
  };
}

export async function createJournal(ctx: TenantCtx, b: z.infer<typeof JournalInput>) {
  const { lines, ...data } = await journalData(ctx, b);
  const t = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { fyStartMonth: true } });
  const { number } = await allocateNumber(ctx.tenantId, 'journal', t.fyStartMonth, data.journalOn);
  const j = await db().journal.create({ data: { ...data, number, tenantId: ctx.tenantId, createdBy: ctx.userId, lines: { create: lines } } });
  await audit({ action: 'finance.journal.create', entity: 'journal', entityId: j.id, after: { number, totalPaise: data.totalPaise } });
  return getJournal(ctx, j.id);
}

export async function updateJournal(ctx: TenantCtx, id: string, b: z.infer<typeof JournalInput>, version: number) {
  const j = await db().journal.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!j) throw notFound('Journal entry');
  if (j.version !== version) throw new AppError('CONFLICT', 'Someone else changed this entry. Reload and try again.');
  const { lines, ...data } = await journalData(ctx, b);
  await db().journalLine.deleteMany({ where: { journalId: id } });
  await db().journal.update({ where: { id }, data: { ...data, version: { increment: 1 }, lines: { create: lines } } });
  await audit({ action: 'finance.journal.update', entity: 'journal', entityId: id, after: { totalPaise: data.totalPaise } });
  return getJournal(ctx, id);
}

export async function deleteJournal(ctx: TenantCtx, id: string) {
  const j = await db().journal.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!j) throw notFound('Journal entry');
  await db().journal.delete({ where: { id } });
  await audit({ action: 'finance.journal.delete', entity: 'journal', entityId: id, before: { number: j.number, totalPaise: j.totalPaise } });
}

export async function getJournal(ctx: TenantCtx, id: string) {
  const [j, chart] = await Promise.all([db().journal.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: { orderBy: { position: 'asc' } } } }), chartOfAccounts(ctx)]);
  if (!j) throw notFound('Journal entry');
  return { ...j, lines: j.lines.map((l) => ({ ...l, ledger: nameOf(chart, l.ledgerKey) })) };
}

export async function listJournals(ctx: TenantCtx, q: { from?: string; to?: string; ledgerKey?: string }) {
  const [rows, chart] = await Promise.all([
    db().journal.findMany({
      where: { AND: [{ tenantId: ctx.tenantId }, q.from || q.to ? { journalOn: { gte: q.from ? dateOnly(q.from) : undefined, lte: q.to ? dateOnly(q.to) : undefined } } : {}, q.ledgerKey ? { lines: { some: { ledgerKey: q.ledgerKey } } } : {}] },
      include: { lines: { orderBy: { position: 'asc' } } },
      orderBy: [{ journalOn: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    }),
    chartOfAccounts(ctx),
  ]);
  return { data: rows.map((j) => ({ ...j, lines: j.lines.map((l) => ({ ...l, ledger: nameOf(chart, l.ledgerKey) })) })) };
}

// ── GST summary (what GSTR-3B asks): tax on sales, input credit, and what is left to pay ──

export async function gstSummary(ctx: TenantCtx, p: { from: string; to: string }) {
  const snap = await loadSnapshot(ctx);
  const from = dateOnly(p.from);
  const to = dateOnly(p.to);
  const inRange = (d: Date) => d >= from && d <= to;
  const t = snap.tenant;
  const taxes = withDefaults(t.preferences, t.profile).taxes;
  const claimsItc = !!t.gstin && !taxes.composition;
  type Tax = { taxablePaise: bigint; cgstPaise: bigint; sgstPaise: bigint; igstPaise: bigint };
  const zero = (): Tax => ({ taxablePaise: 0n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n });
  const sumOf = (rows: { taxablePaise: bigint; cgstPaise: bigint; sgstPaise: bigint; igstPaise: bigint }[], sign = 1n): Tax => rows.reduce((a, x) => ({ taxablePaise: a.taxablePaise + sign * x.taxablePaise, cgstPaise: a.cgstPaise + sign * x.cgstPaise, sgstPaise: a.sgstPaise + sign * x.sgstPaise, igstPaise: a.igstPaise + sign * x.igstPaise }), zero());
  const add = (...xs: Tax[]) => sumOf(xs);
  const total = (x: Tax) => x.cgstPaise + x.sgstPaise + x.igstPaise;
  const sales = snap.sales.filter((d) => inRange(d.issueDate));
  const buys = snap.purchases.filter((d) => inRange(d.issueDate));
  const inv = sales.filter((d) => d.kind === 'invoice');
  const cn = sales.filter((d) => d.kind === 'credit_note');
  const dn = sales.filter((d) => d.kind === 'debit_note');
  const bills = buys.filter((d) => d.kind === 'purchase_bill');
  const rets = buys.filter((d) => d.kind === 'purchase_return');
  const exp = snap.expenses.filter((e) => inRange(e.paidOn) && (e.gstPaise ?? 0n) > 0n);
  // An expense bill from the same state is CGST + SGST, from another state IGST
  const expSplit = exp.reduce((a, e) => {
    const g = e.gstPaise ?? 0n;
    const same = !t.billingStateCode || !e.vendorGstin || e.vendorGstin.slice(0, 2) === t.billingStateCode;
    const half = g / 2n;
    return { taxablePaise: a.taxablePaise + (e.taxablePaise ?? 0n), cgstPaise: a.cgstPaise + (same ? half : 0n), sgstPaise: a.sgstPaise + (same ? g - half : 0n), igstPaise: a.igstPaise + (same ? 0n : g) };
  }, zero());

  const output = { invoices: sumOf(inv), debitNotes: sumOf(dn), creditNotes: sumOf(cn, -1n) };
  const outputTotal = add(output.invoices, output.debitNotes, output.creditNotes);
  const rcm = add(sumOf(bills.filter((d) => d.reverseCharge)), sumOf(rets.filter((d) => d.reverseCharge), -1n));
  const input = claimsItc ? { bills: sumOf(bills), returns: sumOf(rets, -1n), expenses: expSplit } : { bills: zero(), returns: zero(), expenses: zero() };
  const inputTotal = add(input.bills, input.returns, input.expenses);
  // Journal lines on the GST ledgers: GST paid to the government (Dr GST payable) or credit set off
  const paid = snap.journals.filter((j) => inRange(j.journalOn)).flatMap((j) => j.lines).reduce((a, l) => {
    if (l.ledgerKey === 'input_gst') return a + l.creditPaise - l.debitPaise;
    if (l.ledgerKey === 'output_gst' || l.ledgerKey === 'rcm_gst') return a + l.debitPaise - l.creditPaise;
    return a;
  }, 0n);
  const owed = total(outputTotal) + total(rcm) - total(inputTotal);
  return {
    from: p.from, to: p.to, claimsItc, composition: !!taxes.composition, registered: !!t.gstin,
    counts: { invoices: inv.length, creditNotes: cn.length, debitNotes: dn.length, bills: bills.length, returns: rets.length, expenses: exp.length },
    output, outputTotal, rcm, input, inputTotal,
    netPaise: owed, paidPaise: paid, leftPaise: owed - paid,
  };
}
