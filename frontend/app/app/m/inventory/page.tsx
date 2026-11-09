"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Boxes, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/common"
import { DataList, HeaderLink, type Column, type FilterDef } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import { qty, type StockLocation, type StockRow } from "@/lib/inventory"

// Stock on hand: one row per tracked item, all warehouses or one. Sales and purchases move it by themselves.

function StockList() {
  const { can } = useAuth()
  const params = useSearchParams()
  const locations = useApi<{ data: StockLocation[] }>(can("inventory.stock.view") ? "/stock-locations" : null)
  const showValue = can("inventory.valuation.view") || can("inventory.receipt.create")
  if (!can("inventory.stock.view")) return <PageHeader title="Stock" description="You don't have access to stock. Ask your admin." />

  const columns: Column<StockRow>[] = [
    { key: "name", header: "Item", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span><span className="font-medium">{r.name}{!r.isActive && <Badge variant="outline" className="ml-2">Archived</Badge>}{r.tracking !== "none" && <Badge variant="outline" className="ml-2 capitalize">{r.tracking}</Badge>}</span>{r.sku && <span className="block text-xs text-muted-foreground">{r.sku}</span>}</span> },
    { key: "qty", header: "In stock", align: "right", sort: (r) => r.quantity, csv: (r) => r.quantity, cell: (r) => <span className={r.quantity < 0 ? "font-semibold text-destructive" : "font-medium"}>{qty(r.quantity)} {r.unit}</span> },
    { key: "warehouse", header: "Warehouse", csv: (r) => r.warehouses.map((w) => `${w.name}: ${w.quantity}`).join("; "), cell: (r) => (r.warehouses.length ? <span className="flex flex-wrap gap-1">{r.warehouses.map((w) => <Badge key={w.id} variant="outline">{w.name} · {qty(w.quantity)}</Badge>)}</span> : "—") },
    { key: "available", header: "Available", align: "right", sort: (r) => r.available, csv: (r) => r.available, cell: (r) => <span className={r.low ? "font-semibold text-amber-700 dark:text-amber-300" : ""}>{qty(r.available)}{r.low && <Badge variant="outline" className="ml-2">Low</Badge>}</span> },
    { key: "held", header: "Held for orders", align: "right", defaultHidden: true, csv: (r) => r.reserved, cell: (r) => (r.reserved ? qty(r.reserved) : "—") },
    { key: "expired", header: "Expired", align: "right", defaultHidden: true, csv: (r) => r.expired, cell: (r) => (r.expired ? <span className="text-destructive">{qty(r.expired)}</span> : "—") },
    { key: "transit", header: "On the way", align: "right", defaultHidden: true, csv: (r) => r.inTransit, cell: (r) => (r.inTransit ? qty(r.inTransit) : "—") },
    { key: "low", header: "Low-stock level", align: "right", defaultHidden: true, csv: (r) => r.reorderLevel ?? "", cell: (r) => (r.reorderLevel === null ? "—" : qty(r.reorderLevel)) },
    ...(showValue
      ? [
          { key: "avg", header: "Average cost", align: "right" as const, defaultHidden: true, csv: (r: StockRow) => r.averagePaise / 100, cell: (r: StockRow) => (r.quantity > 0 ? formatPaise(r.averagePaise) : "—") },
          { key: "value", header: "Value", align: "right" as const, sort: (r: StockRow) => r.valuePaise, csv: (r: StockRow) => r.valuePaise / 100, cell: (r: StockRow) => formatPaise(r.valuePaise) },
        ]
      : []),
  ]

  const warehouses = (locations.data?.data ?? []).filter((l) => l.isActive)
  const filters: FilterDef[] = warehouses.length > 1 ? [{ key: "locationId", label: "Warehouse", options: warehouses.map((l) => ({ value: l.id, label: l.name })) }] : []
  const more = [
    ...(can("inventory.stock_adjustment.create") ? [{ label: "Adjust stock", href: "/app/m/inventory/new?kind=adjustment" }] : []),
    ...(can("inventory.receipt.create") ? [{ label: "Add opening stock", href: "/app/m/inventory/new?kind=opening" }, { label: "Import opening stock", href: "/app/m/inventory/import?kind=opening" }] : []),
    ...(can("inventory.stock_count.create") ? [{ label: "Stock count", href: "/app/m/inventory/count" }] : []),
  ]
  const add = can("inventory.receipt.create") ? <HeaderLink href="/app/m/inventory/new?kind=stock_in" primary><Plus /> Add stock</HeaderLink> : undefined

  return (
    <DataList<StockRow>
      id="stock"
      path="/stock"
      header={{ title: "Stock", description: "How much of each item you have. Sales and purchases change it by themselves.", primary: add, more }}
      columns={columns}
      searchPlaceholder="Search item, SKU or scan a barcode"
      presetLabel="Show"
      presets={[{ key: "all", label: "All", params: {} }, { key: "low", label: "Low stock", params: { low: "true" } }]}
      defaultPreset={params.get("low") ? "low" : undefined}
      filters={filters}
      rowHref={(r) => `/app/m/inventory/items/${r.id}`}
      exportName="stock"
      emptyState={<EmptyState icon={Boxes} title="No stock yet" description="Add opening stock for the items you keep. From then on, every bill takes stock out by itself." action={add} />}
    />
  )
}

export default function StockPage() {
  return (
    <React.Suspense>
      <StockList />
    </React.Suspense>
  )
}
