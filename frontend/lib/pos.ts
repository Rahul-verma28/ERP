// POS (counter billing): what the server sends for the counter, shifts and lists, and the cart
// maths the counter shows while billing. The server works out every total again on the sale.

import { previewTotals, roundOffOf, withoutGst, type DocLine } from "@/lib/sales"

export type Paper = "80mm" | "58mm" | "a4"
export type Tender = "cash" | "upi" | "card" | "other"

export interface Counter {
  id: string
  name: string
  branchId: string | null
  locationId: string | null
  cashAccountId: string | null
  bankAccountId: string | null
  paper: Paper
  receiptNote: string | null
  maxDiscountPct: number | null
  allowCredit: boolean
  needCustomer: boolean
  isActive: boolean
  version: number
}

export interface ShiftSummary {
  id: string
  number: string
  status: "open" | "closed"
  counter: { id: string; name: string; paper: Paper; receiptNote: string | null; maxDiscountPct: number | null; allowCredit: boolean; needCustomer: boolean; branchId: string | null }
  openedBy: string
  openedByName: string
  openedAt: string
  closedByName: string | null
  closedAt: string | null
  openingCashPaise: number
  totals: { bills: number; cancelled: number; salesPaise: number; duePaise: number; returnsPaise: number; returns: number; averagePaise: number }
  methods: Record<string, { inPaise: number; outPaise: number; count: number }>
  cash: { openingPaise: number; salesPaise: number; refundsPaise: number; inPaise: number; outPaise: number; expectedPaise: number }
  counted: { countedPaise: number; differencePaise: number; denominations: Record<string, number> | null; note: string | null; depositPaise: number; depositTransferId: string | null } | null
  sales: { id: string; number: string; status: string; totalPaise: number; duePaise: number; at: string | null; customer: string; contactId: string | null; lines: number }[]
  returns: { id: string; number: string; totalPaise: number; against: string | null; customer: string }[]
  moves: { id: string; kind: "in" | "out"; amountPaise: number; reason: string; note: string | null; expenseId: string | null; at: string; by: string | null }[]
  topItems: { name: string; qty: number; totalPaise: number }[]
  version: number
}

export interface Register {
  shift: ShiftSummary | null
  counters: (Counter & { busyBy: string | null; floatPaise: number })[]
  rules: { business: string; noTax: boolean; pricesIncludeTax: boolean; upiId: string | null; expenseCategories: string[] }
  can: { sell: boolean; approve: boolean; setup: boolean; refund: boolean }
  financeOn: boolean
}

export interface PosItem {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  unit: string
  type: string
  pricePaise: number
  gstRateBp: number
  hsnSac: string | null
  imageUrl: string | null
  trackStock: boolean
  tracking: string
  category: string | null
  stock: number
}

export interface CartLine {
  key: string
  itemId: string
  name: string
  unit: string
  gstRateBp: number
  hsnSac: string | null
  /** The item's own price; anything lower counts as discount */
  listPricePaise: number
  unitPricePaise: number
  quantity: number
  discountPaise: number
  tracking: string
  trackStock: boolean
  stock: number
  serials: string[]
}

export interface CartCustomer { id: string | null; name: string; phone: string | null; gstin?: string | null }

export interface Cart {
  lines: CartLine[]
  customer: CartCustomer | null
  billDiscountPaise: number
  notes: string
}

export const emptyCart = (): Cart => ({ lines: [], customer: null, billDiscountPaise: 0, notes: "" })

export const TENDER_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", other: "Other", bank: "Bank", cheque: "Cheque", mixed: "Mixed", credit: "On account", none: "—" }
export const MOVE_REASON: Record<string, string> = { float: "Change float added", change: "Change swap", expense: "Shop expense", owner: "Taken by owner", other: "Other" }
export const NOTES = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const

/** The bill as the server will make it: prices with or without GST, the bill discount spread, rounded off */
export function cartTotals(cart: Cart, opts: { pricesIncludeTax: boolean; noTax: boolean }) {
  const net = cart.lines.map((l) => Math.round(l.quantity * l.unitPricePaise) - l.discountPaise)
  const sumNet = net.reduce((a, b) => a + b, 0)
  let left = Math.min(cart.billDiscountPaise, sumNet)
  const lines: DocLine[] = cart.lines.map((l, i) => {
    const share = i === cart.lines.length - 1 ? left : Math.min(left, sumNet ? Math.floor((cart.billDiscountPaise * net[i]) / sumNet) : 0)
    const extra = Math.min(share, net[i])
    left -= extra
    return { itemId: l.itemId, description: l.name, hsnSac: l.hsnSac, unit: l.unit, quantity: l.quantity, unitPricePaise: l.unitPricePaise, discountPaise: l.discountPaise + extra, gstRateBp: opts.noTax ? 0 : l.gstRateBp }
  })
  const priced = opts.pricesIncludeTax && !opts.noTax ? withoutGst(lines) : lines
  const t = previewTotals(priced, true)
  const roundOff = roundOffOf(t.total)
  const gross = cart.lines.reduce((a, l) => a + Math.round(l.quantity * l.listPricePaise), 0)
  const items = cart.lines.reduce((a, l) => a + l.quantity, 0)
  return { ...t, tax: t.cgst + t.sgst + t.igst, roundOff, payable: t.total + roundOff, gross, given: gross - (sumNet - Math.min(cart.billDiscountPaise, sumNet)), items, sumNet }
}

/** Quick cash buttons: the exact amount and the next round notes above it */
export function cashSuggestions(due: number) {
  if (due <= 0) return []
  const r = Math.ceil(due / 100) * 100
  const ups = [1000, 5000, 10000, 50000, 100000, 200000].map((step) => Math.ceil(r / step) * step)
  return [...new Set([r, ...ups])].filter((v) => v >= due).slice(0, 5)
}
