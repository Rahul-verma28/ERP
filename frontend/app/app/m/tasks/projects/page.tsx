"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlarmClock, Briefcase, CheckSquare, Clock, Eye, IndianRupee, Pencil, Plus, Timer, Trash2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, remoteList, type Column, type ViewPreset } from "@/components/data-list"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { ProjectDialog, TimeDialog } from "@/components/tasks/forms"
import { ProjectDot } from "@/components/tasks/bits"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { PROJECT_STATUS, fmtMin, type Project } from "@/lib/tasks"
import { cn } from "@/lib/utils"

// Projects: pieces of work with their own tasks, team, dates and budget. One request brings the
// projects with their progress and hours, the tab counts and the cards.

const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })

export default function ProjectsPage() {
  const { can } = useAuth()
  const router = useRouter()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Project | "new" | null>(null)
  const [timing, setTiming] = React.useState<Project | null>(null)
  const [removing, setRemoving] = React.useState<Project | null>(null)
  if (!can("tasks.task.view")) return <PageHeader title="Projects" description="You don't have access to tasks. Ask your admin." />
  const reload = () => setVersion((v) => v + 1)
  const canEdit = can("tasks.task.edit")
  async function setStatus(p: Project, status: Project["status"]) {
    const body = { name: p.name, code: p.code, description: p.description, contactId: p.contactId, ownerId: p.ownerId, memberIds: p.memberIds, status, startOn: p.startOn?.slice(0, 10) ?? null, dueOn: p.dueOn?.slice(0, 10) ?? null, budgetPaise: p.budgetPaise, billable: p.billable, hourlyRatePaise: p.hourlyRatePaise, color: p.color }
    try { await api.put(`/task-projects/${p.id}`, { ...body, version: p.version }); toast.success(`${p.name}: ${PROJECT_STATUS[status].label}`); reload() } catch (e) { toast.error(errorMessage(e)) }
  }

  const columns: Column<Project>[] = [
    {
      key: "name", header: "Project", hideable: false, sort: (p) => p.name.toLowerCase(), csv: (p) => p.name,
      cell: (p) => (
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted"><ProjectDot color={p.color} className="size-3" /></span>
          <span className="min-w-0"><span className="block font-medium">{p.name}{p.code && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{p.code}</span>}</span><span className="block truncate text-xs text-muted-foreground">{p.customer ?? (p.description ? p.description.slice(0, 60) : "Internal")}</span></span>
        </span>
      ),
    },
    { key: "owner", header: "Runs it", csv: (p) => p.ownerName ?? "", cell: (p) => (p.ownerName ? <span className="flex items-center gap-2"><Avatar name={p.ownerName} className="size-7 text-[10px]" /><span className="text-sm">{p.ownerName}</span></span> : "—") },
    { key: "team", header: "Team", csv: (p) => p.members.map((m) => m.name).join(", "), cell: (p) => <span className="flex -space-x-1.5" title={p.members.map((m) => m.name).join(", ")}>{p.members.slice(0, 5).map((m) => <Avatar key={m.id} name={m.name} className="size-7 border-2 border-background text-[10px]" />)}{p.members.length > 5 && <span className="grid size-7 place-items-center rounded-full border-2 border-background bg-muted text-[10px]">+{p.members.length - 5}</span>}</span> },
    {
      key: "progress", header: "Progress", sort: (p) => p.progress, csv: (p) => `${p.taskDone}/${p.taskTotal}`,
      cell: (p) => <span className="grid min-w-32 gap-1"><span className="flex justify-between text-xs"><span>{p.taskDone}/{p.taskTotal} tasks</span><span className="font-medium">{p.progress}%</span></span><span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${p.progress}%` }} /></span>{!!p.taskLate && <span className="text-[11px] font-medium text-destructive">{p.taskLate} late</span>}</span>,
    },
    { key: "dates", header: "Dates", sort: (p) => p.dueOn ?? "9999", csv: (p) => `${p.startOn?.slice(0, 10) ?? ""} - ${p.dueOn?.slice(0, 10) ?? ""}`, cell: (p) => <span className={cn("text-sm whitespace-nowrap", p.late && "text-destructive")}>{p.startOn ? formatDate(p.startOn) : "—"} → {p.dueOn ? formatDate(p.dueOn) : "Open"}{p.late && <span className="block text-xs font-medium">Past due</span>}</span> },
    { key: "hours", header: "Hours", align: "right", sort: (p) => p.loggedMin, csv: (p) => p.loggedMin / 60, cell: (p) => <span className="text-sm tabular-nums">{fmtMin(p.loggedMin)}{p.billable && <span className="block text-[11px] text-muted-foreground">{fmtMin(p.billableMin)} billable</span>}</span> },
    { key: "budget", header: "Budget", align: "right", defaultHidden: true, csv: (p) => (p.budgetPaise ?? 0) / 100, cell: (p) => (p.budgetPaise ? <span className="text-sm tabular-nums">{formatPaise(p.budgetPaise)}{p.budgetUsedPct != null && <span className={cn("block text-[11px]", p.budgetUsedPct > 100 ? "text-destructive" : "text-muted-foreground")}>{p.budgetUsedPct}% used</span>}</span> : "—") },
    { key: "billed", header: "Time value", align: "right", defaultHidden: true, csv: (p) => p.billedPaise / 100, cell: (p) => (p.billable ? <span className="tabular-nums">{formatPaise(p.billedPaise)}</span> : "—") },
    { key: "status", header: "Status", csv: (p) => PROJECT_STATUS[p.status].label, cell: (p) => <Pill color={PROJECT_STATUS[p.status].color} dot>{PROJECT_STATUS[p.status].label}</Pill> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (p) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Link href={`/app/m/tasks/projects/${p.id}`} className={icon} title="Open" aria-label={`Open ${p.name}`}><Eye /></Link>
          {canEdit && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil /></Button>}
          <ActionMenu label={`More actions for ${p.name}`} items={[
            { label: "Log time", icon: Timer, onClick: () => setTiming(p) },
            canEdit && p.status !== "active" && { label: "Mark active", icon: Briefcase, onClick: () => void setStatus(p, "active") },
            canEdit && p.status === "active" && { label: "Put on hold", icon: AlarmClock, onClick: () => void setStatus(p, "on_hold") },
            canEdit && p.status !== "completed" && { label: "Mark completed", icon: CheckSquare, onClick: () => void setStatus(p, "completed") },
            "-",
            can("tasks.task.delete") && !p.taskTotal && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setRemoving(p) },
          ]} />
        </span>
      ),
    },
  ]
  const presets: ViewPreset[] = [
    { key: "open", label: "Open", params: { status: "open" }, countKey: "open" },
    { key: "active", label: "Active", params: { status: "active" }, countKey: "active" },
    { key: "planning", label: "Planning", params: { status: "planning" }, countKey: "planning" },
    { key: "on_hold", label: "On hold", params: { status: "on_hold" }, countKey: "on_hold" },
    { key: "late", label: "Past due", params: { status: "late" }, countKey: "late" },
    { key: "completed", label: "Completed", params: { status: "completed" }, countKey: "completed" },
    { key: "all", label: "All", params: { status: "all" }, countKey: "all" },
  ]
  const add = can("tasks.task.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> New project</Button> : undefined

  return (
    <>
      <DataList<Project>
        id="task-projects"
        load={remoteList((p) => api.get<{ data: Project[] } & Record<string, unknown>>(`/task-projects?status=${p.status ?? "open"}`), (p, q) => `${p.name} ${p.code ?? ""} ${p.customer ?? ""} ${p.ownerName ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Projects", description: "Work with its own tasks, team, dates and budget. Open one for its board, people and hours.", primary: add, more: [{ label: "Tasks", href: "/app/m/tasks" }, { label: "Timesheet", href: "/app/m/tasks/timesheet" }] }}
        columns={columns}
        searchPlaceholder="Search project, code, customer or owner"
        presets={presets}
        presetLabel="Show"
        tabs
        top={(res) => {
          const c = (res.counts ?? {}) as Record<string, number>
          const s = (res.sums ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Open projects", value: c.open ?? 0, hint: `${c.active ?? 0} active · ${c.on_hold ?? 0} on hold`, color: "blue", icon: Briefcase },
            { label: "Open tasks", value: s.openTasks ?? 0, hint: "Across open projects", color: "violet", icon: CheckSquare },
            { label: "Late", value: s.lateTasks ?? 0, hint: `${c.late ?? 0} projects past their due date`, color: "rose", icon: AlarmClock },
            { label: "Hours logged", value: fmtMin(s.loggedMin), hint: "All projects", color: "amber", icon: Clock },
            { label: "Billable time", value: formatPaise(s.billedPaise ?? 0), hint: "At each project's rate", color: "emerald", icon: IndianRupee },
          ]} />
        }}
        rowHref={(p) => `/app/m/tasks/projects/${p.id}`}
        exportName="projects"
        emptyState={<EmptyState icon={Briefcase} title="No projects here" description="Group tasks into a project: a shop fit-out, a festive campaign, a customer job. Track progress and hours in one place." action={add} />}
      />
      {editing && <ProjectDialog project={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(p) => { setEditing(null); reload(); if (editing === "new") router.push(`/app/m/tasks/projects/${p.id}`) }} />}
      {timing && <TimeDialog projectId={timing.id} onClose={() => setTiming(null)} onSaved={() => { setTiming(null); reload() }} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive title={`Delete ${removing?.name}?`} description="It has no tasks. Time logged on it stays, without a project." confirmLabel="Delete project"
        onConfirm={async () => { try { await api.delete(`/task-projects/${removing!.id}`); toast.success("Project deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
