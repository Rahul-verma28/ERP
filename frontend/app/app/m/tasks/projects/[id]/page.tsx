"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { AlarmClock, Briefcase, CheckSquare, Clock, IndianRupee, Pencil, Plus, ShieldCheck, Timer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { Spinner } from "@/components/common"
import { ActionMenu, Avatar, BackLink, DetailHeader, DetailList, Pill, Section, Tabs } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { Board } from "@/components/crm/board"
import { ApprovalDialog, ProjectDialog, TaskDialog, TimeDialog } from "@/components/tasks/forms"
import { DueText, Progress } from "@/components/tasks/bits"
import { PageLoading } from "@/components/page-states"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatDateTime, formatPaise } from "@/lib/format"
import { PRIORITY, PROJECT_STATUS, STATUS, fmtMin, type Project, type Task, type TaskStatus, type TimeLog } from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { AboutCard, RecordHistory, useTabParam } from "@/components/record-kit"

// One project: the board of its tasks, the people and their hours, recent activity and details.

interface Detail extends Project { hours: { userId: string; name: string; minutes: number; billableMin: number }[]; events: { id: string; type: string; body: string | null; at: string; actorName: string | null; taskTitle: string; taskId: string }[] }
type Tab = "board" | "list" | "time" | "activity" | "details" | "history"
const TAB_KEYS: Tab[] = ["board", "list", "time", "activity", "details", "history"]
const BOARD: { id: TaskStatus; name: string; color: string }[] = [{ id: "todo", name: "To do", color: "slate" }, { id: "in_progress", name: "In progress", color: "blue" }, { id: "done", name: "Done", color: "emerald" }]

function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = useAuth()
  const [tab, setTab] = useTabParam<Tab>(TAB_KEYS, "board")
  const [editing, setEditing] = React.useState(false)
  const [adding, setAdding] = React.useState<TaskStatus | null>(null)
  const [timing, setTiming] = React.useState(false)
  const [asking, setAsking] = React.useState(false)
  const res = useApi<Detail>(`/task-projects/${id}`)
  const tasks = useApi<{ data: Task[]; sums: { labels: string[] } }>(`/tasks?status=all&projectId=${id}&limit=500`)
  const times = useApi<{ data: TimeLog[] }>(tab === "time" ? `/task-times?projectId=${id}` : null)
  if (res.error && !res.data) return <PageHeader title="Project not found" description={errorMessage(res.error)} />
  const p = res.data
  if (!p) return <PageLoading />
  const reload = () => { void res.reload(); void tasks.reload(); void times.reload() }
  const canEdit = can("tasks.task.edit")
  const live = (tasks.data?.data ?? []).filter((t) => t.status !== "cancelled")
  async function move(t: Task, status: TaskStatus) {
    try { await api.patch(`/tasks/${t.id}`, { status, version: t.version }); toast.success(status === "done" ? "Done" : "Moved"); reload() } catch (e) { toast.error(errorMessage(e)); throw e }
  }

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/tasks/projects">Projects</BackLink>
      <DetailHeader
        title={<>{p.name}{p.code && <span className="ml-2 font-mono text-base text-muted-foreground">{p.code}</span>}</>}
        icon={Briefcase}
        pills={<><Pill color={PROJECT_STATUS[p.status].color} dot>{PROJECT_STATUS[p.status].label}</Pill>{p.late && <Pill color="rose">Past due</Pill>}{p.billable && <Pill color="emerald">Billable</Pill>}</>}
        subtitle={[p.ownerName ? `Run by ${p.ownerName}` : null, p.customer, p.dueOn ? `Due ${formatDate(p.dueOn)}` : null].filter(Boolean).join(" · ")}
        actions={<>
          {can("tasks.task.create") && <Button onClick={() => setAdding("todo")}><Plus /> Add task</Button>}
          <Button variant="outline" onClick={() => setTiming(true)}><Timer /> Log time</Button>
          {canEdit && <Button variant="outline" size="icon" title="Edit" aria-label="Edit project" onClick={() => setEditing(true)}><Pencil /></Button>}
          <ActionMenu items={[can("tasks.approval.create") && { label: "Ask for approval", icon: ShieldCheck, onClick: () => setAsking(true) }]} />
        </>}
      />
      <SummaryCards items={[
        { label: "Progress", value: `${p.progress}%`, hint: `${p.taskDone} of ${p.taskTotal} tasks done`, color: "emerald", icon: CheckSquare },
        { label: "Late tasks", value: p.taskLate, hint: "Open and past due", color: "rose", icon: AlarmClock },
        { label: "Hours logged", value: fmtMin(p.loggedMin), hint: `${fmtMin(p.billableMin)} billable`, color: "amber", icon: Clock },
        { label: p.budgetPaise ? "Budget" : "Time value", value: formatPaise(p.budgetPaise ?? p.billedPaise), hint: p.budgetPaise ? `${p.budgetUsedPct ?? 0}% used by billable time` : p.billable ? "Billable hours at the rate" : "Not billable", color: "violet", icon: IndianRupee },
      ]} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "board", label: "Board", count: live.filter((t) => t.status !== "done").length },
        { key: "list", label: "All tasks", count: tasks.data?.data.length ?? null },
        { key: "time", label: "Time" },
        { key: "activity", label: "Activity", count: p.events.length },
        { key: "details", label: "Details" }, { key: "history", label: "History" }]} />
      {tab === "history" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <RecordHistory kind="project" id={p.id} refText={p.name} created={{ at: p.createdAt }} />
          <AboutCard id={p.id} createdAt={p.createdAt} updatedAt={"updatedAt" in p ? (p as { updatedAt?: string }).updatedAt : null} className="h-fit" />
        </div>
      )}

      {(tab === "board" || tab === "list") && !tasks.data && <div className="grid place-items-center py-16"><Spinner /></div>}
      {tab === "board" && tasks.data && (
        <Board<Task & { stageId: string }>
          stages={BOARD.map((b, i) => ({ id: b.id, pipelineId: "", kind: "deal", name: b.name, color: b.color, position: i, probability: null }))}
          items={live.map((t) => ({ ...t, stageId: t.status }))}
          canMove={canEdit}
          onMove={async (t, s) => move(t, s as TaskStatus)}
          onAdd={can("tasks.task.create") ? (s) => setAdding(s as TaskStatus) : undefined}
          empty="Nothing here"
          card={(t) => (
            <Link href={`/app/m/tasks/${t.id}`} className="grid gap-2 rounded-2xl border bg-card p-3 text-sm shadow-sm hover:border-primary/40">
              <span className="flex items-start justify-between gap-2"><span className={cn("font-medium", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</span><Pill color={PRIORITY[t.priority].color} dot>{PRIORITY[t.priority].label}</Pill></span>
              <span className="flex items-center justify-between gap-2 text-xs"><span className={cn("text-muted-foreground", t.overdue && "font-medium text-destructive")}>{t.dueAt ? formatDate(t.dueAt) : "No date"}</span><span className="flex items-center gap-2"><Progress t={t} />{t.assigneeName && <Avatar name={t.assigneeName} className="size-6 text-[9px]" />}</span></span>
            </Link>
          )}
        />
      )}
      {tab === "list" && tasks.data && (
        <Section title="All tasks" flush>
          {tasks.data.data.length ? (
            <ul className="divide-y">
              {tasks.data.data.map((t) => (
                <li key={t.id}><Link href={`/app/m/tasks/${t.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_140px_110px_160px]">
                  <span className="min-w-0"><span className={cn("block truncate font-medium", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</span><Progress t={t} /></span>
                  <span className="text-muted-foreground">{t.assigneeName ?? "Unassigned"}</span>
                  <Pill color={STATUS[t.status].color}>{STATUS[t.status].label}</Pill>
                  <span className="text-xs"><DueText t={t} /></span>
                </Link></li>
              ))}
            </ul>
          ) : <p className="p-6 text-center text-sm text-muted-foreground">No tasks yet.</p>}
        </Section>
      )}
      {tab === "time" && (
        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Section title="By person" flush>
            {p.hours.length ? <ul className="divide-y">{p.hours.map((h) => <li key={h.userId} className="flex items-center gap-3 px-5 py-2.5 text-sm"><Avatar name={h.name} className="size-7 text-[10px]" /><span className="flex-1">{h.name}</span><span className="tabular-nums">{fmtMin(h.minutes)}{!!h.billableMin && <span className="block text-right text-[11px] text-muted-foreground">{fmtMin(h.billableMin)} billable</span>}</span></li>)}</ul> : <p className="p-5 text-sm text-muted-foreground">No time logged yet.</p>}
          </Section>
          <Section title="Entries" flush>
            {!times.data ? <div className="grid place-items-center py-10"><Spinner /></div> : times.data.data.length ? (
              <ul className="divide-y">{times.data.data.map((m) => <li key={m.id} className="flex items-center gap-3 px-5 py-2.5 text-sm"><span className="w-24 text-muted-foreground">{formatDate(m.workDate)}</span><span className="min-w-0 flex-1"><span className="font-medium">{m.userName}</span>{m.task && <> · <Link href={`/app/m/tasks/${m.task.id}`} className="hover:underline">{m.task.title}</Link></>}{m.note && <span className="block truncate text-xs text-muted-foreground">{m.note}</span>}</span>{m.billable && <Pill color="emerald">Billable</Pill>}<span className="tabular-nums">{fmtMin(m.minutes)}</span></li>)}</ul>
            ) : <p className="p-5 text-sm text-muted-foreground">No time logged yet.</p>}
          </Section>
        </div>
      )}
      {tab === "activity" && (
        <Section title="Recent activity" flush>
          {p.events.length ? <ul className="divide-y">{p.events.map((e) => <li key={e.id} className="flex items-start gap-3 px-5 py-2.5 text-sm"><Avatar name={e.actorName ?? "?"} className="size-7 text-[10px]" /><span className="min-w-0 flex-1"><span className="font-medium">{e.actorName ?? "Someone"}</span> <span className="text-muted-foreground">{e.type === "comment" ? "commented on" : e.type === "status" ? "moved" : e.type === "created" ? "added" : "updated"}</span> <Link href={`/app/m/tasks/${e.taskId}`} className="font-medium hover:underline">{e.taskTitle}</Link>{e.type === "comment" && e.body && <span className="mt-0.5 block text-muted-foreground">“{e.body.slice(0, 160)}”</span>}</span><span className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(e.at)}</span></li>)}</ul> : <p className="p-5 text-sm text-muted-foreground">Nothing yet.</p>}
        </Section>
      )}
      {tab === "details" && (
        <Section title="Details" action={canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}>
          <DetailList items={[
            ["Name", p.name], ["Code", p.code], ["Status", PROJECT_STATUS[p.status].label], ["Customer", p.customer ?? "Internal"],
            ["Runs it", p.ownerName], ["Team", p.members.map((m) => m.name).join(", ")], ["Start", p.startOn ? formatDate(p.startOn) : null], ["Due", p.dueOn ? formatDate(p.dueOn) : "Open"],
            ["Budget", p.budgetPaise ? formatPaise(p.budgetPaise) : null], ["Billing", p.billable ? `Billable at ${formatPaise(p.hourlyRatePaise ?? 0)} an hour` : "Not billable"],
          ]} />
          {p.description && <p className="mt-4 rounded-2xl bg-muted/60 p-3 text-sm whitespace-pre-wrap">{p.description}</p>}
        </Section>
      )}

      {editing && <ProjectDialog project={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload() }} />}
      {adding && <TaskDialog defaults={{ projectId: p.id, status: adding }} labels={tasks.data?.sums.labels} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); reload() }} />}
      {timing && <TimeDialog projectId={p.id} onClose={() => setTiming(false)} onSaved={() => { setTiming(false); reload() }} />}
      {asking && <ApprovalDialog projectId={p.id} onClose={() => setAsking(false)} onSaved={() => setAsking(false)} />}
    </div>
  )
}

export default function Page() {
  return <React.Suspense><ProjectPage /></React.Suspense>
}
