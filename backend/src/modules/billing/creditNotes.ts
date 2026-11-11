import { z } from 'zod';
import { postDocumentStock, reverseSource } from '../inventory/engine';
import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { randomToken } from '../../kernel/crypto';
import { dateOnly, divRound, todayIST } from '../../kernel/gst';
import { allocateNumber } from '../../kernel/sequences';
import { DateStr, Paise } from '../../kernel/query';
import { audit } from '../audit/service';
import { publish } from '../events/outbox';
import { getDocument, PaymentInput, resolveLocation, setCreditUsed, setPaid } from './service';

// Credit notes (issued invoices are never edited): goods came back, or the value is reduced.
// GST follows the invoice line. GST rules here must be validated by the client's CA.

const CreditableStatus = ['issued', 'partially_paid', 'paid'];
const milli = (q: unknown) => BigInt(Math.round(Number(q) * 1000));

/** 30 November after the end of the April–March year the invoice falls in (Section 34(2) CGST Act) */
export function creditNoteDeadline(invoiceDate: Date) {
  const fyEndYear = invoiceDate.getUTCMonth() >= 3 ? invoiceDate.getUTCFullYear() + 1 : invoiceDate.getUTCFullYear();
  return new Date(Date.UTC(fyEndYear, 10, 30));
}

export const CreditNoteInput = z.object({
  type: z.enum(['return', 'amount']),
  issueDate: DateStr.optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** Goods returned: the warehouse they come back to; empty = where the sale left from */
  locationId: z.string().uuid().optional().nullable(),
  lines: z.array(z.object({
    sourceLineId: z.string().uuid(),
    /** Goods returned */
    quantity: z.number().positive('Quantity must be more than 0').max(1e7).optional(),
    /** Value reduced, before GST */
    taxablePaise: Paise.optional(),
    /** Serial-tracked goods: the numbers that came back; none means the ones sold on that line */
    serials: z.array(z.string().trim().min(1).max(40)).max(1000).optional(),
  })).min(1, 'Choose at least one line').max(200),
});
export type CreditNoteInput = z.infer<typeof CreditNoteInput>;

/** Each invoice line with what is still open after earlier credit notes that were not cancelled. */
export async function creditableLines(ctx: TenantCtx, invoiceId: string) {
  const doc = await getDocument(ctx, invoiceId, 'invoice');
  const earlier = await db().salesDocumentLine.findMany({
    where: { sourceLineId: { in: doc.lines.map((l) => l.id) }, document: { kind: 'credit_note', status: { not: 'cancelled' } } },
    include: { document: { select: { noteType: true } } },
  });
  return doc.lines.map((line) => {
    const left = { quantityMilli: milli(line.quantity), taxablePaise: line.taxablePaise, cgstPaise: line.cgstPaise, sgstPaise: line.sgstPaise, igstPaise: line.igstPaise };
    for (const e of earlier) {
      if (e.sourceLineId !== line.id) continue;
      if (e.document.noteType === 'return') left.quantityMilli -= milli(e.quantity);
      left.taxablePaise -= e.taxablePaise;
      left.cgstPaise -= e.cgstPaise;
      left.sgstPaise -= e.sgstPaise;
      left.igstPaise -= e.igstPaise;
    }
    return { line, left, quantityLeft: Number(left.quantityMilli) / 1000, taxableLeftPaise: left.taxablePaise };
  });
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

export async function createCreditNote(ctx: TenantCtx, invoiceId: string, input: CreditNoteInput) {
  const doc = await getDocument(ctx, invoiceId, 'invoice');
  if (!CreditableStatus.includes(doc.status)) throw new AppError('CONFLICT', 'A credit note can only be made on an issued invoice.');
  const issueDate = input.issueDate ?? todayIST();
  // Section 34(2) CGST Act: a credit note that reduces GST must be issued by 30 November after the
  // end of the financial year (April to March) of the invoice. After that only a commercial credit
  // without GST is possible, which a CA settles outside this screen.
  const lastDay = creditNoteDeadline(doc.issueDate);
  if (dateOnly(issueDate) > lastDay) {
    throw new AppError('CONFLICT', `GST allows a credit note for this invoice only until ${lastDay.toISOString().slice(0, 10)} (Section 34(2)). Settle the difference without GST; ask your CA how to record it.`, { deadline: lastDay.toISOString().slice(0, 10) });
  }
  if (dateOnly(issueDate) < doc.issueDate) throw new AppError('VALIDATION_FAILED', 'The credit note date cannot be before the invoice date.', { fields: { issueDate: 'Before the invoice date' } });
  const open = new Map((await creditableLines(ctx, invoiceId)).map((o) => [o.line.id, o]));
  const seen = new Set<string>();
  const intra = doc.igstPaise === 0n;

  const lines = input.lines.map((want, i) => {
    const o = open.get(want.sourceLineId);
    const field = `lines.${i}.${input.type === 'return' ? 'quantity' : 'taxablePaise'}`;
    const refuse = (message: string) => new AppError('VALIDATION_FAILED', message, { fields: { [field]: message } });
    if (!o || seen.has(want.sourceLineId)) throw refuse('Choose a line from this invoice');
    seen.add(want.sourceLineId);
    const { line, left } = o;

    let taxable: bigint;
    let quantity: string;
    let unitPrice: bigint;
    let discount = 0n;
    let unit = line.unit;
    if (input.type === 'return') {
      if (!want.quantity) throw refuse('Enter the quantity returned');
      const q = milli(want.quantity);
      if (q > left.quantityMilli) throw refuse(`Only ${Number(left.quantityMilli) / 1000} ${line.unit} can be returned on this line`);
      // Returning all that is left clears the line exactly, so rounding never leaves paise behind
      taxable = q === left.quantityMilli ? left.taxablePaise : min(divRound(line.taxablePaise * q, milli(line.quantity)), left.taxablePaise);
      quantity = (Number(q) / 1000).toFixed(3);
      unitPrice = line.unitPricePaise;
      const gross = divRound(unitPrice * q, 1000n);
      discount = gross > taxable ? gross - taxable : 0n;
    } else {
      if (!want.taxablePaise) throw refuse('Enter the amount to reduce');
      taxable = BigInt(want.taxablePaise);
      if (taxable > left.taxablePaise) throw refuse(`Only ₹${(Number(left.taxablePaise) / 100).toFixed(2)} is left on this line`);
      quantity = '1.000';
      unitPrice = taxable;
      unit = 'adj';
    }
    if (taxable <= 0n) throw refuse('Nothing is left to credit on this line');

    const rate = BigInt(line.gstRateBp);
    const clearing = taxable === left.taxablePaise;
    const half = divRound(taxable * rate, 20_000n);
    const cgst = !intra ? 0n : clearing ? left.cgstPaise : min(half, left.cgstPaise);
    const sgst = !intra ? 0n : clearing ? left.sgstPaise : min(half, left.sgstPaise);
    const igst = intra ? 0n : clearing ? left.igstPaise : min(divRound(taxable * rate, 10_000n), left.igstPaise);
    return {
      tenantId: ctx.tenantId, sourceLineId: line.id, itemId: line.itemId, description: line.description, hsnSac: line.hsnSac, unit, quantity, unitPricePaise: unitPrice, discountPaise: discount,
      serials: input.type === 'return' ? [...new Set(want.serials ?? [])] : [],
      taxablePaise: taxable, gstRateBp: line.gstRateBp, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, totalPaise: taxable + cgst + sgst + igst, position: i,
    };
  });

  const sum = (pick: (l: (typeof lines)[number]) => bigint) => lines.reduce((s, l) => s + pick(l), 0n);
  const totals = {
    subtotalPaise: sum((l) => l.taxablePaise + l.discountPaise), discountPaise: sum((l) => l.discountPaise), taxablePaise: sum((l) => l.taxablePaise),
    cgstPaise: sum((l) => l.cgstPaise), sgstPaise: sum((l) => l.sgstPaise), igstPaise: sum((l) => l.igstPaise), totalPaise: sum((l) => l.totalPaise),
  };

  // The note that clears the whole invoice takes its round-off back too, so nothing stays owed
  const cleared = [...open.values()].every((o) => o.left.taxablePaise - (lines.find((l) => l.sourceLineId === o.line.id)?.taxablePaise ?? 0n) === 0n);
  const roundOffPaise = cleared ? doc.roundOffPaise : 0n;
  totals.totalPaise += roundOffPaise;

  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { fyStartMonth: true } });
  const { number, fy } = await allocateNumber(ctx.tenantId, 'credit_note', tenant.fyStartMonth, dateOnly(issueDate));
  // What the invoice still owes is cleared first; anything more stays with the customer
  const due = doc.totalPaise - doc.paidPaise;
  const applied = min(totals.totalPaise, due > 0n ? due : 0n);
  const note = await db().salesDocument.create({
    data: {
      tenantId: ctx.tenantId, kind: 'credit_note', status: 'issued', number, fy, noteType: input.type, sourceType: 'invoice', sourceId: doc.id, sourceNumber: doc.number, sourceDate: doc.issueDate,
      branchId: doc.branchId, contactId: doc.contactId, buyer: doc.buyer as object, seller: doc.seller as object, placeOfSupply: doc.placeOfSupply,
      locationId: input.type === 'return' ? await resolveLocation(ctx, input.locationId ?? doc.locationId ?? null) : null,
      issueDate: dateOnly(issueDate), ...totals, roundOffPaise, paidPaise: applied, notes: input.notes ?? null, shareToken: randomToken(18), createdBy: ctx.userId, issuedAt: new Date(),
      lines: { create: lines.map(({ tenantId: _t, ...l }) => ({ ...l, tenantId: ctx.tenantId })) },
    },
  });
  if (applied > 0n) await db().advanceAdjustment.create({ data: { tenantId: ctx.tenantId, creditNoteId: note.id, documentId: doc.id, amountPaise: applied, createdBy: ctx.userId } });
  await setPaid(doc, doc.paidPaise + applied, doc.creditedPaise + applied);
  await audit({ action: 'billing.credit_note.issue', entity: 'credit_note', entityId: note.id, after: { number, invoice: doc.number, type: input.type, totalPaise: totals.totalPaise } });
  // Goods returned come back into stock
  await postDocumentStock(ctx, note.id);
  await publish('credit_note.issued', { documentId: note.id, invoiceId: doc.id, type: input.type });
  return getDocument(ctx, note.id, 'credit_note');
}

/** Cancel a credit note that has not gone anywhere else; the invoice owes again what it cleared. */
export async function cancelCreditNote(ctx: TenantCtx, id: string, reason: string) {
  const note = await getDocument(ctx, id, 'credit_note');
  if (note.status === 'cancelled') throw new AppError('CONFLICT', 'This credit note is already cancelled.');
  const uses = await db().advanceAdjustment.findMany({ where: { creditNoteId: id }, include: { reversal: { select: { id: true } } } });
  const live = uses.filter((u) => !u.reversesId && !u.reversal);
  if (live.some((u) => u.documentId !== note.sourceId)) throw new AppError('CONFLICT', 'This credit note is used on another invoice. Remove it from that invoice first.');
  if (note.payments.reduce((s, p) => s + p.amountPaise, 0n) !== 0n) throw new AppError('CONFLICT', 'This credit note has a refund. Reverse the refund first.');
  const invoice = await getDocument(ctx, note.sourceId!, 'invoice');
  let back = 0n;
  for (const use of live) {
    await db().advanceAdjustment.create({ data: { tenantId: ctx.tenantId, creditNoteId: id, documentId: invoice.id, amountPaise: -use.amountPaise, reversesId: use.id, createdBy: ctx.userId } });
    back += use.amountPaise;
  }
  await setPaid(invoice, invoice.paidPaise - back, invoice.creditedPaise - back);
  const { count } = await db().salesDocument.updateMany({ where: { id, version: note.version }, data: { status: 'cancelled', paidPaise: 0n, cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } } });
  if (!count) throw new AppError('VERSION_CONFLICT', 'This credit note was changed by someone else. Reload and try again.');
  await reverseSource(ctx, id);
  await audit({ action: 'billing.credit_note.cancel', entity: 'credit_note', entityId: id, before: { status: note.status }, after: { reason } });
  await publish('credit_note.cancelled', { documentId: id, invoiceId: invoice.id, type: note.noteType });
  return getDocument(ctx, id, 'credit_note');
}

/** Give money back from what is left on a credit note. It counts as money going out on the day. */
export async function refundCreditNote(ctx: TenantCtx, id: string, input: z.infer<typeof PaymentInput>) {
  const note = await getDocument(ctx, id, 'credit_note');
  if (note.status !== 'issued') throw new AppError('CONFLICT', 'This credit note is cancelled.');
  const left = note.totalPaise - note.paidPaise;
  const amount = BigInt(input.amountPaise);
  if (amount > left) throw new AppError('VALIDATION_FAILED', `Only ₹${(Number(left) / 100).toFixed(2)} is left on this credit note.`, { fields: { amountPaise: 'More than the credit left' } });
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { fyStartMonth: true } });
  const { number } = await allocateNumber(ctx.tenantId, 'receipt', tenant.fyStartMonth);
  const payment = await db().payment.create({
    data: { ...input, paidOn: dateOnly(input.paidOn ?? todayIST()), amountPaise: -amount, tenantId: ctx.tenantId, documentId: id, contactId: note.contactId, number, createdBy: ctx.userId },
  });
  await setCreditUsed(note, note.paidPaise + amount);
  await audit({ action: 'billing.refund.create', entity: 'payment', entityId: payment.id, after: { creditNote: note.number, amountPaise: input.amountPaise, method: input.method } });
  return getDocument(ctx, id, 'credit_note');
}

// ── Debit notes: the customer owes more than the invoice said (rate went up, bill was short) ──

export const DebitNoteInput = z.object({
  issueDate: DateStr.optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(z.object({ sourceLineId: z.string().uuid(), taxablePaise: Paise.refine((v) => v > 0, 'Enter the amount to add') })).min(1, 'Choose at least one line').max(200),
});

export async function createDebitNote(ctx: TenantCtx, invoiceId: string, input: z.infer<typeof DebitNoteInput>) {
  const doc = await getDocument(ctx, invoiceId, 'invoice');
  if (!CreditableStatus.includes(doc.status)) throw new AppError('CONFLICT', 'A debit note can only be made on an issued invoice.');
  const issueDate = input.issueDate ?? todayIST();
  if (dateOnly(issueDate) < doc.issueDate) throw new AppError('VALIDATION_FAILED', 'The debit note date cannot be before the invoice date.', { fields: { issueDate: 'Before the invoice date' } });
  const byId = new Map(doc.lines.map((l) => [l.id, l]));
  const intra = doc.igstPaise === 0n;
  const lines = input.lines.map((want, i) => {
    const line = byId.get(want.sourceLineId);
    if (!line) throw new AppError('VALIDATION_FAILED', 'Choose a line from this invoice.', { fields: { [`lines.${i}.taxablePaise`]: 'Choose a line from this invoice' } });
    const taxable = BigInt(want.taxablePaise);
    const rate = BigInt(line.gstRateBp);
    const half = intra ? divRound(taxable * rate, 20_000n) : 0n;
    const igst = intra ? 0n : divRound(taxable * rate, 10_000n);
    return {
      tenantId: ctx.tenantId, sourceLineId: line.id, itemId: line.itemId, description: line.description, hsnSac: line.hsnSac, unit: 'adj', quantity: '1.000', unitPricePaise: taxable, discountPaise: 0n,
      taxablePaise: taxable, gstRateBp: line.gstRateBp, cgstPaise: half, sgstPaise: half, igstPaise: igst, totalPaise: taxable + half + half + igst, position: i,
    };
  });
  const sum = (pick: (l: (typeof lines)[number]) => bigint) => lines.reduce((s, l) => s + pick(l), 0n);
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { fyStartMonth: true } });
  const { number, fy } = await allocateNumber(ctx.tenantId, 'debit_note', tenant.fyStartMonth, dateOnly(issueDate));
  const note = await db().salesDocument.create({
    data: {
      tenantId: ctx.tenantId, kind: 'debit_note', status: 'issued', number, fy, sourceType: 'invoice', sourceId: doc.id, sourceNumber: doc.number, sourceDate: doc.issueDate, branchId: doc.branchId, contactId: doc.contactId,
      buyer: doc.buyer as object, seller: doc.seller as object, placeOfSupply: doc.placeOfSupply, issueDate: dateOnly(issueDate), subtotalPaise: sum((l) => l.taxablePaise), taxablePaise: sum((l) => l.taxablePaise),
      cgstPaise: sum((l) => l.cgstPaise), sgstPaise: sum((l) => l.sgstPaise), igstPaise: sum((l) => l.igstPaise), totalPaise: sum((l) => l.totalPaise), notes: input.notes ?? null, shareToken: randomToken(18), createdBy: ctx.userId, issuedAt: new Date(),
      lines: { create: lines.map(({ tenantId: _t, ...l }) => ({ ...l, tenantId: ctx.tenantId })) },
    },
  });
  await audit({ action: 'billing.debit_note.issue', entity: 'debit_note', entityId: note.id, after: { number, invoice: doc.number, totalPaise: note.totalPaise } });
  return getDocument(ctx, note.id, 'debit_note');
}

export async function cancelDebitNote(ctx: TenantCtx, id: string, reason: string) {
  const note = await getDocument(ctx, id, 'debit_note');
  if (note.status === 'cancelled') throw new AppError('CONFLICT', 'This debit note is already cancelled.');
  if (note.paidPaise > 0n) throw new AppError('CONFLICT', 'This debit note has a payment. Reverse the payment first.');
  await db().salesDocument.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } } });
  await audit({ action: 'billing.debit_note.cancel', entity: 'debit_note', entityId: id, after: { reason } });
  return getDocument(ctx, id, 'debit_note');
}
