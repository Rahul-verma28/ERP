"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, CalendarDays, Package, Trash2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell"
import { MoneyInput, Spinner } from "@/components/common"
import { WarehouseSelect } from "@/components/creatable-select"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ItemPicker, SupplierPicker, type ContactOption, type ItemOption } from "@/components/pickers"
import { PurchaseReturnForm } from "@/components/purchase-return-form"
import { parseSerials } from "@/components/stock-line"
import { NumberStepper } from "@/components/number-stepper"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { qty, type StockLocation, type Tracking } from "@/lib/inventory"
import { KIND_LABEL, KIND_PATH, type PurchaseDoc, type PurchaseKind } from "@/lib/purchase"
import { useApi } from "@/lib/use-api"
import { todayInIndia } from "@contracts/validation"

// One screen for a purchase invoice, order or goods receipt: details and items on the left, the
// money on the right. A receipt or invoice can start from an order, an invoice from a receipt; the
// lines come over with what is left. Returns have their own form.

type FormKind = Exclude<PurchaseKind, "purchase_return">
const RATES = [0, 25, 300, 500, 1200, 1800, 2800]
const PERM: Record<FormKind, string> = { purchase_order: "inventory.purchase_order.create", goods_receipt: "inventory.receipt.create", purchase_bill: "inventory.supplier_bill.create" }
const HINT: Record<FormKind, string> = {
  purchase_order: "What you are ordering, at what price. Nothing moves in stock until goods come.",
  goods_receipt: "Goods that arrived. Stock comes in now; the invoice can follow.",
  purchase_bill: "The supplier's invoice. Save it as a draft, or post it to bring the stock in.",
}

type Line = {
  key: string
  itemId: string | null
  description: string
  hsnSac: string | null
  unit: string
  baseUnit: string
  altUnit: string | null
  altFactor: number | null
  tracking: Tracking
  isProduct: boolean
  quantity: string
  /** Most that can be taken from the source line */
  max: number | null
  unitPricePaise: number | null
  discountPct: string
  gstRateBp: number
  sourceLineId: string | null
  batchNo: string
  mfgDate: string
  expiryDate: string
  serialText: string
}

const lineQty = (l: Line) => (l.tracking === "serial" && l.isProduct ? parseSerials(l.serialText).length || Number(l.quantity) || 0 : Number(l.quantity) || 0)
const gross = (l: Line) => Math.round(lineQty(l) * (l.unitPricePaise ?? 0))
const discount = (l: Line) => Math.min(gross(l), Math.round((gross(l) * (Number(l.discountPct) || 0)) / 100))
const taxableOf = (l: Line) => gross(l) - discount(l)

function PurchaseForm({ kind, editId, fromId, supplierId }: { kind: FormKind; editId: string | null; fromId: string | null; supplierId: string | null }) {
  const router = useRouter()
  const { can } = useAuth()
  const locations = useApi<{ data: StockLocation[] }>("/stock-locations")
  const source = useApi<PurchaseDoc>(fromId ? `/purchases/${fromId}` : editId ? `/purchases/${editId}` : null)
  const [supplier, setSupplier] = React.useState<ContactOption | null>(null)
  const [issueDate, setIssueDate] = React.useState(todayInIndia())
  const [dueDate, setDueDate] = React.useState("")
  const [supplierRef, setSupplierRef] = React.useState("")
  const [locationId, setLocationId] = React.useState("")
  const [reverseCharge, setReverseCharge] = React.useState(false)
  const [chargesPaise, setChargesPaise] = React.useState<number | null>(null)
  const [chargesGstBp, setChargesGstBp] = React.useState(1800)
  const [showMore, setShowMore] = React.useState(false)
  const [notes, setNotes] = React.useState("")
  const [lines, setLines] = React.useState<Line[]>([])
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const loaded = React.useRef(false)

  // Started from a supplier's page or row: that supplier is already chosen
  React.useEffect(() => {
    if (!supplierId || fromId || editId) return
    api.get<{ id: string; name: string; companyName: string | null; gstin: string | null; phone: string | null }>(`/suppliers/${supplierId}`).then((s) => setSupplier({ id: s.id, name: s.companyName || s.name, gstin: s.gstin, phone: s.phone })).catch(() => undefined)
  }, [supplierId, fromId, editId])

  // Lines and supplier from the source document (or the draft or order being edited)
  React.useEffect(() => {
    const s = source.data
    if (!s || loaded.current) return
    loaded.current = true
    const ids = [...new Set(s.lines.map((l) => l.itemId).filter(Boolean))] as string[]
    Promise.all(ids.map((id) => api.get<ItemOption & { tracking?: Tracking; altUnit?: string | null; altFactor?: number | null }>(`/items/${id}`).catch(() => null))).then((items) => {
      setSupplier({ id: s.contactId, name: s.supplier.name, gstin: s.supplier.gstin, phone: s.supplier.phone })
      setReverseCharge(s.reverseCharge)
      if (s.locationId) setLocationId(s.locationId)
      if (editId) {
        setIssueDate(s.issueDate.slice(0, 10))
        setDueDate(s.dueDate?.slice(0, 10) ?? "")
        setNotes(s.notes ?? "")
        setChargesPaise(s.chargesPaise || null)
        setChargesGstBp(s.chargesGstBp)
        setSupplierRef(s.supplierRef ?? "")
        setShowMore(s.chargesPaise > 0 || s.reverseCharge)
      }
      if (kind === "purchase_bill" && s.kind === "goods_receipt" && s.supplierRef) setSupplierRef(s.supplierRef)
      const byId = new Map(items.filter(Boolean).map((i) => [i!.id, i!]))
      setLines(s.lines.flatMap((l) => {
        const left = editId ? l.quantity : Math.max(0, l.quantity - l.doneQuantity)
        if (!editId && left <= 0) return []
        const it = l.itemId ? byId.get(l.itemId) : undefined
        const base = l.quantity * l.unitPricePaise
        return [{
          key: l.id, itemId: l.itemId, description: l.description, hsnSac: l.hsnSac, unit: l.unit, baseUnit: it?.unit ?? l.unit, altUnit: it?.altUnit ?? null, altFactor: it?.altFactor ?? null,
          tracking: it?.tracking ?? "none", isProduct: it?.type === "product", quantity: String(left), max: editId ? null : left, unitPricePaise: l.unitPricePaise,
          discountPct: l.discountPaise && base ? String(Math.round((l.discountPaise / base) * 10_000) / 100) : "", gstRateBp: l.gstRateBp, sourceLineId: editId ? (kind === "purchase_order" ? null : l.sourceLineId) : l.id,
          batchNo: l.batchNo ?? "", mfgDate: l.mfgDate?.slice(0, 10) ?? "", expiryDate: l.expiryDate?.slice(0, 10) ?? "", serialText: l.serials.join(", "),
        }]
      }))
    })
  }, [source.data, editId, kind])

  if (!can(editId && kind === "purchase_order" ? "inventory.purchase_order.edit" : PERM[kind])) return <PageHeader title={KIND_LABEL[kind]} description="You don't have access to this. Ask your admin." />
  if (!locations.data || ((fromId || editId) && !source.data)) return <div className="grid place-items-center py-24"><Spinner /></div>

  const fromDoc = fromId ? source.data : null
  const invoice = kind === "purchase_bill"
  const madeFrom = fromDoc?.kind ?? (editId ? source.data?.sourceType : null)
  const stockIn = kind === "goods_receipt" || (invoice && madeFrom !== "goods_receipt")
  const active = locations.data.data.filter((l) => l.isActive)
  const warehouse = locationId || active.find((g) => g.isDefault)?.id || active[0]?.id || ""
  const backHref = fromDoc ? `/app/m/purchase/${fromDoc.id}` : KIND_PATH[kind]

  const pick = (picked: ItemOption) => {
    const it = picked as ItemOption & { tracking?: Tracking; altUnit?: string | null; altFactor?: number | null }
    setLines((ls) => [...ls, {
      key: `${it.id}-${Date.now()}`, itemId: it.id, description: it.name, hsnSac: it.hsnSac, unit: it.unit, baseUnit: it.unit, altUnit: it.altUnit ?? null, altFactor: it.altFactor ?? null,
      tracking: it.tracking ?? "none", isProduct: it.type === "product", quantity: "1", max: null, unitPricePaise: it.costPricePaise ?? null, discountPct: "", gstRateBp: it.gstRateBp,
      sourceLineId: null, batchNo: "", mfgDate: "", expiryDate: "", serialText: "",
    }])
  }
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const used = lines.filter((l) => lineQty(l) > 0)
  const itemsValue = used.reduce((s, l) => s + gross(l), 0)
  const discountValue = used.reduce((s, l) => s + discount(l), 0)
  const charges = chargesPaise ?? 0
  const taxable = itemsValue - discountValue + charges
  const lineTax = used.reduce((s, l) => s + Math.round((taxableOf(l) * l.gstRateBp) / 10_000), 0) + Math.round((charges * chargesGstBp) / 10_000)
  const tax = supplier?.gstin || reverseCharge ? lineTax : 0
  const total = Math.round((taxable + (reverseCharge ? 0 : tax)) / 100) * 100

  async function save(draft = false) {
    const errs: Record<string, string> = {}
    if (!supplier) errs.contactId = "Choose a supplier"
    if (!used.length) errs.lines = "Add at least one item"
    lines.forEach((l, i) => {
      const n = lineQty(l)
      if (!(n > 0)) errs[`lines.${i}.quantity`] = "More than 0"
      if (l.max !== null && n > l.max) errs[`lines.${i}.quantity`] = `At most ${qty(l.max)}`
      if (l.unitPricePaise === null) errs[`lines.${i}.unitPricePaise`] = "Enter the price"
      if (!draft && stockIn && l.isProduct && l.tracking === "batch" && !l.batchNo.trim()) errs[`lines.${i}.batchNo`] = "Enter the batch"
    })
    if (invoice && !draft && !supplierRef.trim()) errs.supplierRef = "Enter the supplier's invoice number"
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    const body = {
      contactId: supplier!.id, issueDate, dueDate: dueDate || null, supplierRef: supplierRef.trim() || null, supplierDate: supplierRef.trim() ? issueDate : null,
      locationId: warehouse || null, reverseCharge, chargesPaise: charges, chargesGstBp, roundOff: true, notes: notes.trim() || null,
      sourceId: fromId, lines: lines.map((l) => ({
        itemId: l.itemId, description: l.description, hsnSac: l.hsnSac, unit: l.unit, quantity: lineQty(l), unitPricePaise: l.unitPricePaise ?? 0, discountPaise: discount(l), gstRateBp: l.gstRateBp, sourceLineId: l.sourceLineId,
        ...(l.isProduct && l.tracking === "batch" && kind !== "purchase_order" ? { batchNo: l.batchNo.trim() || null, mfgDate: l.mfgDate || null, expiryDate: l.expiryDate || null } : {}),
        ...(l.isProduct && l.tracking === "serial" && kind !== "purchase_order" ? { serials: parseSerials(l.serialText) } : {}),
      })),
    }
    try {
      const doc = editId && invoice
        ? await api.put<PurchaseDoc>(`/purchases/${editId}/draft`, { ...body, sourceId: null, version: source.data!.version, post: !draft })
        : editId
          ? await api.put<PurchaseDoc>(`/purchases/${editId}`, { ...body, sourceId: null, version: source.data!.version })
          : await api.post<PurchaseDoc>("/purchases", { kind, ...body, ...(invoice ? { draft } : {}) })
      toast.success(invoice ? `${doc.number} ${draft ? "saved as draft" : "posted"}` : `${KIND_LABEL[kind]} ${doc.number} saved`)
      router.push(`/app/m/purchase/${doc.id}`)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const dateLabel = { purchase_order: "Order date", goods_receipt: "Received on", purchase_bill: "Invoice date" }[kind]
  const cardTitle = "flex items-center gap-2.5 border-b px-5 py-4 font-semibold"
  const title = editId ? `Edit ${source.data?.number}` : fromDoc ? `${KIND_LABEL[kind]} from ${fromDoc.number}` : `Create ${KIND_LABEL[kind]}`
  return (
    <>
      <PageHeader title={title} description={HINT[kind]} actions={<Link href={backHref} className={buttonVariants({ variant: "outline" })}><ArrowLeft /> Back</Link>} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5">
          <section className="ui-surface overflow-hidden">
            <h2 className={cardTitle}><CalendarDays className="size-4 text-primary" aria-hidden /> {KIND_LABEL[kind]} Details</h2>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label={dateLabel} required error={errors.issueDate}><Input type="date" value={issueDate} max={todayInIndia()} onChange={(e) => setIssueDate(e.target.value)} /></Field>
              {kind !== "goods_receipt" && <Field label={invoice ? "Due date" : "Expected by"} hint={invoice ? "Empty: from the supplier's payment days" : undefined} error={errors.dueDate}><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
              <Field label="Supplier" required error={errors.contactId}>
                {fromDoc || editId ? <Input value={supplier?.name ?? ""} readOnly aria-label="Supplier" /> : <SupplierPicker value={supplier} onChange={setSupplier} />}
              </Field>
              <Field label={kind === "purchase_order" ? "Deliver to" : "Warehouse"} required error={errors.locationId}><WarehouseSelect value={warehouse} onChange={setLocationId} aria-label="Warehouse" /></Field>
              {kind !== "purchase_order" && <Field label={invoice ? "Supplier invoice no." : "Challan no."} required={invoice} error={errors.supplierRef}><Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} maxLength={40} placeholder={invoice ? "Printed on the supplier's bill" : undefined} /></Field>}
              <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} placeholder="Additional notes" /></Field>
            </div>
            {fromDoc?.kind === "goods_receipt" && <p className="mx-5 mb-5 rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">Stock already came in on {fromDoc.number}. This invoice only records what you owe.</p>}
            {supplier && !supplier.gstin && !reverseCharge && <p className="mx-5 mb-5 rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">This supplier has no GSTIN, so no GST is charged on this purchase.</p>}
          </section>

          <section className="ui-surface overflow-hidden">
            <h2 className={cardTitle}><Package className="size-4 text-primary" aria-hidden /> {KIND_LABEL[kind]} Items</h2>
            {lines.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/50 text-left text-[13px]">
                    <tr><th className="py-3 pr-3 pl-5 font-semibold">Product</th><th className="w-28 px-2 font-semibold">Qty</th><th className="w-36 px-2 font-semibold">Unit price</th><th className="w-28 px-2 font-semibold">Discount %</th><th className="w-28 px-2 font-semibold">GST</th><th className="w-28 px-2 text-right font-semibold">Total</th><th className="w-12 pr-3" /></tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const serial = l.isProduct && l.tracking === "serial" && kind !== "purchase_order"
                      const batch = l.isProduct && l.tracking === "batch" && stockIn
                      return (
                        <React.Fragment key={l.key}>
                          <tr className="border-t align-top">
                            <td className="py-2.5 pr-3 pl-5">
                              <span className="font-medium">{l.description}</span>
                              <span className="block text-xs text-muted-foreground">{l.max !== null ? `${qty(l.max)} ${l.unit} left` : l.isProduct ? l.unit : "Service"}{l.hsnSac ? ` · HSN ${l.hsnSac}` : ""}</span>
                              {!l.sourceLineId && l.altUnit && l.altFactor && (
                                <NativeSelect className="mt-1 h-8 w-40 text-xs" value={l.unit} onChange={(e) => update(i, { unit: e.target.value })} aria-label={`Unit of ${l.description}`}>
                                  <option value={l.baseUnit}>{l.baseUnit}</option>
                                  <option value={l.altUnit}>{l.altUnit} ({l.altFactor} {l.baseUnit})</option>
                                </NativeSelect>
                              )}
                            </td>
                            <td className="px-2 py-2"><NumberStepper decimals size="sm" value={serial ? String(parseSerials(l.serialText).length) : l.quantity} disabled={serial} title={serial ? "Counted from the serial numbers" : undefined} onChange={(v) => update(i, { quantity: v })} aria-label={`Quantity of ${l.description}`} aria-invalid={!!errors[`lines.${i}.quantity`]} />{errors[`lines.${i}.quantity`] && <p className="mt-1 text-xs text-destructive">{errors[`lines.${i}.quantity`]}</p>}</td>
                            <td className="px-2 py-2"><MoneyInput value={l.unitPricePaise} onChange={(v) => update(i, { unitPricePaise: v })} aria-label={`Price of ${l.description}`} />{errors[`lines.${i}.unitPricePaise`] && <p className="mt-1 text-xs text-destructive">{errors[`lines.${i}.unitPricePaise`]}</p>}</td>
                            <td className="px-2 py-2"><NumberStepper decimals size="sm" max={100} value={l.discountPct} onChange={(v) => update(i, { discountPct: v })} placeholder="0" aria-label={`Discount percent on ${l.description}`} /></td>
                            <td className="px-2 py-2"><NativeSelect className="h-9" value={String(l.gstRateBp)} onChange={(e) => update(i, { gstRateBp: Number(e.target.value) })} aria-label={`GST rate of ${l.description}`}>{RATES.map((r) => <option key={r} value={r}>{r / 100}%</option>)}</NativeSelect></td>
                            <td className="px-2 py-3 text-right font-medium tabular-nums">{formatPaise(taxableOf(l))}</td>
                            <td className="py-2 pr-3 text-right">{!l.sourceLineId && <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove ${l.description}`}><Trash2 /></Button>}</td>
                          </tr>
                          {(serial || batch) && (
                            <tr>
                              <td colSpan={7} className="px-5 pb-3">
                                {serial ? (
                                  <Field label="Serial numbers" error={errors[`lines.${i}.serials`]}><Input value={l.serialText} onChange={(e) => update(i, { serialText: e.target.value })} placeholder="One per piece, comma separated" aria-label={`Serial numbers of ${l.description}`} /></Field>
                                ) : (
                                  <div className="grid gap-3 sm:grid-cols-3">
                                    <Field label="Batch" required error={errors[`lines.${i}.batchNo`]}><Input value={l.batchNo} onChange={(e) => update(i, { batchNo: e.target.value })} maxLength={40} aria-label={`Batch of ${l.description}`} /></Field>
                                    <Field label="Mfg date"><Input type="date" value={l.mfgDate} onChange={(e) => update(i, { mfgDate: e.target.value })} aria-label={`Manufactured on, ${l.description}`} /></Field>
                                    <Field label="Expiry"><Input type="date" value={l.expiryDate} onChange={(e) => update(i, { expiryDate: e.target.value })} aria-label={`Expiry of ${l.description}`} /></Field>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid gap-2 border-t p-5">
              {madeFrom !== "goods_receipt" && <ItemPicker onPick={pick} allowCreate price="cost" locationId={warehouse} />}
              {errors.lines && <p className="text-xs text-destructive">{errors.lines}</p>}
              <button type="button" className="w-fit text-[13px] font-medium text-primary hover:underline" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>{showMore ? "Hide freight and reverse charge" : "Add freight or reverse charge"}</button>
              {showMore && (
                <div className="grid gap-4 pt-2 md:grid-cols-2">
                  <Field label="Freight and other charges" hint={stockIn ? "Added to the cost of the goods" : "Not added to stock cost"}><MoneyInput value={chargesPaise} onChange={setChargesPaise} aria-label="Freight and other charges" /></Field>
                  <Field label="GST on charges"><NativeSelect value={String(chargesGstBp)} onChange={(e) => setChargesGstBp(Number(e.target.value))} aria-label="GST on charges">{RATES.map((r) => <option key={r} value={r}>{r / 100}%</option>)}</NativeSelect></Field>
                  {kind !== "goods_receipt" && (
                    <label className="flex items-start gap-2 text-sm md:col-span-2">
                      <input type="checkbox" className="mt-1 size-4 accent-primary" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} />
                      <span><span className="font-medium">Reverse charge</span><span className="block text-muted-foreground">You pay the GST to the government, not to the supplier.</span></span>
                    </label>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="grid gap-5 xl:sticky xl:top-20">
          <section className="ui-surface grid gap-2 p-5 text-sm">
            <h2 className="mb-1 font-semibold">Summary</h2>
            <p className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatPaise(itemsValue)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="text-destructive tabular-nums">−{formatPaise(discountValue)}</span></p>
            {charges > 0 && <p className="flex justify-between"><span className="text-muted-foreground">Freight</span><span className="tabular-nums">{formatPaise(charges)}</span></p>}
            <p className="flex justify-between"><span className="text-muted-foreground">GST{reverseCharge ? " (you pay)" : ""}</span><span className="tabular-nums">{formatPaise(tax)}</span></p>
            <p className="flex items-center justify-between border-t pt-2 font-semibold"><span>{reverseCharge ? "To supplier" : "Total"}</span><span className="text-xl text-primary tabular-nums">{formatPaise(total)}</span></p>
          </section>
          <section className="ui-surface grid gap-2 p-5">
            <FormError message={error} />
            <Button disabled={busy} onClick={() => save()}>{busy ? "Saving…" : invoice ? "Save and post" : `Save ${KIND_LABEL[kind].toLowerCase()}`}</Button>
            {invoice && <Button variant="outline" disabled={busy} onClick={() => save(true)}>Save as draft</Button>}
            <Link href={backHref} className={buttonVariants({ variant: "ghost" })}>Cancel</Link>
          </section>
        </aside>
      </div>
    </>
  )
}

function Keyed() {
  const params = useSearchParams()
  const editId = params.get("edit")
  const fromId = params.get("from")
  const kind = params.get("kind") ?? "purchase_bill"
  if (kind === "purchase_return") return <PurchaseReturnForm key={`${fromId}-${editId}`} fromId={fromId} editId={editId} />
  const formKind = (["purchase_order", "goods_receipt"].includes(kind) ? kind : "purchase_bill") as FormKind
  return <PurchaseForm key={`${formKind}-${fromId}-${editId}`} kind={formKind} editId={editId} fromId={fromId} supplierId={params.get("supplier")} />
}

export default function NewPurchasePage() {
  return (
    <React.Suspense>
      <Keyed />
    </React.Suspense>
  )
}
