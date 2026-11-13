"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Handshake, KanbanSquare, List, Pencil, Plus, Trophy } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { EmptyState, SearchInput, Spinner } from "@/components/common"
import { DataList, type Column, type ViewPreset } from "@/components/data-list"
import { NativeSelect } from "@/components/form"
import { Board } from "@/components/crm/board"
import { Avatar, DealDialog, LabelChips, StagePill, TaskBar } from "@/components/crm/dialogs"
import { DealMenu, DealStatus, useDealActions } from "@/components/crm/deal-actions"
import { todayInIndia } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { dueLabel, useCrmSetup, type Deal } from "@/lib/crm"
import { formatDate, formatPaise } from "@/lib/format"
import { useDebounced } from "@/lib/use-list"
import { cn } from "@/lib/utils"

// Deals: sales being worked on, stage by stage, until won or lost. A list or a board per pipeline.

const VIEW_KEY = "crm-deals-view"

function DealCard({ deal, actions, today }: { deal: Deal; actions: ReturnType<typeof useDealActions>; today: string }) {
  const router = useRouter()
  const due = deal.expectedCloseOn ? dueLabel(deal.expectedCloseOn, today) : null
  const who = deal.contact?.companyName || deal.contact?.name || ""
  return (
    <article onClick={() => router.push(`/app/m/crm/deals/${deal.id}`)} className="grid gap-2 rounded-2xl border bg-card p-3 text-sm shadow-[var(--shadow-card)] transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 font-semibold">{deal.title}</p>
        <DealMenu deal={deal} actions={actions} />
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><Avatar name={who} className="size-6 text-[10px]" /> <span className="truncate">{who}</span></p>
      <LabelChips labels={deal.labels} />
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <span className="font-semibold tabular-nums">{formatPaise(deal.valuePaise)}</span>
        {due && <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", due.late ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" : "bg-muted text-muted-foreground")}>{due.late ? due.text : `Closes ${formatDate(deal.expectedCloseOn!)}`}</span>}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{deal.tasks.total > 0 ? `✓ ${deal.tasks.done}/${deal.tasks.total} tasks` : "No tasks"}</span>
        {deal.owner && <span title={deal.owner.name} className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-semibold">{deal.owner.name.slice(0, 2).toUpperCase()}</span>}
      </div>
    </article>
  )
}

function DealBoard({ pipelineId, version, actions, onAdd, today }: { pipelineId: string; version: number; actions: ReturnType<typeof useDealActions>; onAdd: (stageId: string) => void; today: string }) {
  const { can } = useAuth()
  const setup = useCrmSetup().data
  const [q, setQ] = React.useState("")
  const query = useDebounced(q.trim())
  const [data, setData] = React.useState<Deal[] | null>(null)
  React.useEffect(() => {
    let off = false
    api.get<{ data: Deal[] }>(`/deals?limit=500&status=open&pipelineId=${pipelineId}${query ? `&q=${encodeURIComponent(query)}` : ""}`).then((r) => !off && setData(r.data)).catch((e) => toast.error(errorMessage(e)))
    return () => { off = true }
  }, [pipelineId, version, query])
  const stages = setup?.pipelines.find((p) => p.id === pipelineId)?.dealStages ?? []
  const prob = new Map(stages.map((s) => [s.id, s.probability ?? 0]))
  const total = (data ?? []).reduce((s, d) => s + d.valuePaise, 0)
  const weighted = (data ?? []).reduce((s, d) => s + Math.round((d.valuePaise * (prob.get(d.stageId) ?? 0)) / 100), 0)
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-full max-w-xs"><SearchInput value={q} onChange={setQ} placeholder="Search deal or customer" /></div>
        <p className="text-sm text-muted-foreground">{data?.length ?? 0} open · <strong className="text-foreground tabular-nums">{formatPaise(total)}</strong> · likely <strong className="text-foreground tabular-nums">{formatPaise(weighted)}</strong></p>
      </div>
      {!data ? <div className="grid place-items-center py-24"><Spinner /></div> : (
        <Board<Deal>
          stages={stages}
          items={data}
          value={(d) => d.valuePaise}
          canMove={can("crm.deal.edit")}
          onMove={(d, stageId) => actions.moveTo(d, stageId)}
          onAdd={can("crm.deal.create") ? onAdd : undefined}
          empty="No deals here"
          card={(d) => <DealCard deal={d} actions={actions} today={today} />}
        />
      )}
    </div>
  )
}

export default function DealsPage() {
  const router = useRouter()
  const { can, me } = useAuth()
  const setup = useCrmSetup().data
  const today = todayInIndia()
  const [version, setVersion] = React.useState(0)
  const reload = () => setVersion((v) => v + 1)
  const [view, setView] = React.useState<"list" | "board">(() => { try { return (localStorage.getItem(VIEW_KEY) as "list" | "board") || "board" } catch { return "board" } })
  const [pipelineId, setPipelineId] = React.useState("")
  const [adding, setAdding] = React.useState<{ stageId?: string } | null>(null)
  const actions = useDealActions(() => reload())
  const pipeline = setup?.pipelines.find((p) => p.id === pipelineId) ?? setup?.pipelines.find((p) => p.isDefault) ?? setup?.pipelines[0]
  const switchView = (v: "list" | "board") => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private window */ } }

  if (!can("crm.deal.view")) return <PageHeader title="Deals" description="You don't have access to deals. Ask your admin." />
  if (!setup || !pipeline) return <div className="grid place-items-center py-24"><Spinner /></div>

  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })
  const columns: Column<Deal>[] = [
    { key: "title", header: "Deal", hideable: false, sort: (d) => d.title.toLowerCase(), csv: (d) => d.title, cell: (d) => <span className="grid max-w-72 gap-1"><span className="font-medium">{d.title}</span><LabelChips labels={d.labels} /></span> },
    { key: "customer", header: "Customer", sort: (d) => (d.contact?.companyName || d.contact?.name || "").toLowerCase(), csv: (d) => d.contact?.companyName || d.contact?.name, cell: (d) => <span className="flex items-center gap-2"><Avatar name={d.contact?.companyName || d.contact?.name || "?"} className="size-8 text-[11px]" /><span className="min-w-0"><span className="block">{d.contact?.companyName || d.contact?.name}</span><span className="text-xs text-muted-foreground">{d.contact?.type === "lead" ? "Lead" : d.contact?.phone ?? ""}</span></span></span> },
    { key: "value", header: "Value", align: "right", sort: (d) => d.valuePaise, csv: (d) => (d.valuePaise / 100).toFixed(2), cell: (d) => <span className="font-semibold tabular-nums">{formatPaise(d.valuePaise)}</span> },
    { key: "stage", header: "Stage", sort: (d) => d.stage?.position ?? 99, csv: (d) => d.stage?.name, cell: (d) => (d.status === "open" ? <StagePill stage={d.stage} /> : <DealStatus deal={d} />) },
    {
      key: "close", header: "Expected close", sort: (d) => d.expectedCloseOn ?? "9999", csv: (d) => d.expectedCloseOn?.slice(0, 10) ?? "",
      cell: (d) => { if (!d.expectedCloseOn) return <span className="text-muted-foreground">—</span>; const due = dueLabel(d.expectedCloseOn, today); return <span className={cn(d.status === "open" && due?.late && "font-medium text-destructive")}>{formatDate(d.expectedCloseOn)}{d.status === "open" && due?.late && <span className="block text-xs">{due.text}</span>}</span> },
    },
    { key: "tasks", header: "Tasks", csv: (d) => `${d.tasks.done}/${d.tasks.total}`, cell: (d) => <TaskBar tasks={d.tasks} /> },
    { key: "owner", header: "Owner", csv: (d) => d.owner?.name ?? "", cell: (d) => d.owner?.name ?? <span className="text-muted-foreground">Unassigned</span> },
    { key: "status", header: "Status", defaultHidden: true, csv: (d) => d.status, cell: (d) => <DealStatus deal={d} /> },
    { key: "source", header: "Source", defaultHidden: true, csv: (d) => d.source ?? "", cell: (d) => d.source ?? "—" },
    { key: "added", header: "Added", defaultHidden: true, sort: (d) => d.createdAt, csv: (d) => d.createdAt.slice(0, 10), cell: (d) => formatDate(d.createdAt) },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (d) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {d.status === "open" && can("crm.deal.edit") && <button type="button" className={cn(icon, "text-emerald-600 dark:text-emerald-400")} title="Mark won" aria-label={`Mark ${d.title} won`} onClick={() => actions.act("won", d)}><Trophy /></button>}
          {can("crm.activity.create") && <button type="button" className={icon} title="Log note or call" aria-label={`Log activity on ${d.title}`} onClick={() => actions.act("activity", d)}><Pencil /></button>}
          <DealMenu deal={d} actions={actions} />
        </span>
      ),
    },
  ]
  const presets: ViewPreset[] = [
    { key: "open", label: "Open", params: { status: "open" } },
    { key: "mine", label: "My deals", params: { status: "open", ownerId: me?.user?.id ?? "" } },
    { key: "closing", label: "Closing in 30 days", params: { due: "closing" } },
    { key: "late", label: "Past close date", params: { due: "late" } },
    { key: "won", label: "Won", params: { status: "won" } },
    { key: "lost", label: "Lost", params: { status: "lost" } },
    { key: "all", label: "All", params: {} },
  ]
  const add = can("crm.deal.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setAdding({})}><Plus /> New deal</Button> : undefined
  const toolbar = (
    <>
      {setup.pipelines.length > 1 && <div className="w-44"><NativeSelect value={pipeline.id} onChange={(e) => setPipelineId(e.target.value)} aria-label="Pipeline">{setup.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></div>}
      <div className="flex rounded-xl border bg-card p-1" role="radiogroup" aria-label="View">
        <button type="button" role="radio" aria-checked={view === "list"} onClick={() => switchView("list")} className={cn("grid size-8 place-items-center rounded-[10px] text-muted-foreground [&_svg]:size-4", view === "list" && "bg-primary text-primary-foreground")} title="List"><List /></button>
        <button type="button" role="radio" aria-checked={view === "board"} onClick={() => switchView("board")} className={cn("grid size-8 place-items-center rounded-[10px] text-muted-foreground [&_svg]:size-4", view === "board" && "bg-primary text-primary-foreground")} title="Board"><KanbanSquare /></button>
      </div>
    </>
  )

  return (
    <>
      {view === "board" ? (
        <div className="grid gap-4">
          <PageHeader title="Deals" description={`${pipeline.name} pipeline. Drag a deal to its next stage; close it as won or lost from its menu.`} actions={<div className="flex flex-wrap items-center gap-2">{toolbar}{add}</div>} />
          <DealBoard pipelineId={pipeline.id} version={version} actions={actions} today={today} onAdd={(stageId) => setAdding({ stageId })} />
        </div>
      ) : (
        <DataList<Deal>
          id="crm-deals"
          path="/deals"
          params={{ v: String(version), pipelineId: pipeline.id }}
          header={{ title: "Deals", description: "Sales being worked on. Move them stage by stage; close as won or lost.", actions: toolbar, primary: add, more: [{ label: "Leads", href: "/app/m/crm" }, { label: "CRM reports", href: "/app/m/crm/reports" }] }}
          columns={columns}
          searchPlaceholder="Search deal, customer or mobile"
          presets={presets}
          presetLabel="Show"
          filters={[{ key: "stageId", label: "Stage", options: pipeline.dealStages.map((s) => ({ value: s.id, label: s.name })) }]}
          rowHref={(d) => `/app/m/crm/deals/${d.id}`}
          exportName="deals"
          emptyState={<EmptyState icon={Handshake} title="No deals yet" description="Convert a lead when they are ready to buy, or start a deal with a customer." action={add} />}
        />
      )}
      {adding && <DealDialog initialStageId={adding.stageId} onClose={() => setAdding(null)} onSaved={(d) => { setAdding(null); reload(); router.push(`/app/m/crm/deals/${d.id}`) }} />}
      {actions.dialogs}
    </>
  )
}
