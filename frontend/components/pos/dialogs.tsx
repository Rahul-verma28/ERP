"use client"

import * as React from "react"
import { toast } from "sonner"
import { Banknote, CheckCircle2, CreditCard, Loader2, MessageCircle, Printer, Search, Smartphone, Trash2, UserPlus, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MoneyInput } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { UpiQr } from "@/components/upi-qr"
import { api, ApiError, errorMessage } from "@/lib/api"
import { formatDateTime, formatPaise } from "@/lib/format"
import { cashSuggestions, MOVE_REASON, TENDER_LABEL, type Cart, type CartCustomer, type Register, type ShiftSummary, type Tender } from "@/lib/pos"
import { cn } from "@/lib/utils"

// The counter's dialogs: take payment, the sale done, a customer, cash in or out, bills on hold,
// serial numbers and goods coming back. Each sends one request and shows the server's answer.

export interface SaleResult { id: string; number: string; totalPaise: number; paidPaise: number; duePaise: number; changePaise: number; cashGivenPaise: number }
type TenderRow = { method: Tender; amount: number | null; reference: string }

const ICON = { cash: Banknote, upi: Smartphone, card: CreditCard, other: Wallet }

/** Take the money: cash with change, UPI with the QR, card, or several; the rest on account for a known customer */
export function PayDialog({ payable, customer, allowCredit, upiId, business, busy, error, onPay, onClose }: {
  payable: number
  customer: CartCustomer | null
  allowCredit: boolean
  upiId: string | null
  business: string
  busy: boolean
  error: string | null
  onPay: (tenders: { method: Tender; amountPaise: number; reference: string | null }[]) => void
  onClose: () => void
}) {
  const [rows, setRows] = React.useState<TenderRow[]>([{ method: "cash", amount: payable, reference: "" }])
  const [touched, setTouched] = React.useState(false)
  const nonCash = rows.filter((r) => r.method !== "cash").reduce((a, r) => a + (r.amount ?? 0), 0)
  const cash = rows.filter((r) => r.method === "cash").reduce((a, r) => a + (r.amount ?? 0), 0)
  const cashNeeded = Math.max(0, payable - nonCash)
  const change = Math.max(0, cash - cashNeeded)
  const short = Math.max(0, payable - nonCash - Math.min(cash, cashNeeded))
  const credit = short > 0 && !!customer?.id && allowCredit
  const overNonCash = nonCash > payable
  const canPay = !busy && !overNonCash && (short === 0 || credit)

  const set = (i: number, patch: Partial<TenderRow>) => { setTouched(true); setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))) }
  /** One method for the whole bill: the usual case, one tap */
  const only = (method: Tender) => { setTouched(true); setRows([{ method, amount: payable, reference: "" }]) }
  const addMethod = (method: Tender) => { setTouched(true); setRows((rs) => [...rs, { method, amount: Math.max(0, payable - rs.reduce((a, r) => a + (r.amount ?? 0), 0)), reference: "" }]) }
  const submit = () => canPay && onPay(rows.filter((r) => (r.amount ?? 0) > 0).map((r) => ({ method: r.method, amountPaise: r.amount ?? 0, reference: r.reference.trim() || null })))
  const upiRow = rows.find((r) => r.method === "upi")

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-xl" onKeyDown={(e) => { if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); submit() } }}>
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
          <DialogDescription>{customer?.name ?? "Walk-in customer"} · Press Enter to finish</DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl bg-primary/5 p-4 text-center">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">To pay</p>
          <p className="text-4xl font-bold tabular-nums">{formatPaise(payable)}</p>
        </div>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Paid by">
          {(["cash", "upi", "card", "other"] as const).map((m) => {
            const I = ICON[m]
            const on = rows.length === 1 && rows[0].method === m
            return (
              <button key={m} type="button" role="radio" aria-checked={on} onClick={() => only(m)} className={cn("flex flex-col items-center gap-1 rounded-xl border p-3 text-sm font-medium transition-colors hover:border-primary", on && "border-primary bg-primary/5 text-primary")}>
                <I className="size-5" />{TENDER_LABEL[m]}
              </button>
            )
          })}
        </div>
        <div className="grid gap-3">
          {rows.map((r, i) => {
            const I = ICON[r.method]
            return (
              <div key={i} className="grid gap-2 rounded-xl border p-3">
                <div className="flex items-center gap-2">
                  <I className="size-4 text-muted-foreground" />
                  <span className="font-medium">{TENDER_LABEL[r.method]}</span>
                  {rows.length > 1 && <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Remove ${TENDER_LABEL[r.method]}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 /></Button>}
                </div>
                <div className={cn("grid gap-2", r.method !== "cash" && "sm:grid-cols-2")}>
                  <Field label={r.method === "cash" ? "Cash received" : "Amount"}><MoneyInput value={r.amount} onChange={(v) => set(i, { amount: v })} autoFocus={i === 0 && r.method === "cash"} /></Field>
                  {r.method !== "cash" && <Field label={r.method === "card" ? "Card last 4 or slip no." : "Reference (optional)"}><Input value={r.reference} maxLength={60} onChange={(e) => set(i, { reference: e.target.value })} placeholder={r.method === "upi" ? "UTR or app reference" : ""} /></Field>}
                </div>
                {r.method === "cash" && (
                  <div className="flex flex-wrap gap-1.5">
                    {cashSuggestions(cashNeeded).map((v) => <button key={v} type="button" onClick={() => set(i, { amount: v })} className={cn("rounded-lg border px-2.5 py-1 text-sm tabular-nums hover:border-primary", r.amount === v && "border-primary bg-primary/5 text-primary")}>{formatPaise(v, true)}</button>)}
                  </div>
                )}
              </div>
            )
          })}
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="text-muted-foreground">Split the bill:</span>
            {(["cash", "upi", "card"] as const).filter((m) => !rows.some((r) => r.method === m)).map((m) => <button key={m} type="button" className="font-medium text-primary hover:underline" onClick={() => addMethod(m)}>+ {TENDER_LABEL[m]}</button>)}
          </div>
        </div>
        {upiRow && upiId && (upiRow.amount ?? 0) > 0 && (
          <div className="flex items-center gap-4 rounded-xl border bg-white p-3 text-neutral-900">
            <UpiQr upiId={upiId} payee={business} amountPaise={upiRow.amount ?? 0} size={120} />
            <p className="text-sm">Ask the customer to scan and pay <b>{formatPaise(upiRow.amount ?? 0)}</b>. Check the money has come in before you finish.</p>
          </div>
        )}
        <div className="grid gap-1 rounded-xl bg-muted/50 p-3 text-sm">
          {change > 0 && <p className="flex justify-between text-base font-semibold text-emerald-700 dark:text-emerald-400"><span>Give back change</span><span className="tabular-nums">{formatPaise(change)}</span></p>}
          {short > 0 && <p className={cn("flex justify-between font-medium", credit ? "text-amber-700 dark:text-amber-400" : "text-destructive")}><span>{credit ? `On ${customer?.name}'s account` : "Still to pay"}</span><span className="tabular-nums">{formatPaise(short)}</span></p>}
          {overNonCash && <p className="text-destructive">UPI and card come to more than the bill.</p>}
          {short > 0 && !credit && touched && <p className="text-xs text-muted-foreground">{customer?.id ? "This counter takes full payment." : "Take the full amount, or choose the customer to put the rest on their account."}</p>}
          {short === 0 && change === 0 && !overNonCash && <p className="flex justify-between text-muted-foreground"><span>Paid in full</span><CheckCircle2 className="size-4 text-emerald-600" /></p>}
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Back to bill</Button>
          <Button onClick={submit} disabled={!canPay} className="min-w-40">{busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {credit ? "Finish, rest on account" : "Finish sale"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The sale is made: change to give, print the receipt, send it, and the next customer */
export function DoneDialog({ sale, phone, shareToken, onPrint, onNext }: { sale: SaleResult; phone: string | null; shareToken: string | null; onPrint: () => void; onNext: () => void }) {
  const link = shareToken && typeof window !== "undefined" ? `${window.location.origin}/d/${shareToken}` : null
  const wa = phone && link ? `https://wa.me/91${phone.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(`Thank you for shopping with us. Your bill ${sale.number} for ${formatPaise(sale.totalPaise)}: ${link}`)}` : null
  return (
    <Dialog open onOpenChange={(o) => !o && onNext()}>
      <DialogContent className="sm:max-w-md" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onNext() } }}>
        <DialogHeader className="items-center text-center">
          <span className="grid size-14 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><CheckCircle2 className="size-8" /></span>
          <DialogTitle>Bill {sale.number} done</DialogTitle>
          <DialogDescription>{formatPaise(sale.totalPaise)}{sale.duePaise > 0 ? ` · ${formatPaise(sale.duePaise)} on account` : " · paid"}</DialogDescription>
        </DialogHeader>
        {sale.changePaise > 0 && (
          <div className="rounded-2xl bg-emerald-50 p-4 text-center dark:bg-emerald-500/10">
            <p className="text-xs font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-300">Give back</p>
            <p className="text-4xl font-bold text-emerald-700 tabular-nums dark:text-emerald-300">{formatPaise(sale.changePaise)}</p>
            <p className="text-xs text-muted-foreground">from {formatPaise(sale.cashGivenPaise)} cash</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onPrint}><Printer /> Print receipt</Button>
          {wa ? <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border text-sm font-medium hover:bg-muted"><MessageCircle className="size-4" /> WhatsApp</a> : <Button variant="outline" disabled title="Add the customer's phone to send the bill"><MessageCircle /> WhatsApp</Button>}
        </div>
        <DialogFooter><Button className="w-full" onClick={onNext} autoFocus>Next customer (Enter)</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface CustomerHit { id: string; name: string; companyName: string | null; phone: string | null; gstin: string | null }

/** Who is buying: search by name or phone, add a new one with name and phone, or a walk-in with optional details */
export function CustomerDialog({ current, need, onPick, onClose }: { current: CartCustomer | null; need: boolean; onPick: (c: CartCustomer | null) => void; onClose: () => void }) {
  const [q, setQ] = React.useState("")
  const [hits, setHits] = React.useState<CustomerHit[]>([])
  const [loading, setLoading] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [name, setName] = React.useState(current && !current.id ? current.name : "")
  const [phone, setPhone] = React.useState(current && !current.id ? current.phone ?? "" : "")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (q.trim().length < 2) return
    let live = true
    const t = setTimeout(() => {
      setLoading(true)
      api.get<{ data: CustomerHit[] }>(`/pos/customers?q=${encodeURIComponent(q.trim())}`).then((r) => live && setHits(r.data)).catch(() => undefined).finally(() => live && setLoading(false))
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [q])
  const shown = q.trim().length < 2 ? [] : hits
  const digits = phone.replace(/\D/g, "")
  async function save() {
    const errs: Record<string, string> = {}
    if (name.trim().length < 2) errs.name = "Enter the name"
    if (!/^[6-9]\d{9}$/.test(digits)) errs.phone = "Enter a 10-digit mobile number"
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const c = await api.post<{ id: string; name: string; phone: string | null; gstin: string | null; existing: boolean }>("/pos/customers", { name: name.trim(), phone: digits })
      if (c.existing) toast.info(`${c.name} already has this number. Using them.`)
      onPick({ id: c.id, name: c.name, phone: c.phone, gstin: c.gstin })
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields)
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  function walkIn() {
    const errs: Record<string, string> = {}
    if (need && name.trim().length < 2) errs.name = "This counter needs the name"
    if ((need || digits) && !/^[6-9]\d{9}$/.test(digits)) errs.phone = "Enter a 10-digit mobile number"
    setErrors(errs)
    if (Object.keys(errs).length) return
    onPick(name.trim() || digits ? { id: null, name: name.trim() || "Walk-in customer", phone: digits || null } : null)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Customer</DialogTitle>
          <DialogDescription>Find a regular customer, add a new one, or bill a walk-in.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, mobile or GSTIN" className="pl-9" aria-label="Find a customer" />
        </div>
        {loading && <p className="text-sm text-muted-foreground">Searching…</p>}
        {shown.length > 0 && (
          <ul className="grid max-h-60 gap-1 overflow-y-auto">
            {shown.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onPick({ id: c.id, name: c.companyName || c.name, phone: c.phone, gstin: c.gstin })} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-muted">
                  <span><span className="block font-medium">{c.companyName || c.name}</span><span className="text-xs text-muted-foreground">{[c.phone, c.gstin].filter(Boolean).join(" · ") || "No phone"}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && !loading && !shown.length && <p className="text-sm text-muted-foreground">No customer found.</p>}
        <div className="grid gap-3 rounded-xl border p-3">
          <p className="text-sm font-medium">{adding ? "New customer" : "Walk-in or new customer"}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" error={errors.name} required={need || adding}><Input value={name} maxLength={160} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: "" })) }} /></Field>
            <Field label="Mobile" error={errors.phone} required={need || adding}><Input inputMode="numeric" maxLength={10} value={digits} onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); setErrors((x) => ({ ...x, phone: "" })) }} placeholder="98XXXXXXXX" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={adding} onChange={(e) => setAdding(e.target.checked)} className="size-4 accent-primary" /> Save as a customer (they can buy on account later)</label>
        </div>
        <DialogFooter className="sm:justify-between">
          {current ? <Button variant="ghost" onClick={() => onPick(null)} disabled={need}>Clear customer</Button> : <span />}
          <span className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            {adding ? <Button onClick={() => void save()} disabled={busy}><UserPlus /> Save customer</Button> : <Button onClick={walkIn}>Use for this bill</Button>}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Cash put into or taken out of the drawer */
export function CashMoveDialog({ shift, rules, financeOn, onDone, onClose }: { shift: ShiftSummary; rules: Register["rules"]; financeOn: boolean; onDone: (s: ShiftSummary) => void; onClose: () => void }) {
  const [kind, setKind] = React.useState<"in" | "out">("out")
  const [amount, setAmount] = React.useState<number | null>(null)
  const [reason, setReason] = React.useState("expense")
  const [category, setCategory] = React.useState("")
  const [note, setNote] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const reasons = kind === "in" ? ["float", "change", "other"] : ["expense", "owner", "change", "other"]
  async function save() {
    const errs: Record<string, string> = {}
    if (!amount || amount <= 0) errs.amountPaise = "Enter the amount"
    if (kind === "out" && amount && amount > shift.cash.expectedPaise) errs.amountPaise = `Only ${formatPaise(shift.cash.expectedPaise)} should be in the drawer`
    if (reason === "expense" && !category) errs.category = "Choose the expense head"
    if (reason === "other" && !note.trim()) errs.note = "Write what it was for"
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ shift: ShiftSummary; expenseId: string | null }>(`/pos/shifts/${shift.id}/cash`, { kind, amountPaise: amount, reason, category: reason === "expense" ? category : null, note: note.trim() || null })
      toast.success(kind === "in" ? "Cash added to the drawer" : r.expenseId ? "Cash taken out and saved as an expense" : "Cash taken out")
      onDone(r.shift)
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields)
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cash in or out</DialogTitle>
          <DialogDescription>Money put into or taken from the drawer that is not a sale. Drawer now: {formatPaise(shift.cash.expectedPaise)}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="In or out">
          {(["out", "in"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setReason(k === "in" ? "float" : "expense") }} className={cn("rounded-xl border p-2.5 text-sm font-medium", kind === k && "border-primary bg-primary/5 text-primary")}>{k === "out" ? "Take cash out" : "Put cash in"}</button>)}
        </div>
        <Field label="Amount" error={errors.amountPaise} required><MoneyInput value={amount} onChange={(v) => { setAmount(v); setErrors((x) => ({ ...x, amountPaise: "" })) }} autoFocus /></Field>
        <Field label="Why" required><NativeSelect value={reason} onChange={(e) => setReason(e.target.value)}>{reasons.map((r) => <option key={r} value={r}>{MOVE_REASON[r]}</option>)}</NativeSelect></Field>
        {reason === "expense" && (
          <Field label="Expense head" error={errors.category} required hint={financeOn ? "Saved as an expense paid from the counter's cash" : "Finance is off, so it is only noted on the shift"}>
            <NativeSelect value={category} onChange={(e) => { setCategory(e.target.value); setErrors((x) => ({ ...x, category: "" })) }}><option value="">Choose…</option>{rules.expenseCategories.map((c) => <option key={c}>{c}</option>)}</NativeSelect>
          </Field>
        )}
        <Field label="Note" error={errors.note} required={reason === "other"}><Input value={note} maxLength={300} onChange={(e) => { setNote(e.target.value); setErrors((x) => ({ ...x, note: "" })) }} placeholder={reason === "expense" ? "e.g. Tea for staff" : ""} /></Field>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface HeldBill { id: string; label: string; cart: Cart & { heldId?: string }; totalPaise: number; lines: number; at: string; by: string | null }

export function HeldDialog({ rows, onResume, onDrop, onClose }: { rows: HeldBill[]; onResume: (h: HeldBill) => void; onDrop: (h: HeldBill) => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bills on hold</DialogTitle>
          <DialogDescription>Pick one up to finish it. Bills stay here across shifts.</DialogDescription>
        </DialogHeader>
        {!rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">No bills on hold.</p> : (
          <ul className="grid max-h-[60vh] gap-2 overflow-y-auto">
            {rows.map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-xl border p-3">
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{h.label}</span><span className="text-xs text-muted-foreground">{h.lines} item{h.lines === 1 ? "" : "s"} · {formatDateTime(h.at)}{h.by ? ` · ${h.by}` : ""}</span></span>
                <span className="font-semibold tabular-nums">{formatPaise(h.totalPaise)}</span>
                <Button size="sm" onClick={() => onResume(h)}>Resume</Button>
                <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={`Remove ${h.label}`} onClick={() => onDrop(h)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Serial-tracked item: choose or scan the pieces sold */
export function SerialDialog({ itemName, counterId, itemId, initial, onDone, onClose }: { itemName: string; counterId: string; itemId: string; initial: string[]; onDone: (serials: string[]) => void; onClose: () => void }) {
  const [all, setAll] = React.useState<string[] | null>(null)
  const [picked, setPicked] = React.useState<string[]>(initial)
  const [scan, setScan] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { api.get<{ data: string[] }>(`/pos/items/${itemId}/serials?counterId=${counterId}`).then((r) => setAll(r.data)).catch((e) => setError(errorMessage(e))) }, [itemId, counterId])
  const toggle = (s: string) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))
  function onScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return
    e.preventDefault()
    const s = scan.trim()
    if (!s) return
    if (all && !all.includes(s)) setError(`${s} is not on this counter's shelf.`)
    else { setError(null); setPicked((p) => (p.includes(s) ? p : [...p, s])) }
    setScan("")
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Serial numbers</DialogTitle>
          <DialogDescription>{itemName}: scan or tick the pieces sold. Quantity follows.</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={onScan} placeholder="Scan a serial number and press Enter" aria-label="Scan serial" />
        {!all ? <p className="text-sm text-muted-foreground">Loading…</p> : !all.length ? <p className="text-sm text-muted-foreground">None in stock at this counter.</p> : (
          <div className="grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto">
            {all.map((s) => <label key={s} className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5 font-mono text-xs", picked.includes(s) && "border-primary bg-primary/5")}><input type="checkbox" className="accent-primary" checked={picked.includes(s)} onChange={() => toggle(s)} />{s}</label>)}
          </div>
        )}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onDone(picked)} disabled={!picked.length}>Use {picked.length || ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface Bill {
  id: string; number: string; issueDate: string; customer: string; contactId: string | null; totalPaise: number; paidPaise: number; duePaise: number; fromCounter: boolean
  lines: { id: string; description: string; unit: string; quantity: number; quantityLeft: number; unitTotalPaise: number; serials: string[]; tracking: string }[]
}
const REASONS: [string, string][] = [["damaged", "Damaged"], ["wrong_item", "Wrong item"], ["quality", "Quality problem"], ["excess", "Bought too many"], ["not_needed", "Not needed"], ["other", "Other"]]

/** Goods back at the counter: find the bill, choose what came back, pay back or keep as credit */
export function ReturnDialog({ shiftId, onDone, onClose }: { shiftId: string; onDone: (msg: string) => void; onClose: () => void }) {
  const [number, setNumber] = React.useState("")
  const [bill, setBill] = React.useState<Bill | null>(null)
  const [qty, setQty] = React.useState<Record<string, string>>({})
  const [reason, setReason] = React.useState("damaged")
  const [notes, setNotes] = React.useState("")
  const [refund, setRefund] = React.useState("cash")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function find(e?: React.FormEvent) {
    e?.preventDefault()
    if (!number.trim()) return
    setBusy(true)
    setError(null)
    try {
      const b = await api.get<Bill>(`/pos/bills?number=${encodeURIComponent(number.trim())}`)
      setBill(b)
      setQty({})
      setRefund("cash")
    } catch (err) {
      setBill(null)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const chosen = bill?.lines.filter((l) => Number(qty[l.id] || 0) > 0) ?? []
  const value = chosen.reduce((a, l) => a + Math.round(Number(qty[l.id]) * l.unitTotalPaise), 0)
  async function save() {
    if (!bill) return
    if (!chosen.length) return setError("Choose what came back")
    if (reason === "other" && !notes.trim()) return setError("Write what happened")
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ number: string; refundPaise: number; creditPaise: number; clearedPaise: number }>("/pos/returns", { shiftId, invoiceId: bill.id, reason, notes: notes.trim() || null, refund, lines: chosen.map((l) => ({ sourceLineId: l.id, quantity: Number(qty[l.id]) })) })
      onDone(r.refundPaise > 0 ? `Return ${r.number}: pay back ${formatPaise(r.refundPaise)} by ${TENDER_LABEL[refund]}` : r.creditPaise > 0 ? `Return ${r.number}: ${formatPaise(r.creditPaise)} kept as credit` : `Return ${r.number} cleared ${formatPaise(r.clearedPaise)} owed on the bill`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Return</DialogTitle>
          <DialogDescription>Goods come back into stock and the money goes back from this shift. What the bill still owed is cleared first.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void find(e)} className="flex gap-2">
          <Input autoFocus value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Bill number, e.g. INV/26-27/0012" aria-label="Bill number" />
          <Button type="submit" variant="outline" disabled={busy}><Search /> Find bill</Button>
        </form>
        {bill && (
          <>
            <div className="flex flex-wrap justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm">
              <span><b>{bill.number}</b> · {bill.customer}</span>
              <span className="tabular-nums">{formatPaise(bill.totalPaise)}{bill.duePaise > 0 && <span className="text-amber-700 dark:text-amber-400"> · {formatPaise(bill.duePaise)} owed</span>}</span>
            </div>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Sold</th><th className="px-3 py-2 text-right">Can return</th><th className="px-3 py-2">Coming back</th></tr></thead>
                <tbody>
                  {bill.lines.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-2">{l.description}<span className="block text-xs text-muted-foreground">{formatPaise(l.unitTotalPaise)} each</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.quantityLeft}</td>
                      <td className="w-40 px-3 py-2">{l.quantityLeft > 0 ? <NumberStepper size="sm" value={qty[l.id] ?? ""} max={l.quantityLeft} decimals={!Number.isInteger(l.quantity)} onChange={(v) => setQty((q) => ({ ...q, [l.id]: v }))} aria-label={`Return ${l.description}`} /> : <span className="text-xs text-muted-foreground">All returned</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Why" required><NativeSelect value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
              <Field label="Money back by" required>
                <NativeSelect value={refund} onChange={(e) => setRefund(e.target.value)}>
                  {["cash", "upi", "card"].map((m) => <option key={m} value={m}>{TENDER_LABEL[m]}</option>)}
                  {bill.contactId && <option value="credit">Keep as credit for the next bill</option>}
                </NativeSelect>
              </Field>
            </div>
            <Field label="Note" required={reason === "other"}><Textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            {value > 0 && <p className="rounded-xl bg-primary/5 px-3 py-2 text-sm">About <b className="tabular-nums">{formatPaise(value)}</b> comes back{bill.duePaise > 0 ? `; ${formatPaise(Math.min(value, bill.duePaise))} of it clears what is owed` : ""}.</p>}
          </>
        )}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || !bill || !chosen.length}>{busy && <Loader2 className="animate-spin" />} Take back</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
