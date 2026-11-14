"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, BadgeIndianRupee, Boxes, ChevronLeft, ChevronRight, ImageIcon, Info, Package, Plus, Tag } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell"
import { MoneyInput } from "@/components/common"
import { CategorySelect, WarehouseSelect, UnitSelect } from "@/components/creatable-select"
import { CustomFieldsForm, useCustomFields } from "@/components/custom-fields"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ImagePicker } from "@/components/image-picker"
import { Stepper, type Step } from "@/components/stepper"
import { NumberStepper } from "@/components/number-stepper"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { categoryColour, type Category, type Item } from "@/lib/catalog"
import { formatPaise } from "@/lib/format"
import { GST_RATES } from "@/lib/money"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"
import { PageLoading } from "@/components/page-states"

const BLANK = { type: "product" as Item["type"], name: "", sku: "", categoryId: "", unit: "pcs", pricePaise: null as number | null, costPricePaise: null as number | null, gstRateBp: 1800, hsnSac: "", durationMin: "", description: "", imageUrl: null as string | null, trackStock: true, reorderLevel: "", tracking: "none" as NonNullable<Item["tracking"]>, altUnit: "", altFactor: "", barcode: "", openingQty: "", locationId: "", custom: {} as Record<string, unknown> }
type Form = typeof BLANK

const fromItem = (i: Item): Form => ({ ...BLANK, type: i.type, name: i.name, sku: i.sku ?? "", categoryId: i.categoryId ?? "", unit: i.unit, pricePaise: i.pricePaise, costPricePaise: i.costPricePaise ?? null, gstRateBp: i.gstRateBp, hsnSac: i.hsnSac ?? "", durationMin: i.durationMin ? String(i.durationMin) : "", description: i.description ?? "", imageUrl: i.imageUrl, trackStock: !!i.trackStock, reorderLevel: i.reorderLevel != null ? String(i.reorderLevel) : "", tracking: i.tracking ?? "none", altUnit: i.altUnit ?? "", altFactor: i.altFactor ? String(i.altFactor) : "", barcode: i.barcode ?? "", custom: i.custom })

const STEP_FIELDS: Record<string, string[]> = {
  basic: ["name", "sku", "categoryId", "gstRateBp", "hsnSac", "description", "custom"],
  pricing: ["pricePaise", "costPricePaise", "unit", "durationMin"],
  image: ["imageUrl"],
  stock: ["trackStock", "reorderLevel", "tracking", "barcode", "altUnit", "altFactor", "opening"],
}

function VariantsDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const [rows, setRows] = React.useState([{ name: "Size", values: "" }, { name: "Colour", values: "" }])
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const attrs = Object.fromEntries(rows.filter((r) => r.name.trim() && r.values.trim()).map((r) => [r.name.trim(), [...new Set(r.values.split(",").map((v) => v.trim()).filter(Boolean))]]))
  const count = Object.values(attrs).reduce((n, v) => n * v.length, Object.keys(attrs).length ? 1 : 0)
  async function make() {
    if (!count) return setError("Give at least one attribute with values")
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ created: number }>(`/items/${item.id}/variants`, { attributes: attrs })
      toast.success(r.created ? `${r.created} variants added` : "Those variants already exist")
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Variants of {item.variantGroup ?? item.name}</DialogTitle>
          <DialogDescription>Each combination becomes its own item with the same price, GST and stock settings.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[8rem_1fr] gap-2">
              <Input value={r.name} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Attribute" aria-label="Attribute" />
              <Input value={r.values} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} placeholder="Values, comma separated: S, M, L" aria-label={`Values of ${r.name || "attribute"}`} />
            </div>
          ))}
          {rows.length < 3 && <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setRows((rs) => [...rs, { name: "", values: "" }])}><Plus /> Attribute</Button>}
          <p className="text-sm text-muted-foreground">{count ? `${count} item${count === 1 ? "" : "s"} will be made` : "Nothing to make yet"}</p>
          <FormError message={error} />
        </div>
        <DialogFooter><Button disabled={busy || !count} onClick={make}>{busy ? "Making…" : "Make variants"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Preview({ form, category }: { form: Form; category?: string }) {
  return (
    <aside className="xl:sticky xl:top-20">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Live preview</p>
      </div>
      <div className="ui-surface overflow-hidden">
        <div className="grid h-48 place-items-center bg-muted/50">
          {form.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.imageUrl} alt="" className="h-full w-full object-contain p-3" />
          ) : (
            <span className="grid justify-items-center gap-1 text-sm text-muted-foreground"><Package className="size-9" aria-hidden />No image</span>
          )}
        </div>
        <div className="grid gap-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="capitalize">{form.type}</Badge>
            {category && <Badge variant="outline" className={cn("border-transparent", categoryColour(category))}>{category}</Badge>}
          </div>
          <div>
            <p className="font-semibold">{form.name || "Untitled item"}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><Tag className="size-3" aria-hidden />{form.sku || "No SKU"}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-emerald-50 p-2.5 dark:bg-emerald-950/40"><p className="text-[10px] text-muted-foreground uppercase">Sale price</p><p className="font-semibold text-emerald-700 tabular-nums dark:text-emerald-300">{formatPaise(form.pricePaise ?? 0)}</p></div>
            <div className="rounded-xl bg-amber-50 p-2.5 dark:bg-amber-950/40"><p className="text-[10px] text-muted-foreground uppercase">Purchase</p><p className="font-semibold text-amber-700 tabular-nums dark:text-amber-300">{formatPaise(form.costPricePaise ?? 0)}</p></div>
          </div>
        </div>
      </div>
    </aside>
  )
}

export function ItemForm({ editId, copyId }: { editId?: string | null; copyId?: string | null }) {
  const router = useRouter()
  const { can, me } = useAuth()
  const source = useApi<Item>(editId ? `/items/${editId}` : copyId ? `/items/${copyId}` : null)
  const categories = useApi<{ data: Category[] }>("/item-categories")
  const customFields = useCustomFields("item")
  const places = useApi<{ data: { id: string; isDefault: boolean; isActive: boolean }[] }>(can("inventory.stock.view") ? "/stock-locations" : null).data?.data
  const [edits, setEdits] = React.useState<Partial<Form>>({})
  const [step, setStep] = React.useState(0)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [variants, setVariants] = React.useState(false)

  const item = editId ? source.data : null
  // A copy starts from another item: same prices and settings, a new name, no SKU or barcode
  const copy = copyId && source.data ? { ...fromItem(source.data), name: `${source.data.name} (copy)`, sku: "", barcode: "", openingQty: "" } : null
  if ((editId || copyId) && source.error) return <PageHeader title="Not found" description={errorMessage(source.error)} />
  if ((editId || copyId) && !source.data) return <PageLoading />

  const canStock = can("inventory.stock.view")
  const startAt = places?.find((w) => w.isDefault && w.isActive)?.id ?? ""
  const form: Form = { ...(item ? fromItem(item) : copy ? { ...copy, locationId: startAt } : { ...BLANK, trackStock: canStock, locationId: startAt }), ...edits }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setEdits((e) => ({ ...e, [k]: v }))
  const editable = item ? can("catalog.item.edit") : can("catalog.item.create")
  const canCost = me?.fieldAccess?.["item.cost_price"] === "write"
  const isProduct = form.type === "product"
  const canOpen = !item && isProduct && form.trackStock && form.tracking === "none" && can("inventory.receipt.create")
  const steps: Step[] = [
    { key: "basic", label: "Basic Details", icon: Info },
    { key: "pricing", label: "Pricing & Units", icon: BadgeIndianRupee },
    { key: "image", label: "Image", icon: ImageIcon },
    ...(isProduct && canStock ? [{ key: "stock", label: "Stock", icon: Boxes }] : []),
  ]
  const at = Math.min(step, steps.length - 1)
  const current = steps[at].key
  const last = at === steps.length - 1
  const category = categories.data?.data.find((c) => c.id === form.categoryId)?.name

  /** What is wrong on one step; empty means it can be left */
  const problems = (key: string) => {
    const p: Record<string, string> = {}
    if (key === "basic" && form.name.trim().length < 2) p.name = "Enter the item name"
    if (key === "basic" && form.hsnSac && (isProduct ? !/^(\d{4}|\d{6}|\d{8})$/.test(form.hsnSac) : !/^99\d{4}$/.test(form.hsnSac))) p.hsnSac = isProduct ? "HSN has 4, 6 or 8 digits" : "SAC has 6 digits and starts with 99"
    if (key === "pricing" && form.pricePaise === null) p.pricePaise = "Enter the sale price"
    if (key === "pricing" && !form.unit) p.unit = "Choose the unit"
    if (key === "stock" && form.barcode && !/^[\x20-\x7E]+$/.test(form.barcode)) p.barcode = "Letters, digits and symbols only"
    if (key === "stock" && form.altUnit.trim() && !(Number(form.altFactor) > 1)) p.altFactor = "More than 1"
    if (key === "stock" && canOpen && Number(form.openingQty) > 0 && !form.locationId) p.locationId = "Choose a warehouse"
    return p
  }
  const next = () => {
    const p = problems(current)
    setErrors(p)
    if (!Object.keys(p).length) setStep(at + 1)
  }

  async function save() {
    for (const [i, s] of steps.entries()) {
      const p = problems(s.key)
      if (Object.keys(p).length) {
        setErrors(p)
        return setStep(i)
      }
    }
    setBusy(true)
    setError(null)
    setErrors({})
    const stock = isProduct && canStock
    const opening = canOpen && Number(form.openingQty) > 0 ? { quantity: Number(form.openingQty), locationId: form.locationId } : undefined
    const body = {
      type: form.type,
      name: form.name,
      sku: form.sku.trim() || null,
      categoryId: form.categoryId || null,
      unit: form.unit,
      pricePaise: form.pricePaise,
      ...(canCost ? { costPricePaise: form.costPricePaise } : {}),
      gstRateBp: form.gstRateBp,
      hsnSac: form.hsnSac || null,
      durationMin: !isProduct && form.durationMin ? Number(form.durationMin) : null,
      description: form.description || null,
      imageUrl: form.imageUrl,
      ...(stock
        ? { trackStock: form.trackStock, reorderLevel: form.trackStock && form.reorderLevel !== "" ? Number(form.reorderLevel) : null, tracking: form.trackStock ? form.tracking : "none", altUnit: form.altUnit.trim() || null, altFactor: form.altUnit.trim() && form.altFactor ? Number(form.altFactor) : null, barcode: form.barcode.trim() || null }
        : !isProduct ? { trackStock: false } : {}),
      custom: form.custom,
    }
    try {
      const saved = item ? await api.patch<Item>(`/items/${item.id}`, { ...body, version: item.version }) : await api.post<Item>("/items", { ...body, ...(opening ? { opening } : {}) })
      toast.success(item ? "Item saved" : `${form.name} created`)
      router.push(`/app/m/catalog/${saved.id}`)
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields)
        const i = steps.findIndex((s) => Object.keys(e.fields).some((f) => STEP_FIELDS[s.key]?.includes(f)))
        if (i >= 0) setStep(i)
      }
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const skuFromName = () => set("sku", `${form.name.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "SKU"}-${String(Date.now()).slice(-6)}`)

  return (
    <>
      <PageHeader
        title={item ? `Edit ${item.name}` : copy ? "Copy item" : "Create Item"}
        description="A product or service you buy, sell or keep in stock. Prices exclude GST."
        actions={
          <>
            {item?.type === "product" && <a href={`/print/labels?ids=${item.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>Print labels</a>}
            {item?.type === "product" && can("catalog.item.create") && <Button variant="outline" onClick={() => setVariants(true)}>Make variants</Button>}
            <Link href={item ? `/app/m/catalog/${item.id}` : "/app/m/catalog"} className={buttonVariants({ variant: "outline" })}><ArrowLeft /> Back</Link>
          </>
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="ui-surface grid gap-5 p-5 sm:p-6">
          <Stepper steps={steps} at={at} open={(i) => !!item || i <= at} onPick={setStep} />

          {current === "basic" && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Item type">
                <NativeSelect value={form.type} disabled={!editable || !!item?.stockQty} onChange={(e) => { const t = e.target.value as Item["type"]; setEdits((x) => ({ ...x, type: t, unit: t === "service" ? "service" : form.unit === "service" ? "pcs" : form.unit })) }} aria-label="Item type">
                  <option value="product">Product</option>
                  <option value="service">Service</option>
                </NativeSelect>
              </Field>
              <Field label="Name" required error={errors.name}><Input value={form.name} onChange={(e) => set("name", e.target.value)} disabled={!editable} maxLength={160} placeholder={isProduct ? "e.g. Ceiling fan 48 inch, white" : "e.g. Fan installation"} autoFocus={!item} /></Field>
              <Field label="SKU" error={errors.sku}>
                <div className="flex gap-2">
                  <Input value={form.sku} onChange={(e) => set("sku", e.target.value)} disabled={!editable} maxLength={40} placeholder="e.g. FAN-48-WHT" />
                  <Button type="button" variant="outline" disabled={!editable} onClick={skuFromName}>Generate</Button>
                </div>
              </Field>
              <Field label="Category" error={errors.categoryId}><CategorySelect value={form.categoryId} onChange={(v) => set("categoryId", v)} disabled={!editable} aria-label="Category" /></Field>
              <Field label="GST rate" error={errors.gstRateBp} hint="Prices are entered before GST">
                <NativeSelect value={form.gstRateBp} onChange={(e) => set("gstRateBp", Number(e.target.value))} disabled={!editable} aria-label="GST rate">
                  {GST_RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}
                </NativeSelect>
              </Field>
              <Field label={isProduct ? "HSN code" : "SAC code"} error={errors.hsnSac} hint={isProduct ? "4, 6 or 8 digits; on every GST invoice" : "6 digits starting with 99"}><Input inputMode="numeric" value={form.hsnSac} onChange={(e) => set("hsnSac", e.target.value.replace(/\D/g, ""))} maxLength={8} disabled={!editable} placeholder={isProduct ? "e.g. 8414" : "e.g. 998719"} /></Field>
              <Field label="Description" className="md:col-span-2"><Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} disabled={!editable} maxLength={2000} placeholder="Size, colour, brand, warranty — printed under the name on bills" /></Field>
              <div className="md:col-span-2"><CustomFieldsForm fields={customFields} value={form.custom} onChange={(v) => set("custom", v)} errors={errors} disabled={!editable} /></div>
            </div>
          )}

          {current === "pricing" && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Sale price" required error={errors.pricePaise} hint="Per unit, before GST"><MoneyInput value={form.pricePaise} onChange={(v) => set("pricePaise", v)} disabled={!editable} aria-label="Sale price" /></Field>
              {canCost && <Field label="Purchase price" error={errors.costPricePaise} hint={form.costPricePaise && form.pricePaise ? (form.costPricePaise > form.pricePaise ? "Higher than the sale price: you lose on each sale" : `${Math.round(((form.pricePaise - form.costPricePaise) / form.pricePaise) * 100)}% margin`) : "What you pay the supplier, before GST"}><MoneyInput value={form.costPricePaise} onChange={(v) => set("costPricePaise", v)} disabled={!editable} aria-label="Purchase price" /></Field>}
              <Field label="Unit" required error={errors.unit}><UnitSelect value={form.unit} onChange={(v) => set("unit", v)} disabled={!editable} aria-label="Unit" /></Field>
              {!isProduct && <Field label="Duration (minutes)" hint="Used for bookings" error={errors.durationMin}><NumberStepper step={15} max={1440} suffix="min" value={form.durationMin} onChange={(v) => set("durationMin", v)} placeholder="e.g. 30" disabled={!editable} /></Field>}
            </div>
          )}

          {current === "image" && <Field label="Item image" hint="Optional" error={errors.imageUrl}><ImagePicker value={form.imageUrl} onChange={(v) => set("imageUrl", v)} disabled={!editable} /></Field>}

          {current === "stock" && (
            <div className="grid gap-4">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 size-4 accent-primary" checked={form.trackStock} disabled={!editable} onChange={(e) => set("trackStock", e.target.checked)} />
                <span><span className="font-medium">Track stock for this item</span><span className="block text-muted-foreground">{item?.trackStock ? `${item.stockQty ?? 0} ${item.unit} in stock now. ` : ""}Purchases bring stock in and sales take it out.</span></span>
              </label>
              {item?.trackStock && (
                <div className="rounded-2xl border p-3.5">
                  <p className="text-sm font-semibold">Where this item is</p>
                  {item.warehouses?.length ? (
                    <ul className="mt-2 divide-y text-sm">{item.warehouses.map((w) => <li key={w.id} className="flex justify-between py-1.5"><span>{w.name}</span><span className="font-medium tabular-nums">{w.quantity} {item.unit}</span></li>)}</ul>
                  ) : <p className="mt-1 text-sm text-muted-foreground">No stock in any warehouse yet. Use Add stock on the Items list.</p>}
                </div>
              )}
              {form.trackStock && (
                <div className="grid gap-4 md:grid-cols-2">
                  {canOpen && (
                    <>
                      <Field label="Quantity in stock today" hint="Leave empty if none" error={errors.opening}><NumberStepper decimals value={form.openingQty} onChange={(v) => set("openingQty", v)} suffix={form.unit} placeholder="0" /></Field>
                      <Field label="Warehouse" hint="Where this stock is kept" required={Number(form.openingQty) > 0} error={errors.locationId}><WarehouseSelect value={form.locationId} onChange={(v) => set("locationId", v)} aria-label="Warehouse" aria-invalid={!!errors.locationId} /></Field>
                    </>
                  )}
                  <Field label="Low stock level" hint="Alert at or below this" error={errors.reorderLevel}><NumberStepper decimals value={form.reorderLevel} onChange={(v) => set("reorderLevel", v)} suffix={form.unit} placeholder="e.g. 5" disabled={!editable} /></Field>
                  <Field label="Track by" hint={item?.stockQty ? "Can change only when stock is zero" : form.tracking === "none" ? undefined : "Add this item's stock later, with its batch or serial numbers"} error={errors.tracking}>
                    <NativeSelect value={form.tracking} onChange={(e) => set("tracking", e.target.value as Form["tracking"])} disabled={!editable || !!item?.stockQty} aria-label="Track by">
                      <option value="none">Quantity only</option>
                      <option value="batch">Batch and expiry</option>
                      <option value="serial">Serial / IMEI number</option>
                    </NativeSelect>
                  </Field>
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Barcode" hint="Scan into bills; printed on labels" error={errors.barcode}><Input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} maxLength={48} disabled={!editable} placeholder="Scan it or type the number" /></Field>
                <div className="grid grid-cols-[1fr_8rem] gap-2">
                  <Field label="Second unit" hint="e.g. box, carton" error={errors.altUnit}><Input value={form.altUnit} onChange={(e) => set("altUnit", e.target.value)} maxLength={20} disabled={!editable} placeholder="e.g. box" /></Field>
                  <Field label={`${form.unit} in one`} error={errors.altFactor}><NumberStepper decimals min={0} value={form.altFactor} onChange={(v) => set("altFactor", v)} suffix={form.unit} placeholder="e.g. 12" disabled={!editable || !form.altUnit.trim()} /></Field>
                </div>
              </div>
            </div>
          )}

          <FormError message={error} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-5">
            {at > 0 ? <Button type="button" variant="outline" onClick={() => setStep(at - 1)}><ChevronLeft /> Previous</Button> : <span />}
            <div className="flex gap-2">
              {item && !last && editable && <Button type="button" variant="outline" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>}
              {!last ? <Button type="button" onClick={next}>Next <ChevronRight /></Button> : editable && <Button type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : item ? "Save changes" : "Create item"}</Button>}
            </div>
          </div>
        </section>
        <Preview form={form} category={category} />
      </div>
      {variants && item && <VariantsDialog item={item} onClose={() => setVariants(false)} />}
    </>
  )
}
