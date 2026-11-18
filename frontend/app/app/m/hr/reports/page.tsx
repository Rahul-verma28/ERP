"use client"

import * as React from "react"
import { CalendarCheck, Clock, FileBarChart, IndianRupee, Plane, UserX, Users, Wallet } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { DataList, periodFilter } from "@/components/data-list"
import { SummaryCards } from "@/components/summary-cards"
import { Money, ReportTabs, hours, lastMonth, monthFilter, range, thisMonth, useReportTab, wholeReport } from "@/components/reports/kit"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { useSharedApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"

// HR reports a business and its CA ask for each month: who came in, the payroll register with
// PF, ESI and PT split out (for the challans), and leave taken by type.

interface AttRow { id: string; code: string; name: string; department: string | null; designation: string | null; present: number; halfDay: number; absent: number; leave: number; off: number; unmarked: number; lateDays: number; lateMinutes: number; overtimeMinutes: number; workedMinutes: number; attendancePct: number }
interface PayRow { id: string; number: string; status: string; paidOn: string | null; employeeId: string; code: string; name: string; department: string | null; uan: string | null; esiNo: string | null; pan: string | null; daysInMonth: number; payableDays: number; lopDays: number; basicPaise: number; grossPaise: number; overtimePaise: number; pfPaise: number; esiPaise: number; ptPaise: number; loanPaise: number; otherPaise: number; deductionsPaise: number; netPaise: number; employerPaise: number }
interface LeaveRow { id: string; code: string; name: string; department: string | null; taken: Record<string, number>; total: number; unpaid: number; pending: number; rejected: number }
interface LeaveType { id: string; name: string; code: string; paid: boolean }
type Sums = Record<string, number>

const person = (r: { name: string; code: string; department?: string | null }) => <span><span className="font-medium">{r.name}</span><span className="block text-xs text-muted-foreground">{r.code}{r.department ? ` · ${r.department}` : ""}</span></span>
const num = (v: number, warn?: boolean) => <span className={cn("tabular-nums", !v && "text-muted-foreground", warn && v > 0 && "font-medium text-destructive")}>{v || "—"}</span>

function Attendance() {
  return (
    <DataList<AttRow>
      id="hr-report-attendance"
      load={wholeReport<AttRow>((p) => `/reports/attendance?month=${p.month ?? thisMonth()}`, (r, q) => `${r.name} ${r.code} ${r.department ?? ""}`.toLowerCase().includes(q))}
      header={{ title: "Attendance Summary", description: "Each person's month: days present, absent and on leave, late arrivals and overtime." }}
      filters={[monthFilter()]}
      defaultFilters={{ month: thisMonth() }}
      top={(r) => {
        const s = (r.sums ?? {}) as Sums
        return <SummaryCards items={[
          { label: "People", value: s.people ?? 0, hint: `${r.days ?? 0} days in the month`, color: "blue", icon: Users },
          { label: "Average attendance", value: `${s.avgPct ?? 0}%`, hint: "Present out of working days", color: "emerald", icon: CalendarCheck },
          { label: "Absent days", value: s.absent ?? 0, hint: "Without leave", color: "rose", icon: UserX },
          { label: "Late arrivals", value: s.lateDays ?? 0, hint: "Days someone came late", color: "amber", icon: Clock },
          { label: "Overtime", value: hours(s.overtimeMinutes ?? 0), hint: "Over the shift", color: "violet", icon: Clock },
        ]} />
      }}
      columns={[
        { key: "name", header: "Employee", hideable: false, sort: (r) => r.name, csv: (r) => `${r.name} (${r.code})`, cell: person },
        { key: "designation", header: "Designation", defaultHidden: true, csv: (r) => r.designation ?? "", cell: (r) => r.designation ?? "—" },
        { key: "present", header: "Present", align: "right", sort: (r) => r.present, csv: (r) => r.present, cell: (r) => num(r.present) },
        { key: "half", header: "Half day", align: "right", sort: (r) => r.halfDay, csv: (r) => r.halfDay, cell: (r) => num(r.halfDay) },
        { key: "absent", header: "Absent", align: "right", sort: (r) => r.absent, csv: (r) => r.absent, cell: (r) => num(r.absent, true) },
        { key: "leave", header: "Leave", align: "right", sort: (r) => r.leave, csv: (r) => r.leave, cell: (r) => num(r.leave) },
        { key: "off", header: "Off / holiday", align: "right", defaultHidden: true, csv: (r) => r.off, cell: (r) => num(r.off) },
        { key: "unmarked", header: "Not marked", align: "right", csv: (r) => r.unmarked, cell: (r) => num(r.unmarked) },
        { key: "late", header: "Late", align: "right", sort: (r) => r.lateDays, csv: (r) => r.lateDays, cell: (r) => <span className="tabular-nums">{r.lateDays ? `${r.lateDays} (${r.lateMinutes} min)` : "—"}</span> },
        { key: "worked", header: "Worked", align: "right", sort: (r) => r.workedMinutes, csv: (r) => Math.round(r.workedMinutes / 6) / 10, cell: (r) => hours(r.workedMinutes) },
        { key: "ot", header: "Overtime", align: "right", sort: (r) => r.overtimeMinutes, csv: (r) => Math.round(r.overtimeMinutes / 6) / 10, cell: (r) => hours(r.overtimeMinutes) },
        { key: "pct", header: "Attendance", align: "right", sort: (r) => r.attendancePct, csv: (r) => r.attendancePct, cell: (r) => <span className={cn("font-semibold tabular-nums", r.attendancePct < 75 ? "text-destructive" : r.attendancePct < 90 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>{r.attendancePct}%</span> },
      ]}
      searchPlaceholder="Search name, code or department"
      rowHref={(r) => `/app/m/hr/employees/${r.id}?tab=attendance`}
      exportName="attendance-summary"
      emptyState={<EmptyState icon={FileBarChart} title="No one on the rolls this month" />}
    />
  )
}

function Payroll() {
  return (
    <DataList<PayRow>
      id="hr-report-payroll"
      load={wholeReport<PayRow>((p) => `/reports/payroll?month=${p.month ?? lastMonth()}`, (r, q) => `${r.name} ${r.code} ${r.number} ${r.uan ?? ""}`.toLowerCase().includes(q))}
      header={{ title: "Payroll Register", description: "Every payslip of the month with PF, ESI and professional tax split out, for the challans and your CA." }}
      filters={[monthFilter()]}
      defaultFilters={{ month: lastMonth() }}
      top={(r) => {
        const s = (r.sums ?? {}) as Sums
        return <SummaryCards items={[
          { label: "Gross pay", value: formatPaise(s.grossPaise ?? 0), hint: `${s.people ?? 0} payslips`, color: "blue", icon: IndianRupee },
          { label: "Net paid out", value: formatPaise(s.netPaise ?? 0), hint: s.unpaid ? `${s.unpaid} not paid yet` : "All paid", color: "emerald", icon: Wallet },
          { label: "PF + ESI (staff)", value: formatPaise((s.pfPaise ?? 0) + (s.esiPaise ?? 0)), hint: `PF ${formatPaise(s.pfPaise ?? 0)} · ESI ${formatPaise(s.esiPaise ?? 0)}`, color: "violet", icon: FileBarChart },
          { label: "Employer's share", value: formatPaise(s.employerPaise ?? 0), hint: "PF and ESI you pay on top", color: "amber", icon: FileBarChart },
          { label: "Cost to company", value: formatPaise(s.costPaise ?? 0), hint: "Gross + employer's share", color: "rose", icon: IndianRupee },
        ]} />
      }}
      columns={[
        { key: "name", header: "Employee", hideable: false, sort: (r) => r.name, csv: (r) => `${r.name} (${r.code})`, cell: person },
        { key: "number", header: "Payslip", defaultHidden: true, csv: (r) => r.number, cell: (r) => <span className="font-mono text-xs">{r.number}</span> },
        { key: "uan", header: "UAN", defaultHidden: true, csv: (r) => r.uan ?? "", cell: (r) => <span className="font-mono text-xs">{r.uan ?? "—"}</span> },
        { key: "esiNo", header: "ESI no.", defaultHidden: true, csv: (r) => r.esiNo ?? "", cell: (r) => <span className="font-mono text-xs">{r.esiNo ?? "—"}</span> },
        { key: "days", header: "Paid days", align: "right", csv: (r) => r.payableDays, cell: (r) => <span className="tabular-nums">{r.payableDays}/{r.daysInMonth}{r.lopDays ? <span className="block text-xs text-destructive">{r.lopDays} LOP</span> : null}</span> },
        { key: "basic", header: "Basic", align: "right", defaultHidden: true, csv: (r) => r.basicPaise / 100, cell: (r) => <Money p={r.basicPaise} /> },
        { key: "ot", header: "Overtime", align: "right", defaultHidden: true, csv: (r) => r.overtimePaise / 100, cell: (r) => <Money p={r.overtimePaise} /> },
        { key: "gross", header: "Gross", align: "right", sort: (r) => r.grossPaise, csv: (r) => r.grossPaise / 100, cell: (r) => <Money p={r.grossPaise} /> },
        { key: "pf", header: "PF", align: "right", csv: (r) => r.pfPaise / 100, cell: (r) => <Money p={r.pfPaise} /> },
        { key: "esi", header: "ESI", align: "right", csv: (r) => r.esiPaise / 100, cell: (r) => <Money p={r.esiPaise} /> },
        { key: "pt", header: "PT", align: "right", csv: (r) => r.ptPaise / 100, cell: (r) => <Money p={r.ptPaise} /> },
        { key: "loan", header: "Loan", align: "right", defaultHidden: true, csv: (r) => r.loanPaise / 100, cell: (r) => <Money p={r.loanPaise} /> },
        { key: "other", header: "Other", align: "right", defaultHidden: true, csv: (r) => r.otherPaise / 100, cell: (r) => <Money p={r.otherPaise} /> },
        { key: "deductions", header: "Deductions", align: "right", csv: (r) => r.deductionsPaise / 100, cell: (r) => <Money p={r.deductionsPaise} /> },
        { key: "net", header: "Net pay", align: "right", sort: (r) => r.netPaise, csv: (r) => r.netPaise / 100, cell: (r) => <Money p={r.netPaise} strong /> },
        { key: "employer", header: "Employer share", align: "right", defaultHidden: true, csv: (r) => r.employerPaise / 100, cell: (r) => <Money p={r.employerPaise} /> },
        { key: "status", header: "Status", csv: (r) => (r.status === "paid" ? `Paid ${r.paidOn?.slice(0, 10) ?? ""}` : "Not paid"), cell: (r) => r.status === "paid" ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">Paid {r.paidOn ? formatDate(r.paidOn) : ""}</Badge> : <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">Not paid</Badge> },
      ]}
      searchPlaceholder="Search name, code or UAN"
      rowHref={(r) => `/app/m/hr/employees/${r.employeeId}?tab=payslips`}
      exportName="payroll-register"
      emptyState={<EmptyState icon={FileBarChart} title="No payroll for this month" description="Run payroll for the month first; its payslips show here." />}
    />
  )
}

function Leave() {
  const { me } = useAuth()
  const types = useSharedApi<{ data: LeaveType[] }>("/hr/leave-types")
  const list = (types.data?.data ?? []).filter(Boolean)
  return (
    <DataList<LeaveRow>
      key={list.length}
      id="hr-report-leave"
      load={wholeReport<LeaveRow>((p) => `/reports/leave?${range(p)}`, (r, q) => `${r.name} ${r.code} ${r.department ?? ""}`.toLowerCase().includes(q))}
      header={{ title: "Leave Taken", description: "Approved leave per person and type in the period, with what is still waiting for a decision." }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
      defaultFilters={{ period: "this_fy" }}
      top={(r) => {
        const s = (r.sums ?? {}) as Sums
        return <SummaryCards items={[
          { label: "Leave taken", value: `${s.days ?? 0} days`, hint: `${s.people ?? 0} people took leave`, color: "blue", icon: Plane },
          { label: "Waiting", value: `${s.pending ?? 0} days`, hint: "Applied, not decided", color: "amber", icon: Clock },
        ]} />
      }}
      columns={[
        { key: "name", header: "Employee", hideable: false, sort: (r) => r.name, csv: (r) => `${r.name} (${r.code})`, cell: person },
        ...list.map((t) => ({ key: t.id, header: t.code || t.name, align: "right" as const, sort: (r: LeaveRow) => r.taken[t.id] ?? 0, csv: (r: LeaveRow) => r.taken[t.id] ?? 0, cell: (r: LeaveRow) => <span title={t.name}>{num(r.taken[t.id] ?? 0)}</span> })),
        { key: "total", header: "Total", align: "right", sort: (r) => r.total, csv: (r) => r.total, cell: (r) => <span className="font-semibold tabular-nums">{r.total || "—"}</span> },
        { key: "unpaid", header: "Unpaid", align: "right", csv: (r) => r.unpaid, cell: (r) => num(r.unpaid, true) },
        { key: "pending", header: "Waiting", align: "right", sort: (r) => r.pending, csv: (r) => r.pending, cell: (r) => <span className={cn("tabular-nums", r.pending ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{r.pending || "—"}</span> },
        { key: "rejected", header: "Rejected", align: "right", defaultHidden: true, csv: (r) => r.rejected, cell: (r) => num(r.rejected) },
      ]}
      searchPlaceholder="Search name, code or department"
      rowHref={(r) => `/app/m/hr/employees/${r.id}?tab=leave`}
      exportName="leave-taken"
      emptyState={<EmptyState icon={FileBarChart} title="No one to show" />}
    />
  )
}

const TABS = [["attendance", "Attendance"], ["payroll", "Payroll Register"], ["leave", "Leave Taken"]] as const

function Reports() {
  const { can } = useAuth()
  const tabs = TABS.filter(([k]) => can(k === "attendance" ? "hr.attendance.view" : k === "payroll" ? "hr.payroll.view" : "hr.leave.view"))
  const [tab, setTab] = useReportTab(tabs.length ? tabs : TABS)
  if (!tabs.length) return <PageHeader title="HR reports" description="You don't have access to HR reports. Ask your admin." />
  return (
    <div className="grid gap-4">
      <ReportTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "attendance" && <Attendance />}
      {tab === "payroll" && <Payroll />}
      {tab === "leave" && <Leave />}
    </div>
  )
}

export default function HrReportsPage() {
  return <React.Suspense><Reports /></React.Suspense>
}
