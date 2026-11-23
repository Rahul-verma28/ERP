"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CheckCircle2, Circle, ListChecks, Pencil, Plus, Rocket, Trash2, UserCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { EmployeeSelect, HrTabs, TABS } from "@/components/hr/pickers"
import { SearchSelect } from "@/components/search-select"
import type { Candidate } from "@/components/hr/recruit"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi } from "@/lib/use-api"
import { formatDate } from "@/lib/format"
import { useRecords, type HrRecord } from "@/lib/hr"
import { cn } from "@/lib/utils"
import { useChanged } from "@/lib/use-dirty"
import { NoAccessPage } from "@/components/page-states"

// Candidate onboarding: a hired person's first days, run from a checklist, with a buddy.

interface Task { id: string; task: string; category?: string | null; dueDay: number; dueOn: string; required: boolean; doneAt: string | null }
interface Ob { candidateId: string; checklistId: string; checklist?: string; startOn: string; buddyId?: string | null; notes?: string | null; tasks: Task[] }
type Row = HrRecord<Ob>
interface Checklist { name: string; isDefault: boolean; items: { task: string }[] }

function OnboardingDialog({ row, onClose, onSaved }: { row: Row | null; onClose: () => void; onSaved: () => void }) {
  const cands = useSharedApi<{ data: Candidate[] }>("/hr/candidates")
  const lists = useRecords<Checklist>("checklist")
  const d = row?.data
  const def = lists.data?.data.find((l) => l.data.isDefault && l.status === "active")?.id ?? ""
  const [f, setF] = React.useState({ candidateId: d?.candidateId ?? "", checklistId: d?.checklistId ?? "", startOn: d?.startOn ?? todayInIndia(), buddyId: d?.buddyId ?? "", notes: d?.notes ?? "" })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  const checklistId = f.checklistId || def
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.candidateId) x.candidateId = "Choose the hired candidate"
    if (!checklistId) x.checklistId = "Choose a checklist"
    if (!f.startOn) x.startOn = "Choose the start date"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const body = { candidateId: f.candidateId, checklistId, startOn: f.startOn, buddyId: f.buddyId || null, notes: f.notes.trim() || null }
    try {
      if (row) await api.put(`/hr/records/onboarding/${row.id}`, { ...body, version: row.version })
      else await api.post("/hr/records/onboarding", body)
      toast.success(row ? "Saved" : "Onboarding started")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  const hired = (cands.data?.data ?? []).filter((c) => c.stage === "hired" || c.id === f.candidateId)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{row ? "Edit onboarding" : "Start onboarding"}</DialogTitle><DialogDescription>The checklist&apos;s tasks get due dates from the start date.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Hired candidate" required error={errors.candidateId} hint={hired.length ? undefined : "Hire someone from Candidates or Offers first"}><SearchSelect value={f.candidateId} onChange={(v) => set("candidateId", v)} disabled={!!row} searchable options={hired.map((c) => ({ value: c.id, label: `${c.name} · ${c.job}` }))} placeholder="Choose who is joining" aria-label="Hired candidate" /></Field>
          <Field label="Checklist" required error={errors.checklistId} hint={lists.data?.data.length ? undefined : "Make a checklist in Recruitment → System Setup"}><SearchSelect value={checklistId} onChange={(v) => set("checklistId", v)} disabled={!!row} options={(lists.data?.data ?? []).filter((l) => l.status === "active" || l.id === checklistId).map((l) => ({ value: l.id, label: `${l.data.name} · ${l.data.items.length} tasks${l.data.isDefault ? " (default)" : ""}` }))} placeholder="Choose the checklist" aria-label="Checklist" /></Field>
          <Field label="Starts on" required error={errors.startOn}><Input type="date" value={f.startOn} onChange={(e) => set("startOn", e.target.value)} /></Field>
          <Field label="Buddy" hint="Someone who helps them settle in"><EmployeeSelect value={f.buddyId} onChange={(v) => set("buddyId", v)} placeholder="Choose a buddy (optional)" aria-label="Buddy" /></Field>
          <Field label="Notes"><Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!d && unchanged)}><Rocket /> {busy ? "Saving…" : row ? "Save" : "Start onboarding"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TasksDialog({ row, onClose, onChanged }: { row: Row; onClose: () => void; onChanged: () => void }) {
  const { can } = useAuth()
  const [tasks, setTasks] = React.useState(row.data.tasks)
  const today = todayInIndia()
  async function toggle(t: Task) {
    try {
      const r = await api.post<{ data: Ob; status: string }>(`/hr/records/onboarding/${row.id}/task`, { taskId: t.id, done: !t.doneAt })
      setTasks(r.data.tasks)
      if (r.status === "completed" && row.status !== "completed") toast.success("All required tasks done: onboarding complete")
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const done = tasks.filter((t) => t.doneAt).length
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{row.candidate?.name}&apos;s onboarding</DialogTitle><DialogDescription>{row.data.checklist} · started {formatDate(row.data.startOn)}{row.names.buddy ? ` · buddy ${row.names.buddy}` : ""} · {done} of {tasks.length} done</DialogDescription></DialogHeader>
        <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-2xl border">
          {tasks.map((t) => (
            <li key={t.id}>
              <button type="button" disabled={!can("hr.recruitment.edit")} onClick={() => void toggle(t)} className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-muted/40 disabled:cursor-default">
                {t.doneAt ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1"><span className={cn("block font-medium", t.doneAt && "text-muted-foreground line-through")}>{t.task}</span><span className="text-xs text-muted-foreground">{[t.category, `due ${formatDate(t.dueOn)}`, !t.required && "optional"].filter(Boolean).join(" · ")}</span></span>
                {!t.doneAt && t.dueOn < today && <Pill color="rose">Late</Pill>}
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const PRESETS: ViewPreset[] = [{ key: "in_progress", label: "In progress", params: { status: "in_progress" } }, { key: "completed", label: "Completed", params: { status: "completed" } }, { key: "all", label: "All", params: {} }]

export default function OnboardingPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Row | "new" | null>(null)
  const [viewing, setViewing] = React.useState<Row | null>(null)
  const [deleting, setDeleting] = React.useState<Row | null>(null)
  if (!can("hr.recruitment.view")) return <NoAccessPage title="Candidate onboarding" permission="hr.recruitment.view" />
  const reload = () => setVersion((v) => v + 1)
  const today = todayInIndia()
  const columns: Column<Row>[] = [
    { key: "who", header: "Joining", hideable: false, sort: (r) => r.candidate?.name ?? "", csv: (r) => r.candidate?.name ?? "", cell: (r) => <span className="flex items-center gap-2.5"><Avatar name={r.candidate?.name ?? "?"} className="size-8" /><span><span className="block font-medium">{r.candidate?.name}</span><span className="text-xs text-muted-foreground">{r.candidate?.job}</span></span></span> },
    { key: "checklist", header: "Checklist", csv: (r) => r.data.checklist ?? "", cell: (r) => r.data.checklist ?? "—" },
    { key: "start", header: "Started", sort: (r) => r.data.startOn, csv: (r) => r.data.startOn, cell: (r) => formatDate(r.data.startOn) },
    { key: "buddy", header: "Buddy", csv: (r) => r.names.buddy ?? "", cell: (r) => r.names.buddy ?? "—" },
    { key: "progress", header: "Progress", csv: (r) => `${r.data.tasks.filter((t) => t.doneAt).length}/${r.data.tasks.length}`, cell: (r) => { const n = r.data.tasks.length; const d = r.data.tasks.filter((t) => t.doneAt).length; const late = r.data.tasks.filter((t) => !t.doneAt && t.dueOn < today).length; return <span className="grid w-40 gap-1"><span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${n ? (d / n) * 100 : 0}%` }} /></span><span className="text-xs text-muted-foreground">{d} of {n} done{late ? <span className="text-destructive"> · {late} late</span> : null}</span></span> } },
    { key: "status", header: "Status", csv: (r) => r.status, cell: (r) => <Pill color={r.status === "completed" ? "emerald" : "blue"} dot>{r.status === "completed" ? "Completed" : "In progress"}</Pill> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" className="h-8" onClick={() => setViewing(r)}><ListChecks /> Tasks</Button>
          <ActionMenu label="More actions" items={[
            can("hr.recruitment.edit") && { label: "Edit", icon: Pencil, onClick: () => setEditing(r) },
            r.names.employee && r.candidate?.employeeId && { label: "Open employee", icon: UserCheck, href: `/app/m/hr/employees/${r.candidate.employeeId}` },
            "-",
            can("hr.recruitment.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("hr.recruitment.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Start onboarding</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.recruitment} active="onboarding" />
      <DataList<Row>
        id="hr-onboarding"
        load={localList(async (p) => (await api.get<{ data: Row[] }>("/hr/records/onboarding")).data.filter((r) => !p.status || r.status === p.status), (r, q) => `${r.candidate?.name ?? ""} ${r.data.checklist ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Candidate onboarding", description: "A new joiner's first days from a checklist: papers, training, setup. Done when every required task is ticked.", primary: add, actions: <Link href="/app/m/hr/recruitment/setup" className="text-sm text-primary hover:underline">Checklists</Link> }}
        columns={columns}
        searchPlaceholder="Search name or checklist"
        presetLabel="Show"
        presets={PRESETS}
        rowClick={(r) => setViewing(r)}
        exportName="onboarding"
        emptyState={<EmptyState icon={Rocket} title="No onboarding here" description="Hire a candidate, then start their onboarding from a checklist." action={add} />}
      />
      {editing && <OnboardingDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {viewing && <TasksDialog row={viewing} onClose={() => setViewing(null)} onChanged={reload} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title="Delete this onboarding?" confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/records/onboarding/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
