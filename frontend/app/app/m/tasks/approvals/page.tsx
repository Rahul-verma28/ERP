"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { AlarmClock, Check, Eye, Hourglass, IndianRupee, Paperclip, Plus, ShieldCheck, Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, remoteList, type Column, type ViewPreset } from "@/components/data-list"
import { Avatar, Pill } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { RecordView } from "@/components/record-view"
import { ApprovalDialog, DecideDialog } from "@/components/tasks/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatDateTime, formatPaise } from "@/lib/format"
import { APPROVAL_KIND, APPROVAL_STATUS, type Approval } from "@/lib/tasks"

// Approvals: someone asks, a named person approves or rejects with a note. Waiting for me first.

function ApprovalsPage() {
  const { can } = useAuth()
  const params = useSearchParams()
  const [version, setVersion] = React.useState(0)
  const [asking, setAsking] = React.useState(false)
  const [deciding, setDeciding] = React.useState<{ request: Approval; decision: "approved" | "rejected" } | null>(null)
  const [viewing, setViewing] = React.useState<Approval | null>(null)
  const [withdrawing, setWithdrawing] = React.useState<Approval | null>(null)
  if (!can("tasks.approval.view")) return <PageHeader title="Approvals" description="Approvals are part of the full Tasks plan, or your role can't see them. Ask your admin." />
  const reload = () => setVersion((v) => v + 1)
  const canDecide = (a: Approval) => a.forMe && a.status === "pending" && can("tasks.approval.approve")

  const columns: Column<Approval>[] = [
    { key: "number", header: "Request", hideable: false, sort: (a) => a.number, csv: (a) => a.number, cell: (a) => <span className="grid gap-0.5"><span className="font-mono text-xs font-medium text-primary">{a.number}</span><span className="text-[11px] text-muted-foreground">{formatDate(a.createdAt)}</span></span> },
    { key: "title", header: "What", csv: (a) => a.title, cell: (a) => <span className="grid max-w-80 gap-0.5"><span className="font-medium">{a.title}</span><span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><Pill color="slate">{APPROVAL_KIND[a.kind]}</Pill>{a.task && <Link href={`/app/m/tasks/${a.task.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{a.task.title}</Link>}{a.project && <span>{a.project.name}</span>}{a.attachmentUrl && <Paperclip className="size-3" aria-label="Has a bill or quote" />}</span></span> },
    { key: "amount", header: "Amount", align: "right", sort: (a) => a.amountPaise ?? 0, csv: (a) => (a.amountPaise ?? 0) / 100, cell: (a) => (a.amountPaise ? <span className="font-semibold tabular-nums">{formatPaise(a.amountPaise)}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "from", header: "Asked by", csv: (a) => a.requestedByName, cell: (a) => <span className="flex items-center gap-2"><Avatar name={a.requestedByName} className="size-7 text-[10px]" /><span className="text-sm">{a.mine ? "You" : a.requestedByName}</span></span> },
    { key: "to", header: "Approver", csv: (a) => a.approverName, cell: (a) => <span className="text-sm">{a.forMe ? "You" : a.approverName}</span> },
    { key: "need", header: "Needed by", sort: (a) => a.needBy ?? "9999", csv: (a) => a.needBy?.slice(0, 10) ?? "", cell: (a) => (a.needBy ? <span className={a.late ? "text-destructive" : ""}>{formatDate(a.needBy)}{a.late && <span className="block text-xs font-medium">Late</span>}</span> : "—") },
    { key: "status", header: "Status", csv: (a) => APPROVAL_STATUS[a.status].label, cell: (a) => <span className="grid gap-0.5"><Pill color={APPROVAL_STATUS[a.status].color} dot>{APPROVAL_STATUS[a.status].label}</Pill>{a.status === "pending" ? <span className="text-[11px] text-muted-foreground">{a.waitingDays ? `${a.waitingDays} day${a.waitingDays === 1 ? "" : "s"} waiting` : "Today"}</span> : a.decidedAt && <span className="text-[11px] text-muted-foreground">{formatDate(a.decidedAt)}</span>}</span> },
    { key: "note", header: "Decision note", defaultHidden: true, csv: (a) => a.decisionNote ?? "", cell: (a) => <span className="block max-w-56 truncate text-sm text-muted-foreground">{a.decisionNote ?? "—"}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (a) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {canDecide(a) && <Button variant="ghost" size="icon-sm" className="text-emerald-700 dark:text-emerald-300" title="Approve" aria-label={`Approve ${a.number}`} onClick={() => setDeciding({ request: a, decision: "approved" })}><Check /></Button>}
          {canDecide(a) && <Button variant="ghost" size="icon-sm" className="text-destructive" title="Reject" aria-label={`Reject ${a.number}`} onClick={() => setDeciding({ request: a, decision: "rejected" })}><X /></Button>}
          <Button variant="ghost" size="icon-sm" title="View" aria-label={`View ${a.number}`} onClick={() => setViewing(a)}><Eye /></Button>
          {a.mine && a.status === "pending" && <Button variant="ghost" size="icon-sm" title="Withdraw" aria-label={`Withdraw ${a.number}`} onClick={() => setWithdrawing(a)}><Undo2 /></Button>}
        </span>
      ),
    },
  ]
  const presets: ViewPreset[] = [
    { key: "waiting", label: "Waiting for me", params: { view: "waiting" }, countKey: "waiting" },
    { key: "mine", label: "My requests", params: { view: "mine" }, countKey: "mine" },
    { key: "pending", label: "All waiting", params: { view: "pending" }, countKey: "pending" },
    { key: "approved", label: "Approved", params: { view: "approved" }, countKey: "approved" },
    { key: "rejected", label: "Rejected", params: { view: "rejected" }, countKey: "rejected" },
    { key: "all", label: "All", params: { view: "all" }, countKey: "all" },
  ]
  const add = can("tasks.approval.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setAsking(true)}><Plus /> Ask for approval</Button> : undefined
  const v = viewing

  return (
    <>
      <DataList<Approval>
        id="approvals"
        load={remoteList((p) => api.get<{ data: Approval[] } & Record<string, unknown>>(`/approvals?view=${p.view ?? "waiting"}`), (a, q) => `${a.number} ${a.title} ${a.details ?? ""} ${a.requestedByName} ${a.approverName}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Approvals", description: "Spends, purchases, discounts and more, approved by a named person with a note. Nothing is lost in chat.", primary: add }}
        columns={columns}
        searchPlaceholder="Search number, what, or person"
        presets={presets}
        presetLabel="Show"
        defaultPreset={params.get("view") ?? undefined}
        tabs
        top={(res) => {
          const c = (res.counts ?? {}) as Record<string, number>
          const s = (res.sums ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Waiting for you", value: c.waiting ?? 0, hint: `${c.pending ?? 0} waiting in all`, color: "amber", icon: Hourglass },
            { label: "Amount waiting", value: formatPaise(s.pendingPaise ?? 0), hint: "Not yet decided", color: "blue", icon: IndianRupee },
            { label: "Approved this month", value: formatPaise(s.approvedMonthPaise ?? 0), hint: `${c.approved ?? 0} approved in all`, color: "emerald", icon: ShieldCheck },
            { label: "Late", value: s.late ?? 0, hint: "Past the date needed", color: "rose", icon: AlarmClock },
            { label: "Usual wait", value: s.avgHours ? (s.avgHours >= 24 ? `${Math.round(s.avgHours / 24)} days` : `${s.avgHours} hours`) : "—", hint: "From asking to a decision", color: "violet", icon: Hourglass },
          ]} />
        }}
        rowClick={(a) => setViewing(a)}
        exportName="approvals"
        emptyState={<EmptyState icon={ShieldCheck} title="Nothing here" description="Ask for approval before spending or giving a discount. The approver is told and decides with a note." action={add} />}
      />
      {v && (
        <RecordView title={`${v.number} · ${v.title}`} icon={ShieldCheck} onClose={() => setViewing(null)} status={<Pill color={APPROVAL_STATUS[v.status].color} dot>{APPROVAL_STATUS[v.status].label}</Pill>}
          fields={[
            { label: "Type", value: APPROVAL_KIND[v.kind] },
            { label: "Amount", value: v.amountPaise ? formatPaise(v.amountPaise) : null },
            { label: "Asked by", person: { name: v.requestedByName, sub: formatDateTime(v.createdAt) }, value: v.requestedByName },
            { label: "Approver", person: { name: v.approverName, sub: v.decidedAt ? `Decided ${formatDateTime(v.decidedAt)}` : "Not decided yet" }, value: v.approverName },
            { label: "Needed by", value: v.needBy ? formatDate(v.needBy) : null, tone: v.late ? "danger" : undefined },
            { label: "For", value: v.task?.title ?? v.project?.name ?? null },
            { label: "Why", full: true, value: v.details },
            !!v.attachmentUrl && { label: "Bill or quote", href: v.attachmentUrl, value: null },
            !!v.decisionNote && { label: "Decision note", full: true, value: v.decisionNote, tone: v.status === "rejected" ? "danger" : "success" },
          ]}
          footer={<>
            {canDecide(v) && <Button variant="outline" className="text-destructive" onClick={() => { setDeciding({ request: v, decision: "rejected" }); setViewing(null) }}><X /> Reject</Button>}
            {canDecide(v) && <Button onClick={() => { setDeciding({ request: v, decision: "approved" }); setViewing(null) }}><Check /> Approve</Button>}
            {v.task && <Link href={`/app/m/tasks/${v.task.id}`} className="text-sm font-medium text-primary hover:underline">Open the task</Link>}
          </>}
        />
      )}
      {asking && <ApprovalDialog onClose={() => setAsking(false)} onSaved={() => { setAsking(false); reload() }} />}
      {deciding && <DecideDialog request={deciding.request} decision={deciding.decision} onClose={() => setDeciding(null)} onSaved={() => { setDeciding(null); reload() }} />}
      <ConfirmDialog open={!!withdrawing} onOpenChange={(o) => !o && setWithdrawing(null)} title={`Withdraw ${withdrawing?.number}?`} description="The approver no longer needs to decide it. It stays on record as withdrawn." confirmLabel="Withdraw"
        onConfirm={async () => { try { await api.post(`/approvals/${withdrawing!.id}/withdraw`); toast.success("Withdrawn"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}

export default function Page() {
  return <React.Suspense><ApprovalsPage /></React.Suspense>
}
