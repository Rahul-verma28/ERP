// Item types shared by the catalogue pages.

export interface Item {
  id: string
  type: "product" | "service"
  name: string
  sku: string | null
  categoryId: string | null
  unit: string
  pricePaise: number
  costPricePaise?: number | null
  gstRateBp: number
  hsnSac: string | null
  durationMin: number | null
  description: string | null
  imageUrl: string | null
  isActive: boolean
  trackStock?: boolean
  reorderLevel?: number | null
  stockQty?: number
  /** Where the stock is, only warehouses that have some */
  warehouses?: { id: string; name: string; quantity: number }[]
  reservedQty?: number
  tracking?: "none" | "batch" | "serial"
  altUnit?: string | null
  altFactor?: number | null
  barcode?: string | null
  variantGroup?: string | null
  attributes?: Record<string, string>
  custom: Record<string, unknown>
  version: number
}

export interface Category {
  id: string
  name: string
}

const CATEGORY_COLOURS = [
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
]

/** The same category always gets the same colour */
export const categoryColour = (name: string) => CATEGORY_COLOURS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % CATEGORY_COLOURS.length]
