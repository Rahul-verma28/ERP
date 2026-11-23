"use client"

import * as React from "react"
import { CheckCircle2, Clock, FileBarChart, IndianRupee, Timer, Users } from "lucide-react"
import { EmptyState } from "@/components/common"
import { DataList, periodFilter } from "@/components/data-list"
import { SummaryCards } from "@/components/summary-cards"
import { DOT } from "@/components/tasks/forms"
import { Money, hours, ist, range, wholeReport } from "@/components/reports/kit"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"
import { NoAccessPage } from "@/components/page-states"

// Time & tasks report: hours logged by project, person, task or day, the billable share and what
// it is worth at the project's rate; on the person view, tasks done, on time, open and late.

interface Row { id: string; label: string; color?: string; minutes: number; billableMinutes: number; valuePaise: number; entries: number; people: number; billablePct: number; done: number | null; onTimePct: number | null; open: number | null; overdue: number | null }
const BY = [["project", "By Project"], ["person", "By Person"], ["task", "By Task"], ["day", "By Day"]] as const
const HEAD: Record<string, string> = { project: "Project", person: "Person", task: "Task", day: "Day" }

function Report() {
  const { can, me } = useAuth()
  const [by, setBy] = React.useState<(typeof BY)[number][0]>("project")
  if (!can("tasks.task.view")) return <NoAccessPage title="Time report" permission="tasks.task.view" />
  const person = by === "person"
  return (
    <DataList<Row>
      key={by}
      id="tasks-report"
      load={wholeReport<Row>((p) => `/reports/time?by=${by}&${range(p)}`, (r, q) => r.label.toLowerCase().includes(q))}
      header={{ title: "Time & Tasks Report", description: "Where the hours went, how much of it you can bill, and who is getting tasks done on time." }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
      defaultFilters={{ period: "this_month" }}
      top={(r) => {
        const s = (r.sums ?? {}) as Record<string, number>
        return (
          <div className="grid gap-4">
            <SummaryCards items={[
              { label: "Time logged", value: hours(s.minutes ?? 0), hint: `${s.people ?? 0} people logged time`, color: "blue", icon: Timer },
              { label: "Billable", value: hours(s.billableMinutes ?? 0), hint: `${s.billablePct ?? 0}% of the time`, color: "emerald", icon: Clock },
              { label: "Billable value", value: formatPaise(s.valuePaise ?? 0), hint: "At each project's hourly rate", color: "violet", icon: IndianRupee },
            ]} />
            <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border p-1 text-sm" role="tablist" aria-label="Group by">
              {BY.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={by === k} onClick={() => setBy(k)} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", by === k && "bg-primary text-primary-foreground")}>{l}</button>)}
            </div>
          </div>
        )
      }}
      columns={[
        { key: "label", header: HEAD[by], hideable: false, sort: (r) => r.label, csv: (r) => r.label, cell: (r) => <span className="flex items-center gap-2 font-medium">{r.color && <span className={cn("size-2.5 shrink-0 rounded-full", DOT[r.color] ?? DOT.slate)} />}{by === "day" ? ist(r.label) : r.label}</span> },
        { key: "time", header: "Time", align: "right", sort: (r) => r.minutes, csv: (r) => Math.round(r.minutes / 6) / 10, cell: (r) => <span className="font-semibold tabular-nums">{hours(r.minutes)}</span> },
        { key: "billable", header: "Billable", align: "right", sort: (r) => r.billableMinutes, csv: (r) => Math.round(r.billableMinutes / 6) / 10, cell: (r) => <span className="tabular-nums">{hours(r.billableMinutes)}{r.billableMinutes > 0 && <span className="block text-xs text-muted-foreground">{r.billablePct}%</span>}</span> },
        { key: "value", header: "Billable value", align: "right", sort: (r) => r.valuePaise, csv: (r) => r.valuePaise / 100, cell: (r) => <Money p={r.valuePaise} /> },
        { key: "entries", header: "Entries", align: "right", defaultHidden: true, csv: (r) => r.entries, cell: (r) => r.entries || "—" },
        ...(!person ? [{ key: "people", header: "People", align: "right" as const, csv: (r: Row) => r.people, cell: (r: Row) => r.people || "—" }] : [
          { key: "done", header: "Tasks done", align: "right" as const, sort: (r: Row) => r.done ?? 0, csv: (r: Row) => r.done ?? 0, cell: (r: Row) => <span className="inline-flex items-center gap-1 tabular-nums">{r.done ? <><CheckCircle2 className="size-3.5 text-emerald-500" />{r.done}</> : "—"}</span> },
          { key: "onTime", header: "On time", align: "right" as const, sort: (r: Row) => r.onTimePct ?? 0, csv: (r: Row) => r.onTimePct ?? "", cell: (r: Row) => r.done ? <span className={cn("tabular-nums", (r.onTimePct ?? 0) < 60 ? "text-destructive" : (r.onTimePct ?? 0) < 85 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>{r.onTimePct}%</span> : <span className="text-muted-foreground">—</span> },
          { key: "open", header: "Open", align: "right" as const, csv: (r: Row) => r.open ?? 0, cell: (r: Row) => r.open || "—" },
          { key: "overdue", header: "Late", align: "right" as const, sort: (r: Row) => r.overdue ?? 0, csv: (r: Row) => r.overdue ?? 0, cell: (r: Row) => <span className={cn("tabular-nums", r.overdue ? "font-medium text-destructive" : "text-muted-foreground")}>{r.overdue || "—"}</span> },
        ]),
      ]}
      searchPlaceholder={`Search ${HEAD[by].toLowerCase()}`}
      rowHref={(r) => (by === "project" && r.id !== "none" ? `/app/m/tasks/projects/${r.id}` : by === "task" && !r.id.startsWith("p:") ? `/app/m/tasks/${r.id}` : "/app/m/tasks/timesheet")}
      exportName={`time-by-${by}`}
      emptyState={<EmptyState icon={person ? Users : FileBarChart} title="No time logged in this period" description="Log time on tasks or the timesheet; it adds up here." />}
    />
  )
}

export default function TasksReportPage() {
  return <React.Suspense><Report /></React.Suspense>
}
