import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { dateOnly, todayIST } from '../../kernel/gst';
import { allocateNumber } from '../../kernel/sequences';
import { DateStr } from '../../kernel/query';
import { audit } from '../audit/service';
import { resolveAccount } from '../finance/service';
import { checkDate, getPurchase, setBillStatus } from './service';

// Payments made: one payment to a supplier, split over their unpaid invoices. Each bill gets its own
// row (that is how a bill knows what it was paid) and all rows share one payment number.
// There are no supplier advances here: what is paid goes on bills.

const CASH_LIMIT = 1_000_000n; // ₹10,000 a day to one party, Section 40A(3) Income Tax Act

export const PayInput = z.object({
  contactId: z.string().uuid(),
  amountPaise: z.number().int().positive(),
  method: z.enum(['cash', 'upi', 'card', 'bank', 'cheque', 'other']),
  reference: z.string().trim().max(100).optional().nullable(),
  paidOn: DateStr.optional(),
  /** The cash or bank account it was paid from; empty = by method */
  accountId: z.string().uuid().optional().nullable(),
  allocations: z.array(z.object({ documentId: z.string().uuid(), amountPaise: z.number().int().positive() })).min(1, 'Put the payment on at least one invoice').max(200),
}).superRefine((v, ctx) => {
  if (['cheque', 'bank'].includes(v.method) && !v.reference?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['reference'], message: v.method === 'cheque' ? 'Enter the cheque number' : 'Enter the bank reference (UTR)' });
  }
  const put = v.allocations.reduce((s, a) => s + a.amountPaise, 0);
  if (put !== v.amountPaise) ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'Put all of the payment on invoices' });
  if (new Set(v.allocations.map((a) => a.documentId)).size !== v.allocations.length) ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'An invoice is listed twice' });
});
export type PayInput = z.infer<typeof PayInput>;

/** A supplier's posted invoices that still owe money, oldest first. */
export async function openSupplierBills(ctx: TenantCtx, contactId: string) {
  const today = dateOnly(todayIST());
  const rows = await db().purchaseDocument.findMany({
    where: { tenantId: ctx.tenantId, contactId, kind: 'purchase_bill', status: { in: ['unpaid', 'part_paid'] } },
    select: { id: true, number: true, supplierRef: true, supplierDate: true, issueDate: true, dueDate: true, totalPaise: true, paidPaise: true, returnedPaise: true },
    orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
  });
  return rows
    .map((r) => ({ id: r.id, number: r.number, supplierRef: r.supplierRef, date: r.supplierDate ?? r.issueDate, dueDate: r.dueDate, duePaise: r.totalPaise - r.paidPaise - r.returnedPaise, overdue: !!r.dueDate && r.dueDate < today }))
    .filter((r) => r.duePaise > 0n);
}

export async function paySuppliers(ctx: TenantCtx, input: PayInput) {
  const contact = await db().contact.findFirst({ where: { id: input.contactId, tenantId: ctx.tenantId }, select: { id: true, name: true, companyName: true } });
  if (!contact) throw new AppError('VALIDATION_FAILED', 'Choose the supplier.', { fields: { contactId: 'Choose the supplier' } });
  const paidOn = checkDate(input.paidOn ?? todayIST(), 'paidOn');
  const open = new Map((await openSupplierBills(ctx, input.contactId)).map((b) => [b.id, b]));
  input.allocations.forEach((a, i) => {
    const bill = open.get(a.documentId);
    if (!bill) throw new AppError('VALIDATION_FAILED', 'This invoice is not open for this supplier.', { fields: { [`allocations.${i}.amountPaise`]: 'Not open' } });
    if (BigInt(a.amountPaise) > bill.duePaise) {
      const msg = `Only ₹${(Number(bill.duePaise) / 100).toFixed(2)} is due`;
      throw new AppError('VALIDATION_FAILED', `${bill.supplierRef ?? bill.number}: ${msg.toLowerCase()}.`, { fields: { [`allocations.${i}.amountPaise`]: msg } });
    }
    if (paidOn < dateOnly(bill.date.toISOString().slice(0, 10))) throw new AppError('VALIDATION_FAILED', `A payment can't be dated before invoice ${bill.supplierRef ?? bill.number}.`, { fields: { paidOn: 'Before an invoice' } });
  });
  if (input.method === 'cash') {
    const sameDay = await db().supplierPayment.aggregate({ where: { tenantId: ctx.tenantId, contactId: input.contactId, method: 'cash', paidOn }, _sum: { amountPaise: true } });
    if ((sameDay._sum.amountPaise ?? 0n) + BigInt(input.amountPaise) > CASH_LIMIT) {
      throw new AppError('VALIDATION_FAILED', 'Cash to one supplier above ₹10,000 in a day is not allowed as a business expense (Section 40A(3)). Pay by bank or UPI.', { fields: { method: 'Over ₹10,000 in cash' } });
    }
  }
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { fyStartMonth: true } });
  const { number } = await allocateNumber(ctx.tenantId, 'supplier_payment', tenant.fyStartMonth, paidOn);
  const accountId = await resolveAccount(ctx, input.accountId, input.method);
  let first = '';
  for (const a of input.allocations) {
    const bill = await getPurchase(ctx, a.documentId, 'purchase_bill');
    const row = await db().supplierPayment.create({
      data: { tenantId: ctx.tenantId, contactId: input.contactId, documentId: bill.id, number, amountPaise: BigInt(a.amountPaise), method: input.method, accountId, reference: input.reference?.trim() || null, paidOn, createdBy: ctx.userId },
    });
    first ||= row.id;
    await setBillStatus(bill, bill.paidPaise + BigInt(a.amountPaise), bill.returnedPaise);
  }
  await audit({ action: 'inventory.supplier_payment.create', entity: 'supplier_payment', entityId: first, after: { number, supplier: contact.companyName || contact.name, amountPaise: input.amountPaise, bills: input.allocations.length } });
  return getSupplierPayment(ctx, first);
}

type Row = Awaited<ReturnType<typeof rowsOf>>[number];
async function rowsOf(ctx: TenantCtx, where: object) {
  return db().supplierPayment.findMany({ where: { tenantId: ctx.tenantId, reversesId: null, amountPaise: { gt: 0 }, ...where }, orderBy: { id: 'desc' }, take: 1000 });
}

/** Rows that share a number are one payment */
async function group(ctx: TenantCtx, rows: Row[]) {
  const ids = rows.map((r) => r.id);
  const [reversals, bills, contacts] = await Promise.all([
    ids.length ? db().supplierPayment.findMany({ where: { reversesId: { in: ids } }, select: { reversesId: true, number: true, paidOn: true } }) : [],
    db().purchaseDocument.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.documentId))] } }, select: { id: true, number: true, supplierRef: true } }),
    db().contact.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.contactId))] } }, select: { id: true, name: true, companyName: true, phone: true } }),
  ]);
  const reversed = new Map(reversals.map((r) => [r.reversesId!, r]));
  const billOf = new Map(bills.map((b) => [b.id, b]));
  const who = new Map(contacts.map((c) => [c.id, c]));
  const out = new Map<string, { id: string; number: string; paidOn: Date; method: string; reference: string | null; contactId: string; supplier: string; supplierPhone: string | null; amountPaise: bigint; reversed: boolean; reversal: { number: string; paidOn: Date } | null; appliedTo: { id: string; paymentId: string; number: string | null; supplierRef: string | null; amountPaise: bigint }[] }>();
  for (const r of rows) {
    const key = `${r.contactId}|${r.number}`;
    const c = who.get(r.contactId);
    const g = out.get(key) ?? { id: r.id, number: r.number, paidOn: r.paidOn, method: r.method, reference: r.reference, contactId: r.contactId, supplier: c?.companyName || c?.name || 'Supplier', supplierPhone: c?.phone ?? null, amountPaise: 0n, reversed: false, reversal: null, appliedTo: [] };
    const b = billOf.get(r.documentId);
    g.amountPaise += r.amountPaise;
    g.appliedTo.push({ id: r.documentId, paymentId: r.id, number: b?.number ?? null, supplierRef: b?.supplierRef ?? null, amountPaise: r.amountPaise });
    const rev = reversed.get(r.id);
    if (rev) { g.reversed = true; g.reversal = { number: rev.number, paidOn: rev.paidOn }; }
    out.set(key, g);
  }
  return [...out.values()];
}

export async function getSupplierPayment(ctx: TenantCtx, id: string) {
  const one = await db().supplierPayment.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!one) throw notFound('Payment');
  const [g] = await group(ctx, await rowsOf(ctx, { contactId: one.contactId, number: one.number }));
  if (!g) throw notFound('Payment');
  return g;
}

export const PaymentList = z.object({
  from: DateStr.optional(),
  to: DateStr.optional(),
  method: z.enum(['cash', 'upi', 'card', 'bank', 'cheque', 'other']).optional(),
  contactId: z.string().uuid().optional(),
});

/** Payments made, newest first, the last 1,000 rows (searched and paged on the screen) */
export async function listSupplierPayments(ctx: TenantCtx, q: z.infer<typeof PaymentList>) {
  const rows = await rowsOf(ctx, {
    ...(q.from || q.to ? { paidOn: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } } : {}),
    ...(q.method ? { method: q.method } : {}),
    ...(q.contactId ? { contactId: q.contactId } : {}),
  });
  return { data: await group(ctx, rows) };
}

/** Undo a whole payment: an opposite row on each invoice it was on */
export async function reverseSupplierPaymentGroup(ctx: TenantCtx, id: string) {
  const g = await getSupplierPayment(ctx, id);
  if (g.reversed) throw new AppError('CONFLICT', 'This payment is already reversed.');
  for (const a of g.appliedTo) {
    const p = await db().supplierPayment.findUniqueOrThrow({ where: { id: a.paymentId } });
    const bill = await getPurchase(ctx, p.documentId, 'purchase_bill');
    await db().supplierPayment.create({
      data: { tenantId: ctx.tenantId, contactId: p.contactId, documentId: p.documentId, number: `${p.number}-R`, amountPaise: -p.amountPaise, method: p.method, accountId: p.accountId, reference: p.reference, paidOn: dateOnly(todayIST()), reversesId: p.id, createdBy: ctx.userId },
    });
    await setBillStatus(bill, bill.paidPaise - p.amountPaise, bill.returnedPaise);
  }
  await audit({ action: 'inventory.supplier_payment.reverse', entity: 'supplier_payment', entityId: id, after: { number: g.number, amountPaise: g.amountPaise } });
  return getSupplierPayment(ctx, id);
}
