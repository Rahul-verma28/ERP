"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Ban, CalendarDays, CheckCircle2, Eye, Pencil, Plus, Trash2, UserRound, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, periodFilter, type Column, type ViewPreset } from "@/components/data-list"
import { PageLoading } from "@/components/page-states"
import { ActionMenu, Pill } from "@/components/page-parts"
import { PersonCell, RecordView } from "@/components/hr/record-view"
import { LeaveWeek } from "@/components/hr/leave-week"
import { tone } from "@/lib/tones"
import { cn } from "@/lib/utils"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { DecideDialog, LeaveDialog } from "@/components/hr/leave-dialogs"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { LEAVE_STATUS, useCurrentEmployees, useHrLookups, type LeaveApp } from "@/lib/hr"

// Leave applications: waiting ones first, approve or reject in one click.

const PRESETS: ViewPreset[] = [
  { key: "pending", label: "Waiting", params: { status: "pending" }, countKey: "pending" },
  { key: "approved", label: "Approved", params: { status: "approved" }, countKey: "approved" },
  { key: "rejected", label: "Rejected", params: { status: "rejected" }, countKey: "rejected" },
  { key: "cancelled", label: "Cancelled", params: { status: "cancelled" }, countKey: "cancelled" },
  { key: "all", label: "All", params: {}, countKey: "all" },
]

export default function LeavePage() {
  return <React.Suspense fallback={<PageLoading />}><Leave /></React.Suspense>
}

function Leave() {
  const search = useSearchParams()
  const { can, me } = useAuth()
  const look = useHrLookups()
  const emps = useCurrentEmployees()
  const [version, setVersion] = React.useState(0)
  const [counts, setCounts] = React.useState<Record<string, number>>({})
  const [editing, setEditing] = React.useState<LeaveApp | "new" | null>(search.get("apply") ? "new" : null)
  const [deciding, setDeciding] = React.useState<{ leave: LeaveApp; status: "approved" | "rejected" } | null>(null)
  const [cancelling, setCancelling] = React.useState<LeaveApp | null>(null)
  const [viewing, setViewing] = React.useState<LeaveApp | null>(null)
  const rowsRef = React.useRef<LeaveApp[]>([])
  if (!can("hr.leave.view")) return <PageHeader title="Leave" description="You don't have access to leave. Ask your admin." />
  const reload = () => setVersion((v) => v + 1)
  const approve = can("hr.leave.approve")

  async function remove(l: LeaveApp) {
    try {
      await api.delete(`/hr/leaves/${l.id}`)
      toast.success("Leave request deleted")
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const columns: Column<LeaveApp>[] = [
    { key: "employee", header: "Employee", hideable: false, sort: (l) => l.employee, csv: (l) => l.employee, cell: (l) => <PersonCell name={l.employee} sub={l.employeeSub ?? l.employeeCode} /> },
    { key: "code", header: "Employee ID", defaultHidden: true, csv: (l) => l.employeeCode, cell: (l) => <span className="font-mono text-xs">{l.employeeCode}</span> },
    { key: "type", header: "Leave type", csv: (l) => l.leaveType, cell: (l) => <span className="flex items-center gap-2"><span className={cn("size-2.5 shrink-0 rounded-full", tone(l.color).dot)} /><span className="grid gap-0.5"><span className="font-medium">{l.leaveType}</span><Pill color={l.paid ? "emerald" : "rose"} className="w-fit">{l.paid ? "Paid" : "Unpaid"}</Pill></span></span> },
    { key: "from", header: "Start date", sort: (l) => l.fromDate, csv: (l) => l.fromDate.slice(0, 10), cell: (l) => <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5 text-muted-foreground" />{formatDate(l.fromDate)}</span> },
    { key: "to", header: "End date", sort: (l) => l.toDate, csv: (l) => l.toDate.slice(0, 10), cell: (l) => <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5 text-muted-foreground" />{formatDate(l.toDate)}{l.halfDay && <Pill color="amber" className="ml-1">Half</Pill>}</span> },
    { key: "days", header: "Days", align: "right", sort: (l) => l.days, csv: (l) => l.days, cell: (l) => <span className="font-semibold tabular-nums">{l.days}</span> },
    { key: "reason", header: "Reason", csv: (l) => l.reason, cell: (l) => <span className="block max-w-64 truncate text-muted-foreground" title={l.reason}>{l.reason}{l.comment && <span className="block truncate text-xs">↳ {l.comment}</span>}</span> },
    { key: "applied", header: "Applied on", sort: (l) => l.createdAt, csv: (l) => l.createdAt.slice(0, 10), cell: (l) => formatDate(l.createdAt) },
    { key: "decided", header: "Decided by", csv: (l) => l.decidedByName ?? "", cell: (l) => (l.decidedByName ? <span className="text-sm">{l.decidedByName}{l.decidedAt && <span className="block text-xs text-muted-foreground">{formatDate(l.decidedAt)}</span>}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "status", header: "Status", csv: (l) => LEAVE_STATUS[l.status].label, cell: (l) => <Pill color={LEAVE_STATUS[l.status].color} dot>{LEAVE_STATUS[l.status].label}</Pill> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (l) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {approve && l.status === "pending" && <>
            <Button size="icon-sm" variant="ghost" title="Approve" aria-label={`Approve leave of ${l.employee}`} className="text-emerald-600 dark:text-emerald-400" onClick={() => setDeciding({ leave: l, status: "approved" })}><CheckCircle2 /></Button>
            <Button size="icon-sm" variant="ghost" title="Reject" aria-label={`Reject leave of ${l.employee}`} className="text-rose-600 dark:text-rose-400" onClick={() => setDeciding({ leave: l, status: "rejected" })}><XCircle /></Button>
          </>}
          <Button size="icon-sm" variant="ghost" title="View" aria-label={`View leave of ${l.employee}`} onClick={() => setViewing(l)}><Eye /></Button>
          {l.status === "pending" && <Button size="icon-sm" variant="ghost" title="Edit" aria-label={`Edit leave of ${l.employee}`} onClick={() => setEditing(l)}><Pencil /></Button>}
          <ActionMenu label={`More actions for ${l.employee}'s leave`} items={[
            { label: "Open employee", icon: UserRound, href: `/app/m/hr/employees/${l.employeeId}?tab=leave` },
            ["pending", "approved"].includes(l.status) && { label: l.status === "approved" ? "Cancel leave" : "Withdraw request", icon: Ban, onClick: () => setCancelling(l) },
            "-",
            l.status !== "approved" && { label: "Delete", icon: Trash2, destructive: true, onClick: () => void remove(l) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("hr.leave.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> {approve ? "Add leave" : "Apply for leave"}</Button> : undefined

  return (
    <>
      <HrTabs tabs={TABS.leave} active="apps" badge={{ apps: counts.pending }} />
      <div className="mb-4"><LeaveWeek version={version} onOpen={async (id) => { const hit = rowsRef.current.find((x) => x.id === id); if (hit) return setViewing(hit); try { const r = await api.get<{ data: LeaveApp[] }>("/hr/leaves"); const x = r.data.find((l) => l.id === id); if (x) setViewing(x) } catch (e) { toast.error(errorMessage(e)) } }} /></div>
      <DataList<LeaveApp>
        id="hr-leave"
        load={async (args) => {
          const p = args.params
          const qs = new URLSearchParams(Object.entries({ status: p.status, employeeId: p.employeeId, leaveTypeId: p.leaveTypeId, from: p.from, to: p.to }).filter(([, v]) => v) as [string, string][]).toString()
          const r = await api.get<{ data: LeaveApp[]; counts: Record<string, number> }>(`/hr/leaves${qs ? `?${qs}` : ""}`)
          setCounts(r.counts)
          rowsRef.current = r.data
          return { ...(await localList(async () => r.data, (l, q) => `${l.employee} ${l.employeeCode} ${l.reason} ${l.leaveType}`.toLowerCase().includes(q))(args)), counts: r.counts }
        }}
        params={{ v: String(version) }}
        header={{ title: "Leave", description: approve ? "Requests waiting for you are first. Approved leave fills the attendance register on its own." : "Your leave requests and what happened to them.", primary: add }}
        columns={columns}
        searchPlaceholder="Search employee or reason"
        presetLabel="Show"
        presets={PRESETS}
        tabs
        filters={[
          periodFilter(me?.tenant?.fyStartMonth ?? 4, "Dates"),
          ...(approve ? [{ key: "employeeId", label: "Employee", options: (emps.data?.data ?? []).map((e) => ({ value: e.id, label: e.name })) }] : []),
          { key: "leaveTypeId", label: "Leave type", options: (look.data?.leaveTypes ?? []).map((t) => ({ value: t.id, label: t.name })) },
        ]}
        rowClick={(l) => setViewing(l)}
        exportName="leave"
        emptyState={<EmptyState icon={CalendarDays} title="No leave here" description="Leave requests show here. Approved leave marks attendance on its own." action={add} />}
      />
      {editing && <LeaveDialog leave={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {viewing && (
        <RecordView
          title="Leave details"
          icon={CalendarDays}
          status={<Pill color={LEAVE_STATUS[viewing.status].color} dot>{LEAVE_STATUS[viewing.status].label}</Pill>}
          onClose={() => setViewing(null)}
          fields={[
            { label: "Employee", value: null, person: { name: viewing.employee, sub: [viewing.employeeCode, viewing.employeeSub].filter(Boolean).join(" · ") } },
            { label: "Leave type", value: <span className="flex items-center gap-2">{viewing.leaveType}<Pill color={viewing.paid ? "emerald" : "rose"}>{viewing.paid ? "Paid" : "Unpaid"}</Pill></span> },
            { label: "Start date", value: formatDate(viewing.fromDate) },
            { label: "End date", value: formatDate(viewing.toDate) },
            { label: "Total days", value: `${viewing.days} day${viewing.days === 1 ? "" : "s"}${viewing.halfDay ? " (half day)" : ""}` },
            { label: "Applied on", value: formatDate(viewing.createdAt) },
            { label: "Reason", value: viewing.reason, full: true },
            !!viewing.comment && { label: "Approver's note", value: viewing.comment, full: true, tone: viewing.status === "rejected" ? "danger" : undefined },
            { label: "Decided by", value: viewing.decidedByName ? `${viewing.decidedByName}${viewing.decidedAt ? ` · ${formatDate(viewing.decidedAt)}` : ""}` : "Not decided yet" },
          ]}
          footer={<>
            {viewing.status === "pending" && <Button variant="outline" onClick={() => { setEditing(viewing); setViewing(null) }}><Pencil /> Edit</Button>}
            {approve && viewing.status === "pending" && <>
              <Button variant="outline" onClick={() => { setDeciding({ leave: viewing, status: "rejected" }); setViewing(null) }}><XCircle /> Reject</Button>
              <Button onClick={() => { setDeciding({ leave: viewing, status: "approved" }); setViewing(null) }}><CheckCircle2 /> Approve</Button>
            </>}
          </>}
        />
      )}
      {deciding && <DecideDialog leave={deciding.leave} status={deciding.status} onClose={() => setDeciding(null)} onSaved={() => { setDeciding(null); reload() }} />}
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        destructive
        title={cancelling?.status === "approved" ? "Cancel this approved leave?" : "Withdraw this request?"}
        description={cancelling?.status === "approved" ? "The days are taken off the attendance register and go back to the balance." : "It goes back to the balance."}
        confirmLabel={cancelling?.status === "approved" ? "Cancel leave" : "Withdraw"}
        onConfirm={async () => {
          try {
            await api.post(`/hr/leaves/${cancelling!.id}/cancel`, {})
            toast.success("Leave cancelled")
            reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
