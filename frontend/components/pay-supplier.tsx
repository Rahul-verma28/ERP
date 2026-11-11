"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle2, MessageCircle } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { MoneyInput, Spinner } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { SupplierPicker, type ContactOption } from "@/components/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHODS } from "@/lib/money"
import { cn } from "@/lib/utils"

// The one "Pay supplier" form, on Payments Made and the purchase invoice page. One payment can
// clear several invoices of a supplier, all under one payment number. What is paid goes on invoices.

export interface SupplierPayment {
  id: string
  number: string
  paidOn: string
  method: string
  reference: string | null
  contactId: string
  supplier: string
  supplierPhone: string | null
  amountPaise: number
  reversed: boolean
  reversal: { number: string; paidOn: string } | null
  appliedTo: { id: string; paymentId: string; number: string | null; supplierRef: string | null; amountPaise: number }[]
}
interface OpenBill { id: string; number: string | null; supplierRef: string | null; date: string; dueDate: string | null; duePaise: number; overdue: boolean }

export const methodLabel = (m: string) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m
const REFERENCE: Record<string, { label: string; placeholder: string; required: boolean }> = {
  cash: { label: "Reference", placeholder: "Optional", required: false },
  upi: { label: "UPI reference", placeholder: "12-digit UPI ref", required: false },
  card: { label: "Card slip / approval no.", placeholder: "Optional", required: false },
  bank: { label: "UTR / bank reference", placeholder: "UTR from the bank", required: true },
  cheque: { label: "Cheque number", placeholder: "6-digit cheque no.", required: true },
  other: { label: "Reference", placeholder: "Optional", required: false },
}
/** Section 40A(3) Income Tax Act: cash above ₹10,000 a day to one party is not a business expense */
const CASH_LIMIT = 1_000_000
const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, "")
  return d.length === 10 ? `91${d}` : d
}
const billName = (b: { number: string | null; supplierRef: string | null }) => b.supplierRef ?? b.number ?? "Invoice"

/** Tell the supplier what was paid against which of their invoices */
export function adviceMessage(p: SupplierPayment, business: string) {
  return [
    `Hello ${p.supplier}, payment sent from ${business}.`,
    `${formatPaise(p.amountPaise)} on ${formatDate(p.paidOn)} by ${methodLabel(p.method)}${p.reference ? ` (${p.reference})` : ""}. Our ref ${p.number}.`,
    `Against your invoices: ${p.appliedTo.map((a) => `${billName(a)} ${formatPaise(a.amountPaise)}`).join(", ")}`,
  ].join("\n")
}

export function AdviceButton({ payment }: { payment: SupplierPayment }) {
  const { me } = useAuth()
  return payment.supplierPhone ? (
    <a href={`https://wa.me/${waNumber(payment.supplierPhone)}?text=${encodeURIComponent(adviceMessage(payment, me?.tenant?.name ?? ""))}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><MessageCircle /> Send on WhatsApp</a>
  ) : (
    <span className={cn(buttonVariants({ variant: "outline" }), "pointer-events-none opacity-40")} title="No mobile number on this supplier" aria-disabled><MessageCircle /> Send on WhatsApp</span>
  )
}

function oldestFirst(bills: OpenBill[], amount: number) {
  let left = amount
  const out: Record<string, number> = {}
  for (const b of bills) {
    if (left <= 0) break
    const put = Math.min(left, b.duePaise)
    out[b.id] = put
    left -= put
  }
  return out
}

export function PaySupplierDialog({ initial, bill, onClose, onSaved }: {
  initial: ContactOption | null
  /** The invoice this was opened from: its due is filled in */
  bill?: { id: string; duePaise: number }
  onClose: () => void
  onSaved: (p: SupplierPayment) => void
}) {
  const today = todayInIndia()
  const [supplier, setSupplier] = React.useState<ContactOption | null>(initial)
  const [amount, setAmount] = React.useState<number | null>(bill ? bill.duePaise : null)
  const [paidOn, setPaidOn] = React.useState(today)
  const [method, setMethod] = React.useState("bank")
  const [reference, setReference] = React.useState("")
  const [put, setPut] = React.useState<Record<string, number | null>>(bill ? { [bill.id]: bill.duePaise } : {})
  const [touched, setTouched] = React.useState(!!bill)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [saved, setSaved] = React.useState<SupplierPayment | null>(null)
  const bills = useApi<{ data: OpenBill[] }>(supplier ? `/suppliers/${supplier.id}/open-bills` : null)
  const open = bills.data?.data ?? []
  const totalDue = open.reduce((s, b) => s + b.duePaise, 0)
  const ref = REFERENCE[method]
  const shares = touched ? put : oldestFirst(open, amount ?? 0)
  const onBills = open.reduce((s, b) => s + (shares[b.id] ?? 0), 0)
  const left = (amount ?? 0) - onBills
  const clear = (key: string) => { setErrors((e) => (e[key] ? { ...e, [key]: "" } : e)); setError(null) }

  function setShare(id: string, v: number | null) {
    setPut({ ...(touched ? put : shares), [id]: v })
    setTouched(true)
    clear(`bill.${id}`)
    clear("allocations")
  }

  function check() {
    const e: Record<string, string> = {}
    if (!supplier) e.contactId = "Choose the supplier"
    if (!amount || amount <= 0) e.amountPaise = "Enter the amount paid"
    else if (supplier && open.length && amount > totalDue) e.amountPaise = `Only ${formatPaise(totalDue)} is due to this supplier`
    if (!paidOn) e.paidOn = "Choose the date"
    else if (paidOn > today) e.paidOn = "Can't be in the future"
    if (ref.required && !reference.trim()) e.reference = method === "cheque" ? "Enter the cheque number" : method === "bank" ? "Enter the UTR or bank reference" : "Enter the reference"
    if (method === "cash" && (amount ?? 0) > CASH_LIMIT) e.method = "Cash above ₹10,000 a day to one supplier isn't allowed as an expense (Section 40A(3)). Pay by bank or UPI."
    for (const b of open) if ((shares[b.id] ?? 0) > b.duePaise) e[`bill.${b.id}`] = `Only ${formatPaise(b.duePaise)} is due`
    if (supplier && !open.length) e.allocations = "This supplier has no unpaid invoices. Post their invoice first, then pay it."
    else if (amount && left !== 0) e.allocations = left > 0 ? `${formatPaise(left)} is not put on any invoice` : `${formatPaise(-left)} more is put on invoices than paid`
    const clean = Object.fromEntries(Object.entries(e).filter(([, v]) => v))
    setErrors(clean)
    return Object.keys(clean).length === 0
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    if (!check()) return setError("Fix the marked fields first.")
    setBusy(true)
    const allocations = open.filter((b) => (shares[b.id] ?? 0) > 0).map((b) => ({ documentId: b.id, amountPaise: shares[b.id]! }))
    try {
      setSaved(await api.post<SupplierPayment>("/payments-made", { contactId: supplier!.id, amountPaise: amount, paidOn, method, reference: reference.trim() || null, allocations }))
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
            <DialogDescription>{saved.number} · {formatPaise(saved.amountPaise)} to {saved.supplier}</DialogDescription>
          </div>
          <dl className="grid gap-1 rounded-2xl bg-muted/60 p-4 text-sm">
            {saved.appliedTo.map((a) => <div key={a.paymentId} className="flex justify-between"><dt className="font-mono text-xs">{billName(a)}</dt><dd className="tabular-nums">{formatPaise(a.amountPaise)}</dd></div>)}
          </dl>
          <div className="flex justify-center"><AdviceButton payment={saved} /></div>
          <DialogFooter><Button className="w-full" onClick={() => onSaved(saved)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pay supplier</DialogTitle>
          <DialogDescription>Money you paid a supplier. Put it on their invoices, oldest first unless you change it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-5" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier" required error={errors.contactId} className="sm:col-span-2">
              {bill ? <div className="flex h-10 items-center rounded-xl border bg-muted/40 px-3 text-sm font-medium">{supplier?.companyName || supplier?.name}</div> : <SupplierPicker value={supplier} allowCreate={false} onChange={(c) => { setSupplier(c); setPut({}); setTouched(false); clear("contactId"); clear("allocations") }} />}
            </Field>
            <Field label="Amount paid" required error={errors.amountPaise} hint={supplier && totalDue > 0 ? `You owe ${formatPaise(totalDue)} on ${open.length} invoice${open.length === 1 ? "" : "s"}` : undefined}>
              <div className="flex gap-2">
                <MoneyInput value={amount} autoFocus onChange={(v) => { setAmount(v); clear("amountPaise"); clear("allocations"); clear("method") }} aria-label="Amount paid" />
                {supplier && totalDue > 0 && <Button type="button" variant="outline" onClick={() => { setAmount(totalDue); setTouched(false); clear("amountPaise") }}>Full due</Button>}
              </div>
            </Field>
            <Field label="Date" required error={errors.paidOn}><Input type="date" value={paidOn} max={today} onChange={(e) => { setPaidOn(e.target.value); clear("paidOn") }} /></Field>
            <Field label="Paid by" required error={errors.method}>
              <NativeSelect value={method} onChange={(e) => { setMethod(e.target.value); clear("reference"); clear("method") }} aria-label="Paid by">
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label={ref.label} required={ref.required} error={errors.reference}>
              <Input value={reference} maxLength={100} placeholder={ref.placeholder} onChange={(e) => { setReference(e.target.value); clear("reference") }} />
            </Field>
          </div>

          {supplier && (
            <section className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Put it on invoices</h3>
                {open.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => { setTouched(false); setPut({}) }}>Oldest first</Button>}
              </div>
              {bills.loading && !bills.data ? (
                <div className="grid place-items-center py-6"><Spinner /></div>
              ) : open.length === 0 ? (
                <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">No unpaid invoices from this supplier.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Their invoice</th>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Due date</th>
                        <th className="px-3 py-2 text-right font-medium">Due</th>
                        <th className="px-4 py-2 text-right font-medium">Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {open.map((b) => (
                        <tr key={b.id} className={cn("border-b border-border/60 align-top last:border-0", b.id === bill?.id && "bg-primary/5")}>
                          <td className="px-4 py-2.5"><span className="font-mono text-xs font-medium">{billName(b)}</span>{b.supplierRef && b.number && <span className="block text-xs text-muted-foreground">{b.number}</span>}</td>
                          <td className="px-3 py-2.5">{formatDate(b.date)}</td>
                          <td className={cn("px-3 py-2.5", b.overdue && "text-destructive")}>{b.dueDate ? formatDate(b.dueDate) : "—"}{b.overdue && <span className="block text-xs">Overdue</span>}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatPaise(b.duePaise)}</td>
                          <td className="px-4 py-2">
                            <div className="ml-auto w-36">
                              <MoneyInput value={shares[b.id] ?? null} onChange={(v) => setShare(b.id, v)} aria-label={`Payment on ${billName(b)}`} aria-invalid={!!errors[`bill.${b.id}`]} />
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

          <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Paid</dt><dd className="tabular-nums">{formatPaise(amount ?? 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Put on invoices</dt><dd className="tabular-nums">{formatPaise(onBills)}</dd></div>
            <div className={cn("flex justify-between font-semibold", left !== 0 && "text-destructive")}><dt>{left < 0 ? "More than paid" : "Not put on invoices"}</dt><dd className="tabular-nums">{formatPaise(Math.abs(left))}</dd></div>
          </dl>
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

export function SupplierPaymentDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: p, error } = useApi<SupplierPayment>(`/payments-made/${id}`)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{p ? `Payment ${p.number}` : "Payment"}</DialogTitle>
          {p && <DialogDescription>{p.supplier} · {formatDate(p.paidOn)}</DialogDescription>}
        </DialogHeader>
        {error ? <p className="text-sm text-muted-foreground">{error.message}</p> : !p ? <div className="grid place-items-center py-8"><Spinner /></div> : (
          <div className="grid gap-4 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div><dt className="text-xs text-muted-foreground">Amount</dt><dd className="text-lg font-semibold tabular-nums">{formatPaise(p.amountPaise)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Paid by</dt><dd>{methodLabel(p.method)}{p.reference ? ` · ${p.reference}` : ""}</dd></div>
              {p.reversed && <div className="col-span-2 rounded-xl bg-muted px-3 py-2">Reversed by {p.reversal?.number} on {formatDate(p.reversal!.paidOn)}</div>}
            </dl>
            <div>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Against their invoices</h3>
              <ul className="grid gap-1.5">
                {p.appliedTo.map((a) => (
                  <li key={a.paymentId} className="flex justify-between gap-2">
                    <Link href={`/app/m/purchase/${a.id}`} className="font-mono text-xs hover:text-primary hover:underline">{billName(a)}</Link>
                    <span className="tabular-nums">{formatPaise(a.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            </div>
            {!p.reversed && <AdviceButton payment={p} />}
            <Link href={`/app/m/purchase/suppliers/${p.contactId}`} className={buttonVariants({ variant: "ghost" })}>Open supplier</Link>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
