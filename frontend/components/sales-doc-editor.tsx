"use client"

import { StateSelect } from "@/components/search-select"
import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { MoneyInput } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ContactPicker, ItemPicker, type ContactOption } from "@/components/pickers"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { GST_RATES, PAYMENT_METHODS } from "@/lib/money"
import { GST_STATES, formatPaise } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { docApi, docLabel, docPath, previewTotals, roundOffOf, withoutGst, type DocKind, type DocLine, type SalesDoc } from "@/lib/sales"

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

const WALK_IN = "Walk-in customer"

/** cash = the counter bill: walk-in customer, no due date, money taken as it is issued. */
export function SalesDocEditor({ kind, doc, initialContact, cash = false }: { kind: DocKind; doc?: SalesDoc; initialContact?: ContactOption | null; cash?: boolean }) {
  const router = useRouter()
  const { me, can } = useAuth()
  const workspace = useApi<{ preferences: { taxes: { pricesIncludeTax: boolean; roundOff?: boolean; defaultGstRateBp: number } } }>(can("tenant.settings.view") ? "/tenant/workspace" : null)
  const taxes = workspace.data?.preferences.taxes
  const [walkIn, setWalkIn] = React.useState(doc ? !doc.contactId : cash)
  // New bills start from Settings › Taxes until the person ticks a box; the counter bill also follows "prices include GST"
  const [includeGstChoice, setIncludeGst] = React.useState<boolean | null>(doc ? false : null)
  const [roundOffChoice, setRoundOff] = React.useState<boolean | null>(doc ? !!doc.roundOffPaise : null)
  const includeGst = includeGstChoice ?? (cash && !!taxes?.pricesIncludeTax)
  const roundOff = roundOffChoice ?? (cash || !!taxes?.roundOff)
  const [method, setMethod] = React.useState("cash")
  const [contact, setContact] = React.useState<ContactOption | null>(
    doc?.contactId ? { id: doc.contactId, name: doc.buyer.name, gstin: doc.buyer.gstin, stateCode: doc.buyer.stateCode, phone: doc.buyer.phone } : (initialContact ?? null)
  )
  const [lines, setLines] = React.useState<DocLine[]>(doc?.lines.map((l) => ({ ...l, quantity: Number(l.quantity) })) ?? [])
  const [issueDate, setIssueDate] = React.useState(doc?.issueDate?.slice(0, 10) ?? today())
  const [dueDate, setDueDate] = React.useState(doc?.dueDate?.slice(0, 10) ?? (cash ? "" : kind === "invoice" ? addDays(today(), 15) : addDays(today(), kind === "sales_order" ? 7 : 30)))
  const [notes, setNotes] = React.useState(doc?.notes ?? "")
  const [terms, setTerms] = React.useState(doc?.terms ?? (kind === "quotation" ? "This quotation is valid for 30 days." : ""))
  const [posOverride, setPosOverride] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<"draft" | "issue" | "cash" | null>(null)

  const sellerState = me?.tenant?.billingStateCode ?? null
  const pos = posOverride || contact?.stateCode || (contact?.gstin ? contact.gstin.slice(0, 2) : null) || sellerState
  const intra = !sellerState || !pos || pos === sellerState
  const priced = includeGst ? withoutGst(lines) : lines
  const totals = previewTotals(priced, intra)
  const roundOffPaise = roundOff ? roundOffOf(totals.total) : 0

  const update = (i: number, patch: Partial<DocLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const addBlank = () => setLines((ls) => [...ls, { itemId: null, description: "", hsnSac: null, unit: "pcs", quantity: 1, unitPricePaise: 0, discountPaise: 0, gstRateBp: 1800 }])

  async function save(issue: boolean, takeMoney = false) {
    setBusy(takeMoney ? "cash" : issue ? "issue" : "draft")
    setError(null)
    setErrors({})
    const body = {
      contactId: walkIn ? null : contact?.id ?? null,
      buyer: walkIn ? { name: doc?.buyer.name || WALK_IN, stateCode: posOverride || null } : posOverride ? { name: contact?.companyName || contact?.name || "", stateCode: posOverride } : undefined,
      issueDate,
      dueDate: dueDate || null,
      notes: notes || null,
      terms: terms || null,
      pricesIncludeGst: includeGst,
      roundOff,
      lines: lines.map((l) => ({ itemId: l.itemId, description: l.description, hsnSac: l.hsnSac || null, unit: l.unit, quantity: Number(l.quantity), unitPricePaise: l.unitPricePaise, discountPaise: l.discountPaise || 0, gstRateBp: l.gstRateBp, sourceLineId: l.sourceLineId ?? null })),
    }
    try {
      let saved: SalesDoc
      if (takeMoney) {
        saved = await api.post<SalesDoc>("/invoices/cash-bill", { ...body, receive: { method } })
      } else if (doc) {
        saved = await api.put<SalesDoc>(`${docApi(kind)}/${doc.id}`, { ...body, version: doc.version })
        if (issue) saved = await api.post<SalesDoc>(`/invoices/${doc.id}/issue`)
      } else {
        saved = await api.post<SalesDoc>(docApi(kind), { ...body, issue })
      }
      toast.success(issue ? `Invoice ${saved.number} issued` : `${docLabel(kind)} saved`)
      router.replace(`/app/m/${docPath(kind)}/${saved.id}`)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer" error={errors.contactId} className="sm:col-span-2">
            <div>
              {walkIn ? <div className="flex h-9 items-center rounded-3xl bg-input/50 px-3 text-sm font-medium">{doc?.buyer.name || WALK_IN}</div> : <ContactPicker value={contact} onChange={setContact} allowCreate={can("crm.contact.create")} />}
              <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={walkIn} onChange={(e) => setWalkIn(e.target.checked)} /> Walk-in customer, no name needed
              </label>
            </div>
          </Field>
          <Field label={kind === "invoice" ? "Invoice date" : kind === "sales_order" ? "Order date" : "Quotation date"} error={errors.issueDate}>
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />
          </Field>
          <Field label={kind === "invoice" ? "Due date" : kind === "sales_order" ? "Deliver by" : "Valid until"}>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={issueDate} />
          </Field>
          <Field label="Place of supply" hint={intra ? "Same state: CGST + SGST" : "Other state: IGST"} className="sm:col-span-2">
            <StateSelect value={posOverride} onChange={setPosOverride} emptyLabel={pos ? `${GST_STATES.find(([c]) => c === pos)?.[1] ?? pos} (automatic)` : "Automatic"} />
          </Field>
          {!sellerState && kind === "invoice" && (
            <p className="rounded-2xl bg-amber-100 p-3 text-sm text-amber-950 sm:col-span-2 dark:bg-amber-950 dark:text-amber-100">
              Add your business state in Settings → Business before issuing, so GST can be calculated correctly.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Items</CardTitle>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeGst} onChange={(e) => setIncludeGst(e.target.checked)} /> Rates include GST</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} /> Round off</label>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {lines.length > 0 && (
            <div className="hidden grid-cols-[1fr_5rem_8rem_7rem_6rem_7rem_2rem] gap-2 px-1 text-xs font-medium text-muted-foreground lg:grid">
              <span>Description</span><span>Qty</span><span className="text-right">Rate</span><span className="text-right">Discount</span><span>GST</span><span className="text-right">Taxable</span><span />
            </div>
          )}
          {lines.map((l, i) => {
            const t = previewTotals(includeGst ? withoutGst([l]) : [l], intra)
            return (
              <div key={i} className="grid gap-2 rounded-3xl border p-3 lg:grid-cols-[1fr_5rem_8rem_7rem_6rem_7rem_2rem] lg:items-start lg:rounded-none lg:border-0 lg:border-b lg:p-1 lg:pb-3">
                <div className="grid gap-1">
                  <Input value={l.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="Description" aria-label="Description" aria-invalid={!!errors[`lines.${i}.description`]} />
                  <div className="flex gap-2">
                    <Input value={l.hsnSac ?? ""} onChange={(e) => update(i, { hsnSac: e.target.value.replace(/\D/g, "") || null })} placeholder="HSN/SAC" maxLength={8} className="h-8 w-28 text-xs" aria-label="HSN/SAC" />
                    <Input value={l.unit} onChange={(e) => update(i, { unit: e.target.value })} className="h-8 w-20 text-xs" aria-label="Unit" />
                  </div>
                </div>
                <Input inputMode="decimal" value={String(l.quantity)} onChange={(e) => update(i, { quantity: e.target.value.replace(/[^\d.]/g, "") })} aria-label="Quantity" className="tabular-nums" />
                <MoneyInput value={l.unitPricePaise} onChange={(v) => update(i, { unitPricePaise: v ?? 0 })} aria-label="Rate" />
                <MoneyInput value={l.discountPaise} onChange={(v) => update(i, { discountPaise: v ?? 0 })} aria-label="Discount" />
                <NativeSelect value={l.gstRateBp} onChange={(e) => update(i, { gstRateBp: Number(e.target.value) })} aria-label="GST rate">
                  {GST_RATES.map((r) => <option key={r.bp} value={r.bp}>{r.label}</option>)}
                </NativeSelect>
                <div className="flex h-9 items-center justify-end text-sm font-medium tabular-nums">{formatPaise(t.taxable)}</div>
                <Button variant="ghost" size="icon-sm" className="mt-0.5 justify-self-end" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line"><Trash2 /></Button>
              </div>
            )
          })}
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <ItemPicker allowCreate={can("catalog.item.create")} defaultGstRateBp={taxes?.defaultGstRateBp} onPick={(it) => setLines((ls) => [...ls, { itemId: it.id, description: it.name, hsnSac: it.hsnSac, unit: it.unit, quantity: 1, unitPricePaise: it.pricePaise, discountPaise: 0, gstRateBp: it.gstRateBp }])} />
            <Button variant="outline" onClick={addBlank}><Plus /> Custom line</Button>
          </div>
          {errors.lines && <p className="text-xs text-destructive">{errors.lines}</p>}

          <dl className="ml-auto grid w-full max-w-xs gap-1.5 pt-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{formatPaise(totals.subtotal)}</dd></div>
            {totals.discount > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Discount</dt><dd className="tabular-nums">−{formatPaise(totals.discount)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted-foreground">Taxable value</dt><dd className="tabular-nums">{formatPaise(totals.taxable)}</dd></div>
            {intra ? (
              <>
                <div className="flex justify-between"><dt className="text-muted-foreground">CGST</dt><dd className="tabular-nums">{formatPaise(totals.cgst)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">SGST</dt><dd className="tabular-nums">{formatPaise(totals.sgst)}</dd></div>
              </>
            ) : (
              <div className="flex justify-between"><dt className="text-muted-foreground">IGST</dt><dd className="tabular-nums">{formatPaise(totals.igst)}</dd></div>
            )}
            {roundOffPaise !== 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Round off</dt><dd className="tabular-nums">{formatPaise(roundOffPaise)}</dd></div>}
            <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatPaise(totals.total + roundOffPaise)}</dd></div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <Field label="Notes for the customer"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></Field>
          <Field label="Terms & conditions"><Textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} /></Field>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <FormError message={error} />
        <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button variant={kind === "invoice" ? "outline" : "default"} onClick={() => save(false)} disabled={!!busy || lines.length === 0}>
          {busy === "draft" ? "Saving…" : kind === "invoice" ? "Save draft" : `Save ${docLabel(kind).toLowerCase()}`}
        </Button>
        {kind === "invoice" && (
          <Button onClick={() => save(true)} variant={cash ? "outline" : "default"} disabled={!!busy || lines.length === 0 || (!contact && !walkIn)}>{busy === "issue" ? "Issuing…" : "Save & issue"}</Button>
        )}
        {cash && !doc && (
          <>
            <div className="w-32">
              <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Paid by">
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            </div>
            <Button onClick={() => save(true, true)} disabled={!!busy || lines.length === 0 || (!contact && !walkIn)}>{busy === "cash" ? "Saving…" : "Issue & mark paid"}</Button>
          </>
        )}
      </div>
    </div>
  )
}
