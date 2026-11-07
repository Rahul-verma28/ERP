"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Boxes } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/common"
import { DataList, HeaderLink, type Column, type FilterDef } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import { qty, type StockLocation, type StockRow } from "@/lib/inventory"

// Stock on hand: one row per tracked item, all godowns or one, with value and low-stock flag.

function StockList() {
  const { can } = useAuth()
  const params = useSearchParams()
  const locations = useApi<{ data: StockLocation[] }>(can("inventory.stock.view") ? "/stock-locations" : null)
  const showValue = can("inventory.valuation.view") || can("inventory.receipt.create")

  if (!can("inventory.stock.view")) return <PageHeader title="Stock" description="You don't have access to stock. Ask your admin." />

  const columns: Column<StockRow>[] = [
    { key: "name", header: "Item", hideable: false, cell: (r) => <span className="font-semibold">{r.name}{!r.isActive && <Badge variant="outline" className="ml-2">Archived</Badge>}{r.sku && <span className="block text-xs font-normal text-muted-foreground">{r.sku}</span>}</span>, csv: (r) => r.name, sort: (r) => r.name },
    { key: "qty", header: "In stock", align: "right", cell: (r) => <span className={r.quantity < 0 ? "font-semibold text-destructive tabular-nums" : r.low ? "font-semibold text-amber-700 tabular-nums dark:text-amber-300" : "font-medium tabular-nums"}>{qty(r.quantity)} {r.unit}</span>, csv: (r) => r.quantity, sort: (r) => r.quantity },
    { key: "low", header: "Low-stock level", align: "right", cell: (r) => (r.reorderLevel === null ? "—" : <span className="tabular-nums">{qty(r.reorderLevel)}{r.low && <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700 dark:text-amber-300">Low</Badge>}</span>), csv: (r) => r.reorderLevel ?? "" },
    ...(showValue
      ? [
          { key: "avg", header: "Average cost", align: "right" as const, cell: (r: StockRow) => <span className="tabular-nums text-muted-foreground">{r.quantity > 0 ? formatPaise(r.averagePaise) : "—"}</span>, csv: (r: StockRow) => r.averagePaise / 100 },
          { key: "value", header: "Value", align: "right" as const, cell: (r: StockRow) => <span className="tabular-nums">{formatPaise(r.valuePaise)}</span>, csv: (r: StockRow) => r.valuePaise / 100, sort: (r: StockRow) => r.valuePaise },
        ]
      : []),
  ]

  const godowns = (locations.data?.data ?? []).filter((l) => l.isActive)
  const filters: FilterDef[] = godowns.length > 1 ? [{ key: "locationId", label: "Godown", options: godowns.map((l) => ({ value: l.id, label: l.name })) }] : []

  return (
    <DataList<StockRow>
      id="stock"
      path="/stock"
      header={{
        breadcrumb: "Inventory › Stock",
        title: "Stock",
        description: "Sales, challans and returns move stock by themselves. Use these for everything else.",
        actions: (
          <>
            <HeaderLink href="/app/m/inventory/entries">Entries</HeaderLink>
            {can("inventory.warehouse.view") && <HeaderLink href="/app/m/inventory/godowns">Godowns</HeaderLink>}
            {can("inventory.stock_count.create") && <HeaderLink href="/app/m/inventory/count">Count</HeaderLink>}
            {can("inventory.transfer.create") && godowns.length > 1 && <HeaderLink href="/app/m/inventory/new?kind=transfer">Transfer</HeaderLink>}
            {can("inventory.stock_adjustment.create") && <HeaderLink href="/app/m/inventory/new?kind=adjustment">Adjust</HeaderLink>}
            {can("inventory.receipt.create") && <HeaderLink href="/app/m/inventory/new?kind=opening">Opening stock</HeaderLink>}
          </>
        ),
        primary: can("inventory.receipt.create") ? <HeaderLink href="/app/m/inventory/new?kind=stock_in" primary>Stock in</HeaderLink> : undefined,
      }}
      columns={columns}
      searchPlaceholder="Search item or SKU"
      presets={[{ key: "all", label: "All", params: {} }, { key: "low", label: "Low stock", params: { low: "true" } }]}
      defaultPreset={params.get("low") ? "low" : undefined}
      filters={filters}
      rowHref={(r) => `/app/m/inventory/items/${r.id}`}
      exportName="stock"
      emptyState={
        <EmptyState
          icon={Boxes}
          title="No stock yet"
          description="Add opening stock for the items you keep. From then on, every bill takes stock out by itself."
          action={can("inventory.receipt.create") ? <HeaderLink href="/app/m/inventory/new?kind=opening" primary>Add opening stock</HeaderLink> : undefined}
        />
      }
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
