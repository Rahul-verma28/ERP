"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Briefcase, Clock, Eye, FileSignature, GraduationCap, IndianRupee, LogOut, Pencil, Plus, RotateCcw, Trash2, Users } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, type Column, type ViewPreset } from "@/components/data-list"
import { PageLoading, NoAccessPage } from "@/components/page-states"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { ExitDialog } from "@/components/hr/employee-dialogs"
import { SummaryCards, share } from "@/components/summary-cards"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { EMP_STATUS, EMPLOYMENT_LABEL, useHrLookups, type Employee } from "@/lib/hr"

// Employees: everyone on the team, by type, with their department, designation and pay.

const PRESETS: ViewPreset[] = [
  { key: "current", label: "Current", params: { status: "current" }, countKey: "current" },
  { key: "full_time", label: "Full time", params: { status: "current", employmentType: "full_time" }, countKey: "full_time" },
  { key: "part_time", label: "Part time", params: { status: "current", employmentType: "part_time" }, countKey: "part_time" },
  { key: "contract", label: "Contract", params: { status: "current", employmentType: "contract" }, countKey: "contract" },
  { key: "intern", label: "Interns", params: { status: "current", employmentType: "intern" }, countKey: "intern" },
  { key: "on_notice", label: "On notice", params: { status: "on_notice" }, countKey: "on_notice" },
  { key: "exited", label: "Left", params: { status: "exited" }, countKey: "exited" },
]

export default function EmployeesPage() {
  return <React.Suspense fallback={<PageLoading />}><Employees /></React.Suspense>
}

function Employees() {
  const search = useSearchParams()
  const { can } = useAuth()
  const look = useHrLookups()
  const [version, setVersion] = React.useState(0)
  const [exiting, setExiting] = React.useState<Employee | null>(null)
  const [deleting, setDeleting] = React.useState<Employee | null>(null)
  if (!can("hr.employee.view")) return <NoAccessPage title="Employees" permission="hr.employee.view" />
  const reload = () => setVersion((v) => v + 1)
  const pay = can("hr.payroll.view")

  async function rejoin(e: Employee) {
    try {
      await api.post(`/hr/employees/${e.id}/rejoin`, {})
      toast.success(`${e.name} is active again`)
      reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const columns: Column<Employee>[] = [
    { key: "name", header: "Employee", hideable: false, sort: (e) => e.name, csv: (e) => e.name, cell: (e) => <span className="flex items-center gap-2.5"><Avatar name={e.name} /><span className="min-w-0"><span className="block font-medium">{e.name}</span><span className="block truncate text-xs text-muted-foreground">{e.phone ?? e.email ?? "—"}</span></span></span> },
    { key: "code", header: "ID", sort: (e) => e.code, csv: (e) => e.code, cell: (e) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{e.code}</span> },
    { key: "branch", header: "Branch", sort: (e) => e.branch ?? "", csv: (e) => e.branch ?? "", cell: (e) => (e.branch ? <Pill color="orange">{e.branch}</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "department", header: "Department", sort: (e) => e.department ?? "", csv: (e) => e.department ?? "", cell: (e) => (e.department ? <Pill color="violet">{e.department}</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "designation", header: "Designation", sort: (e) => e.designation ?? "", csv: (e) => e.designation ?? "", cell: (e) => (e.designation ? <Pill color="blue">{e.designation}</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "type", header: "Employment type", csv: (e) => EMPLOYMENT_LABEL[e.employmentType], cell: (e) => <Pill color={e.employmentType === "full_time" ? "emerald" : e.employmentType === "intern" ? "amber" : "slate"}>{EMPLOYMENT_LABEL[e.employmentType]}</Pill> },
    { key: "manager", header: "Reports to", defaultHidden: true, csv: (e) => e.manager ?? "", cell: (e) => e.manager ?? "—" },
    { key: "joined", header: "Joined", sort: (e) => e.joinedOn, csv: (e) => e.joinedOn.slice(0, 10), cell: (e) => formatDate(e.joinedOn) },
    ...(pay ? [{ key: "basic", header: "Basic pay", align: "right" as const, sort: (e: Employee) => e.basicPaise, csv: (e: Employee) => e.basicPaise / 100, cell: (e: Employee) => (e.basicPaise ? <span className="tabular-nums">{formatPaise(e.basicPaise)}<span className="block text-xs text-muted-foreground">{e.payType === "daily" ? "a day" : "a month"}</span></span> : <span className="text-muted-foreground">Not set</span>) }] : []),
    { key: "status", header: "Status", csv: (e) => EMP_STATUS[e.status]?.label ?? e.status, cell: (e) => <Pill color={EMP_STATUS[e.status]?.color} dot>{EMP_STATUS[e.status]?.label}</Pill> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (e) => (
        <span className="flex items-center gap-0.5" onClick={(ev) => ev.stopPropagation()}>
          {can("hr.employee.edit") && <Link href={`/app/m/hr/employees/${e.id}/edit`} title="Edit" aria-label={`Edit ${e.name}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}><Pencil /></Link>}
          <ActionMenu label={`More actions for ${e.name}`} items={[
            { label: "Open profile", icon: Eye, href: `/app/m/hr/employees/${e.id}` },
            can("hr.payroll.create") && e.status !== "exited" && { label: "Salary structure", icon: IndianRupee, href: `/app/m/hr/employees/${e.id}?tab=salary` },
            "-",
            can("hr.employee.edit") && (e.status === "exited" ? { label: "Mark as rejoined", icon: RotateCcw, onClick: () => void rejoin(e) } : { label: "Mark as leaving", icon: LogOut, onClick: () => setExiting(e) }),
            can("hr.employee.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(e) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("hr.employee.create") ? <Link href="/app/m/hr/employees/new" className={buttonVariants({ className: "h-10 rounded-xl px-4 font-semibold" })}><Plus /> Add employee</Link> : undefined
  const initial = Object.fromEntries(["departmentId", "designationId"].map((k) => [k, search.get(k)]).filter(([, v]) => v)) as Record<string, string>

  const cards = (c: Record<string, number>) => {
    const total = c.current ?? 0
    return (
      <SummaryCards items={[
        { label: "Total employees", value: total, hint: `${c.on_notice ?? 0} on notice · ${c.exited ?? 0} left`, color: "blue", icon: Users },
        { label: "Full time", value: c.full_time ?? 0, hint: share(c.full_time ?? 0, total), color: "emerald", icon: Briefcase },
        { label: "Part time", value: c.part_time ?? 0, hint: share(c.part_time ?? 0, total), color: "violet", icon: Clock },
        { label: "Contract & temporary", value: c.contract ?? 0, hint: share(c.contract ?? 0, total), color: "amber", icon: FileSignature },
        { label: "Interns", value: c.intern ?? 0, hint: share(c.intern ?? 0, total), color: "rose", icon: GraduationCap },
      ]} />
    )
  }
  return (
    <>
      <DataList<Employee>
        id="hr-employees"
        path="/hr/employees"
        params={{ v: String(version) }}
        header={{ title: "Employees", description: "Your team: who they are, where they work and how they are paid.", primary: add, more: [{ label: "Departments and designations", href: "/app/m/hr/setup" }] }}
        columns={columns}
        searchPlaceholder="Search name, ID, mobile or email"
        presetLabel="Show"
        presets={PRESETS}
        tabs
        top={(r) => cards((r.counts ?? {}) as Record<string, number>)}
        filters={[
          { key: "departmentId", label: "Department", options: (look.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name })) },
          { key: "designationId", label: "Designation", options: (look.data?.designations ?? []).map((d) => ({ value: d.id, label: d.name })) },
        ]}
        defaultFilters={initial}
        rowHref={(e) => `/app/m/hr/employees/${e.id}`}
        exportName="employees"
        emptyState={<EmptyState icon={Users} title="No employees here" description="Add your team to mark attendance, approve leave and run payroll." action={add} />}
      />
      {exiting && <ExitDialog employee={exiting} onClose={() => setExiting(null)} onSaved={() => { setExiting(null); reload() }} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title={`Delete ${deleting?.name}?`}
        description="Their attendance and leave go too. Someone with payslips cannot be deleted: mark them as leaving instead."
        confirmLabel="Delete employee"
        onConfirm={async () => {
          try {
            await api.delete(`/hr/employees/${deleting!.id}`)
            toast.success("Employee deleted")
            reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
