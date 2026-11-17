"use client"

import * as React from "react"
import { toast } from "sonner"
import { ListChecks, Pause, Pencil, Play, Plus, Star, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { ActionMenu, Pill, Section, Tabs } from "@/components/page-parts"
import { ListSelect } from "@/components/hr/pickers"
import { ListEditor, saveHrConfig } from "@/components/hr/list-editor"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useHrLookups, type HrRecord } from "@/lib/hr"

// Recruitment setup: onboarding checklists (the tasks a new joiner goes through), their task
// categories, and the offer letter template.

interface Item { task: string; category?: string | null; dueDay: number; required: boolean }
interface C { name: string; isDefault: boolean; items: Item[] }
type Row = HrRecord<C>

function ChecklistDialog({ row, onClose, onSaved }: { row: Row | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(row?.data.name ?? "")
  const [isDefault, setDefault] = React.useState(row?.data.isDefault ?? false)
  const [items, setItems] = React.useState<(Item & { day: string })[]>((row?.data.items ?? [{ task: "", category: null, dueDay: 0, required: true }]).map((i) => ({ ...i, day: String(i.dueDay) })))
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const setItem = (i: number, patch: Partial<Item & { day: string }>) => { setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x))); setErrors({}); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (name.trim().length < 2) x.name = "Name the checklist"
    items.forEach((it, i) => { if (it.task.trim().length < 2) x[`items.${i}.task`] = "Name the task" })
    if (!items.length) x.items = "Add at least one task"
    setErrors(x)
    if (Object.keys(x).length) return setError(x.items ?? "Fix the marked fields first.")
    setBusy(true)
    const body = { name: name.trim(), isDefault, items: items.map((it) => ({ task: it.task.trim(), category: it.category || null, dueDay: Number(it.day || 0), required: it.required })) }
    try {
      if (row) await api.put(`/hr/records/checklist/${row.id}`, { ...body, version: row.version })
      else await api.post("/hr/records/checklist", body)
      toast.success(row ? "Checklist saved" : `${body.name} added`)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>{row ? `Edit ${row.data.name}` : "New onboarding checklist"}</DialogTitle><DialogDescription>Tasks a new joiner goes through. &quot;Day&quot; counts from their start date (0 = first day).</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Name" required error={errors.name}><Input value={name} autoFocus maxLength={80} onChange={(e) => { setName(e.target.value); setErrors({}) }} placeholder="e.g. Shop staff, Office staff" /></Field>
            <label className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm"><span className="font-medium">Default</span><Switch checked={isDefault} onCheckedChange={setDefault} aria-label="Default checklist" /></label>
          </div>
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">Task</th><th className="w-44 px-3 py-2 text-left font-medium">Category</th><th className="w-32 px-3 py-2 text-left font-medium">Day</th><th className="w-20 px-3 py-2 text-left font-medium">Must do</th><th className="w-10" /></tr></thead>
              <tbody className="divide-y">
                {items.map((it, i) => (
                  <tr key={i} className="align-top">
                    <td className="px-2 py-2"><Input value={it.task} maxLength={160} onChange={(e) => setItem(i, { task: e.target.value })} placeholder="e.g. Collect PAN and Aadhaar copy" aria-label={`Task ${i + 1}`} aria-invalid={!!errors[`items.${i}.task`]} />{errors[`items.${i}.task`] && <p className="mt-1 text-xs text-destructive">{errors[`items.${i}.task`]}</p>}</td>
                    <td className="px-2 py-2"><ListSelect list="onboardingCategories" value={it.category ?? ""} onChange={(v) => setItem(i, { category: v })} aria-label={`Category ${i + 1}`} /></td>
                    <td className="px-2 py-2"><NumberStepper max={365} size="sm" value={it.day} onChange={(v) => setItem(i, { day: v })} aria-label={`Day ${i + 1}`} /></td>
                    <td className="px-2 py-3"><Switch checked={it.required} onCheckedChange={(v) => setItem(i, { required: v })} aria-label={`Must do ${i + 1}`} /></td>
                    <td className="px-1 py-2"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove task ${i + 1}`} disabled={items.length <= 1} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}><Trash2 /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t p-2"><Button type="button" variant="ghost" size="sm" disabled={items.length >= 60} onClick={() => setItems((xs) => [...xs, { task: "", category: null, dueDay: 0, required: true, day: String(xs[xs.length - 1]?.day ?? "0") }])}><Plus /> Add task</Button></div>
          </div>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save checklist"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Checklists() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Row | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<Row | null>(null)
  const edit = can("hr.recruitment.edit")
  const reload = () => setVersion((v) => v + 1)
  async function status(r: Row, s: string) { try { await api.post(`/hr/records/checklist/${r.id}/status`, { status: s }); toast.success("Saved"); reload() } catch (e) { toast.error(errorMessage(e)) } }
  async function makeDefault(r: Row) { try { await api.put(`/hr/records/checklist/${r.id}`, { ...r.data, isDefault: true, version: r.version }); toast.success(`${r.data.name} is the default`); reload() } catch (e) { toast.error(errorMessage(e)) } }
  const columns: Column<Row>[] = [
    { key: "name", header: "Checklist", hideable: false, sort: (r) => r.data.name, csv: (r) => r.data.name, cell: (r) => <span className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><ListChecks className="size-4" /></span><span className="font-medium">{r.data.name}{r.data.isDefault && <Pill color="blue" className="ml-2">Default</Pill>}</span></span> },
    { key: "items", header: "Tasks", align: "right", csv: (r) => r.data.items.length, cell: (r) => <span title={r.data.items.map((i) => i.task).join(", ")}>{r.data.items.length}<span className="block text-xs text-muted-foreground">{r.data.items.filter((i) => i.required).length} must-do</span></span> },
    { key: "days", header: "Spread over", csv: (r) => Math.max(0, ...r.data.items.map((i) => i.dueDay)), cell: (r) => `${Math.max(0, ...r.data.items.map((i) => i.dueDay)) + 1} days` },
    { key: "status", header: "Status", csv: (r) => r.status, cell: (r) => <Pill color={r.status === "active" ? "emerald" : "slate"} dot>{r.status === "active" ? "Active" : "Inactive"}</Pill> },
    { key: "actions", header: "Actions", hideable: false, cell: (r) => edit ? <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${r.data.name}`} onClick={() => setEditing(r)}><Pencil /></Button><ActionMenu label="More actions" items={[!r.data.isDefault && { label: "Make default", icon: Star, onClick: () => void makeDefault(r) }, { label: r.status === "active" ? "Make inactive" : "Make active", icon: r.status === "active" ? Pause : Play, onClick: () => void status(r, r.status === "active" ? "inactive" : "active") }, "-", can("hr.recruitment.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) }]} /></span> : null },
  ]
  const add = can("hr.recruitment.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> New checklist</Button> : undefined
  return (
    <>
      <DataList<Row>
        id="hr-checklists"
        load={localList(async () => (await api.get<{ data: Row[] }>("/hr/records/checklist")).data, (r, q) => r.data.name.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Onboarding checklists", description: "Pick one when starting a new joiner's onboarding. The default is chosen for you.", primary: add }}
        columns={columns}
        searchPlaceholder="Search checklist"
        rowClick={(r) => edit && setEditing(r)}
        exportName="onboarding-checklists"
        emptyState={<EmptyState icon={ListChecks} title="No checklists yet" description="e.g. Day 0: collect documents, Day 1: billing training, Day 3: meet the team." action={add} />}
      />
      {editing && <ChecklistDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting?.data.name}?`} description="Only a checklist no onboarding uses can be deleted." confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/records/checklist/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}

const FIELDS = ["name", "position", "department", "salary", "joining", "expires", "company"]

function OfferTemplate() {
  const { can } = useAuth()
  const look = useHrLookups()
  const cfg = look.data?.config
  return cfg ? <OfferTemplateForm initial={cfg.offerTemplate} edit={can("hr.setup.edit")} onSaved={() => void look.reload()} /> : null
}

function OfferTemplateForm({ initial, edit, onSaved }: { initial: string; edit: boolean; onSaved: () => void }) {
  const [text, setText] = React.useState(initial)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const insert = (f: string) => {
    const el = ref.current
    const at = el?.selectionStart ?? text.length
    setText(`${text.slice(0, at)}{{${f}}}${text.slice(el?.selectionEnd ?? at)}`)
    requestAnimationFrame(() => el?.focus())
  }
  return (
    <Section title="Offer letter template" description="Used for every offer. Click a field to put it where the cursor is.">
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">{FIELDS.map((f) => <button key={f} type="button" disabled={!edit} onClick={() => insert(f)} className="rounded-full border px-2.5 py-1 font-mono text-xs hover:bg-muted">{`{{${f}}}`}</button>)}</div>
        <Textarea ref={ref} rows={14} maxLength={6000} value={text} disabled={!edit} onChange={(e) => setText(e.target.value)} className="font-mono text-sm" aria-label="Offer letter template" />
        {edit && <div className="flex gap-2"><Button disabled={text.trim().length < 20 || text === initial} onClick={async () => { if (await saveHrConfig({ offerTemplate: text }, "Offer letter saved")) onSaved() }}>Save template</Button>{text !== initial && <Button variant="ghost" onClick={() => setText(initial)}>Undo changes</Button>}</div>}
      </div>
    </Section>
  )
}

export default function RecruitmentSetupPage() {
  const { can } = useAuth()
  const [tab, setTab] = React.useState<"checklists" | "letter" | "categories">("checklists")
  if (!can("hr.setup.view") && !can("hr.recruitment.view")) return <PageHeader title="Recruitment setup" description="You don't have access to this. Ask your admin." />
  return (
    <div className="grid gap-5">
      <PageHeader title="Recruitment setup" description="Onboarding checklists, their task categories and the offer letter." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "checklists", label: "Onboarding checklists" }, { key: "categories", label: "Task categories" }, { key: "letter", label: "Offer letter" }]} />
      {tab === "checklists" && <Checklists />}
      {tab === "categories" && <div className="max-w-2xl"><ListEditor list="onboardingCategories" description="Groups for onboarding tasks" /></div>}
      {tab === "letter" && <OfferTemplate />}
    </div>
  )
}
