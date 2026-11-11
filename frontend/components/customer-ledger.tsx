"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Download, IndianRupee, MessageCircle, Pencil, Printer, Trash2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog, MoneyInput, Spinner } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { downloadCsv } from "@/lib/csv"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHODS } from "@/lib/money"
import { useApi } from "@/lib/use-api"

// The customer's khata: everything billed and received, with a running balance.
// Above zero the customer owes; below zero the business holds the customer's money.

export interface LedgerRow {
  id: string
  date: string
  type: string
  number: string | null
  documentId: string | null
  against: string | null
  method: string | null
  reference: string | null
  debitPaise: number
  creditPaise: number
  balancePaise: number
}
export interface Ledger {
  contact: { id: string; name: string; phone: string | null; email: string | null; gstin: string | null; address: Record<string, string> | null; creditLimitPaise: number | null }
  from: string | null
  to: string | null
  broughtForwardPaise: number
  rows: LedgerRow[]
  closingPaise: number
  balancePaise: number
  advancePaise: number
  creditPaise: number
  aging: { label: string; amountPaise: number }[]
  openingBalance: { id: string; date: string; totalPaise: number; paidPaise: number } | null
}

const methodLabel = (m: string | null) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m ?? ""

export function ledgerDocument(r: LedgerRow) {
  const label: Record<string, string> = {
    invoice: "Invoice",
    credit_note: "Credit note",
    debit_note: "Debit note",
    opening_balance: "Opening balance",
    receipt: `Payment · ${methodLabel(r.method)}${r.against ? ` · ${r.against}` : ""}`,
    advance: `Advance · ${methodLabel(r.method)}`,
    refund: `Refund · ${methodLabel(r.method)}${r.against ? ` · ${r.against}` : ""}`,
    reversal: `Reversal${r.against ? ` · ${r.against}` : ""}`,
  }
  return { label: label[r.type] ?? r.type, number: r.number }
}

/** "₹5,000.00" when owed; "₹5,000.00 Cr" when the business holds the customer's money. */
export const ledgerBalance = (paise: number) => (paise < 0 ? `${formatPaise(-paise)} Cr` : formatPaise(paise))

export const ledgerHref = (r: LedgerRow) =>
  r.type === "invoice" ? `/app/m/billing/${r.id}` : r.type === "credit_note" ? `/app/m/billing/credit-notes/${r.id}` : r.type === "debit_note" ? `/app/m/billing/debit-notes/${r.id}` : r.type === "receipt" && r.documentId && r.against ? `/app/m/billing/${r.documentId}` : null

/** Start of the financial year holding today, as YYYY-MM-DD. */
export function fyStart(today: string, startMonth: number) {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  return `${m >= startMonth ? y : y - 1}-${String(startMonth).padStart(2, "0")}-01`
}

export function OpeningDialog({ contactId, current, onClose, onSaved }: { contactId: string; current: Ledger["openingBalance"]; onClose: () => void; onSaved: () => void }) {
  const { me } = useAuth()
  const today = todayInIndia()
  const [amount, setAmount] = React.useState<number | null>(current?.totalPaise ?? null)
  const [date, setDate] = React.useState(current?.date.slice(0, 10) ?? fyStart(today, me?.tenant?.fyStartMonth ?? 4))
  const [error, setError] = React.useState<string | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!amount) return setErrors({ amountPaise: "Enter an amount" })
    setBusy(true)
    setError(null)
    try {
      await api.put(`/customers/${contactId}/opening-balance`, { amountPaise: amount, date })
      toast.success("Opening balance saved")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Opening balance</DialogTitle>
          <DialogDescription>What this customer already owed you before you started using AHEAD. It is not counted as a sale.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount owed" error={errors.amountPaise}><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
            <Field label="As on date" error={errors.date}><Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <FormError message={error} />
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function OpeningPaymentDialog({ opening, onClose, onSaved }: { opening: NonNullable<Ledger["openingBalance"]>; onClose: () => void; onSaved: () => void }) {
  const left = opening.totalPaise - opening.paidPaise
  const [amount, setAmount] = React.useState<number | null>(left)
  const [method, setMethod] = React.useState("cash")
  const [reference, setReference] = React.useState("")
  const [paidOn, setPaidOn] = React.useState(todayInIndia())
  const [error, setError] = React.useState<string | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!amount) return setErrors({ amountPaise: "Enter an amount" })
    setBusy(true)
    setError(null)
    try {
      await api.post(`/opening-balances/${opening.id}/payments`, { amountPaise: amount, method, reference: reference || null, paidOn })
      toast.success("Payment recorded")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Left on the opening balance: {formatPaise(left)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" error={errors.amountPaise}><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
            <Field label="Date"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
            <Field label="Method">
              <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Reference" hint="UPI ref, cheque no., etc."><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
          <FormError message={error} />
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record payment"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CustomerLedger({ contactId }: { contactId: string }) {
  const { can, me } = useAuth()
  const today = todayInIndia()
  const thisYear = fyStart(today, me?.tenant?.fyStartMonth ?? 4)
  const [period, setPeriod] = React.useState("year")
  const query = period === "year" ? `?from=${thisYear}&to=${today}` : ""
  const { data, error, reload } = useApi<Ledger>(`/customers/${contactId}/ledger${query}`)
  const [editing, setEditing] = React.useState(false)
  const [paying, setPaying] = React.useState(false)
  const [removing, setRemoving] = React.useState(false)

  if (error) return <p className="text-sm text-muted-foreground">{error.message}</p>
  if (!data) return <div className="grid place-items-center py-24"><Spinner /></div>

  const opening = data.openingBalance
  const openingLocked = !!opening && opening.paidPaise > 0
  const held = data.advancePaise + data.creditPaise
  const message = encodeURIComponent(`Statement from ${me?.tenant?.name}: ${data.balancePaise < 0 ? `${formatPaise(-data.balancePaise)} is in your favour` : `${formatPaise(data.balancePaise)} is due`} as on ${formatDate(today)}.`)

  function exportCsv() {
    const rows: (string | number)[][] = [["Date", "Document", "Number", "Debit (₹)", "Credit (₹)", "Balance (₹)"]]
    if (data!.broughtForwardPaise) rows.push(["", "Brought forward", "", "", "", (data!.broughtForwardPaise / 100).toFixed(2)])
    for (const r of data!.rows) rows.push([r.date.slice(0, 10), ledgerDocument(r).label, r.number ?? "", (r.debitPaise / 100).toFixed(2), (r.creditPaise / 100).toFixed(2), (r.balancePaise / 100).toFixed(2)])
    downloadCsv(`ledger-${data!.contact.name.replace(/\W+/g, "-").toLowerCase()}-${today}.csv`, rows)
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl bg-muted p-3">
          <p className="text-xs text-muted-foreground">{data.balancePaise < 0 ? "Customer's money with you" : "Balance due"}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{ledgerBalance(data.balancePaise)}</p>
        </div>
        <div className="rounded-2xl bg-muted p-3">
          <p className="text-xs text-muted-foreground">Advance and credit left</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatPaise(held)}</p>
        </div>
        {data.contact.creditLimitPaise != null && (
          <div className="rounded-2xl bg-muted p-3">
            <p className="text-xs text-muted-foreground">Credit limit</p>
            <p className={"mt-1 text-lg font-semibold tabular-nums" + (data.balancePaise > data.contact.creditLimitPaise ? " text-destructive" : "")}>{formatPaise(data.contact.creditLimitPaise)}</p>
          </div>
        )}
        {data.aging.map((b) => (
          <div key={b.label} className="rounded-2xl bg-muted p-3">
            <p className="text-xs text-muted-foreground">{b.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{formatPaise(b.amountPaise)}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="w-52">
              <NativeSelect value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
                <option value="year">This financial year</option>
                <option value="all">All time</option>
              </NativeSelect>
            </div>
            <div className="flex flex-wrap gap-2">
              {opening && !openingLocked && can("billing.invoice.approve") && <Button variant="ghost" size="icon" aria-label="Remove opening balance" onClick={() => setRemoving(true)}><Trash2 /></Button>}
              {!openingLocked && can("billing.invoice.approve") && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> {opening ? "Edit opening balance" : "Add opening balance"}</Button>}
              {opening && opening.paidPaise < opening.totalPaise && can("billing.payment.create") && <Button variant="outline" onClick={() => setPaying(true)}><IndianRupee /> Payment on opening balance</Button>}
              {data.contact.phone && <a className={buttonVariants({ variant: "outline" })} target="_blank" rel="noreferrer" href={`https://wa.me/${data.contact.phone.replace(/\D/g, "")}?text=${message}`}><MessageCircle /> WhatsApp</a>}
              {can("billing.dues.export") && <Button variant="outline" onClick={exportCsv}><Download /> Excel</Button>}
              <a className={buttonVariants({ variant: "outline" })} target="_blank" rel="noreferrer" href={`/print/statement/${contactId}${query}`}><Printer /> Print / PDF</a>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Document</th>
                  <th className="py-2 pr-3 text-right font-medium">Debit</th>
                  <th className="py-2 pr-3 text-right font-medium">Credit</th>
                  <th className="py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.broughtForwardPaise !== 0 && (
                  <tr className="border-b border-border/60 text-muted-foreground">
                    <td className="py-2 pr-3">{data.from ? formatDate(data.from) : ""}</td>
                    <td className="py-2 pr-3" colSpan={3}>Brought forward</td>
                    <td className="py-2 text-right tabular-nums">{ledgerBalance(data.broughtForwardPaise)}</td>
                  </tr>
                )}
                {data.rows.length === 0 && data.broughtForwardPaise === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Nothing in this period yet.</td></tr>
                )}
                {data.rows.map((r) => {
                  const doc = ledgerDocument(r)
                  const href = ledgerHref(r)
                  return (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="py-2 pr-3">
                        {href ? <Link href={href} className="hover:underline">{doc.label}</Link> : doc.label}
                        {doc.number && <span className="ml-2 font-mono text-xs text-muted-foreground">{doc.number}</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.debitPaise ? formatPaise(r.debitPaise) : ""}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.creditPaise ? formatPaise(r.creditPaise) : ""}</td>
                      <td className="py-2 text-right font-medium tabular-nums">{ledgerBalance(r.balancePaise)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {editing && <OpeningDialog contactId={contactId} current={opening} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload() }} />}
      {paying && opening && <OpeningPaymentDialog opening={opening} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); void reload() }} />}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        destructive
        title="Remove the opening balance?"
        description={`${formatPaise(opening?.totalPaise ?? 0)} comes off this customer's khata.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          try {
            await api.delete(`/customers/${contactId}/opening-balance`)
            toast.success("Opening balance removed")
            await reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </div>
  )
}
