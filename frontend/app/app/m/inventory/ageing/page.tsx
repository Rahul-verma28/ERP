"use client"

import { Hourglass } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/common"
import { DataList, HeaderLink, type Column } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { qty } from "@/lib/inventory"

// How old the stock on hand is, by when each part came in, and when each item last sold.
// Slow: no sale in 90 days. Dead: no sale in 180 days, or never.

type Band = "d0_30" | "d31_60" | "d61_90" | "d91_180" | "d180"
interface Row { id: string; name: string; unit: string; quantity: number; valuePaise: number; bands: Record<Band, number>; lastSale: string | null; daysSinceSale: number | null; status: "moving" | "slow" | "dead" }

const BANDS: [Band, string][] = [["d0_30", "0–30 days"], ["d31_60", "31–60"], ["d61_90", "61–90"], ["d91_180", "91–180"], ["d180", "Over 180"]]
const STATUS: Record<Row["status"], [string, string]> = { moving: ["Moving", ""], slow: ["Slow", "border-amber-300 text-amber-700 dark:text-amber-300"], dead: ["Dead", "border-red-300 text-red-700 dark:text-red-300"] }

export default function AgeingPage() {
  const { can } = useAuth()
  if (!can("inventory.stock.view")) return <PageHeader title="Stock ageing" description="You don't have access to stock. Ask your admin." />
  const showValue = can("inventory.valuation.view") || can("inventory.receipt.create")
  const columns: Column<Row>[] = [
    { key: "name", header: "Item", hideable: false, cell: (r) => <span className="font-semibold">{r.name}</span>, csv: (r) => r.name, sort: (r) => r.name },
    { key: "qty", header: "In stock", align: "right", cell: (r) => <span className="tabular-nums">{qty(r.quantity)} {r.unit}</span>, csv: (r) => r.quantity, sort: (r) => r.quantity },
    ...BANDS.map(([k, label]) => ({ key: k, header: label, align: "right" as const, cell: (r: Row) => (r.bands[k] ? <span className="tabular-nums">{qty(r.bands[k])}</span> : "—"), csv: (r: Row) => r.bands[k] })),
    ...(showValue ? [{ key: "value", header: "Value", align: "right" as const, cell: (r: Row) => <span className="tabular-nums">{formatPaise(r.valuePaise)}</span>, csv: (r: Row) => r.valuePaise / 100, sort: (r: Row) => r.valuePaise }] : []),
    { key: "sale", header: "Last sale", cell: (r) => (r.lastSale ? <span>{formatDate(r.lastSale)}<span className="block text-xs text-muted-foreground">{r.daysSinceSale === 0 ? "today" : `${r.daysSinceSale} day${r.daysSinceSale === 1 ? "" : "s"} ago`}</span></span> : "Never"), csv: (r) => r.lastSale?.slice(0, 10) ?? "", sort: (r) => r.daysSinceSale ?? 99999 },
    { key: "status", header: "Status", cell: (r) => <Badge variant="outline" className={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>, csv: (r) => STATUS[r.status][0] },
  ]
  return (
    <DataList<Row>
      id="stock-ageing"
      path="/stock/ageing"
      header={{ breadcrumb: "Inventory › Ageing", title: "Stock ageing and dead stock", description: "Age comes from when each part of the stock came in. Slow: no sale in 90 days. Dead: none in 180 days.", actions: <HeaderLink href="/app/m/inventory">Stock</HeaderLink> }}
      columns={columns}
      exportName="stock-ageing"
      emptyState={<EmptyState icon={Hourglass} title="No stock to age" description="Items with stock show here with their age." />}
    />
  )
}
