"use client"

import * as React from "react"
import { toast } from "sonner"
import { CheckCircle2, HandCoins, Plus, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { LoanDialog, type Loan } from "@/components/hr/payroll-dialogs"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { monthLabel } from "@/lib/hr"

// Loans and salary advances, taken back in monthly instalments through payroll.




const PRESETS: ViewPreset[] = [{ key: "active", label: "Being repaid", params: { status: "active" } }, { key: "closed", label: "Repaid / closed", params: { status: "closed" } }, { key: "all", label: "All", params: {} }]

export default function LoansPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [adding, setAdding] = React.useState(false)
  const [deleting, setDeleting] = React.useState<Loan | null>(null)
  if (!can("hr.payroll.view")) return <PageHeader title="Loans & advances" description="You don't have access to payroll. Ask your admin." />
  const reload = () => setVersion((v) => v + 1)
  async function status(l: Loan, s: "active" | "closed") {
    try { await api.post(`/hr/loans/${l.id}/status`, { status: s }); toast.success(s === "closed" ? "Closed: no more instalments" : "Instalments start again"); reload() } catch (e) { toast.error(errorMessage(e)) }
  }
  const columns: Column<Loan>[] = [
    { key: "employee", header: "Employee", hideable: false, sort: (l) => l.employee, csv: (l) => l.employee, cell: (l) => <span className="flex items-center gap-2.5"><Avatar name={l.employee} className="size-8" /><span><span className="block font-medium">{l.employee}</span><span className="text-xs text-muted-foreground">{l.title}</span></span></span> },
    { key: "kind", header: "Loan type", csv: (l) => l.kind, cell: (l) => <Pill color={l.kind.toLowerCase().includes("advance") ? "blue" : "violet"}>{l.kind.charAt(0).toUpperCase() + l.kind.slice(1)}</Pill> },
    { key: "given", header: "Given", sort: (l) => l.givenOn, csv: (l) => l.givenOn.slice(0, 10), cell: (l) => formatDate(l.givenOn) },
    { key: "amount", header: "Amount", align: "right", csv: (l) => l.amountPaise / 100, cell: (l) => <span className="tabular-nums">{formatPaise(l.amountPaise)}</span> },
    { key: "emi", header: "Instalment", align: "right", csv: (l) => l.emiPaise / 100, cell: (l) => <span className="tabular-nums">{formatPaise(l.emiPaise)}<span className="block text-xs text-muted-foreground">from {monthLabel(l.startsMonth)}</span></span> },
    { key: "progress", header: "Repaid", csv: (l) => l.recoveredPaise / 100, cell: (l) => { const pct = Math.round((l.recoveredPaise / l.amountPaise) * 100); return <span className="grid w-36 gap-1"><span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></span><span className="text-xs text-muted-foreground tabular-nums">{formatPaise(l.recoveredPaise)} · {pct}%</span></span> } },
    { key: "left", header: "Left", align: "right", sort: (l) => l.leftPaise, csv: (l) => l.leftPaise / 100, cell: (l) => <span className="font-semibold tabular-nums">{formatPaise(l.leftPaise)}</span> },
    { key: "status", header: "Status", csv: (l) => l.status, cell: (l) => <Pill color={l.status === "active" ? "amber" : "emerald"} dot>{l.status === "active" ? "Being repaid" : l.leftPaise > 0 ? "Closed" : "Repaid"}</Pill> },
    { key: "actions", header: "Actions", hideable: false, cell: (l) => can("hr.payroll.create") ? <span onClick={(e) => e.stopPropagation()}><ActionMenu label={`More actions for ${l.title}`} items={[
      l.status === "active" ? { label: "Close (stop instalments)", icon: CheckCircle2, onClick: () => void status(l, "closed") } : l.leftPaise > 0 && { label: "Start instalments again", icon: RotateCcw, onClick: () => void status(l, "active") },
      "-",
      l.recoveredPaise === 0 && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(l) },
    ]} /></span> : null },
  ]
  const add = can("hr.payroll.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setAdding(true)}><Plus /> Loan or advance</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.payroll} active="loans" />
      <DataList<Loan>
        id="hr-loans"
        load={localList(async (p) => (await api.get<{ data: Loan[] }>("/hr/loans")).data.filter((l) => !p.status || l.status === p.status), (l, q) => `${l.employee} ${l.employeeCode} ${l.title}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Loans & advances", description: "Money given to staff ahead of salary. Payroll takes an instalment each month until it is repaid.", primary: add }}
        summary={(r) => { const rows = (r.data as Loan[] | undefined) ?? []; return <span className="text-sm text-muted-foreground">Still to recover on this page <strong className="text-foreground tabular-nums">{formatPaise(rows.reduce((s, l) => s + (l.status === "active" ? l.leftPaise : 0), 0))}</strong></span> }}
        columns={columns}
        searchPlaceholder="Search employee"
        presetLabel="Show"
        presets={PRESETS}
        exportName="loans"
        emptyState={<EmptyState icon={HandCoins} title="No loans or advances" description="Give a salary advance here; it comes back through payroll." action={add} />}
      />
      {adding && <LoanDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting?.title}?`} description="Its entry in the books is removed too." confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/loans/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
