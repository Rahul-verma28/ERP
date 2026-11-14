"use client"

import * as React from "react"
import { toast } from "sonner"
import { ArrowRightLeft, Building2, Landmark, Receipt, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { MoneyInput } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { FormSection } from "@/components/contact-dialog"
import { SearchSelect } from "@/components/search-select"
import { todayInIndia, gstin as gstinRule } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import { KIND_LABEL, useFinAccounts, type AccountKind, type Expense, type FinAccount, type Income } from "@/lib/finance"

// Finance forms: account, expense, other income, transfer; and the account and category pickers
// that every money form uses, each with "add" inside the list.

const GST_RATES = [[500, "5%"], [1200, "12%"], [1800, "18%"], [2800, "28%"], [300, "3%"], [25, "0.25%"]] as const

/** Pick a cash or bank account; shows each balance; "+ Add account" opens the account form */
export function AccountSelect({ value, onChange, exclude, ...rest }: { value: string; onChange: (id: string) => void; exclude?: string; "aria-label"?: string; "aria-invalid"?: boolean }) {
  const { can } = useAuth()
  const accounts = useFinAccounts()
  const [adding, setAdding] = React.useState<string | null>(null)
  const rows = (accounts.data?.data ?? []).filter((a) => a.isActive && a.id !== exclude)
  return (
    <>
      <SearchSelect
        {...rest}
        value={value}
        onChange={onChange}
        options={rows.map((a) => ({ value: a.id, label: `${a.name} · ${formatPaise(a.balancePaise)}`, keywords: `${a.bankName ?? ""} ${KIND_LABEL[a.kind]}` }))}
        placeholder="Choose the account"
        searchPlaceholder="Search accounts…"
        searchable
        onCreate={can("finance.expense.create") ? (typed) => setAdding(typed) : undefined}
        createLabel="Add a cash or bank account"
      />
      {adding !== null && <AccountDialog account={null} initialName={adding} onClose={() => setAdding(null)} onSaved={async (a) => { setAdding(null); await accounts.reload(); onChange(a.id) }} />}
    </>
  )
}

/** The account a payment method usually goes to: cash → cash account, else the default bank */
export function accountForMethod(accounts: FinAccount[], method: string) {
  const open = accounts.filter((a) => a.isActive)
  if (method === "cash") return open.find((a) => a.kind === "cash")?.id ?? open[0]?.id ?? ""
  return open.find((a) => a.isDefault)?.id ?? open.find((a) => a.kind !== "cash")?.id ?? open[0]?.id ?? ""
}

/** "Received in" / "Paid from" on a payment form. Empty value = the usual account for the method.
 * Hidden for people without finance access; the server then routes by method. */
export function PaymentAccountField({ label, method, value, onChange, className }: { label: string; method: string; value: string; onChange: (id: string) => void; className?: string }) {
  const { can } = useAuth()
  if (!can("finance.expense.view")) return null
  return <PaymentAccountInner label={label} method={method} value={value} onChange={onChange} className={className} />
}
function PaymentAccountInner({ label, method, value, onChange, className }: { label: string; method: string; value: string; onChange: (id: string) => void; className?: string }) {
  const accounts = useFinAccounts()
  const shown = value || accountForMethod(accounts.data?.data ?? [], method)
  return (
    <Field label={label} className={className} hint={value ? undefined : "Picked from how it was paid; change it if needed"}>
      <AccountSelect aria-label={label} value={shown} onChange={onChange} />
    </Field>
  )
}

/** Expense or income head: pick one, or type a new one and add it */
export function CategorySelect({ kind, value, onChange, ...rest }: { kind: "expense" | "income"; value: string; onChange: (v: string) => void; "aria-label"?: string; "aria-invalid"?: boolean }) {
  const { can } = useAuth()
  const list = useSharedApi<{ data: { id: string; name: string }[] }>(`/finance/categories?kind=${kind}`)
  const names = list.data?.data.map((c) => c.name) ?? []
  return (
    <SearchSelect
      {...rest}
      value={value}
      onChange={onChange}
      options={[...names, ...(value && !names.includes(value) ? [value] : [])].map((n) => ({ value: n, label: n }))}
      placeholder={kind === "expense" ? "What was it for?" : "What kind of income?"}
      searchPlaceholder="Search or type a new one…"
      searchable
      onCreate={can("finance.expense.create") ? async (typed) => {
        const name = typed.trim()
        if (name.length < 2) return toast.error("Type the new category in the search first")
        try {
          await api.post("/finance/categories", { kind, name })
          await list.reload()
          onChange(name)
          toast.success(`${name} added`)
        } catch (e) {
          toast.error(errorMessage(e))
        }
      } : undefined}
      createLabel="Add this category"
    />
  )
}

// ── Account ──

export function AccountDialog({ account, initialName = "", onClose, onSaved }: { account: FinAccount | null; initialName?: string; onClose: () => void; onSaved: (a: FinAccount) => void }) {
  const [f, setF] = React.useState({
    name: account?.name ?? initialName, kind: (account?.kind ?? "bank") as AccountKind, bankName: account?.bankName ?? "", accountNo: account?.accountNo ?? "", ifsc: account?.ifsc ?? "", upiId: account?.upiId ?? "",
    openingPaise: account?.openingPaise ?? (null as number | null), openingDate: account?.openingDate?.slice(0, 10) ?? "", isDefault: account?.isDefault ?? false, notes: account?.notes ?? "",
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: "" } : e)); setError(null) }
  const today = todayInIndia()
  const bankish = f.kind === "bank"

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    ev.stopPropagation()
    const e: Record<string, string> = {}
    if (f.name.trim().length < 2) e.name = "Enter the account name"
    if (bankish && !f.bankName.trim()) e.bankName = "Enter the bank name"
    if (f.accountNo && !/^\d{6,18}$/.test(f.accountNo)) e.accountNo = "Account number has 6 to 18 digits"
    if (f.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifsc)) e.ifsc = "IFSC has 11 characters, e.g. HDFC0001234"
    if (f.upiId && !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(f.upiId)) e.upiId = "Enter a UPI ID like name@bank"
    if (f.openingPaise && !f.openingDate) e.openingDate = "Choose the date of this balance"
    if (f.openingDate && f.openingDate > today) e.openingDate = "Can't be in the future"
    setErrors(e)
    if (Object.keys(e).length) return setError("Fix the marked fields first.")
    setBusy(true)
    const body = { name: f.name.trim(), kind: f.kind, bankName: f.bankName.trim() || null, accountNo: f.accountNo || null, ifsc: f.ifsc || null, upiId: f.upiId.trim() || null, openingPaise: f.openingPaise ?? 0, openingDate: f.openingDate || null, notes: f.notes.trim() || null, ...(f.kind !== "cash" && f.isDefault ? { isDefault: true } : {}) }
    try {
      const saved = account ? await api.patch<FinAccount>(`/finance/accounts/${account.id}`, { ...body, kind: undefined, version: account.version }) : await api.post<FinAccount>("/finance/accounts", body)
      toast.success(account ? "Account saved" : `${saved.name} added`)
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{account ? `Edit ${account.name}` : "New account"}</DialogTitle>
          <DialogDescription>Where money sits: cash in the shop, a bank account, a UPI wallet or a credit card.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-5" noValidate>
          <FormSection icon={Wallet} title="Account">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" required>
                <NativeSelect value={f.kind} disabled={!!account} onChange={(e) => set("kind", e.target.value as AccountKind)} aria-label="Type">
                  {(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Account name" required error={errors.name} hint="As you call it, e.g. HDFC current"><Input value={f.name} maxLength={60} onChange={(e) => set("name", e.target.value)} placeholder={f.kind === "cash" ? "e.g. Shop counter cash" : f.kind === "wallet" ? "e.g. PhonePe business" : f.kind === "card" ? "e.g. ICICI credit card" : "e.g. HDFC current account"} autoFocus /></Field>
            </div>
          </FormSection>
          {f.kind !== "cash" && (
            <FormSection icon={Landmark} title="Bank details" hint="Optional for UPI and cards; shown on the account page, not shared">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Bank name" required={bankish} error={errors.bankName}><Input value={f.bankName} maxLength={80} onChange={(e) => set("bankName", e.target.value)} placeholder="e.g. HDFC Bank" /></Field>
                <Field label="Account number" error={errors.accountNo}><Input mask="digits" value={f.accountNo} maxLength={18} onChange={(e) => set("accountNo", e.target.value)} placeholder="6 to 18 digits" /></Field>
                <Field label="IFSC" error={errors.ifsc}><Input mask="ifsc" value={f.ifsc} onChange={(e) => set("ifsc", e.target.value)} placeholder="e.g. HDFC0001234" /></Field>
                <Field label="UPI ID" error={errors.upiId}><Input value={f.upiId} onChange={(e) => set("upiId", e.target.value)} placeholder="e.g. shop@hdfcbank" /></Field>
              </div>
            </FormSection>
          )}
          <FormSection icon={Receipt} title="Opening balance" hint="What was in it on the day you start using AHEAD">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount" hint={f.kind === "card" ? "Enter what you owe on the card as a minus amount" : undefined}><MoneyInput value={f.openingPaise} onChange={(v) => set("openingPaise", v)} aria-label="Opening balance" /></Field>
              <Field label="As on" required={!!f.openingPaise} error={errors.openingDate}><Input type="date" value={f.openingDate} max={today} onChange={(e) => set("openingDate", e.target.value)} /></Field>
            </div>
          </FormSection>
          {f.kind !== "cash" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={f.isDefault} disabled={account?.isDefault} onChange={(e) => set("isDefault", e.target.checked)} /><span>Use for UPI, card and bank payments by default<span className="block text-xs text-muted-foreground">Payments not cash go here unless another account is chosen</span></span></label>}
          <Field label="Notes"><Input value={f.notes} maxLength={500} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" /></Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : account ? "Save account" : "Add account"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Expense ──

export function ExpenseDialog({ expense, copyOf, onClose, onSaved }: { expense?: Expense | null; copyOf?: Expense | null; onClose: () => void; onSaved: (e: Expense) => void }) {
  const today = todayInIndia()
  const accounts = useFinAccounts()
  const src = expense ?? copyOf
  const [f, setF] = React.useState({
    category: src?.category ?? "", amountPaise: src?.amountPaise ?? (null as number | null), paidOn: expense?.paidOn.slice(0, 10) ?? today,
    accountId: src?.accountId ?? "", payee: src?.payee ?? "", reference: expense?.reference ?? "", notes: src?.notes ?? "", receiptUrl: expense?.receiptUrl ?? "",
    gstBill: !!src?.gstPaise, billNo: expense?.billNo ?? "", vendorGstin: src?.vendorGstin ?? "", gstRateBp: src?.gstRateBp ?? 1800,
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: "" } : e)); setError(null) }
  const account = f.accountId || accountForMethod(accounts.data?.data ?? [], "cash")
  const cashAccount = accounts.data?.data.find((a) => a.id === account)?.kind === "cash"
  const taxable = f.gstBill && f.amountPaise ? Math.round((f.amountPaise * 10_000) / (10_000 + f.gstRateBp)) : null

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    const e: Record<string, string> = {}
    if (!f.category) e.category = "Choose what it was for"
    if (!f.amountPaise || f.amountPaise <= 0) e.amountPaise = "Enter the amount paid"
    if (!f.paidOn) e.paidOn = "Choose the date"
    else if (f.paidOn > today) e.paidOn = "Can't be in the future"
    if (!account) e.accountId = "Choose the account it was paid from"
    if (f.gstBill) {
      if (!f.billNo.trim()) e.billNo = "Enter the bill number"
      if (!f.vendorGstin) e.vendorGstin = "Enter the supplier's GSTIN"
      else if (gstinRule(f.vendorGstin)) e.vendorGstin = gstinRule(f.vendorGstin)!
    }
    if (f.receiptUrl && !/^https?:\/\//.test(f.receiptUrl)) e.receiptUrl = "Paste a full link starting with https://"
    setErrors(e)
    if (Object.keys(e).length) return setError("Fix the marked fields first.")
    setBusy(true)
    const body = {
      category: f.category, amountPaise: f.amountPaise, paidOn: f.paidOn, accountId: account, payee: f.payee.trim() || null, reference: f.reference.trim() || null, notes: f.notes.trim() || null, receiptUrl: f.receiptUrl.trim() || null,
      gstBill: f.gstBill, ...(f.gstBill ? { billNo: f.billNo.trim(), vendorGstin: f.vendorGstin, gstRateBp: f.gstRateBp } : {}),
    }
    try {
      const saved = expense ? await api.put<Expense>(`/expenses/${expense.id}`, { ...body, version: expense.version }) : await api.post<Expense>("/expenses", body)
      toast.success(expense ? "Expense saved" : `${saved.number ?? "Expense"} saved`)
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{expense ? `Edit ${expense.number ?? "expense"}` : "New expense"}</DialogTitle>
          <DialogDescription>Money spent to run the business: rent, salary, electricity, travel. Stock you buy goes in Purchase instead.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-5" noValidate>
          <FormSection icon={Receipt} title="Expense">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" required error={errors.category}><CategorySelect kind="expense" value={f.category} onChange={(v) => set("category", v)} aria-label="Category" /></Field>
              <Field label="Amount paid" required error={errors.amountPaise} hint={f.gstBill ? "Including GST, as on the bill" : undefined}><MoneyInput value={f.amountPaise} onChange={(v) => set("amountPaise", v)} aria-label="Amount paid" autoFocus /></Field>
              <Field label="Date" required error={errors.paidOn}><Input type="date" value={f.paidOn} max={today} onChange={(e) => set("paidOn", e.target.value)} /></Field>
              <Field label="Paid from" required error={errors.accountId} hint={cashAccount && (f.amountPaise ?? 0) > 1_000_000 ? "Cash over ₹10,000 to one person in a day is not allowed as an expense (Section 40A(3))" : undefined}><AccountSelect value={account} onChange={(v) => set("accountId", v)} aria-label="Paid from" /></Field>
              <Field label="Paid to" hint="Person or shop"><Input value={f.payee} maxLength={160} onChange={(e) => set("payee", e.target.value)} placeholder="e.g. Sharma Properties" /></Field>
              <Field label="Reference" hint="UPI ref, cheque no., voucher no."><Input value={f.reference} maxLength={60} onChange={(e) => set("reference", e.target.value)} placeholder="Optional" /></Field>
            </div>
          </FormSection>
          <FormSection icon={Building2} title="GST bill" hint="With a GST bill from a registered supplier, the GST can be claimed back">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={f.gstBill} onChange={(e) => set("gstBill", e.target.checked)} /> I have a GST bill for this</label>
            {f.gstBill && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Bill number" required error={errors.billNo}><Input value={f.billNo} maxLength={30} onChange={(e) => set("billNo", e.target.value)} placeholder="e.g. R/2026/114" /></Field>
                <Field label="Supplier GSTIN" required error={errors.vendorGstin}><Input mask="gstin" value={f.vendorGstin} onChange={(e) => set("vendorGstin", e.target.value)} placeholder="15 characters" className="font-mono" /></Field>
                <Field label="GST rate" required error={errors.gstRateBp}>
                  <NativeSelect value={String(f.gstRateBp)} onChange={(e) => set("gstRateBp", Number(e.target.value))} aria-label="GST rate">{GST_RATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
                </Field>
                {taxable != null && <p className="rounded-xl bg-muted px-3 py-2 text-sm sm:col-span-3">Before GST <strong className="tabular-nums">{formatPaise(taxable)}</strong> · GST to claim <strong className="tabular-nums">{formatPaise((f.amountPaise ?? 0) - taxable)}</strong></p>}
              </div>
            )}
          </FormSection>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Notes"><Textarea value={f.notes} rows={2} maxLength={1000} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. November rent, shop 12" /></Field>
            <Field label="Bill photo link" error={errors.receiptUrl} hint="A link to the photo or PDF"><Input value={f.receiptUrl} maxLength={500} onChange={(e) => set("receiptUrl", e.target.value)} placeholder="https://…" /></Field>
          </div>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : expense ? "Save expense" : "Add expense"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Other income ──

export function IncomeDialog({ income, onClose, onSaved }: { income?: Income | null; onClose: () => void; onSaved: (i: Income) => void }) {
  const today = todayInIndia()
  const accounts = useFinAccounts()
  const [f, setF] = React.useState({ category: income?.category ?? "", amountPaise: income?.amountPaise ?? (null as number | null), receivedOn: income?.receivedOn.slice(0, 10) ?? today, accountId: income?.accountId ?? "", payer: income?.payer ?? "", reference: income?.reference ?? "", notes: income?.notes ?? "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: "" } : e)); setError(null) }
  const account = f.accountId || accountForMethod(accounts.data?.data ?? [], "bank")

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    const e: Record<string, string> = {}
    if (!f.category) e.category = "Choose what it was"
    if (!f.amountPaise || f.amountPaise <= 0) e.amountPaise = "Enter the amount received"
    if (!f.receivedOn) e.receivedOn = "Choose the date"
    else if (f.receivedOn > today) e.receivedOn = "Can't be in the future"
    if (!account) e.accountId = "Choose the account it came into"
    setErrors(e)
    if (Object.keys(e).length) return setError("Fix the marked fields first.")
    setBusy(true)
    const body = { ...f, accountId: account, payer: f.payer.trim() || null, reference: f.reference.trim() || null, notes: f.notes.trim() || null }
    try {
      const saved = income ? await api.put<Income>(`/incomes/${income.id}`, { ...body, version: income.version }) : await api.post<Income>("/incomes", body)
      toast.success(income ? "Income saved" : `${saved.number} saved`)
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{income ? `Edit ${income.number}` : "Other income"}</DialogTitle>
          <DialogDescription>Money in that is not a customer payment: bank interest, commission, rent you receive, scrap sold.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Category" required error={errors.category}><CategorySelect kind="income" value={f.category} onChange={(v) => set("category", v)} aria-label="Category" /></Field>
          <Field label="Amount received" required error={errors.amountPaise}><MoneyInput value={f.amountPaise} onChange={(v) => set("amountPaise", v)} aria-label="Amount received" autoFocus /></Field>
          <Field label="Date" required error={errors.receivedOn}><Input type="date" value={f.receivedOn} max={today} onChange={(e) => set("receivedOn", e.target.value)} /></Field>
          <Field label="Received in" required error={errors.accountId}><AccountSelect value={account} onChange={(v) => set("accountId", v)} aria-label="Received in" /></Field>
          <Field label="Received from"><Input value={f.payer} maxLength={160} onChange={(e) => set("payer", e.target.value)} placeholder="e.g. HDFC Bank" /></Field>
          <Field label="Reference"><Input value={f.reference} maxLength={60} onChange={(e) => set("reference", e.target.value)} placeholder="UTR or receipt no." /></Field>
          <Field label="Notes" className="sm:col-span-2"><Input value={f.notes} maxLength={1000} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : income ? "Save income" : "Add income"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Transfer ──

export function TransferDialog({ from: initialFrom, onClose, onSaved }: { from?: string; onClose: () => void; onSaved: () => void }) {
  const today = todayInIndia()
  const accounts = useFinAccounts()
  const list = accounts.data?.data.filter((a) => a.isActive) ?? []
  const [f, setF] = React.useState({ transferOn: today, fromAccountId: initialFrom ?? "", toAccountId: "", amountPaise: null as number | null, chargesPaise: null as number | null, reference: "", notes: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: "" } : e)); setError(null) }
  const from = list.find((a) => a.id === f.fromAccountId)
  const to = list.find((a) => a.id === f.toAccountId)

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    const e: Record<string, string> = {}
    if (!f.fromAccountId) e.fromAccountId = "Choose where the money comes from"
    if (!f.toAccountId) e.toAccountId = "Choose where it goes"
    else if (f.toAccountId === f.fromAccountId) e.toAccountId = "Choose a different account"
    if (!f.amountPaise || f.amountPaise <= 0) e.amountPaise = "Enter the amount"
    else if (from?.kind === "cash" && f.amountPaise + (f.chargesPaise ?? 0) > from.balancePaise) e.amountPaise = `Only ${formatPaise(from.balancePaise)} is in ${from.name}`
    if (!f.transferOn) e.transferOn = "Choose the date"
    else if (f.transferOn > today) e.transferOn = "Can't be in the future"
    setErrors(e)
    if (Object.keys(e).length) return setError("Fix the marked fields first.")
    setBusy(true)
    try {
      await api.post("/finance/transfers", { ...f, amountPaise: f.amountPaise, chargesPaise: f.chargesPaise ?? 0, reference: f.reference.trim() || null, notes: f.notes.trim() || null })
      toast.success(`${formatPaise(f.amountPaise!)} moved to ${to?.name}`)
      await accounts.reload()
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ArrowRightLeft className="size-5 text-primary" /> Move money</DialogTitle>
          <DialogDescription>Between your own accounts: cash deposited in the bank, cash taken out, card bill paid. It is not income or an expense.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="From" required error={errors.fromAccountId} hint={from ? `Has ${formatPaise(from.balancePaise)}` : undefined}><AccountSelect value={f.fromAccountId} onChange={(v) => set("fromAccountId", v)} aria-label="From" /></Field>
          <Field label="To" required error={errors.toAccountId} hint={to ? `Has ${formatPaise(to.balancePaise)}` : undefined}><AccountSelect value={f.toAccountId} exclude={f.fromAccountId} onChange={(v) => set("toAccountId", v)} aria-label="To" /></Field>
          <Field label="Amount" required error={errors.amountPaise}><MoneyInput value={f.amountPaise} onChange={(v) => set("amountPaise", v)} aria-label="Amount" /></Field>
          <Field label="Bank charges" hint="Taken from the From account"><MoneyInput value={f.chargesPaise} onChange={(v) => set("chargesPaise", v)} aria-label="Bank charges" /></Field>
          <Field label="Date" required error={errors.transferOn}><Input type="date" value={f.transferOn} max={today} onChange={(e) => set("transferOn", e.target.value)} /></Field>
          <Field label="Reference"><Input value={f.reference} maxLength={60} onChange={(e) => set("reference", e.target.value)} placeholder="Deposit slip or UTR" /></Field>
          <Field label="Notes" className="sm:col-span-2"><Input value={f.notes} maxLength={500} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Move money"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
