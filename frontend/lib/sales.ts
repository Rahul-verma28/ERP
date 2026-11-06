// Types and client-side GST preview for quotations and invoices.
// The server recomputes every total; this only mirrors it for the live preview.

export interface DocLine {
  id?: string
  itemId: string | null
  description: string
  hsnSac: string | null
  unit: string
  quantity: number | string
  unitPricePaise: number
  discountPaise: number
  taxablePaise?: number
  gstRateBp: number
  cgstPaise?: number
  sgstPaise?: number
  igstPaise?: number
  totalPaise?: number
  /** Invoice made from an order: the order line it bills */
  sourceLineId?: string | null
  /** Given free on top of quantity: no price and no tax */
  freeQuantity?: number | string
}

export type DocKind = "invoice" | "quotation" | "sales_order" | "delivery_challan"

export interface ShipTo {
  name?: string | null
  line1?: string | null
  city?: string | null
  pincode?: string | null
  stateCode?: string | null
}

export interface Buyer {
  name: string
  gstin?: string | null
  phone?: string | null
  email?: string | null
  stateCode?: string | null
  address?: Record<string, string> | null
}

export interface Seller {
  name: string
  legalName?: string | null
  gstin?: string | null
  stateCode?: string | null
  address?: Record<string, string> | null
  logoUrl?: string | null
  phone?: string | null
  email?: string | null
  /** Frozen at issue from Settings › Payments */
  bank?: { holder: string; account: string; ifsc: string } | null
  upiId?: string | null
  showUpiQr?: boolean
  /** Frozen at issue from Settings › Documents › Print */
  showHsnSummary?: boolean
  showSignatory?: boolean
  paper?: "a4" | "80mm" | "58mm"
  /** Frozen at issue: not registered, or on the composition scheme */
  billOfSupply?: boolean
  composition?: boolean
}

export interface SalesDoc {
  id: string
  kind: DocKind | "credit_note" | "debit_note"
  status: string
  number: string | null
  contactId: string | null
  buyer: Buyer
  seller: Seller | null
  placeOfSupply: string | null
  issueDate: string
  dueDate: string | null
  subtotalPaise: number
  discountPaise: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  roundOffPaise?: number
  totalPaise: number
  paidPaise: number
  creditedPaise?: number
  noteType?: string | null
  sourceNumber?: string | null
  shipTo?: ShipTo | null
  notes: string | null
  terms: string | null
  shareToken: string | null
  sourceType: string | null
  sourceId: string | null
  cancelReason: string | null
  lines: DocLine[]
  payments?: { id: string; number: string; amountPaise: number; method: string; reference: string | null; paidOn: string; reversesId: string | null }[]
  adjustments?: { id: string; amountPaise: number; reversesId: string | null; createdAt: string; payment: { number: string } | null; creditNote: { number: string; sourceId: string | null } | null }[]
  version: number
}

const divRound = (n: number, d: number) => Math.floor((n * 2 + d) / (2 * d))

export function previewTotals(lines: DocLine[], intraState: boolean) {
  let taxable = 0
  let cgst = 0
  let igst = 0
  let discount = 0
  for (const l of lines) {
    const qtyMilli = Math.round(Number(l.quantity || 0) * 1000)
    const gross = divRound(l.unitPricePaise * qtyMilli, 1000)
    const t = Math.max(0, gross - (l.discountPaise || 0))
    discount += l.discountPaise || 0
    taxable += t
    if (intraState) cgst += divRound(t * l.gstRateBp, 20000)
    else igst += divRound(t * l.gstRateBp, 10000)
  }
  return { subtotal: taxable + discount, discount, taxable, cgst, sgst: cgst, igst, total: taxable + cgst * 2 + igst }
}

/** Rates typed with GST inside: the same sum the server does to take the tax out. */
export const withoutGst = (lines: DocLine[]) =>
  lines.map((l) => {
    const out = (paise: number) => divRound(paise * 10_000, 10_000 + l.gstRateBp)
    return { ...l, unitPricePaise: out(l.unitPricePaise), discountPaise: out(l.discountPaise || 0) }
  })

/** What rounding the total to the whole rupee adds (negative when it takes away). */
export const roundOffOf = (total: number) => divRound(total, 100) * 100 - total

export const docPath = (kind: DocKind) => ({ invoice: "billing", quotation: "sales", sales_order: "sales/orders", delivery_challan: "sales/challans" })[kind]
export const docApi = (kind: DocKind) => ({ invoice: "/invoices", quotation: "/quotations", sales_order: "/sales-orders", delivery_challan: "/delivery-challans" })[kind]
export const docLabel = (kind: DocKind) => ({ invoice: "Invoice", quotation: "Quotation", sales_order: "Sales order", delivery_challan: "Delivery challan" })[kind]
