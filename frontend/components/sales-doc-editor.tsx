"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CalendarDays, FileText, MapPin, Package, Trash2 } from "lucide-react"
import { todayInIndia } from "@contracts/validation"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog, MoneyInput } from "@/components/common"
import { LineStockFields } from "@/components/stock-line"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ContactPicker, ItemPicker, type ContactOption, type ItemOption } from "@/components/pickers"
import { StateSelect } from "@/components/search-select"
import { WarehouseSelect } from "@/components/creatable-select"
import { termsLabel } from "@/components/contact-dialog"
import { NumberStepper } from "@/components/number-stepper"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { GST_RATES, PAYMENT_METHODS } from "@/lib/money"
import { GST_STATES, formatPaise } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"
import { docApi, docLabel, docPath, previewTotals, roundOffOf, withoutGst, type DocKind, type DocLine, type SalesDoc } from "@/lib/sales"

// Quotation, invoice, sales order and challan share this form, laid out like the purchase form:
// the details, where the goods go, the items, and a summary with the actions on the side.
// Everything a bill needs is checked here before it is sent, and the server checks it again.

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const WALK_IN = "Walk-in customer"
const pct = (paise: number, base: number) => (paise && base ? String(Math.round((paise / base) * 10_000) / 100) : "")
const lineBase = (l: DocLine) => Math.round(Number(l.quantity || 0) * l.unitPricePaise)

type Line = DocLine & { key: string; discountPct: string; stock?: ItemStock | null }
type ItemStock = { trackStock?: boolean; warehouses?: { id: string; quantity: number }[] }
type ShipMode = "billing" | "customer" | "other"
type Ship = { name: string; line1: string; city: string; pincode: string; stateCode: string }

const TITLE: Record<DocKind, string> = { invoice: "Invoice", quotation: "Quotation", sales_order: "Order", delivery_challan: "Challan" }
const DATE_LABEL: Record<DocKind, string> = { invoice: "Invoice date", quotation: "Quotation date", sales_order: "Order date", delivery_challan: "Challan date" }
const DUE_LABEL: Record<DocKind, string> = { invoice: "Due date", quotation: "Valid until", sales_order: "Deliver by", delivery_challan: "Deliver by" }

/** cash = the counter bill: walk-in customer, no due date, money taken as it is posted. */
export function SalesDocEditor({ kind, doc, initialContact, cash = false }: { kind: DocKind; doc?: SalesDoc; initialContact?: ContactOption | null; cash?: boolean }) {
  const router = useRouter()
  const { me, can } = useAuth()
  const today = todayInIndia()
  const workspace = useApi<{ preferences: { taxes: { pricesIncludeTax: boolean; roundOff?: boolean; defaultGstRateBp: number; composition?: boolean } } }>(can("tenant.settings.view") ? "/tenant/workspace" : null)
  const taxes = workspace.data?.preferences.taxes
  const noTax = !me?.tenant?.gstin || !!taxes?.composition
  const stocked = kind !== "quotation"
  const locations = useApi<{ data: { id: string; name: string; isActive: boolean; isDefault: boolean }[] }>(stocked ? "/stock-locations" : null)

  const [walkIn, setWalkIn] = React.useState(doc ? !doc.contactId : cash)
  const [includeGstChoice, setIncludeGst] = React.useState<boolean | null>(doc ? false : null)
  const [roundOffChoice, setRoundOff] = React.useState<boolean | null>(doc ? !!doc.roundOffPaise : null)
  const includeGst = includeGstChoice ?? (cash && !!taxes?.pricesIncludeTax)
  const roundOff = roundOffChoice ?? (cash || !!taxes?.roundOff)
  const [method, setMethod] = React.useState("cash")
  const [contact, setContact] = React.useState<ContactOption | null>(
    doc?.contactId ? { id: doc.contactId, name: doc.buyer.name, gstin: doc.buyer.gstin, stateCode: doc.buyer.stateCode, phone: doc.buyer.phone, address: doc.buyer.address ?? null } : (initialContact ?? null),
  )
  const [lines, setLines] = React.useState<Line[]>(
    () => doc?.lines.map((l, i) => ({ ...l, key: `${l.id ?? i}`, quantity: String(Number(l.quantity)), freeQuantity: l.freeQuantity ? String(Number(l.freeQuantity)) : "", discountPct: pct(l.discountPaise, lineBase(l)) })) ?? [],
  )
  const [issueDate, setIssueDate] = React.useState(doc?.issueDate?.slice(0, 10) ?? today)
  const termsDays = (c: ContactOption | null) => (kind === "invoice" ? (c?.paymentDays ?? 0) : kind === "quotation" ? 30 : 7)
  const [dueDate, setDueDate] = React.useState(doc?.dueDate?.slice(0, 10) ?? (cash ? "" : addDays(today, termsDays(initialContact ?? null))))
  const [dueTouched, setDueTouched] = React.useState(!!doc)
  const [locationId, setLocationId] = React.useState(doc?.locationId ?? "")
  const [notes, setNotes] = React.useState(doc?.notes ?? "")
  const [terms, setTerms] = React.useState(doc?.terms ?? "")
  const [posOverride, setPosOverride] = React.useState("")
  const [shipMode, setShipMode] = React.useState<ShipMode>(doc?.shipTo ? "other" : initialContact?.shippingAddress ? "customer" : "billing")
  const [ship, setShip] = React.useState<Ship>({ name: doc?.shipTo?.name ?? "", line1: doc?.shipTo?.line1 ?? "", city: doc?.shipTo?.city ?? "", pincode: doc?.shipTo?.pincode ?? "", stateCode: doc?.shipTo?.stateCode ?? "" })
  const [proforma, setProforma] = React.useState(doc?.noteType === "proforma")
  const [overLimit, setOverLimit] = React.useState<string | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<"draft" | "post" | "cash" | null>(null)

  const customerPrices = useApi<{ name: string; discountBp: number; prices: Record<string, number> } | null>(contact?.id && !walkIn && can("catalog.item.view") ? `/contacts/${contact.id}/prices` : null)
  const priceFor = (item: { id: string; pricePaise: number }) => {
    const list = customerPrices.data
    if (!list) return item.pricePaise
    return list.prices[item.id] ?? Math.round((item.pricePaise * (10_000 - list.discountBp)) / 10_000)
  }

  const active = (locations.data?.data ?? []).filter((l) => l.isActive)
  const warehouse = locationId || active.find((l) => l.isDefault)?.id || active[0]?.id || ""
  const warehouseName = active.find((l) => l.id === warehouse)?.name

  // Where the goods go decides the place of supply, and so CGST + SGST or IGST
  const shipTo: Ship | null = walkIn ? null : shipMode === "other" ? ship : shipMode === "customer" && contact?.shippingAddress ? { name: contact.shippingAddress.name ?? "", line1: contact.shippingAddress.line1 ?? "", city: contact.shippingAddress.city ?? "", pincode: contact.shippingAddress.pincode ?? "", stateCode: contact.shippingAddress.stateCode ?? "" } : null
  const sellerState = me?.tenant?.billingStateCode ?? null
  const pos = posOverride || shipTo?.stateCode || contact?.stateCode || (contact?.gstin ? contact.gstin.slice(0, 2) : null) || sellerState
  const intra = !sellerState || !pos || pos === sellerState
  const priced = noTax ? lines.map((l) => ({ ...l, gstRateBp: 0 })) : includeGst ? withoutGst(lines) : lines
  const totals = previewTotals(priced, intra)
  const roundOffPaise = roundOff ? roundOffOf(totals.total) : 0
  const tax = totals.cgst + totals.sgst + totals.igst

  function chooseContact(c: ContactOption | null) {
    setContact(c)
    setErrors((e) => ({ ...e, contactId: "" }))
    setShipMode(c?.shippingAddress ? "customer" : "billing")
    if (!dueTouched && !cash) setDueDate(addDays(issueDate, termsDays(c)))
  }
  function changeIssueDate(d: string) {
    setIssueDate(d)
    if (!dueTouched && !cash && d) setDueDate(addDays(d, termsDays(contact)))
  }
  /** A discount is a percent of the line; it follows the quantity and rate */
  const update = (i: number, patch: Partial<Line>) => {
    // A line being fixed loses its old errors
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(`lines.${i}.`) && k !== "lines")))
    setLines((ls) => ls.map((l, j) => {
      if (j !== i) return l
      const next = { ...l, ...patch }
      const p = Number(next.discountPct || 0)
      return { ...next, discountPaise: p > 0 ? Math.round((lineBase(next) * Math.min(p, 100)) / 100) : 0 }
    }))
  }
  const addItem = (it: ItemOption & ItemStock & { tracking?: string }) =>
    setLines((ls) => [...ls, { key: `${it.id}-${Date.now()}`, itemId: it.id, description: it.name, hsnSac: it.hsnSac, unit: it.unit, quantity: "1", unitPricePaise: priceFor(it), discountPaise: 0, discountPct: "", gstRateBp: it.gstRateBp, freeQuantity: "", stock: it.trackStock ? it : null }])
  const addBlank = () => setLines((ls) => [...ls, { key: `blank-${Date.now()}`, itemId: null, description: "", hsnSac: null, unit: "pcs", quantity: "1", unitPricePaise: 0, discountPaise: 0, discountPct: "", gstRateBp: taxes?.defaultGstRateBp ?? 1800, freeQuantity: "" }])

  function check(posting: boolean) {
    const errs: Record<string, string> = {}
    if (!walkIn && !contact) errs.contactId = "Choose the customer"
    if (!issueDate) errs.issueDate = "Choose the date"
    if (dueDate && dueDate < issueDate) errs.dueDate = `Can't be before the ${DATE_LABEL[kind].toLowerCase()}`
    if (kind === "quotation" && !dueDate) errs.dueDate = "Choose how long the rates hold"
    if (stocked && !warehouse) errs.locationId = "Choose the warehouse"
    if (!lines.length) errs.lines = "Add at least one item"
    lines.forEach((l, i) => {
      if (!l.description.trim()) errs[`lines.${i}.description`] = "Enter what is sold"
      if (!(Number(l.quantity) > 0)) errs[`lines.${i}.quantity`] = "More than 0"
      if (!(l.unitPricePaise > 0)) errs[`lines.${i}.unitPricePaise`] = "Enter the rate"
      if (Number(l.discountPct || 0) > 100) errs[`lines.${i}.discountPaise`] = "At most 100%"
    })
    if (shipMode === "other" && !walkIn) {
      if (!ship.line1.trim()) errs["shipTo.line1"] = "Enter the delivery address"
      if (!ship.city.trim()) errs["shipTo.city"] = "Enter the city"
      if (!/^[1-9]\d{5}$/.test(ship.pincode)) errs["shipTo.pincode"] = "Enter the 6-digit PIN code"
      if (!ship.stateCode) errs["shipTo.stateCode"] = "Choose the state"
    }
    if (posting && kind === "invoice" && !sellerState) errs.form = "Add your business state in Settings › Business first, so GST is worked out right."
    setErrors(errs)
    if (errs.form) setError(errs.form)
    return Object.keys(errs).length === 0
  }

  const payload = () => ({
    contactId: walkIn ? null : (contact?.id ?? null),
    buyer: walkIn ? { name: doc?.buyer.name || WALK_IN, stateCode: posOverride || null } : posOverride ? { name: contact?.companyName || contact?.name || "", stateCode: posOverride } : undefined,
    issueDate,
    dueDate: dueDate || null,
    locationId: stocked ? warehouse || null : null,
    notes: notes.trim() || null,
    terms: terms.trim() || null,
    pricesIncludeGst: includeGst && !noTax,
    roundOff,
    shipTo: shipTo ? { name: shipTo.name.trim() || null, line1: shipTo.line1.trim(), city: shipTo.city.trim(), pincode: shipTo.pincode, stateCode: shipTo.stateCode } : null,
    ...(kind === "quotation" ? { proforma } : {}),
    lines: lines.map((l) => ({ itemId: l.itemId, description: l.description.trim(), hsnSac: l.hsnSac || null, unit: l.unit, quantity: Number(l.quantity), unitPricePaise: l.unitPricePaise, discountPaise: l.discountPaise || 0, gstRateBp: noTax ? 0 : l.gstRateBp, sourceLineId: l.sourceLineId ?? null, freeQuantity: Number(l.freeQuantity) || 0, batchId: l.batchId ?? null, serials: l.serials ?? [] })),
  })

  /** Someone who may approve chose to go over the customer's credit limit. */
  async function postOverLimit() {
    try {
      const draft = doc ? await api.put<SalesDoc>(`${docApi(kind)}/${doc.id}`, { ...payload(), version: doc.version }) : await api.post<SalesDoc>(docApi(kind), { ...payload(), issue: false })
      const saved = await api.post<SalesDoc>(`/invoices/${draft.id}/issue-over-limit`)
      toast.success(`Invoice ${saved.number} posted`)
      router.replace(`/app/m/${docPath(kind)}/${saved.id}`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function save(post: boolean, takeMoney = false) {
    setError(null)
    if (!check(post)) return
    setBusy(takeMoney ? "cash" : post ? "post" : "draft")
    const body = payload()
    try {
      let saved: SalesDoc
      if (takeMoney) saved = await api.post<SalesDoc>("/invoices/cash-bill", { ...body, receive: { method } })
      else if (doc) {
        saved = await api.put<SalesDoc>(`${docApi(kind)}/${doc.id}`, { ...body, version: doc.version })
        if (post) saved = await api.post<SalesDoc>(`/invoices/${doc.id}/issue`)
      } else saved = await api.post<SalesDoc>(docApi(kind), { ...body, issue: post })
      toast.success(kind !== "invoice" ? `${docLabel(kind)} ${saved.number ?? ""} saved` : post ? `Invoice ${saved.number} posted${takeMoney ? " and paid" : ""}` : "Invoice saved as draft")
      router.replace(`/app/m/${docPath(kind)}/${saved.id}`)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      if (err instanceof ApiError && err.details?.creditLimit && can("billing.invoice.approve")) setOverLimit(err.message)
      else setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const cardTitle = "flex items-center gap-2.5 border-b px-5 py-4 font-semibold"
  const billing = contact?.address ? [contact.address.line1, contact.address.line2, contact.address.city, contact.address.pincode].filter(Boolean).join(", ") : ""
  const shipAddr = contact?.shippingAddress ? [contact.shippingAddress.name, contact.shippingAddress.line1, contact.shippingAddress.city, contact.shippingAddress.pincode].filter(Boolean).join(", ") : ""
  const stateLabel = (code: string | null | undefined) => GST_STATES.find(([c]) => c === code)?.[1] ?? code ?? ""
  const back = doc ? `/app/m/${docPath(kind)}/${doc.id}` : `/app/m/${docPath(kind)}`

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid gap-5">
        <section className="ui-surface overflow-hidden">
          <h2 className={cardTitle}><CalendarDays className="size-4 text-primary" aria-hidden /> {TITLE[kind]} details</h2>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Field label="Customer" required={!walkIn} error={errors.contactId} className="md:col-span-2">
              <div>
                {walkIn ? <div className="flex h-10 items-center rounded-xl border bg-muted/40 px-3 text-sm font-medium">{doc?.buyer.name || WALK_IN}</div> : <ContactPicker value={contact} onChange={chooseContact} allowCreate={can("crm.contact.create")} />}
                {kind === "invoice" && (
                  <label className="mt-1.5 flex w-fit items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" className="accent-primary" checked={walkIn} onChange={(e) => setWalkIn(e.target.checked)} /> Walk-in customer, no name needed
                  </label>
                )}
              </div>
            </Field>
            {contact && !walkIn && (
              <div className="grid gap-1 rounded-2xl bg-muted/50 px-4 py-3 text-sm md:col-span-2">
                <p><span className="text-muted-foreground">Bill to: </span>{billing || "No address saved"}{contact.stateCode ? ` · ${stateLabel(contact.stateCode)}` : ""}</p>
                <p><span className="text-muted-foreground">GSTIN: </span>{contact.gstin ?? "Not registered (B2C)"}{kind === "invoice" && <><span className="text-muted-foreground"> · Terms: </span>{termsLabel(contact.paymentDays)}</>}</p>
              </div>
            )}
            <Field label={DATE_LABEL[kind]} required error={errors.issueDate}><Input type="date" value={issueDate} max={kind === "invoice" ? today : undefined} onChange={(e) => changeIssueDate(e.target.value)} /></Field>
            {!cash && (
              <Field label={DUE_LABEL[kind]} required={kind === "quotation"} error={errors.dueDate} hint={kind === "invoice" ? (dueTouched ? "Changed by hand" : "From the customer's payment terms") : undefined}>
                <Input type="date" value={dueDate} min={issueDate} onChange={(e) => { setDueDate(e.target.value); setDueTouched(true) }} />
              </Field>
            )}
            {stocked && (
              <Field label="Warehouse" required error={errors.locationId} hint="Stock goes out from here">
                <WarehouseSelect value={warehouse} onChange={(v) => { setLocationId(v); setErrors((e) => ({ ...e, locationId: "" })) }} aria-label="Warehouse" />
              </Field>
            )}
            {!noTax && (
              <Field label="Place of supply" hint={intra ? "Same state: CGST + SGST" : "Other state: IGST"}>
                <StateSelect value={posOverride} onChange={setPosOverride} emptyLabel={pos ? `${stateLabel(pos)} (automatic)` : "Automatic"} />
              </Field>
            )}
            {kind === "quotation" && (
              <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" className="size-4 accent-primary" checked={proforma} onChange={(e) => setProforma(e.target.checked)} /> Print as a proforma invoice</label>
            )}
          </div>
          {noTax && workspace.data && (
            <p className="mx-5 mb-5 rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">
              {me?.tenant?.gstin ? "You are on the composition scheme, so this goes out as a bill of supply with no GST." : "Your business has no GSTIN, so this goes out without GST. Add your GSTIN in Settings if you are registered."}
            </p>
          )}
        </section>

        {!walkIn && (
          <section className="ui-surface overflow-hidden">
            <h2 className={cardTitle}><MapPin className="size-4 text-primary" aria-hidden /> Deliver to</h2>
            <div className="grid gap-4 p-5">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm" role="radiogroup" aria-label="Deliver to">
                <label className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={shipMode === "billing"} onChange={() => setShipMode("billing")} /> Billing address</label>
                {contact?.shippingAddress && <label className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={shipMode === "customer"} onChange={() => setShipMode("customer")} /> Customer&apos;s delivery address</label>}
                <label className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={shipMode === "other"} onChange={() => setShipMode("other")} /> Another address</label>
              </div>
              {shipMode === "customer" && shipAddr && <p className="rounded-2xl bg-muted/50 px-4 py-3 text-sm">{shipAddr} · {stateLabel(contact?.shippingAddress?.stateCode)}</p>}
              {shipMode === "other" && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Deliver to (name)" hint="Empty: the customer's name"><Input value={ship.name} onChange={(e) => setShip({ ...ship, name: e.target.value })} maxLength={160} /></Field>
                  <Field label="Address" required error={errors["shipTo.line1"]}><Input value={ship.line1} onChange={(e) => setShip({ ...ship, line1: e.target.value })} maxLength={200} placeholder="Shop, building, street, area" /></Field>
                  <Field label="City" required error={errors["shipTo.city"]}><Input value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} maxLength={80} /></Field>
                  <Field label="PIN code" required error={errors["shipTo.pincode"]}><Input mask="pincode" value={ship.pincode} onChange={(e) => setShip({ ...ship, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} /></Field>
                  <Field label="State" required error={errors["shipTo.stateCode"]} hint="Tax follows where the goods go"><StateSelect value={ship.stateCode} onChange={(s) => setShip({ ...ship, stateCode: s ?? "" })} /></Field>
                </div>
              )}
            </div>
          </section>
        )}

        <section className="ui-surface overflow-hidden">
          <div className={cn(cardTitle, "flex-wrap justify-between")}>
            <h2 className="flex items-center gap-2.5"><Package className="size-4 text-primary" aria-hidden /> Items</h2>
            <div className="flex flex-wrap gap-4 text-sm font-normal text-muted-foreground">
              {!noTax && <label className="flex items-center gap-2"><input type="checkbox" className="accent-primary" checked={includeGst} onChange={(e) => setIncludeGst(e.target.checked)} /> Rates include GST</label>}
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-primary" checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} /> Round off</label>
            </div>
          </div>
          {lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/50 text-left text-[13px]">
                  <tr>
                    <th className="py-3 pr-3 pl-5 font-semibold">Item</th>
                    <th className="w-28 px-2 font-semibold">Qty</th>
                    <th className="w-32 px-2 font-semibold">Rate</th>
                    <th className="w-28 px-2 font-semibold">Disc %</th>
                    <th className="w-24 px-2 font-semibold">GST</th>
                    <th className="w-28 px-2 text-right font-semibold">Amount</th>
                    <th className="w-12 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const amount = previewTotals(noTax ? [{ ...l, gstRateBp: 0 }] : includeGst ? withoutGst([l]) : [l], intra).taxable
                    const inHere = l.stock?.trackStock ? (l.stock.warehouses?.find((w) => w.id === warehouse)?.quantity ?? 0) : null
                    const short = inHere !== null && stocked && Number(l.quantity) + Number(l.freeQuantity || 0) > inHere
                    return (
                      <React.Fragment key={l.key}>
                        <tr className="border-t align-top">
                          <td className="py-2.5 pr-3 pl-5">
                            {l.itemId ? <span className="font-medium">{l.description}</span> : <Input value={l.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="What is sold" aria-label="Description" aria-invalid={!!errors[`lines.${i}.description`]} className="h-9" />}
                            {errors[`lines.${i}.description`] && <p className="mt-1 text-xs text-destructive">{errors[`lines.${i}.description`]}</p>}
                            <span className="block text-xs text-muted-foreground">
                              {l.hsnSac ? `HSN ${l.hsnSac}` : l.itemId ? "No HSN" : ""}
                              {inHere !== null && stocked && <span className={short ? "font-medium text-destructive" : ""}>{l.hsnSac || l.itemId ? " · " : ""}{short ? `Only ${inHere} in ${warehouseName ?? "this warehouse"}` : `${inHere} in ${warehouseName ?? "stock"}`}</span>}
                            </span>
                            {!l.itemId && <Input value={l.hsnSac ?? ""} onChange={(e) => update(i, { hsnSac: e.target.value.replace(/\D/g, "").slice(0, 8) || null })} placeholder="HSN/SAC" className="mt-1 h-8 w-28 text-xs" aria-label="HSN or SAC" />}
                          </td>
                          <td className="px-2 py-2">
                            <NumberStepper decimals size="sm" value={String(l.quantity)} onChange={(v) => update(i, { quantity: v })} aria-label={`Quantity of ${l.description || "line"}`} aria-invalid={!!errors[`lines.${i}.quantity`]} />
                            {errors[`lines.${i}.quantity`] && <p className="mt-1 text-xs text-destructive">{errors[`lines.${i}.quantity`]}</p>}
                          </td>
                          <td className="px-2 py-2">
                            <MoneyInput value={l.unitPricePaise || null} onChange={(v) => update(i, { unitPricePaise: v ?? 0 })} aria-label={`Rate of ${l.description || "line"}`} />
                            {errors[`lines.${i}.unitPricePaise`] && <p className="mt-1 text-xs text-destructive">{errors[`lines.${i}.unitPricePaise`]}</p>}
                          </td>
                          <td className="px-2 py-2">
                            <NumberStepper decimals size="sm" max={100} value={l.discountPct} onChange={(v) => update(i, { discountPct: v })} placeholder="0" aria-label={`Discount percent on ${l.description || "line"}`} />
                            {errors[`lines.${i}.discountPaise`] && <p className="mt-1 text-xs text-destructive">{errors[`lines.${i}.discountPaise`]}</p>}
                          </td>
                          <td className="px-2 py-2">
                            <NativeSelect className="h-9" value={noTax ? 0 : l.gstRateBp} disabled={noTax} onChange={(e) => update(i, { gstRateBp: Number(e.target.value) })} aria-label={`GST rate of ${l.description || "line"}`}>
                              {GST_RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}
                            </NativeSelect>
                          </td>
                          <td className="px-2 py-3 text-right font-medium tabular-nums">{formatPaise(amount)}</td>
                          <td className="py-2 pr-3 text-right">{!l.sourceLineId && <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove ${l.description || "line"}`}><Trash2 /></Button>}</td>
                        </tr>
                        {l.itemId && (
                          <tr>
                            <td colSpan={7} className="px-5 pb-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <LineStockFields line={l} onChange={(p) => update(i, p)} sale={stocked} />
                                {stocked && <NumberStepper decimals size="sm" className="w-32" value={l.freeQuantity ? String(l.freeQuantity) : ""} onChange={(v) => update(i, { freeQuantity: v })} placeholder="Free" aria-label={`Free quantity of ${l.description}`} title="Given free, not billed" />}
                              </div>
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
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <ItemPicker allowCreate={can("catalog.item.create")} defaultGstRateBp={taxes?.defaultGstRateBp} onPick={(it) => addItem(it as ItemOption & ItemStock)} locationId={stocked ? warehouse : null} />
              <Button variant="outline" onClick={addBlank}>Line without an item</Button>
            </div>
            {errors.lines && <p className="text-xs text-destructive">{errors.lines}</p>}
            {customerPrices.data && <p className="text-xs text-muted-foreground">Rates from the customer&apos;s price list: {customerPrices.data.name}</p>}
          </div>
        </section>

        <section className="ui-surface overflow-hidden">
          <h2 className={cardTitle}><FileText className="size-4 text-primary" aria-hidden /> Notes and terms</h2>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Field label="Notes for the customer" hint="Printed on the document"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} placeholder="Thank you for your business." /></Field>
            <Field label="Terms and conditions" hint="Empty: the terms from Settings › Documents"><Textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} maxLength={2000} /></Field>
          </div>
        </section>
      </div>

      <aside className="grid gap-5 xl:sticky xl:top-20">
        <section className="ui-surface grid gap-2 p-5 text-sm">
          <h2 className="mb-1 font-semibold">Summary</h2>
          <p className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="tabular-nums">{lines.length}</span></p>
          <p className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatPaise(totals.subtotal)}</span></p>
          {totals.discount > 0 && <p className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="text-destructive tabular-nums">−{formatPaise(totals.discount)}</span></p>}
          <p className="flex justify-between"><span className="text-muted-foreground">Taxable value</span><span className="tabular-nums">{formatPaise(totals.taxable)}</span></p>
          {!noTax && (intra ? (
            <>
              <p className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="tabular-nums">{formatPaise(totals.cgst)}</span></p>
              <p className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="tabular-nums">{formatPaise(totals.sgst)}</span></p>
            </>
          ) : <p className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="tabular-nums">{formatPaise(totals.igst)}</span></p>)}
          {roundOffPaise !== 0 && <p className="flex justify-between"><span className="text-muted-foreground">Round off</span><span className="tabular-nums">{formatPaise(roundOffPaise)}</span></p>}
          <p className="flex items-center justify-between border-t pt-2 font-semibold"><span>Total</span><span className="text-xl text-primary tabular-nums">{formatPaise(totals.total + roundOffPaise)}</span></p>
          {!noTax && tax > 0 && <p className="text-xs text-muted-foreground">Includes {formatPaise(tax)} GST{pos ? ` · supply to ${stateLabel(pos)}` : ""}</p>}
        </section>
        <section className="ui-surface grid gap-2 p-5">
          <FormError message={error} />
          {cash && !doc ? (
            <>
              <Field label="Paid by">
                <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </NativeSelect>
              </Field>
              <Button disabled={!!busy} onClick={() => save(true, true)}>{busy === "cash" ? "Saving…" : "Post and mark paid"}</Button>
              <Button variant="outline" disabled={!!busy} onClick={() => save(true)}>Post without payment</Button>
            </>
          ) : kind === "invoice" ? (
            <>
              <Button disabled={!!busy} onClick={() => save(true)}>{busy === "post" ? "Posting…" : "Save and post"}</Button>
              <Button variant="outline" disabled={!!busy} onClick={() => save(false)}>{busy === "draft" ? "Saving…" : "Save as draft"}</Button>
              <p className="text-xs text-muted-foreground">Posting gives the invoice its number, takes the stock out and adds it to what the customer owes.</p>
            </>
          ) : (
            <Button disabled={!!busy} onClick={() => save(false)}>{busy ? "Saving…" : `Save ${docLabel(kind).toLowerCase()}`}</Button>
          )}
          <Link href={back} className={buttonVariants({ variant: "ghost" })}>Cancel</Link>
        </section>
      </aside>

      <ConfirmDialog open={!!overLimit} onOpenChange={(o) => !o && setOverLimit(null)} title="Over the credit limit" description={overLimit ?? ""} confirmLabel="Post anyway" onConfirm={postOverLimit} />
    </div>
  )
}
