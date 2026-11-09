"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Eye, Package, Pencil, Plus, ShoppingCart, Tag, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog, EmptyState, MoneyInput } from "@/components/common"
import { WarehouseSelect } from "@/components/creatable-select"
import { DataList, HeaderLink, type Column, type ViewPreset } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { categoryColour, type Category, type Item } from "@/lib/catalog"
import { formatPaise } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"
import { todayInIndia } from "@contracts/validation"

const PRESETS: ViewPreset[] = [
  { key: "all", label: "All", params: {} },
  { key: "product", label: "Products", params: { type: "product" } },
  { key: "service", label: "Services", params: { type: "service" } },
  { key: "archived", label: "Archived", params: { active: "false" } },
]

function AddStockDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const { me } = useAuth()
  const showCost = !!me?.fieldAccess?.["item.cost_price"] && me.fieldAccess["item.cost_price"] !== "hidden"
  const [picked, setLocationId] = React.useState("")
  const defaults = useApi<{ data: { id: string; isDefault: boolean; isActive: boolean }[] }>("/stock-locations").data?.data
  const locationId = picked || defaults?.find((w) => w.isDefault && w.isActive)?.id || ""
  const [quantity, setQuantity] = React.useState("")
  const [rate, setRate] = React.useState<number | null>(item.costPricePaise ?? null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save() {
    const p: Record<string, string> = {}
    if (!locationId) p.locationId = "Choose a warehouse"
    if (!(Number(quantity) > 0)) p.quantity = "Enter more than 0"
    setErrors(p)
    if (Object.keys(p).length) return
    setBusy(true)
    setError(null)
    try {
      await api.post("/stock/entries", { kind: "stock_in", locationId, date: todayInIndia(), lines: [{ itemId: item.id, quantity: Number(quantity), ratePaise: rate ?? 0 }] })
      toast.success(`${quantity} ${item.unit} added to ${item.name}`)
      onDone()
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields)
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add stock</DialogTitle>
          <DialogDescription>{item.name}{item.sku ? ` · ${item.sku}` : ""} · {item.stockQty ?? 0} {item.unit} in stock</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Warehouse" required error={errors.locationId}><WarehouseSelect value={locationId} onChange={setLocationId} aria-label="Warehouse" aria-invalid={!!errors.locationId} /></Field>
          <Field label="Quantity" required error={errors.quantity ?? errors["lines.0.quantity"]}><Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d.]/g, ""))} placeholder={item.unit} autoFocus /></Field>
          {showCost && <Field label={`Cost per ${item.unit}`}><MoneyInput value={rate} onChange={setRate} aria-label="Cost" /></Field>}
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{busy ? "Adding…" : "Add stock"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const iconLink = buttonVariants({ variant: "ghost", size: "icon-sm" })

export default function ItemsPage() {
  const { can, term, me } = useAuth()
  const categories = useApi<{ data: Category[] }>("/item-categories")
  const [adding, setAdding] = React.useState<Item | null>(null)
  const [deleting, setDeleting] = React.useState<Item | null>(null)
  const [version, setVersion] = React.useState(0)
  const refresh = () => setVersion((v) => v + 1)
  const title = term("entity.item.plural", "Items")
  const showCost = !!me?.fieldAccess?.["item.cost_price"] && me.fieldAccess["item.cost_price"] !== "hidden"
  const showStock = can("inventory.stock.view")
  const canAddStock = can("inventory.receipt.create")
  const places = useApi<{ data: { id: string; name: string; isActive: boolean }[] }>(showStock ? "/stock-locations" : null).data?.data.filter((w) => w.isActive) ?? []
  const nameOf = (id: string | null) => categories.data?.data.find((c) => c.id === id)?.name

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
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
          {r.type === "product" && canAddStock && (r.tracking ?? "none") === "none" && r.isActive && <Button variant="ghost" size="icon-sm" title="Add stock" aria-label={`Add stock to ${r.name}`} onClick={() => setAdding(r)}><Plus /></Button>}
          {r.type === "product" && showStock && r.trackStock && <Link href={`/app/m/inventory/items/${r.id}`} className={iconLink} title="View stock" aria-label={`View stock of ${r.name}`}><Eye /></Link>}
          {can("catalog.item.edit") && <Link href={`/app/m/catalog/new?edit=${r.id}`} className={iconLink} title="Edit" aria-label={`Edit ${r.name}`}><Pencil /></Link>}
          {can("catalog.item.delete") && r.isActive && <Button variant="ghost" size="icon-sm" className="text-destructive" title="Delete" aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}><Trash2 /></Button>}
        </span>
      ),
    },
  ]

  const create = can("catalog.item.create") ? <HeaderLink href="/app/m/catalog/new" primary><Plus /> Create item</HeaderLink> : undefined
  return (
    <>
      <DataList<Item>
        id="catalog-items"
        path="/items"
        params={{ active: "true", v: String(version) }}
        header={{ title, description: "Manage your products, services, prices and stock.", primary: create }}
        columns={columns}
        searchPlaceholder="Search name, SKU, HSN or barcode"
        presets={PRESETS}
        presetLabel="Type"
        filters={[
          ...(categories.data?.data.length ? [{ key: "categoryId", label: "Category", options: categories.data.data.map((c) => ({ value: c.id, label: c.name })) }] : []),
          ...(places.length ? [{ key: "locationId", label: "Warehouse", options: places.map((w) => ({ value: w.id, label: w.name })) }] : []),
        ]}
        rowHref={(r) => `/app/m/catalog/new?edit=${r.id}`}
        exportName="items"
        emptyState={<EmptyState icon={Package} title="No items yet" description="Add what you buy and sell so you can bill it in seconds." action={create} />}
      />
      {adding && <AddStockDialog item={adding} onClose={() => setAdding(null)} onDone={() => { setAdding(null); refresh() }} />}
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
