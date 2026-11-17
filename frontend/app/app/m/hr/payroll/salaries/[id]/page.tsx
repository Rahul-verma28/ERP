"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { Building2, CheckCircle2, Clock, HandCoins, IndianRupee, Layers, MinusCircle, Pencil, PlusCircle, RotateCcw, Trash2, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState, MoneyInput } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { PageError, PageLoading } from "@/components/page-states"
import { ActionMenu, BackLink, DetailHeader, Pill, Section } from "@/components/page-parts"
import { SalaryDialog } from "@/components/hr/employee-dialogs"
import { ListSelect } from "@/components/hr/pickers"
import { LoanDialog, OvertimeDialog, type Loan, type OT } from "@/components/hr/payroll-dialogs"
import { SummaryCards } from "@/components/hr/summary-cards"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { EMP_STATUS, monthLabel, type Employee, type SalaryItem } from "@/lib/hr"

// Set salary for one employee: basic pay up top, then allowances, deductions, loans and
// overtime — each added, changed or removed right here.

type Kind = "allowance" | "deduction"
const label = (k: Kind) => (k === "allowance" ? "allowance" : "deduction")

/** Every salary save sends the whole structure: basic, flags and every item. */
async function saveItems(e: Employee, items: SalaryItem[]) {
  await api.put(`/hr/employees/${e.id}/salary`, { basicPaise: e.basicPaise, payType: e.payType, pf: e.pf, esi: e.esi, pt: e.pt, items: items.map((i) => ({ kind: i.kind, name: i.name, calc: i.calc, amount: Number(i.amount) })) })
}

function ItemDialog({ e, kind, index, onClose, onSaved }: { e: Employee; kind: Kind; index: number | null; onClose: () => void; onSaved: () => void }) {
  const items = e.salaryItems ?? []
  const cur = index === null ? null : items[index]
  const [f, setF] = React.useState({ name: cur?.name ?? "", calc: cur?.calc ?? ("fixed" as "fixed" | "percent"), amount: cur ? Number(cur.amount) : (null as number | null) })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  const value = f.calc === "percent" ? Math.round((e.basicPaise * (f.amount ?? 0)) / 10_000) : f.amount ?? 0
  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    const x: Record<string, string> = {}
    if (!f.name.trim()) x.name = "Choose or type the name"
    else if (items.some((i, k) => k !== index && i.kind === kind && i.name.toLowerCase() === f.name.trim().toLowerCase())) x.name = "Already on this salary"
    if (!f.amount) x.amount = "Enter the amount"
    else if (f.calc === "percent" && f.amount > 10_000) x.amount = "At most 100%"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const row: SalaryItem = { kind, name: f.name.trim(), calc: f.calc, amount: f.amount! }
    try {
      await saveItems(e, index === null ? [...items, row] : items.map((i, k) => (k === index ? row : i)))
      toast.success(`${row.name} ${index === null ? "added" : "saved"}`)
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
        <DialogHeader><DialogTitle>{index === null ? `Add ${label(kind)}` : `Edit ${cur?.name}`}</DialogTitle><DialogDescription>{kind === "allowance" ? "Paid every month on top of basic pay." : "Taken from pay every month, besides PF, ESI and PT."}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label={kind === "allowance" ? "Allowance" : "Deduction"} required error={errors.name} className="sm:col-span-2" hint={`Add names in System Setup → ${kind === "allowance" ? "Allowance" : "Deduction"} Types`}>
            <ListSelect list={kind === "allowance" ? "allowanceTypes" : "deductionTypes"} value={f.name} onChange={(v) => set("name", v)} placeholder={kind === "allowance" ? "e.g. HRA" : "e.g. Canteen"} aria-label="Name" />
          </Field>
          <Field label="Worked out as"><NativeSelect value={f.calc} aria-label="Worked out as" onChange={(ev) => setF((x) => ({ ...x, calc: ev.target.value as "fixed" | "percent", amount: null }))}><option value="fixed">Fixed amount</option><option value="percent">% of basic</option></NativeSelect></Field>
          <Field label={f.calc === "fixed" ? "Amount a month" : "Percent of basic"} required error={errors.amount}>
            {f.calc === "fixed" ? <MoneyInput value={f.amount} onChange={(v) => set("amount", v)} aria-label="Amount" /> : <NumberStepper decimals max={100} suffix="%" value={f.amount === null ? "" : String(f.amount / 100)} onChange={(v) => set("amount", v === "" ? null : Math.round(Number(v) * 100))} aria-label="Percent of basic" />}
          </Field>
          {f.calc === "percent" && <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm sm:col-span-2">Comes to <strong className="tabular-nums">{formatPaise(value)}</strong> on today&apos;s basic of {formatPaise(e.basicPaise)}</p>}
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const th = "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground"
const td = "px-4 py-2.5"

export default function SetSalaryPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = useAuth()
  const view = can("hr.payroll.view")
  const edit = can("hr.payroll.create")
  const emp = useApi<Employee>(view ? `/hr/employees/${id}` : null)
  const loans = useApi<{ data: Loan[] }>(view ? `/hr/loans?employeeId=${id}` : null)
  const ots = useApi<{ data: OT[] }>(view ? `/hr/overtime?employeeId=${id}` : null)
  const [open, setOpen] = React.useState<null | { t: "basic" } | { t: "item"; kind: Kind; index: number | null } | { t: "loan" } | { t: "ot"; ot: OT | null }>(null)
  const [removing, setRemoving] = React.useState<null | { t: "item"; index: number } | { t: "loan"; loan: Loan } | { t: "ot"; ot: OT }>(null)
  if (!view) return <PageHeader title="Set salary" description="You don't have access to payroll. Ask your admin." />
  if (emp.error) return <PageError error={emp.error} onRetry={() => void emp.reload()} />
  const e = emp.data
  if (!e) return <PageLoading />
  const live = edit && e.status !== "exited"
  const items = e.salaryItems ?? []
  const val = (i: SalaryItem) => (i.calc === "percent" ? Math.round((e.basicPaise * Number(i.amount)) / 10_000) : Number(i.amount))
  const allowances = items.map((i, k) => ({ i, k })).filter((x) => x.i.kind === "allowance")
  const deductions = items.map((i, k) => ({ i, k })).filter((x) => x.i.kind === "deduction")
  const allowTotal = allowances.reduce((s, x) => s + val(x.i), 0)
  const dedTotal = deductions.reduce((s, x) => s + val(x.i), 0)
  const loanRows = loans.data?.data ?? []
  const otRows = ots.data?.data ?? []
  const emiNow = loanRows.filter((l) => l.status === "active").reduce((s, l) => s + Math.min(l.emiPaise, l.leftPaise), 0)
  const otOpen = otRows.filter((o) => !o.payslipId).reduce((s, o) => s + o.amountPaise, 0)
  const done = () => { setOpen(null); void emp.reload(); void loans.reload(); void ots.reload() }

  async function loanStatus(l: Loan, s: "active" | "closed") {
    try { await api.post(`/hr/loans/${l.id}/status`, { status: s }); toast.success(s === "closed" ? "Closed: no more instalments" : "Instalments start again"); void loans.reload() } catch (err) { toast.error(errorMessage(err)) }
  }
  async function remove() {
    if (!removing) return
    try {
      if (removing.t === "item") { await saveItems(e!, items.filter((_, k) => k !== removing.index)); void emp.reload() }
      if (removing.t === "loan") { await api.delete(`/hr/loans/${removing.loan.id}`); void loans.reload() }
      if (removing.t === "ot") { await api.delete(`/hr/overtime/${removing.ot.id}`); void ots.reload() }
      toast.success("Deleted")
    } catch (err) { toast.error(errorMessage(err)) }
  }

  const itemTable = (kind: Kind, rows: { i: SalaryItem; k: number }[], total: number) => (
    <Section
      title={kind === "allowance" ? "Allowances" : "Deductions"}
      description={kind === "allowance" ? `${formatPaise(total)} a month on top of basic` : `${formatPaise(total)} a month, besides PF, ESI and PT`}
      action={live && e.basicPaise ? <Button size="sm" variant="outline" onClick={() => setOpen({ t: "item", kind, index: null })}>{kind === "allowance" ? <PlusCircle /> : <MinusCircle />} Add</Button> : undefined}
      flush
    >
      {rows.length === 0 ? <EmptyState icon={kind === "allowance" ? PlusCircle : MinusCircle} title={kind === "allowance" ? "No allowances" : "No deductions"} description={e.basicPaise ? (kind === "allowance" ? "Add HRA, conveyance and the rest." : "Add canteen, uniform or other monthly cuts.") : "Set the basic salary first."} /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b"><th className={th}>Name</th><th className={th}>Type</th><th className={`${th} text-right`}>Amount</th>{live && <th className={`${th} text-right`}>Actions</th>}</tr></thead>
          <tbody className="divide-y">
            {rows.map(({ i, k }) => (
              <tr key={k}>
                <td className={`${td} font-medium`}>{i.name}</td>
                <td className={td}><Pill color={i.calc === "percent" ? "violet" : "blue"}>{i.calc === "percent" ? `${Number(i.amount) / 100}% of basic` : "Fixed"}</Pill></td>
                <td className={`${td} text-right tabular-nums`}>{kind === "deduction" && "− "}{formatPaise(val(i))}</td>
                {live && <td className={`${td} text-right`}><span className="inline-flex gap-0.5"><Button variant="ghost" size="icon-sm" aria-label={`Edit ${i.name}`} onClick={() => setOpen({ t: "item", kind, index: k })}><Pencil /></Button><Button variant="ghost" size="icon-sm" aria-label={`Delete ${i.name}`} onClick={() => setRemoving({ t: "item", index: k })}><Trash2 /></Button></span></td>}
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Section>
  )

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/hr/payroll/salaries">Set salary</BackLink>
      <DetailHeader
        title={e.name}
        initials={e.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
        pills={<><Pill color="slate">{e.code}</Pill><Pill color={EMP_STATUS[e.status].color} dot>{EMP_STATUS[e.status].label}</Pill><Pill color="blue">{e.payType === "daily" ? "Paid by the day" : "Paid monthly"}</Pill></>}
        subtitle={e.email ?? e.phone ?? "No email or mobile"}
        actions={live ? <Button onClick={() => setOpen({ t: "basic" })}><IndianRupee /> {e.basicPaise ? "Change salary" : "Set salary"}</Button> : undefined}
      />
      <SummaryCards items={[
        { label: e.payType === "daily" ? "Wage a day" : "Basic salary", value: e.basicPaise ? formatPaise(e.basicPaise) : "Not set", hint: e.payType === "monthly" && e.basicPaise ? `Gross ${formatPaise(e.basicPaise + allowTotal)} a month` : "Click Change salary to edit", color: "emerald", icon: IndianRupee },
        { label: "Branch", value: e.branch ?? "—", color: "blue", icon: Building2 },
        { label: "Department", value: e.department ?? "—", color: "violet", icon: Layers },
        { label: "Designation", value: e.designation ?? "—", hint: [e.pf && "PF", e.esi && "ESI", e.pt && "PT"].filter(Boolean).join(" · ") || "No PF, ESI or PT", color: "amber", icon: UserRound },
      ]} />
      {!e.basicPaise && <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">No salary yet: payroll skips {e.name} until the basic salary is set.</p>}
      <div className="grid gap-5 xl:grid-cols-2">
        {itemTable("allowance", allowances, allowTotal)}
        {itemTable("deduction", deductions, dedTotal)}

        <Section title="Loans & advances" description={emiNow ? `${formatPaise(emiNow)} taken back in the next payroll` : "Nothing being taken back"} action={live ? <Button size="sm" variant="outline" onClick={() => setOpen({ t: "loan" })}><HandCoins /> Add</Button> : undefined} flush>
          {loans.error ? <PageError error={loans.error} onRetry={() => void loans.reload()} /> : !loans.data ? <PageLoading /> : loanRows.length === 0 ? <EmptyState icon={HandCoins} title="No loans or advances" /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b"><th className={th}>Title</th><th className={th}>Type</th><th className={`${th} text-right`}>Amount</th><th className={`${th} text-right`}>Instalment</th><th className={`${th} text-right`}>Left</th><th className={th}>Status</th>{live && <th className={th} />}</tr></thead>
              <tbody className="divide-y">
                {loanRows.map((l) => (
                  <tr key={l.id}>
                    <td className={td}><span className="block font-medium">{l.title}</span><span className="text-xs text-muted-foreground">Given {formatDate(l.givenOn)}</span></td>
                    <td className={td}><Pill color={l.kind.toLowerCase().includes("advance") ? "blue" : "violet"}>{l.kind.charAt(0).toUpperCase() + l.kind.slice(1)}</Pill></td>
                    <td className={`${td} text-right tabular-nums`}>{formatPaise(l.amountPaise)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatPaise(l.emiPaise)}<span className="block text-xs text-muted-foreground">from {monthLabel(l.startsMonth)}</span></td>
                    <td className={`${td} text-right font-semibold tabular-nums`}>{formatPaise(l.leftPaise)}</td>
                    <td className={td}><Pill color={l.status === "active" ? "amber" : "emerald"} dot>{l.status === "active" ? "Being repaid" : l.leftPaise > 0 ? "Closed" : "Repaid"}</Pill></td>
                    {live && <td className={`${td} text-right`}><ActionMenu label={`More actions for ${l.title}`} items={[
                      l.status === "active" ? { label: "Close (stop instalments)", icon: CheckCircle2, onClick: () => void loanStatus(l, "closed") } : l.leftPaise > 0 && { label: "Start instalments again", icon: RotateCcw, onClick: () => void loanStatus(l, "active") },
                      "-",
                      l.recoveredPaise === 0 && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setRemoving({ t: "loan", loan: l }) },
                    ]} /></td>}
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Section>

        <Section title="Overtime" description={otOpen ? `${formatPaise(otOpen)} paid in the next payroll` : "Nothing waiting for payroll"} action={live ? <Button size="sm" variant="outline" onClick={() => setOpen({ t: "ot", ot: null })}><Clock /> Add</Button> : undefined} flush>
          {ots.error ? <PageError error={ots.error} onRetry={() => void ots.reload()} /> : !ots.data ? <PageLoading /> : otRows.length === 0 ? <EmptyState icon={Clock} title="No overtime" /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b"><th className={th}>Date</th><th className={`${th} text-right`}>Hours</th><th className={`${th} text-right`}>Rate</th><th className={`${th} text-right`}>Amount</th><th className={th}>Status</th>{live && <th className={th} />}</tr></thead>
              <tbody className="divide-y">
                {otRows.slice(0, 20).map((o) => (
                  <tr key={o.id}>
                    <td className={td}><span className="block font-medium">{formatDate(o.workOn)}</span>{o.notes && <span className="text-xs text-muted-foreground">{o.notes}</span>}</td>
                    <td className={`${td} text-right tabular-nums`}>{o.hours} h</td>
                    <td className={`${td} text-right tabular-nums`}>{formatPaise(o.ratePaise)}/h</td>
                    <td className={`${td} text-right font-semibold tabular-nums`}>{formatPaise(o.amountPaise)}</td>
                    <td className={td}>{o.payslipId ? <Pill color="emerald" dot>On payslip</Pill> : <Pill color="amber" dot>Next payroll</Pill>}</td>
                    {live && <td className={`${td} text-right`}>{!o.payslipId && <span className="inline-flex gap-0.5"><Button variant="ghost" size="icon-sm" aria-label="Edit overtime" onClick={() => setOpen({ t: "ot", ot: o })}><Pencil /></Button><Button variant="ghost" size="icon-sm" aria-label="Delete overtime" onClick={() => setRemoving({ t: "ot", ot: o })}><Trash2 /></Button></span>}</td>}
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Section>
      </div>

      {open?.t === "basic" && <SalaryDialog employee={e} onClose={() => setOpen(null)} onSaved={done} />}
      {open?.t === "item" && <ItemDialog e={e} kind={open.kind} index={open.index} onClose={() => setOpen(null)} onSaved={done} />}
      {open?.t === "loan" && <LoanDialog employeeId={e.id} onClose={() => setOpen(null)} onSaved={done} />}
      {open?.t === "ot" && <OvertimeDialog ot={open.ot} employeeId={e.id} onClose={() => setOpen(null)} onSaved={done} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive
        title={removing?.t === "item" ? `Remove ${items[removing.index]?.name}?` : removing?.t === "loan" ? `Delete ${removing.loan.title}?` : "Delete this overtime?"}
        description={removing?.t === "item" ? "Next payroll leaves it out. Payslips already made don't change." : removing?.t === "loan" ? "Its entry in the books is removed too." : undefined}
        confirmLabel="Delete" onConfirm={remove} />
    </div>
  )
}
