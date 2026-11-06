import { z } from 'zod';
import type { SalesDocument, SalesDocumentLine } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError, notFound } from '../../kernel/errors';
import type { TenantCtx } from '../../kernel/context';
import { DateStr, scopeWhere } from '../../kernel/query';
import { dateOnly } from '../../kernel/gst';
import { audit } from '../audit/service';
import { getDocument, SCOPE_FIELDS } from './service';

// Files for the government portals, made without a GST provider account: the business downloads
// the JSON, uploads it on the e-way bill or e-invoice portal, and types the number it gets back.
// Formats follow the portals' bulk-upload JSON as the India Compliance app (ERPNext) writes it.

export const EWAY_JSON_VERSION = '1.0.0621';
export const EINVOICE_VERSION = '1.1';
const MAX_PER_FILE = 500;

/** Unit names people type → the GST unit codes (UQC) the portals accept */
const UQC: Record<string, string> = {
  pcs: 'PCS', pc: 'PCS', piece: 'PCS', pieces: 'PCS', nos: 'NOS', no: 'NOS', number: 'NOS', unit: 'UNT', units: 'UNT', unt: 'UNT',
  kg: 'KGS', kgs: 'KGS', kilo: 'KGS', g: 'GMS', gm: 'GMS', gms: 'GMS', gram: 'GMS', grams: 'GMS', mg: 'OTH',
  l: 'LTR', ltr: 'LTR', litre: 'LTR', liter: 'LTR', litres: 'LTR', ml: 'MLT', m: 'MTR', mtr: 'MTR', meter: 'MTR', metre: 'MTR', cm: 'CMS',
  box: 'BOX', boxes: 'BOX', pkt: 'PAC', pack: 'PAC', packet: 'PAC', packs: 'PAC', bag: 'BAG', bags: 'BAG', dozen: 'DOZ', doz: 'DOZ',
  set: 'SET', sets: 'SET', pair: 'PRS', pairs: 'PRS', bottle: 'BTL', btl: 'BTL', can: 'CAN', roll: 'ROL', rolls: 'ROL', ton: 'TON', tonne: 'TON',
  qtl: 'QTL', quintal: 'QTL', sqft: 'SQF', sqm: 'SQM', bundle: 'BDL', bdl: 'BDL', carton: 'CTN', ctn: 'CTN', tube: 'TUB', drum: 'DRM', tin: 'TIN',
};
export const unitCode = (unit: string) => UQC[unit.trim().toLowerCase().replace(/\.$/, '')] ?? 'OTH';

const rupees = (p: bigint | number) => Math.round(Number(p)) / 100;
const pct = (bp: number) => bp / 100;
const qty = (q: unknown) => Number(q);
const isService = (hsn: string | null) => !!hsn && hsn.startsWith('99');
const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const PIN = /^[1-9]\d{5}$/;
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[^\w\s/.,&@#()-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

type Address = { line1?: string; line2?: string; city?: string; pincode?: string; state?: string };
type Party = { name: string; gstin?: string | null; stateCode?: string | null; address?: Address | null; phone?: string | null; email?: string | null };
type ShipTo = { name?: string | null; line1?: string | null; city?: string | null; pincode?: string | null; stateCode?: string | null };
type Doc = SalesDocument & { lines: SalesDocumentLine[] };

/** One document that can't go in the file yet, and why */
export interface Problem { id: string; number: string | null; problems: string[] }

async function loadDocs(ctx: TenantCtx, ids: string[]) {
  const docs = await db().salesDocument.findMany({
    where: { AND: [{ tenantId: ctx.tenantId, id: { in: ids } }, scopeWhere(ctx, SCOPE_FIELDS)] },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  const byId = new Map(docs.map((d) => [d.id, d]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw notFound('Document');
  return ids.map((id) => byId.get(id)!);
}

async function sellerFor(ctx: TenantCtx, doc: Doc) {
  const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const snap = (doc.seller ?? {}) as Partial<Party & { legalName: string | null; billOfSupply: boolean }>;
  const branch = doc.branchId ? await db().branch.findUnique({ where: { id: doc.branchId } }) : null;
  return {
    name: snap.name ?? tenant.name,
    legalName: snap.legalName ?? tenant.legalName ?? tenant.name,
    gstin: snap.gstin ?? branch?.gstin ?? tenant.gstin,
    stateCode: snap.stateCode ?? branch?.stateCode ?? tenant.billingStateCode,
    address: ((snap.address ?? branch?.address ?? tenant.address) ?? {}) as Address,
    phone: snap.phone ?? null,
    email: snap.email ?? null,
    billOfSupply: snap.billOfSupply ?? !tenant.gstin,
  };
}

function refuse(problems: Problem[], what: string): never {
  const lines = problems.map((p) => `${p.number ?? 'Draft'}: ${p.problems.join('; ')}`);
  throw new AppError('VALIDATION_FAILED', `Fix these before downloading the ${what} file. ${lines.join(' · ')}`, { documents: problems });
}

// ---------------------------------------------------------------- e-way bill

export const EwayInput = z
  .object({
    ids: z.array(z.string().uuid()).min(1, 'Choose at least one bill').max(MAX_PER_FILE, `Up to ${MAX_PER_FILE} bills in one file`),
    /** 1 road, 2 rail, 3 air, 4 ship */
    transMode: z.enum(['1', '2', '3', '4']).default('1'),
    /** 0 lets the portal work it out from the PIN codes */
    distanceKm: z.number().int().min(0, 'Enter 0 or more').max(4000, 'At most 4,000 km'),
    vehicleNo: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,15}$/, 'Letters and digits only, like MH12AB1234').optional().nullable(),
    vehicleType: z.enum(['R', 'O']).default('R'),
    transporterId: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, 'A transporter ID has 15 characters').optional().nullable(),
    transporterName: z.string().trim().max(100).optional().nullable(),
    transDocNo: z.string().trim().max(15).optional().nullable(),
    transDocDate: DateStr.optional().nullable(),
    /** For challans: 4 job work, 5 own use, 8 others, 10 line sales, 11 recipient not known, 12 exhibition */
    challanReason: z.union([z.literal(4), z.literal(5), z.literal(8), z.literal(10), z.literal(11), z.literal(12)]).default(8),
  })
  .superRefine((v, c) => {
    if (v.transMode === '1' && !v.vehicleNo && !v.transporterId) c.addIssue({ code: z.ZodIssueCode.custom, path: ['vehicleNo'], message: 'Enter the vehicle number, or a transporter ID to add it later' });
    if (v.transMode !== '1' && (!v.transDocNo || !v.transDocDate)) c.addIssue({ code: z.ZodIssueCode.custom, path: ['transDocNo'], message: 'Enter the railway receipt, airway bill or bill of lading number and date' });
  });

export async function ewayBillJson(ctx: TenantCtx, input: z.infer<typeof EwayInput>) {
  const docs = await loadDocs(ctx, [...new Set(input.ids)]);
  const problems: Problem[] = [];
  const bills = [];
  for (const doc of docs) {
    const issues: string[] = [];
    const seller = await sellerFor(ctx, doc);
    const buyer = doc.buyer as unknown as Party;
    const ship = (doc.shipTo ?? null) as ShipTo | null;
    if (!['invoice', 'delivery_challan'].includes(doc.kind)) issues.push('only invoices and delivery challans have e-way bills');
    if (doc.status === 'draft') issues.push('issue it first');
    if (doc.status === 'cancelled') issues.push('it is cancelled');
    if (!seller.gstin) issues.push('add your GSTIN in Settings');
    if (!PIN.test(seller.address.pincode ?? '')) issues.push('add your business PIN code in Settings');
    if (!seller.stateCode) issues.push('add your business state in Settings');
    const toPin = ship?.pincode || buyer.address?.pincode;
    if (!PIN.test(toPin ?? '')) issues.push(ship ? 'add the ship-to PIN code' : "add the customer's PIN code");
    const toState = buyer.gstin ? buyer.gstin.slice(0, 2) : (buyer.stateCode ?? doc.placeOfSupply);
    if (!toState || !doc.placeOfSupply) issues.push("add the customer's state");
    const noHsn = doc.lines.filter((l) => !l.hsnSac);
    if (noHsn.length) issues.push(`add the HSN code on ${noHsn.map((l) => l.description).slice(0, 3).join(', ')}`);
    const goods = doc.lines.filter((l) => l.hsnSac && !isService(l.hsnSac));
    if (!noHsn.length && !goods.length) issues.push('only services: an e-way bill is for goods');
    if (issues.length) {
      problems.push({ id: doc.id, number: doc.number, problems: issues });
      continue;
    }
    const sum = (k: 'taxablePaise' | 'cgstPaise' | 'sgstPaise' | 'igstPaise') => goods.reduce((s, l) => s + l[k], 0n);
    const goodsTotal = sum('taxablePaise') + sum('cgstPaise') + sum('sgstPaise') + sum('igstPaise');
    const main = [...goods].sort((a, b) => Number(b.taxablePaise - a.taxablePaise))[0];
    const invoice = doc.kind === 'invoice';
    bills.push({
      userGstin: seller.gstin,
      supplyType: 'O',
      subSupplyType: invoice ? 1 : input.challanReason,
      subSupplyDesc: !invoice && input.challanReason === 8 ? 'Delivery challan' : '',
      docType: invoice ? (seller.billOfSupply ? 'BIL' : 'INV') : 'CHL',
      docNo: doc.number,
      docDate: ddmmyyyy(doc.issueDate),
      transType: ship ? 2 : 1,
      fromGstin: seller.gstin,
      fromTrdName: clean(seller.legalName, 100),
      fromAddr1: clean(seller.address.line1, 120),
      fromAddr2: clean(seller.address.line2, 120),
      fromPlace: clean(seller.address.city, 50),
      fromPincode: Number(seller.address.pincode),
      fromStateCode: Number(seller.stateCode),
      actualFromStateCode: Number(seller.stateCode),
      toGstin: buyer.gstin || 'URP',
      toTrdName: clean(buyer.name, 100),
      toAddr1: clean(ship?.line1 || buyer.address?.line1, 120),
      toAddr2: clean(ship ? ship.name : buyer.address?.line2, 120),
      toPlace: clean(ship?.city || buyer.address?.city, 50),
      toPincode: Number(toPin),
      toStateCode: Number(toState),
      actualToStateCode: Number(doc.placeOfSupply),
      totalValue: rupees(sum('taxablePaise')),
      cgstValue: rupees(sum('cgstPaise')),
      sgstValue: rupees(sum('sgstPaise')),
      igstValue: rupees(sum('igstPaise')),
      cessValue: 0,
      TotNonAdvolVal: 0,
      // Services on the bill and round-off sit here, so the totals add up to the bill
      OthValue: rupees(doc.totalPaise - goodsTotal),
      totInvValue: rupees(doc.totalPaise),
      transMode: Number(input.transMode),
      transDistance: String(input.distanceKm),
      transporterName: clean(input.transporterName, 100),
      transporterId: input.transporterId ?? '',
      transDocNo: input.transMode === '1' ? '' : (input.transDocNo ?? ''),
      transDocDate: input.transMode !== '1' && input.transDocDate ? ddmmyyyy(dateOnly(input.transDocDate)) : '',
      vehicleNo: input.vehicleNo ?? '',
      vehicleType: input.vehicleType,
      mainHsnCode: Number(main.hsnSac),
      itemList: goods.map((l, i) => ({
        itemNo: i + 1,
        productName: clean(l.description, 100),
        productDesc: clean(l.description, 100),
        hsnCode: Number(l.hsnSac),
        // Free goods travel too
        quantity: qty(l.quantity) + qty(l.freeQuantity),
        qtyUnit: unitCode(l.unit),
        taxableAmount: rupees(l.taxablePaise),
        sgstRate: l.sgstPaise ? pct(l.gstRateBp / 2) : 0,
        cgstRate: l.cgstPaise ? pct(l.gstRateBp / 2) : 0,
        igstRate: l.igstPaise ? pct(l.gstRateBp) : 0,
        cessRate: 0,
        cessNonAdvol: 0,
      })),
    });
  }
  if (problems.length) refuse(problems, 'e-way bill');
  await audit({ action: 'billing.eway_json.download', entity: 'sales_document', after: { count: bills.length, numbers: docs.map((d) => d.number) } });
  return { version: EWAY_JSON_VERSION, billLists: bills };
}

// ---------------------------------------------------------------- e-invoice

export const EInvoiceInput = z.object({ ids: z.array(z.string().uuid()).min(1, 'Choose at least one bill').max(MAX_PER_FILE, `Up to ${MAX_PER_FILE} bills in one file`) });

const omitEmpty = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined));

export async function eInvoiceJson(ctx: TenantCtx, input: z.infer<typeof EInvoiceInput>) {
  const docs = await loadDocs(ctx, [...new Set(input.ids)]);
  const problems: Problem[] = [];
  const out = [];
  for (const doc of docs) {
    const issues: string[] = [];
    const seller = await sellerFor(ctx, doc);
    const buyer = doc.buyer as unknown as Party;
    const ship = (doc.shipTo ?? null) as ShipTo | null;
    if (!['invoice', 'credit_note', 'debit_note'].includes(doc.kind)) issues.push('only invoices, credit notes and debit notes are e-invoiced');
    if (['draft', 'cancelled'].includes(doc.status)) issues.push(doc.status === 'draft' ? 'issue it first' : 'it is cancelled');
    if (!seller.gstin || seller.billOfSupply) issues.push('only a GST registered business, not on composition, makes e-invoices');
    if (!buyer.gstin) issues.push('the customer has no GSTIN: e-invoices are for business customers');
    if (!PIN.test(seller.address.pincode ?? '')) issues.push('add your business PIN code in Settings');
    if (!seller.address.line1 || !seller.address.city) issues.push('add your business address and city in Settings');
    if (!PIN.test(buyer.address?.pincode ?? '')) issues.push("add the customer's PIN code");
    if (!buyer.address?.line1 || !buyer.address?.city) issues.push("add the customer's address and city");
    if (ship && !PIN.test(ship.pincode ?? '')) issues.push('add the ship-to PIN code');
    const noHsn = doc.lines.filter((l) => !l.hsnSac);
    if (noHsn.length) issues.push(`add the HSN code on ${noHsn.map((l) => l.description).slice(0, 3).join(', ')}`);
    if (issues.length) {
      problems.push({ id: doc.id, number: doc.number, problems: issues });
      continue;
    }
    const source = doc.kind !== 'invoice' && doc.sourceId ? await db().salesDocument.findUnique({ where: { id: doc.sourceId }, select: { number: true, issueDate: true } }) : null;
    const sumLines = (k: 'cgstPaise' | 'sgstPaise' | 'igstPaise') => doc.lines.reduce((s, l) => s + l[k], 0n);
    out.push(omitEmpty({
      Version: EINVOICE_VERSION,
      TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
      DocDtls: { Typ: doc.kind === 'credit_note' ? 'CRN' : doc.kind === 'debit_note' ? 'DBN' : 'INV', No: doc.number, Dt: ddmmyyyy(doc.issueDate) },
      SellerDtls: omitEmpty({
        Gstin: seller.gstin, LglNm: clean(seller.legalName, 100), TrdNm: clean(seller.name, 100), Addr1: clean(seller.address.line1, 100), Addr2: clean(seller.address.line2, 100),
        Loc: clean(seller.address.city, 50), Pin: Number(seller.address.pincode), Stcd: seller.gstin!.slice(0, 2), Ph: seller.phone?.replace(/\D/g, '').slice(-10), Em: seller.email,
      }),
      BuyerDtls: omitEmpty({
        Gstin: buyer.gstin, LglNm: clean(buyer.name, 100), Pos: doc.placeOfSupply ?? buyer.gstin!.slice(0, 2), Addr1: clean(buyer.address?.line1, 100), Addr2: clean(buyer.address?.line2, 100),
        Loc: clean(buyer.address?.city, 50), Pin: Number(buyer.address?.pincode), Stcd: buyer.gstin!.slice(0, 2), Ph: buyer.phone?.replace(/\D/g, '').slice(-10), Em: buyer.email,
      }),
      ShipDtls: ship ? omitEmpty({ LglNm: clean(ship.name || buyer.name, 100), Addr1: clean(ship.line1, 100), Loc: clean(ship.city, 50), Pin: Number(ship.pincode), Stcd: ship.stateCode ?? doc.placeOfSupply }) : undefined,
      ItemList: doc.lines.map((l, i) => {
        const gross = Number(l.unitPricePaise) * qty(l.quantity);
        return {
          SlNo: String(i + 1),
          PrdDesc: clean(l.description, 300),
          IsServc: isService(l.hsnSac) ? 'Y' : 'N',
          HsnCd: l.hsnSac,
          Qty: qty(l.quantity),
          FreeQty: qty(l.freeQuantity),
          Unit: unitCode(l.unit),
          UnitPrice: rupees(l.unitPricePaise),
          TotAmt: rupees(Math.round(gross)),
          Discount: rupees(l.discountPaise),
          AssAmt: rupees(l.taxablePaise),
          GstRt: pct(l.gstRateBp),
          IgstAmt: rupees(l.igstPaise),
          CgstAmt: rupees(l.cgstPaise),
          SgstAmt: rupees(l.sgstPaise),
          CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0, StateCesRt: 0, StateCesAmt: 0, StateCesNonAdvlAmt: 0, OthChrg: 0,
          TotItemVal: rupees(l.totalPaise),
        };
      }),
      ValDtls: {
        AssVal: rupees(doc.taxablePaise), CgstVal: rupees(sumLines('cgstPaise')), SgstVal: rupees(sumLines('sgstPaise')), IgstVal: rupees(sumLines('igstPaise')),
        CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: rupees(doc.roundOffPaise), TotInvVal: rupees(doc.totalPaise),
      },
      RefDtls: source?.number ? { PrecDocDtls: [{ InvNo: source.number, InvDt: ddmmyyyy(source.issueDate) }] } : undefined,
    }));
  }
  if (problems.length) refuse(problems, 'e-invoice');
  await audit({ action: 'billing.einvoice_json.download', entity: 'sales_document', after: { count: out.length, numbers: docs.map((d) => d.number) } });
  return out;
}

// ---------------------------------------------------------------- numbers given back

export const GstRefsInput = z.object({
  ewayBillNo: z.string().trim().regex(/^\d{12}$/, 'An e-way bill number has 12 digits').nullable().optional(),
  ewayBillDate: DateStr.nullable().optional(),
  irn: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, 'An IRN has 64 letters and digits').nullable().optional(),
  irnAckNo: z.string().trim().regex(/^\d{10,20}$/, 'The acknowledgement number is digits only').nullable().optional(),
  irnAckDate: DateStr.nullable().optional(),
  version: z.number().int(),
});

/** Save the e-way bill number or the IRN the portal gave for this document. */
export async function saveGstRefs(ctx: TenantCtx, id: string, input: z.infer<typeof GstRefsInput>) {
  const doc = await db().salesDocument.findFirst({ where: { AND: [{ tenantId: ctx.tenantId, id }, scopeWhere(ctx, SCOPE_FIELDS)] } });
  if (!doc) throw notFound('Document');
  if (['draft', 'cancelled'].includes(doc.status)) throw new AppError('CONFLICT', 'Only issued documents take an e-way bill or IRN.');
  const eway = input.ewayBillNo !== undefined || input.ewayBillDate !== undefined;
  const irn = input.irn !== undefined || input.irnAckNo !== undefined || input.irnAckDate !== undefined;
  if (eway && !['invoice', 'delivery_challan'].includes(doc.kind)) throw new AppError('VALIDATION_FAILED', 'Only invoices and delivery challans have e-way bills.');
  if (irn && !['invoice', 'credit_note', 'debit_note'].includes(doc.kind)) throw new AppError('VALIDATION_FAILED', 'Only invoices, credit notes and debit notes have an IRN.');
  const fields: Record<string, string> = {};
  if (input.ewayBillNo && !input.ewayBillDate) fields.ewayBillDate = 'Enter the e-way bill date';
  if (input.irn && !input.irnAckNo) fields.irnAckNo = 'Enter the acknowledgement number';
  if (input.irn && !input.irnAckDate) fields.irnAckDate = 'Enter the acknowledgement date';
  if (input.ewayBillDate && dateOnly(input.ewayBillDate) < doc.issueDate) fields.ewayBillDate = 'Before the bill date';
  if (input.irnAckDate && dateOnly(input.irnAckDate) < doc.issueDate) fields.irnAckDate = 'Before the bill date';
  if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', Object.values(fields)[0], { fields });
  const day = (v: string | null | undefined) => (v === undefined ? undefined : v ? dateOnly(v) : null);
  const { count } = await db().salesDocument.updateMany({
    where: { id, version: input.version },
    data: {
      ewayBillNo: input.ewayBillNo, ewayBillDate: day(input.ewayBillNo === null ? null : input.ewayBillDate),
      irn: input.irn, irnAckNo: input.irn === null ? null : input.irnAckNo, irnAckDate: day(input.irn === null ? null : input.irnAckDate),
      version: { increment: 1 },
    },
  });
  if (!count) throw new AppError('VERSION_CONFLICT', 'This document was changed by someone else. Reload and try again.');
  await audit({ action: 'billing.gst_refs.save', entity: doc.kind, entityId: id, before: { ewayBillNo: doc.ewayBillNo, irn: doc.irn }, after: { ewayBillNo: input.ewayBillNo, irn: input.irn } });
  return getDocument(ctx, id, doc.kind);
}

// ---------------------------------------------------------------- dues and reminders

export const DuesQuery = z.object({ q: z.string().trim().max(100).optional(), overdue: z.enum(['true', 'false']).optional() });

/** Customers who owe money after advances and credit, with the bills behind it. */
export async function dues(ctx: TenantCtx, query: z.infer<typeof DuesQuery>, today: Date) {
  const open = await db().salesDocument.findMany({
    where: { AND: [{ tenantId: ctx.tenantId, contactId: { not: null }, kind: { in: ['invoice', 'opening_balance', 'debit_note'] }, status: { in: ['issued', 'partially_paid'] } }, scopeWhere(ctx, SCOPE_FIELDS)] },
    select: { id: true, contactId: true, number: true, kind: true, issueDate: true, dueDate: true, totalPaise: true, paidPaise: true, shareToken: true },
    orderBy: { issueDate: 'asc' },
  });
  const ids = [...new Set(open.map((d) => d.contactId!))];
  if (!ids.length) return { data: [], nextCursor: null, total: 0 };
  const [contacts, advances, credits] = await Promise.all([
    db().contact.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, companyName: true, phone: true, email: true, lastRemindedAt: true, lastReminderVia: true } }),
    db().payment.findMany({ where: { contactId: { in: ids }, documentId: null, reversesId: null, reversal: null }, select: { contactId: true, amountPaise: true, adjustments: { select: { amountPaise: true } } } }),
    db().salesDocument.findMany({ where: { contactId: { in: ids }, kind: 'credit_note', status: 'issued' }, select: { contactId: true, totalPaise: true, paidPaise: true } }),
  ]);
  const held = new Map<string, bigint>();
  for (const a of advances) held.set(a.contactId!, (held.get(a.contactId!) ?? 0n) + a.amountPaise - a.adjustments.reduce((s, u) => s + u.amountPaise, 0n));
  for (const c of credits) held.set(c.contactId!, (held.get(c.contactId!) ?? 0n) + c.totalPaise - c.paidPaise);
  const q = query.q?.toLowerCase();
  const rows = contacts
    .map((c) => {
      const bills = open.filter((d) => d.contactId === c.id);
      const billed = bills.reduce((s, d) => s + d.totalPaise - d.paidPaise, 0n);
      const overdue = bills.filter((d) => d.dueDate && d.dueDate < today).reduce((s, d) => s + d.totalPaise - d.paidPaise, 0n);
      const oldest = bills[0];
      return {
        id: c.id, name: c.companyName || c.name, phone: c.phone, email: c.email, lastRemindedAt: c.lastRemindedAt, lastReminderVia: c.lastReminderVia,
        duePaise: billed - (held.get(c.id) ?? 0n), overduePaise: overdue, heldPaise: held.get(c.id) ?? 0n, bills: bills.length,
        oldestDate: oldest.issueDate, oldestDays: Math.max(0, Math.round((today.getTime() - oldest.issueDate.getTime()) / 86_400_000)),
        openBills: bills.slice(0, 10).map((d) => ({ id: d.id, number: d.number, kind: d.kind, duePaise: d.totalPaise - d.paidPaise, shareToken: d.shareToken })),
      };
    })
    .filter((r) => r.duePaise > 0n && (!q || r.name.toLowerCase().includes(q) || (r.phone ?? '').includes(q)) && (query.overdue !== 'true' || r.overduePaise > 0n))
    .sort((a, b) => Number(b.duePaise - a.duePaise));
  return { data: rows, nextCursor: null, total: rows.length };
}

export const RemindedInput = z.object({ via: z.enum(['whatsapp', 'sms', 'email']) });

/** Note that someone sent a reminder by hand, so the next person sees it. */
export async function markReminded(ctx: TenantCtx, contactId: string, via: z.infer<typeof RemindedInput>['via']) {
  const contact = await db().contact.findFirst({ where: { id: contactId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!contact) throw notFound('Customer');
  const at = new Date();
  await db().contact.update({ where: { id: contactId }, data: { lastRemindedAt: at, lastReminderVia: via } });
  await audit({ action: 'billing.dues.remind', entity: 'contact', entityId: contactId, after: { via } });
  return { lastRemindedAt: at, lastReminderVia: via };
}
