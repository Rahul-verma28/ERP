import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '../../kernel/db';
import type { TenantCtx } from '../../kernel/context';
import { dateOnly } from '../../kernel/gst';
import { DateStr, scopeWhere } from '../../kernel/query';
import { xlsx } from '../../kernel/zip';

// Sales reports and the GST working sheet for the CA. Credit notes count against sales on the
// day they are issued. The GST sheet helps prepare returns; it files nothing, and its layout
// must be checked by the client's CA.

export const ReportPeriod = z.object({ from: DateStr, to: DateStr });
type Period = z.infer<typeof ReportPeriod>;

// tenantId on top of row-level security, so a report can never add up another business
const docScope = (ctx: TenantCtx): Prisma.SalesDocumentWhereInput => ({ AND: [{ tenantId: ctx.tenantId }, scopeWhere(ctx, { owner: ['createdBy'], branch: 'branchId' })] });
const LIVE: Prisma.SalesDocumentWhereInput = {
  OR: [{ kind: { in: ['invoice', 'debit_note'] }, status: { in: ['issued', 'partially_paid', 'paid'] } }, { kind: 'credit_note', status: 'issued' }],
};
const inPeriod = (p: Period) => ({ gte: dateOnly(p.from), lte: dateOnly(p.to) });
const buyerOf = (d: { buyer: unknown }) => (d.buyer ?? {}) as { name?: string; gstin?: string | null };

interface Bucket { key: string; label: string; invoices: number; creditNotes: number; taxablePaise: bigint; taxPaise: bigint; totalPaise: bigint }

export async function salesReport(ctx: TenantCtx, groupBy: 'day' | 'month' | 'customer', p: Period) {
  const docs = await db().salesDocument.findMany({
    where: { AND: [docScope(ctx), LIVE, { issueDate: inPeriod(p) }] },
    select: { kind: true, issueDate: true, contactId: true, buyer: true, taxablePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, totalPaise: true },
  });
  const buckets = new Map<string, Bucket>();
  for (const d of docs) {
    const iso = d.issueDate.toISOString().slice(0, 10);
    const name = buyerOf(d).name ?? 'Customer';
    const key = groupBy === 'day' ? iso : groupBy === 'month' ? iso.slice(0, 7) : d.contactId ?? `name:${name}`;
    const b = buckets.get(key) ?? { key, label: groupBy === 'customer' ? name : key, invoices: 0, creditNotes: 0, taxablePaise: 0n, taxPaise: 0n, totalPaise: 0n };
    const sign = d.kind === 'credit_note' ? -1n : 1n;
    if (d.kind === 'credit_note') b.creditNotes++;
    else if (d.kind === 'invoice') b.invoices++;
    b.taxablePaise += sign * d.taxablePaise;
    b.taxPaise += sign * (d.cgstPaise + d.sgstPaise + d.igstPaise);
    b.totalPaise += sign * d.totalPaise;
    buckets.set(key, b);
  }
  const rows = [...buckets.values()].sort((a, b) => (groupBy === 'customer' ? (a.totalPaise > b.totalPaise ? -1 : 1) : a.key < b.key ? 1 : -1));
  return { rows };
}

export async function itemReport(ctx: TenantCtx, p: Period) {
  const lines = await db().salesDocumentLine.findMany({
    where: { document: { AND: [docScope(ctx), LIVE, { issueDate: inPeriod(p) }] } },
    select: { itemId: true, description: true, unit: true, quantity: true, freeQuantity: true, taxablePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, totalPaise: true, document: { select: { kind: true, noteType: true } } },
  });
  const rows = new Map<string, { key: string; label: string; unit: string; quantity: number; taxablePaise: bigint; taxPaise: bigint; totalPaise: bigint }>();
  for (const l of lines) {
    const key = l.itemId ?? `line:${l.description.toLowerCase()}`;
    const credit = l.document.kind === 'credit_note';
    const unit = l.unit === 'adj' ? '' : l.unit;
    const r = rows.get(key) ?? { key, label: l.description, unit, quantity: 0, taxablePaise: 0n, taxPaise: 0n, totalPaise: 0n };
    const sign = credit ? -1n : 1n;
    // Reducing the amount only brings no goods back
    if (l.document.kind === 'invoice') r.quantity += Number(l.quantity) + Number(l.freeQuantity);
    else if (l.document.noteType === 'return') r.quantity -= Number(l.quantity);
    if (!r.unit) r.unit = unit;
    r.taxablePaise += sign * l.taxablePaise;
    r.taxPaise += sign * (l.cgstPaise + l.sgstPaise + l.igstPaise);
    r.totalPaise += sign * l.totalPaise;
    rows.set(key, r);
  }
  return { rows: [...rows.values()].map((r) => ({ ...r, quantity: Math.round(r.quantity * 1000) / 1000 })).sort((a, b) => (a.totalPaise > b.totalPaise ? -1 : 1)) };
}

const METHODS = ['cash', 'upi', 'card', 'bank', 'cheque', 'other'] as const;

/** Money in by day and method. Refunds and reversals take it back on their own day. */
export async function collectionReport(ctx: TenantCtx, p: Period) {
  const payments = await db().payment.findMany({
    where: { AND: [{ tenantId: ctx.tenantId }, scopeWhere(ctx, { owner: ['createdBy'] }), { paidOn: inPeriod(p) }] },
    select: { paidOn: true, method: true, amountPaise: true },
  });
  const rows = new Map<string, Record<(typeof METHODS)[number], bigint> & { date: string; totalPaise: bigint }>();
  for (const pay of payments) {
    const date = pay.paidOn.toISOString().slice(0, 10);
    const r = rows.get(date) ?? { date, totalPaise: 0n, cash: 0n, upi: 0n, card: 0n, bank: 0n, cheque: 0n, other: 0n };
    r[pay.method as (typeof METHODS)[number]] += pay.amountPaise;
    r.totalPaise += pay.amountPaise;
    rows.set(date, r);
  }
  return { rows: [...rows.values()].sort((a, b) => (a.date < b.date ? 1 : -1)) };
}

/** The GST working sheet: B2B invoices, B2C summary, credit notes, HSN summary and a check of totals. */
export async function gstReport(ctx: TenantCtx, p: Period) {
  const docs = await db().salesDocument.findMany({
    where: { AND: [docScope(ctx), LIVE, { issueDate: inPeriod(p) }] },
    include: { lines: true },
    orderBy: [{ issueDate: 'asc' }, { number: 'asc' }],
  });
  const taxes = () => ({ taxablePaise: 0n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n });
  type Line = (typeof docs)[number]['lines'][number];
  const add = (t: ReturnType<typeof taxes>, l: Line, sign = 1n) => {
    t.taxablePaise += sign * l.taxablePaise;
    t.cgstPaise += sign * l.cgstPaise;
    t.sgstPaise += sign * l.sgstPaise;
    t.igstPaise += sign * l.igstPaise;
  };
  const byRate = (lines: Line[]) => {
    const rates = new Map<number, ReturnType<typeof taxes>>();
    for (const l of lines) {
      const t = rates.get(l.gstRateBp) ?? taxes();
      add(t, l);
      rates.set(l.gstRateBp, t);
    }
    return [...rates.entries()].map(([gstRateBp, t]) => ({ gstRateBp, ...t }));
  };

  const b2b = [];
  const b2cMap = new Map<string, { placeOfSupply: string | null; gstRateBp: number } & ReturnType<typeof taxes>>();
  const creditNotes = [];
  const hsnMap = new Map<string, { hsnSac: string | null; gstRateBp: number; unit: string; quantity: number } & ReturnType<typeof taxes>>();
  const totals = { ...taxes(), totalPaise: 0n, roundOffPaise: 0n, invoices: 0, creditNotes: 0, debitNotes: 0, billOfSupplyPaise: 0n, stockWrittenOffPaise: 0n };

  for (const d of docs) {
    // A bill of supply carries no GST and is not part of these sheets; only its total is shown
    const seller = d.seller as { billOfSupply?: boolean; unregistered?: boolean } | null;
    if (seller?.billOfSupply || seller?.unregistered) {
      totals.billOfSupplyPaise += (d.kind === 'credit_note' ? -1n : 1n) * d.totalPaise;
      continue;
    }
    const buyer = buyerOf(d);
    const credit = d.kind === 'credit_note';
    const sign = credit ? -1n : 1n;
    totals.taxablePaise += sign * d.taxablePaise;
    totals.cgstPaise += sign * d.cgstPaise;
    totals.sgstPaise += sign * d.sgstPaise;
    totals.igstPaise += sign * d.igstPaise;
    totals.totalPaise += sign * d.totalPaise;
    totals.roundOffPaise += sign * d.roundOffPaise;
    if (credit) totals.creditNotes++;
    else if (d.kind === 'debit_note') totals.debitNotes++;
    else totals.invoices++;

    const head = { number: d.number, date: d.issueDate.toISOString().slice(0, 10), buyerName: buyer.name ?? null, gstin: buyer.gstin ?? null, placeOfSupply: d.placeOfSupply };
    if (d.kind !== 'invoice') creditNotes.push(...byRate(d.lines).map((r) => ({ ...head, invoiceNumber: d.sourceNumber, noteType: d.kind === 'debit_note' ? 'debit' : d.noteType, ...r })));
    else if (buyer.gstin) b2b.push(...byRate(d.lines).map((r) => ({ ...head, totalPaise: d.totalPaise, ...r })));
    else {
      for (const r of byRate(d.lines)) {
        const key = `${d.placeOfSupply}-${r.gstRateBp}`;
        const row = b2cMap.get(key) ?? { placeOfSupply: d.placeOfSupply, gstRateBp: r.gstRateBp, ...taxes() };
        row.taxablePaise += r.taxablePaise;
        row.cgstPaise += r.cgstPaise;
        row.sgstPaise += r.sgstPaise;
        row.igstPaise += r.igstPaise;
        b2cMap.set(key, row);
      }
    }
    for (const l of d.lines) {
      const unit = l.unit === 'adj' ? '' : l.unit;
      const key = `${l.hsnSac ?? ''}-${l.gstRateBp}`;
      const row = hsnMap.get(key) ?? { hsnSac: l.hsnSac, gstRateBp: l.gstRateBp, unit, quantity: 0, ...taxes() };
      if (!row.unit) row.unit = unit;
      if (d.kind === 'invoice') row.quantity += Number(l.quantity) + Number(l.freeQuantity);
      else if (d.noteType === 'return') row.quantity -= Number(l.quantity);
      add(row, l, sign);
      hsnMap.set(key, row);
    }
  }
  // Section 17(5)(h): goods lost, stolen, destroyed, written off or given as free samples need the
  // input tax credit on them reversed. Their cost is listed here for the CA; the tax on it is theirs to work out.
  const writtenOff = await db().$queryRaw<{ value: unknown }[]>`
    SELECT SUM(-m.value_paise) AS value FROM stock_moves m LEFT JOIN stock_entries e ON e.id = m.source_id
    WHERE m.tenant_id = ${ctx.tenantId}::uuid AND m.source_type = 'stock_entry' AND m.reverses_id IS NULL AND m.quantity < 0
      AND m.kind IN ('adjustment', 'count') AND (m.kind = 'count' OR e.reason IN ('damage', 'loss', 'sample', 'expired'))
      AND m.move_date >= ${dateOnly(p.from)} AND m.move_date <= ${dateOnly(p.to)}`;
  totals.stockWrittenOffPaise = BigInt(String(writtenOff[0]?.value ?? 0));
  return {
    b2b,
    b2c: [...b2cMap.values()],
    creditNotes,
    hsn: [...hsnMap.values()].map((r) => ({ ...r, quantity: Math.round(r.quantity * 1000) / 1000 })),
    totals,
  };
}

/** Orders with something still to bill or send, line by line. */
export async function pendingOrders(ctx: TenantCtx) {
  const orders = await db().salesDocument.findMany({
    where: { AND: [docScope(ctx), { kind: 'sales_order', status: { in: ['open', 'part_invoiced'] } }] },
    include: { lines: { orderBy: { position: 'asc' } } },
    orderBy: { issueDate: 'asc' },
  });
  const done = await db().salesDocumentLine.findMany({
    where: { sourceLineId: { in: orders.flatMap((o) => o.lines.map((l) => l.id)) }, document: { kind: { in: ['invoice', 'delivery_challan'] }, status: { not: 'cancelled' } } },
    select: { sourceLineId: true, quantity: true },
  });
  const rows = [];
  for (const o of orders) {
    for (const l of o.lines) {
      const billed = done.filter((d) => d.sourceLineId === l.id).reduce((s, d) => s + Number(d.quantity), 0);
      const left = Math.round((Number(l.quantity) - billed) * 1000) / 1000;
      if (left <= 0) continue;
      rows.push({
        orderId: o.id, number: o.number, date: o.issueDate.toISOString().slice(0, 10), deliverBy: o.dueDate?.toISOString().slice(0, 10) ?? null, customer: buyerOf(o).name ?? 'Customer',
        item: l.description, unit: l.unit, ordered: Number(l.quantity), billed, left, valuePaise: Math.round((Number(l.totalPaise) * left) / Number(l.quantity)),
      });
    }
  }
  return { rows };
}

const rupees = (p: bigint) => Number(p) / 100;
const pct = (bp: number) => bp / 100;

export async function gstWorkbook(ctx: TenantCtx, p: Period) {
  const r = await gstReport(ctx, p);
  const amounts = (x: { taxablePaise: bigint; cgstPaise: bigint; sgstPaise: bigint; igstPaise: bigint }) => [rupees(x.taxablePaise), rupees(x.cgstPaise), rupees(x.sgstPaise), rupees(x.igstPaise)];
  const body = xlsx([
    { name: 'B2B invoices', rows: [['Invoice', 'Date', 'Customer', 'GSTIN', 'Place of supply', 'Invoice value (₹)', 'GST rate (%)', 'Taxable (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)'], ...r.b2b.map((x) => [x.number, x.date, x.buyerName, x.gstin, x.placeOfSupply, rupees(x.totalPaise), pct(x.gstRateBp), ...amounts(x)])] },
    { name: 'B2C summary', rows: [['Place of supply', 'GST rate (%)', 'Taxable (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)'], ...r.b2c.map((x) => [x.placeOfSupply, pct(x.gstRateBp), ...amounts(x)])] },
    { name: 'Credit and debit notes', rows: [['Note', 'Date', 'Against invoice', 'Customer', 'GSTIN', 'Place of supply', 'Type', 'GST rate (%)', 'Taxable (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)'], ...r.creditNotes.map((x) => [x.number, x.date, x.invoiceNumber, x.buyerName, x.gstin, x.placeOfSupply, x.noteType, pct(x.gstRateBp), ...amounts(x)])] },
    { name: 'HSN summary', rows: [['HSN/SAC', 'Unit', 'Quantity', 'GST rate (%)', 'Taxable (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)'], ...r.hsn.map((x) => [x.hsnSac, x.unit, x.quantity, pct(x.gstRateBp), ...amounts(x)])] },
    { name: 'Totals', rows: [['From', 'To', 'Invoices', 'Credit notes', 'Taxable (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)', 'Round-off (₹)', 'Total (₹)'], [p.from, p.to, r.totals.invoices, r.totals.creditNotes, ...amounts(r.totals), rupees(r.totals.roundOffPaise), rupees(r.totals.totalPaise)]] },
  ]);
  return { filename: `gst-report-${p.from}-to-${p.to}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body };
}
