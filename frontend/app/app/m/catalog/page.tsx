"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { AlarmClock, Archive, ArchiveRestore, ArrowLeftRight, Barcode, CircleSlash, Copy, Eye, History, IndianRupee, Package, Pencil, Plus, ShoppingCart, SlidersHorizontal, Tag, Trash2, TrendingUp } from "lucide-react"
import { SummaryCards } from "@/components/summary-cards"
import { ActionMenu } from "@/components/page-parts"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { StockDialog } from "@/components/stock-dialogs"
import { DataList, HeaderLink, type Column, type ViewPreset } from "@/components/data-list"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { categoryColour, type Category, type Item } from "@/lib/catalog"
import { formatDate, formatPaise } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"

const PRESETS: ViewPreset[] = [
  { key: "all", label: "All", params: {}, countKey: "all" },
  { key: "product", label: "Products", params: { type: "product" }, countKey: "product" },
  { key: "service", label: "Services", params: { type: "service" }, countKey: "service" },
  { key: "low", label: "Low stock", params: { low: "true" }, countKey: "low" },
  { key: "out", label: "Out of stock", params: { stock: "out" }, countKey: "out" },
  { key: "archived", label: "Archived", params: { active: "false" }, countKey: "archived" },
]
const ago = (iso: string | null | undefined) => {
  if (!iso) return null
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`
}

const iconLink = buttonVariants({ variant: "ghost", size: "icon-sm" })

export default function ItemsPage() {
  const { can, term, me } = useAuth()
  const categories = useApi<{ data: Category[] }>("/item-categories")
  const [stock, setStock] = React.useState<{ kind: "add" | "adjust" | "move"; item: Item } | null>(null)
  const [deleting, setDeleting] = React.useState<Item | null>(null)
  const [version, setVersion] = React.useState(0)
  const refresh = () => setVersion((v) => v + 1)
  const title = term("entity.item.plural", "Items")
  const showCost = !!me?.fieldAccess?.["item.cost_price"] && me.fieldAccess["item.cost_price"] !== "hidden"
  const showStock = can("inventory.stock.view")
  const canAddStock = can("inventory.receipt.create")
  const places = useApi<{ data: { id: string; name: string; isActive: boolean }[] }>(showStock ? "/stock-locations" : null).data?.data.filter((w) => w.isActive) ?? []
  const nameOf = (r: Item) => r.category ?? categories.data?.data.find((c) => c.id === r.categoryId)?.name
  async function setActive(r: Item, active: boolean) {
    try {
      await api.patch(`/items/${r.id}`, { isActive: active, version: r.version })
      toast.success(active ? `${r.name} restored` : `${r.name} archived`)
      refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const columns: Column<Item>[] = [
    {
      key: "item", header: "Product", hideable: false, sort: (r) => r.name, csv: (r) => r.name,
      cell: (r) => (
        <span className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {r.imageUrl ? <img src={r.imageUrl} alt="" className="size-full object-cover" /> : <Package className="size-5 text-muted-foreground" aria-hidden />}
          </span>
          <span className="min-w-0">
            <span className="block font-medium">{r.name}{!r.isActive && <Badge variant="outline" className="ml-2">Archived</Badge>}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Tag className="size-3" aria-hidden />{r.sku || "No SKU"}{r.tracking === "batch" ? " · Batch" : r.tracking === "serial" ? " · Serial" : ""}{r.hsnSac ? ` · HSN ${r.hsnSac}` : ""}</span>
          </span>
        </span>
      ),
    },
    { key: "sale", header: "Sale price", sort: (r) => r.pricePaise, csv: (r) => r.pricePaise / 100, cell: (r) => <span className="font-medium text-emerald-700 tabular-nums dark:text-emerald-300">{formatPaise(r.pricePaise)}</span> },
    ...(showCost ? [{ key: "cost", header: "Purchase price", sort: (r: Item) => r.costPricePaise ?? 0, csv: (r: Item) => (r.costPricePaise ?? 0) / 100, cell: (r: Item) => <span className="font-medium text-amber-700 tabular-nums dark:text-amber-300">{r.costPricePaise != null ? formatPaise(r.costPricePaise) : "—"}{r.marginBp != null && <span className={cn("block text-[11px] font-normal", r.marginBp < 0 ? "text-destructive" : "text-muted-foreground")}>{(r.marginBp / 100).toFixed(1)}% margin</span>}</span> }] : []),
    { key: "gst", header: "GST", defaultHidden: true, csv: (r) => r.gstRateBp / 100, cell: (r) => <Badge variant="outline">{r.gstRateBp / 100}%</Badge> },
    { key: "category", header: "Category", csv: (r) => nameOf(r) ?? "", cell: (r) => { const n = nameOf(r); return n ? <Badge variant="outline" className={cn("border-transparent", categoryColour(n))}>{n}</Badge> : "—" } },
    { key: "unit", header: "Unit", csv: (r) => r.unit, cell: (r) => <Badge variant="outline">{r.unit}</Badge> },
    ...(showStock ? [{
      key: "qty", header: "Quantity", sort: (r: Item) => r.stockQty ?? 0, csv: (r: Item) => r.stockQty ?? "",
      cell: (r: Item) => {
        if (r.type !== "product") return "—"
        const qty = <span className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium tabular-nums", (r.stockQty ?? 0) <= 0 ? "border-rose-200 text-destructive" : r.low && "border-amber-300 text-amber-700 dark:text-amber-300")} title={r.low ? "At or under the low-stock level" : undefined}><ShoppingCart className="size-3" aria-hidden />{r.stockQty ?? 0}</span>
        return r.reservedQty ? <span className="inline-flex items-center gap-1">{qty}<span className="text-xs text-muted-foreground">{r.reservedQty} held</span></span> : qty
      },
    }] : []),
    ...(showStock ? [{
      key: "warehouse", header: "Warehouse", csv: (r: Item) => (r.warehouses ?? []).map((w) => `${w.name}: ${w.quantity}`).join("; "),
      cell: (r: Item) => (r.warehouses?.length ? <span className="flex flex-wrap gap-1">{r.warehouses.map((w) => <Badge key={w.id} variant="outline">{w.name} · {w.quantity}</Badge>)}</span> : "—"),
    }] : []),
    { key: "sold", header: "Sold (30 days)", align: "right", sort: (r) => r.soldQty30 ?? 0, csv: (r) => r.soldQty30 ?? 0, cell: (r) => <span className="tabular-nums">{r.soldQty30 ? `${r.soldQty30} ${r.unit}` : <span className="text-muted-foreground">—</span>}{r.lastSoldOn && <span className="block text-[11px] text-muted-foreground">Last {ago(r.lastSoldOn)}</span>}</span> },
    { key: "soldAll", header: "Sold (all time)", align: "right", defaultHidden: true, sort: (r) => r.soldValuePaise ?? 0, csv: (r) => (r.soldValuePaise ?? 0) / 100, cell: (r) => <span className="tabular-nums">{r.soldValuePaise ? formatPaise(r.soldValuePaise) : "—"}<span className="block text-[11px] text-muted-foreground">{r.soldQty ?? 0} {r.unit}</span></span> },
    ...(showCost ? [{ key: "lastCost", header: "Last bought", defaultHidden: true, sort: (r: Item) => r.lastBoughtOn ?? "", csv: (r: Item) => (r.lastCostPaise ?? 0) / 100, cell: (r: Item) => (r.lastBoughtOn ? <span className="text-sm tabular-nums">{r.lastCostPaise != null ? formatPaise(r.lastCostPaise) : "—"}<span className="block text-[11px] text-muted-foreground">{formatDate(r.lastBoughtOn)}</span></span> : <span className="text-muted-foreground">Never</span>) }] : []),
    ...(showCost && showStock ? [{ key: "value", header: "Stock value", align: "right" as const, defaultHidden: true, sort: (r: Item) => r.stockValuePaise ?? 0, csv: (r: Item) => (r.stockValuePaise ?? 0) / 100, cell: (r: Item) => <span className="tabular-nums">{r.stockValuePaise ? formatPaise(r.stockValuePaise) : "—"}</span> }] : []),
    { key: "lists", header: "Price lists", align: "right", defaultHidden: true, csv: (r) => r.priceListCount ?? 0, cell: (r) => <span className="tabular-nums">{r.priceListCount || "—"}</span> },
    { key: "barcode", header: "Barcode", defaultHidden: true, csv: (r) => r.barcode ?? "", cell: (r) => <span className="font-mono text-xs">{r.barcode ?? "—"}</span> },
    { key: "type", header: "Type", csv: (r) => r.type, cell: (r) => <Badge variant="outline" className="capitalize">{r.type}</Badge> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => {
        const stock = r.type === "product" && showStock && r.isActive && !!r.trackStock
        return (
          <span className="flex items-center gap-0.5" onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
            {stock && canAddStock && <Button variant="ghost" size="icon-sm" title="Add stock" aria-label={`Add stock to ${r.name}`} onClick={() => setStock({ kind: "add", item: r })}><Plus /></Button>}
            {can("catalog.item.edit") && <Link href={`/app/m/catalog/new?edit=${r.id}`} className={iconLink} title="Edit" aria-label={`Edit ${r.name}`}><Pencil /></Link>}
            <ActionMenu label={`More actions for ${r.name}`} items={[
              { label: "Open", icon: Eye, href: `/app/m/catalog/${r.id}` },
              stock && { label: "Stock history", icon: History, href: `/app/m/catalog/${r.id}?tab=stock` },
              "-",
              stock && can("inventory.stock_adjustment.create") && { label: "Adjust stock", icon: SlidersHorizontal, onClick: () => setStock({ kind: "adjust", item: r }) },
              stock && can("inventory.transfer.create") && { label: "Move to another warehouse", icon: ArrowLeftRight, onClick: () => setStock({ kind: "move", item: r }) },
              "-",
              can("catalog.item.create") && { label: "Make a copy", icon: Copy, href: `/app/m/catalog/new?copy=${r.id}` },
              r.type === "product" && { label: "Print barcode labels", icon: Barcode, onClick: () => window.open(`/print/labels?ids=${r.id}`, "_blank", "noopener") },
              can("catalog.item.edit") && (r.isActive ? { label: "Archive", icon: Archive, onClick: () => void setActive(r, false) } : { label: "Restore", icon: ArchiveRestore, onClick: () => void setActive(r, true) }),
              "-",
              can("catalog.item.delete") && r.isActive && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) },
            ]} />
          </span>
        )
      },
    },
  ]

  const create = can("catalog.item.create") ? <HeaderLink href="/app/m/catalog/new" primary><Plus /> Create item</HeaderLink> : undefined
  return (
    <>
      <DataList<Item>
        id="catalog-items"
        path="/items"
        params={{ active: "true", v: String(version) }}
        header={{ title, description: "Everything you buy and sell: prices, GST, stock. Open one to see where it is and how it moved.", primary: create, more: [...(can("catalog.item.create") && showStock ? [{ label: "Import items and stock", href: "/app/m/inventory/import" }] : []), { label: "Price lists", href: "/app/m/catalog/price-lists" }, ...(showStock ? [{ label: "Stock by warehouse", href: "/app/m/inventory" }] : [])] }}
        columns={columns}
        searchPlaceholder="Search name, SKU, HSN or barcode"
        presets={PRESETS}
        presetLabel="Show"
        tabs
        top={(res) => {
          const c = (res.counts ?? {}) as Record<string, number>
          const m = (res.sums ?? {}) as Record<string, number | null>
          return <SummaryCards items={[
            { label: title, value: c.all ?? 0, hint: `${c.product ?? 0} products · ${c.service ?? 0} services · ${m.categories ?? 0} categories`, color: "blue", icon: Package },
            ...(showStock && m.stockValue != null ? [{ label: "Stock value", value: formatPaise(m.stockValue ?? 0), hint: `At cost · ${formatPaise(m.saleValue ?? 0)} at sale price`, color: "emerald", icon: IndianRupee }] : showStock ? [{ label: "Stock at sale price", value: formatPaise(m.saleValue ?? 0), hint: "What it would sell for", color: "emerald", icon: IndianRupee }] : []),
            ...(showStock ? [
              { label: "Low stock", value: c.low ?? 0, hint: "At or under the low-stock level", color: "amber", icon: AlarmClock, href: "/app/m/purchase/reorder" },
              { label: "Out of stock", value: c.out ?? 0, hint: "Tracked, none left", color: "rose", icon: CircleSlash },
            ] : []),
            { label: "Selling", value: m.sold30 ?? 0, hint: `Sold in the last 30 days · ${m.neverSold ?? 0} never sold`, color: "violet", icon: TrendingUp },
          ]} />
        }}
        filters={[
          ...(categories.data?.data.length ? [{ key: "categoryId", label: "Category", options: categories.data.data.map((c) => ({ value: c.id, label: c.name })) }] : []),
          ...(places.length ? [{ key: "locationId", label: "Warehouse", options: places.map((w) => ({ value: w.id, label: w.name })) }] : []),
        ]}
        rowHref={(r) => `/app/m/catalog/${r.id}`}
        exportName="items"
        emptyState={<EmptyState icon={Package} title="No items yet" description="Add what you buy and sell so you can bill it in seconds." action={create} />}
      />
      {stock && <StockDialog kind={stock.kind} item={{ id: stock.item.id, name: stock.item.name, unit: stock.item.unit, sku: stock.item.sku, tracking: stock.item.tracking, costPaise: stock.item.costPricePaise ?? null, warehouses: stock.item.warehouses }} onClose={() => setStock(null)} onDone={() => { setStock(null); refresh() }} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "item"}?`}
        description="If it is used on any bill or stock record it is archived instead, so your history stays correct."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try { await api.delete(`/items/${deleting!.id}`); toast.success("Item removed"); setDeleting(null); refresh() } catch (e) { toast.error(errorMessage(e)); throw e }
        }}
      />
    </>
  )
}
