"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { AlarmClock, ArrowLeftRight, Boxes, CircleSlash, Eye, History, IndianRupee, Package, Plus, SlidersHorizontal, Truck } from "lucide-react"
import { ActionMenu } from "@/components/page-parts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StockDialog } from "@/components/stock-dialogs"
import { EmptyState } from "@/components/common"
import { DataList, type Column, type FilterDef } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { SummaryCards } from "@/components/summary-cards"
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
    {
      key: "name", header: "Item", hideable: false, sort: (r) => r.name, csv: (r) => r.name,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {r.imageUrl ? <img src={r.imageUrl} alt="" className="size-9 shrink-0 rounded-lg border object-cover" /> : <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Package className="size-4" aria-hidden /></span>}
          <span className="min-w-0">
            <span className="block font-medium">{r.name}{!r.isActive && <Badge variant="outline" className="ml-2">Archived</Badge>}{r.tracking !== "none" && <Badge variant="outline" className="ml-2 capitalize">{r.tracking}</Badge>}</span>
            <span className="block text-xs text-muted-foreground">{[r.sku, r.hsnSac && `HSN ${r.hsnSac}`].filter(Boolean).join(" · ") || "—"}</span>
          </span>
        </span>
      ),
    },
    { key: "category", header: "Category", csv: (r) => r.category ?? "", cell: (r) => (r.category ? <Badge variant="outline" className="whitespace-nowrap">{r.category}</Badge> : <span className="text-muted-foreground">—</span>) },
    { key: "qty", header: "In stock", align: "right", sort: (r) => r.quantity, csv: (r) => r.quantity, cell: (r) => <span className={r.quantity < 0 ? "font-semibold text-destructive" : "font-medium"}>{qty(r.quantity)} {r.unit}</span> },
    { key: "warehouse", header: "Warehouse", csv: (r) => r.warehouses.map((w) => `${w.name}: ${w.quantity}`).join("; "), cell: (r) => (r.warehouses.length ? <span className="flex flex-wrap gap-1">{r.warehouses.map((w) => <Badge key={w.id} variant="outline">{w.name} · {qty(w.quantity)}</Badge>)}</span> : "—") },
    { key: "price", header: "Sale price", align: "right", sort: (r) => r.pricePaise ?? 0, csv: (r) => (r.pricePaise ?? 0) / 100, cell: (r) => <span className="tabular-nums text-emerald-700 dark:text-emerald-300">{r.pricePaise ? formatPaise(r.pricePaise) : "—"}</span> },
    { key: "available", header: "Available", align: "right", sort: (r) => r.available, csv: (r) => r.available, cell: (r) => <span className={r.low ? "font-semibold text-amber-700 dark:text-amber-300" : ""}>{qty(r.available)}{r.low && <Badge variant="outline" className="ml-2">Low</Badge>}</span> },
    { key: "held", header: "Held for orders", align: "right", defaultHidden: true, csv: (r) => r.reserved, cell: (r) => (r.reserved ? qty(r.reserved) : "—") },
    { key: "expired", header: "Expired", align: "right", defaultHidden: true, csv: (r) => r.expired, cell: (r) => (r.expired ? <span className="text-destructive">{qty(r.expired)}</span> : "—") },
    { key: "transit", header: "On the way", align: "right", defaultHidden: true, csv: (r) => r.inTransit, cell: (r) => (r.inTransit ? qty(r.inTransit) : "—") },
    { key: "lastIn", header: "Last received", defaultHidden: true, sort: (r) => r.lastInOn ?? "", csv: (r) => r.lastInOn?.slice(0, 10) ?? "", cell: (r) => (r.lastInOn ? formatDate(r.lastInOn) : "—") },
    { key: "lastOut", header: "Last sold or used", defaultHidden: true, sort: (r) => r.lastOutOn ?? "", csv: (r) => r.lastOutOn?.slice(0, 10) ?? "", cell: (r) => (r.lastOutOn ? formatDate(r.lastOutOn) : "—") },
    { key: "low", header: "Low-stock level", align: "right", defaultHidden: true, csv: (r) => r.reorderLevel ?? "", cell: (r) => (r.reorderLevel === null ? "—" : qty(r.reorderLevel)) },
    ...(showValue
      ? [
          { key: "avg", header: "Average cost", align: "right" as const, csv: (r: StockRow) => r.averagePaise / 100, cell: (r: StockRow) => (r.quantity > 0 ? formatPaise(r.averagePaise) : "—") },
          { key: "value", header: "Value", align: "right" as const, sort: (r: StockRow) => r.valuePaise, csv: (r: StockRow) => r.valuePaise / 100, cell: (r: StockRow) => formatPaise(r.valuePaise) },
        ]
      : []),
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {can("inventory.receipt.create") && <Button variant="ghost" size="icon-sm" title="Add stock" aria-label={`Add stock to ${r.name}`} onClick={() => setOpen({ kind: "add", row: r })}><Plus /></Button>}
          <ActionMenu label={`More actions for ${r.name}`} items={[
            { label: "Open item", icon: Eye, href: `/app/m/catalog/${r.id}` },
            { label: "Stock history", icon: History, href: `/app/m/catalog/${r.id}?tab=stock` },
            "-",
            can("inventory.stock_adjustment.create") && { label: "Adjust stock", icon: SlidersHorizontal, onClick: () => setOpen({ kind: "adjust", row: r }) },
            can("inventory.transfer.create") && { label: "Move to another warehouse", icon: ArrowLeftRight, onClick: () => setOpen({ kind: "move", row: r }) },
          ]} />
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
      header={{ title: "Stock", description: "How much of each item you have, in each warehouse. Sales and purchases change it by themselves.", primary: add, more: [...more, { label: "Warehouses", href: "/app/m/inventory/warehouses" }, { label: "Stock entries", href: "/app/m/inventory/entries" }, { label: "Transfers", href: "/app/m/inventory/transfers" }] }}
      columns={columns}
      searchPlaceholder="Search item, SKU or scan a barcode"
      presetLabel="Show"
      presets={[{ key: "all", label: "All items", params: {}, countKey: "all" }, { key: "in", label: "In stock", params: { show: "in" }, countKey: "in" }, { key: "low", label: "Low stock", params: { show: "low" }, countKey: "low" }, { key: "out", label: "Out of stock", params: { show: "out" }, countKey: "out" }]}
      tabs
      top={(res) => {
        const c = (res.counts ?? {}) as Record<string, number>
        const t = (res.totals ?? {}) as Record<string, number>
        return <SummaryCards items={[
          { label: "Items tracked", value: c.all ?? 0, hint: `${c.in ?? 0} in stock`, color: "blue", icon: Boxes },
          ...(showValue ? [{ label: "Stock value", value: formatPaise(t.valuePaise ?? 0), hint: `At cost · ${formatPaise(t.salesValuePaise ?? 0)} at sale price`, color: "emerald", icon: IndianRupee }] : []),
          { label: "Low stock", value: c.low ?? 0, hint: "At or under the low-stock level", color: "amber", icon: AlarmClock, href: "/app/m/inventory?low=1" },
          { label: "Out of stock", value: c.out ?? 0, hint: "None left", color: "rose", icon: CircleSlash },
          { label: "On the way", value: t.inTransit ?? 0, hint: `Items in transfers · ${t.reserved ?? 0} held for orders`, color: "violet", icon: Truck },
        ]} />
      }}
      defaultPreset={params.get("low") ? "low" : undefined}
      filters={filters}
      rowHref={(r) => `/app/m/catalog/${r.id}?tab=stock`}
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
