// Inventory types shared by the stock pages.

export interface StockLocation {
  id: string
  name: string
  isDefault: boolean
  isActive: boolean
  valuePaise: number
  itemsInStock: number
}

export interface StockRow {
  id: string
  name: string
  sku: string | null
  unit: string
  isActive: boolean
  quantity: number
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
  location: string
  toLocation: string | null
  entryDate: string
  party: string | null
  reference: string | null
  reason: string | null
  note: string | null
  valuePaise: number
  createdAt: string
  lineCount?: number
  lines: { itemId: string; name: string; quantity?: number; ratePaise?: number | null; system?: number; counted?: number; difference?: number }[]
}

export const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, ""))
