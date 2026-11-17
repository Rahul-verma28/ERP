"use client"

import * as React from "react"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { MoneyInput } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { ListSelect } from "@/components/hr/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { formatPaise } from "@/lib/format"
import { useHrLookups, type Employee, type SalaryItem } from "@/lib/hr"

// Employee dialogs: mark as leaving, and the salary structure (basic, allowances, deductions, PF/ESI/PT).

export function ExitDialog({ employee, onClose, onSaved }: { employee: Employee; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ exitOn: todayInIndia(), exitReason: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.exitOn) x.exitOn = "Choose the last working day"
    else if (f.exitOn < employee.joinedOn.slice(0, 10)) x.exitOn = "Can't be before joining"
    if (f.exitReason.trim().length < 3) x.exitReason = "Say why they are leaving"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      await api.post(`/hr/employees/${employee.id}/exit`, f)
      toast.success(f.exitOn <= todayInIndia() ? `${employee.name} marked as left` : `${employee.name} is on notice till ${f.exitOn}`)
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
        <DialogHeader>
          <DialogTitle>{employee.name} is leaving</DialogTitle>
          <DialogDescription>A future date keeps them on notice until then. Their last payslip pays up to this day.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Last working day" required error={errors.exitOn}><Input type="date" value={f.exitOn} min={employee.joinedOn.slice(0, 10)} onChange={(e) => setF((x) => ({ ...x, exitOn: e.target.value }))} /></Field>
          <Field label="Reason" required error={errors.exitReason}><Textarea rows={3} maxLength={500} value={f.exitReason} onChange={(e) => setF((x) => ({ ...x, exitReason: e.target.value }))} placeholder="e.g. Resigned for higher studies" /></Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={busy}>{busy ? "Saving…" : "Mark as leaving"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface Row { kind: "allowance" | "deduction"; name: string; calc: "fixed" | "percent"; amount: number | null }

/** Monthly pay: basic, then allowances and deductions; percent ones are a share of basic */
export function SalaryDialog({ employee, onClose, onSaved }: { employee: Employee; onClose: () => void; onSaved: () => void }) {
  const look = useHrLookups()
  const cfg = look.data?.config
  const [basic, setBasic] = React.useState<number | null>(employee.basicPaise || null)
  const [payType, setPayType] = React.useState(employee.payType)
  const [flags, setFlags] = React.useState({ pf: employee.pf, esi: employee.esi, pt: employee.pt })
  const [rows, setRows] = React.useState<Row[]>((employee.salaryItems ?? []).map((i: SalaryItem) => ({ kind: i.kind, name: i.name, calc: i.calc, amount: Number(i.amount) })))
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const value = (r: Row) => (r.calc === "percent" ? Math.round(((basic ?? 0) * (r.amount ?? 0)) / 10_000) : r.amount ?? 0)
  const allowances = rows.filter((r) => r.kind === "allowance").reduce((s, r) => s + value(r), 0)
  const deductions = rows.filter((r) => r.kind === "deduction").reduce((s, r) => s + value(r), 0)
  const gross = (basic ?? 0) + allowances
  const pfWage = cfg ? (cfg.pf.capped ? Math.min(basic ?? 0, cfg.pf.wageCapPaise) : basic ?? 0) : 0
  const pf = flags.pf && cfg?.pf.enabled ? Math.round((pfWage * cfg.pf.employeeBp) / 10_000) : 0
  const esiOk = cfg ? gross <= cfg.esi.grossLimitPaise : false
  const esi = flags.esi && cfg?.esi.enabled && esiOk ? Math.ceil((gross * cfg.esi.employeeBp) / 1_000_000) * 100 : 0
  const ptSlab = cfg?.pt.enabled && flags.pt ? [...cfg.pt.slabs].sort((a, b) => b.abovePaise - a.abovePaise).find((s) => gross > s.abovePaise) : undefined
  const pt = ptSlab?.amountPaise ?? 0
  const net = gross - deductions - pf - esi - pt
  const setRow = (i: number, patch: Partial<Row>) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); setErrors({}) }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!basic) x.basicPaise = payType === "daily" ? "Enter the daily wage" : "Enter the monthly basic pay"
    rows.forEach((r, i) => {
      if (!r.name.trim()) x[`items.${i}.name`] = "Name it"
      if (!r.amount) x[`items.${i}.amount`] = "Enter the amount"
      if (r.calc === "percent" && (r.amount ?? 0) > 10_000) x[`items.${i}.amount`] = "At most 100%"
    })
    setErrors(x)
    if (Object.keys(x).length) return setError("Fix the marked fields first.")
    setBusy(true)
    try {
      await api.put(`/hr/employees/${employee.id}/salary`, { basicPaise: basic, payType, ...flags, items: rows.map((r) => ({ kind: r.kind, name: r.name.trim(), calc: r.calc, amount: r.amount })) })
      toast.success(`Salary saved for ${employee.name}`)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const list = (kind: "allowance" | "deduction") => (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{kind === "allowance" ? "Allowances" : "Other deductions"}</p>
        <Button type="button" size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, { kind, name: "", calc: "fixed", amount: null }])}><Plus /> Add</Button>
      </div>
      {rows.map((r, i) => r.kind !== kind ? null : (
        <div key={i} className="grid grid-cols-[1fr_8rem_9rem_auto] items-start gap-2">
          <div><ListSelect list={kind === "allowance" ? "allowanceTypes" : "deductionTypes"} value={r.name} onChange={(v) => setRow(i, { name: v })} placeholder={kind === "allowance" ? "e.g. HRA" : "e.g. Canteen"} aria-label="Name" aria-invalid={!!errors[`items.${i}.name`]} />{errors[`items.${i}.name`] && <p className="mt-1 text-xs text-destructive">{errors[`items.${i}.name`]}</p>}</div>
          <NativeSelect value={r.calc} aria-label="How it is worked out" onChange={(e) => setRow(i, { calc: e.target.value as Row["calc"], amount: null })}><option value="fixed">Fixed ₹</option><option value="percent">% of basic</option></NativeSelect>
          <div>
            {r.calc === "fixed" ? <MoneyInput value={r.amount} onChange={(v) => setRow(i, { amount: v })} aria-label="Amount" /> : <NumberStepper decimals max={100} suffix="%" value={r.amount === null ? "" : String(r.amount / 100)} onChange={(v) => setRow(i, { amount: v === "" ? null : Math.round(Number(v) * 100) })} aria-label="Percent of basic" />}
            {errors[`items.${i}.amount`] && <p className="mt-1 text-xs text-destructive">{errors[`items.${i}.amount`]}</p>}
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 /></Button>
        </div>
      ))}
      {!rows.some((r) => r.kind === kind) && <p className="text-xs text-muted-foreground">{kind === "allowance" ? "HRA, conveyance, special allowance…" : "Canteen, uniform, TDS…"}</p>}
    </div>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Salary · {employee.name}</DialogTitle>
          <DialogDescription>Monthly pay before leave or absences. Payroll pays the days worked; loss-of-pay days come off.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]" noValidate>
          <div className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Paid" required><NativeSelect value={payType} aria-label="Paid" onChange={(e) => setPayType(e.target.value as "monthly" | "daily")}><option value="monthly">Monthly salary</option><option value="daily">Daily wage</option></NativeSelect></Field>
              <Field label={payType === "daily" ? "Wage a day" : "Basic pay a month"} required error={errors.basicPaise} hint={payType === "daily" ? "Paid for days present, paid leave and paid holidays" : "PF is worked out on basic"}><MoneyInput value={basic} autoFocus onChange={(v) => { setBasic(v); setErrors({}) }} aria-label="Basic pay" /></Field>
            </div>
            {list("allowance")}
            {list("deduction")}
            <div className="grid gap-3 rounded-2xl border p-4">
              <p className="text-sm font-semibold">Statutory deductions</p>
              {([
                ["pf", "Provident Fund (PF)", cfg?.pf.enabled ? `${(cfg.pf.employeeBp / 100)}% of basic${cfg.pf.capped ? ` up to ${formatPaise(cfg.pf.wageCapPaise)}` : ""}, and the same from you` : "Turned off in HR setup"],
                ["esi", "ESI", cfg?.esi.enabled ? (esiOk ? `${cfg.esi.employeeBp / 100}% of gross, and ${cfg.esi.employerBp / 100}% from you` : `Only for gross up to ${formatPaise(cfg.esi.grossLimitPaise)} a month`) : "Turned off in HR setup"],
                ["pt", "Professional tax", cfg?.pt.enabled ? `By your state's slab${cfg.pt.state ? ` (${cfg.pt.state})` : ""}` : "Turned off in HR setup"],
              ] as const).map(([k, label, hint]) => (
                <label key={k} className="flex items-center justify-between gap-3 text-sm">
                  <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
                  <Switch checked={flags[k]} onCheckedChange={(v) => setFlags((x) => ({ ...x, [k]: v }))} aria-label={label} />
                </label>
              ))}
            </div>
            <FormError message={error} />
          </div>
          <aside className="grid h-fit gap-2 rounded-2xl bg-muted/50 p-4 text-sm">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{payType === "daily" ? "For one day" : "A full month"}</p>
            <p className="flex justify-between"><span>Basic</span><span className="tabular-nums">{formatPaise(basic ?? 0)}</span></p>
            <p className="flex justify-between"><span>Allowances</span><span className="tabular-nums">{formatPaise(allowances)}</span></p>
            <p className="flex justify-between border-t pt-2 font-semibold"><span>Gross</span><span className="tabular-nums">{formatPaise(gross)}</span></p>
            {payType === "monthly" && <>
              {!!pf && <p className="flex justify-between text-muted-foreground"><span>PF</span><span className="tabular-nums">− {formatPaise(pf)}</span></p>}
              {!!esi && <p className="flex justify-between text-muted-foreground"><span>ESI</span><span className="tabular-nums">− {formatPaise(esi)}</span></p>}
              {!!pt && <p className="flex justify-between text-muted-foreground"><span>Professional tax</span><span className="tabular-nums">− {formatPaise(pt)}</span></p>}
              {!!deductions && <p className="flex justify-between text-muted-foreground"><span>Other deductions</span><span className="tabular-nums">− {formatPaise(deductions)}</span></p>}
              <p className="flex justify-between border-t pt-2 text-base font-bold"><span>Take home</span><span className="tabular-nums">{formatPaise(net)}</span></p>
              <p className="text-xs text-muted-foreground">Before loss of pay, overtime and loan instalments.</p>
            </>}
          </aside>
          <DialogFooter className="lg:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save salary"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
