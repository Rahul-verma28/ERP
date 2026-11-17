import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { DateStr, inScope, scopeWhere } from '../../kernel/query';
import { bundle, userNames, userPart } from '../../kernel/bundle';
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

/** Money in from customers. Refunds (money out) and the reversal entries themselves are left out.
 *  One round trip (kernel/bundle): the receipts with customer, bill, account, reversal and where each
 *  advance went, plus the counts and totals for the tabs and cards. */
export async function listReceipts(ctx: TenantCtx, q: z.infer<typeof ReceiptList>) {
  const t = ctx.tenantId;
  const scope = (ctx.scope ?? 'own') === 'own' ? Prisma.sql`and p.created_by = ${ctx.userId}::uuid` : Prisma.empty;
  const b = await bundle({
    rows: Prisma.sql`
      select p.id, p.number, p.paid_on, p.method::text as method, p.reference, p.notes, p.amount_paise, p.contact_id, p.document_id, p.account_id, p.created_by, p.created_at, p.reverses_id,
        c.name as c_name, c.company_name as c_company, c.phone as c_phone, c.gstin as c_gstin,
        d.kind::text as doc_kind, d.number as doc_number, d.buyer as doc_buyer,
        r.id as rev_id, r.number as rev_number, r.paid_on as rev_paid_on,
        a.name as account_name, a.kind as account_kind,
        (select coalesce(json_agg(json_build_object('id', ad.id, 'kind', ad.kind::text, 'number', ad.number, 'amountPaise', aa.amount_paise) order by aa.created_at), '[]'::json)
           from advance_adjustments aa join sales_documents ad on ad.id = aa.document_id
           where aa.payment_id = p.id and aa.reverses_id is null and not exists (select 1 from advance_adjustments x where x.reverses_id = aa.id)) as used
      from payments_received p
      left join contacts c on c.id = p.contact_id
      left join sales_documents d on d.id = p.document_id
      left join payments_received r on r.reverses_id = p.id
      left join fin_accounts a on a.id = p.account_id
      where p.tenant_id = ${t}::uuid and p.reverses_id is null and p.amount_paise > 0 ${scope}
        and (p.document_id is null or d.kind::text in ('invoice', 'opening_balance', 'debit_note'))
        ${q.from ? Prisma.sql`and p.paid_on >= ${q.from}::date` : Prisma.empty}
        ${q.to ? Prisma.sql`and p.paid_on <= ${q.to}::date` : Prisma.empty}
        ${q.method ? Prisma.sql`and p.method::text = ${q.method}` : Prisma.empty}
        ${q.contactId ? Prisma.sql`and p.contact_id = ${q.contactId}::uuid` : Prisma.empty}
      order by p.id desc limit 3000`,
    ...userPart(t),
  });
  const user = userNames(b);
  const month = todayIST().slice(0, 7);
  const all = b.rows.map((p) => {
    const buyer = p.docBuyer as { name?: string; phone?: string } | null;
    const used = (p.used ?? []) as { id: string; kind: string; number: string | null; amountPaise: number }[];
    const amount = p.amountPaise as bigint;
    const usedPaise = used.reduce((n, u) => n + BigInt(u.amountPaise), 0n);
    return {
      id: p.id as string, number: p.number as string, paidOn: p.paidOn as Date, method: p.method as string, reference: p.reference ?? null, notes: p.notes ?? null,
      amountPaise: amount, contactId: p.contactId ?? null, documentId: p.documentId ?? null, accountId: p.accountId ?? null, createdBy: p.createdBy ?? null, createdAt: p.createdAt as Date,
      document: p.documentId ? { id: p.documentId, kind: p.docKind, number: p.docNumber, buyer } : null,
      customer: p.contactId ? (p.cCompany || p.cName || null) : (buyer?.name ?? null),
      customerPhone: p.contactId ? (p.cPhone ?? null) : (buyer?.phone ?? null),
      customerGstin: p.cGstin ?? null,
      accountName: p.accountName ?? null, accountKind: p.accountKind ?? null,
      createdByName: p.createdBy ? user.get(p.createdBy) ?? null : null,
      reversed: !!p.revId,
      reversal: p.revId ? { id: p.revId, number: p.revNumber, paidOn: p.revPaidOn } : null,
      advance: !p.documentId,
      appliedTo: p.documentId ? [{ id: p.documentId, kind: p.docKind, number: p.docNumber, amountPaise: amount }] : used.map((u) => ({ ...u, amountPaise: BigInt(u.amountPaise) })),
      unusedPaise: !p.documentId && !p.revId ? amount - usedPaise : 0n,
    };
  });
  const live = all.filter((r) => !r.reversed);
  const sum = (rows: typeof all) => rows.reduce((n, r) => n + r.amountPaise, 0n);
  const thisMonth = live.filter((r) => r.paidOn.toISOString().slice(0, 7) === month);
  const cash = live.filter((r) => r.method === 'cash');
  const counts = { all: all.length, active: live.length, advance: all.filter((r) => r.advance && !r.reversed).length, reversed: all.length - live.length };
  const sums = {
    received: sum(live), month: sum(thisMonth), monthCount: thisMonth.length, cash: sum(cash), cashCount: cash.length, bank: sum(live) - sum(cash), bankCount: live.length - cash.length,
    advanceLeft: live.reduce((n, r) => n + r.unusedPaise, 0n), customers: new Set(live.map((r) => r.contactId ?? r.customer)).size,
  };
  const text = q.q?.toLowerCase();
  const rows = all.filter((r) =>
    (q.view === 'advance' ? r.advance && !r.reversed : q.view === 'reversed' ? r.reversed : q.view === 'active' ? !r.reversed : true)
    && (!text || [r.number, r.reference, r.customer, r.customerGstin, r.accountName, ...r.appliedTo.map((x) => x.number)].some((v) => typeof v === 'string' && v.toLowerCase().includes(text))));
  const start = q.cursor ? rows.findIndex((r) => r.id === q.cursor) + 1 : 0;
  const data = rows.slice(start, start + q.limit);
  return { data, nextCursor: start + q.limit < rows.length ? data[data.length - 1]?.id ?? null : null, total: rows.length, counts, sums };
}

/** Undo a receipt: first take it off every invoice it was put on, then add the opposite entry. */
export async function reverseReceipt(ctx: TenantCtx, id: string) {
  const p = await db().payment.findUnique({ where: { id }, include: { adjustments: { include: { reversal: { select: { id: true } } } } } });
  if (!p || !inScope(ctx, p, { owner: ['createdBy'] })) throw notFound('Payment');
  for (const a of p.adjustments) if (!a.reversesId && !a.reversal) await removeAdvanceUse(ctx, a.id);
  await reversePayment(ctx, id);
  return getReceipt(ctx, id);
}
