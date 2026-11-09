"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { MoneyInput, Spinner } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { SearchSelect } from "@/components/search-select"
import { ItemPicker, SupplierPicker, type ContactOption, type ItemOption } from "@/components/pickers"
import { parseSerials } from "@/components/stock-line"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import { qty, type StockLocation, type Tracking } from "@/lib/inventory"
import { KIND_LABEL, KIND_PATH, RETURN_REASONS, type PurchaseDoc, type PurchaseKind } from "@/lib/purchase"
import { todayInIndia } from "@contracts/validation"

// One form for a purchase order, goods receipt, purchase bill or purchase return. A GRN or bill can
// start from an order, a bill from a GRN, and a return from a bill: the lines come over with what is
// left, and the server refuses more than that.

const RATES = [0, 25, 300, 500, 1200, 1800, 2800]
const KINDS: PurchaseKind[] = ["purchase_order", "goods_receipt", "purchase_bill", "purchase_return"]
const PERM: Record<PurchaseKind, string> = { purchase_order: "inventory.purchase_order.create", goods_receipt: "inventory.receipt.create", purchase_bill: "inventory.supplier_bill.create", purchase_return: "inventory.supplier_bill.create" }
const HINT: Record<PurchaseKind, string> = {
  purchase_order: "What you are ordering, at what price. Nothing moves in stock until goods come.",
  goods_receipt: "Goods that arrived. Stock comes in now; the bill can follow.",
  purchase_bill: "The supplier's invoice. Save it as a draft, or post it to bring the stock in.",
  purchase_return: "Enter what goes back. Stock and what you owe change when the return is completed.",
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
  discountPaise: number | null
  gstRateBp: number
  sourceLineId: string | null
  batchNo: string
  mfgDate: string
  expiryDate: string
  serialText: string
}

const lineQty = (l: Line) => (l.tracking === "serial" && l.isProduct ? parseSerials(l.serialText).length || Number(l.quantity) || 0 : Number(l.quantity) || 0)

function PurchaseForm() {
  const router = useRouter()
  const params = useSearchParams()
  const editId = params.get("edit")
  const fromId = params.get("from")
  const kind = (KINDS.includes(params.get("kind") as PurchaseKind) ? params.get("kind") : "purchase_bill") as PurchaseKind
  const { can } = useAuth()
  const locations = useApi<{ data: StockLocation[] }>("/stock-locations")
  const source = useApi<PurchaseDoc>(fromId ? `/purchases/${fromId}` : editId ? `/purchases/${editId}` : null)
  const godowns = (locations.data?.data ?? []).filter((l) => l.isActive)

  const [supplier, setSupplier] = React.useState<ContactOption | null>(null)
  const [issueDate, setIssueDate] = React.useState(todayInIndia())
  const [dueDate, setDueDate] = React.useState("")
  const [supplierRef, setSupplierRef] = React.useState("")
  const [supplierDate, setSupplierDate] = React.useState("")
  const [locationId, setLocationId] = React.useState("")
  const [reverseCharge, setReverseCharge] = React.useState(false)
  const [chargesPaise, setChargesPaise] = React.useState<number | null>(null)
  const [chargesGstBp, setChargesGstBp] = React.useState(1800)
  const [notes, setNotes] = React.useState("")
  const [returnReason, setReturnReason] = React.useState("")
  const invoices = useApi<{ data: PurchaseDoc[] }>(kind === "purchase_return" && !fromId && !editId ? "/purchases?kind=purchase_bill&limit=200" : null)
  const [lines, setLines] = React.useState<Line[]>([])
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const loaded = React.useRef(false)

  // Lines and supplier from the source document (or the order being edited)
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
        setSupplierDate(s.supplierDate?.slice(0, 10) ?? "")
        setReturnReason(s.returnReason ?? "")
      }
      if (kind === "purchase_bill" && s.kind === "goods_receipt" && s.supplierRef) setSupplierRef(s.supplierRef)
      const byId = new Map(items.filter(Boolean).map((i) => [i!.id, i!]))
      setLines(s.lines.flatMap((l) => {
        const left = editId ? l.quantity : Math.max(0, l.quantity - l.doneQuantity)
        if (!editId && left <= 0) return []
        const it = l.itemId ? byId.get(l.itemId) : undefined
        return [{
          key: l.id, itemId: l.itemId, description: l.description, hsnSac: l.hsnSac, unit: l.unit, baseUnit: it?.unit ?? l.unit, altUnit: it?.altUnit ?? null, altFactor: it?.altFactor ?? null,
          tracking: it?.tracking ?? "none", isProduct: it?.type === "product", quantity: kind === "purchase_return" && !editId ? "" : String(left), max: editId ? null : left,
          unitPricePaise: l.unitPricePaise, discountPaise: kind === "purchase_return" ? 0 : Math.round((l.discountPaise * left) / (l.quantity || 1)), gstRateBp: l.gstRateBp, sourceLineId: editId ? (kind === "purchase_order" ? null : l.sourceLineId) : l.id,
          batchNo: l.batchNo ?? "", mfgDate: l.mfgDate?.slice(0, 10) ?? "", expiryDate: l.expiryDate?.slice(0, 10) ?? "", serialText: kind === "purchase_return" && !editId ? "" : l.serials.join(", "),
        }]
      }))
    })
  }, [source.data, editId, kind])

  if (!can(editId && kind === "purchase_order" ? "inventory.purchase_order.edit" : PERM[kind])) return <PageHeader title={KIND_LABEL[kind]} description="You don't have access to this. Ask your admin." />
  if (!locations.data || ((fromId || editId) && !source.data)) return <div className="grid place-items-center py-24"><Spinner /></div>

  const fromDoc = fromId ? source.data : null
  const isReturn = kind === "purchase_return"
  // A return starts from an invoice; choosing one reloads the form with its items
  if (isReturn && !fromId && !editId) {
    const options = (invoices.data?.data ?? []).filter((d) => ["unpaid", "part_paid", "paid"].includes(d.status)).map((d) => ({ value: d.id, label: `${d.number} - ${d.supplier.name}`, keywords: d.supplierRef ?? undefined }))
    return (
      <>
        <Link href={KIND_PATH[kind]} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back</Link>
        <PageHeader title="Create purchase return" description="Choose the invoice the goods go back against." />
        <Card><CardContent>
          {invoices.error ? <FormError message={errorMessage(invoices.error)} /> : !invoices.data ? <Spinner /> : (
            <Field label="Original invoice" required hint={options.length ? undefined : "Post an invoice first. Only posted invoices can have returns."}>
              <SearchSelect value="" onChange={(id) => router.replace(`/app/m/purchase/new?kind=purchase_return&from=${id}`)} options={options} placeholder="Select invoice" searchable aria-label="Original invoice" />
            </Field>
          )}
        </CardContent></Card>
      </>
    )
  }
  const madeFrom = fromDoc?.kind ?? (editId ? source.data?.sourceType : null)
  const nothingLeft = isReturn && !editId && !!source.data && source.data.lines.every((l) => l.quantity - l.doneQuantity <= 0)
  const stockIn = kind === "goods_receipt" || (kind === "purchase_bill" && madeFrom !== "goods_receipt")
  const godown = locationId || godowns.find((g) => g.isDefault)?.id || godowns[0]?.id || ""

  const pick = (picked: ItemOption) => {
    const it = picked as ItemOption & { tracking?: Tracking; altUnit?: string | null; altFactor?: number | null }
    setLines((ls) => [...ls, {
      key: `${it.id}-${Date.now()}`, itemId: it.id, description: it.name, hsnSac: it.hsnSac, unit: it.unit, baseUnit: it.unit, altUnit: it.altUnit ?? null, altFactor: it.altFactor ?? null,
      tracking: it.tracking ?? "none", isProduct: it.type === "product", quantity: "", max: null, unitPricePaise: it.costPricePaise ?? null, discountPaise: null, gstRateBp: it.gstRateBp,
      sourceLineId: null, batchNo: "", mfgDate: "", expiryDate: "", serialText: "",
    }])
  }
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const used = lines.filter((l) => lineQty(l) > 0)
  const taxable = used.reduce((s, l) => s + Math.max(0, Math.round(lineQty(l) * (l.unitPricePaise ?? 0)) - (l.discountPaise ?? 0)), 0) + (isReturn ? 0 : chargesPaise ?? 0)
  const tax = supplier?.gstin || reverseCharge ? used.reduce((s, l) => s + Math.round(((Math.round(lineQty(l) * (l.unitPricePaise ?? 0)) - (l.discountPaise ?? 0)) * l.gstRateBp) / 10_000), 0) + (isReturn ? 0 : Math.round(((chargesPaise ?? 0) * chargesGstBp) / 10_000)) : 0

  async function save(draft = false) {
    const errs: Record<string, string> = {}
    if (!supplier) errs.contactId = "Choose a supplier"
    if (!used.length) errs.lines = isReturn ? "Enter what goes back" : "Add at least one item"
    lines.forEach((l, i) => {
      const n = lineQty(l)
      if (!isReturn && !(n > 0)) errs[`lines.${i}.quantity`] = "Enter more than 0"
      if (l.max !== null && n > l.max) errs[`lines.${i}.quantity`] = `At most ${qty(l.max)}`
      if (!isReturn && l.unitPricePaise === null) errs[`lines.${i}.unitPricePaise`] = "Enter the price"
      if (!draft && stockIn && l.isProduct && l.tracking === "batch" && !l.batchNo.trim()) errs[`lines.${i}.batchNo`] = "Enter the batch"
    })
    if (isReturn && !returnReason) errs.returnReason = "Choose a reason"
    if (kind === "purchase_bill" && !draft && !supplierRef.trim()) errs.supplierRef = "Enter the supplier's invoice number"
    if (kind === "purchase_bill" && !draft && !supplierDate) errs.supplierDate = "Enter the invoice date"
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    const body = {
      contactId: supplier!.id, issueDate, dueDate: dueDate || null, supplierRef: supplierRef.trim() || null, supplierDate: supplierDate || null,
      locationId: isReturn ? null : godown || null, reverseCharge, chargesPaise: isReturn ? 0 : chargesPaise ?? 0, chargesGstBp, roundOff: true, notes: notes.trim() || null, ...(isReturn ? { returnReason } : {}),
      sourceId: fromId, lines: lines.filter((l) => !isReturn || lineQty(l) > 0).map((l) => ({
        itemId: l.itemId, description: l.description, hsnSac: l.hsnSac, unit: l.unit, quantity: lineQty(l), unitPricePaise: l.unitPricePaise ?? 0, discountPaise: l.discountPaise ?? 0,
        gstRateBp: l.gstRateBp, sourceLineId: l.sourceLineId,
        ...(l.isProduct && l.tracking === "batch" && kind !== "purchase_order" ? { batchNo: l.batchNo.trim() || null, mfgDate: l.mfgDate || null, expiryDate: l.expiryDate || null } : {}),
        ...(l.isProduct && l.tracking === "serial" && kind !== "purchase_order" ? { serials: parseSerials(l.serialText) } : {}),
      })),
    }
    try {
      const doc = editId && (kind === "purchase_bill" || isReturn)
        ? await api.put<PurchaseDoc>(`/purchases/${editId}/draft`, { ...body, sourceId: null, version: source.data!.version, post: !draft })
        : editId
          ? await api.put<PurchaseDoc>(`/purchases/${editId}`, { ...body, sourceId: null, version: source.data!.version })
          : await api.post<PurchaseDoc>("/purchases", { kind, ...body, ...(kind === "purchase_bill" || isReturn ? { draft } : {}) })
      toast.success(kind === "purchase_bill" ? `${doc.number} ${draft ? "saved as draft" : "posted"}` : isReturn ? `${doc.number} saved as draft` : `${KIND_LABEL[kind]} ${doc.number} saved`)
      router.push(`/app/m/purchase/${doc.id}`)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const dateLabel = { purchase_order: "Order date", goods_receipt: "Received on", purchase_bill: "Goods received on", purchase_return: "Return date" }[kind]
  const invoice = kind === "purchase_bill"
  return (
    <>
      <Link href={fromDoc ? `/app/m/purchase/${fromDoc.id}` : KIND_PATH[kind]} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {fromDoc ? fromDoc.number : "Back"}</Link>
      <PageHeader title={editId ? `Edit ${source.data?.number}` : fromDoc ? `${KIND_LABEL[kind]} from ${fromDoc.number}` : `New ${KIND_LABEL[kind].toLowerCase()}`} description={HINT[kind]} />
      <Card>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Supplier" required error={errors.contactId} className="sm:col-span-2">
              {fromDoc || editId ? <Input value={supplier?.name ?? ""} readOnly aria-label="Supplier" /> : <SupplierPicker value={supplier} onChange={setSupplier} />}
            </Field>
            <Field label={dateLabel} error={errors.issueDate}><Input type="date" value={issueDate} max={todayInIndia()} onChange={(e) => setIssueDate(e.target.value)} /></Field>
            {(kind === "purchase_order" || kind === "purchase_bill") && (
              <Field label={kind === "purchase_order" ? "Expected by" : "Due date"} hint={kind === "purchase_bill" ? "Empty: from the supplier's payment days" : undefined} error={errors.dueDate}>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            )}
            {(kind === "goods_receipt" || kind === "purchase_bill") && (
              <>
                <Field label={kind === "purchase_bill" ? "Supplier invoice no." : "Challan no."} required={kind === "purchase_bill"} error={errors.supplierRef}><Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} maxLength={40} /></Field>
                <Field label={kind === "purchase_bill" ? "Invoice date" : "Challan date"} required={kind === "purchase_bill"} error={errors.supplierDate}><Input type="date" value={supplierDate} max={issueDate} onChange={(e) => setSupplierDate(e.target.value)} /></Field>
              </>
            )}
            {!isReturn && godowns.length > 1 && (
              <Field label={kind === "purchase_order" ? "Deliver to" : "Godown"}>
                <NativeSelect value={godown} onChange={(e) => setLocationId(e.target.value)} aria-label="Godown">
                  {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </NativeSelect>
              </Field>
            )}
          </div>
          {isReturn && (
            <Field label="Return reason" required error={errors.returnReason} className="max-w-sm">
              <SearchSelect value={returnReason} onChange={setReturnReason} options={RETURN_REASONS.map((r) => ({ value: r, label: r }))} placeholder="Select reason" aria-label="Return reason" />
            </Field>
          )}
          {nothingLeft && <p className="rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">No items available for return. Everything on this invoice has already been returned.</p>}
          {fromDoc?.kind === "goods_receipt" && <p className="rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">Stock already came in on {fromDoc.number}. This bill only records what you owe.</p>}
          {supplier && !supplier.gstin && !isReturn && !reverseCharge && <p className="rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">This supplier has no GSTIN, so no GST is charged on this purchase.</p>}

          <div className="grid gap-3">
            {lines.map((l, i) => {
              const n = lineQty(l)
              const amount = Math.max(0, Math.round(n * (l.unitPricePaise ?? 0)) - (l.discountPaise ?? 0))
              return (
                <div key={l.key} className="grid gap-2 rounded-2xl border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-medium">{l.description}</span>
                      <span className="block text-xs text-muted-foreground">
                        {l.max !== null ? `${qty(l.max)} ${l.unit} left` : l.isProduct ? "Product" : "Service or expense"}
                        {l.hsnSac ? ` · HSN ${l.hsnSac}` : ""}
                        {amount > 0 ? ` · ${formatPaise(amount)}` : ""}
                      </span>
                    </div>
                    {!l.sourceLineId && <Button variant="ghost" size="icon-sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove ${l.description}`}><Trash2 /></Button>}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {l.isProduct && l.tracking === "serial" && kind !== "purchase_order" ? (
                      <Field label={`Serial numbers (${parseSerials(l.serialText).length})`} error={errors[`lines.${i}.quantity`] ?? errors[`lines.${i}.serials`]} className="sm:col-span-2">
                        <Input value={l.serialText} onChange={(e) => update(i, { serialText: e.target.value })} placeholder="One per piece, comma separated" aria-label={`Serial numbers of ${l.description}`} />
                      </Field>
                    ) : (
                      <Field label={isReturn ? "Return qty" : "Quantity"} error={errors[`lines.${i}.quantity`]}>
                        <Input inputMode="decimal" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value.replace(/[^\d.]/g, "") })} aria-label={`Quantity of ${l.description}`} placeholder={l.unit} />
                      </Field>
                    )}
                    {!l.sourceLineId && l.altUnit && l.altFactor && (
                      <Field label="Unit">
                        <NativeSelect value={l.unit} onChange={(e) => update(i, { unit: e.target.value })} aria-label={`Unit of ${l.description}`}>
                          <option value={l.baseUnit}>{l.baseUnit}</option>
                          <option value={l.altUnit}>{l.altUnit} ({l.altFactor} {l.baseUnit})</option>
                        </NativeSelect>
                      </Field>
                    )}
                    <Field label={`Price per ${l.unit}`} error={errors[`lines.${i}.unitPricePaise`]}>
                      <MoneyInput value={l.unitPricePaise} onChange={(v) => update(i, { unitPricePaise: v })} disabled={isReturn} aria-label={`Price of ${l.description}`} />
                    </Field>
                    {!isReturn && <Field label="Discount" error={errors[`lines.${i}.discountPaise`]}><MoneyInput value={l.discountPaise} onChange={(v) => update(i, { discountPaise: v })} aria-label={`Discount on ${l.description}`} /></Field>}
                    <Field label="GST">
                      <NativeSelect value={String(l.gstRateBp)} disabled={isReturn} onChange={(e) => update(i, { gstRateBp: Number(e.target.value) })} aria-label={`GST rate of ${l.description}`}>
                        {RATES.map((r) => <option key={r} value={r}>{r / 100}%</option>)}
                      </NativeSelect>
                    </Field>
                    {l.isProduct && l.tracking === "batch" && stockIn && (
                      <>
                        <Field label="Batch" required error={errors[`lines.${i}.batchNo`]}><Input value={l.batchNo} onChange={(e) => update(i, { batchNo: e.target.value })} maxLength={40} aria-label={`Batch of ${l.description}`} /></Field>
                        <Field label="Mfg date"><Input type="date" value={l.mfgDate} onChange={(e) => update(i, { mfgDate: e.target.value })} aria-label={`Manufactured on, ${l.description}`} /></Field>
                        <Field label="Expiry"><Input type="date" value={l.expiryDate} onChange={(e) => update(i, { expiryDate: e.target.value })} aria-label={`Expiry of ${l.description}`} /></Field>
                      </>
                    )}
                    {l.isProduct && l.tracking === "batch" && isReturn && l.batchNo && <p className="self-end pb-2 text-sm text-muted-foreground">Batch {l.batchNo}</p>}
                  </div>
                </div>
              )
            })}
            {!isReturn && !(fromDoc?.kind === "goods_receipt") && <ItemPicker onPick={pick} allowCreate placeholder="Search or scan items to add" />}
            {errors.lines && <p className="text-xs text-destructive">{errors.lines}</p>}
          </div>

          {!isReturn && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Freight and other charges" hint={stockIn ? "Added to the cost of the goods" : "Not added to stock cost"}><MoneyInput value={chargesPaise} onChange={setChargesPaise} aria-label="Freight and other charges" /></Field>
              <Field label="GST on charges">
                <NativeSelect value={String(chargesGstBp)} onChange={(e) => setChargesGstBp(Number(e.target.value))} aria-label="GST on charges">
                  {RATES.map((r) => <option key={r} value={r}>{r / 100}%</option>)}
                </NativeSelect>
              </Field>
              {kind !== "goods_receipt" && (
                <label className="flex items-start gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" className="mt-1" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} />
                  <span><span className="font-medium">Reverse charge</span><span className="block text-muted-foreground">You pay the GST to the government, not to the supplier (e.g. transport by a GTA, or notified goods).</span></span>
                </label>
              )}
            </div>
          )}

          <div className="ml-auto grid w-full max-w-xs gap-1 text-sm">
            <p className="flex justify-between"><span className="text-muted-foreground">Taxable</span><span className="tabular-nums">{formatPaise(taxable)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">GST{reverseCharge ? " (you pay, reverse charge)" : ""}</span><span className="tabular-nums">{formatPaise(tax)}</span></p>
            <p className="flex justify-between border-t pt-1 text-base font-semibold"><span>{reverseCharge ? "To supplier" : "Total"}</span><span className="tabular-nums">{formatPaise(Math.round((taxable + (reverseCharge ? 0 : tax)) / 100) * 100)}</span></p>
            <p className="text-xs text-muted-foreground">CGST + SGST or IGST is worked out from the supplier&apos;s state when you save.</p>
          </div>

          <Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
            {invoice && <Button variant="outline" disabled={busy} onClick={() => save(true)}>Save as draft</Button>}
            <Button disabled={busy || nothingLeft} onClick={() => save(isReturn)}>{busy ? "Saving…" : invoice ? "Save and post" : isReturn ? (editId ? "Save changes" : "Create return") : `Save ${KIND_LABEL[kind].toLowerCase()}`}</Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

/** A new source document means a fresh form */
function KeyedForm() {
  const params = useSearchParams()
  return <PurchaseForm key={`${params.get("kind")}-${params.get("from")}-${params.get("edit")}`} />
}

export default function NewPurchasePage() {
  return (
    <React.Suspense>
      <KeyedForm />
    </React.Suspense>
  )
}
