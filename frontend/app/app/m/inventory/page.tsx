"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Boxes, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/common"
import { DataList, HeaderLink, type Column, type FilterDef } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import { qty, type StockLocation, type StockRow } from "@/lib/inventory"
import { todayInIndia } from "@contracts/validation"

// Stock on hand: one row per tracked item, all godowns or one, with what is held for orders,
// expired, on its way, available, its value and the low-stock flag. A past date shows stock as it stood.

function SerialFinder() {
  const [serial, setSerial] = React.useState("")
  const [asked, setAsked] = React.useState("")
  const found = useApi<{ data: { itemId: string; item: string; status: string }[] }>(asked ? `/stock/serials/${encodeURIComponent(asked)}` : null)
  const STATUS: Record<string, string> = { in_stock: "In stock", sold: "Sold", transit: "On the way", gone: "Written off" }
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); setAsked(serial.trim()) }}>
      <Input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Find serial / IMEI" className="h-10 w-44" aria-label="Find serial number" />
      <button type="submit" className="text-muted-foreground hover:text-foreground" aria-label="Find"><Search className="size-4" /></button>
      {asked && found.data && (
        <span className="text-sm">
          {found.data.data.length ? found.data.data.map((r) => <Link key={r.itemId} href={`/app/m/inventory/items/${r.itemId}`} className="hover:underline">{r.item}: {STATUS[r.status] ?? r.status}</Link>) : "Not found"}
        </span>
      )}
    </form>
  )
}

function StockList() {
  const { can } = useAuth()
  const params = useSearchParams()
  const [date, setDate] = React.useState("")
  const locations = useApi<{ data: StockLocation[] }>(can("inventory.stock.view") ? "/stock-locations" : null)
  const showValue = can("inventory.valuation.view") || can("inventory.receipt.create")
  const past = !!date && date < todayInIndia()

  if (!can("inventory.stock.view")) return <PageHeader title="Stock" description="You don't have access to stock. Ask your admin." />

  const columns: Column<StockRow>[] = [
    { key: "name", header: "Item", hideable: false, cell: (r) => <span className="font-semibold">{r.name}{!r.isActive && <Badge variant="outline" className="ml-2">Archived</Badge>}{r.tracking !== "none" && <Badge variant="outline" className="ml-2">{r.tracking === "batch" ? "Batch" : "Serial"}</Badge>}{r.sku && <span className="block text-xs font-normal text-muted-foreground">{r.sku}</span>}</span>, csv: (r) => r.name, sort: (r) => r.name },
    { key: "qty", header: past ? "Stock then" : "In stock", align: "right", cell: (r) => <span className={r.quantity < 0 ? "font-semibold text-destructive tabular-nums" : "font-medium tabular-nums"}>{qty(r.quantity)} {r.unit}{r.altUnit && r.altFactor && r.quantity > 0 ? <span className="block text-xs font-normal text-muted-foreground">{qty(Math.floor(r.quantity / r.altFactor))} {r.altUnit} + {qty(r.quantity % r.altFactor)}</span> : null}</span>, csv: (r) => r.quantity, sort: (r) => r.quantity },
    ...(past
      ? []
      : [
          { key: "held", header: "Held for orders", align: "right" as const, cell: (r: StockRow) => (r.reserved ? <span className="tabular-nums">{qty(r.reserved)}</span> : "—"), csv: (r: StockRow) => r.reserved },
          { key: "expired", header: "Expired", align: "right" as const, defaultHidden: true, cell: (r: StockRow) => (r.expired ? <span className="tabular-nums text-destructive">{qty(r.expired)}</span> : "—"), csv: (r: StockRow) => r.expired },
          { key: "transit", header: "On the way", align: "right" as const, defaultHidden: true, cell: (r: StockRow) => (r.inTransit ? <span className="tabular-nums">{qty(r.inTransit)}</span> : "—"), csv: (r: StockRow) => r.inTransit },
          { key: "available", header: "Available", align: "right" as const, cell: (r: StockRow) => <span className={r.low ? "font-semibold text-amber-700 tabular-nums dark:text-amber-300" : "tabular-nums"}>{qty(r.available)}</span>, csv: (r: StockRow) => r.available, sort: (r: StockRow) => r.available },
          { key: "low", header: "Low-stock level", align: "right" as const, cell: (r: StockRow) => (r.reorderLevel === null ? "—" : <span className="tabular-nums">{qty(r.reorderLevel)}{r.low && <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700 dark:text-amber-300">Low</Badge>}</span>), csv: (r: StockRow) => r.reorderLevel ?? "" },
        ]),
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
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2 text-muted-foreground">As on <Input type="date" value={date} max={todayInIndia()} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" aria-label="Stock as on date" /></label>
        {date && <button className="text-xs text-primary hover:underline" onClick={() => setDate("")}>Today</button>}
        {can("inventory.receipt.create") && <Link href="/app/m/inventory/import?kind=opening" className="text-primary hover:underline">Import opening stock</Link>}
        <SerialFinder />
      </div>
      <DataList<StockRow>
        id="stock"
        path="/stock"
        params={past ? { date } : {}}
        header={{
          breadcrumb: "Inventory › Stock",
          title: past ? `Stock as on ${date.split("-").reverse().join("-")}` : "Stock",
          description: "Sales, challans and returns move stock by themselves. Use these for everything else.",
          actions: (
            <>
              {can("inventory.transfer.create") && godowns.length > 1 && <HeaderLink href="/app/m/inventory/new?kind=transfer">Transfer</HeaderLink>}
              {can("inventory.stock_adjustment.create") && <HeaderLink href="/app/m/inventory/new?kind=adjustment">Adjust</HeaderLink>}
              {can("inventory.receipt.create") && <HeaderLink href="/app/m/inventory/new?kind=opening">Opening stock</HeaderLink>}
            </>
          ),
          primary: can("inventory.receipt.create") ? <HeaderLink href="/app/m/inventory/new?kind=stock_in" primary>Stock in</HeaderLink> : undefined,
        }}
        columns={columns}
        searchPlaceholder="Search item, SKU or scan a barcode"
        presets={[{ key: "all", label: "All", params: {} }, { key: "low", label: "Low stock", params: { low: "true" } }]}
        defaultPreset={params.get("low") ? "low" : undefined}
        filters={filters}
        rowHref={(r) => `/app/m/inventory/items/${r.id}`}
        exportName={past ? `stock-${date}` : "stock"}
        emptyState={
          <EmptyState
            icon={Boxes}
            title="No stock yet"
            description="Add opening stock for the items you keep. From then on, every bill takes stock out by itself."
            action={can("inventory.receipt.create") ? <HeaderLink href="/app/m/inventory/new?kind=opening" primary>Add opening stock</HeaderLink> : undefined}
          />
        }
      />
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
