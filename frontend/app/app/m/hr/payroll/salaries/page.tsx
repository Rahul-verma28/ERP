"use client"

import * as React from "react"
import Link from "next/link"
import { Eye, Pencil, Users } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { Avatar, Pill } from "@/components/page-parts"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { SalaryDialog } from "@/components/hr/employee-dialogs"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import type { Employee } from "@/lib/hr"

// Salary structure: every current employee's monthly pay; set or change it in one place.

interface Row { id: string; code: string; name: string; email: string | null; phone: string | null; branch: string | null; department: string | null; designation: string | null; payType: string; basicPaise: number; allowancesPaise: number; deductionsPaise: number; grossPaise: number | null; pf: boolean; esi: boolean; pt: boolean; items: number }
const PRESETS: ViewPreset[] = [{ key: "all", label: "All", params: {} }, { key: "unset", label: "Salary not set", params: { show: "unset" } }]

export default function SalariesPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Employee | null>(null)
  if (!can("hr.payroll.view")) return <PageHeader title="Salary structure" description="You don't have access to payroll. Ask your admin." />
  const open = async (r: Row) => setEditing(await api.get<Employee>(`/hr/employees/${r.id}`))
  const columns: Column<Row>[] = [
    { key: "name", header: "Employee", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span className="flex items-center gap-2.5"><Avatar name={r.name} className="size-8" /><span><span className="block font-medium">{r.name}</span><span className="text-xs text-muted-foreground">{r.email ?? r.phone ?? "—"}</span></span></span> },
    { key: "code", header: "Employee ID", sort: (r) => r.code, csv: (r) => r.code, cell: (r) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.code}</span> },
    { key: "branch", header: "Branch", sort: (r) => r.branch ?? "", csv: (r) => r.branch ?? "", cell: (r) => (r.branch ? <Pill color="orange">{r.branch}</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "department", header: "Department", sort: (r) => r.department ?? "", csv: (r) => r.department ?? "", cell: (r) => (r.department ? <Pill color="violet">{r.department}</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "designation", header: "Designation", sort: (r) => r.designation ?? "", csv: (r) => r.designation ?? "", cell: (r) => (r.designation ? <Pill color="blue">{r.designation}</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "paytype", header: "Payslip type", defaultHidden: true, csv: (r) => r.payType, cell: (r) => (r.payType === "daily" ? "Daily" : "Monthly") },
    { key: "basic", header: "Basic", align: "right", sort: (r) => r.basicPaise, csv: (r) => r.basicPaise / 100, cell: (r) => (r.basicPaise ? <span className="tabular-nums">{formatPaise(r.basicPaise)}<span className="block text-xs text-muted-foreground">{r.payType === "daily" ? "a day" : "a month"}</span></span> : <Pill color="amber">Not set</Pill>) },
    { key: "allow", header: "Allowances", defaultHidden: true, align: "right", csv: (r) => r.allowancesPaise / 100, cell: (r) => <span className="tabular-nums">{formatPaise(r.allowancesPaise)}</span> },
    { key: "gross", header: "Gross a month", align: "right", sort: (r) => r.grossPaise ?? 0, csv: (r) => (r.grossPaise ?? 0) / 100, cell: (r) => (r.grossPaise === null ? <span className="text-muted-foreground">By days</span> : <span className="font-semibold tabular-nums">{formatPaise(r.grossPaise)}</span>) },
    { key: "ded", header: "Fixed deductions", align: "right", defaultHidden: true, csv: (r) => r.deductionsPaise / 100, cell: (r) => <span className="tabular-nums">{formatPaise(r.deductionsPaise)}</span> },
    { key: "stat", header: "Statutory", defaultHidden: true, csv: (r) => [r.pf && "PF", r.esi && "ESI", r.pt && "PT"].filter(Boolean).join(" "), cell: (r) => <span className="flex gap-1">{r.pf && <Pill color="blue">PF</Pill>}{r.esi && <Pill color="violet">ESI</Pill>}{r.pt && <Pill color="orange">PT</Pill>}{!r.pf && !r.esi && !r.pt && <span className="text-muted-foreground">—</span>}</span> },
    { key: "actions", header: "Actions", hideable: false, cell: (r) => <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}><Link href={`/app/m/hr/payroll/salaries/${r.id}`} title="View" aria-label={`View salary of ${r.name}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}><Eye /></Link>{can("hr.payroll.create") && <Button variant="ghost" size="icon-sm" title={r.basicPaise ? "Change basic salary" : "Set salary"} aria-label={`Change salary of ${r.name}`} onClick={() => void open(r)}><Pencil /></Button>}</span> },
  ]
  return (
    <>
      <HrTabs tabs={TABS.payroll} active="salaries" />
      <DataList<Row>
        id="hr-salaries"
        load={localList(async (p) => (await api.get<{ data: Row[] }>("/hr/salaries")).data.filter((r) => p.show !== "unset" || !r.basicPaise), (r, q) => `${r.name} ${r.code} ${r.email ?? ""} ${r.branch ?? ""} ${r.department ?? ""} ${r.designation ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Set salary", description: "Basic pay, allowances, deductions, loans and overtime for each employee. Open one to change it." }}
        summary={(r) => { const rows = (r.data as Row[] | undefined) ?? []; return <span className="text-sm text-muted-foreground">Monthly gross on this page <strong className="text-foreground tabular-nums">{formatPaise(rows.reduce((s, x) => s + (x.grossPaise ?? 0), 0))}</strong></span> }}
        columns={columns}
        searchPlaceholder="Search employee"
        presetLabel="Show"
        presets={PRESETS}
        rowHref={(r) => `/app/m/hr/payroll/salaries/${r.id}`}
        exportName="salary-structure"
        emptyState={<EmptyState icon={Users} title="No employees here" />}
      />
      {editing && <SalaryDialog employee={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setVersion((v) => v + 1) }} />}
    </>
  )
}
