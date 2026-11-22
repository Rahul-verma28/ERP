"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { MoneyInput } from "@/components/common"
import { Field, FormError } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { EmployeeSelect, ListSelect } from "@/components/hr/pickers"
import { AccountSelect, accountForMethod } from "@/components/finance/forms"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { useFinAccounts } from "@/lib/finance"
import { monthLabel, useCurrentEmployees } from "@/lib/hr"
import { useChanged } from "@/lib/use-dirty"
import { FileField } from "@/components/file-field"

// Loan and overtime forms, used on their own pages and on an employee's Set Salary page
// (where the employee is already chosen).

export interface Loan { id: string; employeeId: string; employee: string; employeeCode: string; title: string; kind: string; amountPaise: number; emiPaise: number; givenOn: string; startsMonth: string; status: "active" | "closed"; recoveredPaise: number; leftPaise: number; journalId: string | null; reason: string | null }

export interface OT { id: string; employeeId: string; employee: string; employeeCode: string; workOn: string; hours: number; ratePaise: number; amountPaise: number; notes: string | null; payslipId: string | null }

export function LoanDialog({ employeeId, onClose, onSaved }: { employeeId?: string; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth()
  const accounts = useFinAccounts()
  const [f, setF] = React.useState({ employeeId: employeeId ?? "", title: "Salary advance", kind: "Salary advance", amountPaise: null as number | null, emiPaise: null as number | null, givenOn: todayInIndia(), startsMonth: todayInIndia().slice(0, 7), accountId: "", paidOut: true, reason: "", documentUrl: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  const account = f.accountId || accountForMethod(accounts.data?.data ?? [], "cash")
  const months = f.amountPaise && f.emiPaise ? Math.ceil(f.amountPaise / f.emiPaise) : 0
  const books = can("finance.expense.view")
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.employeeId) x.employeeId = "Choose the employee"
    if (f.title.trim().length < 2) x.title = "Name it"
    if (!f.amountPaise) x.amountPaise = "Enter the amount"
    if (!f.emiPaise) x.emiPaise = "Enter the monthly instalment"
    else if (f.amountPaise && f.emiPaise > f.amountPaise) x.emiPaise = "More than the amount"
    if (f.givenOn > todayInIndia()) x.givenOn = "Can't be in the future"
    if (f.startsMonth < f.givenOn.slice(0, 7)) x.startsMonth = "In or after the month it is given"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      await api.post("/hr/loans", { ...f, title: f.title.trim(), reason: f.reason.trim() || null, documentUrl: f.documentUrl || null, accountId: books && f.paidOut ? account || null : null })
      toast.success(`${f.title} recorded: ${months} instalment${months === 1 ? "" : "s"} from ${monthLabel(f.startsMonth)}`)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Loan or advance</DialogTitle><DialogDescription>Payroll takes back one instalment a month until it is repaid.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          {!employeeId && <Field label="Employee" required error={errors.employeeId} className="sm:col-span-2"><EmployeeSelect value={f.employeeId} onChange={(v) => set("employeeId", v)} aria-label="Employee" /></Field>}
          <Field label="What" required error={errors.title}><Input value={f.title} maxLength={80} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Salary advance" /></Field>
          <Field label="Loan type" hint="Add types in System Setup → Loan Types"><ListSelect list="loanTypes" value={f.kind} onChange={(v) => set("kind", v)} aria-label="Loan type" /></Field>
          <Field label="Amount" required error={errors.amountPaise}><MoneyInput value={f.amountPaise} onChange={(v) => set("amountPaise", v)} aria-label="Amount" /></Field>
          <Field label="Monthly instalment" required error={errors.emiPaise} hint={months ? `${months} month${months === 1 ? "" : "s"} to repay` : undefined}><MoneyInput value={f.emiPaise} onChange={(v) => set("emiPaise", v)} aria-label="Monthly instalment" /></Field>
          <Field label="Given on" required error={errors.givenOn}><Input type="date" value={f.givenOn} max={todayInIndia()} onChange={(e) => set("givenOn", e.target.value)} /></Field>
          <Field label="Take back from" required error={errors.startsMonth}><Input type="month" value={f.startsMonth} onChange={(e) => set("startsMonth", e.target.value)} /></Field>
          {books && <>
            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm sm:col-span-2"><span><span className="font-medium">Money handed over now</span><span className="block text-xs text-muted-foreground">Takes it out of an account and records it in the books</span></span><Switch checked={f.paidOut} onCheckedChange={(v) => set("paidOut", v)} aria-label="Money handed over now" /></label>
            {f.paidOut && <Field label="Paid from" className="sm:col-span-2"><AccountSelect value={account} onChange={(v) => set("accountId", v)} aria-label="Paid from" /></Field>}
          </>}
          <Field label="Reason" className="sm:col-span-2"><Textarea rows={2} maxLength={500} value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Optional, e.g. Medical emergency" /></Field>
          <Field label="Signed agreement" className="sm:col-span-2" hint="Optional"><FileField value={f.documentUrl} onChange={(v) => set("documentUrl", v ?? "")} prompt="Upload the agreement" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function OvertimeDialog({ ot, employeeId, onClose, onSaved }: { ot: OT | null; employeeId?: string; onClose: () => void; onSaved: () => void }) {
  const emps = useCurrentEmployees()
  const [f, setF] = React.useState({ employeeId: ot?.employeeId ?? employeeId ?? "", workOn: ot?.workOn.slice(0, 10) ?? todayInIndia(), hours: ot ? String(ot.hours) : "2", ratePaise: ot?.ratePaise ?? (null as number | null), notes: ot?.notes ?? "" })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  const pickEmployee = (id: string) => {
    const e = emps.data?.data.find((x) => x.id === id)
    // Twice the ordinary hourly rate, as the Factories Act asks
    const suggested = e?.basicPaise ? Math.round(((e.payType === "daily" ? e.basicPaise * 26 : e.basicPaise) / 26 / 8) * 2) : null
    setF((x) => ({ ...x, employeeId: id, ratePaise: ot ? x.ratePaise : suggested ?? x.ratePaise }))
    setErrors({})
  }
  const fixed = employeeId ? emps.data?.data.find((x) => x.id === employeeId) : undefined
  const suggestedRate = fixed?.basicPaise ? Math.round(((fixed.payType === "daily" ? fixed.basicPaise * 26 : fixed.basicPaise) / 26 / 8) * 2) : null
  const rate = f.ratePaise ?? (ot ? null : suggestedRate)
  const amount = Math.round(Number(f.hours || 0) * (rate ?? 0))
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.employeeId) x.employeeId = "Choose the employee"
    if (!f.workOn) x.workOn = "Choose the date"
    else if (f.workOn > todayInIndia()) x.workOn = "Can't be in the future"
    if (!(Number(f.hours) > 0)) x.hours = "Enter the hours"
    if (!rate) x.ratePaise = "Enter the rate per hour"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const body = { ...f, ratePaise: rate, hours: Number(f.hours), notes: f.notes.trim() || null }
    try {
      if (ot) await api.put(`/hr/overtime/${ot.id}`, body)
      else await api.post("/hr/overtime", body)
      toast.success(`Overtime saved: ${formatPaise(amount)}`)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{ot ? "Edit overtime" : "Add overtime"}</DialogTitle><DialogDescription>Paid in that month&apos;s payroll.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          {!employeeId && <Field label="Employee" required error={errors.employeeId} className="sm:col-span-2"><EmployeeSelect value={f.employeeId} onChange={pickEmployee} aria-label="Employee" /></Field>}
          <Field label="Date" required error={errors.workOn}><Input type="date" value={f.workOn} max={todayInIndia()} onChange={(e) => set("workOn", e.target.value)} /></Field>
          <Field label="Hours" required error={errors.hours}><NumberStepper decimals step={0.5} max={24} suffix="h" value={f.hours} onChange={(v) => set("hours", v)} aria-label="Hours" /></Field>
          <Field label="Rate per hour" required error={errors.ratePaise} hint="Suggested: 2× the ordinary hourly rate" className="sm:col-span-2"><MoneyInput value={rate} onChange={(v) => set("ratePaise", v)} aria-label="Rate per hour" /></Field>
          <Field label="Note" className="sm:col-span-2"><Input value={f.notes} maxLength={300} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. Stock-taking" /></Field>
          <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm sm:col-span-2">Overtime pay: <strong className="tabular-nums">{formatPaise(amount)}</strong></p>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!ot && unchanged)}>{busy ? "Saving…" : "Save overtime"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
