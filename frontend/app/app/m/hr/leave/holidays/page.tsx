"use client"

import * as React from "react"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, Pencil, Plus, PartyPopper, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { ActionMenu, Pill } from "@/components/page-parts"
import { HrTabs, ListSelect, TABS } from "@/components/hr/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { DAY_NAMES } from "@/lib/hr"
import { useChanged } from "@/lib/use-dirty"
import { NoAccessPage } from "@/components/page-states"

// Holidays for the year: leave doesn't count them, attendance shows them, payroll pays them.

interface Holiday { id: string; name: string; fromDate: string; toDate: string; kind: string; paid: boolean; optional: boolean; notes: string | null }
// Holiday types come from System Setup; older entries saved in lower case read the same
const COLORS = ["blue", "orange", "violet", "emerald", "slate", "rose", "amber"]
const typeName = (k: string) => k.charAt(0).toUpperCase() + k.slice(1)
const typeColor = (k: string) => COLORS[[...k.toLowerCase()].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length]
const days = (h: { fromDate: string; toDate: string }) => Math.round((new Date(h.toDate).getTime() - new Date(h.fromDate).getTime()) / 86_400_000) + 1

function HolidayDialog({ holiday, onClose, onSaved }: { holiday: Holiday | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ name: holiday?.name ?? "", fromDate: holiday?.fromDate.slice(0, 10) ?? todayInIndia(), toDate: holiday?.toDate.slice(0, 10) ?? "", kind: holiday ? typeName(holiday.kind) : "Festival", paid: holiday?.paid ?? true, optional: holiday?.optional ?? false, notes: holiday?.notes ?? "" })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.name.trim().length < 2) x.name = "Enter the holiday name"
    if (!f.fromDate) x.fromDate = "Choose the date"
    if (f.toDate && f.toDate < f.fromDate) x.toDate = "Must be on or after the start"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const body = { ...f, name: f.name.trim(), toDate: f.toDate || null, notes: f.notes.trim() || null }
    try {
      if (holiday) await api.put(`/hr/holidays/${holiday.id}`, body)
      else await api.post("/hr/holidays", body)
      toast.success(holiday ? "Holiday saved" : `${body.name} added`)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{holiday ? "Edit holiday" : "Add holiday"}</DialogTitle><DialogDescription>Leave over this day is not counted, and attendance shows it.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Name" required error={errors.name} className="sm:col-span-2"><Input value={f.name} autoFocus maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Diwali" /></Field>
          <Field label="Date" required error={errors.fromDate}><Input type="date" value={f.fromDate} onChange={(e) => set("fromDate", e.target.value)} /></Field>
          <Field label="Till (for more days)" error={errors.toDate}><Input type="date" value={f.toDate} min={f.fromDate} onChange={(e) => set("toDate", e.target.value)} /></Field>
          <Field label="Holiday type" className="sm:col-span-2" hint="Add types in System Setup → Holiday Types"><ListSelect list="holidayTypes" value={f.kind} onChange={(v) => set("kind", v)} aria-label="Holiday type" /></Field>
          <label className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm"><span className="font-medium">Paid</span><Switch checked={f.paid} onCheckedChange={(v) => set("paid", v)} aria-label="Paid" /></label>
          <label className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm"><span><span className="font-medium">Optional</span><span className="block text-xs text-muted-foreground">Staff choose to take it</span></span><Switch checked={f.optional} onCheckedChange={(v) => set("optional", v)} aria-label="Optional" /></label>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!holiday && unchanged)}>{busy ? "Saving…" : holiday ? "Save" : "Add holiday"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function HolidaysPage() {
  const { can } = useAuth()
  const [year, setYear] = React.useState(Number(todayInIndia().slice(0, 4)))
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Holiday | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<Holiday | null>(null)
  if (!can("hr.leave.view")) return <NoAccessPage title="Holidays" permission="hr.leave.view" />
  const edit = can("hr.setup.edit")
  const today = todayInIndia()
  const columns: Column<Holiday>[] = [
    { key: "start", header: "Start date", hideable: false, sort: (h) => h.fromDate, csv: (h) => h.fromDate.slice(0, 10), cell: (h) => <span className={h.toDate.slice(0, 10) < today ? "text-muted-foreground" : ""}><span className="font-medium">{formatDate(h.fromDate)}</span><span className="block text-xs text-muted-foreground">{DAY_NAMES[new Date(h.fromDate).getUTCDay()]}</span></span> },
    { key: "end", header: "End date", csv: (h) => h.toDate.slice(0, 10), cell: (h) => <span className={h.toDate.slice(0, 10) < today ? "text-muted-foreground" : ""}>{formatDate(h.toDate)}</span> },
    { key: "days", header: "Total days", align: "right", sort: (h) => days(h), csv: (h) => days(h), cell: (h) => <Pill color="blue">{days(h)} day{days(h) === 1 ? "" : "s"}</Pill> },
    { key: "name", header: "Holiday", sort: (h) => h.name, csv: (h) => h.name, cell: (h) => <span className="font-medium">{h.name}</span> },
    { key: "kind", header: "Holiday type", csv: (h) => typeName(h.kind), cell: (h) => <Pill color={typeColor(h.kind)}>{typeName(h.kind)}</Pill> },
    { key: "paid", header: "Paid", csv: (h) => (h.paid ? "Paid" : "Unpaid"), cell: (h) => <span className="grid gap-0.5"><Pill color={h.paid ? "emerald" : "rose"}>{h.paid ? "Paid" : "Unpaid"}</Pill>{h.optional && <span className="text-xs text-muted-foreground">Optional</span>}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (h) => edit ? (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${h.name}`} onClick={() => setEditing(h)}><Pencil /></Button>
          <ActionMenu label={`More actions for ${h.name}`} items={[{ label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(h) }]} />
        </span>
      ) : null,
    },
  ]
  const add = edit ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Add holiday</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.leave} active="holidays" />
      <DataList<Holiday>
        id="hr-holidays"
        load={localList(async (p) => (await api.get<{ data: Holiday[] }>(`/hr/holidays?year=${p.year}`)).data, (h, q) => h.name.toLowerCase().includes(q))}
        params={{ year: String(year), v: String(version) }}
        header={{ title: `Holidays ${year}`, description: "Leave doesn't count these days; attendance and payroll know them.", primary: add, actions: <div className="flex items-center gap-1"><Button variant="outline" size="icon" aria-label="Previous year" onClick={() => setYear(year - 1)}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label="Next year" onClick={() => setYear(year + 1)}><ChevronRight /></Button></div> }}
        columns={columns}
        searchPlaceholder="Search holiday"
        rowClick={(h) => edit && setEditing(h)}
        exportName={`holidays-${year}`}
        emptyState={<EmptyState icon={PartyPopper} title={`No holidays for ${year}`} description="Add Republic Day, Holi, Independence Day, Diwali and the rest your business closes for." action={add} />}
      />
      {editing && <HolidayDialog holiday={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setVersion((v) => v + 1) }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting?.name}?`} confirmLabel="Delete holiday"
        onConfirm={async () => { try { await api.delete(`/hr/holidays/${deleting!.id}`); toast.success("Holiday deleted"); setVersion((v) => v + 1) } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
