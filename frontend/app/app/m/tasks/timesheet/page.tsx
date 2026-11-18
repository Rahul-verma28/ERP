"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CalendarDays, Clock, IndianRupee, Plus, Timer, Trash2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, periodFilter, remoteList, type Column } from "@/components/data-list"
import { Avatar, Pill } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { TimeDialog } from "@/components/tasks/forms"
import { ProjectDot } from "@/components/tasks/bits"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { fmtMin, usePeople, type Project, type TimeLog } from "@/lib/tasks"

// Timesheet: who spent how long on which task or project, by day. Log time here, from a task or
// from a project. One request brings the entries and the week's totals.

export default function TimesheetPage() {
  const { can, me } = useAuth()
  const { people } = usePeople()
  const projects = useSharedApi<{ data: Project[] }>("/task-projects?status=all")
  const [version, setVersion] = React.useState(0)
  const [adding, setAdding] = React.useState(false)
  const [removing, setRemoving] = React.useState<TimeLog | null>(null)
  if (!can("tasks.task.view")) return <PageHeader title="Timesheet" description="You don't have access to tasks. Ask your admin." />
  const reload = () => setVersion((v) => v + 1)
  const canEdit = can("tasks.task.edit")

  const columns: Column<TimeLog>[] = [
    { key: "date", header: "Day", hideable: false, sort: (m) => m.workDate, csv: (m) => m.workDate.slice(0, 10), cell: (m) => <span className="whitespace-nowrap">{formatDate(m.workDate)}</span> },
    { key: "who", header: "Who", sort: (m) => m.userName, csv: (m) => m.userName, cell: (m) => <span className="flex items-center gap-2"><Avatar name={m.userName} className="size-7 text-[10px]" /><span className="text-sm">{m.userName}</span></span> },
    { key: "work", header: "Task", csv: (m) => m.task?.title ?? "", cell: (m) => <span className="grid max-w-80"><span className="truncate font-medium">{m.task ? <Link href={`/app/m/tasks/${m.task.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{m.task.title}</Link> : <span className="text-muted-foreground">On the project</span>}</span>{m.note && <span className="truncate text-xs text-muted-foreground">{m.note}</span>}</span> },
    { key: "project", header: "Project", csv: (m) => m.project?.name ?? "", cell: (m) => (m.project ? <Link href={`/app/m/tasks/projects/${m.project.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 text-sm hover:underline"><ProjectDot color={m.project.color} />{m.project.name}</Link> : <span className="text-muted-foreground">—</span>) },
    { key: "billable", header: "Billable", csv: (m) => (m.billable ? "Yes" : "No"), cell: (m) => (m.billable ? <Pill color="emerald">Billable</Pill> : <span className="text-muted-foreground">No</span>) },
    { key: "value", header: "Value", align: "right", defaultHidden: true, csv: (m) => (m.amountPaise ?? 0) / 100, cell: (m) => (m.amountPaise ? <span className="tabular-nums">{formatPaise(m.amountPaise)}</span> : "—") },
    { key: "minutes", header: "Time", align: "right", sort: (m) => m.minutes, csv: (m) => (m.minutes / 60).toFixed(2), cell: (m) => <span className="font-semibold tabular-nums">{fmtMin(m.minutes)}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (m) => ((m.userId === me?.user.id || canEdit) ? <Button variant="ghost" size="icon-sm" className="text-destructive" title="Remove" aria-label="Remove time entry" onClick={(e) => { e.stopPropagation(); setRemoving(m) }}><Trash2 /></Button> : null),
    },
  ]
  const add = <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setAdding(true)}><Plus /> Log time</Button>

  return (
    <>
      <DataList<TimeLog>
        id="task-times"
        load={remoteList((p) => {
          const qs = new URLSearchParams(Object.entries({ from: p.from, to: p.to, userId: p.userId, projectId: p.projectId }).filter(([, v]) => v) as [string, string][]).toString()
          return api.get<{ data: TimeLog[] } & Record<string, unknown>>(`/task-times${qs ? `?${qs}` : ""}`)
        }, (m, q) => `${m.userName} ${m.task?.title ?? ""} ${m.project?.name ?? ""} ${m.note ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Timesheet", description: "Time spent on tasks and projects. Billable time is valued at the project's rate.", primary: add, more: [{ label: "Tasks", href: "/app/m/tasks" }, { label: "Projects", href: "/app/m/tasks/projects" }] }}
        columns={columns}
        searchPlaceholder="Search person, task, project or note"
        filters={[
          periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period"),
          ...(canEdit ? [{ key: "userId", label: "Who", options: people.map((p) => ({ value: p.id, label: p.name })) }] : []),
          { key: "projectId", label: "Project", options: (projects.data?.data ?? []).map((p) => ({ value: p.id, label: p.name })) },
        ]}
        top={(res) => {
          const s = (res.sums ?? {}) as { total?: number; billable?: number; amountPaise?: number; thisWeek?: number; lastWeek?: number; mine?: number; people?: { name: string; minutes: number }[] }
          const top = s.people?.[0]
          return <SummaryCards items={[
            { label: "This week", value: fmtMin(s.thisWeek), hint: `Last week ${fmtMin(s.lastWeek)}`, color: "blue", icon: CalendarDays },
            { label: "Yours this week", value: fmtMin(s.mine), hint: "Time you logged", color: "violet", icon: Timer },
            { label: "Shown", value: fmtMin(s.total), hint: "As filtered", color: "slate", icon: Clock },
            { label: "Billable", value: fmtMin(s.billable), hint: `${formatPaise(s.amountPaise ?? 0)} at project rates`, color: "emerald", icon: IndianRupee },
            { label: "Most this week", value: top?.name ?? "—", hint: top ? fmtMin(top.minutes) : "Nobody yet", color: "amber", icon: Users },
          ]} />
        }}
        exportName="timesheet"
        emptyState={<EmptyState icon={Clock} title="No time logged" description="Log time from a task, a project or here. It shows who worked on what, and what to bill." action={add} />}
      />
      {adding && <TimeDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive title="Remove this time entry?" description={removing ? `${fmtMin(removing.minutes)} by ${removing.userName} on ${formatDate(removing.workDate)}.` : ""} confirmLabel="Remove"
        onConfirm={async () => { try { await api.delete(`/task-times/${removing!.id}`); toast.success("Time removed"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
