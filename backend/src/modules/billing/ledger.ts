import { z } from 'zod';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { dateOnly, todayIST } from '../../kernel/gst';
import { DateStr, Paise, inScope, scopeWhere } from '../../kernel/query';
import { audit } from '../audit/service';
import { listAdvances, SCOPE_FIELDS } from './service';

// The customer's khata: everything billed and everything received, in date order, with a running
// balance. Above zero the customer owes; below zero the business holds the customer's money.
// Using an advance or credit on an invoice moves no money, so it adds no row here.

const DAY = 86_400_000;
const BANDS = [
  { label: '0–30 days', min: 0, max: 30 },
  { label: '31–60 days', min: 31, max: 60 },
  { label: '61–90 days', min: 61, max: 90 },
  { label: 'Over 90 days', min: 91, max: Infinity },
];

async function loadContact(ctx: TenantCtx, contactId: string) {
  const contact = await db().contact.findUnique({ where: { id: contactId } });
  if (!contact || !inScope(ctx, contact, { owner: ['ownerId', 'createdBy'], branch: 'branchId' })) throw notFound('Customer');
  return contact;
}

const ledgerType = (p: { reversesId: string | null; amountPaise: bigint; documentId: string | null }) =>
  p.reversesId ? 'reversal' : p.amountPaise < 0n ? 'refund' : p.documentId ? 'receipt' : 'advance';

export async function customerLedger(ctx: TenantCtx, contactId: string, period: { from?: string; to?: string }) {
  const contact = await loadContact(ctx, contactId);
  const [docs, payments, held] = await Promise.all([
    db().salesDocument.findMany({
      where: { AND: [{ contactId, kind: { in: ['invoice', 'credit_note', 'opening_balance', 'debit_note'] }, status: { notIn: ['draft', 'cancelled'] } }, scopeWhere(ctx, SCOPE_FIELDS)] },
      select: { id: true, kind: true, number: true, status: true, issueDate: true, createdAt: true, totalPaise: true, paidPaise: true },
    }),
    db().payment.findMany({
      where: { AND: [{ contactId }, scopeWhere(ctx, { owner: ['createdBy'] })] },
      select: { id: true, number: true, amountPaise: true, method: true, reference: true, paidOn: true, createdAt: true, documentId: true, reversesId: true, document: { select: { number: true } } },
    }),
    listAdvances(ctx, contactId),
  ]);

  const entries = [
    ...docs.map((d) => ({
      id: d.id, date: d.issueDate, at: d.createdAt, type: d.kind as string, number: d.number, documentId: d.id, against: null as string | null, method: null as string | null, reference: null as string | null,
      debitPaise: d.kind === 'credit_note' ? 0n : d.totalPaise, creditPaise: d.kind === 'credit_note' ? d.totalPaise : 0n,
    })),
    ...payments.map((p) => ({
      id: p.id, date: p.paidOn, at: p.createdAt, type: ledgerType(p), number: p.number as string | null, documentId: p.documentId, against: p.document?.number ?? null, method: p.method as string | null, reference: p.reference,
      debitPaise: p.amountPaise < 0n ? -p.amountPaise : 0n, creditPaise: p.amountPaise > 0n ? p.amountPaise : 0n,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.at.getTime() - b.at.getTime());

  const from = period.from ? dateOnly(period.from).getTime() : -Infinity;
  const to = period.to ? dateOnly(period.to).getTime() : Infinity;
  let running = 0n;
  let broughtForward = 0n;
  const rows = [];
  for (const { at: _at, ...e } of entries) {
    running += e.debitPaise - e.creditPaise;
    const when = e.date.getTime();
    if (when < from) broughtForward = running;
    else if (when <= to) rows.push({ ...e, balancePaise: running });
  }

  const today = dateOnly(todayIST()).getTime();
  const aging = BANDS.map((b) => ({ label: b.label, amountPaise: 0n }));
  for (const d of docs) {
    if (d.kind === 'credit_note' || !['issued', 'partially_paid'].includes(d.status)) continue;
    const age = Math.round((today - d.issueDate.getTime()) / DAY);
    aging[BANDS.findIndex((b) => age >= b.min && age <= b.max)].amountPaise += d.totalPaise - d.paidPaise;
  }
  const opening = docs.find((d) => d.kind === 'opening_balance');

  return {
    contact: { id: contact.id, name: contact.companyName || contact.name, phone: contact.phone, email: contact.email, gstin: contact.gstin, address: contact.address, creditLimitPaise: contact.creditLimitPaise },
    from: period.from ?? null,
    to: period.to ?? null,
    broughtForwardPaise: broughtForward,
    rows,
    closingPaise: rows.at(-1)?.balancePaise ?? broughtForward,
    balancePaise: running,
    advancePaise: held.balancePaise,
    creditPaise: held.creditPaise,
    aging,
    openingBalance: opening ? { id: opening.id, date: opening.issueDate, totalPaise: opening.totalPaise, paidPaise: opening.paidPaise } : null,
  };
}

export const OpeningBalanceInput = z.object({ amountPaise: Paise.refine((v) => v > 0, 'Enter an amount'), date: DateStr });

/** Set or change what the customer owed before AHEAD. Fixed once a payment has gone against it. */
export async function setOpeningBalance(ctx: TenantCtx, contactId: string, input: z.infer<typeof OpeningBalanceInput>) {
  const contact = await loadContact(ctx, contactId);
  if (input.date > todayIST()) throw new AppError('VALIDATION_FAILED', "The date can't be in the future.", { fields: { date: 'In the future' } });
  const existing = await db().salesDocument.findFirst({ where: { contactId, noteType: 'opening', status: { not: 'cancelled' } } });
  if (existing && existing.paidPaise > 0n) throw new AppError('CONFLICT', 'A payment is recorded against this opening balance. Reverse the payment first.');
  const amount = BigInt(input.amountPaise);
  const figures = { issueDate: dateOnly(input.date), subtotalPaise: amount, taxablePaise: amount, totalPaise: amount };
  if (existing) {
    const { count } = await db().salesDocument.updateMany({ where: { id: existing.id, version: existing.version }, data: { ...figures, version: { increment: 1 } } });
    if (!count) throw new AppError('VERSION_CONFLICT', 'This opening balance was changed by someone else. Reload and try again.');
  } else {
    await db().salesDocument.create({
      data: {
        tenantId: ctx.tenantId, kind: 'opening_balance', status: 'issued', noteType: 'opening', contactId, buyer: { name: contact.companyName || contact.name }, createdBy: ctx.userId, issuedAt: new Date(), ...figures,
      },
    });
  }
  await audit({ action: 'billing.opening_balance.set', entity: 'contact', entityId: contactId, before: existing ? { amountPaise: existing.totalPaise, date: existing.issueDate } : undefined, after: { amountPaise: input.amountPaise, date: input.date } });
  return customerLedger(ctx, contactId, {});
}

export async function removeOpeningBalance(ctx: TenantCtx, contactId: string) {
  await loadContact(ctx, contactId);
  const existing = await db().salesDocument.findFirst({ where: { contactId, noteType: 'opening', status: { not: 'cancelled' } } });
  if (!existing) throw notFound('Opening balance');
  if (existing.paidPaise > 0n) throw new AppError('CONFLICT', 'A payment is recorded against this opening balance. Reverse the payment first.');
  await db().salesDocument.update({ where: { id: existing.id }, data: { status: 'cancelled', cancelledAt: new Date(), version: { increment: 1 } } });
  await audit({ action: 'billing.opening_balance.remove', entity: 'contact', entityId: contactId, before: { amountPaise: existing.totalPaise, date: existing.issueDate } });
}
