"use client"

import * as React from "react"
import { toast } from "sonner"
import { AlarmClock, CheckCircle2, Pencil, Plus, Target, Trash2, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { countBy, DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { PersonCell } from "@/components/record-view"
import { SummaryCards, share } from "@/components/summary-cards"
import { Field, FormError } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { ActionMenu, Pill } from "@/components/page-parts"
import { EmployeeSelect, HrTabs, ListSelect, TABS } from "@/components/hr/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useChanged } from "@/lib/use-dirty"

// Goals: a target per person with a deadline and progress. Past the deadline unfinished = overdue.

interface Goal { id: string; employeeId: string; employee: string; employeeCode: string; title: string; goalType: string | null; description: string | null; target: string | null; startsOn: string; endsOn: string; progress: number; status: "not_started" | "in_progress" | "completed" | "overdue"; version: number }
const STATUS: Record<string, { label: string; color: string }> = { not_started: { label: "Not started", color: "slate" }, in_progress: { label: "In progress", color: "blue" }, completed: { label: "Done", color: "emerald" }, overdue: { label: "Overdue", color: "rose" } }

function GoalDialog({ goal, onClose, onSaved }: { goal: Goal | null; onClose: () => void; onSaved: () => void }) {
  const today = todayInIndia()
  const [f, setF] = React.useState({ employeeId: goal?.employeeId ?? "", title: goal?.title ?? "", goalType: goal?.goalType ?? "", target: goal?.target ?? "", description: goal?.description ?? "", startsOn: goal?.startsOn.slice(0, 10) ?? today, endsOn: goal?.endsOn.slice(0, 10) ?? "", progress: String(goal?.progress ?? 0) })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.employeeId) x.employeeId = "Choose the employee"
    if (f.title.trim().length < 3) x.title = "Enter the goal"
    if (!f.endsOn) x.endsOn = "Choose the deadline"
    else if (f.endsOn < f.startsOn) x.endsOn = "Must be after the start"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const n = (v: string) => v.trim() || null
    const body = { employeeId: f.employeeId, title: f.title.trim(), goalType: n(f.goalType), target: n(f.target), description: n(f.description), startsOn: f.startsOn, endsOn: f.endsOn, progress: Number(f.progress || 0) }
    try {
      if (goal) await api.put(`/hr/goals/${goal.id}`, body)
      else await api.post("/hr/goals", body)
      toast.success(goal ? "Goal saved" : "Goal set")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{goal ? "Edit goal" : "Set a goal"}</DialogTitle><DialogDescription>Something clear to reach by a date.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Employee" required error={errors.employeeId} className="sm:col-span-2"><EmployeeSelect value={f.employeeId} onChange={(v) => set("employeeId", v)} aria-label="Employee" /></Field>
          <Field label="Goal" required error={errors.title} className="sm:col-span-2"><Input value={f.title} autoFocus maxLength={160} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Sell ₹5 lakh of mobiles this quarter" /></Field>
          <Field label="Type"><ListSelect list="goalTypes" value={f.goalType} onChange={(v) => set("goalType", v)} aria-label="Type" /></Field>
          <Field label="Target"><Input value={f.target} maxLength={160} onChange={(e) => set("target", e.target.value)} placeholder="e.g. ₹5,00,000" /></Field>
          <Field label="Start" required><Input type="date" value={f.startsOn} onChange={(e) => set("startsOn", e.target.value)} /></Field>
          <Field label="Deadline" required error={errors.endsOn}><Input type="date" value={f.endsOn} min={f.startsOn} onChange={(e) => set("endsOn", e.target.value)} /></Field>
          <Field label="Progress" className="sm:col-span-2"><NumberStepper max={100} step={10} suffix="%" value={f.progress} onChange={(v) => set("progress", v)} aria-label="Progress" /></Field>
          <Field label="Details" className="sm:col-span-2"><Textarea rows={2} maxLength={2000} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!goal && unchanged)}>{busy ? "Saving…" : goal ? "Save goal" : "Set goal"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const PRESETS: ViewPreset[] = [{ key: "all", label: "All", params: {}, countKey: "all" }, { key: "open", label: "Open", params: { show: "open" }, countKey: "open" }, { key: "overdue", label: "Overdue", params: { show: "overdue" }, countKey: "overdue" }, { key: "done", label: "Completed", params: { show: "completed" }, countKey: "completed" }]

export default function GoalsPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Goal | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<Goal | null>(null)
  if (!can("hr.performance.view")) return <PageHeader title="Goals" description="You don't have access to this. Ask your admin." />
  const reload = () => setVersion((v) => v + 1)
  const edit = can("hr.performance.edit")
  async function progress(g: Goal, p: number) {
    try { await api.post(`/hr/goals/${g.id}/progress`, { progress: p }); if (p === 100) toast.success("Goal done!"); reload() } catch (e) { toast.error(errorMessage(e)) }
  }
  const columns: Column<Goal>[] = [
    { key: "employee", header: "Employee", hideable: false, sort: (g) => g.employee, csv: (g) => g.employee, cell: (g) => <PersonCell name={g.employee} sub={g.employeeCode} /> },
    { key: "type", header: "Goal type", csv: (g) => g.goalType ?? "", cell: (g) => (g.goalType ? <Pill color="violet">{g.goalType}</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "goal", header: "Title", sort: (g) => g.title, csv: (g) => g.title, cell: (g) => <span className="block max-w-72"><span className="block truncate font-medium" title={g.title}>{g.title}</span>{g.description && <span className="block truncate text-xs text-muted-foreground">{g.description}</span>}</span> },
    { key: "target", header: "Target", csv: (g) => g.target ?? "", cell: (g) => (g.target ? <span className="font-medium">{g.target}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "progress", header: "Progress", sort: (g) => g.progress, csv: (g) => g.progress, cell: (g) => (
      <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <span className="h-2 w-28 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", g.progress >= 100 ? "bg-emerald-500" : g.status === "overdue" ? "bg-rose-500" : "bg-primary")} style={{ width: `${g.progress}%` }} /></span>
        <span className="w-9 text-xs tabular-nums">{g.progress}%</span>
        {edit && g.progress < 100 && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void progress(g, Math.min(100, g.progress + 25))}>+25%</Button>}
      </span>
    ) },
    { key: "start", header: "Start date", sort: (g) => g.startsOn, csv: (g) => g.startsOn.slice(0, 10), cell: (g) => formatDate(g.startsOn) },
    { key: "deadline", header: "End date", sort: (g) => g.endsOn, csv: (g) => g.endsOn.slice(0, 10), cell: (g) => { const left = Math.round((new Date(g.endsOn.slice(0, 10)).getTime() - new Date(todayInIndia()).getTime()) / 86_400_000); return <span>{formatDate(g.endsOn)}{g.status !== "completed" && <span className={cn("block text-xs", left < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>{left < 0 ? `${-left} days late` : left === 0 ? "Due today" : `${left} days left`}</span>}</span> } },
    { key: "status", header: "Status", csv: (g) => STATUS[g.status].label, cell: (g) => <Pill color={STATUS[g.status].color} dot>{STATUS[g.status].label}</Pill> },
    { key: "actions", header: "Actions", hideable: false, cell: (g) => <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>{edit && <Button variant="ghost" size="icon-sm" title="Edit" aria-label="Edit goal" onClick={() => setEditing(g)}><Pencil /></Button>}<ActionMenu label="More actions" items={[edit && g.progress < 100 && { label: "Mark done", icon: Target, onClick: () => void progress(g, 100) }, "-", can("hr.performance.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(g) }]} /></span> },
  ]
  const add = can("hr.performance.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Set a goal</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.performance} active="goals" />
      <DataList<Goal>
        id="hr-goals"
        load={localList(
          async () => (await api.get<{ data: Goal[] }>("/hr/goals")).data,
          (g, q) => `${g.title} ${g.employee} ${g.goalType ?? ""} ${g.target ?? ""}`.toLowerCase().includes(q),
          {
            filter: (g, p) => (p.show === "open" ? g.status !== "completed" : p.show ? g.status === p.show : true),
            counts: (rows) => ({ ...countBy(rows, (g) => g.status), open: rows.filter((g) => g.status !== "completed").length }),
            meta: (rows) => ({ avg: rows.length ? Math.round(rows.reduce((n, g) => n + g.progress, 0) / rows.length) : 0 }),
          },
        )}
        tabs
        top={(r) => {
          const c = (r.counts ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Total goals", value: c.all ?? 0, hint: `Average progress ${Number(r.avg ?? 0)}%`, color: "blue", icon: Target },
            { label: "In progress", value: c.open ?? 0, hint: share(c.open ?? 0, c.all ?? 0), color: "violet", icon: TrendingUp },
            { label: "Overdue", value: c.overdue ?? 0, hint: "Past the end date", color: "rose", icon: AlarmClock },
            { label: "Completed", value: c.completed ?? 0, hint: share(c.completed ?? 0, c.all ?? 0), color: "emerald", icon: CheckCircle2 },
          ]} />
        }}
        params={{ v: String(version) }}
        header={{ title: "Goals", description: "Targets with a deadline. Update progress as it moves; unfinished ones past the deadline show as overdue.", primary: add }}
        columns={columns}
        searchPlaceholder="Search goal or employee"
        presetLabel="Show"
        presets={PRESETS}
        rowClick={(g) => edit && setEditing(g)}
        exportName="goals"
        emptyState={<EmptyState icon={Target} title="No goals here" action={add} />}
      />
      {editing && <GoalDialog goal={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title="Delete this goal?" confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/goals/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
