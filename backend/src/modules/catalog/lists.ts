import { Prisma } from '@prisma/client';
import { bundle, type Row } from '../../kernel/bundle';
import type { TenantCtx } from '../../kernel/context';
import { todayIST } from '../../kernel/gst';

// The item list in ONE database round trip (kernel/bundle): every item with its category, stock by
// warehouse, what is held for orders, what sold and when, the last purchase price, and the counts and
// totals for the tabs and cards. Filters run here, so counts describe the whole catalogue.

const milli = (q: unknown) => Math.round(Number(q ?? 0) * 1000);
const qty = (m: number) => m / 1000;
const big = (v: unknown) => (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v ?? 0))));

export interface ItemListQuery {
  type?: 'product' | 'service'; categoryId?: string; active: 'true' | 'false' | 'all'; locationId?: string; low?: 'true';
  /** out = tracked and none left */
  stock?: 'out';
  q?: string; limit: number; cursor?: string;
}

export async function listItems(ctx: TenantCtx, q: ItemListQuery) {
  const t = ctx.tenantId;
  const today = todayIST();
  const b = await bundle({
    rows: Prisma.sql`select i.*, c.name as category from items i left join item_categories c on c.id = i.category_id where i.tenant_id = ${t}::uuid order by i.id desc limit 5000`,
    bal: Prisma.sql`select item_id, location_id, quantity, value_paise from stock_balances where tenant_id = ${t}::uuid and quantity <> 0`,
    places: Prisma.sql`select id, name from stock_locations where tenant_id = ${t}::uuid`,
    reserved: Prisma.sql`
      select ol.item_id, sum(greatest(ol.quantity - coalesce(d.done, 0), 0)) as reserved
      from sales_document_lines ol
      join sales_documents o on o.id = ol.document_id
      left join (
        select dl.source_line_id, sum(dl.quantity) as done from sales_document_lines dl join sales_documents dd on dd.id = dl.document_id
        where dd.tenant_id = ${t}::uuid and dd.kind in ('invoice', 'delivery_challan') and dd.status <> 'cancelled' and dl.source_line_id is not null
        group by dl.source_line_id
      ) d on d.source_line_id = ol.id
      where o.tenant_id = ${t}::uuid and o.kind = 'sales_order' and o.status in ('open', 'part_invoiced') and ol.item_id is not null
      group by ol.item_id`,
    sold: Prisma.sql`
      select l.item_id,
        sum(case when d.kind = 'credit_note' then -l.quantity else l.quantity end) as qty,
        sum(case when d.kind = 'credit_note' then -l.taxable_paise else l.taxable_paise end) as value_paise,
        coalesce(sum(l.quantity) filter (where d.kind = 'invoice' and d.issue_date >= ${today}::date - 30), 0) as qty30,
        max(d.issue_date) filter (where d.kind = 'invoice') as last_sold_on
      from sales_document_lines l join sales_documents d on d.id = l.document_id
      where d.tenant_id = ${t}::uuid and d.kind in ('invoice', 'credit_note') and d.status not in ('draft', 'cancelled') and l.item_id is not null
      group by l.item_id`,
    bought: Prisma.sql`
      select l.item_id, max(d.issue_date) as last_bought_on,
        (array_agg(l.unit_price_paise order by d.issue_date desc, d.id desc))[1] as last_cost_paise,
        sum(l.quantity) as qty
      from purchase_document_lines l join purchase_documents d on d.id = l.document_id
      where d.tenant_id = ${t}::uuid and d.kind = 'purchase_bill' and d.status not in ('draft', 'cancelled') and l.item_id is not null
      group by l.item_id`,
    lists: Prisma.sql`select item_id, count(*)::int as n from price_list_items where tenant_id = ${t}::uuid group by item_id`,
  });
  const placeName = new Map(b.places.map((p) => [p.id as string, p.name as string]));
  const stockBy = new Map<string, { m: number; value: bigint; here: boolean; warehouses: { id: string; name: string; quantity: number }[] }>();
  for (const r of b.bal) {
    const s = stockBy.get(r.itemId) ?? { m: 0, value: 0n, here: false, warehouses: [] };
    s.m += milli(r.quantity);
    s.value += big(r.valuePaise);
    s.here ||= r.locationId === q.locationId;
    s.warehouses.push({ id: r.locationId, name: placeName.get(r.locationId) ?? 'Warehouse', quantity: Number(r.quantity) });
    stockBy.set(r.itemId, s);
  }
  for (const s of stockBy.values()) s.warehouses.sort((x, y) => y.quantity - x.quantity);
  const reserved = new Map(b.reserved.map((r) => [r.itemId as string, Number(r.reserved)]));
  const sold = new Map(b.sold.map((r) => [r.itemId as string, r]));
  const bought = new Map(b.bought.map((r) => [r.itemId as string, r]));
  const lists = new Map(b.lists.map((r) => [r.itemId as string, r.n as number]));

  type Item = Row & { id: string; name: string; type: string; isActive: boolean; trackStock: boolean; low: boolean; out: boolean; stockValuePaise: bigint; pricePaise: bigint; categoryId: string | null };
  const all: Item[] = b.rows.map((i) => {
    const s = stockBy.get(i.id);
    const reorder = i.reorderLevel == null ? null : Number(i.reorderLevel);
    const stockQty = qty(s?.m ?? 0);
    const so = sold.get(i.id);
    const bo = bought.get(i.id);
    const price = big(i.pricePaise);
    const cost = i.costPricePaise == null ? null : big(i.costPricePaise);
    return {
      ...i,
      id: i.id as string, name: i.name as string, type: i.type as string, isActive: i.isActive as boolean, trackStock: !!i.trackStock, categoryId: i.categoryId ?? null, pricePaise: price,
      altFactor: i.altFactor == null ? null : Number(i.altFactor),
      ...(i.trackStock ? { warehouses: s?.warehouses ?? [], stockQty, reservedQty: reserved.get(i.id) ?? 0, reorderLevel: reorder } : {}),
      low: !!i.trackStock && reorder !== null && stockQty - (reserved.get(i.id) ?? 0) <= reorder,
      out: !!i.trackStock && i.type === 'product' && stockQty <= 0,
      here: !!s?.here,
      stockValuePaise: s?.value ?? 0n,
      soldQty: so ? Number(so.qty) : 0, soldValuePaise: big(so?.valuePaise), soldQty30: so ? Number(so.qty30) : 0, lastSoldOn: so?.lastSoldOn ?? null,
      boughtQty: bo ? Number(bo.qty) : 0, lastBoughtOn: bo?.lastBoughtOn ?? null, lastCostPaise: bo?.lastCostPaise == null ? null : big(bo.lastCostPaise),
      marginBp: cost !== null && price > 0n ? Number(((price - cost) * 10000n) / price) : null,
      priceListCount: lists.get(i.id) ?? 0,
    };
  });

  const active = all.filter((i) => i.isActive);
  const counts = {
    all: active.length, product: active.filter((i) => i.type === 'product').length, service: active.filter((i) => i.type === 'service').length,
    low: active.filter((i) => i.low).length, out: active.filter((i) => i.out).length, archived: all.length - active.length,
  };
  const sums = {
    stockValue: active.reduce((a, i) => a + i.stockValuePaise, 0n),
    saleValue: active.reduce((a, i) => a + (i.trackStock && (i.stockQty as number) > 0 ? BigInt(Math.round((i.stockQty as number) * Number(i.pricePaise))) : 0n), 0n),
    categories: new Set(active.map((i) => i.categoryId).filter(Boolean)).size,
    sold30: active.filter((i) => (i.soldQty30 as number) > 0).length,
    neverSold: active.filter((i) => i.type === 'product' && !i.lastSoldOn).length,
  };
  const s = q.q?.toLowerCase();
  const rows = all.filter((i) =>
    (q.active === 'all' || i.isActive === (q.active === 'true')) && (!q.type || i.type === q.type) && (!q.categoryId || i.categoryId === q.categoryId)
    && (!q.locationId || i.here) && (q.low !== 'true' || i.low) && (q.stock !== 'out' || i.out)
    && (!s || i.name.toLowerCase().includes(s) || (i.sku ?? '').toLowerCase().includes(s) || (i.hsnSac ?? '').startsWith(q.q!) || i.barcode === q.q));
  const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor) + 1 : 0;
  const data = rows.slice(start, start + q.limit);
  return { data, nextCursor: start + q.limit < rows.length ? data[data.length - 1]?.id ?? null : null, total: rows.length, counts, sums };
}

/** Price lists with how many exact prices, which customers use each, and what was sold to them in
 *  the last 30 days, in one round trip */
export async function listPriceLists(ctx: TenantCtx) {
  const t = ctx.tenantId;
  const b = await bundle({
    rows: Prisma.sql`
      select p.*,
        (select count(*)::int from price_list_items i where i.price_list_id = p.id) as item_count,
        (select count(*)::int from contacts c where c.price_list_id = p.id) as customer_count,
        (select coalesce(json_agg(x.name), '[]'::json) from (select coalesce(c.company_name, c.name) as name from contacts c where c.price_list_id = p.id order by c.name limit 4) x) as customers,
        (select coalesce(sum(d.total_paise), 0) from sales_documents d join contacts c on c.id = d.contact_id
           where c.price_list_id = p.id and d.tenant_id = ${t}::uuid and d.kind = 'invoice' and d.status not in ('draft', 'cancelled') and d.issue_date >= ${todayIST()}::date - 30) as sold30_paise
      from price_lists p where p.tenant_id = ${t}::uuid order by p.name`,
  });
  const data = b.rows.map((r) => ({ ...r, id: r.id as string, itemCount: r.itemCount as number, customerCount: r.customerCount as number, sold30Paise: big(r.sold30Paise) }));
  return {
    data,
    sums: {
      lists: data.length, customers: data.reduce((a, r) => a + (r.customerCount as number), 0), prices: data.reduce((a, r) => a + (r.itemCount as number), 0),
      sold30: data.reduce((a, r) => a + r.sold30Paise, 0n),
    },
  };
}
