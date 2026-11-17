"use client"

import * as React from "react"
import { toast } from "sonner"
import { Clock, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { OvertimeDialog, type OT } from "@/components/hr/payroll-dialogs"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"

// Overtime: extra hours, paid in that month's payroll. The rate starts at twice the ordinary
// hourly rate (Factories Act s.59), worked out from monthly pay ÷ 26 days ÷ 8 hours.




const PRESETS: ViewPreset[] = [{ key: "open", label: "Not paid yet", params: { show: "open" } }, { key: "paid", label: "On a payslip", params: { show: "paid" } }, { key: "all", label: "All", params: {} }]

export default function OvertimePage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<OT | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<OT | null>(null)
  if (!can("hr.payroll.view")) return <PageHeader title="Overtime" description="You don't have access to payroll. Ask your admin." />
  const reload = () => setVersion((v) => v + 1)
  const columns: Column<OT>[] = [
    { key: "employee", header: "Employee", hideable: false, sort: (o) => o.employee, csv: (o) => o.employee, cell: (o) => <span className="flex items-center gap-2.5"><Avatar name={o.employee} className="size-8" /><span><span className="block font-medium">{o.employee}</span><span className="font-mono text-xs text-muted-foreground">{o.employeeCode}</span></span></span> },
    { key: "date", header: "Date", sort: (o) => o.workOn, csv: (o) => o.workOn.slice(0, 10), cell: (o) => formatDate(o.workOn) },
    { key: "hours", header: "Hours", align: "right", csv: (o) => o.hours, cell: (o) => <span className="tabular-nums">{o.hours} h</span> },
    { key: "rate", header: "Rate", align: "right", csv: (o) => o.ratePaise / 100, cell: (o) => <span className="tabular-nums">{formatPaise(o.ratePaise)}/h</span> },
    { key: "amount", header: "Amount", align: "right", sort: (o) => o.amountPaise, csv: (o) => o.amountPaise / 100, cell: (o) => <span className="font-semibold tabular-nums">{formatPaise(o.amountPaise)}</span> },
    { key: "notes", header: "Note", csv: (o) => o.notes ?? "", cell: (o) => <span className="text-muted-foreground">{o.notes ?? "—"}</span> },
    { key: "status", header: "Status", csv: (o) => (o.payslipId ? "On payslip" : "Not paid"), cell: (o) => (o.payslipId ? <Pill color="emerald" dot>On payslip</Pill> : <Pill color="amber" dot>Next payroll</Pill>) },
    { key: "actions", header: "Actions", hideable: false, cell: (o) => can("hr.payroll.create") && !o.payslipId ? <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon-sm" title="Edit" aria-label="Edit overtime" onClick={() => setEditing(o)}><Pencil /></Button><ActionMenu label="More actions" items={[{ label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(o) }]} /></span> : null },
  ]
  const add = can("hr.payroll.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Add overtime</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.payroll} active="overtime" />
      <DataList<OT>
        id="hr-overtime"
        load={localList(async (p) => (await api.get<{ data: OT[] }>("/hr/overtime")).data.filter((o) => p.show === "open" ? !o.payslipId : p.show === "paid" ? !!o.payslipId : true), (o, q) => `${o.employee} ${o.employeeCode} ${o.notes ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Overtime", description: "Extra hours, paid in the payroll of the month they were worked.", primary: add }}
        summary={(r) => { const rows = (r.data as OT[] | undefined) ?? []; return <span className="text-sm text-muted-foreground">On this page <strong className="text-foreground tabular-nums">{rows.reduce((s, o) => s + o.hours, 0)} h · {formatPaise(rows.reduce((s, o) => s + o.amountPaise, 0))}</strong></span> }}
        columns={columns}
        searchPlaceholder="Search employee or note"
        presetLabel="Show"
        presets={PRESETS}
        rowClick={(o) => can("hr.payroll.create") && !o.payslipId && setEditing(o)}
        exportName="overtime"
        emptyState={<EmptyState icon={Clock} title="No overtime here" action={add} />}
      />
      {editing && <OvertimeDialog ot={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title="Delete this overtime?" confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/overtime/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
