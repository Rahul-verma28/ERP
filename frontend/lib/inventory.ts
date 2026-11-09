// Inventory types shared by the stock pages.

export interface StockLocation {
  id: string
  name: string
  isDefault: boolean
  isActive: boolean
  address: string | null
  city: string | null
  zipCode: string | null
  phone: string | null
  email: string | null
  valuePaise: number
  itemsInStock: number
}

export type Tracking = "none" | "batch" | "serial"

export interface StockRow {
  id: string
  name: string
  sku: string | null
  unit: string
  isActive: boolean
  tracking: Tracking
  altUnit: string | null
  altFactor: number | null
  quantity: number
  warehouses: { id: string; name: string; quantity: number }[]
  /** Held for open sales orders */
  reserved: number
  /** In batches past their expiry */
  expired: number
  /** In stock, less held and expired */
  available: number
  /** Sent from a warehouse and not yet received */
  inTransit: number
  valuePaise: number
  averagePaise: number
  reorderLevel: number | null
  low: boolean
}

export type EntryKind = "opening" | "stock_in" | "adjustment" | "transfer" | "count"

export const ENTRY_LABEL: Record<EntryKind, string> = {
  opening: "Opening stock",
  stock_in: "Stock in",
  adjustment: "Adjustment",
  transfer: "Transfer",
  count: "Stock count",
}

export const REASONS = [
  { value: "damage", label: "Damaged", direction: "out" },
  { value: "loss", label: "Lost or stolen", direction: "out" },
  { value: "expired", label: "Expired", direction: "out" },
  { value: "sample", label: "Given as sample", direction: "out" },
  { value: "found", label: "Found extra", direction: "in" },
  { value: "other", label: "Other", direction: null },
] as const

export interface StockEntry {
  id: string
  kind: EntryKind
  status: "posted" | "in_transit" | "received"
  location: string
  toLocation: string | null
  entryDate: string
  party: string | null
  reference: string | null
  reason: string | null
  note: string | null
  valuePaise: number
  createdAt: string
  receivedAt: string | null
  lineCount?: number
  lines: {
    itemId: string
    name: string
    quantity?: number
    unit?: string
    baseQuantity?: number
    ratePaise?: number | null
    serials?: string[]
    batches?: { id?: string; number: string; expiry?: string | null; quantity: number }[]
    batch?: string | null
    system?: number
    counted?: number
    difference?: number
  }[]
}

export interface BatchRow { id: string; number: string; mfgDate: string | null; expiryDate: string | null; quantity: number; expired: boolean }

export const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, ""))
