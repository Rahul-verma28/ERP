"use client"

import * as React from "react"
import { toast } from "sonner"
import { CalendarDays, Pause, Pencil, Play, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { ActionMenu, Pill } from "@/components/page-parts"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useHrLookups, type LeaveType } from "@/lib/hr"
import { tone } from "@/lib/tones"
import { cn } from "@/lib/utils"

// Leave types: an add/edit form on the left, every type on the right — name, what it is for,
// days a year, paid or unpaid, and whether it can be applied for.

const COLORS = ["emerald", "rose", "amber", "blue", "violet", "slate", "orange"]
const blank = { name: "", code: "", description: "", daysPerYear: "12", paid: true, carryForward: false, color: "emerald", isActive: true }

function LeaveTypeForm({ editing, onDone }: { editing: LeaveType | null; onDone: () => void }) {
  const [f, setF] = React.useState(() => (editing ? { name: editing.name, code: editing.code, description: editing.description ?? "", daysPerYear: String(editing.daysPerYear), paid: editing.paid, carryForward: editing.carryForward, color: editing.color, isActive: editing.isActive } : blank))
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v, ...(k === "name" && !editing && !x.code ? {} : {}) })); setErrors({}); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.name.trim().length < 2) x.name = "Enter the leave name"
    const code = f.code.trim() || f.name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 4).toUpperCase()
    if (!code) x.code = "Enter a short code"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const body = { ...f, name: f.name.trim(), code, description: f.description.trim() || null, daysPerYear: Number(f.daysPerYear || 0) }
    try {
      if (editing) await api.put(`/hr/leave-types/${editing.id}`, body)
      else await api.post("/hr/leave-types", body)
      toast.success(editing ? `${body.name} saved` : `${body.name} added`)
      setF(blank)
      setBusy(false)
      onDone()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <form onSubmit={save} className="ui-surface grid gap-4 p-5" noValidate>
      <div><h2 className="font-semibold">{editing ? `Edit ${editing.name}` : "Add new leave type"}</h2><p className="text-xs text-muted-foreground">{editing ? "Changes apply to new requests." : "Fill in the details to create a new leave type."}</p></div>
      <Field label="Leave type name" required error={errors.name}><Input value={f.name} maxLength={60} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Casual leave, Sick leave" /></Field>
      <Field label="Description"><Textarea rows={2} maxLength={300} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Short description of the leave policy" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Max days / year" required hint="0 = no limit"><NumberStepper decimals max={366} value={f.daysPerYear} onChange={(v) => set("daysPerYear", v)} aria-label="Max days a year" /></Field>
        <Field label="Short code" error={errors.code} hint="Shows in the register"><Input value={f.code} maxLength={6} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="e.g. CL" className="font-mono uppercase" /></Field>
      </div>
      <Field label="Colour"><div className="flex flex-wrap gap-2">{COLORS.map((c) => <button key={c} type="button" aria-label={c} aria-pressed={f.color === c} onClick={() => set("color", c)} className={cn("size-7 rounded-full ring-offset-2 ring-offset-background", tone(c).dot, f.color === c && "ring-2 ring-primary")} />)}</div></Field>
      <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm"><span><span className="font-medium">Paid leave</span><span className="block text-xs text-muted-foreground">Employees get salary for these days</span></span><Switch checked={f.paid} onCheckedChange={(v) => set("paid", v)} aria-label="Paid leave" /></label>
      <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm"><span><span className="font-medium">Carry forward</span><span className="block text-xs text-muted-foreground">Unused days move to next year</span></span><Switch checked={f.carryForward} onCheckedChange={(v) => set("carryForward", v)} aria-label="Carry forward" /></label>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={busy}>{busy ? "Saving…" : editing ? "Save leave type" : "Add leave type"}</Button>
        {editing && <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>}
      </div>
    </form>
  )
}

const PRESETS: ViewPreset[] = [{ key: "all", label: "All", params: {} }, { key: "paid", label: "Paid", params: { pay: "paid" } }, { key: "unpaid", label: "Unpaid", params: { pay: "unpaid" } }]

export function LeaveTypes() {
  const { can } = useAuth()
  const look = useHrLookups()
  const edit = can("hr.setup.edit")
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<LeaveType | null>(null)
  const [deleting, setDeleting] = React.useState<LeaveType | null>(null)
  const reload = () => { setVersion((v) => v + 1); void look.reload() }
  async function toggle(t: LeaveType) {
    try { await api.put(`/hr/leave-types/${t.id}`, { ...t, isActive: !t.isActive }); toast.success(t.isActive ? `${t.name} turned off` : `${t.name} turned on`); reload() } catch (e) { toast.error(errorMessage(e)) }
  }
  const columns: Column<LeaveType>[] = [
    { key: "name", header: "Leave type", hideable: false, sort: (t) => t.name, csv: (t) => t.name, cell: (t) => <span className="flex items-center gap-3"><span className={cn("grid size-9 shrink-0 place-items-center rounded-xl text-white", tone(t.color).dot)}><CalendarDays className="size-4" /></span><span className="min-w-0"><span className="block font-medium">{t.name} <span className="font-mono text-xs text-muted-foreground">{t.code}</span></span><span className="block max-w-80 truncate text-xs text-muted-foreground">{t.description || "—"}</span></span></span> },
    { key: "days", header: "Days / year", align: "right", sort: (t) => t.daysPerYear, csv: (t) => t.daysPerYear, cell: (t) => <span className="font-medium tabular-nums">{t.daysPerYear ? `${t.daysPerYear} days` : "No limit"}</span> },
    { key: "pay", header: "Payment type", csv: (t) => (t.paid ? "Paid" : "Unpaid"), cell: (t) => <Pill color={t.paid ? "emerald" : "amber"}>{t.paid ? "Paid" : "Unpaid"}</Pill> },
    { key: "carry", header: "Carry forward", defaultHidden: true, csv: (t) => (t.carryForward ? "Yes" : "No"), cell: (t) => (t.carryForward ? "Yes" : "No") },
    { key: "status", header: "Status", csv: (t) => (t.isActive ? "Active" : "Off"), cell: (t) => <Pill color={t.isActive ? "emerald" : "slate"} dot>{t.isActive ? "Active" : "Off"}</Pill> },
    { key: "actions", header: "Actions", hideable: false, cell: (t) => edit ? <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil /></Button><ActionMenu label="More actions" items={[{ label: t.isActive ? "Turn off" : "Turn on", icon: t.isActive ? Pause : Play, onClick: () => void toggle(t) }, "-", { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(t) }]} /></span> : null },
  ]
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      {edit && <div className="xl:sticky xl:top-4"><LeaveTypeForm key={editing?.id ?? "new"} editing={editing} onDone={() => { setEditing(null); reload() }} /></div>}
      <DataList<LeaveType>
        id="hr-leave-types"
        load={localList(async (p) => (await api.get<{ data: LeaveType[] }>("/hr/leave-types")).data.filter((t) => (p.pay === "paid" ? t.paid : p.pay === "unpaid" ? !t.paid : true)), (t, q) => `${t.name} ${t.code} ${t.description ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Leave types", description: "Leave categories, days allowed a year, and whether they are paid." }}
        columns={columns}
        searchPlaceholder="Search leave types"
        presetLabel="Show"
        presets={PRESETS}
        rowClick={(t) => edit && setEditing(t)}
        exportName="leave-types"
        emptyState={<EmptyState icon={CalendarDays} title="No leave types" />}
      />
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting?.name}?`} description="Only a type nobody has applied for can be deleted. Otherwise turn it off." confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/leave-types/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </div>
  )
}
