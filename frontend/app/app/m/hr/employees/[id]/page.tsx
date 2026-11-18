"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { CalendarDays, ChevronLeft, ChevronRight, Eye, IndianRupee, LogOut, Pencil, RotateCcw, Trash2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { PageError, PageLoading, ErrorState } from "@/components/page-states"
import { ActionMenu, BackLink, DetailHeader, Pill, Section, StatGrid, Tabs } from "@/components/page-parts"
import { ExitDialog, SalaryDialog } from "@/components/hr/employee-dialogs"
import { LeaveDialog } from "@/components/hr/leave-dialogs"
import { EmployeeOverview } from "@/components/hr/employee-overview"
import { todayInIndia } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { ACTION_STATUS, ATT, EMP_STATUS, EMPLOYMENT_LABEL, LEAVE_STATUS, monthLabel, RUN_STATUS, type Employee, type HrAction, type LeaveApp, type Payslip } from "@/lib/hr"
import { cn } from "@/lib/utils"
import { AboutCard, RecordHistory, useTabParam } from "@/components/record-kit"

// One employee: profile, salary, attendance, leave, payslips and career history.

type Tab = "overview" | "salary" | "attendance" | "leave" | "payslips" | "career" | "history"
const TAB_KEYS: Tab[] = ["overview", "salary", "attendance", "leave", "payslips", "career", "history"]
interface Month { days: string[]; data: { id: string; cells: string[]; totals: Record<string, number> }[] }
interface Balance { types: { id: string; name: string; code: string; color: string; paid: boolean; daysPerYear: number }[]; data: { leave: { typeId: string; allowed: number; used: number; pending: number; left: number | null }[] }[] }

const shiftMonth = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7) }

function AttendanceTab({ id }: { id: string }) {
  const [month, setMonth] = React.useState(todayInIndia().slice(0, 7))
  const { data, error, reload } = useApi<Month>(`/hr/attendance/month?month=${month}&employeeId=${id}`)
  const row = data?.data[0]
  return (
    <Section title="Attendance" action={<div className="flex items-center gap-1"><Button size="icon-sm" variant="outline" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft /></Button><span className="w-36 text-center text-sm font-medium">{monthLabel(month)}</span><Button size="icon-sm" variant="outline" aria-label="Next month" disabled={month >= todayInIndia().slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight /></Button></div>}>
      {error ? <ErrorState error={error} onRetry={() => void reload()} /> : !data ? <PageLoading /> : !row ? <p className="py-6 text-center text-sm text-muted-foreground">Not working here this month.</p> : (
        <div className="grid gap-4">
          <div className="grid grid-cols-7 gap-1.5 text-center text-xs">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d} className="font-medium text-muted-foreground">{d}</span>)}
            {Array.from({ length: (new Date(`${data.days[0]}T00:00:00Z`).getUTCDay() + 6) % 7 }, (_, i) => <span key={`b${i}`} />)}
            {data.days.map((d, i) => {
              const s = row.cells[i]
              const a = ATT[s]
              return <span key={d} title={a?.label} className={cn("grid h-11 place-items-center rounded-lg border text-sm", s === "present" && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300", s === "absent" && "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300", s === "half_day" && "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300", s === "leave" && "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300", (s === "holiday" || s === "week_off") && "bg-muted text-muted-foreground", (s === "future" || !s) && "opacity-40")}><span className="font-medium">{Number(d.slice(8))}</span>{a?.short && s !== "future" && <span className="-mt-2 text-[10px]">{a.short}</span>}</span>
            })}
          </div>
          <StatGrid items={[
            { label: "Present", value: row.totals.present + row.totals.half_day / 2 },
            { label: "Absent", value: row.totals.absent, accent: row.totals.absent ? "text-destructive" : undefined },
            { label: "On leave", value: row.totals.leave },
            { label: "Late days", value: row.totals.late, hint: row.totals.overtimeMinutes ? `${Math.round(row.totals.overtimeMinutes / 6) / 10} h overtime` : undefined },
          ]} />
          <p className="text-xs text-muted-foreground">Days not marked count as worked for pay.</p>
        </div>
      )}
    </Section>
  )
}

function LeaveTab({ e }: { e: Employee }) {
  const { can } = useAuth()
  const list = useApi<{ data: LeaveApp[] }>(`/hr/leaves?employeeId=${e.id}`)
  const bal = useApi<Balance>(`/hr/leave-balances?employeeId=${e.id}`)
  const [applying, setApplying] = React.useState(false)
  const b = bal.data?.data[0]
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {bal.data?.types.map((t) => {
          const x = b?.leave.find((l) => l.typeId === t.id)
          return (
            <div key={t.id} className="ui-surface grid gap-1 p-4">
              <p className="flex items-center justify-between text-sm"><span className="font-medium">{t.name}</span><Pill color={t.color}>{t.code}</Pill></p>
              <p className="text-2xl font-bold tabular-nums">{x?.left ?? "∞"}<span className="ml-1 text-sm font-normal text-muted-foreground">{t.daysPerYear ? `left of ${t.daysPerYear}` : "unpaid"}</span></p>
              <p className="text-xs text-muted-foreground">{x?.used ?? 0} taken{x?.pending ? ` · ${x.pending} waiting` : ""}</p>
            </div>
          )
        })}
      </div>
      <Section title="Leave history" action={can("hr.leave.create") && e.status !== "exited" ? <Button size="sm" onClick={() => setApplying(true)}><CalendarDays /> Apply leave</Button> : undefined} flush>
        {list.error ? <div className="p-4"><ErrorState error={list.error} onRetry={() => void list.reload()} /></div> : !list.data ? <PageLoading /> : list.data.data.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No leave yet.</p> : (
          <ul className="divide-y">{list.data.data.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <Pill color={l.color}>{l.leaveCode}</Pill>
              <span className="min-w-0 flex-1"><span className="block font-medium">{formatDate(l.fromDate)}{l.toDate !== l.fromDate ? ` – ${formatDate(l.toDate)}` : ""} · {l.days} day{l.days === 1 ? "" : "s"}</span><span className="block truncate text-xs text-muted-foreground">{l.reason}</span></span>
              <Pill color={LEAVE_STATUS[l.status].color} dot>{LEAVE_STATUS[l.status].label}</Pill>
            </li>
          ))}</ul>
        )}
      </Section>
      {applying && <LeaveDialog employeeId={e.id} onClose={() => setApplying(false)} onSaved={() => { setApplying(false); void list.reload(); void bal.reload() }} />}
    </div>
  )
}

function PayslipsTab({ id }: { id: string }) {
  const { data, error, reload } = useApi<{ data: (Payslip & { month: string; runStatus: string })[] }>(`/hr/employees/${id}/payslips`)
  if (error) return <ErrorState error={error} onRetry={() => void reload()} />
  if (!data) return <PageLoading />
  return (
    <Section title="Payslips" flush>
      {data.data.length === 0 ? <EmptyState icon={IndianRupee} title="No payslips yet" description="They appear here once payroll is run for a month." /> : (
        <ul className="divide-y">{data.data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className="min-w-0 flex-1"><span className="block font-medium">{monthLabel(p.month)}</span><span className="text-xs text-muted-foreground">{p.payableDays} of {p.daysInMonth} days paid{p.lopDays ? ` · ${p.lopDays} loss of pay` : ""}</span></span>
            <span className="text-right tabular-nums"><span className="block font-semibold">{formatPaise(p.netPaise)}</span><span className="text-xs text-muted-foreground">gross {formatPaise(p.grossPaise)}</span></span>
            <Pill color={p.status === "paid" ? "emerald" : RUN_STATUS[p.runStatus]?.color} dot>{p.status === "paid" ? `Paid ${formatDate(p.paidOn!)}` : RUN_STATUS[p.runStatus]?.label}</Pill>
            <a href={`/print/payslip/${p.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}><Eye /> Payslip</a>
          </li>
        ))}</ul>
      )}
    </Section>
  )
}

function CareerTab({ id }: { id: string }) {
  const { data, error, reload } = useApi<{ data: HrAction[] }>(`/hr/actions?employeeId=${id}`)
  if (error) return <ErrorState error={error} onRetry={() => void reload()} />
  if (!data) return <PageLoading />
  const KIND: Record<string, string> = { promotion: "Promotion", transfer: "Transfer", award: "Award", warning: "Warning", complaint: "Complaint", resignation: "Resignation", termination: "Termination" }
  return (
    <Section title="Career history" description="Promotions, transfers, awards, warnings and exits" flush>
      {data.data.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</p> : (
        <ol className="grid gap-0 p-5">{data.data.map((a) => (
          <li key={a.id} className="relative border-l pb-5 pl-5 last:pb-0">
            <span className="absolute top-1 -left-1.5 size-3 rounded-full border-2 border-background bg-primary" />
            <p className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold">{KIND[a.kind]}</span><Pill color={ACTION_STATUS[a.status]?.color}>{ACTION_STATUS[a.status]?.label ?? a.status}</Pill><span className="text-xs text-muted-foreground">{formatDate(a.effectiveOn ?? a.onDate)}</span></p>
            <p className="text-sm text-muted-foreground">{a.kind === "promotion" || a.kind === "transfer" ? `${[a.from.designation, a.from.department].filter(Boolean).join(", ") || "—"} → ${[a.to.designation, a.to.department, a.to.branch].filter(Boolean).join(", ")}` : [a.typeName, a.subject, a.description].filter(Boolean).join(" · ")}</p>
          </li>
        ))}</ol>
      )}
    </Section>
  )
}

export default function EmployeePage() {
  return <React.Suspense fallback={<PageLoading />}><EmployeeView /></React.Suspense>
}

function EmployeeView() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can } = useAuth()
  const { data: e, error, reload } = useApi<Employee>(`/hr/employees/${id}`)
  const [tab, setTab] = useTabParam<Tab>(TAB_KEYS, "overview")
  const [open, setOpen] = React.useState<"salary" | "exit" | "delete" | null>(null)
  if (error) return <PageError error={error} onRetry={() => void reload()} />
  if (!e) return <PageLoading />
  const pay = can("hr.payroll.view")
  const allowances = (e.salaryItems ?? []).filter((i) => i.kind === "allowance")
  const deductions = (e.salaryItems ?? []).filter((i) => i.kind === "deduction")
  const val = (i: { calc: string; amount: number }) => (i.calc === "percent" ? Math.round((e.basicPaise * Number(i.amount)) / 10_000) : Number(i.amount))
  const gross = e.basicPaise + allowances.reduce((s, i) => s + val(i), 0)

  async function rejoin() {
    try {
      await api.post(`/hr/employees/${e!.id}/rejoin`, {})
      toast.success(`${e!.name} is active again`)
      void reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/hr/employees">Employees</BackLink>
      <DetailHeader
        title={e.name}
        initials={e.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
        pills={<><Pill color="slate">{e.code}</Pill><Pill color={EMP_STATUS[e.status].color} dot>{EMP_STATUS[e.status].label}{e.status === "on_notice" && e.exitOn ? ` till ${formatDate(e.exitOn)}` : ""}</Pill><Pill color="blue">{EMPLOYMENT_LABEL[e.employmentType]}</Pill></>}
        subtitle={[e.designation, e.department, e.branch].filter(Boolean).join(" · ") || "No designation yet"}
        actions={<>
          {can("hr.employee.edit") && <Link href={`/app/m/hr/employees/${e.id}/edit`} className={buttonVariants({ variant: "outline" })}><Pencil /> Edit</Link>}
          {can("hr.payroll.create") && e.status !== "exited" && <Button onClick={() => setOpen("salary")}><IndianRupee /> Salary</Button>}
          <ActionMenu items={[
            can("hr.employee.edit") && (e.status === "exited" ? { label: "Mark as rejoined", icon: RotateCcw, onClick: () => void rejoin() } : { label: "Mark as leaving", icon: LogOut, onClick: () => setOpen("exit") }),
            "-",
            can("hr.employee.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setOpen("delete") },
          ]} />
        </>}
      />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "overview", label: "Overview" },
        { key: "salary", label: "Salary", hidden: !pay },
        { key: "attendance", label: "Attendance" },
        { key: "leave", label: "Leave" },
        { key: "payslips", label: "Payslips", hidden: !can("hr.payslip.view") },
        { key: "career", label: "Career", hidden: !can("hr.career.view") }, { key: "history", label: "History" }]} />
      {tab === "history" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <RecordHistory kind="employee" id={e.id} refText={e.name} created={{ at: e.createdAt }} />
          <AboutCard id={e.id} createdAt={e.createdAt} updatedAt={"updatedAt" in e ? (e as { updatedAt?: string }).updatedAt : null} className="h-fit" />
        </div>
      )}

      {tab === "overview" && <EmployeeOverview e={e} />}

      {tab === "salary" && pay && (
        <div className="grid gap-5">
          <StatGrid items={[
            { label: e.payType === "daily" ? "Wage a day" : "Basic a month", value: e.basicPaise ? formatPaise(e.basicPaise) : "Not set" },
            { label: "Allowances", value: formatPaise(gross - e.basicPaise), hint: `${allowances.length} item${allowances.length === 1 ? "" : "s"}` },
            e.payType === "monthly" && { label: "Gross a month", value: formatPaise(gross) },
            { label: "Deducts", value: [e.pf && "PF", e.esi && "ESI", e.pt && "PT"].filter(Boolean).join(", ") || "Nothing statutory" },
          ]} />
          <Section title="Salary structure" description="Before loss of pay, overtime and loan instalments" action={<span className="flex gap-1.5"><Link href={`/app/m/hr/payroll/salaries/${e.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}><Eye /> Loans & overtime</Link>{can("hr.payroll.create") && e.status !== "exited" && <Button size="sm" onClick={() => setOpen("salary")}><Pencil /> Change</Button>}</span>} flush>
            <table className="w-full text-sm">
              <tbody className="divide-y">
                <tr><td className="px-5 py-2.5">Basic</td><td className="px-5 py-2.5 text-right tabular-nums">{formatPaise(e.basicPaise)}</td></tr>
                {allowances.map((i, k) => <tr key={`a${k}`}><td className="px-5 py-2.5">{i.name}{i.calc === "percent" && <span className="ml-1 text-xs text-muted-foreground">({Number(i.amount) / 100}% of basic)</span>}</td><td className="px-5 py-2.5 text-right tabular-nums">{formatPaise(val(i))}</td></tr>)}
                <tr className="bg-muted/50 font-semibold"><td className="px-5 py-2.5">Gross</td><td className="px-5 py-2.5 text-right tabular-nums">{formatPaise(gross)}</td></tr>
                {deductions.map((i, k) => <tr key={`d${k}`} className="text-muted-foreground"><td className="px-5 py-2.5">{i.name}</td><td className="px-5 py-2.5 text-right tabular-nums">− {formatPaise(val(i))}</td></tr>)}
              </tbody>
            </table>
          </Section>
        </div>
      )}
      {tab === "attendance" && <AttendanceTab id={e.id} />}
      {tab === "leave" && <LeaveTab e={e} />}
      {tab === "payslips" && <PayslipsTab id={e.id} />}
      {tab === "career" && <CareerTab id={e.id} />}

      {open === "salary" && <SalaryDialog employee={e} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void reload() }} />}
      {open === "exit" && <ExitDialog employee={e} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void reload() }} />}
      <ConfirmDialog
        open={open === "delete"}
        onOpenChange={(o) => !o && setOpen(null)}
        destructive
        title={`Delete ${e.name}?`}
        description="Their attendance and leave go too. Someone with payslips cannot be deleted: mark them as leaving instead."
        confirmLabel="Delete employee"
        onConfirm={async () => {
          try {
            await api.delete(`/hr/employees/${e.id}`)
            toast.success("Employee deleted")
            router.push("/app/m/hr/employees")
          } catch (err) {
            toast.error(errorMessage(err))
          }
        }}
      />
    </div>
  )
}
