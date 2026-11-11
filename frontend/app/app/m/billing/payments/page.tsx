"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Eye, Plus, Undo2, Wallet } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog, EmptyState, MoneyInput, Spinner } from "@/components/common"
import { DataList, periodFilter, type Column } from "@/components/data-list"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ContactPicker, type ContactOption } from "@/components/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHODS } from "@/lib/money"
import { cn } from "@/lib/utils"

// Payments received: money in from customers. One receipt can clear several bills; what is not put
// on a bill stays with the customer as an advance for a later invoice.

interface Applied { id: string; kind: string; number: string | null; amountPaise: number }
interface Receipt {
  id: string
  number: string
  paidOn: string
  amountPaise: number
  method: string
  reference: string | null
  notes: string | null
  contactId: string | null
  customer: string | null
  reversed: boolean
  reversal: { number: string; paidOn: string } | null
  advance: boolean
  appliedTo: Applied[]
  unusedPaise: number
}
interface OpenBill { id: string; kind: string; number: string | null; issueDate: string; dueDate: string | null; duePaise: number; overdue: boolean }

const methodLabel = (m: string) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m
const billHref = (b: { id: string; kind: string }) => (b.kind === "debit_note" ? `/app/m/billing/debit-notes/${b.id}` : b.kind === "invoice" ? `/app/m/billing/${b.id}` : null)
const KIND_LABEL: Record<string, string> = { invoice: "Invoice", debit_note: "Debit note", opening_balance: "Opening balance" }
const REFERENCE: Record<string, { label: string; placeholder: string; required: boolean }> = {
  cash: { label: "Reference", placeholder: "Optional", required: false },
  upi: { label: "UPI reference", placeholder: "12-digit UPI ref", required: false },
  card: { label: "Card slip / approval no.", placeholder: "Optional", required: false },
  bank: { label: "UTR / bank reference", placeholder: "UTR from the bank", required: true },
  cheque: { label: "Cheque number", placeholder: "6-digit cheque no.", required: true },
  other: { label: "Reference", placeholder: "Optional", required: false },
}
const PILL = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  blue: "bg-primary/10 text-primary",
  grey: "bg-muted text-muted-foreground",
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

function ReceiveDialog({ initial, onClose, onSaved }: { initial: ContactOption | null; onClose: () => void; onSaved: () => void }) {
  const today = todayInIndia()
  const [contact, setContact] = React.useState<ContactOption | null>(initial)
  const [amount, setAmount] = React.useState<number | null>(null)
  const [paidOn, setPaidOn] = React.useState(today)
  const [method, setMethod] = React.useState("upi")
  const [reference, setReference] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [put, setPut] = React.useState<Record<string, number | null>>({})
  const [touched, setTouched] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const bills = useApi<{ data: OpenBill[] }>(contact ? `/customers/${contact.id}/open-bills` : null)
  const open = bills.data?.data ?? []
  const totalDue = open.reduce((s, b) => s + b.duePaise, 0)
  const ref = REFERENCE[method]

  // Until a row is changed by hand, the amount goes on the oldest bills first
  const shares = touched ? put : oldestFirst(open, amount ?? 0)
  const onBills = open.reduce((s, b) => s + (shares[b.id] ?? 0), 0)
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
    if (!contact) e.contactId = "Choose the customer"
    if (!amount || amount <= 0) e.amountPaise = "Enter the amount received"
    if (!paidOn) e.paidOn = "Choose the date"
    else if (paidOn > today) e.paidOn = "Can't be in the future"
    if (ref.required && !reference.trim()) e.reference = `Enter the ${ref.label.toLowerCase()}`
    for (const b of open) {
      const v = shares[b.id] ?? 0
      if (v > b.duePaise) e[`bill.${b.id}`] = `Only ${formatPaise(b.duePaise)} is due`
    }
    if (amount && onBills > amount) e.allocations = `${formatPaise(onBills)} is put on bills but only ${formatPaise(amount)} was received`
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
    const allocations = open.filter((b) => (shares[b.id] ?? 0) > 0).map((b) => ({ documentId: b.id, amountPaise: shares[b.id]! }))
    try {
      const r = await api.post<Receipt>("/receipts", { contactId: contact!.id, amountPaise: amount, paidOn, method, reference: reference.trim() || null, notes: notes.trim() || null, allocations })
      toast.success(`${r.number} saved${advance > 0 ? ` · ${formatPaise(advance)} kept as advance` : ""}`)
      onSaved()
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
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Receive payment</DialogTitle>
          <DialogDescription>Money from a customer. Put it on their bills; anything left stays as an advance.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-5" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer" required error={errors.contactId} className="sm:col-span-2">
              <ContactPicker value={contact} onChange={chooseContact} />
            </Field>
            <Field label="Amount received" required error={errors.amountPaise} hint={contact && totalDue > 0 ? `They owe ${formatPaise(totalDue)} on ${open.length} bill${open.length === 1 ? "" : "s"}` : undefined}>
              <div className="flex gap-2">
                <MoneyInput value={amount} onChange={(v) => { setAmount(v); clear("amountPaise"); clear("allocations") }} aria-label="Amount received" />
                {contact && totalDue > 0 && <Button type="button" variant="outline" onClick={() => { setAmount(totalDue); setTouched(false); clear("amountPaise") }}>Full due</Button>}
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

          {contact && (
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
                        <tr key={b.id} className="border-b border-border/60 align-top last:border-0">
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

          <Field label="Note"><Input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>

          <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Received</dt><dd className="tabular-nums">{formatPaise(amount ?? 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Put on bills</dt><dd className="tabular-nums">{formatPaise(onBills)}</dd></div>
            <div className={cn("flex justify-between font-semibold", advance < 0 && "text-destructive")}><dt>{advance < 0 ? "More than received" : "Kept as advance"}</dt><dd className="tabular-nums">{formatPaise(Math.abs(advance))}</dd></div>
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

function ReceiptDialog({ id, onClose }: { id: string; onClose: () => void }) {
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
            {r.contactId && <Link href={`/app/m/sales/customers/${r.contactId}`} className={buttonVariants({ variant: "outline" })}>Open customer</Link>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function PaymentsReceivedPage() {
  const { can, me } = useAuth()
  const params = useSearchParams()
  const presetContact = useApi<ContactOption>(params.get("contact") ? `/contacts/${params.get("contact")}?view=summary` : null)
  const [receiving, setReceiving] = React.useState(params.get("new") === "1")
  const [viewing, setViewing] = React.useState<string | null>(null)
  const [reversing, setReversing] = React.useState<Receipt | null>(null)
  const [version, setVersion] = React.useState(0)
  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })
  const canCreate = can("billing.payment.create")

  const status = (r: Receipt) => (r.reversed ? { label: "Reversed", tone: "grey" as const } : r.unusedPaise > 0 ? { label: "Advance left", tone: "blue" as const } : { label: "Received", tone: "green" as const })
  const columns: Column<Receipt>[] = [
    { key: "number", header: "Receipt no.", hideable: false, sort: (r) => r.number, csv: (r) => r.number, cell: (r) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.number}</span> },
    { key: "date", header: "Date", sort: (r) => r.paidOn, csv: (r) => r.paidOn.slice(0, 10), cell: (r) => formatDate(r.paidOn) },
    { key: "customer", header: "Customer", sort: (r) => r.customer?.toLowerCase() ?? "", csv: (r) => r.customer, cell: (r) => <span className="font-medium">{r.customer ?? "—"}</span> },
    { key: "method", header: "Paid by", csv: (r) => methodLabel(r.method), cell: (r) => <Badge variant="outline">{methodLabel(r.method)}</Badge> },
    { key: "reference", header: "Reference", csv: (r) => r.reference, cell: (r) => <span className="font-mono text-xs">{r.reference ?? "—"}</span> },
    {
      key: "applied", header: "Put on", csv: (r) => r.appliedTo.map((a) => a.number).join(" "),
      cell: (r) => (r.appliedTo.length === 0 ? <span className="text-muted-foreground">{r.reversed ? "—" : "Advance"}</span> : (
        <span className="flex flex-wrap gap-1">
          {r.appliedTo.slice(0, 3).map((a) => <span key={a.id} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">{a.number ?? KIND_LABEL[a.kind]}</span>)}
          {r.appliedTo.length > 3 && <span className="text-xs text-muted-foreground">+{r.appliedTo.length - 3}</span>}
        </span>
      )),
    },
    { key: "amount", header: "Amount", align: "right", sort: (r) => r.amountPaise, csv: (r) => (r.amountPaise / 100).toFixed(2), cell: (r) => <span className={cn("font-semibold tabular-nums", r.reversed && "line-through text-muted-foreground")}>{formatPaise(r.amountPaise)}</span> },
    { key: "unused", header: "Advance left", align: "right", defaultHidden: true, sort: (r) => r.unusedPaise, csv: (r) => (r.unusedPaise / 100).toFixed(2), cell: (r) => <span className="tabular-nums">{r.unusedPaise > 0 ? formatPaise(r.unusedPaise) : "—"}</span> },
    {
      key: "status", header: "Status", csv: (r) => status(r).label,
      cell: (r) => { const s = status(r); return <span className={cn("inline-flex h-[22px] items-center rounded-full px-2 text-xs font-semibold whitespace-nowrap", PILL[s.tone])}>{s.label}</span> },
    },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={icon} title="View" aria-label={`View ${r.number}`} onClick={() => setViewing(r.id)}><Eye /></button>
          {!r.reversed && can("billing.payment.approve") && <Button variant="ghost" size="icon-sm" className="text-destructive" title="Reverse" aria-label={`Reverse ${r.number}`} onClick={() => setReversing(r)}><Undo2 /></Button>}
        </span>
      ),
    },
  ]
  const newButton = canCreate && <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setReceiving(true)}><Plus /> Receive payment</Button>

  if (params.get("contact") && presetContact.loading) return <div className="grid place-items-center py-24"><Spinner /></div>

  return (
    <>
      <DataList<Receipt>
        id="payments-received"
        path="/payments"
        params={{ v: String(version) }}
        header={{
          title: "Payments Received",
          description: "Money in from customers. One payment can clear several bills; the rest stays as an advance.",
          primary: newButton,
          more: [
            { label: "Dues and reminders", href: "/app/m/billing/dues" },
            { label: "Sales Invoices", href: "/app/m/billing" },
          ],
        }}
        columns={columns}
        searchPlaceholder="Search receipt, customer, reference or bill no."
        presets={[
          { key: "all", label: "All", params: {} },
          { key: "active", label: "Received", params: { view: "active" } },
          { key: "advance", label: "Advances", params: { view: "advance" } },
          { key: "reversed", label: "Reversed", params: { view: "reversed" } },
        ]}
        filters={[
          periodFilter(me?.tenant?.fyStartMonth ?? 4),
          { key: "method", label: "Paid by", options: PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label })) },
        ]}
        exportName="payments-received"
        emptyState={<EmptyState icon={Wallet} title="No payments yet" description="When a customer pays, record it here once and put it on one bill or several." action={newButton} />}
      />
      {receiving && <ReceiveDialog initial={presetContact.data ?? null} onClose={() => setReceiving(false)} onSaved={() => { setReceiving(false); setVersion((v) => v + 1) }} />}
      {viewing && <ReceiptDialog id={viewing} onClose={() => setViewing(null)} />}
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        destructive
        title={`Reverse ${reversing?.number}?`}
        description={`It comes off ${reversing?.appliedTo.length ? reversing.appliedTo.map((a) => a.number).join(", ") : "the customer's advance"} and an opposite entry is added. The original stays on record.`}
        confirmLabel="Reverse payment"
        onConfirm={async () => {
          try {
            await api.post(`/receipts/${reversing!.id}/reverse`)
            toast.success("Payment reversed")
            setVersion((v) => v + 1)
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
