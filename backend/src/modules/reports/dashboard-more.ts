import { scopeSql } from '../../kernel/query';
import { Prisma } from '@prisma/client';
import { bundle, type Row } from '../../kernel/bundle';
import { withTenant } from '../../kernel/db';
import type { TenantCtx } from '../../kernel/context';
import { todayIST } from '../../kernel/gst';
import { addDays, bucketsFor, previousRange } from '../../contracts/dashboard';
import { stockSummary } from '../inventory/service';
import type { DashboardInput } from './dashboard';

// Purchase and Inventory dashboard tabs. Each tab reads its figures in ONE database round trip
// (kernel/bundle); every widget is then shaped on its own, so one that fails says so and the rest
// still show.

type Scoped = (key: string) => TenantCtx | null;
const n = (v: unknown) => Number(v ?? 0);
const change = (now: number, prev: number | null) => (prev === null ? null : { prev, delta: now - prev, pct: prev ? Math.round(((now - prev) / prev) * 100) : null });
const day = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);

/** Runs the tab's read once; each widget shapes it, and a widget that throws returns { error } */
function widgets<T>(ctx: TenantCtx, read: () => Promise<T>, shapes: Record<string, (d: T) => unknown>) {
  const data = withTenant(ctx, read);
  const out: Record<string, Promise<unknown>> = {};
  for (const [k, shape] of Object.entries(shapes)) {
    out[k] = data.then(shape).catch((e) => { console.error('[dashboard] widget failed', k, e); return { error: 'This widget could not load.' }; });
  }
  return Promise.all(Object.entries(out).map(async ([k, p]) => [k, await p] as const)).then(Object.fromEntries);
}

export async function purchase(ctx: TenantCtx, s: Scoped, i: DashboardInput) {
  const c = s('inventory.supplier_bill.view')!;
  const { range: r, compare } = i;
  const prev = previousRange(r);
  const t = ctx.tenantId;
  const today = todayIST();
  const own = scopeSql(c, ['d.created_by']);
  const ownPay = scopeSql(c, ['p.created_by']);
  const live = Prisma.sql`d.tenant_id = ${t}::uuid and d.kind = 'purchase_bill' and d.status not in ('cancelled', 'draft') ${own}`;
  return widgets(ctx, () => bundle({
    bills: Prisma.sql`select d.issue_date, d.total_paise, d.contact_id, d.supplier->>'name' as supplier from purchase_documents d where ${live} and d.issue_date between ${prev.from}::date and ${r.to}::date`,
    returns: Prisma.sql`select d.issue_date, d.total_paise from purchase_documents d where d.tenant_id = ${t}::uuid and d.kind = 'purchase_return' and d.status not in ('cancelled', 'draft') ${own} and d.issue_date between ${prev.from}::date and ${r.to}::date`,
    paid: Prisma.sql`select p.paid_on, sum(p.amount_paise) as amount from supplier_payments p where p.tenant_id = ${t}::uuid ${ownPay} and p.paid_on between ${prev.from}::date and ${r.to}::date group by p.paid_on`,
    open: Prisma.sql`select d.id, d.number, d.supplier_ref, d.contact_id, d.supplier->>'name' as supplier, d.due_date, d.total_paise - d.paid_paise - d.returned_paise as balance_paise
      from purchase_documents d where ${live} and d.total_paise - d.paid_paise - d.returned_paise > 0 order by d.due_date nulls last`,
  }), {
    kpis: (b) => {
      const sumIn = (rows: Row[], f: string, k: string, rg: { from: string; to: string }) => rows.filter((x) => day(x[f]) >= rg.from && day(x[f]) <= rg.to).reduce((sum, x) => sum + n(x[k]), 0);
      const bought = (rg: { from: string; to: string }) => sumIn(b.bills, 'issueDate', 'totalPaise', rg) - sumIn(b.returns, 'issueDate', 'totalPaise', rg);
      const paid = (rg: { from: string; to: string }) => sumIn(b.paid, 'paidOn', 'amount', rg);
      const toPay = b.open.reduce((sum, x) => sum + n(x.balancePaise), 0);
      const late = b.open.filter((x) => x.dueDate && day(x.dueDate) < today);
      return {
        purchased: { value: bought(r), change: change(bought(r), compare ? bought(prev) : null) },
        paid: { value: paid(r), change: change(paid(r), compare ? paid(prev) : null) },
        toPay: { value: toPay, bills: b.open.length },
        overdue: { value: late.reduce((sum, x) => sum + n(x.balancePaise), 0), bills: late.length },
      };
    },
    trend: (b) => {
      const into = (rows: Row[], f: string, k: string, sign = 1) => (bk: { from: string; to: string }) => rows.filter((x) => day(x[f]) >= bk.from && day(x[f]) <= bk.to).reduce((sum, x) => sum + sign * n(x[k]), 0);
      const bought = into(b.bills, 'issueDate', 'totalPaise');
      const back = into(b.returns, 'issueDate', 'totalPaise');
      const paid = into(b.paid, 'paidOn', 'amount');
      return { buckets: bucketsFor(r).map((k) => ({ label: k.label, from: k.from, to: k.to, purchased: bought(k) - back(k), paid: paid(k) })) };
    },
    due: (b) => ({
      rows: b.open.filter((x) => !x.dueDate || day(x.dueDate) <= addDays(today, 7)).slice(0, 8).map((x) => {
        const due = x.dueDate ? day(x.dueDate) : null;
        return { id: x.id, number: x.number, ref: x.supplierRef, supplier: x.supplier ?? 'Supplier', contactId: x.contactId, balancePaise: n(x.balancePaise), dueDate: due, daysLate: due && due < today ? Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000) : 0 };
      }),
    }),
    suppliers: (b) => {
      const by = new Map<string, { id: string | null; name: string; amount: number; bills: number }>();
      for (const x of b.bills.filter((y) => day(y.issueDate) >= r.from)) {
        const k = x.contactId ?? `n:${x.supplier}`;
        const g = by.get(k) ?? { id: x.contactId, name: x.supplier ?? 'Supplier', amount: 0, bills: 0 };
        g.amount += n(x.totalPaise);
        g.bills++;
        by.set(k, g);
      }
      const rows = [...by.values()].sort((a, z) => z.amount - a.amount).slice(0, 6);
      const max = Math.max(1, ...rows.map((x) => x.amount));
      return { rows: rows.map((x) => ({ ...x, pct: Math.round((x.amount / max) * 100) })) };
    },
  });
}

export async function pos(ctx: TenantCtx, s: Scoped, i: DashboardInput) {
  const c = s('billing.pos.view')!;
  const { range: r, compare } = i;
  const prev = previousRange(r);
  const t = ctx.tenantId;
  const today = todayIST();
  const own = scopeSql(c, ['d.created_by'], 'd.branch_id');
  const live = Prisma.sql`d.tenant_id = ${t}::uuid and d.kind = 'invoice' and d.source_type = 'pos' and d.status <> 'cancelled' ${own} ${i.branchId ? Prisma.sql`and d.branch_id = ${i.branchId}::uuid` : Prisma.empty}`;
  return widgets(ctx, () => bundle({
    bills: Prisma.sql`select d.issue_date, d.total_paise from sales_documents d where ${live} and d.issue_date between ${prev.from}::date and ${r.to}::date`,
    pays: Prisma.sql`select p.method::text as method, sum(p.amount_paise) as amount from payments_received p join sales_documents d on d.id = p.document_id
      where ${live} and p.pos_shift_id is not null and p.amount_paise > 0 and p.reverses_id is null and d.issue_date between ${r.from}::date and ${r.to}::date group by p.method`,
    items: Prisma.sql`select l.item_id, l.description, sum(l.quantity)::float as qty, sum(l.total_paise) as total_paise from sales_document_lines l join sales_documents d on d.id = l.document_id
      where ${live} and d.issue_date between ${r.from}::date and ${r.to}::date group by l.item_id, l.description order by sum(l.total_paise) desc limit 6`,
    counters: Prisma.sql`select c.id, c.name, c.is_active, s.id as shift_id, s.number as shift_number, s.opened_at, s.opening_cash_paise, u.name as cashier,
        (select coalesce(sum(p.amount_paise), 0) from payments_received p where p.pos_shift_id = s.id and p.method = 'cash') as cash_paise,
        (select coalesce(sum(case when m.kind = 'in' then m.amount_paise else -m.amount_paise end), 0) from pos_cash_moves m where m.shift_id = s.id) as moves_paise,
        (select coalesce(sum(d.total_paise), 0) from sales_documents d join pos_shifts x on x.id = d.source_id where x.counter_id = c.id and d.source_type = 'pos' and d.status <> 'cancelled' and d.issue_date = ${today}::date) as today_paise,
        (select count(*)::int from sales_documents d join pos_shifts x on x.id = d.source_id where x.counter_id = c.id and d.source_type = 'pos' and d.status <> 'cancelled' and d.issue_date = ${today}::date) as today_bills
      from pos_counters c left join pos_shifts s on s.counter_id = c.id and s.status = 'open' left join users u on u.id = s.opened_by
      where c.tenant_id = ${t}::uuid and c.is_active order by c.name`,
  }), {
    kpis: (b) => {
      const sumIn = (rg: { from: string; to: string }) => b.bills.filter((x) => day(x.issueDate) >= rg.from && day(x.issueDate) <= rg.to);
      const now = sumIn(r);
      const before = compare ? sumIn(prev) : null;
      const total = (rows: Row[]) => rows.reduce((a, x) => a + n(x.totalPaise), 0);
      const avg = (rows: Row[]) => (rows.length ? Math.round(total(rows) / rows.length) : 0);
      const drawers = b.counters.filter((x) => x.shiftId).reduce((a, x) => a + n(x.openingCashPaise) + n(x.cashPaise) + n(x.movesPaise), 0);
      return {
        sales: { value: total(now), change: change(total(now), before ? total(before) : null) },
        bills: { value: now.length, change: change(now.length, before ? before.length : null) },
        average: { value: avg(now), change: change(avg(now), before ? avg(before) : null) },
        drawers: { value: drawers, open: b.counters.filter((x) => x.shiftId).length },
      };
    },
    trend: (b) => ({ buckets: bucketsFor(r).map((k) => { const rows = b.bills.filter((x) => day(x.issueDate) >= k.from && day(x.issueDate) <= k.to); return { label: k.label, from: k.from, to: k.to, sales: rows.reduce((a, x) => a + n(x.totalPaise), 0), bills: rows.length }; }) }),
    counters: (b) => ({
      rows: b.counters.map((x) => ({
        id: x.id, name: x.name, todayPaise: n(x.todayPaise), todayBills: n(x.todayBills),
        shift: x.shiftId ? { id: x.shiftId, number: x.shiftNumber, cashier: x.cashier ?? 'Someone', openedAt: x.openedAt, drawerPaise: n(x.openingCashPaise) + n(x.cashPaise) + n(x.movesPaise) } : null,
      })),
    }),
    methods: (b) => {
      const total = b.pays.reduce((a, x) => a + n(x.amount), 0);
      return { total, rows: b.pays.map((x) => ({ method: x.method, amount: n(x.amount), share: total ? Math.round((n(x.amount) / total) * 100) : 0 })).sort((a, z) => z.amount - a.amount) };
    },
    items: (b) => {
      const max = Math.max(1, ...b.items.map((x) => n(x.totalPaise)));
      return { rows: b.items.map((x) => ({ id: x.itemId, name: x.description, qty: n(x.qty), amount: n(x.totalPaise), pct: Math.round((n(x.totalPaise) / max) * 100) })) };
    },
  });
}

export async function inventory(ctx: TenantCtx, s: Scoped, i: DashboardInput) {
  const c = s('inventory.stock.view')!;
  const { range: r } = i;
  const t = ctx.tenantId;
  const today = todayIST();
  return widgets(ctx, async () => {
    const [summary, b] = [await stockSummary(c, {}), await bundle({
      expiring: Prisma.sql`select b.id, b.number, b.expiry_date, i.id as item_id, i.name, i.unit, sum(bb.quantity) as qty
        from stock_batches b join stock_batch_balances bb on bb.batch_id = b.id join items i on i.id = b.item_id
        where b.tenant_id = ${t}::uuid and b.expiry_date is not null and b.expiry_date <= ${addDays(today, 30)}::date
        group by b.id, i.id having sum(bb.quantity) > 0 order by b.expiry_date`,
      movers: Prisma.sql`select m.item_id, i.name, i.unit, -sum(m.quantity) as qty, -sum(m.value_paise) as cost_paise
        from stock_moves m join items i on i.id = m.item_id
        where m.tenant_id = ${t}::uuid and m.kind = 'sale' and m.move_date between ${r.from}::date and ${r.to}::date
        group by m.item_id, i.name, i.unit order by -sum(m.quantity) desc limit 6`,
      places: Prisma.sql`select l.id, l.name, coalesce(sum(sb.value_paise), 0) as value_paise, count(*) filter (where sb.quantity > 0) as items
        from stock_locations l left join stock_balances sb on sb.location_id = l.id
        where l.tenant_id = ${t}::uuid group by l.id, l.name order by 3 desc`,
    })];
    return { summary, b };
  }, {
    kpis: ({ summary, b }) => {
      // The same counts the Stock page shows
      return {
        value: { value: n(summary.totals.valuePaise), items: summary.data.filter((x) => x.quantity > 0).length },
        low: { value: summary.data.filter((x) => x.low).length },
        out: { value: summary.data.filter((x) => x.quantity <= 0).length },
        expiring: { value: b.expiring.length, expired: b.expiring.filter((x) => day(x.expiryDate) < today).length },
      };
    },
    low: ({ summary }) => {
      const rows = summary.data.filter((x) => x.low).sort((a, z) => a.available - z.available).slice(0, 8);
      return { rows: rows.map((x) => ({ id: x.id, name: x.name, unit: x.unit, quantity: x.available, reorderLevel: x.reorderLevel === null ? null : n(x.reorderLevel) })) };
    },
    movers: ({ b }) => {
      const max = Math.max(1, ...b.movers.map((x) => n(x.qty)));
      return { rows: b.movers.map((x) => ({ id: x.itemId, name: x.name, unit: x.unit, quantity: Math.round(n(x.qty) * 1000) / 1000, costPaise: n(x.costPaise), pct: Math.round((n(x.qty) / max) * 100) })) };
    },
    warehouses: ({ b }) => {
      const total = b.places.reduce((sum, x) => sum + n(x.valuePaise), 0);
      return { total, rows: b.places.map((x) => ({ id: x.id, name: x.name, valuePaise: n(x.valuePaise), items: n(x.items), pct: total ? Math.round((n(x.valuePaise) / total) * 100) : 0 })) };
    },
  });
}
