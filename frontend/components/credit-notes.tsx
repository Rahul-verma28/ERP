"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Ban, FileMinus, IndianRupee, Printer, Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState, MoneyInput, Spinner, StatusBadge } from "@/components/common"
import { DataList, HeaderLink, periodFilter, type Column } from "@/components/data-list"
import { Field, FormError, NativeSelect } from "@/components/form"
import { SalesDocView } from "@/components/sales-doc-view"
import { parseSerials } from "@/components/stock-line"
import { EInvoiceButton } from "@/components/gst-files"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHODS } from "@/lib/money"
import type { SalesDoc } from "@/lib/sales"

// Credit notes: an issued invoice is never edited. Goods came back, or the value is reduced.

const NOTE_TYPE: Record<string, string> = { return: "Goods returned", amount: "Amount reduced" }

interface Row {
  id: string
  status: string
  number: string | null
  buyer: { name: string }
  issueDate: string
  totalPaise: number
  paidPaise: number
  noteType: string | null
  sourceId: string | null
  sourceNumber: string | null
}

export function CreditNoteList({ kind = "credit_note" }: { kind?: "credit_note" | "debit_note" }) {
  const { me } = useAuth()
  const debit = kind === "debit_note"
  const left = (r: Row) => (r.status !== "cancelled" ? Math.max(0, r.totalPaise - r.paidPaise) : 0)
  const columns: Column<Row>[] = [
    { key: "number", header: "Number", hideable: false, cell: (r) => <span className="font-semibold">{r.number}</span>, csv: (r) => r.number, sort: (r) => r.number ?? "" },
    { key: "date", header: "Date", cell: (r) => formatDate(r.issueDate), csv: (r) => r.issueDate.slice(0, 10), sort: (r) => r.issueDate },
    { key: "customer", header: "Customer", cell: (r) => r.buyer?.name ?? "—", csv: (r) => r.buyer?.name, sort: (r) => r.buyer?.name?.toLowerCase() ?? "" },
    { key: "invoice", header: "Invoice", cell: (r) => r.sourceNumber ?? "—", csv: (r) => r.sourceNumber },
    ...(debit ? [] : [{ key: "type", header: "Type", cell: (r: Row) => NOTE_TYPE[r.noteType ?? ""] ?? "—", csv: (r: Row) => NOTE_TYPE[r.noteType ?? ""] }]),
    { key: "amount", header: "Amount", align: "right", cell: (r) => formatPaise(r.totalPaise), csv: (r) => (r.totalPaise / 100).toFixed(2), sort: (r) => r.totalPaise },
    { key: "left", header: debit ? "Due" : "Left", align: "right", cell: (r) => formatPaise(left(r)), csv: (r) => (left(r) / 100).toFixed(2), sort: (r) => left(r) },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} />, csv: (r) => r.status },
  ]
  return (
    <DataList<Row>
      id={debit ? "debit-notes" : "credit-notes"}
      path={debit ? "/debit-notes" : "/credit-notes"}
      countsPath={debit ? "/debit-notes/counts" : "/credit-notes/counts"}
      header={{
        breadcrumb: `Billing › ${debit ? "Debit" : "Credit"} notes`,
        title: debit ? "Debit notes" : "Credit notes",
        description: `Open an invoice to make a ${debit ? "debit" : "credit"} note.`,
        actions: (
          <>
            <HeaderLink href={debit ? "/app/m/billing/credit-notes" : "/app/m/billing/debit-notes"}>{debit ? "Credit notes" : "Debit notes"}</HeaderLink>
            <HeaderLink href="/app/m/billing">Invoices</HeaderLink>
          </>
        ),
      }}
      columns={columns}
      searchPlaceholder="Search number, customer, mobile, GSTIN"
      presets={[
        { key: "all", label: "All", params: {}, countKey: "all" },
        { key: "issued", label: debit ? "Unpaid" : "Issued", params: { status: "issued" }, countKey: "issued" },
        { key: "cancelled", label: "Cancelled", params: { status: "cancelled" }, countKey: "cancelled" },
      ]}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4)]}
      rowHref={(r) => `/app/m/billing/${debit ? "debit" : "credit"}-notes/${r.id}`}
      exportName={debit ? "debit-notes" : "credit-notes"}
      emptyState={debit
        ? <EmptyState icon={FileMinus} title="No debit notes yet" description="When a bill was short or a rate went up, open the invoice and make a debit note." />
        : <EmptyState icon={FileMinus} title="No credit notes yet" description="When goods come back or a bill needs reducing, open the invoice and make a credit note." />}
    />
  )
}

interface OpenLine {
  id: string
  description: string
  unit: string
  quantity: number | string
  taxablePaise: number
  gstRateBp: number
  quantityLeft: number
  taxableLeftPaise: number
  /** Serial numbers sold on this line */
  serials?: string[]
}

/** The same sum the server does; the server's figure is the one that counts. */
function preview(line: OpenLine, type: string, value: number) {
  if (!value) return 0
  let taxable = value
  if (type === "return") {
    taxable = value === line.quantityLeft ? line.taxableLeftPaise : Math.min(Math.round((line.taxablePaise * value) / Number(line.quantity)), line.taxableLeftPaise)
  }
  return taxable + Math.round((taxable * line.gstRateBp) / 10_000)
}

export function CreditNoteNew({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const invoice = useApi<SalesDoc>(`/invoices/${invoiceId}`)
  const lines = useApi<OpenLine[]>(`/invoices/${invoiceId}/credit-note-lines`)
  const [type, setType] = React.useState("return")
  const [issueDate, setIssueDate] = React.useState(todayInIndia())
  const [notes, setNotes] = React.useState("")
  const [quantities, setQuantities] = React.useState<Record<string, string>>({})
  const [amounts, setAmounts] = React.useState<Record<string, number | null>>({})
  const [serialsBack, setSerialsBack] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const failed = invoice.error ?? lines.error
  if (failed) return <p className="text-sm text-muted-foreground">{failed.message}</p>
  if (!invoice.data || !lines.data) return <div className="grid place-items-center py-24"><Spinner /></div>

  const doc = invoice.data
  const debit = type === "debit"
  const value = (l: OpenLine) => (type === "return" ? Number(quantities[l.id] || 0) : amounts[l.id] ?? 0)
  const total = lines.data.reduce((sum, l) => sum + preview(l, type, value(l)), 0)
  const due = Math.max(0, doc.totalPaise - doc.paidPaise)
  const chosen = lines.data.filter((l) => value(l) > 0)

  async function issue() {
    if (!chosen.length) return setError(type === "return" ? "Enter the quantity returned on at least one line." : "Enter the amount to reduce on at least one line.")
    setBusy(true)
    setError(null)
    try {
      if (debit) {
        const added = await api.post<SalesDoc>(`/invoices/${invoiceId}/debit-notes`, { issueDate, notes: notes.trim() || null, lines: chosen.map((l) => ({ sourceLineId: l.id, taxablePaise: value(l) })) })
        toast.success("Debit note issued")
        router.replace(`/app/m/billing/debit-notes/${added.id}`)
        return
      }
      const note = await api.post<SalesDoc>(`/invoices/${invoiceId}/credit-notes`, {
        type,
        issueDate,
        notes: notes.trim() || null,
        lines: chosen.map((l) => (type === "return" ? { sourceLineId: l.id, quantity: value(l), ...(serialsBack[l.id] ? { serials: parseSerials(serialsBack[l.id]) } : {}) } : { sourceLineId: l.id, taxablePaise: value(l) })),
      })
      toast.success("Credit note issued")
      router.replace(`/app/m/billing/credit-notes/${note.id}`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <>
      <Link href={`/app/m/billing/${invoiceId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {doc.number}</Link>
      <PageHeader title={debit ? "New debit note" : "New credit note"} description={`Against ${doc.number} · ${doc.buyer.name} · Issued ${formatDate(doc.issueDate)}`} />
      <Card>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Type">
              <NativeSelect value={type} onChange={(e) => { setType(e.target.value); setError(null) }}>
                <option value="return">Goods returned</option>
                <option value="amount">Amount reduced only</option>
                <option value="debit">Amount increased (debit note)</option>
              </NativeSelect>
            </Field>
            <Field label="Date"><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
            <Field label="Note (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Damaged in transit" /></Field>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Item</th>
                  <th className="py-2 pr-3 text-right font-medium">{type === "return" ? "Can return" : debit ? "Billed" : "Value left"}</th>
                  <th className="py-2 pr-3 text-right font-medium">{type === "return" ? "Return qty" : debit ? "Add (before GST)" : "Reduce by (before GST)"}</th>
                  <th className="py-2 pr-3 text-right font-medium">GST</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.data.map((l) => (
                  <tr key={l.id} className="border-b border-border/60">
                    <td className="py-2 pr-3">{l.description}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{type === "return" ? `${l.quantityLeft} ${l.unit}` : formatPaise(debit ? l.taxablePaise : l.taxableLeftPaise)}</td>
                    <td className="py-2 pr-3">
                      <div className="ml-auto w-32">
                        {type === "return"
                          ? <>
                              <Input type="number" min="0" max={l.quantityLeft} step="any" className="text-right" aria-label={`Return quantity for ${l.description}`} disabled={l.quantityLeft <= 0} value={quantities[l.id] ?? ""} onChange={(e) => setQuantities({ ...quantities, [l.id]: e.target.value })} />
                              {!!l.serials?.length && Number(quantities[l.id] || 0) > 0 && (
                                <Input className="mt-1 h-8 text-xs" placeholder={`Which: ${l.serials.join(", ")}`} aria-label={`Serial numbers returned for ${l.description}`} value={serialsBack[l.id] ?? ""} onChange={(e) => setSerialsBack({ ...serialsBack, [l.id]: e.target.value })} />
                              )}
                            </>
                          : <MoneyInput value={amounts[l.id] ?? null} onChange={(v) => setAmounts({ ...amounts, [l.id]: v })} />}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.gstRateBp / 100}%</td>
                    <td className="py-2 text-right font-medium tabular-nums">{formatPaise(preview(l, type, value(l)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
            <div className="flex justify-between font-semibold"><dt>{debit ? "Debit note total" : "Credit note total"}</dt><dd className="tabular-nums">{formatPaise(total)}</dd></div>
            {!debit && <div className="flex justify-between text-muted-foreground"><dt>Invoice balance after this</dt><dd className="tabular-nums">{formatPaise(Math.max(0, due - total))}</dd></div>}
            {debit && <div className="flex justify-between text-muted-foreground"><dt>Customer owes more</dt><dd className="tabular-nums">{formatPaise(total)}</dd></div>}
            {!debit && total > due && <div className="flex justify-between text-muted-foreground"><dt>Stays as customer credit</dt><dd className="tabular-nums">{formatPaise(total - due)}</dd></div>}
          </dl>
          <FormError message={error} />
          <div className="flex justify-end"><Button disabled={busy} onClick={issue}>{busy ? "Issuing…" : debit ? "Issue debit note" : "Issue credit note"}</Button></div>
        </CardContent>
      </Card>
    </>
  )
}

function RefundDialog({ note, onClose, onSaved }: { note: SalesDoc; onClose: () => void; onSaved: (d: SalesDoc) => void }) {
  const left = note.totalPaise - note.paidPaise
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
      const d = await api.post<SalesDoc>(`/credit-notes/${note.id}/refund`, { amountPaise: amount, method, reference: reference || null, paidOn })
      toast.success("Refund recorded")
      onSaved(d)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund customer</DialogTitle>
          <DialogDescription>Left on {note.number}: {formatPaise(left)}</DialogDescription>
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
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record refund"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CreditNoteDetail({ id }: { id: string }) {
  const { can, me } = useAuth()
  const { data: note, setData, error } = useApi<SalesDoc>(`/credit-notes/${id}`)
  const [refunding, setRefunding] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [reversing, setReversing] = React.useState<NonNullable<SalesDoc["payments"]>[number] | null>(null)

  if (error) return <p className="text-sm text-muted-foreground">{error.message}</p>
  if (!note) return <div className="grid place-items-center py-24"><Spinner /></div>

  const live = note.status === "issued"
  const left = live ? note.totalPaise - note.paidPaise : 0

  return (
    <>
      <Link href="/app/m/billing/credit-notes" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Credit notes</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{note.number} <StatusBadge status={note.status} /></h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {note.buyer.name} · {formatPaise(note.totalPaise)} · {NOTE_TYPE[note.noteType ?? ""]} · Against <Link href={`/app/m/billing/${note.sourceId}`} className="underline underline-offset-2 hover:text-foreground">{note.sourceNumber}</Link>
            {note.cancelReason && ` · Cancelled: ${note.cancelReason}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {left > 0 && can("billing.refund.create") && <Button onClick={() => setRefunding(true)}><IndianRupee /> Refund customer</Button>}
          <EInvoiceButton doc={note} onSaved={(d) => setData({ ...note, ...(d as Partial<SalesDoc>) })} />
          <a href={`/print/credit_note/${id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><Printer /> Print / PDF</a>
          {live && can("billing.credit_note.approve") && <Button variant="ghost" onClick={() => setCancelling(true)}><Ban /> Cancel</Button>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <div className="overflow-hidden rounded-4xl border shadow-sm">
          <SalesDocView doc={note} fallbackSeller={{ name: me?.tenant?.name ?? "", gstin: me?.tenant?.gstin, stateCode: me?.tenant?.billingStateCode }} />
        </div>
        <div className="grid content-start gap-4">
          {live && (
            <Card>
              <CardHeader><CardTitle className="text-base">Where it went</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-2 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Used or refunded</dt><dd className="tabular-nums">{formatPaise(note.paidPaise)}</dd></div>
                  <div className="flex justify-between font-medium"><dt>Left with customer</dt><dd className="tabular-nums">{formatPaise(left)}</dd></div>
                </dl>
                {left > 0 && <p className="mt-3 text-xs text-muted-foreground">Refund it here, or use it from another invoice of this customer.</p>}
              </CardContent>
            </Card>
          )}
          {(note.payments?.length ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Refunds</CardTitle></CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm">
                  {note.payments!.map((pm) => {
                    const reversed = note.payments!.some((o) => o.reversesId === pm.id)
                    return (
                      <li key={pm.id} className="flex justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-mono text-xs">{pm.number}</span>
                          {reversed && <Badge variant="outline" className="ml-2">Reversed</Badge>}
                          <span className="block text-xs text-muted-foreground">{formatDate(pm.paidOn)} · {pm.reversesId ? "Reversal" : PAYMENT_METHODS.find((m) => m.value === pm.method)?.label}{pm.reference ? ` · ${pm.reference}` : ""}</span>
                        </span>
                        <span className="flex items-start gap-1">
                          <span className="font-medium tabular-nums">{formatPaise(pm.amountPaise)}</span>
                          {!pm.reversesId && !reversed && can("billing.payment.approve") && (
                            <Button variant="ghost" size="icon-xs" aria-label={`Reverse ${pm.number}`} onClick={() => setReversing(pm)}><Undo2 /></Button>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {refunding && <RefundDialog note={note} onClose={() => setRefunding(false)} onSaved={(d) => { setRefunding(false); setData(d) }} />}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        destructive
        title={`Cancel ${note.number}?`}
        description="The number stays used. The invoice owes again what this credit note cleared."
        reasonLabel="Reason for cancelling"
        confirmLabel="Cancel credit note"
        onConfirm={async (reason) => {
          try {
            setData(await api.post<SalesDoc>(`/credit-notes/${id}/cancel`, { reason }))
            toast.success("Credit note cancelled")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        destructive
        title={`Reverse ${reversing?.number}?`}
        description="An opposite entry is added and the credit comes back. The original stays on record."
        confirmLabel="Reverse refund"
        onConfirm={async () => {
          try {
            const { invoice } = await api.post<{ invoice: SalesDoc }>(`/payments/${reversing!.id}/reverse`)
            setData(invoice)
            toast.success("Refund reversed")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}

function DebitPaymentDialog({ note, onClose, onSaved }: { note: SalesDoc; onClose: () => void; onSaved: (d: SalesDoc) => void }) {
  const due = note.totalPaise - note.paidPaise
  const [amount, setAmount] = React.useState<number | null>(due)
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
      const d = await api.post<SalesDoc>(`/debit-notes/${note.id}/payments`, { amountPaise: amount, method, reference: reference || null, paidOn })
      toast.success("Payment recorded")
      onSaved(d)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Due on {note.number}: {formatPaise(due)}</DialogDescription>
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

export function DebitNoteDetail({ id }: { id: string }) {
  const { can, me } = useAuth()
  const { data: note, setData, error } = useApi<SalesDoc>(`/debit-notes/${id}`)
  const [paying, setPaying] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [reversing, setReversing] = React.useState<NonNullable<SalesDoc["payments"]>[number] | null>(null)

  if (error) return <p className="text-sm text-muted-foreground">{error.message}</p>
  if (!note) return <div className="grid place-items-center py-24"><Spinner /></div>

  const due = note.status === "cancelled" ? 0 : note.totalPaise - note.paidPaise
  return (
    <>
      <Link href="/app/m/billing/debit-notes" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Debit notes</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{note.number} <StatusBadge status={note.status} /></h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {note.buyer.name} · {formatPaise(note.totalPaise)} · Against <Link href={`/app/m/billing/${note.sourceId}`} className="underline underline-offset-2 hover:text-foreground">{note.sourceNumber}</Link>
            {note.cancelReason && ` · Cancelled: ${note.cancelReason}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {due > 0 && can("billing.payment.create") && <Button onClick={() => setPaying(true)}><IndianRupee /> Record payment</Button>}
          <EInvoiceButton doc={note} onSaved={(d) => setData({ ...note, ...(d as Partial<SalesDoc>) })} />
          <a href={`/print/debit_note/${id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><Printer /> Print / PDF</a>
          {note.status !== "cancelled" && note.paidPaise === 0 && can("billing.credit_note.approve") && <Button variant="ghost" onClick={() => setCancelling(true)}><Ban /> Cancel</Button>}
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <div className="overflow-hidden rounded-4xl border shadow-sm">
          <SalesDocView doc={note} fallbackSeller={{ name: me?.tenant?.name ?? "", gstin: me?.tenant?.gstin, stateCode: me?.tenant?.billingStateCode }} />
        </div>
        {(note.payments?.length ?? 0) > 0 && (
          <Card className="content-start">
            <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm">
                {note.payments!.map((pm) => {
                  const reversed = note.payments!.some((o) => o.reversesId === pm.id)
                  return (
                    <li key={pm.id} className="flex justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-mono text-xs">{pm.number}</span>
                        {reversed && <Badge variant="outline" className="ml-2">Reversed</Badge>}
                        <span className="block text-xs text-muted-foreground">{formatDate(pm.paidOn)} · {pm.reversesId ? "Reversal" : PAYMENT_METHODS.find((m) => m.value === pm.method)?.label}</span>
                      </span>
                      <span className="flex items-start gap-1">
                        <span className="font-medium tabular-nums">{formatPaise(pm.amountPaise)}</span>
                        {!pm.reversesId && !reversed && can("billing.payment.approve") && <Button variant="ghost" size="icon-xs" aria-label={`Reverse ${pm.number}`} onClick={() => setReversing(pm)}><Undo2 /></Button>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
      {paying && <DebitPaymentDialog note={note} onClose={() => setPaying(false)} onSaved={(d) => { setPaying(false); setData(d) }} />}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        destructive
        title={`Cancel ${note.number}?`}
        description="The number stays used. The customer no longer owes this amount."
        reasonLabel="Reason for cancelling"
        confirmLabel="Cancel debit note"
        onConfirm={async (reason) => {
          try {
            setData(await api.post<SalesDoc>(`/debit-notes/${id}/cancel`, { reason }))
            toast.success("Debit note cancelled")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        destructive
        title={`Reverse ${reversing?.number}?`}
        description="An opposite entry is added and the amount is due again. The original stays on record."
        confirmLabel="Reverse payment"
        onConfirm={async () => {
          try {
            const { invoice } = await api.post<{ invoice: SalesDoc }>(`/payments/${reversing!.id}/reverse`)
            setData(invoice)
            toast.success("Payment reversed")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
