import { z } from 'zod';
import { Prisma, type Contact, type Item, type PurchaseDocument, type PurchaseDocumentLine } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { GST_RATES_BP, computeDocument, computeLine, dateOnly, divRound, todayIST } from '../../kernel/gst';
import { allocateNumber } from '../../kernel/sequences';
import { DateStr, Paise } from '../../kernel/query';
import { optionalText, zEmail, zGstin, zHsnOrSac, zPhone, zStateCode } from '../../kernel/zodRules';
import { gstinStateMismatch } from '../../contracts/validation';
import { withDefaults } from '../../contracts/workspace';
import { audit } from '../audit/service';
import { applyMove, fromMilli, loadRules, milli, reverseSource, unitFactor } from '../inventory/engine';
import { ensureBatch } from '../inventory/service';

// Purchase (batch 1): suppliers, purchase orders, goods receipts (GRN), purchase bills, purchase
// returns and payments to suppliers. Stock comes in on a GRN, or on a bill made without one.
// A bill made from a GRN moves no stock: the GRN already did. Tax decisions are cited where made.

export type PurchaseKind = 'purchase_order' | 'goods_receipt' | 'purchase_bill' | 'purchase_return';
const LABEL: Record<PurchaseKind, string> = { purchase_order: 'Purchase order', goods_receipt: 'Goods receipt', purchase_bill: 'Purchase bill', purchase_return: 'Purchase return' };
const DAY = 86_400_000;
/** Purchase papers often reach the office late; stock dates may go back this far (decision P3) */
const BACKDATE_DAYS = 90;

/** A draft invoice counts for nothing until it is posted */
const live = { notIn: ['cancelled', 'draft'] };
const owes = (d: { kind: string; status: string }) => d.kind === 'purchase_bill' && d.status !== 'cancelled' && d.status !== 'draft';
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

// ---------------------------------------------------------------- suppliers

export const SupplierInput = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(160, 'Keep it under 160 characters'),
  companyName: optionalText(z.string().trim().max(160)),
  phone: optionalText(zPhone),
  email: optionalText(zEmail),
  gstin: optionalText(zGstin),
  stateCode: zStateCode.optional().nullable(),
  address: z.record(z.string().max(200)).optional().nullable(),
  notes: optionalText(z.string().trim().max(1000)),
  /** Days the supplier gives to pay; sets each bill's due date */
  paymentDays: z.number().int().min(0).max(365).optional().nullable(),
});
const checkSupplierGstin = (b: { gstin?: string | null; stateCode?: string | null }) => {
  const mismatch = gstinStateMismatch(b.gstin, b.stateCode);
  if (mismatch) throw new AppError('VALIDATION_FAILED', mismatch, { fields: { gstin: mismatch } });
};
export const SupplierPatch = SupplierInput.partial().extend({ isActive: z.boolean().optional(), version: z.number().int() });
export const SupplierList = z.object({
  q: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

/** What is owed to each supplier: bills less payments and returns. Negative = they owe you. */
export async function supplierBalances(contactIds?: string[]) {
  const rows = await db().purchaseDocument.groupBy({
    by: ['contactId'],
    where: { kind: 'purchase_bill', status: live, ...(contactIds ? { contactId: { in: contactIds } } : {}) },
    _sum: { totalPaise: true, paidPaise: true, returnedPaise: true },
  });
  return new Map(rows.map((r) => [r.contactId, (r._sum.totalPaise ?? 0n) - (r._sum.paidPaise ?? 0n) - (r._sum.returnedPaise ?? 0n)]));
}

export async function listSuppliers(ctx: TenantCtx, q: z.infer<typeof SupplierList>) {
  const rows = await db().contact.findMany({
    where: {
      tenantId: ctx.tenantId, type: 'supplier', isActive: q.active === 'all' ? undefined : q.active === 'true',
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { companyName: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }, { gstin: { contains: q.q.toUpperCase() } }] } : {}),
    },
    orderBy: { name: 'asc' },
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const data = rows.slice(0, q.limit);
  const owed = await supplierBalances(data.map((c) => c.id));
  return { data: data.map((c) => ({ ...c, balancePaise: owed.get(c.id) ?? 0n })), nextCursor: rows.length > q.limit ? data[data.length - 1].id : null };
}

async function supplierOf(ctx: TenantCtx, id: string, field = 'contactId') {
  const c = await db().contact.findFirst({ where: { id, tenantId: ctx.tenantId, type: 'supplier' } });
  if (!c) throw new AppError('VALIDATION_FAILED', 'Choose a supplier.', { fields: { [field]: 'Unknown supplier' } });
  return c;
}

export async function getSupplier(ctx: TenantCtx, id: string) {
  const c = await db().contact.findFirst({ where: { id, tenantId: ctx.tenantId, type: 'supplier' } });
  if (!c) throw notFound('Supplier');
  const owed = await supplierBalances([c.id]);
  return { ...c, balancePaise: owed.get(c.id) ?? 0n };
}

export async function createSupplier(ctx: TenantCtx, input: z.infer<typeof SupplierInput>) {
  checkSupplierGstin(input);
  if (input.gstin) {
    const dup = await db().contact.findFirst({ where: { tenantId: ctx.tenantId, type: 'supplier', gstin: input.gstin }, select: { id: true, name: true } });
    if (dup) throw new AppError('CONFLICT', `${dup.name} already has this GSTIN.`, { duplicateId: dup.id, fields: { gstin: 'Already added' } });
  }
  const c = await db().contact.create({
    data: { ...input, address: input.address ?? undefined, stateCode: input.stateCode ?? input.gstin?.slice(0, 2) ?? null, tenantId: ctx.tenantId, type: 'supplier', ownerId: ctx.userId, createdBy: ctx.userId },
  });
  await audit({ action: 'inventory.supplier.create', entity: 'contact', entityId: c.id, after: { name: c.name, gstin: c.gstin } });
  return getSupplier(ctx, c.id);
}

export async function updateSupplier(ctx: TenantCtx, id: string, input: z.infer<typeof SupplierPatch>) {
  const c = await getSupplier(ctx, id);
  const { version, ...body } = input;
  if (c.version !== version) throw new AppError('CONFLICT', 'Someone else changed this supplier. Reload and try again.');
  checkSupplierGstin({ gstin: body.gstin === undefined ? c.gstin : body.gstin, stateCode: body.stateCode === undefined ? c.stateCode : body.stateCode });
  await db().contact.update({ where: { id }, data: { ...body, address: body.address === null ? Prisma.JsonNull : body.address, version: { increment: 1 } } });
  await audit({ action: 'inventory.supplier.edit', entity: 'contact', entityId: id, after: body });
  return getSupplier(ctx, id);
}

// ---------------------------------------------------------------- documents

const Rate = z.number().int().refine((v) => (GST_RATES_BP as readonly number[]).includes(v), 'Choose a valid GST rate');
const Line = z.object({
  itemId: z.string().uuid().optional().nullable(),
  description: z.string().trim().max(300).optional(),
  hsnSac: optionalText(zHsnOrSac),
  unit: z.string().trim().max(20).optional(),
  quantity: z.number().positive('Quantity must be more than 0').max(1e7),
  unitPricePaise: Paise,
  discountPaise: Paise.default(0),
  gstRateBp: Rate,
  /** The PO, GRN or bill line this line follows */
  sourceLineId: z.string().uuid().optional().nullable(),
  batchNo: z.string().trim().min(1).max(40).optional().nullable(),
  mfgDate: DateStr.optional().nullable(),
  expiryDate: DateStr.optional().nullable(),
  serials: z.array(z.string().trim().min(1).max(40)).max(1000).optional(),
});

export const PurchaseInput = z.object({
  contactId: z.string().uuid(),
  issueDate: DateStr.optional(),
  dueDate: DateStr.optional().nullable(),
  /** The supplier's invoice or challan number and date */
  supplierRef: optionalText(z.string().trim().max(40)),
  supplierDate: DateStr.optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  reverseCharge: z.boolean().default(false),
  /** Freight, loading and the like, before GST */
  chargesPaise: Paise.default(0),
  chargesGstBp: Rate.default(0),
  roundOff: z.boolean().default(true),
  notes: optionalText(z.string().trim().max(1000)),
  returnReason: optionalText(z.string().trim().max(40)),
  /** GRN or bill from a PO, bill from a GRN, return against a bill */
  sourceId: z.string().uuid().optional().nullable(),
  lines: z.array(Line).min(1, 'Add at least one item').max(300),
});
export type PurchaseInput = z.infer<typeof PurchaseInput>;

type Doc = PurchaseDocument & { lines: PurchaseDocumentLine[] };

export async function getPurchase(ctx: TenantCtx, id: string, kind?: PurchaseKind) {
  const d = await db().purchaseDocument.findFirst({ where: { id, tenantId: ctx.tenantId, ...(kind ? { kind } : {}) }, include: { lines: { orderBy: { position: 'asc' } } } });
  if (!d) throw notFound(kind ? LABEL[kind] : 'Purchase document');
  return d;
}

/** The document with what has happened to it since: received, billed, returned, paid. */
export async function purchaseView(ctx: TenantCtx, id: string, kind?: PurchaseKind) {
  const d = await getPurchase(ctx, id, kind);
  const usedBy = d.kind === 'purchase_order' ? ['goods_receipt', 'purchase_bill'] : d.kind === 'goods_receipt' ? ['purchase_bill'] : d.kind === 'purchase_bill' ? ['purchase_return'] : [];
  const used = usedBy.length ? await usedQty(d.lines.map((l) => l.id), usedBy) : new Map<string, bigint>();
  const [children, payments, location] = await Promise.all([
    db().purchaseDocument.findMany({ where: { sourceId: d.id }, select: { id: true, kind: true, number: true, status: true, issueDate: true, totalPaise: true }, orderBy: { createdAt: 'asc' } }),
    d.kind === 'purchase_bill' ? db().supplierPayment.findMany({ where: { documentId: d.id }, orderBy: { createdAt: 'asc' } }) : Promise.resolve([]),
    d.locationId ? db().stockLocation.findUnique({ where: { id: d.locationId }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);
  const reversed = new Set(payments.filter((p) => p.reversesId).map((p) => p.reversesId));
  return {
    ...d,
    location,
    balancePaise: owes(d) ? d.totalPaise - d.paidPaise - d.returnedPaise : 0n,
    lines: d.lines.map((l) => ({ ...l, quantity: Number(l.quantity), doneQuantity: fromMilli(used.get(l.id) ?? 0n) })),
    children,
    payments: payments.map((p) => ({ ...p, reversed: reversed.has(p.id) })),
  };
}

/** Quantity already taken from each source line by live documents of these kinds (thousandths) */
async function usedQty(sourceLineIds: string[], kinds: string[], exceptDocId?: string) {
  if (!sourceLineIds.length) return new Map<string, bigint>();
  const rows = await db().purchaseDocumentLine.findMany({
    where: { sourceLineId: { in: sourceLineIds }, document: { kind: { in: kinds }, status: live, ...(exceptDocId ? { id: { not: exceptDocId } } : {}) } },
    select: { sourceLineId: true, quantity: true },
  });
  const m = new Map<string, bigint>();
  for (const r of rows) m.set(r.sourceLineId!, (m.get(r.sourceLineId!) ?? 0n) + milli(r.quantity));
  return m;
}

function checkDate(date: string, field: string, maxBack?: number) {
  const today = dateOnly(todayIST());
  const d = dateOnly(date);
  if (d > today) throw new AppError('VALIDATION_FAILED', "The date can't be in the future.", { fields: { [field]: 'In the future' } });
  if (maxBack !== undefined && today.getTime() - d.getTime() > maxBack * DAY) {
    throw new AppError('VALIDATION_FAILED', `Stock can be received at most ${maxBack} days back.`, { fields: { [field]: `More than ${maxBack} days ago` } });
  }
  return d;
}

/** Which documents a new one may come from */
const SOURCE_KINDS: Record<PurchaseKind, PurchaseKind[]> = {
  purchase_order: [],
  goods_receipt: ['purchase_order'],
  purchase_bill: ['purchase_order', 'goods_receipt'],
  purchase_return: ['purchase_bill'],
};
const OPEN_SOURCE: Record<string, string[]> = { purchase_order: ['open', 'part_received'], goods_receipt: ['received'], purchase_bill: ['unpaid', 'part_paid', 'paid'] };

/** Does this document bring stock in (or take it out)? */
const movesStock = (kind: PurchaseKind, sourceKind: string | null) => kind === 'goods_receipt' || kind === 'purchase_return' || (kind === 'purchase_bill' && sourceKind !== 'goods_receipt');

/** Spread an amount over weights so the parts add up exactly */
function spread(total: bigint, weights: bigint[]) {
  const all = sum(weights);
  if (total === 0n || all === 0n) return weights.map(() => 0n);
  const parts = weights.map((w) => (total * w) / all);
  let left = total - sum(parts);
  for (let i = parts.length - 1; left > 0n && i >= 0; i--) if (weights[i] > 0n) { parts[i] += left; left = 0n; }
  return parts;
}

async function prepare(ctx: TenantCtx, kind: PurchaseKind, input: PurchaseInput, exceptDocId?: string, draft = false) {
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const supplier = await supplierOf(ctx, input.contactId);
  const taxes = withDefaults(tenant.preferences, tenant.profile).taxes;
  // Section 16 CGST Act: only a GST-registered business outside composition (Section 10(4)) takes
  // input tax credit. For anyone else the GST paid is part of what the goods cost (AS 2, para 11).
  const claimsItc = !!tenant.gstin && !taxes.composition;

  // The document this one comes from
  let source: Doc | null = null;
  if (input.sourceId) {
    source = await db().purchaseDocument.findFirst({ where: { id: input.sourceId, tenantId: ctx.tenantId }, include: { lines: true } });
    if (!source || !SOURCE_KINDS[kind].includes(source.kind as PurchaseKind)) throw new AppError('VALIDATION_FAILED', 'Unknown source document.', { fields: { sourceId: 'Unknown' } });
    if (source.contactId !== supplier.id) throw new AppError('VALIDATION_FAILED', `${source.number} is from another supplier.`, { fields: { contactId: 'Another supplier' } });
    if (!OPEN_SOURCE[source.kind].includes(source.status)) throw new AppError('CONFLICT', `${source.number} is ${source.status.replace('_', ' ')}, so nothing more can be made from it.`);
  } else if (kind === 'purchase_return') {
    throw new AppError('VALIDATION_FAILED', 'Choose the purchase bill the goods go back against.', { fields: { sourceId: 'Required' } });
  }
  const stock = movesStock(kind, source?.kind ?? null);

  // A draft may wait for the supplier's paper; everything is checked when it is posted
  if (kind === 'purchase_bill' && !draft) {
    // Rule 46: the supplier's invoice number and date are what ITC is matched on (GSTR-2B)
    if (!input.supplierRef) throw new AppError('VALIDATION_FAILED', "Enter the supplier's bill number.", { fields: { supplierRef: 'Required' } });
    if (!input.supplierDate) throw new AppError('VALIDATION_FAILED', "Enter the supplier's bill date.", { fields: { supplierDate: 'Required' } });
    const dup = await db().purchaseDocument.findFirst({
      where: { tenantId: ctx.tenantId, kind: 'purchase_bill', contactId: supplier.id, status: live, supplierRef: { equals: input.supplierRef, mode: 'insensitive' }, ...(exceptDocId ? { id: { not: exceptDocId } } : {}) },
      select: { number: true },
    });
    if (dup) throw new AppError('CONFLICT', `Bill ${input.supplierRef} of this supplier is already entered as ${dup.number}.`, { fields: { supplierRef: 'Already entered' } });
  }
  const issueDate = checkDate(input.issueDate ?? todayIST(), 'issueDate', stock ? BACKDATE_DAYS : undefined);
  if (input.supplierDate && dateOnly(input.supplierDate) > issueDate && kind !== 'purchase_order') {
    throw new AppError('VALIDATION_FAILED', "The supplier's date can't be after the date you got the goods.", { fields: { supplierDate: 'After the receipt date' } });
  }
  if (kind === 'purchase_return' && issueDate < source!.issueDate) throw new AppError('VALIDATION_FAILED', "A return can't be dated before its bill.", { fields: { issueDate: 'Before the bill' } });

  // Items
  const ids = [...new Set(input.lines.map((l) => l.itemId).filter(Boolean))] as string[];
  const items = ids.length ? await db().item.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } } }) : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const sourceLines = new Map((source?.lines ?? []).map((l) => [l.id, l]));
  const usedBy = source?.kind === 'purchase_order' ? ['goods_receipt', 'purchase_bill'] : source?.kind === 'goods_receipt' ? ['purchase_bill'] : ['purchase_return'];
  const used = source ? await usedQty([...sourceLines.keys()], usedBy, exceptDocId) : new Map<string, bigint>();
  const thisDoc = new Map<string, bigint>();

  const resolved = input.lines.map((l, i) => {
    const item = l.itemId ? byId.get(l.itemId) : undefined;
    if (l.itemId && !item) throw new AppError('VALIDATION_FAILED', 'Unknown item.', { fields: { [`lines.${i}.itemId`]: 'Unknown item' } });
    const from = l.sourceLineId ? sourceLines.get(l.sourceLineId) : undefined;
    if (l.sourceLineId && !from) throw new AppError('VALIDATION_FAILED', `This line is not on ${source?.number ?? 'the source'}.`, { fields: { [`lines.${i}.sourceLineId`]: 'Not on the source' } });
    if (kind === 'purchase_return' && !from) throw new AppError('VALIDATION_FAILED', 'Each returned line must come from the bill.', { fields: { [`lines.${i}.sourceLineId`]: 'Required' } });
    if (from) {
      if ((from.itemId ?? null) !== (item?.id ?? null)) throw new AppError('VALIDATION_FAILED', 'The item differs from the source line.', { fields: { [`lines.${i}.itemId`]: 'Different item' } });
      const q = milli(l.quantity);
      const taken = (used.get(from.id) ?? 0n) + (thisDoc.get(from.id) ?? 0n);
      const left = milli(from.quantity) - taken;
      // No over-receipt: receive more only on a new or changed order (decision P4)
      if (q > left) {
        const what = kind === 'purchase_return' ? 'returned' : kind === 'purchase_bill' && source!.kind === 'goods_receipt' ? 'billed' : 'received';
        throw new AppError('VALIDATION_FAILED', `Only ${fromMilli(left > 0n ? left : 0n)} ${from.unit} of ${from.description} is left to be ${what}.`, { fields: { [`lines.${i}.quantity`]: `At most ${fromMilli(left > 0n ? left : 0n)}` } });
      }
      thisDoc.set(from.id, (thisDoc.get(from.id) ?? 0n) + q);
    }
    const description = l.description || from?.description || item?.name;
    if (!description) throw new AppError('VALIDATION_FAILED', 'Each line needs a description.', { fields: { [`lines.${i}.description`]: 'Required' } });
    if (l.discountPaise > Math.round(l.unitPricePaise * l.quantity)) throw new AppError('VALIDATION_FAILED', 'Discount cannot exceed the line amount.', { fields: { [`lines.${i}.discountPaise`]: 'Too large' } });
    // A return goes back at the bill's price and tax; its discount in the same share
    const priced = kind === 'purchase_return' && from
      ? { unitPricePaise: Number(from.unitPricePaise), gstRateBp: from.gstRateBp, discountPaise: Number(divRound(from.discountPaise * milli(l.quantity), milli(from.quantity) || 1n)) }
      : { unitPricePaise: l.unitPricePaise, gstRateBp: l.gstRateBp, discountPaise: l.discountPaise };
    const unit = from?.unit ?? (l.unit || item?.unit || 'pcs');
    return { ...l, ...priced, item, from, description, unit, hsnSac: l.hsnSac ?? from?.hsnSac ?? item?.hsnSac ?? null };
  });

  // Section 9(4): an unregistered supplier charges no GST. Tax on such a purchase is paid only under
  // reverse charge where it is notified (Section 9(3)/9(4)), which is the reverse charge flag.
  const supplierState = supplier.stateCode ?? supplier.gstin?.slice(0, 2) ?? null;
  const reverseCharge = kind === 'purchase_return' ? source!.reverseCharge : input.reverseCharge;
  const noTax = !supplier.gstin && !reverseCharge;
  const lines = resolved.map((l) => (noTax ? { ...l, gstRateBp: 0 } : l));
  // Section 8 IGST Act: goods from another state carry IGST; from our own state, CGST and SGST
  const intraState = !tenant.billingStateCode || !supplierState || supplierState === tenant.billingStateCode;
  const { lines: computed, totals } = computeDocument(lines, intraState);
  const chargesPaise = kind === 'purchase_return' ? 0 : input.chargesPaise;
  const chargesGstBp = noTax ? 0 : input.chargesGstBp;
  const charge = computeLine({ quantity: 1, unitPricePaise: chargesPaise, gstRateBp: chargesGstBp }, intraState);
  const taxablePaise = totals.taxablePaise + charge.taxablePaise;
  const tax = { cgstPaise: totals.cgstPaise + charge.cgstPaise, sgstPaise: totals.sgstPaise + charge.sgstPaise, igstPaise: totals.igstPaise + charge.igstPaise };
  const taxTotal = tax.cgstPaise + tax.sgstPaise + tax.igstPaise;
  // Reverse charge: the supplier is paid the value only; we pay the tax to the government (Section 9(3))
  const beforeRound = taxablePaise + (reverseCharge ? 0n : taxTotal);
  const roundOffPaise = input.roundOff && kind !== 'purchase_return' ? divRound(beforeRound, 100n) * 100n - beforeRound : 0n;

  // Landed cost (AS 2 para 11): freight and other charges, and GST that cannot be claimed, are part of
  // the stock's cost. Spread over the goods lines by their value.
  const goods = computed.map((l) => (stock && l.item?.type === 'product' ? l.taxablePaise : 0n));
  const chargeShare = kind === 'purchase_return' ? goods.map(() => 0n) : spread(charge.taxablePaise, goods);
  const chargeTaxShare = claimsItc || kind === 'purchase_return' ? goods.map(() => 0n) : spread(charge.cgstPaise + charge.sgstPaise + charge.igstPaise, goods);
  const lineRows = computed.map((l, position) => {
    const lineTax = l.cgstPaise + l.sgstPaise + l.igstPaise;
    // A return leaves at the cost it came in at (from its stock move), so it carries no landed share
    const landed = goods[position] > 0n && kind !== 'purchase_return' ?chargeShare[position] + chargeTaxShare[position] + (claimsItc ? 0n : lineTax) : 0n;
    return {
      tenantId: ctx.tenantId, itemId: l.item?.id ?? null, description: l.description, hsnSac: l.hsnSac, unit: l.unit,
      quantity: (Number(l.quantityMilli) / 1000).toFixed(3), unitPricePaise: BigInt(l.unitPricePaise), discountPaise: BigInt(l.discountPaise ?? 0),
      taxablePaise: l.taxablePaise, gstRateBp: l.gstRateBp, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, totalPaise: l.totalPaise,
      landedPaise: landed, position, sourceLineId: l.from?.id ?? null,
      batchNo: l.batchNo ?? l.from?.batchNo ?? null, mfgDate: l.mfgDate ? dateOnly(l.mfgDate) : (l.from?.mfgDate ?? null), expiryDate: l.expiryDate ? dateOnly(l.expiryDate) : (l.from?.expiryDate ?? null),
      serials: [...new Set(l.serials ?? [])],
    };
  });

  const dueDate = input.dueDate
    ? dateOnly(input.dueDate)
    : kind === 'purchase_bill' && supplier.paymentDays != null ? new Date((input.supplierDate ? dateOnly(input.supplierDate) : issueDate).getTime() + supplier.paymentDays * DAY) : null;
  return {
    tenant, supplier, source, stock, claimsItc, items: byId,
    doc: {
      contactId: supplier.id,
      supplier: { name: supplier.companyName || supplier.name, gstin: supplier.gstin, phone: supplier.phone, stateCode: supplierState, address: supplier.address } as Prisma.InputJsonValue,
      supplierRef: input.supplierRef ?? null,
      supplierDate: input.supplierDate ? dateOnly(input.supplierDate) : null,
      issueDate, dueDate,
      placeOfSupply: tenant.billingStateCode ?? null,
      reverseCharge,
      subtotalPaise: totals.subtotalPaise, discountPaise: totals.discountPaise, taxablePaise, ...tax,
      chargesPaise: BigInt(chargesPaise), chargesGstBp,
      roundOffPaise, totalPaise: beforeRound + roundOffPaise,
      sourceType: source?.kind ?? null, sourceId: source?.id ?? null, sourceNumber: source?.number ?? null,
      notes: input.notes ?? null,
      returnReason: kind === 'purchase_return' ? (input.returnReason ?? null) : null,
    },
    lines: lineRows,
  };
}

/** Stock in for each goods line, at its price plus its landed share, per base unit */
async function receiveStock(ctx: TenantCtx, doc: Doc, items: Map<string, Item>, supplierId: string) {
  const rules = await loadRules(ctx);
  const locationId = doc.locationId!;
  const products: string[] = [];
  for (const [i, l] of doc.lines.entries()) {
    const item = l.itemId ? items.get(l.itemId) : undefined;
    if (!item || item.type !== 'product') continue;
    const factor = unitFactor(l.unit, item);
    const q = (milli(l.quantity) * factor) / 1000n;
    if (item.tracking === 'serial' && l.serials.length * 1000 !== Number(q)) {
      throw new AppError('VALIDATION_FAILED', `Enter ${fromMilli(q)} serial numbers for ${item.name}.`, { fields: { [`lines.${i}.serials`]: 'Count does not match' } });
    }
    if (item.tracking === 'batch' && !l.batchNo) throw new AppError('VALIDATION_FAILED', `Enter the batch number for ${item.name}.`, { fields: { [`lines.${i}.batchNo`]: 'Batch needed' } });
    const batch = item.tracking === 'batch' ? await ensureBatch(ctx, item.id, l.batchNo!, l.mfgDate, l.expiryDate) : null;
    const cost = l.taxablePaise + l.landedPaise;
    const rate = q > 0n ? (cost * 1000n) / q : 0n;
    await applyMove(ctx, { itemId: item.id, locationId, date: doc.issueDate, kind: 'purchase', qtyMilli: q, ratePaise: rate, sourceType: 'purchase', sourceId: doc.id, sourceLineId: l.id, batchId: batch?.id, serials: l.serials.length ? l.serials : undefined, rules });
    products.push(item.id);
    // Last purchase price and the usual supplier, for the next order
    await db().item.update({ where: { id: item.id }, data: { trackStock: true, costPricePaise: rate, ...(item.preferredSupplierId ? {} : { preferredSupplierId: supplierId }) } });
  }
  return products;
}

/** Goods back to the supplier: out of the warehouse and batch they came into, at the cost they came in at */
async function returnStock(ctx: TenantCtx, ret: Doc, bill: Doc, items: Map<string, Item>) {
  const rules = await loadRules(ctx);
  const billLines = new Map(bill.lines.map((l) => [l.id, l]));
  for (const [i, l] of ret.lines.entries()) {
    const item = l.itemId ? items.get(l.itemId) : undefined;
    const bl = billLines.get(l.sourceLineId!);
    if (!item || item.type !== 'product' || !bl) continue;
    // The move that brought it in: the bill's own, or the GRN's the bill was made from
    const inMoves = await db().stockMove.findMany({ where: { tenantId: ctx.tenantId, sourceLineId: { in: [bl.id, ...(bl.sourceLineId ? [bl.sourceLineId] : [])] }, reversesId: null, kind: 'purchase' } });
    const live = [];
    for (const mv of inMoves) if (!(await db().stockMove.findFirst({ where: { reversesId: mv.id }, select: { id: true } }))) live.push(mv);
    const came = live[0];
    if (!came) continue;
    const q = (milli(l.quantity) * unitFactor(l.unit, item)) / 1000n;
    if (item.tracking === 'serial' && l.serials.length * 1000 !== Number(q)) {
      throw new AppError('VALIDATION_FAILED', `Enter ${fromMilli(q)} serial numbers for ${item.name}.`, { fields: { [`lines.${i}.serials`]: 'Count does not match' } });
    }
    await applyMove(ctx, { itemId: item.id, locationId: came.locationId, date: ret.issueDate, kind: 'purchase_return', qtyMilli: -q, ratePaise: came.ratePaise, sourceType: 'purchase', sourceId: ret.id, sourceLineId: l.id, batchId: came.batchId, serials: l.serials.length ? l.serials : undefined, rules });
  }
}

async function locationFor(ctx: TenantCtx, id: string | null | undefined, fallback?: string | null) {
  const want = id ?? fallback;
  if (want) {
    const loc = await db().stockLocation.findFirst({ where: { id: want, tenantId: ctx.tenantId } });
    if (!loc) throw new AppError('VALIDATION_FAILED', 'Unknown warehouse.', { fields: { locationId: 'Unknown warehouse' } });
    if (!loc.isActive) throw new AppError('VALIDATION_FAILED', 'This warehouse is closed.', { fields: { locationId: 'Closed' } });
    return loc.id;
  }
  const found = await db().stockLocation.findFirst({ where: { tenantId: ctx.tenantId, isDefault: true, isActive: true } });
  if (found) return found.id;
  return (await db().stockLocation.create({ data: { tenantId: ctx.tenantId, name: 'Main warehouse', isDefault: true } })).id;
}

const FIRST_STATUS: Record<PurchaseKind, string> = { purchase_order: 'open', goods_receipt: 'received', purchase_bill: 'unpaid', purchase_return: 'issued' };

export async function createPurchase(ctx: TenantCtx, kind: PurchaseKind, input: PurchaseInput, opts: { draft?: boolean } = {}) {
  const draft = !!opts.draft && (kind === 'purchase_bill' || kind === 'purchase_return');
  const p = await prepare(ctx, kind, input, undefined, draft);
  // A return's warehouse is the invoice's, for the list; its stock leaves from where it came in
  const locationId = kind === 'purchase_return' ? (p.source?.locationId ?? null) : await locationFor(ctx, input.locationId, p.source?.locationId);
  const { number, fy } = await allocateNumber(ctx.tenantId, kind, p.tenant.fyStartMonth, p.doc.issueDate);
  if (draft) {
    const saved = await db().purchaseDocument.create({
      data: { ...p.doc, tenantId: ctx.tenantId, kind, status: 'draft', number, fy, locationId, branchId: ctx.branchIds[0] ?? null, createdBy: ctx.userId, lines: { create: p.lines.map(({ tenantId: _t, ...l }) => ({ ...l, tenantId: ctx.tenantId })) } },
    });
    await audit({ action: `inventory.${kind}.draft`, entity: 'purchase_document', entityId: saved.id, after: { number, supplier: p.supplier.name, totalPaise: saved.totalPaise } });
    return purchaseView(ctx, saved.id);
  }
  const created = await db().purchaseDocument.create({
    data: { ...p.doc, tenantId: ctx.tenantId, kind, status: FIRST_STATUS[kind], number, fy, locationId, branchId: ctx.branchIds[0] ?? null, createdBy: ctx.userId, lines: { create: p.lines.map(({ tenantId: _t, ...l }) => ({ ...l, tenantId: ctx.tenantId })) } },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  const items = p.items;
  if (p.stock && kind !== 'purchase_return') await receiveStock(ctx, created, items, p.supplier.id);
  if (kind === 'purchase_return') {
    const bill = p.source!;
    await returnStock(ctx, created, bill, items);
    const fresh = await db().purchaseDocument.findUniqueOrThrow({ where: { id: bill.id } });
    await setBillStatus(fresh, fresh.paidPaise, fresh.returnedPaise + created.totalPaise);
  }
  if (p.source) await refreshSource(p.source.id);
  await audit({ action: `inventory.${kind}.create`, entity: 'purchase_document', entityId: created.id, after: { kind, number, supplier: p.supplier.name, totalPaise: created.totalPaise, from: p.source?.number ?? null } });
  return purchaseView(ctx, created.id);
}

async function draftOf(ctx: TenantCtx, id: string, version: number, kind?: PurchaseKind) {
  const d = await getPurchase(ctx, id, kind);
  if (d.kind !== 'purchase_bill' && d.kind !== 'purchase_return') throw new AppError('CONFLICT', 'This document has no draft stage.');
  if (d.version !== version) throw new AppError('CONFLICT', 'Someone else changed this. Reload and try again.');
  if (d.status !== 'draft') throw new AppError('CONFLICT', 'This is no longer a draft, so it can no longer change.');
  return d;
}

/** What a saved document was entered as, so posting or approving runs every check again */
const inputFrom = (d: Doc): PurchaseInput => ({
  contactId: d.contactId, issueDate: iso(d.issueDate) ?? undefined, dueDate: iso(d.dueDate), supplierRef: d.supplierRef, supplierDate: iso(d.supplierDate),
  locationId: d.locationId, reverseCharge: d.reverseCharge, chargesPaise: Number(d.chargesPaise), chargesGstBp: d.chargesGstBp, roundOff: d.roundOffPaise !== 0n, notes: d.notes, returnReason: d.returnReason, sourceId: d.sourceId,
  lines: d.lines.map((l) => ({
    itemId: l.itemId, description: l.description, hsnSac: l.hsnSac, unit: l.unit, quantity: Number(l.quantity), unitPricePaise: Number(l.unitPricePaise), discountPaise: Number(l.discountPaise), gstRateBp: l.gstRateBp,
    sourceLineId: l.sourceLineId, batchNo: l.batchNo, mfgDate: iso(l.mfgDate), expiryDate: iso(l.expiryDate), serials: l.serials,
  })),
});

/** Change a draft invoice or return; with `post`, an invoice is saved and posted together */
export async function updateBillDraft(ctx: TenantCtx, id: string, input: PurchaseInput, version: number, post = false) {
  const d = await draftOf(ctx, id, version);
  const kind = d.kind as PurchaseKind;
  const p = await prepare(ctx, kind, { ...input, sourceId: d.sourceId }, id, true);
  const locationId = kind === 'purchase_return' ? d.locationId : await locationFor(ctx, input.locationId, d.locationId);
  await db().purchaseDocumentLine.deleteMany({ where: { documentId: id } });
  await db().purchaseDocument.update({
    where: { id },
    data: { ...p.doc, locationId, version: { increment: 1 }, lines: { create: p.lines.map(({ tenantId: _t, ...l }) => ({ ...l, tenantId: ctx.tenantId })) } },
  });
  await audit({ action: `inventory.${kind}.edit`, entity: 'purchase_document', entityId: id, after: { totalPaise: p.doc.totalPaise } });
  return post && kind === 'purchase_bill' ? postBill(ctx, id, version + 1) : purchaseView(ctx, id);
}

/** Approve a draft return: quantities are checked and held, but nothing moves yet */
export async function approveReturn(ctx: TenantCtx, id: string, version: number) {
  const d = await draftOf(ctx, id, version, 'purchase_return');
  const p = await prepare(ctx, 'purchase_return', inputFrom(d), id);
  await db().purchaseDocumentLine.deleteMany({ where: { documentId: id } });
  await db().purchaseDocument.update({
    where: { id },
    data: { ...p.doc, status: 'approved', version: { increment: 1 }, lines: { create: p.lines.map(({ tenantId: _t, ...l }) => ({ ...l, tenantId: ctx.tenantId })) } },
  });
  await audit({ action: 'inventory.purchase_return.approve', entity: 'purchase_document', entityId: id, after: { number: d.number, totalPaise: p.doc.totalPaise } });
  return purchaseView(ctx, id);
}

/** The goods have gone back: stock leaves and the invoice's balance comes down */
export async function completeReturn(ctx: TenantCtx, id: string, version: number) {
  const d = await getPurchase(ctx, id, 'purchase_return');
  if (d.version !== version) throw new AppError('CONFLICT', 'Someone else changed this return. Reload and try again.');
  if (d.status !== 'approved') throw new AppError('CONFLICT', 'Only an approved return can be completed.');
  const bill = await getPurchase(ctx, d.sourceId!, 'purchase_bill');
  if (bill.status === 'cancelled') throw new AppError('CONFLICT', `${bill.number} is cancelled, so this return can't be completed.`);
  const ids = [...new Set(d.lines.map((l) => l.itemId).filter(Boolean))] as string[];
  const items = new Map((await db().item.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } } })).map((i) => [i.id, i]));
  await returnStock(ctx, d, bill, items);
  await setBillStatus(bill, bill.paidPaise, bill.returnedPaise + d.totalPaise);
  await db().purchaseDocument.update({ where: { id }, data: { status: 'issued', version: { increment: 1 } } });
  await audit({ action: 'inventory.purchase_return.complete', entity: 'purchase_document', entityId: id, after: { number: d.number, totalPaise: d.totalPaise } });
  return purchaseView(ctx, id);
}

/** Post a draft: every check runs now, stock comes in, and the money is owed */
export async function postBill(ctx: TenantCtx, id: string, version: number) {
  const d = await draftOf(ctx, id, version, 'purchase_bill');
  const p = await prepare(ctx, 'purchase_bill', inputFrom(d), id);
  const locationId = await locationFor(ctx, d.locationId, p.source?.locationId);
  await db().purchaseDocumentLine.deleteMany({ where: { documentId: id } });
  const posted = await db().purchaseDocument.update({
    where: { id },
    data: { ...p.doc, locationId, status: 'unpaid', version: { increment: 1 }, lines: { create: p.lines.map(({ tenantId: _t, ...l }) => ({ ...l, tenantId: ctx.tenantId })) } },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  if (p.stock) await receiveStock(ctx, posted, p.items, p.supplier.id);
  if (p.source) await refreshSource(p.source.id);
  await audit({ action: 'inventory.purchase_bill.post', entity: 'purchase_document', entityId: id, after: { number: d.number, totalPaise: posted.totalPaise } });
  return purchaseView(ctx, id);
}

/** Only a draft can be removed; a posted invoice is cancelled and stays on record */
export async function deleteBillDraft(ctx: TenantCtx, id: string) {
  const d = await getPurchase(ctx, id);
  if (d.status !== 'draft') throw new AppError('CONFLICT', 'Only a draft can be deleted. Cancel it instead.');
  await db().purchaseDocument.delete({ where: { id } });
  await audit({ action: `inventory.${d.kind}.delete`, entity: 'purchase_document', entityId: id, before: { number: d.number } });
}

/** A purchase order can change until anything is received against it */
export async function updateOrder(ctx: TenantCtx, id: string, input: PurchaseInput, version: number) {
  const d = await getPurchase(ctx, id, 'purchase_order');
  if (d.version !== version) throw new AppError('CONFLICT', 'Someone else changed this order. Reload and try again.');
  if (d.status !== 'open') throw new AppError('CONFLICT', 'Goods have come against this order, so it can no longer change. Make a new order for the rest.');
  const used = await usedQty(d.lines.map((l) => l.id), ['goods_receipt', 'purchase_bill']);
  if ([...used.values()].some((q) => q > 0n)) throw new AppError('CONFLICT', 'Goods have come against this order, so it can no longer change.');
  const p = await prepare(ctx, 'purchase_order', { ...input, sourceId: null });
  const locationId = await locationFor(ctx, input.locationId, d.locationId);
  await db().purchaseDocumentLine.deleteMany({ where: { documentId: id } });
  await db().purchaseDocument.update({
    where: { id },
    data: { ...p.doc, locationId, version: { increment: 1 }, lines: { create: p.lines.map(({ tenantId: _t, ...l }) => ({ ...l, tenantId: ctx.tenantId })) } },
  });
  await audit({ action: 'inventory.purchase_order.edit', entity: 'purchase_document', entityId: id, after: { totalPaise: p.doc.totalPaise } });
  return purchaseView(ctx, id);
}

/** Order and GRN statuses follow what has been received or billed against them */
async function refreshSource(id: string) {
  const d = await db().purchaseDocument.findUnique({ where: { id }, include: { lines: true } });
  if (!d || d.status === 'cancelled' || d.status === 'closed') return;
  if (d.kind === 'purchase_order') {
    const used = await usedQty(d.lines.map((l) => l.id), ['goods_receipt', 'purchase_bill']);
    const any = [...used.values()].some((q) => q > 0n);
    const all = d.lines.every((l) => (used.get(l.id) ?? 0n) >= milli(l.quantity));
    await db().purchaseDocument.update({ where: { id }, data: { status: all ? 'received' : any ? 'part_received' : 'open' } });
  } else if (d.kind === 'goods_receipt') {
    const used = await usedQty(d.lines.map((l) => l.id), ['purchase_bill']);
    const all = d.lines.every((l) => (used.get(l.id) ?? 0n) >= milli(l.quantity));
    await db().purchaseDocument.update({ where: { id }, data: { status: all ? 'billed' : 'received' } });
  }
}

async function setBillStatus(bill: PurchaseDocument, paid: bigint, returned: bigint) {
  const settled = paid + returned;
  const status = settled >= bill.totalPaise ? 'paid' : settled > 0n ? 'part_paid' : 'unpaid';
  await db().purchaseDocument.update({ where: { id: bill.id }, data: { paidPaise: paid, returnedPaise: returned, status } });
}

/** Undo a purchase document. What depends on it must be undone first. */
export async function cancelPurchase(ctx: TenantCtx, id: string, reason: string) {
  const d = await getPurchase(ctx, id);
  if (d.status === 'cancelled') throw new AppError('CONFLICT', 'Already cancelled.');
  if (d.status === 'draft') throw new AppError('CONFLICT', 'This is only a draft. Delete it instead.');
  // An approved return has moved nothing yet, so there is nothing to undo
  if (d.status === 'approved') {
    await db().purchaseDocument.update({ where: { id }, data: { status: 'cancelled', cancelReason: reason, cancelledAt: new Date(), version: { increment: 1 } } });
    await audit({ action: `inventory.${d.kind}.cancel`, entity: 'purchase_document', entityId: id, after: { number: d.number, reason } });
    return purchaseView(ctx, id);
  }
  const children = await db().purchaseDocument.findMany({ where: { sourceId: d.id, status: live }, select: { number: true } });
  if (children.length) throw new AppError('CONFLICT', `Cancel ${children.map((c) => c.number).join(', ')} first; ${children.length > 1 ? 'they come' : 'it comes'} from this ${LABEL[d.kind as PurchaseKind].toLowerCase()}.`);
  if (d.kind === 'purchase_bill' && d.paidPaise > 0n) throw new AppError('CONFLICT', 'Money is paid against this bill. Reverse the payments first.');
  if (movesStock(d.kind as PurchaseKind, d.sourceType)) await reverseSource(ctx, d.id);
  await db().purchaseDocument.update({ where: { id }, data: { status: 'cancelled', cancelReason: reason, cancelledAt: new Date(), version: { increment: 1 } } });
  if (d.kind === 'purchase_return' && d.sourceId) {
    const bill = await db().purchaseDocument.findUniqueOrThrow({ where: { id: d.sourceId } });
    await setBillStatus(bill, bill.paidPaise, bill.returnedPaise - d.totalPaise);
  }
  if (d.sourceId) await refreshSource(d.sourceId);
  await audit({ action: `inventory.${d.kind}.cancel`, entity: 'purchase_document', entityId: id, after: { number: d.number, reason } });
  return purchaseView(ctx, id);
}

/** Short-close an order: nothing more is expected against it */
export async function closeOrder(ctx: TenantCtx, id: string) {
  const d = await getPurchase(ctx, id, 'purchase_order');
  if (d.status !== 'part_received' && d.status !== 'open') throw new AppError('CONFLICT', `This order is ${d.status.replace('_', ' ')}.`);
  await db().purchaseDocument.update({ where: { id }, data: { status: 'closed', version: { increment: 1 } } });
  await audit({ action: 'inventory.purchase_order.close', entity: 'purchase_document', entityId: id, after: { number: d.number } });
  return purchaseView(ctx, id);
}

export const PurchaseList = z.object({
  kind: z.enum(['purchase_order', 'goods_receipt', 'purchase_bill', 'purchase_return']),
  status: z.string().max(16).optional(),
  contactId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: DateStr.optional(),
  to: DateStr.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

export async function listPurchases(ctx: TenantCtx, q: z.infer<typeof PurchaseList>) {
  const today = dateOnly(todayIST());
  const where: Prisma.PurchaseDocumentWhereInput = {
    tenantId: ctx.tenantId, kind: q.kind, contactId: q.contactId,
    ...(q.status === 'overdue' ? { status: { in: ['unpaid', 'part_paid'] }, dueDate: { lt: today } } : q.status === 'pending' ? { status: { in: ['open', 'part_received'] } } : q.status ? { status: q.status } : {}),
    ...(q.from || q.to ? { issueDate: { ...(q.from ? { gte: dateOnly(q.from) } : {}), ...(q.to ? { lte: dateOnly(q.to) } : {}) } } : {}),
    ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { supplierRef: { contains: q.q, mode: 'insensitive' } }, { supplier: { path: ['name'], string_contains: q.q } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db().purchaseDocument.findMany({ where, orderBy: { id: 'desc' }, take: q.limit + 1, include: q.kind === 'purchase_return' ? { lines: { orderBy: { position: 'asc' }, select: { description: true, quantity: true, unit: true } } } : undefined, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) }),
    db().purchaseDocument.count({ where }),
  ]);
  const warehouseIds = [...new Set(rows.map((d) => d.locationId).filter(Boolean))] as string[];
  const warehouses = new Map(q.kind === 'purchase_return' && warehouseIds.length ? (await db().stockLocation.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true } })).map((g) => [g.id, g]) : []);
  const data = rows.slice(0, q.limit).map((d) => ({ ...d, location: d.locationId ? (warehouses.get(d.locationId) ?? null) : null, balancePaise: owes(d) ? d.totalPaise - d.paidPaise - d.returnedPaise : 0n, overdue: d.kind === 'purchase_bill' && !!d.dueDate && d.dueDate < today && (d.status === 'unpaid' || d.status === 'part_paid') }));
  return { data, nextCursor: rows.length > q.limit ? data[data.length - 1].id : null, total };
}

// ---------------------------------------------------------------- payments to suppliers

export const SupplierPaymentInput = z.object({
  amountPaise: z.number().int().positive(),
  method: z.enum(['cash', 'upi', 'card', 'bank', 'cheque', 'other']),
  reference: z.string().trim().max(100).optional().nullable(),
  paidOn: DateStr.optional(),
});

export async function paySupplier(ctx: TenantCtx, billId: string, input: z.infer<typeof SupplierPaymentInput>) {
  const bill = await getPurchase(ctx, billId, 'purchase_bill');
  if (bill.status === 'cancelled') throw new AppError('CONFLICT', 'This bill is cancelled.');
  if (bill.status === 'draft') throw new AppError('CONFLICT', 'Post this invoice before paying it.');
  const due = bill.totalPaise - bill.paidPaise - bill.returnedPaise;
  if (BigInt(input.amountPaise) > due) {
    throw new AppError('VALIDATION_FAILED', `Amount is more than the balance due (₹${(Number(due > 0n ? due : 0n) / 100).toFixed(2)}).`, { fields: { amountPaise: 'More than balance due' } });
  }
  const paidOn = checkDate(input.paidOn ?? todayIST(), 'paidOn');
  if (paidOn < (bill.supplierDate ?? bill.issueDate)) throw new AppError('VALIDATION_FAILED', "A payment can't be dated before the bill.", { fields: { paidOn: 'Before the bill' } });
  // Section 269ST Income Tax Act / Section 40A(3): cash over ₹10,000 a day to one party is disallowed as expense
  if (input.method === 'cash' && input.amountPaise > 1_000_000) {
    const sameDay = await db().supplierPayment.aggregate({ where: { contactId: bill.contactId, method: 'cash', paidOn }, _sum: { amountPaise: true } });
    if ((sameDay._sum.amountPaise ?? 0n) + BigInt(input.amountPaise) > 1_000_000n) {
      throw new AppError('VALIDATION_FAILED', 'Cash payments to one supplier above ₹10,000 in a day are not allowed as a business expense (Section 40A(3)). Pay by bank or UPI.', { fields: { method: 'Over ₹10,000 in cash' } });
    }
  }
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { fyStartMonth: true } });
  const { number } = await allocateNumber(ctx.tenantId, 'supplier_payment', tenant.fyStartMonth, paidOn);
  const pay = await db().supplierPayment.create({
    data: { tenantId: ctx.tenantId, contactId: bill.contactId, documentId: bill.id, number, amountPaise: BigInt(input.amountPaise), method: input.method, reference: input.reference || null, paidOn, createdBy: ctx.userId },
  });
  await setBillStatus(bill, bill.paidPaise + BigInt(input.amountPaise), bill.returnedPaise);
  await audit({ action: 'inventory.supplier_payment.create', entity: 'supplier_payment', entityId: pay.id, after: { bill: bill.number, amountPaise: input.amountPaise, method: input.method } });
  return purchaseView(ctx, bill.id);
}

/** A wrong payment is undone by an opposite row; the original stays on record */
export async function reverseSupplierPayment(ctx: TenantCtx, paymentId: string) {
  const p = await db().supplierPayment.findFirst({ where: { id: paymentId, tenantId: ctx.tenantId } });
  if (!p || p.reversesId) throw notFound('Payment');
  if (await db().supplierPayment.findUnique({ where: { reversesId: p.id } })) throw new AppError('CONFLICT', 'This payment is already reversed.');
  const bill = await getPurchase(ctx, p.documentId, 'purchase_bill');
  await db().supplierPayment.create({
    data: { tenantId: ctx.tenantId, contactId: p.contactId, documentId: p.documentId, number: `${p.number}-R`, amountPaise: -p.amountPaise, method: p.method, reference: p.reference, paidOn: dateOnly(todayIST()), reversesId: p.id, createdBy: ctx.userId },
  });
  await setBillStatus(bill, bill.paidPaise - p.amountPaise, bill.returnedPaise);
  await audit({ action: 'inventory.supplier_payment.reverse', entity: 'supplier_payment', entityId: p.id, after: { bill: bill.number, amountPaise: p.amountPaise } });
  return purchaseView(ctx, bill.id);
}

export type { Contact };
