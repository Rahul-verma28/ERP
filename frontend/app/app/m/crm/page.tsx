"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { KanbanSquare, List, Pencil, Plus, Settings2, Upload, Users } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/app-shell"
import { EmptyState, Spinner } from "@/components/common"
import { DataList, type Column, type ViewPreset } from "@/components/data-list"
import { Field, FormError, NativeSelect } from "@/components/form"
import { SearchInput } from "@/components/common"
import { ImportDialog } from "@/components/contact-import"
import { Board } from "@/components/crm/board"
import { AssignDialog, Avatar, LabelChips, LeadDialog, LostDialog, StagePill, TaskBar } from "@/components/crm/dialogs"
import { LeadMenu, ReachButtons, useLeadActions } from "@/components/crm/lead-actions"
import { todayInIndia } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { dueLabel, LEAD_STATUS, tone, useCrmSetup, type Lead } from "@/lib/crm"
import { formatDate, formatPaise } from "@/lib/format"
import { useDebounced } from "@/lib/use-list"
import { cn } from "@/lib/utils"

// Leads: people who may buy, moving through the stages of a pipeline. A list with every action on
// each row, or a board to drag them across stages. Won leads become deals or customers.

const VIEW_KEY = "crm-leads-view"

function FollowUp({ date, today }: { date: string | null; today: string }) {
  const d = dueLabel(date, today)
  if (!d) return <span className="text-muted-foreground">—</span>
  return <span className={cn("text-sm", d.late ? "font-medium text-destructive" : d.soon ? "font-medium text-amber-700 dark:text-amber-300" : "")}>{formatDate(date!)}<span className="block text-xs font-normal">{d.text}</span></span>
}

function StageDialog({ count, stages, onClose, onConfirm }: { count: number; stages: { id: string; name: string }[]; onClose: () => void; onConfirm: (stageId: string) => Promise<void> }) {
  const [stage, setStage] = React.useState(stages[0]?.id ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Move {count} lead{count === 1 ? "" : "s"}</DialogTitle></DialogHeader>
        <Field label="To stage" required><NativeSelect value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(stage) } catch (e) { setError(errorMessage(e)); setBusy(false) } }}>{busy ? "Moving…" : "Move"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LabelDialog({ count, onClose, onConfirm }: { count: number; onClose: () => void; onConfirm: (label: string) => Promise<void> }) {
  const labels = useCrmSetup().data?.labels ?? []
  const [label, setLabel] = React.useState(labels[0]?.name ?? "")
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Label {count} lead{count === 1 ? "" : "s"}</DialogTitle></DialogHeader>
        <Field label="Label" required><NativeSelect value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label">{labels.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}</NativeSelect></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !label} onClick={async () => { setBusy(true); await onConfirm(label) }}>Add label</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LeadCard({ lead, actions, today }: { lead: Lead; actions: ReturnType<typeof useLeadActions>; today: string }) {
  const router = useRouter()
  const due = dueLabel(lead.followUpOn, today)
  return (
    <article onClick={() => router.push(`/app/m/crm/${lead.id}`)} className="group grid gap-2 rounded-2xl border bg-card p-3 text-sm shadow-[var(--shadow-card)] transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={lead.name} className="size-8 text-[11px]" />
          <div className="min-w-0"><p className="truncate font-semibold">{lead.name}</p>{lead.companyName && <p className="truncate text-xs text-muted-foreground">{lead.companyName}</p>}</div>
        </div>
        <LeadMenu lead={lead} actions={actions} />
      </div>
      {lead.subject && <p className="line-clamp-2 text-xs text-muted-foreground">{lead.subject}</p>}
      <LabelChips labels={lead.labels} />
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <span className="font-semibold tabular-nums">{lead.valuePaise ? formatPaise(lead.valuePaise) : <span className="font-normal text-muted-foreground">No value</span>}</span>
        {due && <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", due.late ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" : due.soon ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : "bg-muted text-muted-foreground")}>{due.text}</span>}
      </div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-0.5"><ReachButtons lead={lead} actions={actions} size="icon-xs" /></span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">{lead.tasks.total > 0 && <span className="tabular-nums">✓ {lead.tasks.done}/{lead.tasks.total}</span>}{lead.owner && <span title={lead.owner.name} className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-semibold">{lead.owner.name.slice(0, 2).toUpperCase()}</span>}</span>
      </div>
    </article>
  )
}

function LeadBoard({ pipelineId, version, actions, onAdd, today }: { pipelineId: string; version: number; actions: ReturnType<typeof useLeadActions>; onAdd: (stageId: string) => void; today: string }) {
  const { can } = useAuth()
  const setup = useCrmSetup().data
  const [q, setQ] = React.useState("")
  const query = useDebounced(q.trim())
  const [data, setData] = React.useState<Lead[] | null>(null)
  React.useEffect(() => {
    let off = false
    api.get<{ data: Lead[] }>(`/leads/board?pipelineId=${pipelineId}${query ? `&q=${encodeURIComponent(query)}` : ""}`).then((r) => !off && setData(r.data)).catch((e) => toast.error(errorMessage(e)))
    return () => { off = true }
  }, [pipelineId, version, query])
  const stages = setup?.pipelines.find((p) => p.id === pipelineId)?.leadStages ?? []
  const total = (data ?? []).reduce((s, l) => s + (l.valuePaise ?? 0), 0)
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-full max-w-xs"><SearchInput value={q} onChange={setQ} placeholder="Search name, company, need" /></div>
        <p className="text-sm text-muted-foreground">{data?.length ?? 0} open leads · <strong className="text-foreground tabular-nums">{formatPaise(total)}</strong> expected</p>
      </div>
      {!data ? <div className="grid place-items-center py-24"><Spinner /></div> : (
        <Board<Lead>
          stages={stages}
          items={data}
          value={(l) => l.valuePaise ?? 0}
          canMove={can("crm.lead.edit")}
          onMove={(l, stageId) => actions.moveTo(l, stageId)}
          onAdd={can("crm.lead.create") ? onAdd : undefined}
          empty="No leads here. Drag one in, or press +"
          card={(l) => <LeadCard lead={l} actions={actions} today={today} />}
        />
      )}
    </div>
  )
}

export default function LeadsPage() {
  const router = useRouter()
  const { can, me, term } = useAuth()
  const setup = useCrmSetup().data
  const today = todayInIndia()
  const [version, setVersion] = React.useState(0)
  const reload = () => setVersion((v) => v + 1)
  const [view, setView] = React.useState<"list" | "board">(() => { try { return (localStorage.getItem(VIEW_KEY) as "list" | "board") || "list" } catch { return "list" } })
  const [pipelineId, setPipelineId] = React.useState("")
  const [dialog, setDialog] = React.useState<{ kind: "new"; stageId?: string } | { kind: "import" } | null>(null)
  const [bulk, setBulk] = React.useState<{ kind: "assign" | "stage" | "label" | "lost" | "delete"; rows: Lead[] } | null>(null)
  const actions = useLeadActions((l) => { reload(); if (l === null) return })
  const leads = term("entity.lead.plural", "Leads")

  const pipeline = setup?.pipelines.find((p) => p.id === pipelineId) ?? setup?.pipelines.find((p) => p.isDefault) ?? setup?.pipelines[0]
  const stages = pipeline?.leadStages ?? []
  const switchView = (v: "list" | "board") => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private window */ } }

  if (!can("crm.lead.view")) return <PageHeader title={leads} description="You don't have access to leads. Ask your admin." />
  if (!setup || !pipeline) return <div className="grid place-items-center py-24"><Spinner /></div>

  async function runBulk(body: Record<string, unknown>, done: string) {
    const r = await api.post<{ done: number; skipped: number }>("/leads/bulk", { ids: bulk!.rows.map((x) => x.id), action: bulk!.kind, ...body })
    toast.success(`${done}: ${r.done}${r.skipped ? ` · ${r.skipped} skipped` : ""}`)
    setBulk(null)
    reload()
  }

  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })
  const columns: Column<Lead>[] = [
    {
      key: "name", header: "Lead", hideable: false, sort: (l) => l.name.toLowerCase(), csv: (l) => l.name,
      cell: (l) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={l.name} />
          <span className="min-w-0"><span className="block font-medium">{l.name}</span><span className="block text-xs text-muted-foreground">{l.companyName ?? l.phone ?? l.email ?? ""}</span></span>
        </span>
      ),
    },
    { key: "subject", header: "Looking for", csv: (l) => l.subject, cell: (l) => <span className="grid max-w-64 gap-1"><span className="truncate">{l.subject ?? "—"}</span><LabelChips labels={l.labels} /></span> },
    {
      key: "stage", header: "Stage", sort: (l) => l.stage?.position ?? 99, csv: (l) => l.stage?.name ?? "",
      cell: (l) => (l.leadStatus && LEAD_STATUS[l.leadStatus] ? <span className={cn("inline-flex h-[22px] items-center rounded-full px-2 text-xs font-semibold", tone(LEAD_STATUS[l.leadStatus].tone).pill)}>{LEAD_STATUS[l.leadStatus].label}{l.lostReason ? ` · ${l.lostReason}` : ""}</span> : <StagePill stage={l.stage} />),
    },
    { key: "value", header: "Value", align: "right", sort: (l) => l.valuePaise ?? 0, csv: (l) => ((l.valuePaise ?? 0) / 100).toFixed(2), cell: (l) => <span className="font-medium tabular-nums">{l.valuePaise ? formatPaise(l.valuePaise) : "—"}</span> },
    { key: "followup", header: "Follow up", sort: (l) => l.followUpOn ?? "9999", csv: (l) => l.followUpOn?.slice(0, 10) ?? "", cell: (l) => <FollowUp date={l.followUpOn} today={today} /> },
    { key: "tasks", header: "Tasks", csv: (l) => `${l.tasks.done}/${l.tasks.total}`, cell: (l) => <TaskBar tasks={l.tasks} /> },
    { key: "owner", header: "Assigned to", csv: (l) => l.owner?.name ?? "", cell: (l) => (l.owner ? <span className="text-sm">{l.owner.name}</span> : <span className="text-muted-foreground">Unassigned</span>) },
    { key: "source", header: "Source", defaultHidden: true, csv: (l) => l.leadSource ?? "", cell: (l) => l.leadSource ?? "—" },
    { key: "phone", header: "Mobile", defaultHidden: true, csv: (l) => l.phone ?? "", cell: (l) => <span className="tabular-nums">{l.phone ?? "—"}</span> },
    { key: "added", header: "Added", defaultHidden: true, sort: (l) => l.createdAt, csv: (l) => l.createdAt.slice(0, 10), cell: (l) => formatDate(l.createdAt) },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (l) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <ReachButtons lead={l} actions={actions} />
          {can("crm.activity.create") && <button type="button" className={icon} title="Log note or call" aria-label={`Log activity for ${l.name}`} onClick={() => actions.act("activity", l)}><Pencil /></button>}
          <LeadMenu lead={l} actions={actions} />
        </span>
      ),
    },
  ]

  const presets: ViewPreset[] = [
    { key: "open", label: "Open", params: { status: "open" } },
    { key: "mine", label: "My leads", params: { status: "open", ownerId: me?.user?.id ?? "" } },
    { key: "today", label: "Follow up today", params: { status: "open", followUp: "today" } },
    { key: "overdue", label: "Follow-up missed", params: { status: "open", followUp: "overdue" } },
    { key: "nofollow", label: "No follow-up", params: { status: "open", followUp: "none" } },
    { key: "converted", label: "Converted", params: { status: "converted" } },
    { key: "lost", label: "Lost", params: { status: "lost" } },
  ]
  const add = can("crm.lead.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setDialog({ kind: "new" })}><Plus /> New lead</Button> : undefined
  const toolbar = (
    <>
      {setup.pipelines.length > 1 && (
        <div className="w-44"><NativeSelect value={pipeline.id} onChange={(e) => setPipelineId(e.target.value)} aria-label="Pipeline">{setup.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></div>
      )}
      <div className="flex rounded-xl border bg-card p-1" role="radiogroup" aria-label="View">
        <button type="button" role="radio" aria-checked={view === "list"} onClick={() => switchView("list")} className={cn("grid size-8 place-items-center rounded-[10px] text-muted-foreground [&_svg]:size-4", view === "list" && "bg-primary text-primary-foreground")} title="List"><List /></button>
        <button type="button" role="radio" aria-checked={view === "board"} onClick={() => switchView("board")} className={cn("grid size-8 place-items-center rounded-[10px] text-muted-foreground [&_svg]:size-4", view === "board" && "bg-primary text-primary-foreground")} title="Board"><KanbanSquare /></button>
      </div>
      {can("crm.lead.create") && <Button variant="outline" className="h-10 rounded-xl" onClick={() => setDialog({ kind: "import" })}><Upload /> Import</Button>}
    </>
  )
  const more = [
    ...(can("crm.deal.view") ? [{ label: "Deals", href: "/app/m/crm/deals" }] : []),
    { label: "Tasks and follow-ups", href: "/app/m/crm/follow-ups" },
    { label: "CRM reports", href: "/app/m/crm/reports" },
    ...(can("crm.pipeline.edit") ? [{ label: "Pipelines, stages and sources", href: "/app/m/crm/setup" }] : []),
  ]

  return (
    <>
      {view === "board" ? (
        <div className="grid gap-4">
          <PageHeader title={leads} description={`${pipeline.name} pipeline. Drag a card to move it to the next stage.`} actions={<div className="flex flex-wrap items-center gap-2">{toolbar}{can("crm.pipeline.edit") && <Link href="/app/m/crm/setup" className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-xl")}><Settings2 /> Stages</Link>}{add}</div>} />
          <LeadBoard pipelineId={pipeline.id} version={version} actions={actions} today={today} onAdd={(stageId) => setDialog({ kind: "new", stageId })} />
        </div>
      ) : (
        <DataList<Lead>
          id="crm-leads"
          path="/leads"
          params={{ v: String(version), pipelineId: pipeline.id }}
          header={{ title: leads, description: "People who may buy. Move them through the stages; convert to a deal or customer when they are ready.", actions: toolbar, primary: add, more }}
          columns={columns}
          searchPlaceholder="Search name, company, mobile, email"
          presets={presets}
          presetLabel="Show"
          filters={[
            { key: "stageId", label: "Stage", options: stages.map((s) => ({ value: s.id, label: s.name })) },
            { key: "source", label: "Source", options: setup.sources.map((s) => ({ value: s.name, label: s.name })) },
            { key: "label", label: "Label", options: setup.labels.map((s) => ({ value: s.name, label: s.name })) },
            { key: "followUp", label: "Follow up", options: [{ value: "today", label: "Today" }, { value: "week", label: "Next 7 days" }, { value: "overdue", label: "Missed" }, { value: "none", label: "Not set" }] },
          ]}
          rowHref={(l) => `/app/m/crm/${l.id}`}
          bulkActions={can("crm.lead.edit") ? [
            { label: "Assign", run: (rows) => setBulk({ kind: "assign", rows }) },
            { label: "Move stage", run: (rows) => setBulk({ kind: "stage", rows }) },
            { label: "Add label", run: (rows) => setBulk({ kind: "label", rows }) },
            { label: "Mark lost", run: (rows) => setBulk({ kind: "lost", rows }) },
            ...(can("crm.lead.delete") ? [{ label: "Delete", run: (rows: Lead[]) => setBulk({ kind: "delete", rows }) }] : []),
          ] : []}
          exportName="leads"
          emptyState={<EmptyState icon={Users} title={`No ${leads.toLowerCase()} yet`} description="Add the people who enquire, or import your list from a spreadsheet. Then work them stage by stage." action={add} />}
        />
      )}
      {dialog?.kind === "new" && <LeadDialog initialStageId={dialog.stageId} onClose={() => setDialog(null)} onSaved={(l) => { setDialog(null); reload(); router.push(`/app/m/crm/${l.id}`) }} />}
      {dialog?.kind === "import" && <ImportDialog kind="lead" onClose={() => setDialog(null)} onDone={reload} />}
      {bulk?.kind === "assign" && <AssignDialog count={bulk.rows.length} onClose={() => setBulk(null)} onConfirm={(ownerId) => runBulk({ ownerId }, "Assigned")} />}
      {bulk?.kind === "stage" && <StageDialog count={bulk.rows.length} stages={stages} onClose={() => setBulk(null)} onConfirm={(stageId) => runBulk({ stageId }, "Moved")} />}
      {bulk?.kind === "label" && <LabelDialog count={bulk.rows.length} onClose={() => setBulk(null)} onConfirm={(label) => runBulk({ label }, "Labelled")} />}
      {bulk?.kind === "lost" && <LostDialog title={`Mark ${bulk.rows.length} lead${bulk.rows.length === 1 ? "" : "s"} lost`} onClose={() => setBulk(null)} onConfirm={(reason) => runBulk({ reason }, "Marked lost")} />}
      {bulk?.kind === "delete" && (
        <Dialog open onOpenChange={(o) => !o && setBulk(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>Delete {bulk.rows.length} lead{bulk.rows.length === 1 ? "" : "s"}?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Their notes and tasks go too. Leads with deals are kept.</p>
            <DialogFooter><Button variant="outline" onClick={() => setBulk(null)}>Cancel</Button><Button variant="destructive" onClick={() => runBulk({}, "Deleted").catch((e) => toast.error(errorMessage(e)))}>Delete</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {actions.dialogs}
    </>
  )
}
