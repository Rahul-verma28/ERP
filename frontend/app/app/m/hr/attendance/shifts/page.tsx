"use client"

import * as React from "react"
import { toast } from "sonner"
import { Clock, Layers, Moon, Users, Pencil, Plus, Star, Sun, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { ActionMenu, Pill } from "@/components/page-parts"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { SummaryCards } from "@/components/hr/summary-cards"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useHrLookups, type Shift } from "@/lib/hr"

// Shifts: working hours, break and grace time. Late marks and overtime are worked out from them.

const hm = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

function ShiftDialog({ shift, onClose, onSaved }: { shift: Shift | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ name: shift?.name ?? "", startsAt: shift?.startsAt ?? "09:30", endsAt: shift?.endsAt ?? "18:30", breakMinutes: String(shift?.breakMinutes ?? 60), graceMinutes: String(shift?.graceMinutes ?? 15), isNight: shift?.isNight ?? false, isDefault: shift?.isDefault ?? false, isActive: shift?.isActive ?? true })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  let span = toMin(f.endsAt || "00:00") - toMin(f.startsAt || "00:00")
  if (span <= 0) span += 24 * 60
  const work = Math.max(0, span - Number(f.breakMinutes || 0))
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.name.trim().length < 2) x.name = "Enter the shift name"
    if (!f.startsAt) x.startsAt = "Choose the start time"
    if (!f.endsAt) x.endsAt = "Choose the end time"
    else if (toMin(f.endsAt) <= toMin(f.startsAt) && !f.isNight) x.endsAt = "Ends before it starts: turn on Night shift"
    if (work < 60) x.breakMinutes = "Leaves less than an hour of work"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const body = { ...f, name: f.name.trim(), breakMinutes: Number(f.breakMinutes || 0), graceMinutes: Number(f.graceMinutes || 0) }
    try {
      if (shift) await api.put(`/hr/shifts/${shift.id}`, body)
      else await api.post("/hr/shifts", body)
      toast.success(shift ? "Shift saved" : `${body.name} shift added`)
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
        <DialogHeader><DialogTitle>{shift ? `Edit ${shift.name}` : "Add shift"}</DialogTitle><DialogDescription>Coming in after start + grace counts as late; working past the shift counts as overtime.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Name" required error={errors.name} className="sm:col-span-2"><Input value={f.name} autoFocus maxLength={60} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Morning, Evening, Night" /></Field>
          <Field label="Starts" required error={errors.startsAt}><Input type="time" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></Field>
          <Field label="Ends" required error={errors.endsAt}><Input type="time" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></Field>
          <Field label="Break" error={errors.breakMinutes}><NumberStepper max={240} step={15} suffix="min" value={f.breakMinutes} onChange={(v) => set("breakMinutes", v)} aria-label="Break minutes" /></Field>
          <Field label="Grace time" hint="Minutes allowed before late"><NumberStepper max={120} step={5} suffix="min" value={f.graceMinutes} onChange={(v) => set("graceMinutes", v)} aria-label="Grace minutes" /></Field>
          <label className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm"><span><span className="font-medium">Night shift</span><span className="block text-xs text-muted-foreground">Runs past midnight</span></span><Switch checked={f.isNight} onCheckedChange={(v) => set("isNight", v)} aria-label="Night shift" /></label>
          <label className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm"><span><span className="font-medium">Default</span><span className="block text-xs text-muted-foreground">For new employees</span></span><Switch checked={f.isDefault} onCheckedChange={(v) => set("isDefault", v)} aria-label="Default shift" /></label>
          <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm sm:col-span-2">Working time: <strong>{hm(work)}</strong> a day</p>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : shift ? "Save shift" : "Add shift"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function ShiftsPage() {
  const { can } = useAuth()
  const look = useHrLookups()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Shift | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<Shift | null>(null)
  if (!can("hr.attendance.view")) return <PageHeader title="Shifts" description="You don't have access to attendance. Ask your admin." />
  const reload = () => { setVersion((v) => v + 1); void look.reload() }
  const columns: Column<Shift>[] = [
    { key: "name", header: "Shift", hideable: false, sort: (s) => s.name, csv: (s) => s.name, cell: (s) => <span className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">{s.isNight ? <Moon className="size-4" /> : <Sun className="size-4" />}</span><span><span className="block font-medium">{s.name}{s.isDefault && <Pill color="blue" className="ml-2">Default</Pill>}</span><span className="text-xs text-muted-foreground">{s.isNight ? "Night shift" : "Day shift"}</span></span></span> },
    { key: "hours", header: "Hours", csv: (s) => `${s.startsAt}-${s.endsAt}`, cell: (s) => <span className="font-mono tabular-nums">{s.startsAt} – {s.endsAt}</span> },
    { key: "break", header: "Break", csv: (s) => s.breakMinutes, cell: (s) => `${s.breakMinutes} min` },
    { key: "grace", header: "Grace", csv: (s) => s.graceMinutes, cell: (s) => `${s.graceMinutes} min` },
    { key: "work", header: "Working time", csv: (s) => s.workingMinutes, cell: (s) => <span className="font-medium">{hm(s.workingMinutes)}</span> },
    { key: "employees", header: "People", align: "right", sort: (s) => s.employees, csv: (s) => s.employees, cell: (s) => <Pill color={s.employees ? "blue" : "slate"}>{s.employees} {s.employees === 1 ? "person" : "people"}</Pill> },
    { key: "status", header: "Status", csv: (s) => (s.isActive ? "Active" : "Off"), cell: (s) => <Pill color={s.isActive ? "emerald" : "slate"} dot>{s.isActive ? "Active" : "Off"}</Pill> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (s) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {can("hr.shift.edit") && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Pencil /></Button>}
          <ActionMenu label={`More actions for ${s.name}`} items={[
            can("hr.shift.edit") && !s.isDefault && { label: "Make default", icon: Star, onClick: async () => { try { await api.put(`/hr/shifts/${s.id}`, { ...s, isDefault: true }); toast.success(`${s.name} is the default`); reload() } catch (e) { toast.error(errorMessage(e)) } } },
            "-",
            can("hr.shift.delete") && !s.isDefault && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(s) },
          ]} />
        </span>
      ),
    },
  ]
  const all = look.data?.shifts ?? []
  const add = can("hr.shift.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Add shift</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.attendance} active="shifts" />
      {look.data && <SummaryCards className="mb-4" items={[
        { label: "Total shifts", value: all.length, hint: `${all.reduce((n, x) => n + x.employees, 0)} people on a shift`, color: "blue", icon: Layers },
        { label: "Active", value: all.filter((x) => x.isActive).length, hint: `${all.filter((x) => !x.isActive).length} turned off`, color: "emerald", icon: Users },
        { label: "Day shifts", value: all.filter((x) => !x.isNight).length, color: "amber", icon: Sun },
        { label: "Night shifts", value: all.filter((x) => x.isNight).length, color: "violet", icon: Moon },
      ]} />}
      <DataList<Shift>
        id="hr-shifts"
        load={localList(async () => (await api.get<{ data: Shift[] }>("/hr/shifts")).data, (s, q) => s.name.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Shifts", description: "Working hours for each shift. Pick an employee's shift on their profile.", primary: add }}
        columns={columns}
        searchPlaceholder="Search shift"
        rowClick={(s) => can("hr.shift.edit") && setEditing(s)}
        exportName="shifts"
        emptyState={<EmptyState icon={Clock} title="No shifts yet" action={add} />}
      />
      {editing && <ShiftDialog shift={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting?.name}?`} description="Only a shift nobody works can be deleted." confirmLabel="Delete shift"
        onConfirm={async () => { try { await api.delete(`/hr/shifts/${deleting!.id}`); toast.success("Shift deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
