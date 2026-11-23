"use client"

import * as React from "react"
import { toast } from "sonner"
import { CalendarClock, ClipboardCheck, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { InterviewDialog, MODE, RESULT, ResultDialog, type Interview } from "@/components/hr/recruit"
import { todayInIndia } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { NoAccessPage } from "@/components/page-states"

// Interviews: scheduled rounds, and how each one went.

const PRESETS: ViewPreset[] = [{ key: "upcoming", label: "Coming up", params: { show: "upcoming" } }, { key: "result", label: "Needs result", params: { show: "result" } }, { key: "done", label: "Done", params: { show: "done" } }, { key: "all", label: "All", params: {} }]

export default function InterviewsPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Interview | "new" | null>(null)
  const [result, setResult] = React.useState<Interview | null>(null)
  const [deleting, setDeleting] = React.useState<Interview | null>(null)
  if (!can("hr.recruitment.view")) return <NoAccessPage title="Interviews" permission="hr.recruitment.view" />
  const reload = () => setVersion((v) => v + 1)
  const today = todayInIndia()
  const edit = can("hr.recruitment.edit")
  const columns: Column<Interview>[] = [
    { key: "candidate", header: "Candidate", hideable: false, sort: (i) => i.candidate, csv: (i) => i.candidate, cell: (i) => <span className="flex items-center gap-2.5"><Avatar name={i.candidate} className="size-8" /><span><span className="block font-medium">{i.candidate}</span><span className="text-xs text-muted-foreground">{i.job}</span></span></span> },
    { key: "round", header: "Round", csv: (i) => i.round, cell: (i) => <span>{i.round}<span className="block text-xs text-muted-foreground">{MODE[i.mode]}</span></span> },
    { key: "when", header: "When", sort: (i) => `${i.onDate}${i.atTime ?? ""}`, csv: (i) => `${i.onDate.slice(0, 10)} ${i.atTime ?? ""}`, cell: (i) => <span className={i.onDate.slice(0, 10) === today ? "font-semibold text-primary" : ""}>{formatDate(i.onDate)}{i.atTime && <span className="block text-xs text-muted-foreground">{i.atTime}</span>}</span> },
    { key: "panel", header: "Interviewers", csv: (i) => i.interviewers.join(", "), cell: (i) => (i.interviewers.length ? i.interviewers.join(", ") : <span className="text-muted-foreground">—</span>) },
    { key: "result", header: "Result", csv: (i) => RESULT[i.result].label, cell: (i) => <span className="grid gap-0.5"><Pill color={RESULT[i.result].color} dot>{RESULT[i.result].label}</Pill>{i.feedback && <span className="block max-w-56 truncate text-xs text-muted-foreground" title={i.feedback}>{i.rating ? `★${i.rating} · ` : ""}{i.feedback}</span>}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (i) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {edit && i.result === "scheduled" && i.onDate.slice(0, 10) <= today && <Button size="sm" className="h-8" onClick={() => setResult(i)}><ClipboardCheck /> Result</Button>}
          <ActionMenu label={`More actions for ${i.candidate}`} items={[
            edit && { label: "Edit", icon: Pencil, onClick: () => setEditing(i) },
            edit && i.result !== "scheduled" && { label: "Change result", icon: ClipboardCheck, onClick: () => setResult(i) },
            "-",
            can("hr.recruitment.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(i) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("hr.recruitment.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Schedule interview</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.recruitment} active="interviews" />
      <DataList<Interview>
        id="hr-interviews"
        load={localList(async (p) => (await api.get<{ data: Interview[] }>("/hr/interviews")).data.filter((i) => {
          const d = i.onDate.slice(0, 10)
          if (p.show === "upcoming") return i.result === "scheduled" && d >= today
          if (p.show === "result") return i.result === "scheduled" && d <= today
          if (p.show === "done") return i.result !== "scheduled"
          return true
        }), (i, q) => `${i.candidate} ${i.job} ${i.round}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Interviews", description: "Each round with the date, time and who takes it. Record how it went to move the candidate on.", primary: add }}
        columns={columns}
        searchPlaceholder="Search candidate, job or round"
        presetLabel="Show"
        presets={PRESETS}
        rowClick={(i) => edit && setEditing(i)}
        exportName="interviews"
        emptyState={<EmptyState icon={CalendarClock} title="No interviews here" action={add} />}
      />
      {editing && <InterviewDialog interview={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {result && <ResultDialog interview={result} onClose={() => setResult(null)} onSaved={() => { setResult(null); reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title="Delete this interview?" confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/interviews/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
