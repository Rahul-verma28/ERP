"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { BadgeIndianRupee, Eye, IndianRupee, Lock, Plus, RefreshCw, SlidersHorizontal, Trash2, Undo2, Unlock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog, MoneyInput } from "@/components/common"
import { DataList, localList, type Column } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { PageError, PageLoading } from "@/components/page-states"
import { ActionMenu, Avatar, BackLink, DetailHeader, Pill, StatGrid, Steps } from "@/components/page-parts"
import { AccountSelect, accountForMethod } from "@/components/finance/forms"
import { todayInIndia } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { useFinAccounts } from "@/lib/finance"
import { monthLabel, RUN_STATUS, type Line, type PayrollRun, type Payslip } from "@/lib/hr"

// One month's payroll: check every payslip, add a bonus or a one-off deduction, process, then pay.

function PayDialog({ run, slips, onClose, onSaved }: { run: PayrollRun; slips: Payslip[]; onClose: () => void; onSaved: () => void }) {
  const accounts = useFinAccounts()
  const [accountId, setAccountId] = React.useState(run.accountId ?? "")
  const [paidOn, setPaidOn] = React.useState(run.payDate.slice(0, 10) <= todayInIndia() ? run.payDate.slice(0, 10) : todayInIndia())
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const account = accountId || accountForMethod(accounts.data?.data ?? [], "bank")
  const net = slips.reduce((s, p) => s + p.netPaise, 0)
  const bal = accounts.data?.data.find((a) => a.id === account)?.balancePaise
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!account) return setError("Choose the account salaries are paid from")
    if (paidOn > todayInIndia()) return setError("The payment date can't be in the future")
    setBusy(true)
    try {
      await api.post(`/hr/payroll/${run.id}/pay`, { payslipIds: slips.map((s) => s.id), paidOn, accountId: account })
      toast.success(`${formatPaise(net)} salary paid to ${slips.length} ${slips.length === 1 ? "person" : "people"}`)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Pay salaries</DialogTitle><DialogDescription>{slips.length} payslip{slips.length === 1 ? "" : "s"} · net {formatPaise(net)}. One entry goes to the books: salaries, PF, ESI and PT payable, and the bank.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Paid from" required hint={bal !== undefined ? `Balance ${formatPaise(bal)}` : undefined}><AccountSelect value={account} onChange={setAccountId} aria-label="Paid from" /></Field>
          <Field label="Paid on" required><Input type="date" value={paidOn} max={todayInIndia()} onChange={(e) => setPaidOn(e.target.value)} /></Field>
          {bal !== undefined && bal < net && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">This account has less than the net pay. It will show a negative balance.</p>}
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}><BadgeIndianRupee /> {busy ? "Paying…" : `Pay ${formatPaise(net)}`}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AdjustDialog({ slip, onClose, onSaved }: { slip: Payslip; onClose: () => void; onSaved: () => void }) {
  type Row = { name: string; amountPaise: number | null }
  const [earn, setEarn] = React.useState<Row[]>(slip.earnings.filter((x) => x.manual).map((x) => ({ name: x.name, amountPaise: x.amountPaise })))
  const [ded, setDed] = React.useState<Row[]>(slip.deductions.filter((x) => x.manual).map((x) => ({ name: x.name, amountPaise: x.amountPaise })))
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const all = [...earn, ...ded]
    if (all.some((r) => !r.name.trim() || !r.amountPaise)) return setError("Give each line a name and an amount")
    setBusy(true)
    try {
      await api.put(`/hr/payslips/${slip.id}/adjust`, { earnings: earn.map((r) => ({ name: r.name.trim(), amountPaise: r.amountPaise })), deductions: ded.map((r) => ({ name: r.name.trim(), amountPaise: r.amountPaise })) })
      toast.success("Payslip changed")
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  const block = (title: string, rows: Row[], setRows: React.Dispatch<React.SetStateAction<Row[]>>, hint: string) => (
    <div className="grid gap-2">
      <div className="flex items-center justify-between"><p className="text-sm font-semibold">{title}</p><Button type="button" size="sm" variant="ghost" onClick={() => setRows((r) => [...r, { name: "", amountPaise: null }])}><Plus /> Add</Button></div>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">{hint}</p>}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_9rem_auto] gap-2">
          <Input value={r.name} maxLength={60} placeholder={title === "Add to pay" ? "e.g. Diwali bonus" : "e.g. Damaged stock"} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Name" />
          <MoneyInput value={r.amountPaise} onChange={(v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, amountPaise: v } : x)))} aria-label="Amount" />
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 /></Button>
        </div>
      ))}
    </div>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Adjust {slip.employee}&apos;s pay</DialogTitle><DialogDescription>One-off additions or deductions for this month only. They stay if you recalculate.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-5" noValidate>
          {block("Add to pay", earn, setEarn, "Bonus, arrears, incentive…")}
          {block("Take off pay", ded, setDed, "Fine, damage, advance not in a loan…")}
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const sum = (lines: Line[], code: string) => lines.filter((l) => l.code === code).reduce((s, l) => s + l.amountPaise, 0)

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can } = useAuth()
  const { data: run, error, reload } = useApi<PayrollRun>(`/hr/payroll/${id}`)
  const [paying, setPaying] = React.useState<Payslip[] | null>(null)
  const [adjusting, setAdjusting] = React.useState<Payslip | null>(null)
  const [confirm, setConfirm] = React.useState<{ title: string; description: string; label: string; run: () => Promise<unknown>; destructive?: boolean } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [version, setVersion] = React.useState(0)
  if (error) return <PageError error={error} onRetry={() => void reload()} />
  if (!run) return <PageLoading />
  const slips = run.payslips ?? []
  const draft = run.status === "draft"
  const unpaid = slips.filter((s) => s.status === "unpaid")
  const refresh = () => { void reload(); setVersion((v) => v + 1) }

  async function act(path: string, done: string) {
    setBusy(true)
    try {
      await api.post(`/hr/payroll/${run!.id}/${path}`, {})
      toast.success(done)
      refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<Payslip>[] = [
    { key: "employee", header: "Employee", hideable: false, sort: (p) => p.employee ?? "", csv: (p) => p.employee ?? "", cell: (p) => <span className="flex items-center gap-2.5"><Avatar name={p.employee ?? ""} className="size-8" /><span><Link href={`/app/m/hr/employees/${p.employeeId}`} onClick={(e) => e.stopPropagation()} className="block font-medium hover:underline">{p.employee}</Link><span className="font-mono text-xs text-muted-foreground">{p.employeeCode}</span></span></span> },
    { key: "days", header: "Days paid", align: "right", csv: (p) => p.payableDays, cell: (p) => <span className="tabular-nums">{p.payableDays}<span className="text-muted-foreground">/{p.daysInMonth}</span>{p.lopDays ? <span className="block text-xs text-destructive">{p.lopDays} LOP</span> : null}</span> },
    { key: "basic", header: "Basic", align: "right", csv: (p) => p.basicPaise / 100, cell: (p) => <span className="tabular-nums">{formatPaise(p.basicPaise)}</span> },
    { key: "allow", header: "Allowances", align: "right", csv: (p) => (p.grossPaise - p.basicPaise) / 100, cell: (p) => <span className="tabular-nums">{formatPaise(p.grossPaise - p.basicPaise - sum(p.earnings, "overtime"))}</span> },
    { key: "ot", header: "Overtime", align: "right", defaultHidden: true, csv: (p) => sum(p.earnings, "overtime") / 100, cell: (p) => <span className="tabular-nums">{formatPaise(sum(p.earnings, "overtime"))}</span> },
    { key: "gross", header: "Gross", align: "right", sort: (p) => p.grossPaise, csv: (p) => p.grossPaise / 100, cell: (p) => <span className="font-medium text-emerald-700 tabular-nums dark:text-emerald-300">{formatPaise(p.grossPaise)}</span> },
    { key: "pf", header: "PF + ESI + PT", align: "right", csv: (p) => (sum(p.deductions, "pf") + sum(p.deductions, "esi") + sum(p.deductions, "pt")) / 100, cell: (p) => <span className="text-rose-700 tabular-nums dark:text-rose-300">{formatPaise(sum(p.deductions, "pf") + sum(p.deductions, "esi") + sum(p.deductions, "pt"))}</span> },
    { key: "other", header: "Advances & other", align: "right", csv: (p) => (sum(p.deductions, "loan") + sum(p.deductions, "other")) / 100, cell: (p) => <span className="text-rose-700 tabular-nums dark:text-rose-300">{formatPaise(sum(p.deductions, "loan") + sum(p.deductions, "other"))}</span> },
    { key: "net", header: "Net pay", align: "right", sort: (p) => p.netPaise, csv: (p) => p.netPaise / 100, cell: (p) => <span className="font-semibold text-blue-700 tabular-nums dark:text-blue-300">{formatPaise(p.netPaise)}</span> },
    { key: "status", header: "Status", csv: (p) => p.status, cell: (p) => (p.status === "paid" ? <Pill color="emerald" dot>Paid {formatDate(p.paidOn!)}</Pill> : <Pill color="rose" dot>Unpaid</Pill>) },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (p) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {run.status !== "draft" && p.status === "unpaid" && can("hr.payroll.approve") && <Button size="sm" className="h-8" onClick={() => setPaying([p])}><IndianRupee /> Pay</Button>}
          <ActionMenu label={`More actions for ${p.employee}`} items={[
            { label: "Payslip", icon: Eye, onClick: () => window.open(`/print/payslip/${p.id}`, "_blank", "noopener") },
            draft && can("hr.payroll.create") && { label: "Bonus or deduction", icon: SlidersHorizontal, onClick: () => setAdjusting(p) },
            p.status === "paid" && can("hr.payroll.approve") && { label: "Undo payment", icon: Undo2, onClick: () => setConfirm({ title: "Undo this salary payment?", description: "Every payslip paid in the same go goes back to unpaid, and its entry is removed from the books.", label: "Undo payment", run: () => api.post(`/hr/payslips/${p.id}/undo-payment`, {}) }) },
            "-",
            draft && can("hr.payroll.create") && { label: "Remove from this payroll", icon: Trash2, destructive: true, onClick: () => setConfirm({ title: `Remove ${p.employee}?`, description: "They won't be paid in this payroll. Recalculate brings them back.", label: "Remove", destructive: true, run: () => api.delete(`/hr/payslips/${p.id}`) }) },
          ]} />
        </span>
      ),
    },
  ]

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/hr/payroll">Payroll</BackLink>
      <DetailHeader
        title={`Payroll · ${monthLabel(run.month)}`}
        icon={IndianRupee}
        pills={<Pill color={RUN_STATUS[run.status]?.color} dot>{RUN_STATUS[run.status]?.label}</Pill>}
        subtitle={[run.number, `${formatDate(run.periodFrom)} – ${formatDate(run.periodTo)}`, `Pay date ${formatDate(run.payDate)}`, run.account && `from ${run.account}`].filter(Boolean).join(" · ")}
        actions={<>
          {draft && can("hr.payroll.create") && <Button variant="outline" disabled={busy} onClick={() => void act("recalculate", "Worked out again from the latest attendance and salaries")}><RefreshCw /> Recalculate</Button>}
          {draft && can("hr.payroll.approve") && <Button disabled={busy} onClick={() => setConfirm({ title: "Process this payroll?", description: "The numbers are locked and payslips can be shared and paid. You can reopen it while nothing is paid.", label: "Process", run: () => api.post(`/hr/payroll/${run.id}/process`, {}) })}><Lock /> Process</Button>}
          {run.status === "processed" && unpaid.length > 0 && can("hr.payroll.approve") && <Button onClick={() => setPaying(unpaid)}><BadgeIndianRupee /> Pay all ({unpaid.length})</Button>}
          <ActionMenu items={[
            run.status === "processed" && unpaid.length === slips.length && can("hr.payroll.approve") && { label: "Reopen to change", icon: Unlock, onClick: () => void act("reopen", "Payroll is a draft again") },
            "-",
            run.paidPaise === 0 && can("hr.payroll.create") && { label: "Delete payroll", icon: Trash2, destructive: true, onClick: () => setConfirm({ title: "Delete this payroll?", description: "All its payslips go too.", label: "Delete payroll", destructive: true, run: async () => { await api.delete(`/hr/payroll/${run.id}`); router.push("/app/m/hr/payroll") } }) },
          ]} />
        </>}
      />
      <Steps steps={[
        { key: "draft", label: "Draft", sub: "Check and adjust", state: draft ? "current" : "done" },
        { key: "processed", label: "Processed", sub: "Locked, ready to pay", state: run.status === "processed" ? "current" : run.status === "paid" ? "done" : "todo" },
        { key: "paid", label: "Paid", sub: run.status === "paid" ? "All salaries paid" : `${slips.length - unpaid.length} of ${slips.length} paid`, state: run.status === "paid" ? "done" : "todo" },
      ]} />
      <StatGrid items={[
        { label: "Employees", value: run.employees },
        { label: "Gross pay", value: formatPaise(run.grossPaise), accent: "text-emerald-700 dark:text-emerald-300" },
        { label: "Deductions", value: formatPaise(run.deductionsPaise), accent: "text-rose-700 dark:text-rose-300", hint: run.employerPaise ? `+ ${formatPaise(run.employerPaise)} your PF/ESI share` : undefined },
        { label: "Net pay", value: formatPaise(run.netPaise), accent: "text-blue-700 dark:text-blue-300", hint: run.paidPaise ? `${formatPaise(run.paidPaise)} paid` : "Nothing paid yet" },
      ]} />
      {draft && <p className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">Changed attendance, leave or a salary after running? Press <strong>Recalculate</strong>. Bonuses added here stay.</p>}
      <DataList<Payslip>
        id="hr-payslips"
        load={localList(async () => (await api.get<PayrollRun>(`/hr/payroll/${id}`)).payslips ?? [], (p, q) => `${p.employee} ${p.employeeCode}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Payslips", description: "Days paid count loss-of-pay (LOP) off: absences, half days and unpaid leave." }}
        columns={columns}
        searchPlaceholder="Search employee"
        bulkActions={run.status === "processed" && can("hr.payroll.approve") ? [{ label: "Pay selected", run: (rows) => { const u = rows.filter((r) => r.status === "unpaid"); if (!u.length) toast.error("These are already paid"); else setPaying(u) } }] : undefined}
        rowClick={(p) => { window.open(`/print/payslip/${p.id}`, "_blank", "noopener") }}
        exportName={`payroll-${run.month}`}
        emptyState={<p className="p-8 text-center text-sm text-muted-foreground">No payslips. Recalculate to add everyone with a salary set.</p>}
      />
      {paying && <PayDialog run={run} slips={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); refresh() }} />}
      {adjusting && <AdjustDialog slip={adjusting} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); refresh() }} />}
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} destructive={confirm?.destructive} title={confirm?.title ?? ""} description={confirm?.description} confirmLabel={confirm?.label ?? "OK"}
        onConfirm={async () => { try { await confirm!.run(); toast.success("Done"); refresh() } catch (e) { toast.error(errorMessage(e)) } }} />
    </div>
  )
}
