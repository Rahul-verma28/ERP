import { z } from 'zod';
import { Prisma, type SalesDocKind, type SalesDocument } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { randomToken } from '../../kernel/crypto';
import { GST_RATES_BP, computeDocument, dateOnly, divRound, todayIST } from '../../kernel/gst';
import { allocateNumber } from '../../kernel/sequences';
import { DateStr, Paise, consumeMonthly, inScope, markOnboarding, scopeWhere } from '../../kernel/query';
import { getEntitlements } from '../subscription/entitlements';
import { validateCustom } from '../config/service';
import { audit } from '../audit/service';
import { publish } from '../events/outbox';
import { optionalText, zEmail, zGstin, zHsnOrSac, zPhone, zPincode, zStateCode } from '../../kernel/zodRules';
import { gstinStateMismatch } from '../../contracts/validation';
import { withDefaults, type WorkspaceProfile } from '../../contracts/workspace';
import { defaultLocation, postDocumentStock, reverseSource } from '../inventory/engine';
import { resolveAccount } from '../finance/service';

// Sales documents: quotations (SAL-01) and GST tax invoices (BIL-01..04) share one engine.

export const SCOPE_FIELDS = { owner: ['createdBy'], branch: 'branchId' };

export const LineInput = z.object({
  itemId: z.string().uuid().optional().nullable(),
  description: z.string().trim().max(300).optional(),
  hsnSac: optionalText(zHsnOrSac),
  unit: z.string().trim().max(20).optional(),
  quantity: z.number().positive('Quantity must be more than 0').max(1e7),
  unitPricePaise: Paise,
  discountPaise: Paise.default(0),
  gstRateBp: z.number().int().refine((v) => (GST_RATES_BP as readonly number[]).includes(v), 'Choose a valid GST rate'),
  /** Invoice made from an order: the order line it bills */
  sourceLineId: z.string().uuid().optional().nullable(),
  /** Given free on top of quantity: no price and no tax */
  freeQuantity: z.number().min(0).max(1e7).optional(),
  /** Inventory: the batch to sell from; none means earliest expiry first */
  batchId: z.string().uuid().optional().nullable(),
  /** Inventory: serial numbers of the pieces sold */
  serials: z.array(z.string().trim().min(1).max(40)).max(1000).optional(),
}).superRefine((l, c) => {
  if (l.discountPaise > Math.round(l.quantity * l.unitPricePaise)) c.addIssue({ code: z.ZodIssueCode.custom, path: ['discountPaise'], message: "Discount can't be more than the line amount" });
});

export const BuyerInput = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(160),
  gstin: optionalText(zGstin),
  phone: optionalText(zPhone),
  email: optionalText(zEmail),
  stateCode: zStateCode.optional().nullable(),
  address: z.record(z.string()).optional().nullable(),
}).superRefine((b, c) => {
  const mismatch = gstinStateMismatch(b.gstin, b.stateCode);
  if (mismatch) c.addIssue({ code: z.ZodIssueCode.custom, path: ['gstin'], message: mismatch });
});

export const DocInput = z.object({
  contactId: z.string().uuid().optional().nullable(),
  buyer: BuyerInput.optional(),
  branchId: z.string().uuid().optional().nullable(),
  issueDate: DateStr.optional(),
  dueDate: DateStr.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  terms: z.string().max(2000).optional().nullable(),
  lines: z.array(LineInput).min(1, 'Add at least one line').max(200),
  custom: z.record(z.unknown()).optional(),
  /** The rates and discounts typed include GST; the tax is taken out of them */
  pricesIncludeGst: z.boolean().optional(),
  /** Round the total to the whole rupee */
  roundOff: z.boolean().optional(),
  /** Goods go somewhere other than the billing address: then the whole address is needed */
  shipTo: z.object({
    name: optionalText(z.string().trim().max(160)),
    line1: z.string().trim().min(1, 'Enter the delivery address').max(200),
    city: z.string().trim().min(1, 'Enter the city').max(80),
    pincode: zPincode,
    stateCode: zStateCode,
  }).optional().nullable(),
  /** Warehouse the goods leave from; empty = the default warehouse */
  locationId: z.string().uuid().optional().nullable(),
  /** Quotation printed as a proforma invoice */
  proforma: z.boolean().optional(),
});
export type DocInput = z.infer<typeof DocInput>;

interface Buyer {
  name: string;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  stateCode?: string | null;
  address?: Record<string, string> | null;
}

async function resolveBuyer(input: DocInput): Promise<{ contactId: string | null; buyer: Buyer }> {
  if (input.contactId) {
    const c = await db().contact.findUnique({ where: { id: input.contactId } });
    if (!c) throw new AppError('VALIDATION_FAILED', 'Unknown customer.', { fields: { contactId: 'Unknown customer' } });
    // Explicit buyer fields (e.g. edited GSTIN on this invoice) override the contact's
    return {
      contactId: c.id,
      buyer: {
        name: c.companyName || c.name, gstin: c.gstin, phone: c.phone, email: c.email,
        stateCode: c.stateCode ?? (c.gstin ? c.gstin.slice(0, 2) : null), address: (c.address as Record<string, string>) ?? null,
        ...Object.fromEntries(Object.entries(input.buyer ?? {}).filter(([, v]) => v !== undefined)),
      },
    };
  }
  if (!input.buyer) throw new AppError('VALIDATION_FAILED', 'Choose a customer or enter buyer details.', { fields: { contactId: 'Required' } });
  return { contactId: null, buyer: { ...input.buyer, stateCode: input.buyer.stateCode ?? (input.buyer.gstin ? input.buyer.gstin.slice(0, 2) : null) } };
}

async function resolveLines(lines: DocInput['lines']) {
  const ids = [...new Set(lines.map((l) => l.itemId).filter(Boolean))] as string[];
  const items = ids.length ? await db().item.findMany({ where: { id: { in: ids } } }) : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  return lines.map((l, i) => {
    const item = l.itemId ? byId.get(l.itemId) : undefined;
    if (l.itemId && !item) throw new AppError('VALIDATION_FAILED', 'Unknown item.', { fields: { [`lines.${i}.itemId`]: 'Unknown item' } });
    const description = l.description || item?.name;
    if (!description) throw new AppError('VALIDATION_FAILED', 'Each line needs a description.', { fields: { [`lines.${i}.description`]: 'Required' } });
    if (l.discountPaise > Math.round(l.unitPricePaise * l.quantity)) {
      throw new AppError('VALIDATION_FAILED', 'Discount cannot exceed the line amount.', { fields: { [`lines.${i}.discountPaise`]: 'Too large' } });
    }
    return { ...l, itemId: item?.id ?? null, description, hsnSac: l.hsnSac ?? item?.hsnSac ?? null, unit: l.unit || item?.unit || 'pcs' };
  });
}

/** The warehouse named on the document, or the default one. Must be active. */
export async function resolveLocation(ctx: TenantCtx, id: string | null) {
  if (!id) return (await defaultLocation(ctx)).id;
  const found = await db().stockLocation.findFirst({ where: { id, tenantId: ctx.tenantId, isActive: true }, select: { id: true } });
  if (!found) throw new AppError('VALIDATION_FAILED', 'Choose an active warehouse.', { fields: { locationId: 'Unknown or closed warehouse' } });
  return found.id;
}

/** Compute snapshot, place of supply and GST split; returns data for create/update. */
async function prepare(ctx: TenantCtx, input: DocInput, existing?: SalesDocument) {
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const { contactId, buyer } = await resolveBuyer(input);
  // Not registered, or on the composition scheme: no GST is charged and the bill is a bill of supply
  const taxes = withDefaults(tenant.preferences, tenant.profile).taxes;
  const noTax = !tenant.gstin || taxes.composition;
  const resolved = (await resolveLines(input.lines)).map((l) => (noTax ? { ...l, gstRateBp: 0 } : l));
  const exclusive = (paise: number, rateBp: number) => Number(divRound(BigInt(paise) * 10_000n, BigInt(10_000 + rateBp)));
  const lines = input.pricesIncludeGst && !noTax ? resolved.map((l) => ({ ...l, unitPricePaise: exclusive(l.unitPricePaise, l.gstRateBp), discountPaise: exclusive(l.discountPaise, l.gstRateBp) })) : resolved;
  // Goods sent elsewhere: tax follows where they go. A CA should confirm this for each case.
  const placeOfSupply = input.shipTo?.stateCode ?? buyer.stateCode ?? tenant.billingStateCode ?? null;
  const intraState = !tenant.billingStateCode || !placeOfSupply || placeOfSupply === tenant.billingStateCode;
  const { lines: computed, totals } = computeDocument(lines, intraState);
  const roundOffPaise = input.roundOff ? divRound(totals.totalPaise, 100n) * 100n - totals.totalPaise : 0n;
  const custom = await validateCustom(ctx.tenantId, 'invoice', input.custom, (existing?.custom as Record<string, unknown>) ?? {});
  const locationId = await resolveLocation(ctx, input.locationId ?? existing?.locationId ?? null);
  // No due date given: the customer's payment days decide it (empty = due on the bill date)
  const issueDate = dateOnly(input.issueDate ?? todayIST());
  let dueDate = input.dueDate ? dateOnly(input.dueDate) : null;
  if (input.dueDate === undefined && contactId) {
    const terms = await db().contact.findUnique({ where: { id: contactId }, select: { paymentDays: true } });
    if (terms?.paymentDays != null) dueDate = new Date(issueDate.getTime() + terms.paymentDays * 86_400_000);
  }
  if (dueDate && dueDate < issueDate) throw new AppError('VALIDATION_FAILED', "The due date can't be before the bill date.", { fields: { dueDate: 'Before the bill date' } });
  if (input.branchId && !(await db().branch.findUnique({ where: { id: input.branchId } }))) {
    throw new AppError('VALIDATION_FAILED', 'Unknown branch.', { fields: { branchId: 'Unknown branch' } });
  }
  return {
    tenant,
    doc: {
      contactId,
      buyer: buyer as unknown as Prisma.InputJsonValue,
      shipTo: input.shipTo ? (input.shipTo as Prisma.InputJsonValue) : Prisma.JsonNull,
      noteType: input.proforma === undefined ? (existing?.noteType ?? null) : input.proforma ? 'proforma' : null,
      placeOfSupply,
      branchId: input.branchId ?? existing?.branchId ?? ctx.branchIds[0] ?? null,
      issueDate,
      dueDate,
      locationId,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      custom: custom as Prisma.InputJsonValue,
      ...totals,
      roundOffPaise,
      totalPaise: totals.totalPaise + roundOffPaise,
    },
    lines: computed.map((l, position) => ({
      tenantId: ctx.tenantId, itemId: l.itemId, description: l.description, hsnSac: l.hsnSac, unit: l.unit,
      quantity: (Number(l.quantityMilli) / 1000).toFixed(3), unitPricePaise: BigInt(l.unitPricePaise), discountPaise: BigInt(l.discountPaise ?? 0),
      taxablePaise: l.taxablePaise, gstRateBp: l.gstRateBp, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, totalPaise: l.totalPaise, position, sourceLineId: l.sourceLineId ?? null, freeQuantity: (l.freeQuantity ?? 0).toFixed(3),
      batchId: l.batchId ?? null, serials: [...new Set(l.serials ?? [])],
    })),
  };
}

export async function getDocument(ctx: TenantCtx, id: string, kind: SalesDocKind) {
  const doc = await db().salesDocument.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { position: 'asc' } },
      payments: { orderBy: { createdAt: 'asc' } },
      adjustments: { orderBy: { createdAt: 'asc' }, include: { payment: { select: { number: true } }, creditNote: { select: { number: true, sourceId: true } } } },
    },
  });
  if (!doc || doc.kind !== kind || !inScope(ctx, doc, SCOPE_FIELDS)) throw notFound({ invoice: 'Invoice', quotation: 'Quotation', credit_note: 'Credit note', opening_balance: 'Opening balance', sales_order: 'Sales order', delivery_challan: 'Delivery challan', debit_note: 'Debit note' }[kind]);
  return doc;
}

export async function createDocument(ctx: TenantCtx, kind: 'invoice' | 'quotation' | 'sales_order' | 'delivery_challan', input: DocInput, opts: { issue?: boolean; sourceType?: string; sourceId?: string; skipCreditLimit?: boolean } = {}) {
  const { tenant, doc, lines } = await prepare(ctx, input);
  // Default terms from Settings › Documents when the document has none
  if (!doc.terms) {
    const d = withDefaults(tenant.preferences).documents;
    doc.terms = (kind === 'invoice' ? d.terms : d.quotationTerms) || null;
  }
  // Quotations and orders are numbered when created; invoices only when issued (never burn numbers on drafts)
  const numbered = kind === 'invoice' ? null : await allocateNumber(ctx.tenantId, kind, tenant.fyStartMonth);
  const created = await db().salesDocument.create({
    data: {
      ...doc, tenantId: ctx.tenantId, kind, status: kind === 'sales_order' ? 'open' : kind === 'delivery_challan' ? 'issued' : 'draft', number: numbered?.number, fy: numbered?.fy, shareToken: kind === 'sales_order' || kind === 'delivery_challan' ? randomToken(18) : undefined,
      createdBy: ctx.userId, sourceType: opts.sourceType, sourceId: opts.sourceId,
      lines: { create: lines.map(({ tenantId: _t, ...l }) => ({ ...l, tenantId: ctx.tenantId })) },
    },
  });
  if (kind === 'invoice' && opts.issue) return issueInvoice(ctx, created.id, { skipCreditLimit: opts.skipCreditLimit });
  // A challan goes out with the goods, so stock leaves now
  if (kind === 'delivery_challan') await postDocumentStock(ctx, created.id);
  return getDocument(ctx, created.id, kind);
}

export async function updateDocument(ctx: TenantCtx, id: string, kind: SalesDocKind, input: DocInput, version: number) {
  const existing = await getDocument(ctx, id, kind);
  const editable = kind === 'invoice' ? existing.status === 'draft' : kind === 'sales_order' ? existing.status === 'open' : kind === 'delivery_challan' ? existing.status === 'issued' : ['draft', 'sent'].includes(existing.status);
  // BIL-04: issued invoices are immutable; corrections go through credit/debit notes
  if (!editable) throw new AppError('CONFLICT', kind === 'invoice' ? 'Issued invoices cannot be edited. Cancel it or issue a credit note.' : kind === 'sales_order' ? 'This order can no longer be edited.' : kind === 'delivery_challan' ? 'This challan is already invoiced or cancelled.' : 'This quotation can no longer be edited.');
  if (kind === 'sales_order' && (await db().salesDocument.count({ where: { kind: { in: ['invoice', 'delivery_challan'] }, sourceId: id, status: { not: 'cancelled' } } }))) {
    throw new AppError('CONFLICT', 'This order has invoices or challans, so it can no longer be edited.');
  }
  if (existing.version !== version) throw new AppError('VERSION_CONFLICT', 'This document was changed by someone else. Reload and try again.');
  const { doc, lines } = await prepare(ctx, input, existing);
  await db().salesDocumentLine.deleteMany({ where: { documentId: id } });
  await db().salesDocument.update({
    where: { id },
    data: { ...doc, version: { increment: 1 }, lines: { create: lines.map(({ tenantId: _t, ...l }) => ({ ...l, tenantId: ctx.tenantId })) } },
  });
  if (existing.sourceType === 'sales_order' && existing.sourceId) await refreshOrderStatus(existing.sourceId);
  // An edited challan: put the old quantities back, take the new ones out
  if (kind === 'delivery_challan') {
    await reverseSource(ctx, id);
    await postDocumentStock(ctx, id);
  }
  return getDocument(ctx, id, kind);
}

/** What the customer owes now on bills, before this one. */
async function customerOwes(contactId: string) {
  const open = await db().salesDocument.aggregate({
    where: { contactId, kind: { in: ['invoice', 'opening_balance', 'debit_note'] }, status: { in: ['issued', 'partially_paid'] } },
    _sum: { totalPaise: true, paidPaise: true },
  });
  // Advances and credit not yet used are the customer's money, so they come off, as in the ledger
  const [advances, credits] = await Promise.all([
    db().payment.findMany({ where: { contactId, documentId: null, reversesId: null, reversal: null }, select: { amountPaise: true, adjustments: { select: { amountPaise: true } } } }),
    db().salesDocument.aggregate({ where: { contactId, kind: 'credit_note', status: 'issued' }, _sum: { totalPaise: true, paidPaise: true } }),
  ]);
  const heldAdvance = advances.reduce((sum, a) => sum + a.amountPaise - a.adjustments.reduce((used, u) => used + u.amountPaise, 0n), 0n);
  const heldCredit = (credits._sum.totalPaise ?? 0n) - (credits._sum.paidPaise ?? 0n);
  return (open._sum.totalPaise ?? 0n) - (open._sum.paidPaise ?? 0n) - heldAdvance - heldCredit;
}

async function checkCreditLimit(contactId: string | null, addingPaise: bigint) {
  if (!contactId) return;
  const contact = await db().contact.findUnique({ where: { id: contactId }, select: { creditLimitPaise: true } });
  if (contact?.creditLimitPaise == null) return;
  const owes = await customerOwes(contactId);
  if (owes + addingPaise <= contact.creditLimitPaise) return;
  const rupees = (p: bigint) => `₹${(Number(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  throw new AppError('CONFLICT', `This takes the customer over their credit limit of ${rupees(contact.creditLimitPaise)}. They owe ${rupees(owes)}, and this bill adds ${rupees(addingPaise)}.`, { creditLimit: true });
}

/** Issue a draft invoice: allocate the FY number, freeze seller details, count against the plan. */
export async function issueInvoice(ctx: TenantCtx, id: string, opts: { skipCreditLimit?: boolean } = {}) {
  const doc = await getDocument(ctx, id, 'invoice');
  if (doc.status !== 'draft') throw new AppError('CONFLICT', 'Only draft invoices can be issued.');
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  if (!tenant.billingStateCode) {
    throw new AppError('VALIDATION_FAILED', 'Add your business state and address in Settings before issuing invoices.', { fields: { billingStateCode: 'Required to calculate GST' } });
  }
  // Recompute with the tenant's current state so the CGST/SGST vs IGST split is right
  const input: DocInput = {
    contactId: doc.contactId,
    buyer: doc.contactId ? undefined : (doc.buyer as unknown as DocInput['buyer']),
    branchId: doc.branchId,
    issueDate: doc.issueDate.toISOString().slice(0, 10),
    dueDate: doc.dueDate?.toISOString().slice(0, 10) ?? null,
    notes: doc.notes,
    terms: doc.terms,
    roundOff: doc.roundOffPaise !== 0n,
    shipTo: doc.shipTo as DocInput['shipTo'],
    lines: doc.lines.map((l) => ({ itemId: l.itemId, description: l.description, hsnSac: l.hsnSac, unit: l.unit, quantity: Number(l.quantity), unitPricePaise: Number(l.unitPricePaise), discountPaise: Number(l.discountPaise), gstRateBp: l.gstRateBp, sourceLineId: l.sourceLineId, freeQuantity: Number(l.freeQuantity), batchId: l.batchId, serials: l.serials })),
  };
  const { doc: fresh, lines } = await prepare(ctx, input, doc);
  if (!opts.skipCreditLimit) await checkCreditLimit(doc.contactId, fresh.totalPaise);

  const ent = await getEntitlements(ctx.tenantId);
  await consumeMonthly(ctx, 'invoices', ent.limits.invoicesPerMonth, 'invoices');
  const { number, fy } = await allocateNumber(ctx.tenantId, 'invoice', tenant.fyStartMonth, doc.issueDate);
  const branch = doc.branchId ? await db().branch.findUnique({ where: { id: doc.branchId } }) : null;
  const prefs = withDefaults(tenant.preferences, tenant.profile);
  const profile = (tenant.profile ?? {}) as WorkspaceProfile;
  const pay = prefs.payments;
  const seller = {
    name: tenant.name, legalName: tenant.legalName, gstin: branch?.gstin ?? tenant.gstin,
    stateCode: branch?.stateCode ?? tenant.billingStateCode, address: branch?.address ?? tenant.address, logoUrl: tenant.logoUrl,
    phone: profile.phone ?? null, email: profile.email ?? null, brandColor: prefs.branding.brandColor,
    // Frozen with the invoice, so later bank changes never alter an issued invoice
    bank: pay.bankAccount ? { holder: pay.bankHolder, account: pay.bankAccount, ifsc: pay.ifsc } : null,
    upiId: pay.upiId || null, showUpiQr: pay.showUpiQr && !!pay.upiId,
    // Settings › Documents › Print, frozen with the invoice like everything else here
    showHsnSummary: prefs.documents.showHsnSummary, showSignatory: prefs.documents.showSignatory, paper: prefs.documents.paper,
    // Decided here and frozen: which document this is, whatever the business becomes later
    // Rule 49 CGST Rules: a registered business on composition, or selling only exempt or nil-rated
    // goods, issues a bill of supply. A business not registered under GST is outside GST and issues a
    // plain invoice with no GST words on it.
    billOfSupply: !!tenant.gstin && (prefs.taxes.composition || lines.every((l) => l.gstRateBp === 0)),
    composition: !!tenant.gstin && prefs.taxes.composition,
    unregistered: !tenant.gstin,
  };
  await db().salesDocumentLine.deleteMany({ where: { documentId: id } });
  await db().salesDocument.update({
    where: { id },
    data: {
      ...fresh, status: 'issued', number, fy, seller: seller as Prisma.InputJsonValue, issuedAt: new Date(),
      shareToken: randomToken(18), version: { increment: 1 },
      lines: { create: lines.map(({ tenantId: _t, ...l }) => ({ ...l, tenantId: ctx.tenantId })) },
    },
  });
  await postDocumentStock(ctx, id);
  await markOnboarding(ctx, 'firstInvoice');
  await audit({ action: 'billing.invoice.issue', entity: 'invoice', entityId: id, after: { number, totalPaise: fresh.totalPaise } });
  await publish('invoice.issued', { documentId: id });
  return getDocument(ctx, id, 'invoice');
}

export async function cancelInvoice(ctx: TenantCtx, id: string, reason: string) {
  const doc = await getDocument(ctx, id, 'invoice');
  if (doc.status === 'draft') throw new AppError('CONFLICT', 'Delete the draft instead of cancelling it.');
  if (doc.status === 'cancelled') throw new AppError('CONFLICT', 'This invoice is already cancelled.');
  if (doc.paidPaise > 0n) throw new AppError('CONFLICT', 'This invoice has payments recorded. Issue a credit note instead (paid plans).');
  if (await db().salesDocument.count({ where: { kind: 'debit_note', sourceId: id, status: { not: 'cancelled' } } })) {
    throw new AppError('CONFLICT', 'This invoice has a debit note. Cancel the debit note first.');
  }
  await db().salesDocument.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } } });
  if (doc.sourceType === 'sales_order' && doc.sourceId) await refreshOrderStatus(doc.sourceId);
  if (doc.sourceType === 'delivery_challan' && doc.sourceId) await reopenChallan(doc.sourceId);
  await reverseSource(ctx, id);
  await audit({ action: 'billing.invoice.cancel', entity: 'invoice', entityId: id, before: { status: doc.status }, after: { reason } });
  return getDocument(ctx, id, 'invoice');
}

export const PaymentInput = z.object({
  amountPaise: z.number().int().positive(),
  method: z.enum(['cash', 'upi', 'card', 'bank', 'cheque', 'other']),
  reference: z.string().trim().max(100).optional().nullable(),
  paidOn: DateStr.optional(),
  notes: z.string().trim().max(500).optional().nullable(),
  /** The cash or bank account it went into; empty = by method */
  accountId: z.string().uuid().optional().nullable(),
});

/** BIL-03: record a receipt against an issued invoice; status moves to partially paid / paid. */
export async function recordPayment(ctx: TenantCtx, id: string, input: z.infer<typeof PaymentInput>, kind: 'invoice' | 'opening_balance' | 'debit_note' = 'invoice') {
  const doc = await getDocument(ctx, id, kind);
  if (!['issued', 'partially_paid'].includes(doc.status)) throw new AppError('CONFLICT', 'Payments can only be recorded on issued, unpaid invoices.');
  const balance = doc.totalPaise - doc.paidPaise;
  if (BigInt(input.amountPaise) > balance) {
    throw new AppError('VALIDATION_FAILED', `Amount is more than the balance due (₹${(Number(balance) / 100).toFixed(2)}).`, { fields: { amountPaise: 'More than balance due' } });
  }
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { fyStartMonth: true } });
  const { number } = await allocateNumber(ctx.tenantId, 'receipt', tenant.fyStartMonth);
  const payment = await db().payment.create({
    data: { ...input, accountId: await resolveAccount(ctx, input.accountId, input.method), paidOn: dateOnly(input.paidOn ?? todayIST()), amountPaise: BigInt(input.amountPaise), tenantId: ctx.tenantId, documentId: id, contactId: doc.contactId, number, createdBy: ctx.userId },
  });
  await setPaid(doc, doc.paidPaise + BigInt(input.amountPaise));
  await audit({ action: 'billing.payment.record', entity: 'payment', entityId: payment.id, after: { invoice: doc.number, amountPaise: input.amountPaise, method: input.method } });
  // That message talks about an invoice, and an opening balance has none
  if (kind === 'invoice') await publish('payment.received', { documentId: id, paymentId: payment.id, amountPaise: input.amountPaise });
  return getDocument(ctx, id, kind);
}

/** Set an order's status from how much of it is on invoices that are not cancelled. */
export async function refreshOrderStatus(orderId: string) {
  const order = await db().salesDocument.findUnique({ where: { id: orderId }, include: { lines: true } });
  if (!order || order.kind !== 'sales_order' || order.status === 'cancelled') return;
  const invoiced = await db().salesDocumentLine.findMany({
    where: { sourceLineId: { in: order.lines.map((l) => l.id) }, document: { kind: { in: ['invoice', 'delivery_challan'] }, status: { not: 'cancelled' } } },
    select: { sourceLineId: true, quantity: true },
  });
  const done = (lineId: string) => invoiced.filter((i) => i.sourceLineId === lineId).reduce((s, i) => s + Number(i.quantity), 0);
  const status = !invoiced.length ? 'open' : order.lines.every((l) => done(l.id) >= Number(l.quantity)) ? 'completed' : 'part_invoiced';
  if (status !== order.status) await db().salesDocument.update({ where: { id: orderId }, data: { status, version: { increment: 1 } } });
}

/** The invoice made from a challan went away: the challan can be invoiced again. */
export async function reopenChallan(challanId: string) {
  await db().salesDocument.updateMany({ where: { id: challanId, kind: 'delivery_challan', status: 'converted' }, data: { status: 'issued', version: { increment: 1 } } });
}

/** Issue a walk-in or counter bill and take the whole amount in one step. */
export async function createCashBill(ctx: TenantCtx, input: DocInput, receive: { method: z.infer<typeof PaymentInput>['method']; reference?: string | null }) {
  // The money comes in now, so nothing is added to what the customer owes
  const invoice = await createDocument(ctx, 'invoice', input, { issue: true, skipCreditLimit: true });
  if (invoice.totalPaise <= 0n) return invoice;
  return recordPayment(ctx, invoice.id, { amountPaise: Number(invoice.totalPaise), method: receive.method, reference: receive.reference ?? null });
}

/** Save the invoice's paid amount and status. Two people changing it at once: the second is refused. */
export async function setPaid(doc: SalesDocument, paid: bigint, credited = doc.creditedPaise) {
  const status = paid <= 0n ? 'issued' : paid >= doc.totalPaise ? 'paid' : 'partially_paid';
  const { count } = await db().salesDocument.updateMany({ where: { id: doc.id, version: doc.version }, data: { paidPaise: paid, creditedPaise: credited, status, version: { increment: 1 } } });
  if (!count) throw new AppError('VERSION_CONFLICT', 'This invoice was changed by someone else. Reload and try again.');
}

/** Save how much of a credit note is used or refunded. Its status stays as it is. */
export async function setCreditUsed(note: SalesDocument, used: bigint) {
  const { count } = await db().salesDocument.updateMany({ where: { id: note.id, version: note.version }, data: { paidPaise: used, version: { increment: 1 } } });
  if (!count) throw new AppError('VERSION_CONFLICT', 'This credit note was changed by someone else. Reload and try again.');
}

/**
 * Undo a wrong receipt with an opposite entry; receipts are never edited or deleted. The new row
 * keeps the original's owner so that person's own totals net out; the audit log records who did it.
 * Returns the invoice or credit note it was on, or null when the receipt was an advance.
 */
export async function reversePayment(ctx: TenantCtx, id: string) {
  const payment = await db().payment.findUnique({ where: { id }, include: { reversal: { select: { id: true } }, adjustments: { select: { amountPaise: true } } } });
  if (!payment || !inScope(ctx, payment, { owner: ['createdBy'] })) throw notFound('Payment');
  if (payment.reversesId) throw new AppError('CONFLICT', 'This entry is itself a reversal.');
  if (payment.reversal) throw new AppError('CONFLICT', 'This payment is already reversed.');
  // A refund sits on its credit note: undoing it gives the credit back
  const owner = payment.documentId ? await db().salesDocument.findUnique({ where: { id: payment.documentId }, select: { kind: true } }) : null;
  const note = owner?.kind === 'credit_note' ? await getDocument(ctx, payment.documentId!, 'credit_note') : null;
  const doc = owner?.kind === 'invoice' || owner?.kind === 'opening_balance' || owner?.kind === 'debit_note' ? await getDocument(ctx, payment.documentId!, owner.kind) : null;
  if (!doc && !note && payment.adjustments.reduce((sum, a) => sum + a.amountPaise, 0n) > 0n) {
    throw new AppError('CONFLICT', 'This advance is used on an invoice. Remove it from the invoice first.');
  }
  const reversal = await db().payment.create({
    data: {
      tenantId: ctx.tenantId, documentId: payment.documentId, contactId: payment.contactId, number: `${payment.number}-R`, amountPaise: -payment.amountPaise,
      method: payment.method, accountId: payment.accountId, reference: payment.reference, paidOn: dateOnly(todayIST()), notes: `Reversal of ${payment.number}`, reversesId: payment.id, createdBy: payment.createdBy,
    },
  });
  if (doc) await setPaid(doc, doc.paidPaise - payment.amountPaise);
  if (note) await setCreditUsed(note, note.paidPaise + payment.amountPaise);
  await audit({ action: 'billing.payment.reverse', entity: 'payment', entityId: payment.id, after: { reversal: reversal.number, invoice: doc?.number ?? note?.number ?? null, amountPaise: payment.amountPaise } });
  if (note) return getDocument(ctx, note.id, 'credit_note');
  return doc ? getDocument(ctx, doc.id, owner!.kind) : null;
}

// ── Advances: money from a customer before there is an invoice ──

export const AdvanceInput = PaymentInput.extend({ contactId: z.string().uuid() });

// No payment.received event here: that message talks about an invoice, and an advance has none.
export async function recordAdvance(ctx: TenantCtx, input: z.infer<typeof AdvanceInput>) {
  const contact = await db().contact.findUnique({ where: { id: input.contactId }, select: { id: true } });
  if (!contact) throw new AppError('VALIDATION_FAILED', 'Unknown customer.', { fields: { contactId: 'Unknown customer' } });
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { fyStartMonth: true } });
  const { number } = await allocateNumber(ctx.tenantId, 'receipt', tenant.fyStartMonth);
  const payment = await db().payment.create({
    data: { ...input, accountId: await resolveAccount(ctx, input.accountId, input.method), paidOn: dateOnly(input.paidOn ?? todayIST()), amountPaise: BigInt(input.amountPaise), tenantId: ctx.tenantId, number, createdBy: ctx.userId },
  });
  await audit({ action: 'billing.advance.record', entity: 'payment', entityId: payment.id, after: { contactId: input.contactId, amountPaise: input.amountPaise, method: input.method } });
  return payment;
}

/** A customer's advances, newest first, each with what is left of it, plus the total left. */
export async function listAdvances(ctx: TenantCtx, contactId: string) {
  const rows = await db().payment.findMany({
    where: { AND: [{ contactId, documentId: null, reversesId: null }, scopeWhere(ctx, { owner: ['createdBy'] })] },
    include: { reversal: { select: { id: true } }, adjustments: { select: { amountPaise: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const advances = rows.map(({ reversal, adjustments, ...p }) => {
    const usedPaise = adjustments.reduce((sum, a) => sum + a.amountPaise, 0n);
    return { ...p, reversed: !!reversal, usedPaise, balancePaise: reversal ? 0n : p.amountPaise - usedPaise };
  });
  const notes = await db().salesDocument.findMany({
    where: { AND: [{ kind: 'credit_note', status: 'issued', contactId }, scopeWhere(ctx, SCOPE_FIELDS)] },
    select: { id: true, number: true, issueDate: true, totalPaise: true, paidPaise: true },
    orderBy: { issueDate: 'desc' },
  });
  const credits = notes.filter((c) => c.totalPaise > c.paidPaise).map((c) => ({ id: c.id, number: c.number, issueDate: c.issueDate, balancePaise: c.totalPaise - c.paidPaise }));
  return {
    data: advances,
    credits,
    balancePaise: advances.reduce((sum, a) => sum + a.balancePaise, 0n),
    creditPaise: credits.reduce((sum, c) => sum + c.balancePaise, 0n),
  };
}

export const UseAdvanceInput = z.object({ paymentId: z.string().uuid().optional(), creditNoteId: z.string().uuid().optional(), amountPaise: z.number().int().positive() })
  .refine((v) => !!v.paymentId !== !!v.creditNoteId, { message: 'Choose an advance or a credit note', path: ['paymentId'] });

/** Put part or all of an advance against an invoice of the same customer. */
export async function useAdvance(ctx: TenantCtx, invoiceId: string, input: z.infer<typeof UseAdvanceInput>) {
  const doc = await getDocument(ctx, invoiceId, 'invoice');
  if (!['issued', 'partially_paid'].includes(doc.status)) throw new AppError('CONFLICT', 'An advance can only be used on issued, unpaid invoices.');
  if (input.creditNoteId) return useCredit(ctx, doc, input.creditNoteId, BigInt(input.amountPaise));
  const advance = await db().payment.findUnique({ where: { id: input.paymentId! }, include: { reversal: { select: { id: true } }, adjustments: { select: { amountPaise: true } } } });
  const usable = advance && !advance.documentId && !advance.reversesId && !advance.reversal && advance.contactId === doc.contactId && inScope(ctx, advance, { owner: ['createdBy'] });
  if (!advance || !usable) throw new AppError('VALIDATION_FAILED', "Choose an advance from this invoice's customer.", { fields: { paymentId: 'Not available' } });
  const left = advance.amountPaise - advance.adjustments.reduce((sum, a) => sum + a.amountPaise, 0n);
  const amount = BigInt(input.amountPaise);
  if (amount > left) throw new AppError('VALIDATION_FAILED', `Only ₹${(Number(left) / 100).toFixed(2)} is left in this advance.`, { fields: { amountPaise: 'More than the advance left' } });
  const due = doc.totalPaise - doc.paidPaise;
  if (amount > due) throw new AppError('VALIDATION_FAILED', `Amount is more than the balance due (₹${(Number(due) / 100).toFixed(2)}).`, { fields: { amountPaise: 'More than balance due' } });
  const adjustment = await db().advanceAdjustment.create({ data: { tenantId: ctx.tenantId, paymentId: advance.id, documentId: doc.id, amountPaise: amount, createdBy: ctx.userId } });
  await setPaid(doc, doc.paidPaise + amount);
  await audit({ action: 'billing.advance.use', entity: 'advance_adjustment', entityId: adjustment.id, after: { advance: advance.number, invoice: doc.number, amountPaise: input.amountPaise } });
  return getDocument(ctx, doc.id, 'invoice');
}

async function useCredit(ctx: TenantCtx, doc: SalesDocument, creditNoteId: string, amount: bigint) {
  const note = await db().salesDocument.findUnique({ where: { id: creditNoteId } });
  const usable = note && note.kind === 'credit_note' && note.status === 'issued' && note.contactId === doc.contactId && !!doc.contactId && inScope(ctx, note, SCOPE_FIELDS);
  if (!note || !usable) throw new AppError('VALIDATION_FAILED', "Choose a credit note from this invoice's customer.", { fields: { paymentId: 'Not available' } });
  const left = note.totalPaise - note.paidPaise;
  if (amount > left) throw new AppError('VALIDATION_FAILED', `Only ₹${(Number(left) / 100).toFixed(2)} is left on this credit note.`, { fields: { amountPaise: 'More than the credit left' } });
  const due = doc.totalPaise - doc.paidPaise;
  if (amount > due) throw new AppError('VALIDATION_FAILED', `Amount is more than the balance due (₹${(Number(due) / 100).toFixed(2)}).`, { fields: { amountPaise: 'More than balance due' } });
  const adjustment = await db().advanceAdjustment.create({ data: { tenantId: ctx.tenantId, creditNoteId: note.id, documentId: doc.id, amountPaise: amount, createdBy: ctx.userId } });
  await setPaid(doc, doc.paidPaise + amount, doc.creditedPaise + amount);
  await setCreditUsed(note, note.paidPaise + amount);
  await audit({ action: 'billing.credit_note.use', entity: 'advance_adjustment', entityId: adjustment.id, after: { creditNote: note.number, invoice: doc.number, amountPaise: Number(amount) } });
  return getDocument(ctx, doc.id, 'invoice');
}

/** Take an advance or credit note back off an invoice with an opposite row; the value returns to it. */
export async function removeAdvanceUse(ctx: TenantCtx, id: string) {
  const adjustment = await db().advanceAdjustment.findUnique({ where: { id }, include: { reversal: { select: { id: true } } } });
  if (!adjustment) throw notFound('Advance adjustment');
  const doc = await getDocument(ctx, adjustment.documentId, 'invoice');
  if (adjustment.reversesId || adjustment.reversal) throw new AppError('CONFLICT', 'This advance is already removed from the invoice.');
  const note = adjustment.creditNoteId ? await db().salesDocument.findUniqueOrThrow({ where: { id: adjustment.creditNoteId } }) : null;
  if (note?.sourceId === doc.id) throw new AppError('CONFLICT', 'This credit note was made for this invoice. Cancel the credit note instead.');
  await db().advanceAdjustment.create({ data: { tenantId: ctx.tenantId, paymentId: adjustment.paymentId, creditNoteId: adjustment.creditNoteId, documentId: doc.id, amountPaise: -adjustment.amountPaise, reversesId: adjustment.id, createdBy: ctx.userId } });
  await setPaid(doc, doc.paidPaise - adjustment.amountPaise, doc.creditedPaise - (note ? adjustment.amountPaise : 0n));
  if (note) await setCreditUsed(note, note.paidPaise - adjustment.amountPaise);
  await audit({ action: 'billing.advance.remove', entity: 'advance_adjustment', entityId: adjustment.id, after: { invoice: doc.number, amountPaise: adjustment.amountPaise } });
  return getDocument(ctx, doc.id, 'invoice');
}

/** Copy a quotation into a new draft invoice or an order and mark the quotation converted (SAL-01). */
export async function convertQuotation(ctx: TenantCtx, id: string, target: 'invoice' | 'sales_order' = 'invoice') {
  const q = await getDocument(ctx, id, 'quotation');
  if (q.status === 'converted') throw new AppError('CONFLICT', 'This quotation is already converted.');
  if (q.status === 'declined') throw new AppError('CONFLICT', 'Declined quotations cannot be converted.');
  const invoice = await createDocument(
    ctx,
    target,
    {
      contactId: q.contactId,
      buyer: q.contactId ? undefined : (q.buyer as unknown as DocInput['buyer']),
      branchId: q.branchId,
      notes: q.notes,
      terms: q.terms,
      shipTo: q.shipTo as DocInput['shipTo'],
      locationId: q.locationId,
      lines: q.lines.map((l) => ({ itemId: l.itemId, description: l.description, hsnSac: l.hsnSac, unit: l.unit, quantity: Number(l.quantity), unitPricePaise: Number(l.unitPricePaise), discountPaise: Number(l.discountPaise), gstRateBp: l.gstRateBp })),
    },
    { sourceType: 'quotation', sourceId: q.id },
  );
  await db().salesDocument.update({ where: { id: q.id }, data: { status: 'converted', version: { increment: 1 } } });
  return invoice;
}

/** Public view for share links: only what the buyer needs, no internal ids. */
export async function publicDocument(token: string) {
  const doc = await db().salesDocument.findUnique({ where: { shareToken: token }, include: { lines: { orderBy: { position: 'asc' } } } });
  if (!doc || doc.status === 'draft') throw notFound('Document');
  return {
    kind: doc.kind, number: doc.number, status: doc.status, issueDate: doc.issueDate, dueDate: doc.dueDate, buyer: doc.buyer, seller: doc.seller,
    creditedPaise: doc.creditedPaise, noteType: doc.noteType, sourceNumber: doc.sourceNumber, sourceDate: doc.sourceDate, shipTo: doc.shipTo,
    ewayBillNo: doc.ewayBillNo, ewayBillDate: doc.ewayBillDate, irn: doc.irn, irnAckNo: doc.irnAckNo, irnAckDate: doc.irnAckDate,
    placeOfSupply: doc.placeOfSupply, subtotalPaise: doc.subtotalPaise, discountPaise: doc.discountPaise, taxablePaise: doc.taxablePaise,
    cgstPaise: doc.cgstPaise, sgstPaise: doc.sgstPaise, igstPaise: doc.igstPaise, roundOffPaise: doc.roundOffPaise, totalPaise: doc.totalPaise, paidPaise: doc.paidPaise,
    notes: doc.notes, terms: doc.terms,
    lines: doc.lines.map((l) => ({ description: l.description, hsnSac: l.hsnSac, unit: l.unit, quantity: l.quantity, freeQuantity: l.freeQuantity, unitPricePaise: l.unitPricePaise, discountPaise: l.discountPaise, taxablePaise: l.taxablePaise, gstRateBp: l.gstRateBp, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, totalPaise: l.totalPaise })),
  };
}
