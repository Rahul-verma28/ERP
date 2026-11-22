"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, GripVertical, Plus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { MoneyInput } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { SearchSelect } from "@/components/search-select"
import { ContactPicker, type ContactOption } from "@/components/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"
import { APPROVAL_KIND, COLORS, PRIORITY, PROJECT_STATUS, REPEAT_LABEL, STATUS, fmtMin, usePeople, type Approval, type ChecklistStep, type Project, type Task } from "@/lib/tasks"
import { useChanged } from "@/lib/use-dirty"
import { AttachmentsField, attachPending, FileField } from "@/components/file-field"
import type { UploadedFile } from "@/lib/files"

// Every Tasks form: task, project, time, approval request and decision. Dialogs only (one list page
// per screen); each groups its fields in titled sections, marks and enforces what is required, and
// shows the API's field errors where they belong.

/** Colour dots, written out so Tailwind keeps them */
export const DOT: Record<string, string> = { blue: "bg-blue-500", emerald: "bg-emerald-500", violet: "bg-violet-500", amber: "bg-amber-500", rose: "bg-rose-500", cyan: "bg-cyan-500", slate: "bg-slate-500" }

export function FormSection({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={cn("grid gap-4 rounded-2xl border p-4 sm:grid-cols-2", className)}>
      <legend className="px-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</legend>
      {children}
    </fieldset>
  )
}

const useErrors = () => {
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const fail = (err: unknown) => { if (err instanceof ApiError) setErrors(err.fields); setError(errorMessage(err)) }
  return { errors, setErrors, error, setError, fail }
}
/** "2026-11-20T18:00" in India time ↔ ISO */
const toLocal = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16) : "")
const fromLocal = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : null)

/** Person dropdown from the business's active people */
export function PersonSelect({ value, onChange, emptyLabel, filter, ...rest }: { value: string; onChange: (v: string) => void; emptyLabel?: string; filter?: (p: { canApprove: boolean }) => boolean; "aria-label"?: string; name?: string }) {
  const { people, me } = usePeople()
  const options = [...(emptyLabel ? [{ value: "", label: emptyLabel }] : []), ...people.filter(filter ?? (() => true)).map((p) => ({ value: p.id, label: p.id === me ? `${p.name} (you)` : p.name, keywords: `${p.email} ${p.role}` }))]
  return <SearchSelect value={value} onChange={onChange} options={options} placeholder="Choose a person" searchPlaceholder="Search people" {...rest} />
}

/** Project dropdown with "+ Add project" (opens the project form and picks the new one) */
export function ProjectSelect({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void; "aria-label"?: string; name?: string }) {
  const { can } = useAuth()
  const list = useSharedApi<{ data: Project[] }>("/task-projects?status=all")
  const [adding, setAdding] = React.useState<string | null>(null)
  const open = (list.data?.data ?? []).filter((p) => p.status !== "cancelled" || p.id === value)
  return (
    <>
      <SearchSelect value={value} onChange={onChange} options={[{ value: "", label: "No project" }, ...open.map((p) => ({ value: p.id, label: p.code ? `${p.name} · ${p.code}` : p.name, keywords: p.customer ?? "" }))]}
        placeholder="No project" searchPlaceholder="Search projects" onCreate={can("tasks.task.create") ? (typed) => setAdding(typed) : undefined} createLabel="Add project" {...rest} />
      {adding !== null && <ProjectDialog initialName={adding} onClose={() => setAdding(null)} onSaved={(p) => { setAdding(null); void list.reload(); onChange(p.id) }} />}
    </>
  )
}

/** Labels as chips: type and press Enter, or pick one used before */
export function LabelInput({ value, onChange, suggestions = [] }: { value: string[]; onChange: (v: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = React.useState("")
  const add = (raw: string) => {
    const l = raw.trim().slice(0, 30)
    if (!l || value.some((x) => x.toLowerCase() === l.toLowerCase()) || value.length >= 8) return
    onChange([...value, l])
    setText("")
  }
  const left = suggestions.filter((s) => !value.includes(s) && (!text || s.toLowerCase().includes(text.toLowerCase()))).slice(0, 6)
  return (
    <div className="grid gap-2">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border bg-background px-2 py-1.5">
        {value.map((l) => <span key={l} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{l}<button type="button" aria-label={`Remove ${l}`} onClick={() => onChange(value.filter((x) => x !== l))}><X className="size-3" /></button></span>)}
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(text) } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1)) }}
          onBlur={() => text && add(text)} placeholder={value.length ? "" : "Type a label and press Enter"} className="min-w-28 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none" aria-label="Labels" />
      </div>
      {!!left.length && <div className="flex flex-wrap gap-1">{left.map((s) => <button key={s} type="button" onClick={() => add(s)} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary">+ {s}</button>)}</div>}
    </div>
  )
}

/** Steps to tick off: add, rename, reorder by drag handle order, remove */
export function ChecklistEditor({ value, onChange }: { value: ChecklistStep[]; onChange: (v: ChecklistStep[]) => void }) {
  const [text, setText] = React.useState("")
  const add = () => { if (!text.trim()) return; onChange([...value, { id: Math.random().toString(36).slice(2, 10), text: text.trim().slice(0, 200), done: false }]); setText("") }
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= value.length) return; const n = [...value]; [n[i], n[j]] = [n[j], n[i]]; onChange(n) }
  return (
    <div className="grid gap-2">
      {value.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2 rounded-xl border px-2 py-1.5">
          <button type="button" className="text-muted-foreground" title="Move up" aria-label="Move up" onClick={() => move(i, -1)}><GripVertical className="size-4" /></button>
          <input type="checkbox" className="size-4 accent-primary" checked={s.done} onChange={(e) => onChange(value.map((x) => (x.id === s.id ? { ...x, done: e.target.checked } : x)))} aria-label={`Done: ${s.text}`} />
          <input value={s.text} maxLength={200} onChange={(e) => onChange(value.map((x) => (x.id === s.id ? { ...x, text: e.target.value } : x)))} className={cn("flex-1 bg-transparent text-sm outline-none", s.done && "text-muted-foreground line-through")} aria-label="Step" />
          <button type="button" className="text-muted-foreground hover:text-destructive" aria-label="Remove step" onClick={() => onChange(value.filter((x) => x.id !== s.id))}><Trash2 className="size-4" /></button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add() } }} placeholder="Add a step, e.g. Call the supplier" aria-label="New step" />
        <Button type="button" variant="outline" onClick={add} disabled={!text.trim()}><Plus /> Add</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- task

export function TaskDialog({ task, parentId, defaults, labels = [], onClose, onSaved }: {
  task?: Task | null
  parentId?: string
  /** New task already in a project, for a customer or at a status (board column, project page) */
  defaults?: Partial<Pick<Task, "projectId" | "contactId" | "status" | "dueAt">> & { contact?: ContactOption | null }
  labels?: string[]
  onClose: () => void
  onSaved: (t: Task) => void
}) {
  const { me } = useAuth()
  const edit = !!task
  const [f, setF] = React.useState({
    title: task?.title ?? "", description: task?.description ?? "", status: task?.status ?? defaults?.status ?? "todo", priority: task?.priority ?? "medium",
    startOn: task?.startOn?.slice(0, 10) ?? "", due: toLocal(task?.dueAt ?? defaults?.dueAt), estimateH: task?.estimateMin ? String(task.estimateMin / 60) : "",
    assigneeId: task ? task.assigneeId ?? "" : me?.user.id ?? "", projectId: task?.projectId ?? defaults?.projectId ?? "", repeat: task?.repeat ?? "none",
    labels: task?.labels ?? [], checklist: task?.checklist ?? [],
  })
  const [files, setFiles] = React.useState<UploadedFile[]>([])
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [contact, setContact] = React.useState<ContactOption | null>(task?.contact ? { id: task.contact.id, name: task.contact.name } : defaults?.contact ?? null)
  const { errors, setErrors, error, setError, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  const estimateMin = f.estimateH ? Math.round(Number(f.estimateH) * 60) : null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.title.trim().length < 2) x.title = "Write what needs doing"
    if (f.repeat !== "none" && !f.due) x.due = "A repeating task needs a due date"
    if (f.startOn && f.due && f.due.slice(0, 10) < f.startOn) x.due = "Can't be before the start date"
    if (f.estimateH && (!(Number(f.estimateH) > 0) || Number(f.estimateH) > 1000)) x.estimateH = "Enter hours, e.g. 1.5"
    if (f.checklist.some((s) => !s.text.trim())) x.checklist = "Every step needs some words"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const body = {
        title: f.title.trim(), description: f.description.trim() || null, status: f.status, priority: f.priority, startOn: f.startOn || null, dueAt: fromLocal(f.due),
        estimateMin, assigneeId: f.assigneeId || null, projectId: f.projectId || null, contactId: contact?.id ?? null, repeat: f.repeat, labels: f.labels,
        checklist: f.checklist.map((s) => ({ id: s.id, text: s.text.trim(), done: s.done })),
      }
      const t = edit ? await api.patch<Task>(`/tasks/${task!.id}`, { ...body, version: task!.version }) : await api.post<Task>("/tasks", { ...body, parentId: parentId ?? null })
      if (!edit) await attachPending(files, "task", t.id)
      toast.success(edit ? "Task saved" : parentId ? "Subtask added" : "Task created")
      onSaved(t)
    } catch (err) {
      fail(err)
      if (err instanceof ApiError && err.fields.dueAt) setErrors((x) => ({ ...x, due: err.fields.dueAt }))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{edit ? "Edit task" : parentId ? "New subtask" : "New task"}</DialogTitle><DialogDescription>Who does what, by when. Add steps to tick off, and link it to a project or customer.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <FormSection title="Details">
            <Field label="Title" required error={errors.title} className="sm:col-span-2"><Input value={f.title} maxLength={200} autoFocus onChange={(e) => set("title", e.target.value)} placeholder="e.g. Send revised quotation to Kapoor Store" /></Field>
            <Field label="Details" className="sm:col-span-2" count={[f.description.length, 5000]}><Textarea rows={3} maxLength={5000} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Anything the person needs to know" /></Field>
            <Field label="Status"><NativeSelect value={f.status} onChange={(e) => set("status", e.target.value as Task["status"])}>{(["todo", "in_progress", "done"] as const).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}</NativeSelect></Field>
            <Field label="Priority"><NativeSelect value={f.priority} onChange={(e) => set("priority", e.target.value as Task["priority"])}>{(["low", "medium", "high", "urgent"] as const).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}</NativeSelect></Field>
            <Field label="Labels" className="sm:col-span-2" hint="Up to 8, e.g. Urgent call, Follow-up, Site visit"><LabelInput value={f.labels} onChange={(v) => set("labels", v)} suggestions={labels} /></Field>
          </FormSection>
          <FormSection title="Schedule">
            <Field label="Start date" error={errors.startOn}><Input type="date" value={f.startOn} onChange={(e) => set("startOn", e.target.value)} /></Field>
            <Field label="Due" required={f.repeat !== "none"} error={errors.due}><Input type="datetime-local" value={f.due} onChange={(e) => set("due", e.target.value)} /></Field>
            <Field label="Estimate (hours)" error={errors.estimateH} hint={estimateMin ? fmtMin(estimateMin) : undefined}><Input inputMode="decimal" value={f.estimateH} onChange={(e) => set("estimateH", e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 2" /></Field>
            <Field label="Repeats" hint={f.repeat !== "none" ? "When done, the next one is made with the same details" : undefined}><NativeSelect value={f.repeat} onChange={(e) => set("repeat", e.target.value as Task["repeat"])}>{Object.entries(REPEAT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
          </FormSection>
          <FormSection title="People and links">
            <Field label="Assigned to" error={errors.assigneeId}><PersonSelect value={f.assigneeId} onChange={(v) => set("assigneeId", v)} emptyLabel="Unassigned" aria-label="Assigned to" /></Field>
            {!parentId && <Field label="Project" error={errors.projectId}><ProjectSelect value={f.projectId} onChange={(v) => set("projectId", v)} aria-label="Project" /></Field>}
            <Field label="Customer or lead" error={errors.contactId} className="sm:col-span-2"><ContactPicker value={contact} onChange={setContact} /></Field>
          </FormSection>
          <FormSection title={`Checklist${f.checklist.length ? ` · ${f.checklist.filter((s) => s.done).length}/${f.checklist.length}` : ""}`} className="sm:grid-cols-1">
            <ChecklistEditor value={f.checklist} onChange={(v) => set("checklist", v)} />
            {errors.checklist && <p className="text-xs text-destructive">{errors.checklist}</p>}
          </FormSection>
          <FormSection title="Files" className="sm:grid-cols-1">
            <AttachmentsField entityType="task" entityId={task?.id} pending={files} onPendingChange={setFiles} prompt="Add files or photos" />
          </FormSection>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!task && unchanged)}>{busy ? "Saving…" : edit ? "Save task" : "Create task"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- project

export function ProjectDialog({ project, initialName = "", onClose, onSaved }: { project?: Project | null; initialName?: string; onClose: () => void; onSaved: (p: Project) => void }) {
  const { me } = useAuth()
  const edit = !!project
  const [f, setF] = React.useState({
    name: project?.name ?? initialName, code: project?.code ?? "", description: project?.description ?? "", ownerId: project?.ownerId ?? me?.user.id ?? "",
    memberIds: project?.memberIds ?? [], status: project?.status ?? "active", startOn: project?.startOn?.slice(0, 10) ?? todayInIndia(), dueOn: project?.dueOn?.slice(0, 10) ?? "",
    budgetPaise: project?.budgetPaise ?? null as number | null, billable: project?.billable ?? false, hourlyRatePaise: project?.hourlyRatePaise ?? null as number | null, color: project?.color ?? "blue",
  })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [contact, setContact] = React.useState<ContactOption | null>(project?.contactId && project.customer ? { id: project.contactId, name: project.customer } : null)
  const { people } = usePeople()
  const { errors, setErrors, error, setError, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.name.trim().length < 2) x.name = "Name the project"
    if (f.code && !/^[A-Za-z0-9-]{2,12}$/.test(f.code)) x.code = "2 to 12 letters, numbers or -"
    if (!f.ownerId) x.ownerId = "Choose who runs it"
    if (f.startOn && f.dueOn && f.dueOn < f.startOn) x.dueOn = "Can't end before it starts"
    if (f.billable && !f.hourlyRatePaise) x.hourlyRatePaise = "Enter the rate per hour"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const body = { ...f, name: f.name.trim(), code: f.code.trim() || null, description: f.description.trim() || null, contactId: contact?.id ?? null, startOn: f.startOn || null, dueOn: f.dueOn || null, hourlyRatePaise: f.billable ? f.hourlyRatePaise : null }
      const p = edit ? await api.put<Project>(`/task-projects/${project!.id}`, { ...body, version: project!.version }) : await api.post<Project>("/task-projects", body)
      toast.success(edit ? "Project saved" : `${body.name} created`)
      onSaved(p)
    } catch (err) { fail(err); setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{edit ? "Edit project" : "New project"}</DialogTitle><DialogDescription>A piece of work with its own tasks, team and dates, e.g. a shop fit-out or a festive campaign.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <FormSection title="Project">
            <Field label="Name" required error={errors.name}><Input value={f.name} maxLength={120} autoFocus onChange={(e) => set("name", e.target.value)} placeholder="e.g. Diwali display 2026" /></Field>
            <Field label="Short code" error={errors.code} hint="Optional, e.g. DIW26"><Input value={f.code} maxLength={12} onChange={(e) => set("code", e.target.value.toUpperCase())} /></Field>
            <Field label="About" className="sm:col-span-2"><Textarea rows={2} maxLength={4000} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What it is and what done looks like" /></Field>
            <Field label="Status"><NativeSelect value={f.status} onChange={(e) => set("status", e.target.value as Project["status"])}>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</NativeSelect></Field>
            <Field label="Colour"><div className="flex gap-1.5 pt-1">{COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => set("color", c)} className={cn("size-7 rounded-full border-2", DOT[c], f.color === c ? "border-foreground" : "border-transparent")} />)}</div></Field>
            <Field label="For customer" className="sm:col-span-2" hint="Optional"><ContactPicker value={contact} onChange={setContact} /></Field>
          </FormSection>
          <FormSection title="Team and dates">
            <Field label="Runs it" required error={errors.ownerId}><PersonSelect value={f.ownerId} onChange={(v) => set("ownerId", v)} aria-label="Project owner" /></Field>
            <Field label="Start" error={errors.startOn}><Input type="date" value={f.startOn} onChange={(e) => set("startOn", e.target.value)} /></Field>
            <Field label="Team" className="sm:col-span-2" hint="They see the project and its tasks">
              <div className="flex flex-wrap gap-1.5 rounded-xl border p-2">
                {people.map((p) => { const on = f.memberIds.includes(p.id) || p.id === f.ownerId; return <button key={p.id} type="button" disabled={p.id === f.ownerId} onClick={() => set("memberIds", on ? f.memberIds.filter((m) => m !== p.id) : [...f.memberIds, p.id])} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary")}>{on && <Check className="size-3" />}{p.name}</button> })}
              </div>
            </Field>
            <Field label="Due" error={errors.dueOn}><Input type="date" value={f.dueOn} min={f.startOn || undefined} onChange={(e) => set("dueOn", e.target.value)} /></Field>
            <Field label="Budget" error={errors.budgetPaise} hint="Optional"><MoneyInput value={f.budgetPaise} onChange={(v) => set("budgetPaise", v)} aria-label="Budget" /></Field>
          </FormSection>
          <FormSection title="Billing">
            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm sm:col-span-2"><span><span className="font-medium">Charge the customer for time</span><span className="block text-xs text-muted-foreground">Billable time is valued at the rate below</span></span><Switch checked={f.billable} onCheckedChange={(v) => set("billable", v)} aria-label="Billable" /></label>
            {f.billable && <Field label="Rate per hour" required error={errors.hourlyRatePaise}><MoneyInput value={f.hourlyRatePaise} onChange={(v) => set("hourlyRatePaise", v)} aria-label="Rate per hour" /></Field>}
          </FormSection>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!project && unchanged)}>{busy ? "Saving…" : edit ? "Save project" : "Create project"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- time

export function TimeDialog({ task, projectId, onClose, onSaved }: { task?: { id: string; title: string } | null; projectId?: string | null; onClose: () => void; onSaved: () => void }) {
  const { me, can } = useAuth()
  const [f, setF] = React.useState({ userId: me?.user.id ?? "", projectId: projectId ?? "", workDate: todayInIndia(), hours: "", mins: "", note: "", billable: false })
  const { errors, setErrors, error, setError, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  const minutes = (Number(f.hours) || 0) * 60 + (Number(f.mins) || 0)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!task && !f.projectId) x.projectId = "Choose the project"
    if (minutes < 5) x.hours = "At least 5 minutes"
    else if (minutes > 1440) x.hours = "At most 24 hours"
    if (f.workDate > todayInIndia()) x.workDate = "Can't be a future day"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      await api.post("/task-times", { taskId: task?.id ?? null, projectId: task ? null : f.projectId, userId: f.userId || null, workDate: f.workDate, minutes, note: f.note.trim() || null, billable: f.billable })
      toast.success(`${fmtMin(minutes)} logged`)
      onSaved()
    } catch (err) { fail(err); if (err instanceof ApiError && err.fields.minutes) setErrors((x2) => ({ ...x2, hours: err.fields.minutes })); setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Log time</DialogTitle><DialogDescription>{task ? `On: ${task.title}` : "Time spent on a project."}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          {can("tasks.task.edit") && <Field label="Who" className="sm:col-span-2"><PersonSelect value={f.userId} onChange={(v) => set("userId", v)} aria-label="Who" /></Field>}
          {!task && <Field label="Project" required error={errors.projectId} className="sm:col-span-2"><ProjectSelect value={f.projectId} onChange={(v) => set("projectId", v)} aria-label="Project" /></Field>}
          <Field label="Day" required error={errors.workDate}><Input type="date" value={f.workDate} max={todayInIndia()} onChange={(e) => set("workDate", e.target.value)} /></Field>
          <Field label="Time spent" required error={errors.hours} hint={minutes ? fmtMin(minutes) : "Hours and minutes"}>
            <div className="flex items-center gap-2"><Input inputMode="numeric" value={f.hours} onChange={(e) => set("hours", e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="h" aria-label="Hours" /><Input inputMode="numeric" value={f.mins} onChange={(e) => set("mins", e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="min" aria-label="Minutes" /></div>
          </Field>
          <Field label="What was done" className="sm:col-span-2"><Textarea rows={2} maxLength={500} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="Optional" /></Field>
          <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm sm:col-span-2"><span className="font-medium">Billable to the customer</span><Switch checked={f.billable} onCheckedChange={(v) => set("billable", v)} aria-label="Billable" /></label>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Log time"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- approvals

export function ApprovalDialog({ task, projectId, onClose, onSaved }: { task?: { id: string; title: string } | null; projectId?: string | null; onClose: () => void; onSaved: () => void }) {
  const { me } = useAuth()
  const [f, setF] = React.useState({ title: task ? `Approve: ${task.title}`.slice(0, 200) : "", kind: "expense" as Approval["kind"], amountPaise: null as number | null, details: "", approverId: "", needBy: "", attachmentUrl: "", projectId: projectId ?? "" })
  const { errors, setErrors, error, setError, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  const needsAmount = ["expense", "purchase", "discount", "payment"].includes(f.kind)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.title.trim().length < 3) x.title = "Say what needs approving"
    if (needsAmount && !f.amountPaise) x.amountPaise = "Enter the amount"
    if (!f.approverId) x.approverId = "Choose who approves it"
    if (f.needBy && f.needBy < todayInIndia()) x.needBy = "Can't be in the past"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      await api.post("/approvals", { ...f, title: f.title.trim(), details: f.details.trim() || null, amountPaise: needsAmount || f.amountPaise ? f.amountPaise : null, needBy: f.needBy || null, attachmentUrl: f.attachmentUrl || null, taskId: task?.id ?? null, projectId: f.projectId || null })
      toast.success("Sent for approval")
      onSaved()
    } catch (err) { fail(err); setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Ask for approval</DialogTitle><DialogDescription>The person you choose is told, and decides with a note.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <FormSection title="Request">
            <Field label="What needs approving" required error={errors.title} className="sm:col-span-2"><Input value={f.title} maxLength={200} autoFocus onChange={(e) => set("title", e.target.value)} placeholder="e.g. Buy a new printer for the counter" /></Field>
            <Field label="Type"><NativeSelect value={f.kind} onChange={(e) => set("kind", e.target.value as Approval["kind"])}>{Object.entries(APPROVAL_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
            <Field label="Amount" required={needsAmount} error={errors.amountPaise}><MoneyInput value={f.amountPaise} onChange={(v) => set("amountPaise", v)} aria-label="Amount" /></Field>
            <Field label="Why" className="sm:col-span-2" count={[f.details.length, 4000]}><Textarea rows={3} maxLength={4000} value={f.details} onChange={(e) => set("details", e.target.value)} placeholder="Reason, quotes compared, anything that helps decide" /></Field>
            <Field label="Bill or quote" error={errors.attachmentUrl} className="sm:col-span-2" hint="Optional"><FileField value={f.attachmentUrl} onChange={(v) => set("attachmentUrl", v ?? "")} prompt="Upload the bill or quote" /></Field>
          </FormSection>
          <FormSection title="Who and when">
            <Field label="Approver" required error={errors.approverId} hint="Only people whose role can approve are listed"><PersonSelect value={f.approverId} onChange={(v) => set("approverId", v)} filter={(p) => p.canApprove} aria-label="Approver" /></Field>
            <Field label="Needed by" error={errors.needBy}><Input type="date" min={todayInIndia()} value={f.needBy} onChange={(e) => set("needBy", e.target.value)} /></Field>
            {!task && <Field label="Project" className="sm:col-span-2" hint="Optional"><ProjectSelect value={f.projectId} onChange={(v) => set("projectId", v)} aria-label="Project" /></Field>}
          </FormSection>
          {f.approverId === me?.user.id && <p className="text-xs text-destructive">You can&apos;t approve your own request. Choose someone else.</p>}
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send for approval"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DecideDialog({ request, decision, onClose, onSaved }: { request: Approval; decision: "approved" | "rejected"; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = React.useState("")
  const { errors, setErrors, error, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  const reject = decision === "rejected"
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (reject && !note.trim()) return setErrors({ note: "Say why it is rejected" })
    setBusy(true)
    try {
      await api.post(`/approvals/${request.id}/decide`, { decision, note: note.trim() || null, version: request.version })
      toast.success(reject ? "Rejected" : "Approved")
      onSaved()
    } catch (err) { fail(err); setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{reject ? "Reject" : "Approve"} {request.number}?</DialogTitle><DialogDescription>{request.title}{request.amountPaise ? ` · ${formatPaise(request.amountPaise)}` : ""} · asked by {request.requestedByName}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label={reject ? "Why it is rejected" : "Note"} required={reject} error={errors.note}><Textarea rows={3} maxLength={1000} autoFocus value={note} onChange={(e) => { setNote(e.target.value); setErrors({}) }} placeholder={reject ? "e.g. Get one more quote first" : "Optional"} /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" variant={reject ? "destructive" : "default"} disabled={busy}>{busy ? "Saving…" : reject ? "Reject" : "Approve"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
