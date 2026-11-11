import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { DateStr, inScope, scopeWhere } from '../../kernel/query';
import { dateOnly, todayIST } from '../../kernel/gst';
import { Prisma } from '@prisma/client';
import { publish } from '../events/outbox';
import { audit } from '../audit/service';
import { getDocument, PaymentInput, SCOPE_FIELDS, recordAdvance, recordPayment, removeAdvanceUse, reversePayment, setPaid } from './service';

// Payments received: one receipt from a customer, split over their open bills. Whatever is not
// put on a bill stays with the customer as an advance, to use on a later invoice.

export const ReceiveInput = PaymentInput.extend({
  contactId: z.string().uuid(),
  allocations: z.array(z.object({ documentId: z.string().uuid(), amountPaise: z.number().int().positive() })).max(200).default([]),
}).superRefine((v, ctx) => {
  if (['cheque', 'bank'].includes(v.method) && !v.reference?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['reference'], message: v.method === 'cheque' ? 'Enter the cheque number' : 'Enter the bank reference (UTR)' });
  }
  const put = v.allocations.reduce((s, a) => s + a.amountPaise, 0);
  if (put > v.amountPaise) ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'More is put on bills than was received' });
  if (new Set(v.allocations.map((a) => a.documentId)).size !== v.allocations.length) ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'A bill is listed twice' });
});
export type ReceiveInput = z.infer<typeof ReceiveInput>;

const OPEN_KINDS = ['invoice', 'opening_balance', 'debit_note'] as const;

/** A customer's bills that still owe money, oldest first: what a receipt can be put on. */
export async function openBills(ctx: TenantCtx, contactId: string) {
  const today = dateOnly(todayIST());
  const rows = await db().salesDocument.findMany({
    where: { AND: [{ tenantId: ctx.tenantId, contactId, kind: { in: [...OPEN_KINDS] }, status: { in: ['issued', 'partially_paid'] } }, scopeWhere(ctx, SCOPE_FIELDS)] },
    select: { id: true, kind: true, number: true, issueDate: true, dueDate: true, totalPaise: true, paidPaise: true },
    orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
  });
  return rows
    .map((r) => ({ ...r, duePaise: r.totalPaise - r.paidPaise, overdue: !!r.dueDate && r.dueDate < today }))
    .filter((r) => r.duePaise > 0n);
}

/**
 * Record money from a customer. One bill taking all of it is a plain payment on that bill;
 * anything else is an advance put on each invoice, with what is left kept as advance.
 */
export async function receivePayment(ctx: TenantCtx, input: ReceiveInput) {
  const contact = await db().contact.findFirst({ where: { id: input.contactId, tenantId: ctx.tenantId }, select: { id: true, name: true } });
  if (!contact) throw new AppError('VALIDATION_FAILED', 'Choose the customer.', { fields: { contactId: 'Choose the customer' } });
  if (input.paidOn && dateOnly(input.paidOn) > dateOnly(todayIST())) throw new AppError('VALIDATION_FAILED', 'The payment date cannot be in the future.', { fields: { paidOn: 'In the future' } });
  const open = new Map((await openBills(ctx, input.contactId)).map((b) => [b.id, b]));
  input.allocations.forEach((a, i) => {
    const bill = open.get(a.documentId);
    const field = { fields: { [`allocations.${i}.amountPaise`]: '' } };
    if (!bill) throw new AppError('VALIDATION_FAILED', "This bill is not open for this customer.", { fields: { [`allocations.${i}.amountPaise`]: 'Not open' } });
    if (BigInt(a.amountPaise) > bill.duePaise) {
      field.fields[`allocations.${i}.amountPaise`] = `Only ₹${(Number(bill.duePaise) / 100).toFixed(2)} is due`;
      throw new AppError('VALIDATION_FAILED', `${bill.number}: only ₹${(Number(bill.duePaise) / 100).toFixed(2)} is due.`, field);
    }
  });
  const { contactId, allocations, ...pay } = input;

  // All of it on one bill: a plain payment, the way the bill's own page records it
  if (allocations.length === 1 && allocations[0].amountPaise === input.amountPaise) {
    const bill = open.get(allocations[0].documentId)!;
    await recordPayment(ctx, bill.id, pay, bill.kind as (typeof OPEN_KINDS)[number]);
    const payment = await db().payment.findFirstOrThrow({ where: { documentId: bill.id, reversesId: null }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    return getReceipt(ctx, payment.id);
  }

  // Opening balances and debit notes take a plain payment only; a split goes on invoices
  for (const a of allocations) {
    if (open.get(a.documentId)!.kind !== 'invoice') {
      throw new AppError('VALIDATION_FAILED', 'An opening balance or debit note takes its payment on its own. Receive it separately.', { fields: { allocations: 'Receive the opening balance or debit note on its own' } });
    }
  }
  const payment = await recordAdvance(ctx, { ...pay, contactId });
  for (const a of allocations) {
    const doc = await getDocument(ctx, a.documentId, 'invoice');
    await db().advanceAdjustment.create({ data: { tenantId: ctx.tenantId, paymentId: payment.id, documentId: doc.id, amountPaise: BigInt(a.amountPaise), createdBy: ctx.userId } });
    await setPaid(doc, doc.paidPaise + BigInt(a.amountPaise));
    await publish('payment.received', { documentId: doc.id, paymentId: payment.id, amountPaise: a.amountPaise });
  }
  await audit({ action: 'billing.receipt.record', entity: 'payment', entityId: payment.id, after: { contact: contact.name, amountPaise: input.amountPaise, bills: allocations.length } });
  return getReceipt(ctx, payment.id);
}

const RECEIPT_INCLUDE = {
  document: { select: { id: true, kind: true, number: true, buyer: true } },
  reversal: { select: { id: true, number: true, paidOn: true } },
  adjustments: { select: { id: true, amountPaise: true, reversesId: true, reversal: { select: { id: true } }, document: { select: { id: true, kind: true, number: true } } } },
} satisfies Prisma.PaymentInclude;
type ReceiptRow = Prisma.PaymentGetPayload<{ include: typeof RECEIPT_INCLUDE }>;

/** A receipt with where its money went: the bill it was on, or the invoices an advance was put on. */
function shape(p: ReceiptRow, names: Map<string, { name: string; phone: string | null }>) {
  const buyer = p.document?.buyer as { name?: string; phone?: string } | null;
  const live = p.adjustments.filter((a) => !a.reversesId && !a.reversal);
  const usedPaise = live.reduce((s, a) => s + a.amountPaise, 0n);
  const appliedTo = p.document
    ? [{ id: p.document.id, kind: p.document.kind, number: p.document.number, amountPaise: p.amountPaise }]
    : live.map((a) => ({ id: a.document.id, kind: a.document.kind, number: a.document.number, amountPaise: a.amountPaise }));
  const { adjustments: _a, ...rest } = p;
  return {
    ...rest,
    customer: p.contactId ? (names.get(p.contactId)?.name ?? null) : (buyer?.name ?? null),
    customerPhone: p.contactId ? (names.get(p.contactId)?.phone ?? null) : (buyer?.phone ?? null),
    reversed: !!p.reversal,
    advance: !p.documentId,
    appliedTo,
    /** Advance still unused */
    unusedPaise: !p.documentId && !p.reversal ? p.amountPaise - usedPaise : 0n,
  };
}

async function names(ids: (string | null)[]) {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  return new Map((list.length ? await db().contact.findMany({ where: { id: { in: list } }, select: { id: true, name: true, companyName: true, phone: true } }) : []).map((c) => [c.id, { name: c.companyName || c.name, phone: c.phone }]));
}

export async function getReceipt(ctx: TenantCtx, id: string) {
  const p = await db().payment.findUnique({ where: { id }, include: RECEIPT_INCLUDE });
  if (!p || !inScope(ctx, p, { owner: ['createdBy'] })) throw notFound('Payment');
  return shape(p, await names([p.contactId]));
}

export const ReceiptList = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: DateStr.optional(),
  to: DateStr.optional(),
  method: z.enum(['cash', 'upi', 'card', 'bank', 'cheque', 'other']).optional(),
  contactId: z.string().uuid().optional(),
  /** advance = not on a bill; reversed = undone */
  view: z.enum(['advance', 'reversed', 'active']).optional(),
});

/** Money in from customers. Refunds (money out) and the reversal entries themselves are left out. */
export async function listReceipts(ctx: TenantCtx, q: z.infer<typeof ReceiptList>) {
  const matched = q.q ? await db().contact.findMany({ where: { tenantId: ctx.tenantId, name: { contains: q.q, mode: 'insensitive' } }, select: { id: true }, take: 200 }) : [];
  const where: Prisma.PaymentWhereInput = {
    AND: [
      { tenantId: ctx.tenantId },
      scopeWhere(ctx, { owner: ['createdBy'] }),
      { reversesId: null, amountPaise: { gt: 0 } },
      { OR: [{ documentId: null }, { document: { kind: { in: [...OPEN_KINDS] } } }] },
      q.from || q.to ? { paidOn: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } } : {},
      q.method ? { method: q.method } : {},
      q.contactId ? { contactId: q.contactId } : {},
      q.view === 'advance' ? { documentId: null, reversal: null } : q.view === 'reversed' ? { reversal: { isNot: null } } : q.view === 'active' ? { reversal: null } : {},
      q.q
        ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }, { contactId: { in: matched.map((c) => c.id) } }, { document: { number: { contains: q.q, mode: 'insensitive' } } }] }
        : {},
    ],
  };
  const rows = await db().payment.findMany({ where, include: RECEIPT_INCLUDE, take: q.limit + 1, orderBy: { id: 'desc' }, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) });
  const data = rows.slice(0, q.limit);
  const n = await names(data.map((r) => r.contactId));
  return { data: data.map((r) => shape(r, n)), nextCursor: rows.length > q.limit ? data[data.length - 1].id : null };
}

/** Undo a receipt: first take it off every invoice it was put on, then add the opposite entry. */
export async function reverseReceipt(ctx: TenantCtx, id: string) {
  const p = await db().payment.findUnique({ where: { id }, include: { adjustments: { include: { reversal: { select: { id: true } } } } } });
  if (!p || !inScope(ctx, p, { owner: ['createdBy'] })) throw notFound('Payment');
  for (const a of p.adjustments) if (!a.reversesId && !a.reversal) await removeAdvanceUse(ctx, a.id);
  await reversePayment(ctx, id);
  return getReceipt(ctx, id);
}
