import { z } from 'zod';
import { db } from '../../kernel/db';
import type { TenantCtx } from '../../kernel/context';
import { dateOnly, todayIST } from '../../kernel/gst';
import { DateStr } from '../../kernel/query';
import { withDefaults } from '../../contracts/workspace';
import { creditNoteDeadline } from '../billing/creditNotes';
import { stockSummary } from '../inventory/service';
import { fromMilli, milli } from '../inventory/engine';
import { createPurchase, getSupplier } from './service';

const DAY = 86_400_000;
const live = { not: 'cancelled' };
export const RangeQuery = z.object({ from: DateStr, to: DateStr });

/** What is owed to each supplier, by how late it is (from each bill's due date, else its date) */
export async function payables(ctx: TenantCtx) {
  const today = dateOnly(todayIST());
  const bills = await db().purchaseDocument.findMany({ where: { tenantId: ctx.tenantId, kind: 'purchase_bill', status: { in: ['unpaid', 'part_paid'] } }, select: { contactId: true, supplier: true, totalPaise: true, paidPaise: true, returnedPaise: true, dueDate: true, supplierDate: true, issueDate: true } });
  const by = new Map<string, { contactId: string; name: string; bills: number; notDuePaise: bigint; d1_30: bigint; d31_60: bigint; d61_90: bigint; d90plus: bigint; totalPaise: bigint }>();
  for (const b of bills) {
    const due = b.totalPaise - b.paidPaise - b.returnedPaise;
    if (due <= 0n) continue;
    const row = by.get(b.contactId) ?? { contactId: b.contactId, name: (b.supplier as { name?: string }).name ?? '', bills: 0, notDuePaise: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d90plus: 0n, totalPaise: 0n };
    const late = Math.floor((today.getTime() - (b.dueDate ?? b.supplierDate ?? b.issueDate).getTime()) / DAY);
    if (late <= 0) row.notDuePaise += due;
    else if (late <= 30) row.d1_30 += due;
    else if (late <= 60) row.d31_60 += due;
    else if (late <= 90) row.d61_90 += due;
    else row.d90plus += due;
    row.bills += 1;
    row.totalPaise += due;
    by.set(b.contactId, row);
  }
  const data = [...by.values()].sort((a, b) => Number(b.totalPaise - a.totalPaise));
  const totals = { notDuePaise: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d90plus: 0n, totalPaise: 0n };
  for (const r of data) for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];
  return { data, nextCursor: null, total: data.length, totals };
}

/** Bills, payments and returns of one supplier in date order, with the running balance owed */
export async function supplierLedger(ctx: TenantCtx, contactId: string, q: { from?: string; to?: string }) {
  const supplier = await getSupplier(ctx, contactId);
  const [docs, pays] = await Promise.all([
    db().purchaseDocument.findMany({ where: { tenantId: ctx.tenantId, contactId, kind: { in: ['purchase_bill', 'purchase_return'] }, status: live }, select: { id: true, kind: true, number: true, supplierRef: true, issueDate: true, supplierDate: true, totalPaise: true, sourceNumber: true }, orderBy: { issueDate: 'asc' } }),
    db().supplierPayment.findMany({ where: { tenantId: ctx.tenantId, contactId }, orderBy: { paidOn: 'asc' } }),
  ]);
  const rows = [
    ...docs.map((d) => ({
      date: d.kind === 'purchase_bill' ? (d.supplierDate ?? d.issueDate) : d.issueDate, at: d.issueDate,
      kind: d.kind, id: d.id, number: d.number, details: d.kind === 'purchase_bill' ? `Bill ${d.supplierRef ?? ''}`.trim() : `Return against ${d.sourceNumber ?? ''}`,
      billPaise: d.kind === 'purchase_bill' ? d.totalPaise : 0n, paidPaise: d.kind === 'purchase_return' ? d.totalPaise : 0n,
    })),
    ...pays.map((p) => ({ date: p.paidOn, at: p.paidOn, kind: p.reversesId ? 'payment_reversal' : 'payment', id: p.documentId, number: p.number, details: `${p.method.toUpperCase()}${p.reference ? ` ${p.reference}` : ''}`, billPaise: 0n, paidPaise: p.amountPaise })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  const from = q.from ? dateOnly(q.from) : null;
  const to = q.to ? dateOnly(q.to) : null;
  let balance = 0n;
  let opening = 0n;
  const data = [];
  for (const r of rows) {
    balance += r.billPaise - r.paidPaise;
    if (from && r.date < from) { opening = balance; continue; }
    if (to && r.date > to) continue;
    data.push({ ...r, balancePaise: balance });
  }
  const closing = data.length ? data[data.length - 1].balancePaise : opening;
  return { supplier, openingPaise: opening, closingPaise: closing, data, nextCursor: null, total: data.length };
}

/** Purchase register: every bill and return in the period with its GST, by the date goods came */
export async function purchaseRegister(ctx: TenantCtx, q: z.infer<typeof RangeQuery>) {
  const docs = await db().purchaseDocument.findMany({
    where: { tenantId: ctx.tenantId, kind: { in: ['purchase_bill', 'purchase_return'] }, status: live, issueDate: { gte: dateOnly(q.from), lte: dateOnly(q.to) } },
    orderBy: [{ issueDate: 'asc' }, { number: 'asc' }],
  });
  const totals = { taxablePaise: 0n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n, totalPaise: 0n, bills: 0, returns: 0 };
  const data = docs.map((d) => {
    const sign = d.kind === 'purchase_return' ? -1n : 1n;
    totals.taxablePaise += sign * d.taxablePaise;
    totals.cgstPaise += sign * d.cgstPaise;
    totals.sgstPaise += sign * d.sgstPaise;
    totals.igstPaise += sign * d.igstPaise;
    totals.totalPaise += sign * d.totalPaise;
    if (d.kind === 'purchase_bill') totals.bills += 1; else totals.returns += 1;
    const s = d.supplier as { name?: string; gstin?: string | null; stateCode?: string | null };
    return {
      id: d.id, kind: d.kind, number: d.number, date: d.issueDate, supplierRef: d.supplierRef, supplierDate: d.supplierDate, supplier: s.name ?? '', gstin: s.gstin ?? null, stateCode: s.stateCode ?? null,
      reverseCharge: d.reverseCharge, taxablePaise: sign * d.taxablePaise, cgstPaise: sign * d.cgstPaise, sgstPaise: sign * d.sgstPaise, igstPaise: sign * d.igstPaise, totalPaise: sign * d.totalPaise,
    };
  });
  return { data, nextCursor: null, total: data.length, totals };
}

/**
 * Input tax credit register. Lists the GST on bills from registered suppliers, less returns, with
 * what the CA must watch: reverse charge (paid in cash first, Section 49(4)), bills unpaid after 180
 * days (credit reversed, Rule 37), the last day to claim (Section 16(4)), and no credit at all on
 * composition (Section 10(4)) or without a GSTIN.
 */
export async function itcRegister(ctx: TenantCtx, q: z.infer<typeof RangeQuery>) {
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const taxes = withDefaults(tenant.preferences, tenant.profile).taxes;
  const eligible = !!tenant.gstin && !taxes.composition;
  const today = dateOnly(todayIST());
  const docs = await db().purchaseDocument.findMany({
    where: { tenantId: ctx.tenantId, kind: { in: ['purchase_bill', 'purchase_return'] }, status: live, issueDate: { gte: dateOnly(q.from), lte: dateOnly(q.to) } },
    orderBy: [{ issueDate: 'asc' }, { number: 'asc' }],
  });
  const totals = { cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n, reverseChargePaise: 0n, at180Paise: 0n };
  const data = [];
  for (const d of docs) {
    const s = d.supplier as { name?: string; gstin?: string | null };
    const tax = d.cgstPaise + d.sgstPaise + d.igstPaise;
    if (!s.gstin && !d.reverseCharge) continue;
    if (tax === 0n) continue;
    const sign = d.kind === 'purchase_return' ? -1n : 1n;
    const billDate = d.supplierDate ?? d.issueDate;
    const unpaid180 = d.kind === 'purchase_bill' && !d.reverseCharge && d.totalPaise - d.paidPaise - d.returnedPaise > 0n && today.getTime() - billDate.getTime() > 180 * DAY;
    totals.cgstPaise += sign * d.cgstPaise;
    totals.sgstPaise += sign * d.sgstPaise;
    totals.igstPaise += sign * d.igstPaise;
    if (d.reverseCharge) totals.reverseChargePaise += sign * tax;
    if (unpaid180) totals.at180Paise += tax;
    data.push({
      id: d.id, kind: d.kind, number: d.number, supplierRef: d.supplierRef, supplierDate: billDate, supplier: s.name ?? '', gstin: s.gstin ?? null,
      taxablePaise: sign * d.taxablePaise, cgstPaise: sign * d.cgstPaise, sgstPaise: sign * d.sgstPaise, igstPaise: sign * d.igstPaise,
      reverseCharge: d.reverseCharge, unpaid180, claimBy: creditNoteDeadline(billDate),
    });
  }
  return { eligible, reason: eligible ? null : !tenant.gstin ? 'Your business has no GSTIN, so it cannot take input tax credit.' : 'On the composition scheme no input tax credit is allowed (Section 10(4)).', data, nextCursor: null, total: data.length, totals };
}

/** Order lines still to come, oldest order first */
export async function pendingOrders(ctx: TenantCtx) {
  const orders = await db().purchaseDocument.findMany({ where: { tenantId: ctx.tenantId, kind: 'purchase_order', status: { in: ['open', 'part_received'] } }, include: { lines: true }, orderBy: { issueDate: 'asc' } });
  const lineIds = orders.flatMap((o) => o.lines.map((l) => l.id));
  const got = lineIds.length
    ? await db().purchaseDocumentLine.findMany({ where: { sourceLineId: { in: lineIds }, document: { kind: { in: ['goods_receipt', 'purchase_bill'] }, status: live } }, select: { sourceLineId: true, quantity: true } })
    : [];
  const received = new Map<string, bigint>();
  for (const g of got) received.set(g.sourceLineId!, (received.get(g.sourceLineId!) ?? 0n) + milli(g.quantity));
  const today = dateOnly(todayIST());
  const data = orders.flatMap((o) => o.lines.map((l) => {
    const left = milli(l.quantity) - (received.get(l.id) ?? 0n);
    return left > 0n ? {
      id: l.id, orderId: o.id, number: o.number, date: o.issueDate, expected: o.dueDate, late: !!o.dueDate && o.dueDate < today, supplier: (o.supplier as { name?: string }).name ?? '', contactId: o.contactId,
      itemId: l.itemId, description: l.description, unit: l.unit, ordered: Number(l.quantity), received: fromMilli(received.get(l.id) ?? 0n), pending: fromMilli(left),
      pendingPaise: (l.taxablePaise * left) / (milli(l.quantity) || 1n),
    } : null;
  }).filter((x) => x !== null));
  return { data, nextCursor: null, total: data.length };
}

/** Items at or under their reorder level, with what is already on order, grouped by usual supplier */
export async function reorderList(ctx: TenantCtx) {
  const low = (await stockSummary(ctx, { low: 'true' })).data.map((r) => ({ ...r, itemId: r.id }));
  if (!low.length) return { data: [], nextCursor: null, total: 0 };
  const [items, pending] = await Promise.all([
    db().item.findMany({ where: { id: { in: low.map((r) => r.itemId) } }, select: { id: true, preferredSupplierId: true, costPricePaise: true, gstRateBp: true, reorderLevel: true } }),
    pendingOrders(ctx),
  ]);
  const onOrder = new Map<string, number>();
  for (const p of pending.data) if (p.itemId) onOrder.set(p.itemId, (onOrder.get(p.itemId) ?? 0) + p.pending);
  const supplierIds = [...new Set(items.map((i) => i.preferredSupplierId).filter(Boolean))] as string[];
  const suppliers = supplierIds.length ? await db().contact.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, companyName: true } }) : [];
  const data = low.map((r) => {
    const it = items.find((i) => i.id === r.itemId)!;
    const sup = suppliers.find((s) => s.id === it.preferredSupplierId);
    const have = r.available + (onOrder.get(r.itemId) ?? 0);
    const level = Number(it.reorderLevel ?? 0);
    // Order back up to twice the reorder level, less what is already coming (decision P7)
    const suggest = Math.max(0, Math.ceil(level * 2 - have));
    return { id: r.itemId, itemId: r.itemId, name: r.name, unit: r.unit, available: r.available, reorderLevel: level, onOrder: onOrder.get(r.itemId) ?? 0, suggest, supplierId: sup?.id ?? null, supplier: sup ? sup.companyName || sup.name : null, ratePaise: it.costPricePaise, gstRateBp: it.gstRateBp };
  });
  return { data, nextCursor: null, total: data.length };
}

export const DraftOrdersInput = z.object({
  lines: z.array(z.object({ itemId: z.string().uuid(), contactId: z.string().uuid(), quantity: z.number().positive().max(1e7) })).min(1).max(300),
});

/** One purchase order per supplier from the chosen low-stock lines, at the last purchase price */
export async function ordersFromReorder(ctx: TenantCtx, input: z.infer<typeof DraftOrdersInput>) {
  const items = await db().item.findMany({ where: { tenantId: ctx.tenantId, id: { in: input.lines.map((l) => l.itemId) } } });
  const bySupplier = new Map<string, typeof input.lines>();
  for (const l of input.lines) bySupplier.set(l.contactId, [...(bySupplier.get(l.contactId) ?? []), l]);
  const made = [];
  for (const [contactId, lines] of bySupplier) {
    const po = await createPurchase(ctx, 'purchase_order', {
      contactId, reverseCharge: false, chargesPaise: 0, chargesGstBp: 0, roundOff: true, notes: 'Made from the low stock list',
      lines: lines.map((l) => {
        const it = items.find((i) => i.id === l.itemId)!;
        return { itemId: it.id, quantity: l.quantity, unitPricePaise: Number(it.costPricePaise ?? 0n), discountPaise: 0, gstRateBp: it.gstRateBp, unit: it.unit };
      }),
    });
    made.push({ id: po.id, number: po.number, supplier: (po.supplier as { name?: string }).name ?? '' });
  }
  return { data: made };
}
