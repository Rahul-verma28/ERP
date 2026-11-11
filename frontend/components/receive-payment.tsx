"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle2, MessageCircle, Printer } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { MoneyInput, Spinner } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ContactPicker, type ContactOption } from "@/components/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHODS } from "@/lib/money"
import type { SalesDoc } from "@/lib/sales"
import { cn } from "@/lib/utils"

// The one "Receive payment" form, on Payments Received, the invoice page and the customer page.
// One payment can clear several bills; what is not put on a bill stays as the customer's advance.
// Once saved it offers the receipt: print it, or send it on WhatsApp.

export interface Applied { id: string; kind: string; number: string | null; amountPaise: number }
export interface Receipt {
  id: string
  number: string
  paidOn: string
  amountPaise: number
  method: string
  reference: string | null
  notes: string | null
  contactId: string | null
  customer: string | null
  customerPhone?: string | null
  reversed: boolean
  reversal: { number: string; paidOn: string } | null
  advance: boolean
  appliedTo: Applied[]
  unusedPaise: number
}
interface OpenBill { id: string; kind: string; number: string | null; issueDate: string; dueDate: string | null; duePaise: number; overdue: boolean }

export const methodLabel = (m: string) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m
export const billHref = (b: { id: string; kind: string }) => (b.kind === "debit_note" ? `/app/m/billing/debit-notes/${b.id}` : b.kind === "invoice" ? `/app/m/billing/${b.id}` : null)
export const KIND_LABEL: Record<string, string> = { invoice: "Invoice", debit_note: "Debit note", opening_balance: "Opening balance" }
const REFERENCE: Record<string, { label: string; placeholder: string; required: boolean }> = {
  cash: { label: "Reference", placeholder: "Optional", required: false },
  upi: { label: "UPI reference", placeholder: "12-digit UPI ref", required: false },
  card: { label: "Card slip / approval no.", placeholder: "Optional", required: false },
  bank: { label: "UTR / bank reference", placeholder: "UTR from the bank", required: true },
  cheque: { label: "Cheque number", placeholder: "6-digit cheque no.", required: true },
  other: { label: "Reference", placeholder: "Optional", required: false },
}

/** wa.me needs the country code; Indian mobiles are stored as 10 digits or +91… */
const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, "")
  return d.length === 10 ? `91${d}` : d
}

/** The receipt as a WhatsApp message, with the link to the printable receipt */
export function receiptMessage(r: Receipt, business: string, origin: string) {
  const bills = r.appliedTo.map((a) => a.number ?? KIND_LABEL[a.kind]).join(", ")
  return [
    `Hello ${r.customer ?? ""}, thank you for your payment.`,
    `Receipt ${r.number} · ${formatDate(r.paidOn)}`,
    `Received ${formatPaise(r.amountPaise)} by ${methodLabel(r.method)}${r.reference ? ` (${r.reference})` : ""}.`,
    ...(bills ? [`Against: ${bills}`] : []),
    ...(r.unusedPaise > 0 ? [`${formatPaise(r.unusedPaise)} is kept as advance for your next bill.`] : []),
    `Receipt: ${origin}/print/receipt/${r.id}`,
    `— ${business}`,
  ].join("\n")
}

/** Print and WhatsApp buttons for one receipt */
export function ReceiptActions({ receipt, className }: { receipt: Receipt; className?: string }) {
  const { me } = useAuth()
  const origin = typeof window === "undefined" ? "" : window.location.origin
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <a href={`/print/receipt/${receipt.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><Printer /> Print receipt</a>
      {receipt.customerPhone ? (
        <a href={`https://wa.me/${waNumber(receipt.customerPhone)}?text=${encodeURIComponent(receiptMessage(receipt, me?.tenant?.name ?? "", origin))}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><MessageCircle /> Send on WhatsApp</a>
      ) : (
        <span className={cn(buttonVariants({ variant: "outline" }), "pointer-events-none opacity-40")} title="No mobile number on this customer" aria-disabled><MessageCircle /> Send on WhatsApp</span>
      )}
    </div>
  )
}

/** Put the amount on the oldest bills first. */
function oldestFirst(bills: OpenBill[], amount: number) {
  let left = amount
  const out: Record<string, number> = {}
  for (const b of bills) {
    if (left <= 0) break
    // A split goes on invoices only; an opening balance or debit note takes a payment of its own
    if (b.kind !== "invoice" && bills.length > 1) continue
    const put = Math.min(left, b.duePaise)
    out[b.id] = put
    left -= put
  }
  return out
}

/**
 * `initial`: the customer, when known. `bill`: the invoice this was opened from; its due is filled in.
 * A bill without a customer (walk-in) takes the payment on that bill only.
 */
export function ReceiveDialog({ initial, bill, onClose, onSaved }: {
  initial: ContactOption | null
  bill?: { id: string; number: string | null; duePaise: number; contactId: string | null }
  onClose: () => void
  /** Called on Done, after the receipt was shown */
  onSaved: (receipt: Receipt) => void
}) {
  const today = todayInIndia()
  const walkIn = !!bill && !bill.contactId
  const [contact, setContact] = React.useState<ContactOption | null>(initial)
  const [amount, setAmount] = React.useState<number | null>(bill ? bill.duePaise : null)
  const [paidOn, setPaidOn] = React.useState(today)
  const [method, setMethod] = React.useState(walkIn ? "cash" : "upi")
  const [reference, setReference] = React.useState("")
  const [notes, setNotes] = React.useState("")
  // Opened from a bill: the payment goes on that bill until changed by hand
  const [put, setPut] = React.useState<Record<string, number | null>>(bill ? { [bill.id]: bill.duePaise } : {})
  const [touched, setTouched] = React.useState(!!bill)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [saved, setSaved] = React.useState<Receipt | null>(null)
  const bills = useApi<{ data: OpenBill[] }>(contact && !walkIn ? `/customers/${contact.id}/open-bills` : null)
  const open = walkIn ? [] : bills.data?.data ?? []
  const totalDue = open.reduce((s, b) => s + b.duePaise, 0)
  const ref = REFERENCE[method]

  // Until a row is changed by hand, the amount goes on the oldest bills first
  const shares = touched ? put : oldestFirst(open, amount ?? 0)
  const onBills = walkIn ? amount ?? 0 : open.reduce((s, b) => s + (shares[b.id] ?? 0), 0)
  const advance = (amount ?? 0) - onBills
  const clear = (key: string) => { setErrors((e) => (e[key] ? { ...e, [key]: "" } : e)); setError(null) }

  function chooseContact(c: ContactOption | null) {
    setContact(c)
    setPut({})
    setTouched(false)
    clear("contactId")
  }
  function setShare(id: string, v: number | null) {
    setPut({ ...(touched ? put : shares), [id]: v })
    setTouched(true)
    clear(`bill.${id}`)
    clear("allocations")
  }

  function check() {
    const e: Record<string, string> = {}
    if (!walkIn && !contact) e.contactId = "Choose the customer"
    if (!amount || amount <= 0) e.amountPaise = "Enter the amount received"
    else if (walkIn && amount > bill!.duePaise) e.amountPaise = `Only ${formatPaise(bill!.duePaise)} is due on this bill`
    if (!paidOn) e.paidOn = "Choose the date"
    else if (paidOn > today) e.paidOn = "Can't be in the future"
    if (ref.required && !reference.trim()) e.reference = method === "cheque" ? "Enter the cheque number" : method === "bank" ? "Enter the UTR or bank reference" : "Enter the reference"
    for (const b of open) {
      const v = shares[b.id] ?? 0
      if (v > b.duePaise) e[`bill.${b.id}`] = `Only ${formatPaise(b.duePaise)} is due`
    }
    if (!walkIn && amount && onBills > amount) e.allocations = `${formatPaise(onBills)} is put on bills but only ${formatPaise(amount)} was received`
    const chosen = open.filter((b) => (shares[b.id] ?? 0) > 0)
    if (chosen.length > 1 && chosen.some((b) => b.kind !== "invoice")) e.allocations = "Receive the opening balance or debit note on its own, then the invoices"
    if (chosen.length === 1 && chosen[0].kind !== "invoice" && onBills !== amount) e.allocations = "An opening balance or debit note takes the whole payment. Put it all on that bill or receive it separately."
    const clean = Object.fromEntries(Object.entries(e).filter(([, v]) => v))
    setErrors(clean)
    return Object.keys(clean).length === 0
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    if (!check()) return setError("Fix the marked fields first.")
    setBusy(true)
    const pay = { amountPaise: amount, paidOn, method, reference: reference.trim() || null, notes: notes.trim() || null }
    const allocations = open.filter((b) => (shares[b.id] ?? 0) > 0).map((b) => ({ documentId: b.id, amountPaise: shares[b.id]! }))
    try {
      if (walkIn) {
        // A walk-in bill has no customer to hold an advance: the payment goes on this bill
        const doc = await api.post<SalesDoc>(`/invoices/${bill!.id}/payments`, pay)
        const latest = [...(doc.payments ?? [])].filter((p) => !p.reversesId).pop()
        setSaved(latest ? await api.get<Receipt>(`/payments/${latest.id}`) : null)
      } else {
        setSaved(await api.post<Receipt>("/receipts", { ...pay, contactId: contact!.id, allocations }))
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const mapped: Record<string, string> = {}
        for (const [k, v] of Object.entries(err.fields)) {
          const m = /^allocations\.(\d+)\./.exec(k)
          mapped[m ? `bill.${allocations[Number(m[1])]?.documentId}` : k] = v
        }
        setErrors(mapped)
      }
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (saved) {
    return (
      <Dialog open onOpenChange={(o) => !o && onSaved(saved)}>
        <DialogContent className="sm:max-w-md">
          <div className="grid justify-items-center gap-2 pt-2 text-center">
            <CheckCircle2 className="size-12 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <DialogTitle>Payment saved</DialogTitle>
            <DialogDescription>{saved.number} · {formatPaise(saved.amountPaise)} from {saved.customer ?? "the customer"}</DialogDescription>
          </div>
          <dl className="grid gap-1 rounded-2xl bg-muted/60 p-4 text-sm">
            {saved.appliedTo.map((a) => <div key={a.id} className="flex justify-between"><dt className="font-mono text-xs">{a.number ?? KIND_LABEL[a.kind]}</dt><dd className="tabular-nums">{formatPaise(a.amountPaise)}</dd></div>)}
            {saved.unusedPaise > 0 && <div className="flex justify-between font-medium text-primary"><dt>Kept as advance</dt><dd className="tabular-nums">{formatPaise(saved.unusedPaise)}</dd></div>}
          </dl>
          <ReceiptActions receipt={saved} className="justify-center" />
          <DialogFooter><Button className="w-full" onClick={() => onSaved(saved)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto", walkIn ? "sm:max-w-lg" : "sm:max-w-3xl")}>
        <DialogHeader>
          <DialogTitle>Receive payment</DialogTitle>
          <DialogDescription>{walkIn ? `Due on ${bill!.number}: ${formatPaise(bill!.duePaise)}` : "Money from a customer. Put it on their bills; anything left stays as an advance."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-5" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            {!walkIn && (
              <Field label="Customer" required error={errors.contactId} className="sm:col-span-2">
                {bill ? <div className="flex h-10 items-center rounded-xl border bg-muted/40 px-3 text-sm font-medium">{contact?.companyName || contact?.name}</div> : <ContactPicker value={contact} onChange={chooseContact} />}
              </Field>
            )}
            <Field label="Amount received" required error={errors.amountPaise} hint={!walkIn && contact && totalDue > 0 ? `They owe ${formatPaise(totalDue)} on ${open.length} bill${open.length === 1 ? "" : "s"}` : undefined}>
              <div className="flex gap-2">
                <MoneyInput value={amount} autoFocus onChange={(v) => { setAmount(v); clear("amountPaise"); clear("allocations") }} aria-label="Amount received" />
                {!walkIn && contact && totalDue > 0 && <Button type="button" variant="outline" onClick={() => { setAmount(totalDue); setTouched(false); clear("amountPaise") }}>Full due</Button>}
              </div>
            </Field>
            <Field label="Date" required error={errors.paidOn}><Input type="date" value={paidOn} max={today} onChange={(e) => { setPaidOn(e.target.value); clear("paidOn") }} /></Field>
            <Field label="Paid by" required>
              <NativeSelect value={method} onChange={(e) => { setMethod(e.target.value); clear("reference") }} aria-label="Paid by">
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label={ref.label} required={ref.required} error={errors.reference}>
              <Input value={reference} maxLength={100} placeholder={ref.placeholder} onChange={(e) => { setReference(e.target.value); clear("reference") }} />
            </Field>
          </div>

          {!walkIn && contact && (
            <section className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Put it on bills</h3>
                {open.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => { setTouched(false); setPut({}) }}>Oldest first</Button>}
              </div>
              {bills.loading && !bills.data ? (
                <div className="grid place-items-center py-6"><Spinner /></div>
              ) : open.length === 0 ? (
                <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">No open bills. The whole amount is kept as an advance for their next invoice.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Bill</th>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Due date</th>
                        <th className="px-3 py-2 text-right font-medium">Due</th>
                        <th className="px-4 py-2 text-right font-medium">Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {open.map((b) => (
                        <tr key={b.id} className={cn("border-b border-border/60 align-top last:border-0", b.id === bill?.id && "bg-primary/5")}>
                          <td className="px-4 py-2.5"><span className="font-mono text-xs font-medium">{b.number ?? KIND_LABEL[b.kind]}</span>{b.kind !== "invoice" && b.number && <span className="block text-xs text-muted-foreground">{KIND_LABEL[b.kind]}</span>}</td>
                          <td className="px-3 py-2.5">{formatDate(b.issueDate)}</td>
                          <td className={cn("px-3 py-2.5", b.overdue && "text-destructive")}>{b.dueDate ? formatDate(b.dueDate) : "—"}{b.overdue && <span className="block text-xs">Overdue</span>}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatPaise(b.duePaise)}</td>
                          <td className="px-4 py-2">
                            <div className="ml-auto w-36">
                              <MoneyInput value={shares[b.id] ?? null} onChange={(v) => setShare(b.id, v)} aria-label={`Payment on ${b.number ?? KIND_LABEL[b.kind]}`} aria-invalid={!!errors[`bill.${b.id}`]} />
                              {errors[`bill.${b.id}`] && <p className="mt-1 text-right text-xs text-destructive">{errors[`bill.${b.id}`]}</p>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {errors.allocations && <p className="text-sm text-destructive">{errors.allocations}</p>}
            </section>
          )}

          <Field label="Note"><Input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. paid by son" /></Field>

          {!walkIn && (
            <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Received</dt><dd className="tabular-nums">{formatPaise(amount ?? 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Put on bills</dt><dd className="tabular-nums">{formatPaise(onBills)}</dd></div>
              <div className={cn("flex justify-between font-semibold", advance < 0 && "text-destructive")}><dt>{advance < 0 ? "More than received" : "Kept as advance"}</dt><dd className="tabular-nums">{formatPaise(Math.abs(advance))}</dd></div>
            </dl>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save payment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** One receipt: where its money went, with print and WhatsApp */
export function ReceiptDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: r, error } = useApi<Receipt>(`/payments/${id}`)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{r ? `Receipt ${r.number}` : "Receipt"}</DialogTitle>
          {r && <DialogDescription>{r.customer ?? "—"} · {formatDate(r.paidOn)}</DialogDescription>}
        </DialogHeader>
        {error ? <p className="text-sm text-muted-foreground">{error.message}</p> : !r ? <div className="grid place-items-center py-8"><Spinner /></div> : (
          <div className="grid gap-4 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div><dt className="text-xs text-muted-foreground">Amount</dt><dd className="text-lg font-semibold tabular-nums">{formatPaise(r.amountPaise)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Paid by</dt><dd>{methodLabel(r.method)}{r.reference ? ` · ${r.reference}` : ""}</dd></div>
              {r.notes && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Note</dt><dd>{r.notes}</dd></div>}
              {r.reversed && <div className="col-span-2 rounded-xl bg-muted px-3 py-2">Reversed by {r.reversal?.number} on {formatDate(r.reversal!.paidOn)}</div>}
            </dl>
            <div>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Put on</h3>
              {r.appliedTo.length === 0 ? <p className="text-muted-foreground">No bills yet.</p> : (
                <ul className="grid gap-1.5">
                  {r.appliedTo.map((a) => {
                    const href = billHref(a)
                    return (
                      <li key={a.id} className="flex justify-between gap-2">
                        {href ? <Link href={href} className="font-mono text-xs hover:text-primary hover:underline">{a.number}</Link> : <span className="text-xs">{a.number ?? KIND_LABEL[a.kind]}</span>}
                        <span className="tabular-nums">{formatPaise(a.amountPaise)}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
              {r.unusedPaise > 0 && <p className="mt-2 flex justify-between font-medium text-primary"><span>Advance left</span><span className="tabular-nums">{formatPaise(r.unusedPaise)}</span></p>}
            </div>
            {!r.reversed && <ReceiptActions receipt={r} />}
            {r.contactId && <Link href={`/app/m/sales/customers/${r.contactId}`} className={buttonVariants({ variant: "ghost" })}>Open customer</Link>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
