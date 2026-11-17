import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { bundle, userNames, userPart, type Row } from '../../kernel/bundle';
import type { TenantCtx } from '../../kernel/context';
import { todayIST } from '../../kernel/gst';
import { DateStr } from '../../kernel/query';
import { ensureFinance, routingFrom } from './service';

// Expenses, other income and transfers, each in ONE database round trip (kernel/bundle): the rows,
// the cash and bank accounts they went through, who entered them, and the counts and totals for the
// tabs and cards. Filters run here, so counts describe everything that matches, not just the page.

const big = (v: unknown) => (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v ?? 0))));
const ym = (d: Date) => d.toISOString().slice(0, 7);
const lastMonth = () => { const [y, m] = todayIST().slice(0, 7).split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const inRange = (d: Date, from?: string, to?: string) => (!from || d >= new Date(`${from}T00:00:00.000Z`)) && (!to || d <= new Date(`${to}T00:00:00.000Z`));
function page<T extends { id: string }>(rows: T[], limit: number, cursor?: string) {
  const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
  const data = rows.slice(start, start + limit);
  return { data, nextCursor: start + limit < rows.length ? data[data.length - 1]?.id ?? null : null, total: rows.length };
}
/** Accounts from the bundle; a business that has none gets the two defaults first (once) */
async function accountsOf(ctx: TenantCtx, rows: Row[]) {
  const list = rows.length ? rows : ((await ensureFinance(ctx)) as unknown as Row[]);
  return routingFrom(list as { id: string; kind: string; isActive: boolean; isDefault: boolean; name: string }[]);
}
/** The top category by amount, for a card */
function top(rows: { category: string; amountPaise: bigint }[]) {
  const by = new Map<string, bigint>();
  for (const r of rows) by.set(r.category, (by.get(r.category) ?? 0n) + r.amountPaise);
  const [name, amount] = [...by.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))[0] ?? [null, 0n];
  return { topCategory: name, topCategoryPaise: amount, categories: by.size };
}

// ---------------------------------------------------------------- expenses

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

export async function listExpenses(ctx: TenantCtx, q: z.infer<typeof ExpenseList>) {
  const t = ctx.tenantId;
  const scope = ctx.scope ?? 'own';
  const scoped = scope === 'all' ? Prisma.empty
    : scope === 'branch' ? (ctx.branchIds.length ? Prisma.sql`and (e.branch_id in (${Prisma.join(ctx.branchIds.map((b) => Prisma.sql`${b}::uuid`))}) or e.branch_id is null)` : Prisma.empty)
    : Prisma.sql`and e.created_by = ${ctx.userId}::uuid`;
  const b = await bundle({
    accounts: Prisma.sql`select * from fin_accounts where tenant_id = ${t}::uuid order by created_at`,
    rows: Prisma.sql`select e.*, e.method::text as method from expenses e where e.tenant_id = ${t}::uuid ${scoped} order by e.paid_on desc, e.id desc limit 5000`,
    budgets: Prisma.sql`select name, budget_paise from fin_categories where tenant_id = ${t}::uuid and kind = 'expense' and budget_paise is not null`,
    ...userPart(t),
  });
  const r = await accountsOf(ctx, b.accounts);
  const name = new Map(r.all.map((a) => [a.id, a.name]));
  const kind = new Map(r.all.map((a) => [a.id, a.kind]));
  const user = userNames(b);
  type Exp = Row & { id: string; category: string; amountPaise: bigint; paidOn: Date; accountId: string };
  const all: Exp[] = b.rows.map((e) => {
    const accountId = r.idFor(e.accountId, e.method);
    return { ...e, id: e.id as string, category: e.category as string, amountPaise: big(e.amountPaise), paidOn: e.paidOn as Date, accountId, account: name.get(accountId) ?? null, accountKind: kind.get(accountId) ?? null, createdByName: e.createdBy ? user.get(e.createdBy) ?? null : null };
  });

  // Cards that do not change with the filters: this month, last month, budget
  const month = todayIST().slice(0, 7);
  const thisMonth = all.filter((e) => ym(e.paidOn) === month);
  const prevMonth = all.filter((e) => ym(e.paidOn) === lastMonth());
  const sum = (rows: Exp[]) => rows.reduce((a, e) => a + e.amountPaise, 0n);
  const budget = b.budgets.reduce((a, c) => a + big(c.budgetPaise), 0n);

  // Everything that matches the filters; the GST tabs are counted on these
  const s = q.q?.toLowerCase();
  const matching = all.filter((e) =>
    (!q.category || e.category === q.category) && (!q.accountId || e.accountId === q.accountId) && inRange(e.paidOn, q.from, q.to)
    && (!s || [e.payee, e.notes, e.number, e.billNo, e.reference, e.category, e.vendorGstin].some((v) => typeof v === 'string' && v.toLowerCase().includes(s))));
  const withGst = matching.filter((e) => e.gstPaise != null);
  const counts = { all: matching.length, gst: withGst.length, nogst: matching.length - withGst.length };
  const rows = q.gst === 'true' ? withGst : q.gst === 'false' ? matching.filter((e) => e.gstPaise == null) : matching;
  const totalPaise = sum(rows);
  const gstPaise = rows.reduce((a, e) => a + big(e.gstPaise), 0n);
  return {
    ...page(rows, q.limit, q.cursor), counts, totalPaise, gstPaise,
    sums: { total: totalPaise, gst: gstPaise, month: sum(thisMonth), monthCount: thisMonth.length, lastMonth: sum(prevMonth), budget, cash: sum(rows.filter((e) => e.accountKind === 'cash')), ...top(rows) },
  };
}

// ---------------------------------------------------------------- other income

export const IncomeList = z.object({ from: DateStr.optional(), to: DateStr.optional(), category: z.string().max(60).optional(), accountId: z.string().uuid().optional() });

export async function listIncomes(ctx: TenantCtx, q: z.infer<typeof IncomeList>) {
  const t = ctx.tenantId;
  const b = await bundle({
    accounts: Prisma.sql`select * from fin_accounts where tenant_id = ${t}::uuid order by created_at`,
    rows: Prisma.sql`select * from incomes where tenant_id = ${t}::uuid order by received_on desc, id desc limit 3000`,
    ...userPart(t),
  });
  const r = await accountsOf(ctx, b.accounts);
  const name = new Map(r.all.map((a) => [a.id, a.name]));
  const user = userNames(b);
  const all = b.rows.map((i) => ({ ...i, id: i.id as string, accountId: i.accountId as string, category: i.category as string, amountPaise: big(i.amountPaise), receivedOn: i.receivedOn as Date, account: name.get(i.accountId) ?? null, createdByName: i.createdBy ? user.get(i.createdBy) ?? null : null }));
  const month = todayIST().slice(0, 7);
  const thisMonth = all.filter((i) => ym(i.receivedOn) === month);
  const data = all.filter((i) => (!q.category || i.category === q.category) && (!q.accountId || i.accountId === q.accountId) && inRange(i.receivedOn, q.from, q.to));
  const sum = (rows: typeof all) => rows.reduce((a, i) => a + i.amountPaise, 0n);
  return { data, sums: { total: sum(data), count: data.length, month: sum(thisMonth), monthCount: thisMonth.length, lastMonth: sum(all.filter((i) => ym(i.receivedOn) === lastMonth())), ...top(data) } };
}

// ---------------------------------------------------------------- transfers between accounts

export async function listTransfers(ctx: TenantCtx, q: { from?: string; to?: string; accountId?: string }) {
  const t = ctx.tenantId;
  const b = await bundle({
    accounts: Prisma.sql`select * from fin_accounts where tenant_id = ${t}::uuid order by created_at`,
    rows: Prisma.sql`select * from fin_transfers where tenant_id = ${t}::uuid order by transfer_on desc, id desc limit 2000`,
    ...userPart(t),
  });
  const r = await accountsOf(ctx, b.accounts);
  const name = new Map(r.all.map((a) => [a.id, a.name]));
  const kind = new Map(r.all.map((a) => [a.id, a.kind]));
  const user = userNames(b);
  const all = b.rows.map((x) => ({
    ...x, id: x.id as string, fromAccountId: x.fromAccountId as string, toAccountId: x.toAccountId as string, amountPaise: big(x.amountPaise), chargesPaise: big(x.chargesPaise), transferOn: x.transferOn as Date,
    fromAccount: name.get(x.fromAccountId) ?? '—', toAccount: name.get(x.toAccountId) ?? '—', fromKind: kind.get(x.fromAccountId) ?? null, toKind: kind.get(x.toAccountId) ?? null,
    createdByName: x.createdBy ? user.get(x.createdBy) ?? null : null,
  }));
  const month = todayIST().slice(0, 7);
  const data = all.filter((x) => (!q.accountId || x.fromAccountId === q.accountId || x.toAccountId === q.accountId) && inRange(x.transferOn, q.from, q.to));
  const thisMonth = all.filter((x) => ym(x.transferOn) === month);
  return {
    data,
    sums: {
      total: data.reduce((a, x) => a + x.amountPaise, 0n), count: data.length, charges: data.reduce((a, x) => a + x.chargesPaise, 0n),
      month: thisMonth.reduce((a, x) => a + x.amountPaise, 0n), monthCount: thisMonth.length,
      deposited: data.filter((x) => x.fromKind === 'cash' && x.toKind !== 'cash').reduce((a, x) => a + x.amountPaise, 0n),
      withdrawn: data.filter((x) => x.fromKind !== 'cash' && x.toKind === 'cash').reduce((a, x) => a + x.amountPaise, 0n),
    },
  };
}
