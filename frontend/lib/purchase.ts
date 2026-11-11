// Purchase types shared by the purchase pages.

export type PurchaseKind = "purchase_order" | "goods_receipt" | "purchase_bill" | "purchase_return"

export const KIND_LABEL: Record<PurchaseKind, string> = {
  purchase_order: "Purchase Order",
  goods_receipt: "Goods Receipt",
  purchase_bill: "Purchase Invoice",
  purchase_return: "Purchase Return",
}
export const KIND_PLURAL: Record<PurchaseKind, string> = {
  purchase_order: "Purchase Orders",
  goods_receipt: "Goods Receipts",
  purchase_bill: "Purchase Invoices",
  purchase_return: "Purchase Returns",
}
/** Where each kind's list lives */
export const KIND_PATH: Record<PurchaseKind, string> = {
  purchase_order: "/app/m/purchase/orders",
  goods_receipt: "/app/m/purchase/grn",
  purchase_bill: "/app/m/purchase",
  purchase_return: "/app/m/purchase/returns",
}
export const STATUS_TEXT: Record<string, string> = {
  open: "Open", part_received: "Part received", received: "Received", closed: "Closed", billed: "Billed",
  unpaid: "Unpaid", part_paid: "Part paid", paid: "Paid", issued: "Issued", cancelled: "Cancelled",
}
/** An invoice's life: Draft → Posted → Partial → Paid */
export const INVOICE_STEPS = [["draft", "Draft"], ["unpaid", "Posted"], ["part_paid", "Partial"], ["paid", "Paid"]] as const
export const invoiceStatus = (status: string) => INVOICE_STEPS.find(([k]) => k === status)?.[1] ?? STATUS_TEXT[status] ?? status
/** A return's life: Draft → Approved → Completed */
export const RETURN_STEPS = [["draft", "Draft"], ["approved", "Approved"], ["issued", "Completed"]] as const
export const returnStatus = (status: string) => RETURN_STEPS.find(([k]) => k === status)?.[1] ?? STATUS_TEXT[status] ?? status
export const RETURN_REASONS = ["Defective", "Damaged in transit", "Wrong item", "Excess quantity", "Quality issue", "Other"]

export interface Supplier {
  id: string
  name: string
  companyName: string | null
  phone: string | null
  email: string | null
  gstin: string | null
  stateCode: string | null
  address: Record<string, string> | null
  notes: string | null
  paymentDays: number | null
  isActive: boolean
  balancePaise: number
  version: number
}

export interface PurchaseLine {
  id: string
  itemId: string | null
  description: string
  hsnSac: string | null
  unit: string
  quantity: number
  doneQuantity: number
  unitPricePaise: number
  discountPaise: number
  taxablePaise: number
  gstRateBp: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  totalPaise: number
  landedPaise: number
  batchNo: string | null
  mfgDate: string | null
  expiryDate: string | null
  serials: string[]
  sourceLineId: string | null
}

export interface PurchaseDoc {
  id: string
  kind: PurchaseKind
  status: string
  number: string
  contactId: string
  supplier: { name: string; gstin: string | null; phone: string | null; stateCode: string | null; address?: Record<string, string> | null }
  supplierRef: string | null
  supplierDate: string | null
  issueDate: string
  dueDate: string | null
  reverseCharge: boolean
  locationId: string | null
  location?: { id: string; name: string } | null
  subtotalPaise: number
  discountPaise: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  chargesPaise: number
  chargesGstBp: number
  roundOffPaise: number
  totalPaise: number
  paidPaise: number
  returnedPaise: number
  balancePaise: number
  overdue?: boolean
  sourceType: string | null
  sourceId: string | null
  sourceNumber: string | null
  notes: string | null
  returnReason: string | null
  cancelReason: string | null
  version: number
  createdAt: string
  lines: PurchaseLine[]
  children?: { id: string; kind: PurchaseKind; number: string; status: string; issueDate: string; totalPaise: number }[]
  payments?: { id: string; number: string; amountPaise: number; method: string; reference: string | null; paidOn: string; reversesId: string | null; reversed: boolean }[]
}
