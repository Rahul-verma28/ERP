"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { ArrowLeftRight, Boxes, History, Plus, SlidersHorizontal } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { StockDialog } from "@/components/stock-dialogs"
import { EmptyState } from "@/components/common"
import { DataList, type Column, type FilterDef } from "@/components/data-list"
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
  const [open, setOpen] = React.useState<{ kind: "add" | "adjust" | "move"; row: StockRow | null } | null>(null)
  const [version, setVersion] = React.useState(0)
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
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {can("inventory.receipt.create") && <Button variant="ghost" size="icon-sm" title="Add stock" aria-label={`Add stock to ${r.name}`} onClick={() => setOpen({ kind: "add", row: r })}><Plus /></Button>}
          {can("inventory.stock_adjustment.create") && <Button variant="ghost" size="icon-sm" title="Adjust stock" aria-label={`Adjust stock of ${r.name}`} onClick={() => setOpen({ kind: "adjust", row: r })}><SlidersHorizontal /></Button>}
          {can("inventory.transfer.create") && <Button variant="ghost" size="icon-sm" title="Move to another warehouse" aria-label={`Move ${r.name}`} onClick={() => setOpen({ kind: "move", row: r })}><ArrowLeftRight /></Button>}
          <Link href={`/app/m/inventory/items/${r.id}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} title="History" aria-label={`History of ${r.name}`}><History /></Link>
        </span>
      ),
    },
  ]

  const warehouses = (locations.data?.data ?? []).filter((l) => l.isActive)
  const filters: FilterDef[] = warehouses.length > 1 ? [{ key: "locationId", label: "Warehouse", options: warehouses.map((l) => ({ value: l.id, label: l.name })) }] : []
  const more = can("inventory.receipt.create") ? [{ label: "Import stock from a file", href: "/app/m/inventory/import?kind=opening" }] : []
  const add = can("inventory.receipt.create") ? <Button onClick={() => setOpen({ kind: "add", row: null })}><Plus /> Add stock</Button> : undefined

  const target = open?.row ? { id: open.row.id, name: open.row.name, unit: open.row.unit, sku: open.row.sku, tracking: open.row.tracking, costPaise: open.row.averagePaise || null, warehouses: open.row.warehouses } : null
  return (
    <>
    <DataList<StockRow>
      id="stock"
      path="/stock"
      params={{ v: String(version) }}
      header={{ title: "Stock", description: "How much of each item you have. Sales and purchases change it by themselves.", primary: add, more }}
      columns={columns}
      searchPlaceholder="Search item, SKU or scan a barcode"
      presetLabel="Show"
      presets={[{ key: "all", label: "All", params: {} }, { key: "low", label: "Low stock", params: { low: "true" } }]}
      defaultPreset={params.get("low") ? "low" : undefined}
      filters={filters}
      rowHref={(r) => `/app/m/inventory/items/${r.id}`}
      exportName="stock"
      emptyState={<EmptyState icon={Boxes} title="No stock yet" description="Add the stock you have today. From then on, every invoice and bill moves it by itself." action={add} />}
    />
    {open && <StockDialog kind={open.kind} item={target} onClose={() => setOpen(null)} onDone={() => { setOpen(null); setVersion((v) => v + 1) }} />}
    </>
  )
}

export default function StockPage() {
  return (
    <React.Suspense>
      <StockList />
    </React.Suspense>
  )
}
