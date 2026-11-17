"use client"

import { useSearchParams } from "next/navigation"
import { PageLoading } from "@/components/page-states"

import * as React from "react"
import { Eye, IndianRupee, Receipt } from "lucide-react"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { monthLabel, RUN_STATUS, useCurrentEmployees, type Payslip } from "@/lib/hr"

// Every payslip from every month: find one, open it to print or share. Self-service sees only their own.

type Row = Payslip & { month: string; runStatus: string; employee: string; employeeCode: string }
const PRESETS: ViewPreset[] = [{ key: "all", label: "All", params: {} }, { key: "unpaid", label: "Unpaid", params: { status: "unpaid" } }, { key: "paid", label: "Paid", params: { status: "paid" } }]

export default function PayslipsPage() {
  return <React.Suspense fallback={<PageLoading />}><Payslips /></React.Suspense>
}

function Payslips() {
  const search = useSearchParams()
  const { can } = useAuth()
  const emps = useCurrentEmployees()
  if (!can("hr.payslip.view")) return <PageHeader title="Payslips" description="You don't have access to payslips. Ask your admin." />
  const months = [...new Set(Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 7) }))]
  const columns: Column<Row>[] = [
    { key: "employee", header: "Employee", hideable: false, sort: (p) => p.employee, csv: (p) => p.employee, cell: (p) => <span className="flex items-center gap-2.5"><Avatar name={p.employee} className="size-8" /><span><span className="block font-medium">{p.employee}</span><span className="font-mono text-xs text-muted-foreground">{p.employeeCode}</span></span></span> },
    { key: "month", header: "Month", sort: (p) => p.month, csv: (p) => p.month, cell: (p) => <span><span className="block font-medium">{monthLabel(p.month)}</span><span className="font-mono text-xs text-muted-foreground">{p.number}</span></span> },
    { key: "days", header: "Days paid", align: "right", csv: (p) => p.payableDays, cell: (p) => <span className="tabular-nums">{p.payableDays}/{p.daysInMonth}{p.lopDays ? <span className="block text-xs text-destructive">{p.lopDays} LOP</span> : null}</span> },
    { key: "gross", header: "Gross", align: "right", csv: (p) => p.grossPaise / 100, cell: (p) => <span className="tabular-nums">{formatPaise(p.grossPaise)}</span> },
    { key: "ded", header: "Deductions", align: "right", csv: (p) => p.deductionsPaise / 100, cell: (p) => <span className="text-rose-700 tabular-nums dark:text-rose-300">{formatPaise(p.deductionsPaise)}</span> },
    { key: "net", header: "Net pay", align: "right", sort: (p) => p.netPaise, csv: (p) => p.netPaise / 100, cell: (p) => <span className="font-semibold tabular-nums">{formatPaise(p.netPaise)}</span> },
    { key: "status", header: "Status", csv: (p) => p.status, cell: (p) => (p.status === "paid" ? <Pill color="emerald" dot>Paid {p.paidOn ? formatDate(p.paidOn) : ""}</Pill> : <Pill color={p.runStatus === "draft" ? "slate" : "rose"} dot>{p.runStatus === "draft" ? RUN_STATUS.draft.label : "Unpaid"}</Pill>) },
    { key: "actions", header: "Actions", hideable: false, cell: (p) => <span onClick={(e) => e.stopPropagation()}><ActionMenu label={`More actions for ${p.employee}`} items={[{ label: "Open payslip", icon: Eye, onClick: () => window.open(`/print/payslip/${p.id}`, "_blank", "noopener") }, can("hr.payroll.view") && { label: "Open payroll", icon: IndianRupee, href: `/app/m/hr/payroll/${p.runId}` }]} /></span> },
  ]
  return (
    <>
      <HrTabs tabs={TABS.payroll} active="payslips" />
      <DataList<Row>
        id="hr-all-payslips"
        load={localList(async (p) => {
          const qs = new URLSearchParams(Object.entries({ month: p.month, status: p.status, employeeId: p.employeeId }).filter(([, v]) => v) as [string, string][]).toString()
          return (await api.get<{ data: Row[] }>(`/hr/payslips${qs ? `?${qs}` : ""}`)).data
        }, (p, q) => `${p.employee} ${p.employeeCode} ${p.number}`.toLowerCase().includes(q))}
        header={{ title: "Payslips", description: "Every payslip from every payroll. Open one to print, save as PDF or share." }}
        summary={(r) => { const rows = (r.data as Row[] | undefined) ?? []; return <span className="text-sm text-muted-foreground">Net on this page <strong className="text-foreground tabular-nums">{formatPaise(rows.reduce((s, p) => s + p.netPaise, 0))}</strong></span> }}
        columns={columns}
        searchPlaceholder="Search employee or payslip number"
        presetLabel="Show"
        presets={PRESETS}
        tabs
        defaultFilters={search.get("month") ? { month: search.get("month")! } : undefined}
        filters={[
          { key: "month", label: "Month", options: months.map((m) => ({ value: m, label: monthLabel(m) })) },
          ...(can("hr.payroll.view") ? [{ key: "employeeId", label: "Employee", options: (emps.data?.data ?? []).map((e) => ({ value: e.id, label: e.name })) }] : []),
        ]}
        rowClick={(p) => { window.open(`/print/payslip/${p.id}`, "_blank", "noopener") }}
        exportName="payslips"
        emptyState={<EmptyState icon={Receipt} title="No payslips here" description="Payslips appear once payroll is run for a month." />}
      />
    </>
  )
}
