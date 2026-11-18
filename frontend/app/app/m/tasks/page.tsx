"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { AlarmClock, CalendarDays, CheckCheck, CheckSquare, Clock, Copy, Eye, Flame, KanbanSquare, List, MessageSquare, Pencil, Play, Plus, ShieldCheck, Timer, XCircle } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState, Spinner } from "@/components/common"
import { DataList, HeaderLink, type Column, type ViewPreset } from "@/components/data-list"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { Board } from "@/components/crm/board"
import { MonthCalendar } from "@/components/hr/month-calendar"
import { ApprovalDialog, TaskDialog, TimeDialog } from "@/components/tasks/forms"
import { DueText, Progress, ProjectDot } from "@/components/tasks/bits"
import { todayInIndia } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi, useSharedApi } from "@/lib/use-api"
import { formatDate, formatDateTime } from "@/lib/format"
import { PRIORITY, STATUS, fmtMin, usePeople, type Project, type Task, type TaskStatus } from "@/lib/tasks"
import { cn } from "@/lib/utils"

// Tasks: one list, a board by status and a calendar by due date. Everything from the row: start,
// finish, edit, log time, ask for approval, copy, cancel. One request brings the rows, the tab
// counts and the cards.

type View = "list" | "board" | "calendar"
const VIEW_KEY = "tasks-view"
const BOARD: { id: TaskStatus; name: string; color: string }[] = [{ id: "todo", name: "To do", color: "slate" }, { id: "in_progress", name: "In progress", color: "blue" }, { id: "done", name: "Done", color: "emerald" }]
const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })

function TasksPage() {
  const { can } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const [view, setView] = React.useState<View>(() => {
    const fromUrl = params.get("view") as View | null
    if (fromUrl) return fromUrl
    try { return (typeof window !== "undefined" && (localStorage.getItem(VIEW_KEY) as View | null)) || "list" } catch { return "list" }
  })
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<{ task?: Task | null; defaults?: Parameters<typeof TaskDialog>[0]["defaults"] } | null>(null)
  const [timing, setTiming] = React.useState<Task | null>(null)
  const [asking, setAsking] = React.useState<Task | null>(null)
  const [cancelling, setCancelling] = React.useState<Task | null>(null)
  const [month, setMonth] = React.useState(() => todayInIndia().slice(0, 7))
  const { people } = usePeople()
  const projects = useSharedApi<{ data: Project[] }>("/task-projects?status=all")
  const board = useApi<{ data: Task[]; sums: { labels: string[] } }>(view !== "list" && can("tasks.task.view") ? `/tasks?status=all&limit=500&v=${version}` : null)
  const reload = () => setVersion((v) => v + 1)
  const switchView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private window */ } }
  if (!can("tasks.task.view")) return <PageHeader title="Tasks" description="You don't have access to tasks. Ask your admin." />
  const canEdit = can("tasks.task.edit")
  const labels = board.data?.sums.labels ?? []

  async function setStatus(t: Task, status: TaskStatus) {
    try {
      await api.patch(`/tasks/${t.id}`, { status, version: t.version })
      toast.success(status === "done" ? (t.repeat !== "none" ? "Done. The next one is made." : "Done") : status === "in_progress" ? "Started" : "Moved back")
      reload()
    } catch (e) { toast.error(errorMessage(e)); throw e }
  }
  async function duplicate(t: Task) {
    try { const c = await api.post<Task>(`/tasks/${t.id}/duplicate`); toast.success("Copy made"); router.push(`/app/m/tasks/${c.id}`) } catch (e) { toast.error(errorMessage(e)) }
  }
  const actions = (t: Task) => {
    const open = t.status === "todo" || t.status === "in_progress"
    return (
      <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        {canEdit && t.status === "todo" && <Button variant="ghost" size="icon-sm" className="text-blue-700 dark:text-blue-300" title="Start" aria-label={`Start ${t.title}`} onClick={() => void setStatus(t, "in_progress").catch(() => {})}><Play /></Button>}
        {canEdit && open && <Button variant="ghost" size="icon-sm" className="text-emerald-700 dark:text-emerald-300" title="Mark done" aria-label={`Mark ${t.title} done`} onClick={() => void setStatus(t, "done").catch(() => {})}><CheckCheck /></Button>}
        <Link href={`/app/m/tasks/${t.id}`} className={icon} title="Open" aria-label={`Open ${t.title}`}><Eye /></Link>
        {canEdit && open && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${t.title}`} onClick={() => setEditing({ task: t })}><Pencil /></Button>}
        <ActionMenu label={`More actions for ${t.title}`} items={[
          open && { label: "Log time", icon: Timer, onClick: () => setTiming(t) },
          can("tasks.approval.create") && { label: "Ask for approval", icon: ShieldCheck, onClick: () => setAsking(t) },
          can("tasks.task.create") && { label: "Make a copy", icon: Copy, onClick: () => void duplicate(t) },
          canEdit && !open && t.status !== "cancelled" && { label: "Open again", icon: Play, onClick: () => void setStatus(t, "todo").catch(() => {}) },
          "-",
          can("tasks.task.delete") && open && { label: "Cancel task", icon: XCircle, destructive: true, onClick: () => setCancelling(t) },
        ]} />
      </span>
    )
  }

  const columns: Column<Task>[] = [
    {
      key: "title", header: "Task", hideable: false, sort: (t) => t.title.toLowerCase(), csv: (t) => t.title,
      cell: (t) => (
        <span className="grid max-w-80 gap-1">
          <span className={cn("font-medium", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {t.labels.map((l) => <span key={l} className="rounded-full bg-primary/10 px-1.5 text-[11px] font-medium text-primary">{l}</span>)}
            <Progress t={t} />
            {!!t.comments && <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"><MessageSquare className="size-3" />{t.comments}</span>}
            {t.repeat !== "none" && <span className="text-[11px] text-muted-foreground">Repeats {t.repeat}</span>}
          </span>
        </span>
      ),
    },
    { key: "project", header: "Project", csv: (t) => t.project?.name ?? "", cell: (t) => (t.project ? <Link href={`/app/m/tasks/projects/${t.project.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 text-sm hover:underline"><ProjectDot color={t.project.color} />{t.project.name}</Link> : <span className="text-muted-foreground">—</span>) },
    { key: "assignee", header: "Assigned to", sort: (t) => t.assigneeName ?? "", csv: (t) => t.assigneeName ?? "", cell: (t) => (t.assigneeName ? <span className="flex items-center gap-2"><Avatar name={t.assigneeName} className="size-7 text-[10px]" /><span className="text-sm">{t.assigneeName}</span></span> : <span className="text-muted-foreground">Unassigned</span>) },
    { key: "priority", header: "Priority", sort: (t) => ["urgent", "high", "medium", "low"].indexOf(t.priority), csv: (t) => PRIORITY[t.priority].label, cell: (t) => <Pill color={PRIORITY[t.priority].color} dot>{PRIORITY[t.priority].label}</Pill> },
    { key: "status", header: "Status", csv: (t) => STATUS[t.status].label, cell: (t) => <Pill color={STATUS[t.status].color}>{STATUS[t.status].label}</Pill> },
    { key: "due", header: "Due", sort: (t) => t.dueAt ?? "9999", csv: (t) => t.dueAt ?? "", cell: (t) => <DueText t={t} /> },
    { key: "contact", header: "Customer", defaultHidden: true, csv: (t) => t.contact?.name ?? "", cell: (t) => t.contact?.name ?? "—" },
    { key: "time", header: "Time", align: "right", defaultHidden: true, sort: (t) => t.loggedMin ?? 0, csv: (t) => t.loggedMin ?? 0, cell: (t) => <span className="text-sm tabular-nums">{fmtMin(t.loggedMin)}{t.estimateMin ? <span className={cn("block text-[11px]", (t.loggedMin ?? 0) > t.estimateMin ? "text-destructive" : "text-muted-foreground")}>of {fmtMin(t.estimateMin)}</span> : null}</span> },
    { key: "created", header: "Created by", defaultHidden: true, csv: (t) => t.createdByName ?? "", cell: (t) => <span className="text-sm">{t.createdByName ?? "—"}<span className="block text-[11px] text-muted-foreground">{formatDate(t.createdAt)}</span></span> },
    { key: "activity", header: "Last activity", defaultHidden: true, sort: (t) => t.lastActivityAt ?? "", csv: (t) => t.lastActivityAt ?? "", cell: (t) => (t.lastActivityAt ? formatDateTime(t.lastActivityAt) : "—") },
    { key: "actions", header: "Actions", hideable: false, cell: actions },
  ]
  const presets: ViewPreset[] = [
    { key: "open", label: "Open", params: { status: "open" }, countKey: "open" },
    { key: "mine", label: "My tasks", params: { status: "open", mine: "true" }, countKey: "mine" },
    { key: "today", label: "Due today", params: { status: "open", due: "today" }, countKey: "today" },
    { key: "overdue", label: "Late", params: { status: "open", due: "overdue" }, countKey: "overdue" },
    { key: "week", label: "Next 7 days", params: { status: "open", due: "week" }, countKey: "week" },
    { key: "nodate", label: "No due date", params: { status: "open", due: "none" }, countKey: "nodate" },
    { key: "done", label: "Done", params: { status: "done" }, countKey: "done" },
    { key: "cancelled", label: "Cancelled", params: { status: "cancelled" }, countKey: "cancelled" },
  ]
  const add = can("tasks.task.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing({})}><Plus /> New task</Button> : undefined
  const toggle = (
    <div className="flex rounded-xl border bg-card p-1" role="radiogroup" aria-label="View">
      {([["list", List, "List"], ["board", KanbanSquare, "Board"], ["calendar", CalendarDays, "Calendar"]] as const).map(([k, I, label]) => (
        <button key={k} type="button" role="radio" aria-checked={view === k} title={label} onClick={() => switchView(k)} className={cn("grid size-8 place-items-center rounded-[10px] text-muted-foreground [&_svg]:size-4", view === k && "bg-primary text-primary-foreground")}><I /></button>
      ))}
    </div>
  )
  const more = [{ label: "Projects", href: "/app/m/tasks/projects" }, { label: "Timesheet", href: "/app/m/tasks/timesheet" }, ...(can("tasks.approval.view") ? [{ label: "Approvals", href: "/app/m/tasks/approvals" }] : [])]
  const live = (board.data?.data ?? []).filter((t) => t.status !== "cancelled")

  return (
    <>
      {view === "list" ? (
        <DataList<Task>
          id="tasks"
          path="/tasks"
          params={{ v: String(version) }}
          header={{ title: "Tasks", description: "Who does what, by when. Start and finish from the row; open one for its steps, comments and time.", actions: toggle, primary: add, more }}
          columns={columns}
          searchPlaceholder="Search task, project, customer or label"
          presets={presets}
          presetLabel="Show"
          tabs
          top={(res) => {
            const c = (res.counts ?? {}) as Record<string, number>
            const s = (res.sums ?? {}) as Record<string, number>
            return <SummaryCards items={[
              { label: "Open tasks", value: c.open ?? 0, hint: `${c.in_progress ?? 0} in progress · ${c.mine ?? 0} yours`, color: "blue", icon: CheckSquare },
              { label: "Late", value: c.overdue ?? 0, hint: "Past their due date", color: "rose", icon: AlarmClock },
              { label: "Due today", value: c.today ?? 0, hint: `${c.week ?? 0} more in the next 7 days`, color: "amber", icon: CalendarDays },
              { label: "High priority", value: s.urgent ?? 0, hint: "Urgent or high, still open", color: "violet", icon: Flame },
              { label: "Done this week", value: s.doneThisWeek ?? 0, hint: `You logged ${fmtMin(s.myWeekMinutes)} this week`, color: "emerald", icon: Clock },
            ]} />
          }}
          filters={[
            { key: "projectId", label: "Project", options: (projects.data?.data ?? []).map((p) => ({ value: p.id, label: p.name })) },
            { key: "assigneeId", label: "Assigned to", options: people.map((p) => ({ value: p.id, label: p.name })) },
            { key: "priority", label: "Priority", options: (["urgent", "high", "medium", "low"] as const).map((p) => ({ value: p, label: PRIORITY[p].label })) },
          ]}
          rowHref={(t) => `/app/m/tasks/${t.id}`}
          exportName="tasks"
          emptyState={<EmptyState icon={CheckSquare} title="No tasks here" description="Add what needs doing, give it a date and a person. Repeating jobs make the next one by themselves." action={add} />}
        />
      ) : (
        <div className="grid gap-4">
          <PageHeader title="Tasks" description={view === "board" ? "Drag a card to move it. Done cards stay here for the record." : "Tasks on the day they are due. Click a day to add one."} actions={<div className="flex flex-wrap items-center gap-2">{toggle}<HeaderLink href="/app/m/tasks/projects">Projects</HeaderLink>{add}</div>} />
          {!board.data ? <div className="grid place-items-center py-24"><Spinner /></div> : view === "board" ? (
            <Board<Task & { stageId: string }>
              stages={BOARD.map((b, i) => ({ id: b.id, pipelineId: "", kind: "deal", name: b.name, color: b.color, position: i, probability: null }))}
              items={live.map((t) => ({ ...t, stageId: t.status }))}
              canMove={canEdit}
              onMove={async (t, s) => setStatus(t, s as TaskStatus)}
              onAdd={can("tasks.task.create") ? (s) => setEditing({ defaults: { status: s as TaskStatus } }) : undefined}
              empty="Nothing here"
              card={(t) => (
                <Link href={`/app/m/tasks/${t.id}`} className="grid gap-2 rounded-2xl border bg-card p-3 text-sm shadow-sm hover:border-primary/40">
                  <span className="flex items-start justify-between gap-2"><span className={cn("font-medium", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</span><Pill color={PRIORITY[t.priority].color} dot>{PRIORITY[t.priority].label}</Pill></span>
                  {t.project && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ProjectDot color={t.project.color} />{t.project.name}</span>}
                  <span className="flex flex-wrap gap-1">{t.labels.map((l) => <span key={l} className="rounded-full bg-primary/10 px-1.5 text-[11px] text-primary">{l}</span>)}</span>
                  <span className="flex items-center justify-between gap-2 text-xs"><span className={cn("text-muted-foreground", t.overdue && "font-medium text-destructive")}>{t.dueAt ? formatDate(t.dueAt) : "No date"}</span><span className="flex items-center gap-2"><Progress t={t} />{t.assigneeName && <Avatar name={t.assigneeName} className="size-6 text-[9px]" />}</span></span>
                </Link>
              )}
            />
          ) : (
            <div className="ui-surface p-4">
              <MonthCalendar month={month} onMonth={setMonth} onPick={(id) => router.push(`/app/m/tasks/${id}`)} onDay={can("tasks.task.create") ? (d) => setEditing({ defaults: { dueAt: new Date(`${d}T18:00:00+05:30`).toISOString() } }) : undefined}
                legend={<span className="flex gap-3 text-xs text-muted-foreground">{(["urgent", "high", "medium", "low"] as const).map((p) => <span key={p} className="flex items-center gap-1"><span className={cn("size-2.5 rounded-sm", { urgent: "bg-rose-500", high: "bg-amber-500", medium: "bg-blue-500", low: "bg-slate-400" }[p])} />{PRIORITY[p].label}</span>)}</span>}
                items={live.filter((t) => t.dueAt).map((t) => { const d = new Date(new Date(t.dueAt!).getTime() + 330 * 60_000).toISOString().slice(0, 10); return { id: t.id, title: t.title, from: d, to: d, color: PRIORITY[t.priority].color, striped: t.status === "done", sub: t.assigneeName } })} />
            </div>
          )}
        </div>
      )}
      {editing && <TaskDialog task={editing.task} defaults={editing.defaults} labels={labels} onClose={() => setEditing(null)} onSaved={(t) => { setEditing(null); reload(); if (!editing.task) router.prefetch(`/app/m/tasks/${t.id}`) }} />}
      {timing && <TimeDialog task={timing} onClose={() => setTiming(null)} onSaved={() => { setTiming(null); reload() }} />}
      {asking && <ApprovalDialog task={asking} onClose={() => setAsking(null)} onSaved={() => setAsking(null)} />}
      <ConfirmDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)} destructive title={`Cancel “${cancelling?.title}”?`} description="It and its open subtasks are marked cancelled. History stays; you can find it under Cancelled." confirmLabel="Cancel task"
        onConfirm={async () => { try { await api.delete(`/tasks/${cancelling!.id}`); toast.success("Task cancelled"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}

export default function Page() {
  return <React.Suspense><TasksPage /></React.Suspense>
}
