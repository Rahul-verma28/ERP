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
  OR: [{ kind: 'invoice', status: { in: ['issued', 'partially_paid', 'paid'] } }, { kind: 'credit_note', status: 'issued' }],
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
    else b.invoices++;
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
    select: { itemId: true, description: true, unit: true, quantity: true, taxablePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, totalPaise: true, document: { select: { kind: true, noteType: true } } },
  });
  const rows = new Map<string, { key: string; label: string; unit: string; quantity: number; taxablePaise: bigint; taxPaise: bigint; totalPaise: bigint }>();
  for (const l of lines) {
    const key = l.itemId ?? `line:${l.description.toLowerCase()}`;
    const credit = l.document.kind === 'credit_note';
    const r = rows.get(key) ?? { key, label: l.description, unit: credit ? '' : l.unit, quantity: 0, taxablePaise: 0n, taxPaise: 0n, totalPaise: 0n };
    const sign = credit ? -1n : 1n;
    // Reducing the amount only brings no goods back
    if (!credit) r.quantity += Number(l.quantity);
    else if (l.document.noteType === 'return') r.quantity -= Number(l.quantity);
    if (!credit && !r.unit) r.unit = l.unit;
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
  const totals = { ...taxes(), totalPaise: 0n, roundOffPaise: 0n, invoices: 0, creditNotes: 0 };

  for (const d of docs) {
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
    else totals.invoices++;

    const head = { number: d.number, date: d.issueDate.toISOString().slice(0, 10), buyerName: buyer.name ?? null, gstin: buyer.gstin ?? null, placeOfSupply: d.placeOfSupply };
    if (credit) creditNotes.push(...byRate(d.lines).map((r) => ({ ...head, invoiceNumber: d.sourceNumber, noteType: d.noteType, ...r })));
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
      if (!credit) row.quantity += Number(l.quantity);
      else if (d.noteType === 'return') row.quantity -= Number(l.quantity);
      add(row, l, sign);
      hsnMap.set(key, row);
    }
  }
  return {
    b2b,
    b2c: [...b2cMap.values()],
    creditNotes,
    hsn: [...hsnMap.values()].map((r) => ({ ...r, quantity: Math.round(r.quantity * 1000) / 1000 })),
    totals,
  };
}

const rupees = (p: bigint) => Number(p) / 100;
const pct = (bp: number) => bp / 100;

export async function gstWorkbook(ctx: TenantCtx, p: Period) {
  const r = await gstReport(ctx, p);
  const amounts = (x: { taxablePaise: bigint; cgstPaise: bigint; sgstPaise: bigint; igstPaise: bigint }) => [rupees(x.taxablePaise), rupees(x.cgstPaise), rupees(x.sgstPaise), rupees(x.igstPaise)];
  const body = xlsx([
    { name: 'B2B invoices', rows: [['Invoice', 'Date', 'Customer', 'GSTIN', 'Place of supply', 'Invoice value (₹)', 'GST rate (%)', 'Taxable (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)'], ...r.b2b.map((x) => [x.number, x.date, x.buyerName, x.gstin, x.placeOfSupply, rupees(x.totalPaise), pct(x.gstRateBp), ...amounts(x)])] },
    { name: 'B2C summary', rows: [['Place of supply', 'GST rate (%)', 'Taxable (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)'], ...r.b2c.map((x) => [x.placeOfSupply, pct(x.gstRateBp), ...amounts(x)])] },
    { name: 'Credit notes', rows: [['Credit note', 'Date', 'Against invoice', 'Customer', 'GSTIN', 'Place of supply', 'Type', 'GST rate (%)', 'Taxable (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)'], ...r.creditNotes.map((x) => [x.number, x.date, x.invoiceNumber, x.buyerName, x.gstin, x.placeOfSupply, x.noteType, pct(x.gstRateBp), ...amounts(x)])] },
    { name: 'HSN summary', rows: [['HSN/SAC', 'Unit', 'Quantity', 'GST rate (%)', 'Taxable (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)'], ...r.hsn.map((x) => [x.hsnSac, x.unit, x.quantity, pct(x.gstRateBp), ...amounts(x)])] },
    { name: 'Totals', rows: [['From', 'To', 'Invoices', 'Credit notes', 'Taxable (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)', 'Round-off (₹)', 'Total (₹)'], [p.from, p.to, r.totals.invoices, r.totals.creditNotes, ...amounts(r.totals), rupees(r.totals.roundOffPaise), rupees(r.totals.totalPaise)]] },
  ]);
  return { filename: `gst-report-${p.from}-to-${p.to}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body };
}
