"use client"

import * as React from "react"
import { toast } from "sonner"
import { Plus, Scale, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { MoneyInput } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { SearchSelect } from "@/components/search-select"
import { AccountSelect, CategorySelect, accountForMethod } from "@/components/finance/forms"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { EVERY_LABEL, GROUP_HINT, GROUP_LABEL, useFinAccounts, useLedgers, type Journal, type Ledger, type LedgerGroup, type Recurring } from "@/lib/finance"
import { cn } from "@/lib/utils"

// Books forms: your own ledger, a journal entry (debits = credits), and a repeating expense.

/** Any ledger a journal entry may use, grouped by kind; "+ Add ledger" opens the ledger form */
export function LedgerSelect({ value, onChange, ...rest }: { value: string; onChange: (key: string) => void; "aria-label"?: string; "aria-invalid"?: boolean }) {
  const { can } = useAuth()
  const ledgers = useLedgers()
  const [adding, setAdding] = React.useState<string | null>(null)
  const rows = (ledgers.data?.data ?? []).filter((l) => l.journal || l.key === value)
  return (
    <>
      <SearchSelect
        {...rest}
        value={value}
        onChange={onChange}
        options={rows.map((l) => ({ value: l.key, label: l.name, description: `${GROUP_LABEL[l.group]} · ${l.section}`, keywords: `${l.code} ${l.section} ${GROUP_LABEL[l.group]}` }))}
        placeholder="Choose the ledger"
        searchPlaceholder="Search ledgers…"
        searchable
        onCreate={can("finance.expense.create") ? (typed) => setAdding(typed) : undefined}
        createLabel="Add a ledger (loan, asset, capital…)"
      />
      {adding !== null && <LedgerDialog ledger={null} initialName={adding} onClose={() => setAdding(null)} onSaved={async (l) => { setAdding(null); await ledgers.reload(); onChange(`led:${l.id}`) }} />}
    </>
  )
}

export function LedgerDialog({ ledger, initialName = "", initialGroup, onClose, onSaved }: { ledger: Ledger | null; initialName?: string; initialGroup?: LedgerGroup; onClose: () => void; onSaved: (l: { id: string; name: string }) => void }) {
  const [f, setF] = React.useState({ name: ledger?.name ?? initialName, group: (ledger?.group ?? initialGroup ?? "") as LedgerGroup | "", code: ledger?.code && ledger.id ? ledger.code : "", description: ledger?.description ?? "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: "" } : e)); setError(null) }

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    const e: Record<string, string> = {}
    if (f.name.trim().length < 2) e.name = "Enter the ledger name"
    if (!f.group) e.group = "Choose what kind it is"
    setErrors(e)
    if (Object.keys(e).length) return setError("Fix the marked fields first.")
    setBusy(true)
    const body = { name: f.name.trim(), group: f.group, code: f.code.trim() || null, description: f.description.trim() || null }
    try {
      const saved = ledger?.id ? await api.patch<{ id: string; name: string }>(`/finance/ledgers/${ledger.id}`, { ...body, version: ledger.version }) : await api.post<{ id: string; name: string }>("/finance/ledgers", body)
      toast.success(ledger ? "Ledger saved" : `${saved.name} added`)
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{ledger ? `Edit ${ledger.name}` : "Add a ledger"}</DialogTitle>
          <DialogDescription>For what bills and payments don&apos;t cover: a loan, the owner&apos;s capital, a vehicle or machine, a deposit.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Name" required error={errors.name}><Input value={f.name} autoFocus maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Loan from SBI, Delivery van" /></Field>
          <Field label="What kind" required error={errors.group} hint={f.group ? GROUP_HINT[f.group] : undefined}>
            <NativeSelect value={f.group} aria-label="What kind" disabled={!!ledger?.usedInJournals} onChange={(e) => set("group", e.target.value as LedgerGroup)}>
              <option value="">Choose…</option>
              {(Object.keys(GROUP_LABEL) as LedgerGroup[]).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Code" error={errors.code} hint="Optional. Your CA's ledger code, if they use one"><Input value={f.code} maxLength={10} onChange={(e) => set("code", e.target.value)} placeholder="e.g. 2310" /></Field>
          <Field label="Notes"><Textarea value={f.description} rows={2} maxLength={300} onChange={(e) => set("description", e.target.value)} placeholder="e.g. 9.5% interest, 36 EMIs from April" /></Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : ledger ? "Save ledger" : "Add ledger"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Journal entry ──

interface Line { ledgerKey: string; debitPaise: number | null; creditPaise: number | null; description: string }
const blank = (): Line => ({ ledgerKey: "", debitPaise: null, creditPaise: null, description: "" })

/** Common entries, so nobody has to know which side is debit */
const TEMPLATES: { label: string; narration: string; lines: (cash: string) => Partial<Line>[] }[] = [
  { label: "Owner put in money", narration: "Capital introduced by the owner", lines: (cash) => [{ ledgerKey: cash, description: "Money in" }, { ledgerKey: "capital" }] },
  { label: "Owner took money out", narration: "Drawings by the owner", lines: (cash) => [{ ledgerKey: "capital" }, { ledgerKey: cash, description: "Money out" }] },
  { label: "Loan received", narration: "Loan received", lines: (cash) => [{ ledgerKey: cash }, { ledgerKey: "" }] },
  { label: "GST paid to government", narration: "GST paid for the month", lines: (cash) => [{ ledgerKey: "output_gst" }, { ledgerKey: cash }] },
  { label: "Set off GST input credit", narration: "Input tax credit used against GST payable", lines: () => [{ ledgerKey: "output_gst" }, { ledgerKey: "input_gst" }] },
]

export function JournalDialog({ journal, copyOf, preset, onClose, onSaved }: { journal?: Journal | null; copyOf?: Journal | null; preset?: { ledgerKey: string }; onClose: () => void; onSaved: (j: Journal) => void }) {
  const today = todayInIndia()
  const accounts = useFinAccounts()
  const src = journal ?? copyOf
  const [f, setF] = React.useState({ journalOn: journal?.journalOn.slice(0, 10) ?? today, narration: src?.narration ?? "", reference: journal?.reference ?? "" })
  const [lines, setLines] = React.useState<Line[]>(src ? src.lines.map((l) => ({ ledgerKey: l.ledgerKey, debitPaise: l.debitPaise || null, creditPaise: l.creditPaise || null, description: l.description ?? "" })) : [{ ...blank(), ledgerKey: preset?.ledgerKey ?? "" }, blank()])
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const dr = lines.reduce((s, l) => s + (l.debitPaise ?? 0), 0)
  const cr = lines.reduce((s, l) => s + (l.creditPaise ?? 0), 0)
  const diff = dr - cr
  const setLine = (i: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(`lines.${i}.`) && k !== "lines")))
    setError(null)
  }
  function applyTemplate(t: (typeof TEMPLATES)[number]) {
    const cash = `cash:${accountForMethod(accounts.data?.data ?? [], "bank")}`
    setF((x) => ({ ...x, narration: x.narration || t.narration }))
    setLines(t.lines(cash).map((l) => ({ ...blank(), ...l })))
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    const e: Record<string, string> = {}
    if (!f.journalOn) e.journalOn = "Choose the date"
    else if (f.journalOn > today) e.journalOn = "Can't be in the future"
    if (f.narration.trim().length < 3) e.narration = "Say what this entry is for"
    const used = lines.filter((l) => l.ledgerKey || l.debitPaise || l.creditPaise)
    used.forEach((l) => {
      const i = lines.indexOf(l)
      if (!l.ledgerKey) e[`lines.${i}.ledgerKey`] = "Choose the ledger"
      if (!!l.debitPaise === !!l.creditPaise) e[`lines.${i}.debitPaise`] = "A debit or a credit"
    })
    if (used.length < 2) e.lines = "Add at least two lines"
    else if (diff !== 0) e.lines = `Debits and credits differ by ${formatPaise(Math.abs(diff))}`
    setErrors(e)
    if (Object.keys(e).length) return setError(e.lines ?? "Fix the marked fields first.")
    setBusy(true)
    const body = { ...f, narration: f.narration.trim(), reference: f.reference.trim() || null, lines: used.map((l) => ({ ledgerKey: l.ledgerKey, debitPaise: l.debitPaise ?? 0, creditPaise: l.creditPaise ?? 0, description: l.description.trim() || null })) }
    try {
      const saved = journal ? await api.put<Journal>(`/finance/journals/${journal.id}`, { ...body, version: journal.version }) : await api.post<Journal>("/finance/journals", body)
      toast.success(journal ? "Journal entry saved" : `${saved.number} saved`)
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{journal ? `Edit ${journal.number}` : "Journal entry"}</DialogTitle>
          <DialogDescription>For what no bill or payment records — a loan, capital, GST paid, depreciation. Total debits must equal total credits.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          {!journal && !copyOf && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Start from:</span>
              {TEMPLATES.map((t) => <Button key={t.label} type="button" size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={() => applyTemplate(t)}>{t.label}</Button>)}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr_12rem]">
            <Field label="Date" required error={errors.journalOn}><Input type="date" value={f.journalOn} max={today} onChange={(e) => { setF((x) => ({ ...x, journalOn: e.target.value })); setErrors((x) => ({ ...x, journalOn: "" })) }} /></Field>
            <Field label="Narration" required error={errors.narration}><Input value={f.narration} maxLength={500} onChange={(e) => { setF((x) => ({ ...x, narration: e.target.value })); setErrors((x) => ({ ...x, narration: "" })) }} placeholder="e.g. Loan received from SBI, 36 EMIs" /></Field>
            <Field label="Reference"><Input value={f.reference} maxLength={60} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} placeholder="e.g. UTR or challan no." /></Field>
          </div>

          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr><th className="px-3 py-2 text-left font-medium">Ledger</th><th className="w-36 px-3 py-2 text-right font-medium">Debit (Dr)</th><th className="w-36 px-3 py-2 text-right font-medium">Credit (Cr)</th><th className="px-3 py-2 text-left font-medium">Line note</th><th className="w-10" /></tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((l, i) => (
                  <tr key={i} className="align-top">
                    <td className="px-2 py-2"><LedgerSelect value={l.ledgerKey} onChange={(v) => setLine(i, { ledgerKey: v })} aria-label={`Ledger, line ${i + 1}`} aria-invalid={!!errors[`lines.${i}.ledgerKey`]} />{errors[`lines.${i}.ledgerKey`] && <p className="mt-1 text-xs text-destructive">{errors[`lines.${i}.ledgerKey`]}</p>}</td>
                    <td className="px-2 py-2"><MoneyInput value={l.debitPaise} onChange={(v) => setLine(i, { debitPaise: v, creditPaise: v ? null : l.creditPaise })} aria-label={`Debit, line ${i + 1}`} aria-invalid={!!errors[`lines.${i}.debitPaise`]} />{errors[`lines.${i}.debitPaise`] && <p className="mt-1 text-xs text-destructive">{errors[`lines.${i}.debitPaise`]}</p>}</td>
                    <td className="px-2 py-2"><MoneyInput value={l.creditPaise} onChange={(v) => setLine(i, { creditPaise: v, debitPaise: v ? null : l.debitPaise })} aria-label={`Credit, line ${i + 1}`} /></td>
                    <td className="px-2 py-2"><Input value={l.description} maxLength={200} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Optional" aria-label={`Note, line ${i + 1}`} /></td>
                    <td className="px-1 py-2"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/30 text-sm font-semibold">
                <tr>
                  <td className="px-3 py-2"><Button type="button" variant="ghost" size="sm" disabled={lines.length >= 50} onClick={() => setLines((ls) => [...ls, blank()])}><Plus /> Add line</Button></td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatPaise(dr)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatPaise(cr)}</td>
                  <td colSpan={2} className={cn("px-3 py-2 text-xs", diff === 0 && dr > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
                    <span className="flex items-center gap-1.5"><Scale className="size-3.5" />{dr === 0 && cr === 0 ? "Enter amounts" : diff === 0 ? "Balanced" : `${diff > 0 ? "Credit" : "Debit"} short by ${formatPaise(Math.abs(diff))}`}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Debit what comes in or what it was spent on; credit where it came from. Money into the bank is a debit to the bank.</p>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : journal ? "Save entry" : "Save journal entry"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Repeating expense ──

export function RecurringDialog({ recurring, onClose, onSaved }: { recurring: Recurring | null; onClose: () => void; onSaved: (r: Recurring) => void }) {
  const today = todayInIndia()
  const accounts = useFinAccounts()
  const t = recurring?.template
  const [f, setF] = React.useState({
    name: recurring?.name ?? "", every: recurring?.every ?? "month", nextOn: recurring?.nextOn.slice(0, 10) ?? today, endsOn: recurring?.endsOn?.slice(0, 10) ?? "",
    category: t?.category ?? "", amountPaise: t?.amountPaise ?? (null as number | null), accountId: t?.accountId ?? "", payee: t?.payee ?? "", notes: t?.notes ?? "",
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => (e[k] || e[`template.${k}`] ? { ...e, [k]: "", [`template.${k}`]: "" } : e)); setError(null) }
  const account = f.accountId || accountForMethod(accounts.data?.data ?? [], "bank")

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    const e: Record<string, string> = {}
    if (f.name.trim().length < 2) e.name = "Give it a name, e.g. Shop rent"
    if (!f.category) e.category = "Choose the category"
    if (!f.amountPaise || f.amountPaise <= 0) e.amountPaise = "Enter the usual amount"
    if (!f.nextOn) e.nextOn = "Choose when it is next due"
    if (f.endsOn && f.endsOn < f.nextOn) e.endsOn = "Must be after the next date"
    if (!account) e.accountId = "Choose the account it is paid from"
    setErrors(e)
    if (Object.keys(e).length) return setError("Fix the marked fields first.")
    setBusy(true)
    const body = { name: f.name.trim(), every: f.every, nextOn: f.nextOn, endsOn: f.endsOn || null, template: { category: f.category, amountPaise: f.amountPaise, accountId: account, payee: f.payee.trim() || null, notes: f.notes.trim() || null } }
    try {
      const saved = recurring ? await api.put<Recurring>(`/finance/recurring/${recurring.id}`, { ...body, version: recurring.version }) : await api.post<Recurring>("/finance/recurring", body)
      toast.success(recurring ? "Saved" : `${saved.name} will come up ${EVERY_LABEL[saved.every].toLowerCase()}`)
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^template\./, ""), v])))
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{recurring ? `Edit ${recurring.name}` : "Repeating expense"}</DialogTitle>
          <DialogDescription>Rent, salary, internet… When it falls due it shows on Expenses; one click records it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Name" required error={errors.name} className="sm:col-span-2"><Input value={f.name} autoFocus maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Shop rent" /></Field>
          <Field label="Category" required error={errors.category}><CategorySelect kind="expense" value={f.category} onChange={(v) => set("category", v)} aria-label="Category" /></Field>
          <Field label="Usual amount" required error={errors.amountPaise} hint="You can change it each time"><MoneyInput value={f.amountPaise} onChange={(v) => set("amountPaise", v)} aria-label="Usual amount" /></Field>
          <Field label="How often" required>
            <NativeSelect value={f.every} aria-label="How often" onChange={(e) => set("every", e.target.value as Recurring["every"])}>
              {(Object.keys(EVERY_LABEL) as Recurring["every"][]).map((k) => <option key={k} value={k}>{EVERY_LABEL[k]}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Next due on" required error={errors.nextOn}><Input type="date" value={f.nextOn} onChange={(e) => set("nextOn", e.target.value)} /></Field>
          <Field label="Paid from" required error={errors.accountId}><AccountSelect value={account} onChange={(v) => set("accountId", v)} aria-label="Paid from" /></Field>
          <Field label="Ends on" error={errors.endsOn} hint="Leave empty to keep going"><Input type="date" value={f.endsOn} min={f.nextOn} onChange={(e) => set("endsOn", e.target.value)} /></Field>
          <Field label="Paid to" className="sm:col-span-2"><Input value={f.payee} maxLength={160} onChange={(e) => set("payee", e.target.value)} placeholder="e.g. Mr. Sharma (landlord)" /></Field>
          <Field label="Notes" className="sm:col-span-2" hint="A GST bill's number changes each time: add it on the expense after recording"><Textarea value={f.notes} rows={2} maxLength={1000} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. Shop 12, Sector 18" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : recurring ? "Save" : "Add repeating expense"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
