import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { dateOnly, todayIST } from '../../kernel/gst';
import { DateStr, Paise } from '../../kernel/query';
import { audit } from '../audit/service';
import { ExpenseInput, createExpense, expenseData } from './service';
import { loadSnapshot } from './snapshot';
import { postings } from './books';

// Repeating expenses (rent, salary, internet): nothing is posted on its own. When one falls due it
// shows on Expenses with "Record" — one click makes the expense and moves the date on.
// And a monthly budget per expense category, with what was spent against it.

export const EVERY = ['week', 'month', 'quarter', 'year'] as const;
const Template = ExpenseInput.omit({ paidOn: true });
export const RecurringInput = z.object({
  name: z.string().trim().min(2, 'Give it a name, e.g. Shop rent').max(80),
  every: z.enum(EVERY, { message: 'Choose how often' }),
  nextOn: DateStr,
  endsOn: DateStr.optional().nullable().or(z.literal('').transform(() => null)),
  template: Template,
}).refine((r) => !r.endsOn || r.endsOn >= r.nextOn, { message: 'The end date must be after the next date', path: ['endsOn'] });

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The next date: a week later, or the same day of the month 1, 3 or 12 months on (the 31st becomes the month's last day) */
export function nextDate(from: string, every: (typeof EVERY)[number], day: number) {
  const d = dateOnly(from);
  if (every === 'week') return iso(new Date(d.getTime() + 7 * 86_400_000));
  const months = every === 'month' ? 1 : every === 'quarter' ? 3 : 12;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(day, last))));
}

type Stored = z.infer<typeof Template> & { day?: number };

function view(r: { id: string; name: string; every: string; nextOn: Date; endsOn: Date | null; template: unknown; isActive: boolean; lastExpenseId: string | null; version: number; createdAt: Date }) {
  const today = todayIST();
  const next = iso(r.nextOn);
  const ended = !!r.endsOn && next > iso(r.endsOn);
  const t = r.template as Stored;
  return { ...r, template: t, amountPaise: t.amountPaise, category: t.category, ended, isDue: r.isActive && !ended && next <= today };
}

async function check(ctx: TenantCtx, input: z.infer<typeof RecurringInput>) {
  // The same checks an expense gets (category, account, GST bill details), dated today
  await expenseData(ctx, ExpenseInput.parse({ ...input.template, paidOn: todayIST() }));
}

export async function listRecurring(ctx: TenantCtx) {
  const rows = await db().recurringExpense.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ isActive: 'desc' }, { nextOn: 'asc' }] });
  const data = rows.map(view);
  return { data, due: data.filter((r) => r.isDue).length };
}

export async function createRecurring(ctx: TenantCtx, input: z.infer<typeof RecurringInput>) {
  await check(ctx, input);
  const template: Stored = { ...input.template, day: Number(input.nextOn.slice(8, 10)) };
  const r = await db().recurringExpense.create({ data: { tenantId: ctx.tenantId, name: input.name, every: input.every, nextOn: dateOnly(input.nextOn), endsOn: input.endsOn ? dateOnly(input.endsOn) : null, template, createdBy: ctx.userId } });
  await audit({ action: 'finance.recurring.create', entity: 'recurring_expense', entityId: r.id, after: { name: r.name, every: r.every } });
  return view(r);
}

async function find(ctx: TenantCtx, id: string) {
  const r = await db().recurringExpense.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!r) throw notFound('Repeating expense');
  return r;
}

export async function updateRecurring(ctx: TenantCtx, id: string, input: z.infer<typeof RecurringInput> & { isActive?: boolean }, version: number) {
  const r = await find(ctx, id);
  if (r.version !== version) throw new AppError('CONFLICT', 'Someone else changed this. Reload and try again.');
  await check(ctx, input);
  const template: Stored = { ...input.template, day: Number(input.nextOn.slice(8, 10)) };
  const u = await db().recurringExpense.update({ where: { id }, data: { name: input.name, every: input.every, nextOn: dateOnly(input.nextOn), endsOn: input.endsOn ? dateOnly(input.endsOn) : null, template, isActive: input.isActive ?? r.isActive, version: { increment: 1 } } });
  return view(u);
}

export async function setRecurringActive(ctx: TenantCtx, id: string, isActive: boolean) {
  await find(ctx, id);
  return view(await db().recurringExpense.update({ where: { id }, data: { isActive, version: { increment: 1 } } }));
}

export async function deleteRecurring(ctx: TenantCtx, id: string) {
  const r = await find(ctx, id);
  await db().recurringExpense.delete({ where: { id } });
  await audit({ action: 'finance.recurring.delete', entity: 'recurring_expense', entityId: id, before: { name: r.name } });
}

/** Record the one that is due (or skip it): the expense is made and the date moves on */
export async function runRecurring(ctx: TenantCtx, id: string, mode: 'record' | 'skip', amountPaise?: number) {
  const r = view(await find(ctx, id));
  if (!r.isActive || r.ended) throw new AppError('CONFLICT', 'This repeating expense is stopped.');
  const due = iso(r.nextOn);
  if (due > todayIST()) throw new AppError('CONFLICT', `It is next due on ${due}.`);
  const { day, ...template } = r.template;
  const expense = mode === 'record' ? await createExpense(ctx, ExpenseInput.parse({ ...template, amountPaise: amountPaise ?? template.amountPaise, paidOn: due })) : null;
  const next = nextDate(due, r.every as (typeof EVERY)[number], day ?? Number(due.slice(8, 10)));
  const u = await db().recurringExpense.update({ where: { id }, data: { nextOn: dateOnly(next), lastExpenseId: expense?.id ?? r.lastExpenseId, version: { increment: 1 } } });
  return { recurring: view(u), expense };
}

// ── Budgets ──

export const BudgetInput = z.object({ budgetPaise: Paise.nullable() });

export async function setBudget(ctx: TenantCtx, id: string, budgetPaise: number | null) {
  const c = await db().finCategory.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c) throw notFound('Category');
  if (c.kind !== 'expense') throw new AppError('VALIDATION_FAILED', 'Budgets are for expense categories.');
  return db().finCategory.update({ where: { id }, data: { budgetPaise: budgetPaise ? BigInt(budgetPaise) : null } });
}

/** Each expense category's budget for a month against what was spent (before GST you claim back) */
export async function budgetReport(ctx: TenantCtx, month: string) {
  const from = dateOnly(`${month}-01`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
  const snap = await loadSnapshot(ctx);
  const cats = snap.categories.filter((c) => c.kind === 'expense');
  const all = await postings(ctx, to, snap);
  const spent = new Map<string, bigint>();
  for (const p of all) if (p.date >= from && p.key.startsWith('exp:')) spent.set(p.key.slice(4), (spent.get(p.key.slice(4)) ?? 0n) + p.dr - p.cr);
  const rows = cats.map((c) => ({ id: c.id, name: c.name, budgetPaise: c.budgetPaise, spentPaise: spent.get(c.name) ?? 0n })).filter((r) => r.budgetPaise || r.spentPaise);
  const budgeted = rows.filter((r) => r.budgetPaise);
  return {
    month, data: rows.sort((a, b) => Number((b.budgetPaise ?? 0n) - (a.budgetPaise ?? 0n)) || Number(b.spentPaise - a.spentPaise)),
    budgetPaise: budgeted.reduce((s, r) => s + (r.budgetPaise ?? 0n), 0n),
    spentInBudgetPaise: budgeted.reduce((s, r) => s + r.spentPaise, 0n),
    spentPaise: rows.reduce((s, r) => s + r.spentPaise, 0n),
    over: budgeted.filter((r) => r.spentPaise > (r.budgetPaise ?? 0n)).length,
  };
}
