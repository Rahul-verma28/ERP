import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import { bundle, userNames, userPart, type Row } from '../../kernel/bundle';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { DateStr, Paise, assertVersion, scopeSql, scopeUsers } from '../../kernel/query';
import { todayIST } from '../../kernel/gst';
import { optionalText, zPhone } from '../../kernel/zodRules';
import { withDefaults } from '../../contracts/workspace';
import { getRolePermissions } from '../access/service';
import { getEntitlements } from '../subscription/entitlements';
import { audit } from '../audit/service';
import { ensureFinance, createExpense, createTransfer, EXPENSE_CATEGORIES } from '../finance/service';
import { defaultLocation } from '../inventory/engine';
import { checkCreditLimit, createDocument, getDocument, recordPayment, type DocInput } from '../billing/service';
import { createCreditNote, creditableLines, NOTE_REASONS, refundCreditNote } from '../billing/creditNotes';

// POS (counter billing, BIL-08). A counter sale is an ordinary GST invoice: the same numbers,
// stock leaving the counter's warehouse, receipts into the counter's cash and bank accounts, so
// Sales, Inventory, Finance and Reports see it with nothing extra. What POS adds is the counter,
// the shift (opening cash to counted cash), cash put in or taken out, bills on hold and returns.

const uuids = (ids: string[]) => Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`));
const n = (v: unknown) => Number(v ?? 0);
const WALK_IN = 'Walk-in customer';

async function can(ctx: TenantCtx, key: string) {
  return (await getRolePermissions(ctx.roleId)).has(key);
}
async function moduleOn(ctx: TenantCtx, key: 'finance' | 'inventory' | 'crm') {
  return (await getEntitlements(ctx.tenantId)).modules[key]?.status === 'active';
}
/** Counters this person may use: in their branches (none set = every branch) */
function counterReach(ctx: TenantCtx) {
  return ctx.scope === 'branch' && ctx.branchIds.length ? Prisma.sql`and (c.branch_id in (${uuids(ctx.branchIds)}) or c.branch_id is null)` : Prisma.empty;
}

// ── Counters (setup) ──

export const CounterInput = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(60),
  branchId: z.string().uuid().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  cashAccountId: z.string().uuid().optional().nullable(),
  bankAccountId: z.string().uuid().optional().nullable(),
  paper: z.enum(['80mm', '58mm', 'a4']).default('80mm'),
  receiptNote: z.string().trim().max(300).optional().nullable(),
  /** Percent, 0–100; empty = no limit */
  maxDiscountPct: z.number().min(0).max(100).optional().nullable(),
  allowCredit: z.boolean().default(true),
  needCustomer: z.boolean().default(false),
  isActive: z.boolean().default(true),
  version: z.number().int().optional(),
});

/** Everything the setup page needs: the counters, and the branches, warehouses and accounts to pick */
export async function setup(ctx: TenantCtx) {
  const t = ctx.tenantId;
  await ensureFinance(ctx);
  const today = todayIST();
  const b = await bundle({
    counters: Prisma.sql`
      select c.*, s.id as shift_id, s.number as shift_number, s.opened_by as shift_by, s.opened_at as shift_at,
        (select count(*)::int from pos_shifts x where x.counter_id = c.id) as shifts,
        (select coalesce(sum(d.total_paise), 0) from pos_shifts x join sales_documents d on d.source_type = 'pos' and d.source_id = x.id and d.status <> 'cancelled'
           where x.counter_id = c.id and d.issue_date = ${today}::date) as today_paise
      from pos_counters c left join pos_shifts s on s.counter_id = c.id and s.status = 'open'
      where c.tenant_id = ${t}::uuid order by c.is_active desc, c.name`,
    branches: Prisma.sql`select id, name, code from branches where tenant_id = ${t}::uuid order by is_default desc, name`,
    locations: Prisma.sql`select id, name, is_default, is_active from stock_locations where tenant_id = ${t}::uuid order by is_default desc, name`,
    accounts: Prisma.sql`select id, name, kind, is_default, is_active from fin_accounts where tenant_id = ${t}::uuid order by created_at`,
    ...userPart(t),
  });
  const user = userNames(b);
  return {
    counters: b.counters.map((c) => ({
      ...shapeCounter(c), shifts: c.shifts as number, todayPaise: c.todayPaise as bigint,
      openShift: c.shiftId ? { id: c.shiftId as string, number: c.shiftNumber as string, by: user.get(c.shiftBy) ?? 'Someone', at: c.shiftAt as Date } : null,
    })),
    branches: b.branches, locations: b.locations, accounts: b.accounts,
    financeOn: await moduleOn(ctx, 'finance'),
  };
}

function shapeCounter(c: Row) {
  return {
    id: c.id as string, name: c.name as string, branchId: c.branchId ?? null, locationId: c.locationId ?? null,
    cashAccountId: c.cashAccountId ?? null, bankAccountId: c.bankAccountId ?? null, paper: c.paper as '80mm' | '58mm' | 'a4',
    receiptNote: c.receiptNote ?? null, maxDiscountPct: c.maxDiscountBp == null ? null : n(c.maxDiscountBp) / 100,
    allowCredit: !!c.allowCredit, needCustomer: !!c.needCustomer, isActive: !!c.isActive, version: c.version as number,
  };
}

export async function saveCounter(ctx: TenantCtx, id: string | null, b: z.infer<typeof CounterInput>) {
  const t = ctx.tenantId;
  const accounts = await ensureFinance(ctx);
  const field = (f: string, m: string) => new AppError('VALIDATION_FAILED', m, { fields: { [f]: m } });
  if (b.branchId && !(await db().branch.findFirst({ where: { id: b.branchId, tenantId: t } }))) throw field('branchId', 'Choose a branch');
  if (b.locationId && !(await db().stockLocation.findFirst({ where: { id: b.locationId, tenantId: t, isActive: true } }))) throw field('locationId', 'Choose an open warehouse');
  const acc = (aid: string | null | undefined) => (aid ? accounts.find((a) => a.id === aid && a.isActive) : undefined);
  if (b.cashAccountId && acc(b.cashAccountId)?.kind !== 'cash') throw field('cashAccountId', 'Choose a cash account');
  if (b.bankAccountId && (!acc(b.bankAccountId) || acc(b.bankAccountId)!.kind === 'cash')) throw field('bankAccountId', 'Choose a bank, UPI or card account');
  const clash = await db().posCounter.findFirst({ where: { tenantId: t, name: { equals: b.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw field('name', 'Another counter has this name');
  const data = {
    name: b.name, branchId: b.branchId ?? null, locationId: b.locationId ?? null, cashAccountId: b.cashAccountId ?? null, bankAccountId: b.bankAccountId ?? null,
    paper: b.paper, receiptNote: b.receiptNote || null, maxDiscountBp: b.maxDiscountPct == null ? null : Math.round(b.maxDiscountPct * 100),
    allowCredit: b.allowCredit, needCustomer: b.needCustomer, isActive: b.isActive,
  };
  if (!id) {
    const c = await db().posCounter.create({ data: { ...data, tenantId: t, createdBy: ctx.userId } });
    await audit({ action: 'billing.pos.counter_create', entity: 'pos_counter', entityId: c.id, after: { name: c.name } });
    return shapeCounter(c);
  }
  const c = await db().posCounter.findFirst({ where: { id, tenantId: t } });
  if (!c) throw notFound('Counter');
  assertVersion(c.version, b.version, 'counter');
  if (!b.isActive && (await db().posShift.count({ where: { counterId: id, status: 'open' } }))) throw new AppError('CONFLICT', 'This counter has an open shift. Close the shift before turning the counter off.');
  const saved = await db().posCounter.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  await audit({ action: 'billing.pos.counter_edit', entity: 'pos_counter', entityId: id, before: { name: c.name }, after: { name: saved.name, isActive: saved.isActive } });
  return shapeCounter(saved);
}

// ── The counter screen ──

/** What the counter screen opens with: my open shift, the counters I can open, and the bill rules */
export async function register(ctx: TenantCtx) {
  const t = ctx.tenantId;
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: t }, select: { name: true, gstin: true, preferences: true, profile: true } });
  const prefs = withDefaults(tenant.preferences, tenant.profile);
  const b = await bundle({
    mine: Prisma.sql`select s.* from pos_shifts s where s.tenant_id = ${t}::uuid and s.opened_by = ${ctx.userId}::uuid and s.status = 'open' limit 1`,
    counters: Prisma.sql`
      select c.*, s.id as shift_id, s.opened_by as shift_by,
        (select x.counted_cash_paise from pos_shifts x where x.counter_id = c.id and x.status = 'closed' order by x.closed_at desc limit 1) as last_counted_paise,
        (select x.deposit_paise from pos_shifts x where x.counter_id = c.id and x.status = 'closed' order by x.closed_at desc limit 1) as last_deposit_paise
      from pos_counters c left join pos_shifts s on s.counter_id = c.id and s.status = 'open'
      where c.tenant_id = ${t}::uuid and c.is_active ${counterReach(ctx)} order by c.name`,
    ...userPart(t),
  });
  const user = userNames(b);
  const mine = b.mine[0];
  const [approve, edit, refund, sell] = await Promise.all([can(ctx, 'billing.pos.approve'), can(ctx, 'billing.pos.edit'), can(ctx, 'billing.refund.create'), can(ctx, 'billing.pos.create')]);
  return {
    shift: mine ? await shiftSummary(ctx, mine.id as string) : null,
    counters: b.counters.map((c) => ({
      ...shapeCounter(c), busyBy: c.shiftId && c.shiftBy !== ctx.userId ? user.get(c.shiftBy) ?? 'Someone' : null,
      // What is left in the drawer from the last shift: a suggestion for the opening cash
      floatPaise: c.lastCountedPaise == null ? 0n : (c.lastCountedPaise as bigint) - ((c.lastDepositPaise as bigint | null) ?? 0n),
    })),
    rules: {
      business: tenant.name, noTax: !tenant.gstin || prefs.taxes.composition, pricesIncludeTax: prefs.taxes.pricesIncludeTax,
      upiId: prefs.payments.upiId || null, expenseCategories: EXPENSE_CATEGORIES,
    },
    can: { sell, approve, setup: edit, refund },
    financeOn: await moduleOn(ctx, 'finance'),
  };
}

/** Items for the counter: price, tax, barcode, and stock at the counter's warehouse */
export async function counterItems(ctx: TenantCtx, counterId: string) {
  const counter = await findCounter(ctx, counterId);
  const location = counter.locationId ?? (await defaultLocation(ctx)).id;
  const b = await bundle({
    items: Prisma.sql`
      select i.id, i.name, i.sku, i.barcode, i.unit, i.type::text as type, i.price_paise, i.gst_rate_bp, i.hsn_sac, i.image_url, i.track_stock, i.tracking,
        i.alt_unit, i.alt_factor, c.name as category, coalesce(sb.quantity, 0)::float as stock
      from items i left join item_categories c on c.id = i.category_id
        left join stock_balances sb on sb.item_id = i.id and sb.location_id = ${location}::uuid
      where i.tenant_id = ${ctx.tenantId}::uuid and i.is_active order by i.name limit 5000`,
  });
  return {
    locationId: location,
    data: b.items.map((i) => ({
      id: i.id as string, name: i.name as string, sku: i.sku ?? null, barcode: i.barcode ?? null, unit: i.unit as string, type: i.type as string,
      pricePaise: i.pricePaise as bigint, gstRateBp: i.gstRateBp as number, hsnSac: i.hsnSac ?? null, imageUrl: i.imageUrl ?? null,
      trackStock: !!i.trackStock && i.type === 'product', tracking: i.tracking as string, category: i.category ?? null, stock: n(i.stock),
    })),
  };
}

/** Serial numbers of an item on the counter's shelf */
export async function counterSerials(ctx: TenantCtx, counterId: string, itemId: string) {
  const counter = await findCounter(ctx, counterId);
  const location = counter.locationId ?? (await defaultLocation(ctx)).id;
  const rows = await db().stockSerial.findMany({ where: { tenantId: ctx.tenantId, itemId, locationId: location, status: 'in_stock' }, orderBy: { serial: 'asc' }, take: 500, select: { serial: true } });
  return { data: rows.map((r) => r.serial) };
}

async function findCounter(ctx: TenantCtx, id: string) {
  const c = await db().posCounter.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c) throw notFound('Counter');
  if (ctx.scope === 'branch' && ctx.branchIds.length && c.branchId && !ctx.branchIds.includes(c.branchId)) throw notFound('Counter');
  return c;
}

// ── Customers at the counter ──

export async function findCustomers(ctx: TenantCtx, q: string) {
  const text = q.trim();
  const digits = text.replace(/\D/g, '');
  const rows = await db().contact.findMany({
    where: {
      tenantId: ctx.tenantId, type: 'customer', isActive: true,
      OR: [{ name: { contains: text, mode: 'insensitive' } }, { companyName: { contains: text, mode: 'insensitive' } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []), { gstin: text.toUpperCase() }],
    },
    orderBy: { name: 'asc' }, take: 12,
    select: { id: true, name: true, companyName: true, phone: true, gstin: true, priceListId: true, creditLimitPaise: true },
  });
  return { data: rows };
}

export const QuickCustomer = z.object({ name: z.string().trim().min(2, 'Enter the name').max(160), phone: zPhone });

/** A customer added at the counter with just a name and phone; an existing phone is reused */
export async function quickCustomer(ctx: TenantCtx, b: z.infer<typeof QuickCustomer>) {
  const found = await db().contact.findFirst({ where: { tenantId: ctx.tenantId, type: 'customer', phone: b.phone } });
  if (found) return { id: found.id, name: found.companyName || found.name, phone: found.phone, gstin: found.gstin, existing: true };
  const c = await db().contact.create({ data: { tenantId: ctx.tenantId, type: 'customer', name: b.name, phone: b.phone, branchId: ctx.branchIds[0] ?? null, createdBy: ctx.userId, ownerId: ctx.userId, leadSource: 'Walk-in' } });
  await audit({ action: 'crm.contact.create', entity: 'contact', entityId: c.id, after: { name: c.name, from: 'pos' } });
  return { id: c.id, name: c.name, phone: c.phone, gstin: null, existing: false };
}

/** What a customer pays per item: their price list, else the item's price */
async function standardPrices(contactId: string | null, items: { id: string; pricePaise: bigint }[]) {
  const contact = contactId ? await db().contact.findUnique({ where: { id: contactId }, select: { priceListId: true } }) : null;
  const list = contact?.priceListId ? await db().priceList.findUnique({ where: { id: contact.priceListId }, include: { items: { select: { itemId: true, pricePaise: true } } } }) : null;
  const exact = new Map(list?.items.map((i) => [i.itemId, Number(i.pricePaise)]) ?? []);
  return new Map(items.map((i) => [i.id, exact.get(i.id) ?? Math.round((Number(i.pricePaise) * (10_000 - (list?.discountBp ?? 0))) / 10_000)]));
}

// ── Shifts ──

export const OpenInput = z.object({ counterId: z.string().uuid(), openingCashPaise: Paise.default(0) });

export async function openShift(ctx: TenantCtx, b: z.infer<typeof OpenInput>) {
  const counter = await findCounter(ctx, b.counterId);
  if (!counter.isActive) throw new AppError('CONFLICT', 'This counter is turned off.');
  const mine = await db().posShift.findFirst({ where: { tenantId: ctx.tenantId, openedBy: ctx.userId, status: 'open' }, include: { counter: { select: { name: true } } } });
  if (mine) throw new AppError('CONFLICT', `You already have a shift open at ${mine.counter.name}. Close it first.`);
  const busy = await db().posShift.findFirst({ where: { counterId: counter.id, status: 'open' } });
  if (busy) throw new AppError('CONFLICT', 'Someone else has a shift open at this counter.');
  // Numbers run SH-00001 per business; the lock keeps two openings from taking the same one
  await db().$queryRaw`select 1 as ok from pg_advisory_xact_lock(hashtext(${`pos-shift:${ctx.tenantId}`}))`;
  const count = await db().posShift.count({ where: { tenantId: ctx.tenantId } });
  const shift = await db().posShift.create({ data: { tenantId: ctx.tenantId, counterId: counter.id, number: `SH-${String(count + 1).padStart(5, '0')}`, openedBy: ctx.userId, openingCashPaise: BigInt(b.openingCashPaise) } });
  await audit({ action: 'billing.pos.shift_open', entity: 'pos_shift', entityId: shift.id, after: { number: shift.number, counter: counter.name, openingCashPaise: b.openingCashPaise } });
  return shiftSummary(ctx, shift.id);
}

/** The shift, which must be open, and that this person may work on: their own, or any with approve */
async function workShift(ctx: TenantCtx, id: string, needOpen = true) {
  const s = await db().posShift.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { counter: true } });
  if (!s) throw notFound('Shift');
  if (s.openedBy !== ctx.userId && !(await can(ctx, 'billing.pos.approve'))) throw new AppError('PERMISSION_DENIED', 'This is someone else\'s shift.');
  if (needOpen && s.status !== 'open') throw new AppError('CONFLICT', 'This shift is closed. Open a new shift to keep selling.');
  return s;
}

/** The shift with its money: sales, what came in by each method, refunds, cash moves and cash expected */
export async function shiftSummary(ctx: TenantCtx, id: string) {
  const t = ctx.tenantId;
  const b = await bundle({
    shift: Prisma.sql`select s.*, c.name as counter_name, c.paper, c.receipt_note, c.max_discount_bp, c.allow_credit, c.need_customer, c.location_id, c.branch_id
      from pos_shifts s join pos_counters c on c.id = s.counter_id where s.id = ${id}::uuid and s.tenant_id = ${t}::uuid`,
    sales: Prisma.sql`select d.id, d.number, d.status::text as status, d.total_paise, d.paid_paise, d.issued_at, d.buyer->>'name' as customer, d.contact_id,
        (select count(*)::int from sales_document_lines l where l.document_id = d.id) as lines
      from sales_documents d where d.tenant_id = ${t}::uuid and d.source_type = 'pos' and d.source_id = ${id}::uuid order by d.issued_at desc nulls last`,
    pays: Prisma.sql`select p.method::text as method, sum(case when p.amount_paise > 0 then p.amount_paise else 0 end) as in_paise,
        sum(case when p.amount_paise < 0 then -p.amount_paise else 0 end) as out_paise, count(*)::int as count
      from payments_received p where p.tenant_id = ${t}::uuid and p.pos_shift_id = ${id}::uuid group by p.method`,
    returns: Prisma.sql`select n.id, n.number, n.total_paise, n.issue_date, n.source_number, n.buyer->>'name' as customer
      from sales_documents n where n.tenant_id = ${t}::uuid and n.kind = 'credit_note' and n.status <> 'cancelled'
        and exists (select 1 from payments_received p where p.document_id = n.id and p.pos_shift_id = ${id}::uuid)
      order by n.created_at desc`,
    moves: Prisma.sql`select m.* from pos_cash_moves m where m.shift_id = ${id}::uuid order by m.created_at desc`,
    items: Prisma.sql`select l.description as name, sum(l.quantity)::float as qty, sum(l.total_paise) as total_paise
      from sales_document_lines l join sales_documents d on d.id = l.document_id
      where d.tenant_id = ${t}::uuid and d.source_type = 'pos' and d.source_id = ${id}::uuid and d.status <> 'cancelled'
      group by l.description order by sum(l.total_paise) desc limit 10`,
    ...userPart(t),
  });
  const s = b.shift[0];
  if (!s) throw notFound('Shift');
  if (s.openedBy !== ctx.userId && scopeUsers(ctx) && !scopeUsers(ctx)!.includes(s.openedBy) && !(await can(ctx, 'billing.pos.approve'))) throw notFound('Shift');
  const user = userNames(b);
  const live = b.sales.filter((d) => d.status !== 'cancelled');
  const methods = Object.fromEntries(b.pays.map((p) => [p.method, { inPaise: p.inPaise as bigint, outPaise: p.outPaise as bigint, count: p.count as number }])) as Record<string, { inPaise: bigint; outPaise: bigint; count: number }>;
  const cash = methods.cash ?? { inPaise: 0n, outPaise: 0n, count: 0 };
  const movesIn = b.moves.filter((m) => m.kind === 'in').reduce((x, m) => x + (m.amountPaise as bigint), 0n);
  const movesOut = b.moves.filter((m) => m.kind === 'out').reduce((x, m) => x + (m.amountPaise as bigint), 0n);
  const opening = s.openingCashPaise as bigint;
  const expected = opening + cash.inPaise - cash.outPaise + movesIn - movesOut;
  const salesPaise = live.reduce((x, d) => x + (d.totalPaise as bigint), 0n);
  const duePaise = live.reduce((x, d) => x + (d.totalPaise as bigint) - (d.paidPaise as bigint), 0n);
  return {
    id: s.id as string, number: s.number as string, status: s.status as 'open' | 'closed',
    counter: { id: s.counterId as string, name: s.counterName as string, paper: s.paper as string, receiptNote: s.receiptNote ?? null, maxDiscountPct: s.maxDiscountBp == null ? null : n(s.maxDiscountBp) / 100, allowCredit: !!s.allowCredit, needCustomer: !!s.needCustomer, branchId: s.branchId ?? null },
    openedBy: s.openedBy as string, openedByName: user.get(s.openedBy) ?? 'Someone', openedAt: s.openedAt as Date,
    closedByName: s.closedBy ? user.get(s.closedBy) ?? 'Someone' : null, closedAt: s.closedAt ?? null,
    openingCashPaise: opening,
    totals: {
      bills: live.length, cancelled: b.sales.length - live.length, salesPaise, duePaise,
      returnsPaise: b.returns.reduce((x, r) => x + (r.totalPaise as bigint), 0n), returns: b.returns.length,
      averagePaise: live.length ? salesPaise / BigInt(live.length) : 0n,
    },
    methods,
    cash: { openingPaise: opening, salesPaise: cash.inPaise, refundsPaise: cash.outPaise, inPaise: movesIn, outPaise: movesOut, expectedPaise: s.status === 'closed' ? (s.expectedCashPaise as bigint) : expected },
    counted: s.status === 'closed' ? { countedPaise: s.countedCashPaise as bigint, differencePaise: s.differencePaise as bigint, denominations: s.denominations ?? null, note: s.closingNote ?? null, depositPaise: s.depositPaise as bigint, depositTransferId: s.depositTransferId ?? null } : null,
    sales: b.sales.map((d) => ({ id: d.id as string, number: d.number as string, status: d.status as string, totalPaise: d.totalPaise as bigint, duePaise: (d.totalPaise as bigint) - (d.paidPaise as bigint), at: d.issuedAt ?? null, customer: d.customer ?? WALK_IN, contactId: d.contactId ?? null, lines: d.lines as number })),
    returns: b.returns.map((r) => ({ id: r.id as string, number: r.number as string, totalPaise: r.totalPaise as bigint, against: r.sourceNumber ?? null, customer: r.customer ?? WALK_IN })),
    moves: b.moves.map((m) => ({ id: m.id as string, kind: m.kind as 'in' | 'out', amountPaise: m.amountPaise as bigint, reason: m.reason as string, note: m.note ?? null, expenseId: m.expenseId ?? null, at: m.createdAt as Date, by: user.get(m.createdBy) ?? null })),
    topItems: b.items.map((i) => ({ name: i.name as string, qty: n(i.qty), totalPaise: i.totalPaise as bigint })),
    version: s.version as number,
  };
}

export const CashMoveInput = z.object({
  kind: z.enum(['in', 'out']),
  amountPaise: Paise.refine((v) => v > 0, 'Enter the amount'),
  reason: z.enum(['float', 'change', 'expense', 'owner', 'other']),
  note: z.string().trim().max(300).optional().nullable(),
  /** Paid out for a shop expense: its head in Finance */
  category: z.string().trim().max(60).optional().nullable(),
}).superRefine((v, c) => {
  if (v.kind === 'in' && ['expense', 'owner'].includes(v.reason)) c.addIssue({ code: 'custom', path: ['reason'], message: 'Choose why cash was put in' });
  if (v.kind === 'out' && v.reason === 'float') c.addIssue({ code: 'custom', path: ['reason'], message: 'Choose why cash was taken out' });
  if (v.reason === 'other' && !v.note) c.addIssue({ code: 'custom', path: ['note'], message: 'Write what it was for' });
  if (v.reason === 'expense' && !v.category) c.addIssue({ code: 'custom', path: ['category'], message: 'Choose the expense head' });
});

/** Cash put into or taken out of the drawer. A shop expense paid from it is also an expense in Finance. */
export async function cashMove(ctx: TenantCtx, shiftId: string, b: z.infer<typeof CashMoveInput>) {
  const s = await workShift(ctx, shiftId);
  if (b.kind === 'out') {
    const now = await shiftSummary(ctx, shiftId);
    if (BigInt(b.amountPaise) > now.cash.expectedPaise) throw new AppError('VALIDATION_FAILED', `Only ₹${(Number(now.cash.expectedPaise) / 100).toFixed(2)} should be in the drawer.`, { fields: { amountPaise: 'More than the cash in the drawer' } });
  }
  let expenseId: string | null = null;
  if (b.reason === 'expense' && (await moduleOn(ctx, 'finance'))) {
    const cashAccount = s.counter.cashAccountId ?? (await ensureFinance(ctx)).find((a) => a.kind === 'cash' && a.isActive)?.id;
    if (cashAccount) {
      const e = await createExpense(ctx, { category: b.category!, amountPaise: b.amountPaise, paidOn: todayIST(), accountId: cashAccount, payee: null, notes: [b.note, `Paid from ${s.counter.name}, shift ${s.number}`].filter(Boolean).join(' · '), gstBill: false, branchId: s.counter.branchId });
      expenseId = e.id;
    }
  }
  const m = await db().posCashMove.create({ data: { tenantId: ctx.tenantId, shiftId, kind: b.kind, amountPaise: BigInt(b.amountPaise), reason: b.reason, note: b.note || (b.reason === 'expense' ? b.category : null) || null, expenseId, createdBy: ctx.userId } });
  await audit({ action: 'billing.pos.cash_move', entity: 'pos_shift', entityId: shiftId, after: { kind: b.kind, amountPaise: b.amountPaise, reason: b.reason, expenseId } });
  return { id: m.id, expenseId, shift: await shiftSummary(ctx, shiftId) };
}

const NOTES = ['2000', '500', '200', '100', '50', '20', '10', '5', '2', '1'] as const;
export const CloseInput = z.object({
  countedCashPaise: Paise,
  /** Notes and coins counted, by face value */
  denominations: z.record(z.enum(NOTES), z.number().int().min(0).max(100_000)).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  /** Cash sent to the bank now (a transfer in Finance) */
  depositPaise: Paise.default(0),
  depositAccountId: z.string().uuid().optional().nullable(),
  version: z.number().int(),
});

/** Close the shift: the counted cash against what should be there; a short or extra needs a word */
export async function closeShift(ctx: TenantCtx, id: string, b: z.infer<typeof CloseInput>) {
  const s = await workShift(ctx, id);
  assertVersion(s.version, b.version, 'shift');
  if (b.denominations) {
    const total = Object.entries(b.denominations).reduce((x, [k, v]) => x + Number(k) * 100 * v, 0);
    if (total !== b.countedCashPaise) throw new AppError('VALIDATION_FAILED', 'The notes and coins do not add up to the cash counted.', { fields: { countedCashPaise: 'Does not match the notes counted' } });
  }
  const now = await shiftSummary(ctx, id);
  const expected = now.cash.expectedPaise;
  const difference = BigInt(b.countedCashPaise) - expected;
  if (difference !== 0n && !b.note) throw new AppError('VALIDATION_FAILED', `The drawer is ${difference < 0n ? 'short' : 'over'} by ₹${(Math.abs(Number(difference)) / 100).toFixed(2)}. Write what happened.`, { fields: { note: 'Say why the cash does not match' } });
  if (b.depositPaise > b.countedCashPaise) throw new AppError('VALIDATION_FAILED', 'You cannot send more to the bank than the cash counted.', { fields: { depositPaise: 'More than the cash counted' } });
  let transferId: string | null = null;
  if (b.depositPaise > 0) {
    if (!(await moduleOn(ctx, 'finance'))) throw new AppError('VALIDATION_FAILED', 'Sending cash to the bank needs the Finance module. Leave it at 0.', { fields: { depositPaise: 'Needs Finance' } });
    const accounts = await ensureFinance(ctx);
    const from = s.counter.cashAccountId ?? accounts.find((a) => a.kind === 'cash' && a.isActive)?.id;
    const to = b.depositAccountId ?? s.counter.bankAccountId ?? accounts.find((a) => a.isDefault && a.isActive && a.kind !== 'cash')?.id;
    if (!from || !to) throw new AppError('VALIDATION_FAILED', 'Choose the bank account the cash goes to.', { fields: { depositAccountId: 'Choose the account' } });
    const tr = await createTransfer(ctx, { transferOn: todayIST(), fromAccountId: from, toAccountId: to, amountPaise: b.depositPaise, chargesPaise: 0, reference: s.number, notes: `Cash from ${s.counter.name}, shift ${s.number}` });
    transferId = tr.id;
  }
  const { count } = await db().posShift.updateMany({
    where: { id, version: s.version, status: 'open' },
    data: {
      status: 'closed', closedBy: ctx.userId, closedAt: new Date(), expectedCashPaise: expected, countedCashPaise: BigInt(b.countedCashPaise), differencePaise: difference,
      denominations: (b.denominations ?? Prisma.JsonNull) as Prisma.InputJsonValue, closingNote: b.note || null, depositPaise: BigInt(b.depositPaise), depositTransferId: transferId, version: { increment: 1 },
    },
  });
  if (!count) throw new AppError('VERSION_CONFLICT', 'This shift was changed by someone else. Reload and try again.');
  // Bills still on hold stay with the counter for the next shift
  await audit({ action: 'billing.pos.shift_close', entity: 'pos_shift', entityId: id, after: { number: s.number, expectedPaise: expected, countedPaise: b.countedCashPaise, differencePaise: difference, depositPaise: b.depositPaise } });
  return shiftSummary(ctx, id);
}

// ── Selling ──

const Tender = z.object({ method: z.enum(['cash', 'upi', 'card', 'other']), amountPaise: Paise.refine((v) => v > 0, 'Enter the amount'), reference: z.string().trim().max(100).optional().nullable() });

export const SaleInput = z.object({
  shiftId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  /** A walk-in customer's name and phone, printed on the bill */
  customer: z.object({ name: optionalText(z.string().trim().max(160)), phone: optionalText(zPhone) }).optional().nullable(),
  lines: z.array(z.object({
    itemId: z.string().uuid(),
    quantity: z.number().positive('Quantity must be more than 0').max(1e6),
    unitPricePaise: Paise,
    discountPaise: Paise.default(0),
    serials: z.array(z.string().trim().min(1).max(40)).max(1000).optional(),
    batchId: z.string().uuid().optional().nullable(),
  })).min(1, 'Add at least one item').max(200),
  /** Off the whole bill, in the same terms as the prices (with GST when prices include it) */
  billDiscountPaise: Paise.default(0),
  tenders: z.array(Tender).max(6).default([]),
  notes: z.string().trim().max(500).optional().nullable(),
  /** The bill was on hold: it goes once the sale is made */
  heldId: z.string().uuid().optional().nullable(),
});

/** Make the sale: a GST invoice from the counter's warehouse, paid by each tender into the counter's accounts */
export async function sell(ctx: TenantCtx, b: z.infer<typeof SaleInput>) {
  const s = await workShift(ctx, b.shiftId);
  const counter = s.counter;
  if (!counter.isActive) throw new AppError('CONFLICT', 'This counter is turned off.');
  const name = b.customer?.name?.trim() || null;
  const phone = b.customer?.phone || null;
  if (counter.needCustomer && !b.contactId && (!name || !phone)) throw new AppError('VALIDATION_FAILED', 'This counter needs the customer\'s name and phone on every bill.', { fields: { customer: 'Enter the name and phone' } });

  const items = await db().item.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(b.lines.map((l) => l.itemId))] } }, select: { id: true, name: true, pricePaise: true, gstRateBp: true, isActive: true, hsnSac: true, unit: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  b.lines.forEach((l, i) => {
    const it = byId.get(l.itemId);
    if (!it || !it.isActive) throw new AppError('VALIDATION_FAILED', 'This item is no longer sold.', { fields: { [`lines.${i}.itemId`]: 'Not sold any more' } });
    if (l.discountPaise > Math.round(l.quantity * l.unitPricePaise)) throw new AppError('VALIDATION_FAILED', `The discount on ${it.name} is more than the line.`, { fields: { [`lines.${i}.discountPaise`]: 'More than the line' } });
  });

  // Discount given = below the customer's price + line discounts + bill discount; checked against the counter's limit
  const standard = await standardPrices(b.contactId ?? null, items);
  const gross = b.lines.reduce((x, l) => x + Math.round(l.quantity * standard.get(l.itemId)!), 0);
  const net = b.lines.reduce((x, l) => x + Math.round(l.quantity * l.unitPricePaise) - l.discountPaise, 0);
  if (b.billDiscountPaise > net) throw new AppError('VALIDATION_FAILED', 'The bill discount is more than the bill.', { fields: { billDiscountPaise: 'More than the bill' } });
  const given = gross - (net - b.billDiscountPaise);
  if (counter.maxDiscountBp != null && gross > 0 && given * 10_000 > gross * counter.maxDiscountBp && !(await can(ctx, 'billing.pos.approve'))) {
    throw new AppError('PERMISSION_DENIED', `This counter allows up to ${counter.maxDiscountBp / 100}% off. This bill gives ${Math.round((given / gross) * 1000) / 10}%. Ask a manager.`, { discountLimit: true });
  }

  // The bill discount is spread over the lines by their value; the last line takes what rounding leaves
  let left = b.billDiscountPaise;
  const lineNet = b.lines.map((l) => Math.round(l.quantity * l.unitPricePaise) - l.discountPaise);
  const lines: DocInput['lines'] = b.lines.map((l, i) => {
    const share = i === b.lines.length - 1 ? left : Math.min(left, net ? Math.floor((b.billDiscountPaise * lineNet[i]) / net) : 0);
    const extra = Math.min(share, lineNet[i]);
    left -= extra;
    const it = byId.get(l.itemId)!;
    return { itemId: l.itemId, description: it.name, hsnSac: it.hsnSac, unit: it.unit, quantity: l.quantity, unitPricePaise: l.unitPricePaise, discountPaise: l.discountPaise + extra, gstRateBp: it.gstRateBp, serials: l.serials, batchId: l.batchId ?? null };
  });
  if (left > 0) throw new AppError('VALIDATION_FAILED', 'The bill discount is more than the items can take.', { fields: { billDiscountPaise: 'Too large' } });

  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { preferences: true, profile: true } });
  const taxes = withDefaults(tenant.preferences, tenant.profile).taxes;
  const invoice = await createDocument(ctx, 'invoice', {
    contactId: b.contactId ?? null,
    buyer: b.contactId ? undefined : { name: name ?? WALK_IN, phone },
    branchId: counter.branchId, locationId: counter.locationId, issueDate: todayIST(), dueDate: b.contactId ? undefined : null,
    notes: b.notes ?? null, lines, pricesIncludeGst: taxes.pricesIncludeTax, roundOff: true,
  }, { issue: true, skipCreditLimit: true, sourceType: 'pos', sourceId: s.id });

  // The money: card and UPI as given; cash up to what is left, the rest is change
  const total = Number(invoice.totalPaise);
  const nonCash = b.tenders.filter((x) => x.method !== 'cash').reduce((x, t) => x + t.amountPaise, 0);
  const cashGiven = b.tenders.filter((x) => x.method === 'cash').reduce((x, t) => x + t.amountPaise, 0);
  if (nonCash > total) throw new AppError('VALIDATION_FAILED', `UPI and card come to more than the bill of ₹${(total / 100).toFixed(2)}.`, { fields: { tenders: 'More than the bill' } });
  const cashTaken = Math.min(cashGiven, total - nonCash);
  const due = total - nonCash - cashTaken;
  if (due > 0) {
    if (!b.contactId) throw new AppError('VALIDATION_FAILED', `₹${(due / 100).toFixed(2)} is still to be paid. Take the full amount, or choose the customer to put the rest on their account.`, { fields: { tenders: 'Not fully paid' } });
    if (!counter.allowCredit) throw new AppError('VALIDATION_FAILED', `This counter takes full payment. ₹${(due / 100).toFixed(2)} is still to be paid.`, { fields: { tenders: 'Not fully paid' } });
  }
  for (const t of b.tenders) {
    const amount = t.method === 'cash' ? cashTaken : t.amountPaise;
    if (amount <= 0) continue;
    await recordPayment(ctx, invoice.id, { amountPaise: amount, method: t.method, reference: t.reference ?? null, accountId: t.method === 'cash' ? counter.cashAccountId : counter.bankAccountId }, 'invoice', { posShiftId: s.id });
  }
  // What is left on the customer's account must fit their credit limit
  if (due > 0) await checkCreditLimit(b.contactId!, 0n);
  if (b.heldId) await db().posHeldBill.deleteMany({ where: { id: b.heldId, counterId: counter.id } });
  await audit({ action: 'billing.pos.sale', entity: 'invoice', entityId: invoice.id, after: { number: invoice.number, shift: s.number, totalPaise: total, duePaise: due, changePaise: cashGiven - cashTaken } });
  return { id: invoice.id, number: invoice.number, shareToken: invoice.shareToken, totalPaise: total, paidPaise: total - due, duePaise: due, changePaise: cashGiven - cashTaken, cashGivenPaise: cashGiven };
}

// ── Returns at the counter ──

/** A bill to take goods back on: by its number, with what can still come back on each line */
export async function findBill(ctx: TenantCtx, number: string) {
  const doc = await db().salesDocument.findFirst({ where: { tenantId: ctx.tenantId, kind: 'invoice', number: { equals: number.trim(), mode: 'insensitive' } } });
  if (!doc) throw notFound('Bill');
  if (doc.status === 'cancelled') throw new AppError('CONFLICT', `Bill ${doc.number} is cancelled.`);
  if (doc.status === 'draft') throw new AppError('CONFLICT', `Bill ${doc.number} is a draft.`);
  const open = await creditableLines(ctx, doc.id);
  const items = await db().item.findMany({ where: { id: { in: open.map((o) => o.line.itemId).filter(Boolean) as string[] } }, select: { id: true, tracking: true } });
  const tracking = new Map(items.map((i) => [i.id, i.tracking]));
  return {
    id: doc.id, number: doc.number, issueDate: doc.issueDate, customer: (doc.buyer as { name?: string } | null)?.name ?? WALK_IN, contactId: doc.contactId,
    totalPaise: doc.totalPaise, paidPaise: doc.paidPaise, duePaise: doc.totalPaise - doc.paidPaise, fromCounter: doc.sourceType === 'pos',
    lines: open.map((o) => ({
      id: o.line.id, description: o.line.description, unit: o.line.unit, quantity: Number(o.line.quantity), quantityLeft: o.quantityLeft,
      unitTotalPaise: Number(o.line.quantity) ? Math.round(Number(o.line.totalPaise) / Number(o.line.quantity)) : 0, serials: o.line.serials, tracking: o.line.itemId ? tracking.get(o.line.itemId) ?? 'none' : 'none',
    })),
  };
}

export const ReturnInput = z.object({
  shiftId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  reason: z.enum(NOTE_REASONS.return),
  notes: z.string().trim().max(500).optional().nullable(),
  lines: z.array(z.object({ sourceLineId: z.string().uuid(), quantity: z.number().positive('Quantity must be more than 0').max(1e6), serials: z.array(z.string().trim().min(1).max(40)).max(1000).optional() })).min(1, 'Choose what comes back'),
  /** How the money goes back; credit = kept on the customer's account for a later bill */
  refund: z.enum(['cash', 'upi', 'card', 'other', 'credit']),
  reference: z.string().trim().max(100).optional().nullable(),
});

/** Goods back at the counter: a return credit note (stock comes back), and the money back from this shift */
export async function returnSale(ctx: TenantCtx, b: z.infer<typeof ReturnInput>) {
  const s = await workShift(ctx, b.shiftId);
  const invoice = await getDocument(ctx, b.invoiceId, 'invoice');
  if (b.refund === 'credit' && !invoice.contactId) throw new AppError('VALIDATION_FAILED', 'A walk-in customer gets the money back. Choose how.', { fields: { refund: 'Choose cash, UPI or card' } });
  const note = await createCreditNote(ctx, invoice.id, { type: 'return', reason: b.reason, notes: b.notes ?? null, locationId: s.counter.locationId ?? null, lines: b.lines });
  // What the bill still owed is cleared first; only the rest is paid back
  const back = note.totalPaise - note.paidPaise;
  if (back > 0n && b.refund !== 'credit') {
    if (b.refund === 'cash') {
      const now = await shiftSummary(ctx, s.id);
      if (back > now.cash.expectedPaise) throw new AppError('VALIDATION_FAILED', `Only ₹${(Number(now.cash.expectedPaise) / 100).toFixed(2)} should be in the drawer. Pay back by UPI or card, or keep it as credit.`, { fields: { refund: 'Not enough cash in the drawer' } });
    }
    await refundCreditNote(ctx, note.id, { amountPaise: Number(back), method: b.refund, reference: b.reference ?? null, accountId: b.refund === 'cash' ? s.counter.cashAccountId : s.counter.bankAccountId }, { posShiftId: s.id });
  }
  await audit({ action: 'billing.pos.return', entity: 'credit_note', entityId: note.id, after: { number: note.number, invoice: invoice.number, shift: s.number, refund: b.refund, backPaise: back } });
  return { id: note.id, number: note.number, totalPaise: note.totalPaise, clearedPaise: note.paidPaise, refundPaise: b.refund === 'credit' ? 0n : back, creditPaise: b.refund === 'credit' ? back : 0n };
}

// ── Bills on hold ──

export const HoldInput = z.object({
  counterId: z.string().uuid(),
  label: z.string().trim().min(1).max(60),
  cart: z.record(z.unknown()),
  totalPaise: Paise.default(0),
  lines: z.number().int().min(0).max(200).default(0),
});

export async function listHeld(ctx: TenantCtx, counterId: string) {
  await findCounter(ctx, counterId);
  const b = await bundle({ rows: Prisma.sql`select h.* from pos_held_bills h where h.counter_id = ${counterId}::uuid order by h.created_at`, ...userPart(ctx.tenantId) });
  const user = userNames(b);
  return { data: b.rows.map((h) => ({ id: h.id as string, label: h.label as string, cart: h.cart, totalPaise: h.totalPaise as bigint, lines: h.lines as number, at: h.createdAt as Date, by: user.get(h.createdBy) ?? null })) };
}

export async function hold(ctx: TenantCtx, b: z.infer<typeof HoldInput>) {
  await findCounter(ctx, b.counterId);
  if ((await db().posHeldBill.count({ where: { counterId: b.counterId } })) >= 20) throw new AppError('CONFLICT', 'Twenty bills are already on hold here. Finish or remove one first.');
  const h = await db().posHeldBill.create({ data: { tenantId: ctx.tenantId, counterId: b.counterId, label: b.label, cart: b.cart as Prisma.InputJsonValue, totalPaise: BigInt(b.totalPaise), lines: b.lines, createdBy: ctx.userId } });
  return { id: h.id };
}

export async function dropHeld(ctx: TenantCtx, id: string) {
  const h = await db().posHeldBill.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!h) throw notFound('Bill on hold');
  await findCounter(ctx, h.counterId);
  await db().posHeldBill.delete({ where: { id } });
}

// ── The receipt ──

/** A counter bill for printing: the invoice, how it was paid, and the counter's receipt settings */
export async function receipt(ctx: TenantCtx, invoiceId: string) {
  const doc = await getDocument(ctx, invoiceId, 'invoice');
  const shift = doc.sourceType === 'pos' && doc.sourceId ? await db().posShift.findUnique({ where: { id: doc.sourceId }, include: { counter: true } }) : null;
  const cashier = shift ? await db().user.findUnique({ where: { id: shift.openedBy }, select: { name: true } }) : null;
  return {
    doc,
    pos: shift ? { counter: shift.counter.name, shift: shift.number, cashier: cashier?.name ?? null, paper: shift.counter.paper, note: shift.counter.receiptNote } : null,
    payments: doc.payments.filter((p) => p.amountPaise > 0n).map((p) => ({ method: p.method, amountPaise: p.amountPaise, reference: p.reference })),
  };
}

// ── Lists ──

export const SalesList = z.object({
  q: z.string().trim().max(100).optional(),
  view: z.enum(['all', 'paid', 'due', 'returned', 'cancelled']).optional(),
  from: DateStr.optional(), to: DateStr.optional(),
  counterId: z.string().uuid().optional(), shiftId: z.string().uuid().optional(),
  method: z.enum(['cash', 'upi', 'card', 'other', 'mixed', 'credit']).optional(),
  cashier: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().uuid().optional(),
});

/** Counter bills with how each was paid; counts and sums for the tabs and cards */
export async function listSales(ctx: TenantCtx, q: z.infer<typeof SalesList>) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`
      select d.id, d.number, d.status::text as status, d.issue_date, d.issued_at, d.total_paise, d.paid_paise, d.contact_id, d.buyer->>'name' as customer, d.buyer->>'phone' as phone, d.created_by,
        s.id as shift_id, s.number as shift_number, c.id as counter_id, c.name as counter_name,
        (select count(*)::int from sales_document_lines l where l.document_id = d.id) as lines,
        (select coalesce(sum(l.quantity), 0)::float from sales_document_lines l where l.document_id = d.id) as qty,
        (select coalesce(json_agg(distinct p.method::text), '[]'::json) from payments_received p where p.document_id = d.id and p.amount_paise > 0 and p.reverses_id is null) as methods,
        (select coalesce(sum(n.total_paise), 0) from sales_documents n where n.kind = 'credit_note' and n.source_id = d.id and n.status <> 'cancelled') as returned_paise
      from sales_documents d join pos_shifts s on s.id = d.source_id join pos_counters c on c.id = s.counter_id
      where d.tenant_id = ${t}::uuid and d.kind = 'invoice' and d.source_type = 'pos' ${scopeSql(ctx, ['d.created_by'], 'd.branch_id')}
        ${q.from ? Prisma.sql`and d.issue_date >= ${q.from}::date` : Prisma.empty}
        ${q.to ? Prisma.sql`and d.issue_date <= ${q.to}::date` : Prisma.empty}
        ${q.counterId ? Prisma.sql`and c.id = ${q.counterId}::uuid` : Prisma.empty}
        ${q.shiftId ? Prisma.sql`and s.id = ${q.shiftId}::uuid` : Prisma.empty}
        ${q.cashier ? Prisma.sql`and d.created_by = ${q.cashier}::uuid` : Prisma.empty}
      order by d.id desc limit 5000`,
    counters: Prisma.sql`select id, name from pos_counters where tenant_id = ${t}::uuid order by name`,
    ...userPart(t),
  });
  const user = userNames(b);
  const all = b.rows.map((d) => {
    const methods = (d.methods ?? []) as string[];
    const total = d.totalPaise as bigint;
    const due = total - (d.paidPaise as bigint);
    return {
      id: d.id as string, number: d.number as string, status: d.status as string, issueDate: d.issueDate as Date, at: d.issuedAt ?? null,
      totalPaise: total, duePaise: d.status === 'cancelled' ? 0n : due, returnedPaise: d.returnedPaise as bigint,
      customer: d.customer ?? WALK_IN, phone: d.phone ?? null, contactId: d.contactId ?? null,
      counterId: d.counterId as string, counter: d.counterName as string, shiftId: d.shiftId as string, shift: d.shiftNumber as string,
      cashierId: d.createdBy ?? null, cashier: d.createdBy ? user.get(d.createdBy) ?? null : null,
      lines: d.lines as number, qty: n(d.qty),
      paidBy: methods.length > 1 ? 'mixed' : methods[0] ?? (due > 0n ? 'credit' : 'none'), methods,
    };
  });
  const live = all.filter((r) => r.status !== 'cancelled');
  const sum = (rows: typeof all, f: (r: (typeof all)[number]) => bigint) => rows.reduce((x, r) => x + f(r), 0n);
  const today = todayIST();
  const todays = live.filter((r) => r.issueDate.toISOString().slice(0, 10) === today);
  const counts = { all: all.length, paid: live.filter((r) => r.duePaise === 0n).length, due: live.filter((r) => r.duePaise > 0n).length, returned: live.filter((r) => r.returnedPaise > 0n).length, cancelled: all.length - live.length };
  const sales = sum(live, (r) => r.totalPaise);
  const sums = {
    sales, bills: live.length, average: live.length ? sales / BigInt(live.length) : 0n, today: sum(todays, (r) => r.totalPaise), todayBills: todays.length,
    due: sum(live, (r) => r.duePaise), returned: sum(live, (r) => r.returnedPaise), items: live.reduce((x, r) => x + r.qty, 0),
  };
  const text = q.q?.toLowerCase();
  const rows = all.filter((r) =>
    (q.view === 'paid' ? r.status !== 'cancelled' && r.duePaise === 0n : q.view === 'due' ? r.duePaise > 0n : q.view === 'returned' ? r.returnedPaise > 0n : q.view === 'cancelled' ? r.status === 'cancelled' : true)
    && (!q.method || r.paidBy === q.method || (q.method !== 'mixed' && q.method !== 'credit' && r.methods.includes(q.method)))
    && (!text || [r.number, r.customer, r.phone, r.counter, r.shift, r.cashier].some((v) => typeof v === 'string' && v.toLowerCase().includes(text))));
  const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor) + 1 : 0;
  const data = rows.slice(start, start + q.limit);
  return { data, nextCursor: start + q.limit < rows.length ? data[data.length - 1]?.id ?? null : null, total: rows.length, counts, sums, counters: b.counters };
}

export const ShiftList = z.object({
  q: z.string().trim().max(100).optional(),
  view: z.enum(['all', 'open', 'closed', 'short', 'over']).optional(),
  from: DateStr.optional(), to: DateStr.optional(),
  counterId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().uuid().optional(),
});

export async function listShifts(ctx: TenantCtx, q: z.infer<typeof ShiftList>) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`
      select s.*, c.name as counter_name,
        (select count(*)::int from sales_documents d where d.source_type = 'pos' and d.source_id = s.id and d.status <> 'cancelled') as bills,
        (select coalesce(sum(d.total_paise), 0) from sales_documents d where d.source_type = 'pos' and d.source_id = s.id and d.status <> 'cancelled') as sales_paise,
        (select coalesce(sum(p.amount_paise), 0) from payments_received p where p.pos_shift_id = s.id and p.method = 'cash') as cash_paise,
        (select coalesce(sum(p.amount_paise), 0) from payments_received p where p.pos_shift_id = s.id and p.method <> 'cash') as other_paise
      from pos_shifts s join pos_counters c on c.id = s.counter_id
      where s.tenant_id = ${t}::uuid ${scopeSql(ctx, ['s.opened_by'], 'c.branch_id')}
        ${q.from ? Prisma.sql`and s.opened_at >= (${q.from}::date)::timestamp - interval '5 hours 30 minutes'` : Prisma.empty}
        ${q.to ? Prisma.sql`and s.opened_at < (${q.to}::date + 1)::timestamp - interval '5 hours 30 minutes'` : Prisma.empty}
        ${q.counterId ? Prisma.sql`and c.id = ${q.counterId}::uuid` : Prisma.empty}
      order by s.opened_at desc limit 3000`,
    counters: Prisma.sql`select id, name from pos_counters where tenant_id = ${t}::uuid order by name`,
    ...userPart(t),
  });
  const user = userNames(b);
  const all = b.rows.map((s) => ({
    id: s.id as string, number: s.number as string, status: s.status as 'open' | 'closed', counterId: s.counterId as string, counter: s.counterName as string,
    openedBy: s.openedBy as string, cashier: user.get(s.openedBy) ?? 'Someone', openedAt: s.openedAt as Date, closedAt: s.closedAt ?? null, closedBy: s.closedBy ? user.get(s.closedBy) ?? null : null,
    openingCashPaise: s.openingCashPaise as bigint, bills: s.bills as number, salesPaise: s.salesPaise as bigint, cashPaise: s.cashPaise as bigint, otherPaise: s.otherPaise as bigint,
    expectedCashPaise: (s.expectedCashPaise as bigint | null) ?? null, countedCashPaise: (s.countedCashPaise as bigint | null) ?? null, differencePaise: (s.differencePaise as bigint | null) ?? null,
    depositPaise: s.depositPaise as bigint, note: s.closingNote ?? null,
  }));
  const closed = all.filter((s) => s.status === 'closed');
  const counts = { all: all.length, open: all.length - closed.length, closed: closed.length, short: closed.filter((s) => (s.differencePaise ?? 0n) < 0n).length, over: closed.filter((s) => (s.differencePaise ?? 0n) > 0n).length };
  const sums = {
    sales: all.reduce((x, s) => x + s.salesPaise, 0n), bills: all.reduce((x, s) => x + s.bills, 0), cash: all.reduce((x, s) => x + s.cashPaise, 0n), other: all.reduce((x, s) => x + s.otherPaise, 0n),
    short: closed.reduce((x, s) => x + ((s.differencePaise ?? 0n) < 0n ? -(s.differencePaise ?? 0n) : 0n), 0n), over: closed.reduce((x, s) => x + ((s.differencePaise ?? 0n) > 0n ? (s.differencePaise ?? 0n) : 0n), 0n),
  };
  const text = q.q?.toLowerCase();
  const rows = all.filter((s) =>
    (q.view === 'open' ? s.status === 'open' : q.view === 'closed' ? s.status === 'closed' : q.view === 'short' ? (s.differencePaise ?? 0n) < 0n : q.view === 'over' ? (s.differencePaise ?? 0n) > 0n : true)
    && (!text || [s.number, s.counter, s.cashier, s.note].some((v) => typeof v === 'string' && v.toLowerCase().includes(text))));
  const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor) + 1 : 0;
  const data = rows.slice(start, start + q.limit);
  return { data, nextCursor: start + q.limit < rows.length ? data[data.length - 1]?.id ?? null : null, total: rows.length, counts, sums, counters: b.counters };
}

// ── Report ──

export const ReportQuery = z.object({ from: DateStr, to: DateStr, by: z.enum(['day', 'hour', 'item', 'category', 'cashier', 'counter', 'method']).default('day'), counterId: z.string().uuid().optional() });

/** Counter sales grouped by day, hour, item, category, cashier, counter or how they were paid */
export async function report(ctx: TenantCtx, q: z.infer<typeof ReportQuery>) {
  const t = ctx.tenantId;
  const where = Prisma.sql`d.tenant_id = ${t}::uuid and d.kind = 'invoice' and d.source_type = 'pos' and d.status <> 'cancelled'
    and d.issue_date between ${q.from}::date and ${q.to}::date ${scopeSql(ctx, ['d.created_by'], 'd.branch_id')}
    ${q.counterId ? Prisma.sql`and s.counter_id = ${q.counterId}::uuid` : Prisma.empty}`;
  const b = await bundle({
    bills: Prisma.sql`select d.id, d.issue_date, d.issued_at, d.total_paise, d.taxable_paise, d.created_by, c.name as counter
      from sales_documents d join pos_shifts s on s.id = d.source_id join pos_counters c on c.id = s.counter_id where ${where}`,
    lines: Prisma.sql`select l.item_id, l.description, l.quantity::float as qty, l.total_paise, l.taxable_paise, coalesce(cat.name, 'No category') as category
      from sales_document_lines l join sales_documents d on d.id = l.document_id join pos_shifts s on s.id = d.source_id
        left join items i on i.id = l.item_id left join item_categories cat on cat.id = i.category_id where ${where}`,
    pays: Prisma.sql`select p.method::text as method, sum(p.amount_paise) as amount_paise, count(*)::int as count
      from payments_received p join sales_documents d on d.id = p.document_id join pos_shifts s on s.id = d.source_id
      where ${where} and p.amount_paise > 0 and p.reverses_id is null group by p.method`,
    returns: Prisma.sql`select coalesce(sum(n.total_paise), 0) as total_paise, count(*)::int as count from sales_documents n
      join sales_documents d on d.id = n.source_id join pos_shifts s on s.id = d.source_id
      where n.kind = 'credit_note' and n.status <> 'cancelled' and ${where}`,
    ...userPart(t),
  });
  const user = userNames(b);
  const groups = new Map<string, { key: string; label: string; bills: Set<string>; qty: number; salesPaise: bigint; taxablePaise: bigint }>();
  const add = (key: string, label: string, bill: string | null, qty: number, total: bigint, taxable: bigint) => {
    const g = groups.get(key) ?? { key, label, bills: new Set<string>(), qty: 0, salesPaise: 0n, taxablePaise: 0n };
    if (bill) g.bills.add(bill);
    g.qty += qty;
    g.salesPaise += total;
    g.taxablePaise += taxable;
    groups.set(key, g);
  };
  const istHour = (d: Date) => (new Date(d.getTime() + 330 * 60_000)).getUTCHours();
  if (q.by === 'item' || q.by === 'category') for (const l of b.lines) { const key = q.by === 'item' ? (l.itemId ?? l.description) : l.category; add(key, q.by === 'item' ? l.description : l.category, null, n(l.qty), l.totalPaise as bigint, l.taxablePaise as bigint); }
  else if (q.by === 'method') for (const p of b.pays) add(p.method, p.method, null, p.count as number, p.amountPaise as bigint, 0n);
  else for (const d of b.bills) {
    const key = q.by === 'day' ? (d.issueDate as Date).toISOString().slice(0, 10) : q.by === 'hour' ? String(istHour((d.issuedAt ?? d.issueDate) as Date)).padStart(2, '0') : q.by === 'cashier' ? (d.createdBy ?? 'none') : (d.counter as string);
    const label = q.by === 'cashier' ? user.get(d.createdBy) ?? 'Someone' : q.by === 'hour' ? `${key}:00` : key;
    add(key, label, d.id as string, 0, d.totalPaise as bigint, d.taxablePaise as bigint);
  }
  const rows = [...groups.values()].map((g) => ({ id: g.key, key: g.key, label: g.label, bills: g.bills.size, qty: g.qty, salesPaise: g.salesPaise, taxablePaise: g.taxablePaise, averagePaise: g.bills.size ? g.salesPaise / BigInt(g.bills.size) : 0n }))
    .sort((a, z) => (q.by === 'day' || q.by === 'hour' ? a.key.localeCompare(z.key) : Number(z.salesPaise - a.salesPaise)));
  const sales = b.bills.reduce((x, d) => x + (d.totalPaise as bigint), 0n);
  return {
    rows,
    totals: {
      bills: b.bills.length, salesPaise: sales, taxablePaise: b.bills.reduce((x, d) => x + (d.taxablePaise as bigint), 0n), averagePaise: b.bills.length ? sales / BigInt(b.bills.length) : 0n,
      items: b.lines.reduce((x, l) => x + n(l.qty), 0), returnsPaise: (b.returns[0]?.totalPaise as bigint) ?? 0n, returns: (b.returns[0]?.count as number) ?? 0,
    },
    methods: b.pays.map((p) => ({ method: p.method as string, amountPaise: p.amountPaise as bigint, count: p.count as number })),
  };
}

