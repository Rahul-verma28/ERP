"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Archive, ArchiveRestore, ArrowLeftRight, Barcode, Copy, Eye, History, Package, Pencil, Plus, ShoppingCart, SlidersHorizontal, Tag, Trash2 } from "lucide-react"
import { ActionMenu } from "@/components/page-parts"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { StockDialog } from "@/components/stock-dialogs"
import { DataList, HeaderLink, type Column, type ViewPreset } from "@/components/data-list"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { categoryColour, type Category, type Item } from "@/lib/catalog"
import { formatPaise } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"

const PRESETS: ViewPreset[] = [
  { key: "all", label: "All", params: {} },
  { key: "product", label: "Products", params: { type: "product" } },
  { key: "service", label: "Services", params: { type: "service" } },
  { key: "low", label: "Low stock", params: { low: "true" } },
  { key: "archived", label: "Archived", params: { active: "false" } },
]

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
  const nameOf = (id: string | null) => categories.data?.data.find((c) => c.id === id)?.name
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
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Tag className="size-3" aria-hidden />{r.sku || "No SKU"}{r.tracking === "batch" ? " · Batch" : r.tracking === "serial" ? " · Serial" : ""}</span>
          </span>
        </span>
      ),
    },
    { key: "sale", header: "Sale price", sort: (r) => r.pricePaise, csv: (r) => r.pricePaise / 100, cell: (r) => <span className="font-medium text-emerald-700 tabular-nums dark:text-emerald-300">{formatPaise(r.pricePaise)}</span> },
    ...(showCost ? [{ key: "cost", header: "Purchase price", sort: (r: Item) => r.costPricePaise ?? 0, csv: (r: Item) => (r.costPricePaise ?? 0) / 100, cell: (r: Item) => <span className="font-medium text-amber-700 tabular-nums dark:text-amber-300">{r.costPricePaise != null ? formatPaise(r.costPricePaise) : "—"}</span> }] : []),
    { key: "category", header: "Category", csv: (r) => nameOf(r.categoryId) ?? "", cell: (r) => { const n = nameOf(r.categoryId); return n ? <Badge variant="outline" className={cn("border-transparent", categoryColour(n))}>{n}</Badge> : "—" } },
    { key: "unit", header: "Unit", csv: (r) => r.unit, cell: (r) => <Badge variant="outline">{r.unit}</Badge> },
    ...(showStock ? [{
      key: "qty", header: "Quantity", sort: (r: Item) => r.stockQty ?? 0, csv: (r: Item) => r.stockQty ?? "",
      cell: (r: Item) => {
        if (r.type !== "product") return "—"
        const qty = <span className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium tabular-nums", (r.stockQty ?? 0) < 0 && "text-destructive")}><ShoppingCart className="size-3" aria-hidden />{r.stockQty ?? 0}</span>
        return r.reservedQty ? <span className="inline-flex items-center gap-1">{qty}<span className="text-xs text-muted-foreground">{r.reservedQty} held</span></span> : qty
      },
    }] : []),
    ...(showStock ? [{
      key: "warehouse", header: "Warehouse", csv: (r: Item) => (r.warehouses ?? []).map((w) => `${w.name}: ${w.quantity}`).join("; "),
      cell: (r: Item) => (r.warehouses?.length ? <span className="flex flex-wrap gap-1">{r.warehouses.map((w) => <Badge key={w.id} variant="outline">{w.name} · {w.quantity}</Badge>)}</span> : "—"),
    }] : []),
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
