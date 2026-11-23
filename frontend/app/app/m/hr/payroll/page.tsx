"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { CalendarDays, Eye, FileText, IndianRupee, Play, Trash2, Wallet } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { countBy, DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { SummaryCards } from "@/components/summary-cards"
import { Field, FormError } from "@/components/form"
import { PageLoading, NoAccessPage } from "@/components/page-states"
import { ActionMenu, Pill } from "@/components/page-parts"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { AccountSelect, accountForMethod } from "@/components/finance/forms"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { useFinAccounts } from "@/lib/finance"
import { monthLabel, RUN_STATUS, type PayrollRun } from "@/lib/hr"

// Payroll runs, one per month: Draft (check and adjust) → Processed (locked) → Paid.

const prevMonth = () => { const d = new Date(`${todayInIndia().slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) }

function RunDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (r: PayrollRun) => void }) {
  const accounts = useFinAccounts()
  const { can } = useAuth()
  const [f, setF] = React.useState({ month: prevMonth(), payDate: todayInIndia(), accountId: "", notes: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const account = f.accountId || accountForMethod(accounts.data?.data ?? [], "bank")
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.month) x.month = "Choose the month"
    else if (f.month > todayInIndia().slice(0, 7)) x.month = "Can't be a future month"
    if (!f.payDate) x.payDate = "Choose the pay date"
    else if (f.month && f.payDate < `${f.month}-01`) x.payDate = "Must be in or after the month"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const r = await api.post<PayrollRun>("/hr/payroll", { ...f, accountId: can("finance.expense.view") ? account || null : null, notes: f.notes.trim() || null })
      toast.success(`Payroll for ${monthLabel(r.month)} worked out for ${r.employees} employee${r.employees === 1 ? "" : "s"}`)
      onSaved(r)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Run payroll</DialogTitle><DialogDescription>Works out every employee&apos;s pay for the month from their salary, attendance, leave, overtime and advances. Nothing is paid yet.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Month" required error={errors.month}><Input type="month" value={f.month} max={todayInIndia().slice(0, 7)} onChange={(e) => { setF((x) => ({ ...x, month: e.target.value })); setErrors({}) }} /></Field>
          <Field label="Pay date" required error={errors.payDate} hint="When salaries will be paid"><Input type="date" value={f.payDate} onChange={(e) => { setF((x) => ({ ...x, payDate: e.target.value })); setErrors({}) }} /></Field>
          {can("finance.expense.view") && <Field label="Pay from" hint="The bank account salaries go out of"><AccountSelect value={account} onChange={(v) => setF((x) => ({ ...x, accountId: v }))} aria-label="Pay from" /></Field>}
          <Field label="Note"><Textarea rows={2} maxLength={500} value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} placeholder="Optional, e.g. Diwali bonus month" /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}><Play /> {busy ? "Working out…" : "Work out payroll"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const PRESETS: ViewPreset[] = [{ key: "all", label: "All", params: {}, countKey: "all" }, { key: "draft", label: "Draft", params: { status: "draft" }, countKey: "draft" }, { key: "processed", label: "Processed · to pay", params: { status: "processed" }, countKey: "processed" }, { key: "paid", label: "Paid", params: { status: "paid" }, countKey: "paid" }]
const payState = (r: PayrollRun) => (r.status === "draft" ? null : r.paidPaise >= r.netPaise ? "paid" : r.paidPaise > 0 ? "partly" : "unpaid")

export default function PayrollPage() {
  return <React.Suspense fallback={<PageLoading />}><Payroll /></React.Suspense>
}

function Payroll() {
  const router = useRouter()
  const search = useSearchParams()
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [running, setRunning] = React.useState(!!search.get("run"))
  const [deleting, setDeleting] = React.useState<PayrollRun | null>(null)
  if (!can("hr.payroll.view")) return <NoAccessPage title="Payroll" permission="hr.payroll.view" />
  const columns: Column<PayrollRun>[] = [
    { key: "month", header: "Title", hideable: false, sort: (r) => r.month, csv: (r) => `${monthLabel(r.month)} payroll`, cell: (r) => <span><span className="block font-semibold">{monthLabel(r.month)} payroll</span><span className="block max-w-56 truncate text-xs text-muted-foreground">{[r.number, r.notes].filter(Boolean).join(" · ")}</span></span> },
    { key: "freq", header: "Frequency", csv: () => "Monthly", cell: () => <Pill color="violet">Monthly</Pill> },
    { key: "period", header: "Pay period", csv: (r) => `${r.periodFrom.slice(0, 10)} to ${r.periodTo.slice(0, 10)}`, cell: (r) => <span className="flex items-center gap-1.5 text-sm"><CalendarDays className="size-3.5 text-muted-foreground" />{formatDate(r.periodFrom)} – {formatDate(r.periodTo)}</span> },
    { key: "pay", header: "Pay date", sort: (r) => r.payDate, csv: (r) => r.payDate.slice(0, 10), cell: (r) => formatDate(r.payDate) },
    { key: "employees", header: "Employees", align: "right", csv: (r) => r.employees, cell: (r) => <Pill color="blue">{r.employees}</Pill> },
    { key: "gross", header: "Gross", align: "right", csv: (r) => r.grossPaise / 100, cell: (r) => <span className="tabular-nums">{formatPaise(r.grossPaise)}</span> },
    { key: "ded", header: "Deductions", align: "right", csv: (r) => r.deductionsPaise / 100, cell: (r) => <span className="text-rose-700 tabular-nums dark:text-rose-300">{formatPaise(r.deductionsPaise)}</span> },
    { key: "net", header: "Net pay", align: "right", sort: (r) => r.netPaise, csv: (r) => r.netPaise / 100, cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.netPaise)}{r.status !== "draft" && r.paidPaise < r.netPaise && <span className="block text-xs font-normal text-muted-foreground">{formatPaise(r.netPaise - r.paidPaise)} to pay</span>}</span> },
    { key: "employer", header: "Employer PF/ESI", align: "right", defaultHidden: true, csv: (r) => r.employerPaise / 100, cell: (r) => <span className="tabular-nums">{formatPaise(r.employerPaise)}</span> },
    { key: "status", header: "Status", csv: (r) => RUN_STATUS[r.status]?.label, cell: (r) => <Pill color={RUN_STATUS[r.status]?.color} dot>{RUN_STATUS[r.status]?.label}</Pill> },
    { key: "paystate", header: "Payment status", csv: (r) => payState(r) ?? "", cell: (r) => { const st = payState(r); if (!st) return <span className="text-xs text-muted-foreground">After processing</span>; const pct = r.netPaise ? Math.round((r.paidPaise / r.netPaise) * 100) : 0; return <span className="grid w-32 gap-1"><Pill color={st === "paid" ? "emerald" : st === "partly" ? "amber" : "rose"} className="w-fit">{st === "paid" ? "Paid" : st === "partly" ? "Partly paid" : "Unpaid"}</Pill>{st === "partly" && <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-amber-500" style={{ width: `${pct}%` }} /></span>}</span> } },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Link href={`/app/m/hr/payroll/${r.id}`} title="View" aria-label={`View ${monthLabel(r.month)} payroll`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}><Eye /></Link>
          <ActionMenu label={`More actions for ${monthLabel(r.month)}`} items={[
            { label: "Payslips of this month", icon: FileText, href: `/app/m/hr/payroll/payslips?month=${r.month}` },
            "-",
            can("hr.payroll.create") && r.paidPaise === 0 && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("hr.payroll.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setRunning(true)}><Play /> Run payroll</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.payroll} active="runs" />
      <DataList<PayrollRun>
        id="hr-payroll"
        load={localList(
          async () => (await api.get<{ data: PayrollRun[] }>("/hr/payroll")).data,
          (r, q) => `${r.number} ${monthLabel(r.month)} ${r.notes ?? ""}`.toLowerCase().includes(q),
          {
            filter: (r, p) => !p.status || r.status === p.status,
            counts: (rows) => countBy(rows, (r) => r.status),
            meta: (rows) => {
              const year = todayInIndia().slice(0, 4)
              const thisYear = rows.filter((r) => r.month.startsWith(year))
              return { cards: { runs: rows.length, paidYear: thisYear.reduce((n, r) => n + r.paidPaise, 0), toPay: rows.reduce((n, r) => n + (r.status === "draft" ? 0 : Math.max(0, r.netPaise - r.paidPaise)), 0), last: rows[0] ?? null, drafts: rows.filter((r) => r.status === "draft").length } }
            },
          },
        )}
        tabs
        top={(res) => {
          const c = res.cards as { runs: number; paidYear: number; toPay: number; last: PayrollRun | null; drafts: number } | undefined
          if (!c) return null
          return <SummaryCards items={[
            { label: "Payroll runs", value: c.runs, hint: c.drafts ? `${c.drafts} still in draft` : "All processed", color: "blue", icon: FileText },
            { label: `Paid in ${todayInIndia().slice(0, 4)}`, value: formatPaise(c.paidYear), hint: "Net salary paid out", color: "emerald", icon: IndianRupee },
            { label: "Still to pay", value: formatPaise(c.toPay), hint: c.toPay ? "Processed but not paid" : "Nothing pending", color: c.toPay ? "rose" : "slate", icon: Wallet },
            { label: "Last payroll", value: c.last ? formatPaise(c.last.netPaise) : "—", hint: c.last ? `${monthLabel(c.last.month)} · ${c.last.employees} employees` : "Run your first payroll", color: "violet", icon: CalendarDays },
          ]} />
        }}
        params={{ v: String(version) }}
        header={{ title: "Payroll", description: "One payroll a month. Check it in Draft, process to lock it, then pay: the books are updated on their own.", primary: add }}
        columns={columns}
        searchPlaceholder="Search month"
        presetLabel="Show"
        presets={PRESETS}
        rowHref={(r) => `/app/m/hr/payroll/${r.id}`}
        exportName="payroll"
        emptyState={<EmptyState icon={IndianRupee} title="No payroll yet" description="Set each employee's salary, then run payroll for the month." action={add} />}
      />
      {running && <RunDialog onClose={() => setRunning(false)} onSaved={(r) => { setRunning(false); router.push(`/app/m/hr/payroll/${r.id}`) }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete payroll for ${deleting ? monthLabel(deleting.month) : ""}?`} description="Its payslips go too. Overtime and advances come back for the next run." confirmLabel="Delete payroll"
        onConfirm={async () => { try { await api.delete(`/hr/payroll/${deleting!.id}`); toast.success("Payroll deleted"); setVersion((v) => v + 1) } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
