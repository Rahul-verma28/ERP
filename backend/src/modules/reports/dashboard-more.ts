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
