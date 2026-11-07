"use client"

import * as React from "react"
import { toast } from "sonner"
import { Package, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell"
import { EmptyState, LoadMore, MoneyInput, SearchInput, Spinner } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { CustomFieldsForm, useCustomFields } from "@/components/custom-fields"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useDebounced, useList } from "@/lib/use-list"
import { formatPaise } from "@/lib/format"
import { GST_RATES } from "@/lib/money"

interface Item {
  id: string
  type: "product" | "service"
  name: string
  sku: string | null
  categoryId: string | null
  unit: string
  pricePaise: number
  costPricePaise?: number | null
  gstRateBp: number
  hsnSac: string | null
  durationMin: number | null
  description: string | null
  isActive: boolean
  trackStock?: boolean
  reorderLevel?: number | null
  stockQty?: number
  custom: Record<string, unknown>
  version: number
}

interface Category {
  id: string
  name: string
}

const EMPTY = { type: "product" as Item["type"], name: "", sku: "", categoryId: "", unit: "pcs", pricePaise: null as number | null, costPricePaise: null as number | null, gstRateBp: 1800, hsnSac: "", durationMin: "", description: "", trackStock: false, reorderLevel: "", custom: {} as Record<string, unknown> }

function ItemDialog({ item, categories, onClose, onSaved }: { item: Item | null; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const { can, me } = useAuth()
  const fields = useCustomFields("item")
  const canCost = me?.fieldAccess?.["item.cost_price"] === "write"
  const [form, setForm] = React.useState(() =>
    item
      ? { ...EMPTY, ...item, sku: item.sku ?? "", categoryId: item.categoryId ?? "", hsnSac: item.hsnSac ?? "", durationMin: item.durationMin ? String(item.durationMin) : "", description: item.description ?? "", costPricePaise: item.costPricePaise ?? null, trackStock: !!item.trackStock, reorderLevel: item.reorderLevel != null ? String(item.reorderLevel) : "" }
      : EMPTY
  )
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const editable = item ? can("catalog.item.edit") : can("catalog.item.create")

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (form.pricePaise === null) return setErrors({ pricePaise: "Enter a price" })
    setBusy(true)
    setError(null)
    setErrors({})
    const body = {
      type: form.type,
      name: form.name,
      sku: form.sku || null,
      categoryId: form.categoryId || null,
      unit: form.unit,
      pricePaise: form.pricePaise,
      ...(canCost ? { costPricePaise: form.costPricePaise } : {}),
      gstRateBp: form.gstRateBp,
      hsnSac: form.hsnSac || null,
      durationMin: form.type === "service" && form.durationMin ? Number(form.durationMin) : null,
      description: form.description || null,
      ...(form.type === "product" ? { trackStock: form.trackStock, reorderLevel: form.trackStock && form.reorderLevel !== "" ? Number(form.reorderLevel) : null } : { trackStock: false }),
      custom: form.custom,
    }
    try {
      if (item) await api.patch(`/items/${item.id}`, { ...body, version: item.version })
      else await api.post("/items", body)
      toast.success(item ? "Saved" : "Item added")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? item.name : "New product or service"}</DialogTitle>
          <DialogDescription>Prices exclude GST. The GST rate and HSN/SAC appear on invoices.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="inline-flex w-fit rounded-full bg-muted p-1 text-sm" role="radiogroup" aria-label="Type">
            {(["product", "service"] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={form.type === t} disabled={!editable}
                onClick={() => setForm((f) => ({ ...f, type: t, unit: t === "service" ? "service" : f.unit === "service" ? "pcs" : f.unit }))}
                className={`rounded-full px-3 py-1 capitalize ${form.type === t ? "bg-background font-medium shadow-sm" : ""}`}>
                {t}
              </button>
            ))}
          </div>
          <Field label="Name" error={errors.name}>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} required disabled={!editable} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Selling price" error={errors.pricePaise}>
              <MoneyInput value={form.pricePaise} onChange={(v) => set("pricePaise", v)} disabled={!editable} required />
            </Field>
            <Field label="GST rate" error={errors.gstRateBp}>
              <NativeSelect value={form.gstRateBp} onChange={(e) => set("gstRateBp", Number(e.target.value))} disabled={!editable}>
                {GST_RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label={form.type === "service" ? "SAC code" : "HSN code"} error={errors.hsnSac} hint="4–8 digits">
              <Input inputMode="numeric" value={form.hsnSac} onChange={(e) => set("hsnSac", e.target.value.replace(/\D/g, ""))} maxLength={8} disabled={!editable} />
            </Field>
            <Field label="Unit">
              <Input value={form.unit} onChange={(e) => set("unit", e.target.value)} disabled={!editable} list="units" />
            </Field>
            <Field label="SKU / code" error={errors.sku}>
              <Input value={form.sku} onChange={(e) => set("sku", e.target.value)} disabled={!editable} />
            </Field>
            <Field label="Category">
              <NativeSelect value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)} disabled={!editable}>
                <option value="">No category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
            {form.type === "service" && (
              <Field label="Duration (minutes)" hint="Used for bookings">
                <Input inputMode="numeric" value={form.durationMin} onChange={(e) => set("durationMin", e.target.value.replace(/\D/g, ""))} disabled={!editable} />
              </Field>
            )}
            {canCost && (
              <Field label="Cost price" hint="Visible only to roles allowed to see margins">
                <MoneyInput value={form.costPricePaise} onChange={(v) => set("costPricePaise", v)} disabled={!editable} />
              </Field>
            )}
          </div>
          {form.type === "product" && can("inventory.stock.view") && (
            <div className="grid gap-3 rounded-2xl bg-muted/60 p-3 sm:grid-cols-2 sm:items-end">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={form.trackStock} disabled={!editable} onChange={(e) => set("trackStock", e.target.checked)} />
                <span><span className="font-medium">Track stock</span><span className="block text-xs text-muted-foreground">{item?.trackStock ? `${item.stockQty ?? 0} ${item.unit} in stock. ` : ""}Bills take stock out. Add opening stock in Inventory.</span></span>
              </label>
              {form.trackStock && (
                <Field label="Low-stock level" hint="Alert at or below this" error={errors.reorderLevel}>
                  <Input inputMode="decimal" value={form.reorderLevel} onChange={(e) => set("reorderLevel", e.target.value.replace(/[^\d.]/g, ""))} disabled={!editable} />
                </Field>
              )}
            </div>
          )}
          <datalist id="units">{["pcs", "kg", "g", "l", "ml", "m", "box", "pack", "hour", "service", "month"].map((u) => <option key={u} value={u} />)}</datalist>
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} disabled={!editable} />
          </Field>
          <CustomFieldsForm fields={fields} value={form.custom} onChange={(v) => set("custom", v)} errors={errors} disabled={!editable} />
          <FormError message={error} />
          {editable && (
            <DialogFooter>
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : item ? "Save changes" : "Add item"}</Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function CatalogPage() {
  const { can, term, me } = useAuth()
  const [search, setSearch] = React.useState("")
  const [type, setType] = React.useState("")
  const [active, setActive] = React.useState("true")
  const q = useDebounced(search)
  const list = useList<Item>("/items", { q, type, active })
  const categories = useApi<{ data: Category[] }>("/item-categories")
  const [editing, setEditing] = React.useState<Item | "new" | null>(null)
  const showCost = !!me?.fieldAccess?.["item.cost_price"] && me.fieldAccess["item.cost_price"] !== "hidden"
  const title = term("entity.item.plural", "Products & Services")

  async function addCategory() {
    const name = window.prompt("New category name")
    if (!name?.trim()) return
    try {
      await api.post("/item-categories", { name: name.trim() })
      await categories.reload()
      toast.success("Category added")
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title={title}
        description="One catalogue for billing, quotations and bookings. Prices exclude GST."
        actions={
          <>
            {can("catalog.price_list.view") && <Link href="/app/m/catalog/price-lists" className={buttonVariants({ variant: "outline" })}>Price lists</Link>}
            {can("catalog.category.create") && <Button variant="outline" onClick={addCategory}>New category</Button>}
            {can("catalog.item.create") && <Button onClick={() => setEditing("new")}><Plus /> Add item</Button>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, SKU or HSN" className="w-full sm:w-72" />
        <NativeSelect className="w-40" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          <option value="product">Products</option>
          <option value="service">Services</option>
        </NativeSelect>
        <NativeSelect className="w-36" value={active} onChange={(e) => setActive(e.target.value)} aria-label="Status">
          <option value="true">Active</option>
          <option value="false">Archived</option>
          <option value="all">All</option>
        </NativeSelect>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {list.loading ? (
            <div className="grid place-items-center py-14"><Spinner /></div>
          ) : list.rows.length === 0 ? (
            <EmptyState icon={Package} title={search ? "No matches" : `No ${title.toLowerCase()} yet`} description="Add what you sell so you can bill it in seconds." action={can("catalog.item.create") && !search ? <Button onClick={() => setEditing("new")}><Plus /> Add item</Button> : undefined} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>HSN/SAC</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                  {can("inventory.stock.view") && <TableHead className="text-right">Stock</TableHead>}
                  {showCost && <TableHead className="text-right">Cost</TableHead>}
                  <TableHead className="pr-6 text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((i) => (
                  <TableRow key={i.id} className="cursor-pointer" onClick={() => setEditing(i)}>
                    <TableCell className="pl-6">
                      <div className="font-medium">{i.name} {!i.isActive && <Badge variant="outline" className="ml-1">Archived</Badge>}</div>
                      <div className="text-xs text-muted-foreground">{[i.sku, categories.data?.data.find((c) => c.id === i.categoryId)?.name, i.durationMin ? `${i.durationMin} min` : null].filter(Boolean).join(" · ") || i.unit}</div>
                    </TableCell>
                    <TableCell className="capitalize">{i.type}</TableCell>
                    <TableCell className="font-mono text-xs">{i.hsnSac ?? "—"}</TableCell>
                    <TableCell className="text-right">{i.gstRateBp / 100}%</TableCell>
                    {can("inventory.stock.view") && <TableCell className={"text-right tabular-nums" + ((i.stockQty ?? 0) < 0 ? " text-destructive" : "")}>{i.trackStock ? `${i.stockQty ?? 0} ${i.unit}` : "—"}</TableCell>}
                    {showCost && <TableCell className="text-right tabular-nums text-muted-foreground">{i.costPricePaise != null ? formatPaise(i.costPricePaise) : "—"}</TableCell>}
                    <TableCell className="pr-6 text-right font-medium tabular-nums">{formatPaise(i.pricePaise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
        </CardContent>
      </Card>
      {editing && (
        <ItemDialog
          item={editing === "new" ? null : editing}
          categories={categories.data?.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void list.reload()
          }}
        />
      )}
    </>
  )
}
