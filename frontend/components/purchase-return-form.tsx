"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, CalendarDays, ReceiptText, ShoppingCart } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell"
import { Spinner } from "@/components/common"
import { Field, FormError } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { SearchSelect } from "@/components/search-select"
import { parseSerials } from "@/components/stock-line"
import { api, ApiError, errorMessage } from "@/lib/api"
import { formatDate, formatPaise } from "@/lib/format"
import { qty as showQty } from "@/lib/inventory"
import { KIND_PATH, RETURN_REASONS, type PurchaseDoc, type PurchaseLine } from "@/lib/purchase"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"
import { todayInIndia } from "@contracts/validation"

// A return is one screen: pick the invoice, type how much of each item goes back.

const left = (l: PurchaseLine) => Math.max(0, l.quantity - l.doneQuantity)
const lineValue = (l: PurchaseLine, n: number) => {
  const taxable = l.quantity ? Math.round((l.taxablePaise * n) / l.quantity) : 0
  return { taxable, tax: Math.round((taxable * l.gstRateBp) / 10_000) }
}

export function PurchaseReturnForm({ fromId, editId }: { fromId: string | null; editId: string | null }) {
  const router = useRouter()
  const saved = useApi<PurchaseDoc>(editId ? `/purchases/${editId}` : null)
  const invoices = useApi<{ data: PurchaseDoc[] }>(fromId || editId ? null : "/purchases?kind=purchase_bill&limit=200")
  const [picked, setPicked] = React.useState(fromId ?? "")
  const invoiceId = editId ? (saved.data?.sourceId ?? "") : picked
  const invoice = useApi<PurchaseDoc>(invoiceId ? `/purchases/${invoiceId}` : null)
  const [date, setDate] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState<string | null>(null)
  const [typed, setTyped] = React.useState<Record<string, string>>({})
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  if (editId && !saved.data) return <div className="grid place-items-center py-24"><Spinner /></div>

  const draft = saved.data
  const savedLine = (id: string) => draft?.lines.find((l) => l.sourceLineId === id)
  const issueDate = date ?? draft?.issueDate.slice(0, 10) ?? todayInIndia()
  const returnReason = reason ?? draft?.returnReason ?? RETURN_REASONS[0]
  const note = notes ?? draft?.notes ?? ""
  const doc = invoice.data
  const lines = (doc?.lines ?? []).filter((l) => left(l) > 0)
  const isSerial = (l: PurchaseLine) => l.serials.length > 0
  const text = (l: PurchaseLine) => typed[l.id] ?? (savedLine(l.id) ? (isSerial(l) ? savedLine(l.id)!.serials.join(", ") : String(savedLine(l.id)!.quantity)) : "")
  const count = (l: PurchaseLine) => (isSerial(l) ? parseSerials(text(l)).length : Number(text(l)) || 0)
  const chosen = lines.filter((l) => count(l) > 0)
  const taxable = chosen.reduce((s, l) => s + lineValue(l, count(l)).taxable, 0)
  const tax = chosen.reduce((s, l) => s + lineValue(l, count(l)).tax, 0)

  const billDate = (doc?.supplierDate ?? doc?.issueDate ?? "").slice(0, 10)
  const clear = (key: string) => { setErrors((e) => (e[key] ? { ...e, [key]: "" } : e)); setError(null) }
  function returnAll() {
    setTyped(Object.fromEntries(lines.map((l) => [l.id, isSerial(l) ? l.serials.slice(0, left(l)).join(", ") : String(left(l))])))
    setErrors({})
  }
  function toggleSerial(l: PurchaseLine, sn: string) {
    const cur = parseSerials(text(l))
    setTyped({ ...typed, [l.id]: (cur.includes(sn) ? cur.filter((x) => x !== sn) : [...cur, sn]).join(", ") })
    clear(l.id)
    clear("lines")
  }

  async function save() {
    const p: Record<string, string> = {}
    if (!doc) p.sourceId = "Choose the invoice"
    if (!issueDate) p.issueDate = "Choose the date"
    else if (issueDate > todayInIndia()) p.issueDate = "Can't be in the future"
    else if (billDate && issueDate < billDate) p.issueDate = `Can't be before the invoice date (${formatDate(billDate)})`
    if (returnReason === "Other" && !note.trim()) p.notes = "Write why the goods are going back"
    if (doc && !chosen.length) p.lines = "Enter how much goes back on at least one item"
    lines.forEach((l) => { if (count(l) > left(l)) p[l.id] = `Only ${showQty(left(l))} ${l.unit} can go back` })
    setErrors(p)
    if (Object.keys(p).length) return setError("Fix the marked fields first.")
    setBusy(true)
    setError(null)
    const body = {
      contactId: doc!.contactId, issueDate, reverseCharge: doc!.reverseCharge, chargesPaise: 0, chargesGstBp: 0, roundOff: true, notes: note.trim() || null, returnReason, sourceId: doc!.id, locationId: null,
      lines: chosen.map((l) => ({ itemId: l.itemId, description: l.description, hsnSac: l.hsnSac, unit: l.unit, quantity: count(l), unitPricePaise: l.unitPricePaise, discountPaise: 0, gstRateBp: l.gstRateBp, sourceLineId: l.id, ...(isSerial(l) ? { serials: parseSerials(text(l)) } : {}) })),
    }
    try {
      const d = draft ? await api.put<PurchaseDoc>(`/purchases/${draft.id}/draft`, { ...body, sourceId: null, version: draft.version }) : await api.post<PurchaseDoc>("/purchases", { kind: "purchase_return", draft: true, ...body })
      toast.success(`${d.number} saved as draft`)
      router.push(`/app/m/purchase/${d.id}`)
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields)
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const options = (invoices.data?.data ?? []).filter((d) => ["unpaid", "part_paid", "paid"].includes(d.status)).map((d) => ({ value: d.id, label: `${d.supplierRef ? `${d.supplierRef} · ` : ""}${d.number} - ${d.supplier.name}`, keywords: d.supplierRef ?? undefined }))
  const cardTitle = "flex items-center gap-2.5 border-b px-5 py-4 font-semibold"

  return (
    <>
      <PageHeader
        title={draft ? `Edit ${draft.number}` : "Create Purchase Return"}
        description="Goods going back to a supplier from a posted invoice."
        actions={<Link href={KIND_PATH.purchase_return} className={buttonVariants({ variant: "outline" })}><ArrowLeft /> Back</Link>}
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5">
          <section className="ui-surface overflow-hidden">
            <h2 className={cardTitle}><CalendarDays className="size-4 text-primary" aria-hidden /> Purchase Return Details</h2>
            <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Return date" required error={errors.issueDate}><Input type="date" value={issueDate} max={todayInIndia()} min={billDate || undefined} onChange={(e) => { setDate(e.target.value); clear("issueDate") }} /></Field>
              <Field label="Original invoice" required error={errors.sourceId}>
                {draft || fromId ? <Input value={doc ? `${doc.number} - ${doc.supplier.name}` : "Loading…"} readOnly aria-label="Original invoice" /> : <SearchSelect value={picked} onChange={(v) => { setPicked(v); setTyped({}) }} options={options} placeholder="Search invoice no., supplier or their bill no." searchable aria-label="Original invoice" />}
              </Field>
              <Field label="Warehouse"><Input value={doc?.location?.name ?? "Comes from the invoice"} readOnly aria-label="Warehouse" /></Field>
              <Field label="Return reason" required><SearchSelect value={returnReason} onChange={(v) => { setReason(v); clear("notes") }} options={RETURN_REASONS.map((r) => ({ value: r, label: r }))} aria-label="Return reason" /></Field>
            </div>
          </section>

          {invoiceId && (
            <section className="ui-surface overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
                <h2 className="flex items-center gap-2.5 font-semibold"><ReceiptText className="size-4 text-primary" aria-hidden /> Items on this invoice</h2>
                {lines.length > 0 && <Button variant="outline" size="sm" onClick={returnAll}>Return everything</Button>}
              </div>
              {!doc ? <div className="grid place-items-center py-10"><Spinner /></div> : !lines.length ? (
                <p className="p-8 text-center text-sm text-muted-foreground">No items available for return. Everything on this invoice has already been returned.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-[13px]">
                      <tr><th className="py-3 pr-3 pl-5 font-semibold">Product</th><th className="px-3 font-semibold">Available</th><th className="px-3 font-semibold">Unit price</th><th className="px-3 font-semibold">GST</th><th className="w-44 px-3 font-semibold">Return qty</th><th className="pr-5 text-right font-semibold">Total</th></tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => {
                        const v = lineValue(l, count(l))
                        return (
                          <tr key={l.id} className="border-t align-top">
                            <td className="py-3 pr-3 pl-5"><span className="font-medium">{l.description}</span>{l.batchNo && <span className="block text-xs text-muted-foreground">Batch {l.batchNo}</span>}</td>
                            <td className="px-3 py-3 tabular-nums">{showQty(left(l))} {l.unit}</td>
                            <td className="px-3 py-3 tabular-nums">{formatPaise(l.unitPricePaise)}</td>
                            <td className="px-3 py-3 tabular-nums">{l.gstRateBp / 100}%</td>
                            <td className="px-3 py-2">
                              {isSerial(l) ? (
                                <div className="flex flex-wrap gap-1" role="group" aria-label={`Serial numbers going back for ${l.description}`}>
                                  {l.serials.map((sn) => {
                                    const on = parseSerials(text(l)).includes(sn)
                                    return <button key={sn} type="button" aria-pressed={on} onClick={() => toggleSerial(l, sn)} className={cn("rounded-lg border px-1.5 py-0.5 font-mono text-[11px]", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>{sn}</button>
                                  })}
                                  <span className="w-full text-xs text-muted-foreground">{count(l)} ticked</span>
                                </div>
                              ) : (
                                <NumberStepper decimals size="sm" max={left(l)} suffix={l.unit} value={text(l)} onChange={(v) => { setTyped({ ...typed, [l.id]: v }); clear(l.id); clear("lines") }} placeholder="0" aria-label={`Return quantity of ${l.description}`} aria-invalid={!!errors[l.id]} />
                              )}
                              {errors[l.id] && <p className="mt-1 text-xs text-destructive">{errors[l.id]}</p>}
                            </td>
                            <td className="py-3 pr-5 text-right tabular-nums">{formatPaise(v.taxable + v.tax)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {errors.lines && <p className="border-t px-5 py-3 text-sm text-destructive">{errors.lines}</p>}
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="grid gap-5 xl:sticky xl:top-20">
          <section className="ui-surface grid gap-2 p-5 text-sm">
            <h2 className="mb-1 font-semibold">Return Summary</h2>
            <p className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatPaise(taxable)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">{formatPaise(tax)}</span></p>
            <p className="flex justify-between border-t pt-2 font-semibold"><span>Total Amount</span><span className="text-lg text-primary tabular-nums">{formatPaise(taxable + tax)}</span></p>
            <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">Saved as a draft. When it is completed, the stock goes out of {doc?.location?.name ?? "the warehouse"} and what you owe this supplier goes down by this amount.</p>
          </section>
          <section className="ui-surface p-5"><Field label={returnReason === "Other" ? "Why it is going back" : "Notes"} required={returnReason === "Other"} error={errors.notes}><Textarea value={note} onChange={(e) => { setNotes(e.target.value); clear("notes") }} rows={3} maxLength={1000} placeholder="e.g. 2 cartons wet on arrival" /></Field></section>
          <section className="ui-surface grid gap-2 p-5">
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><ShoppingCart className="size-4 text-primary" aria-hidden /> {chosen.length} item{chosen.length === 1 ? "" : "s"} selected for return</p>
            <FormError message={error} />
            <Button disabled={busy || (!!doc && !lines.length)} onClick={save}>{busy ? "Saving…" : draft ? "Save changes" : "Create Return"}</Button>
            <Link href={KIND_PATH.purchase_return} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
          </section>
        </aside>
      </div>
    </>
  )
}
