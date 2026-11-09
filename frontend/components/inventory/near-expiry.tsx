"use client"

import Link from "next/link"
import { CalendarClock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/common"
import { DataList, type Column } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { qty } from "@/lib/inventory"

// Batches with stock that have expired or expire soon (Settings: near-expiry days), earliest first.

interface Row { id: string; batchId: string; batch: string; expiryDate: string; itemId: string; item: string; unit: string; location: string; quantity: number; daysLeft: number }

export function NearExpiryReport() {
  const { can } = useAuth()
  if (!can("inventory.stock.view")) return <PageHeader title="Near expiry" description="You don't have access to stock. Ask your admin." />
  const columns: Column<Row>[] = [
    { key: "item", header: "Item", hideable: false, cell: (r) => <Link href={`/app/m/inventory/items/${r.itemId}`} className="font-semibold hover:underline">{r.item}</Link>, csv: (r) => r.item, sort: (r) => r.item },
    { key: "batch", header: "Batch", cell: (r) => <span className="font-mono text-xs">{r.batch}</span>, csv: (r) => r.batch },
    { key: "expiry", header: "Expiry", cell: (r) => <span>{formatDate(r.expiryDate)}{r.daysLeft < 0 ? <Badge variant="outline" className="ml-2 border-red-300 text-red-700 dark:text-red-300">Expired</Badge> : <span className="block text-xs text-muted-foreground">{r.daysLeft} day{r.daysLeft === 1 ? "" : "s"} left</span>}</span>, csv: (r) => r.expiryDate.slice(0, 10), sort: (r) => r.daysLeft },
    { key: "location", header: "Warehouse", cell: (r) => r.location, csv: (r) => r.location },
    { key: "qty", header: "Quantity", align: "right", cell: (r) => <span className="tabular-nums">{qty(r.quantity)} {r.unit}</span>, csv: (r) => r.quantity, sort: (r) => r.quantity },
  ]
  return (
    <DataList<Row>
      id="near-expiry"
      path="/stock/near-expiry"
      header={{
        title: "Near expiry",
        description: "Sell these first, return them to the supplier, or write expired stock off with an adjustment (reason: Expired).",
      }}
      columns={columns}
      presets={[{ key: "window", label: "Within the window", params: {} }, { key: "90", label: "Next 90 days", params: { days: "90" } }, { key: "180", label: "Next 180 days", params: { days: "180" } }]}
      exportName="near-expiry"
      emptyState={<EmptyState icon={CalendarClock} title="Nothing expiring soon" description="Batches with stock that expire within the window show here." />}
    />
  )
}
