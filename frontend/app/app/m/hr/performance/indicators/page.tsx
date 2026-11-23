"use client"

import * as React from "react"
import { Gauge, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ActionMenu, Pill } from "@/components/page-parts"
import { HrTabs, ListSelect, TABS } from "@/components/hr/pickers"
import { saveHrConfig } from "@/components/hr/list-editor"
import { useAuth } from "@/lib/auth"
import { UNIT, useHrLookups, type Indicator } from "@/lib/hr"
import { useChanged } from "@/lib/use-dirty"
import { NoAccessPage } from "@/components/page-states"

// Performance indicators: what a review rates (each out of 5), grouped by category, with a target.

function IndicatorDialog({ row, all, onClose, onSaved }: { row: Indicator | null; all: Indicator[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ name: row?.name ?? "", category: row?.category ?? "", unit: row?.unit ?? "rating", target: row?.target ?? "", description: row?.description ?? "", active: row?.active ?? true })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const name = f.name.trim()
    if (name.length < 2) return setError("Enter the indicator name")
    if (all.some((c) => c.id !== row?.id && c.name.toLowerCase() === name.toLowerCase())) return setError("An indicator with this name already exists")
    setBusy(true)
    const next: Indicator = { id: row?.id ?? crypto.randomUUID(), name, category: f.category || null, unit: f.unit as Indicator["unit"], target: f.target.trim() || null, description: f.description.trim() || null, active: f.active }
    if (await saveHrConfig({ indicators: row ? all.map((c) => (c.id === row.id ? next : c)) : [...all, next] }, row ? "Indicator saved" : `${name} added`)) onSaved()
    else setBusy(false)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{row ? `Edit ${row.name}` : "Add indicator"}</DialogTitle><DialogDescription>Reviews rate each active indicator out of 5.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Name" required className="sm:col-span-2"><Input value={f.name} autoFocus maxLength={60} onChange={(e) => { setF({ ...f, name: e.target.value }); setError(null) }} placeholder="e.g. Billing accuracy" /></Field>
          <Field label="Category"><ListSelect list="indicatorCategories" value={f.category} onChange={(v) => setF({ ...f, category: v })} aria-label="Category" /></Field>
          <Field label="Measured as"><NativeSelect value={f.unit} aria-label="Measured as" onChange={(e) => setF({ ...f, unit: e.target.value as Indicator["unit"] })}>{Object.entries(UNIT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
          <Field label="Target" className="sm:col-span-2"><Input value={f.target} maxLength={40} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="e.g. 4 out of 5, 98%, ₹5 lakh" /></Field>
          <Field label="What it means" className="sm:col-span-2"><Textarea rows={2} maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Optional: how to judge it" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!row && unchanged)}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const PRESETS: ViewPreset[] = [{ key: "active", label: "Active", params: { show: "active" } }, { key: "inactive", label: "Inactive", params: { show: "inactive" } }, { key: "all", label: "All", params: {} }]

export default function IndicatorsPage() {
  const { can } = useAuth()
  const look = useHrLookups()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Indicator | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<Indicator | null>(null)
  if (!can("hr.performance.view")) return <NoAccessPage title="Performance indicators" permission="hr.performance.view" />
  const edit = can("hr.setup.edit")
  const all = look.data?.config.indicators ?? []
  const reload = async () => { await look.reload(); setVersion((v) => v + 1) }
  const put = async (next: Indicator[], done: string) => { if (await saveHrConfig({ indicators: next }, done)) await reload() }
  const columns: Column<Indicator>[] = [
    { key: "name", header: "Indicator", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Gauge className="size-4" /></span><span><span className="block font-medium">{r.name}</span>{r.description && <span className="block max-w-72 truncate text-xs text-muted-foreground">{r.description}</span>}</span></span> },
    { key: "category", header: "Category", sort: (r) => r.category ?? "", csv: (r) => r.category ?? "", cell: (r) => (r.category ? <Pill color="blue">{r.category}</Pill> : "—") },
    { key: "unit", header: "Measured as", csv: (r) => UNIT[r.unit], cell: (r) => UNIT[r.unit] },
    { key: "target", header: "Target", csv: (r) => r.target ?? "", cell: (r) => r.target ?? "—" },
    { key: "status", header: "Status", csv: (r) => (r.active ? "Active" : "Inactive"), cell: (r) => <Pill color={r.active ? "emerald" : "slate"} dot>{r.active ? "Active" : "Inactive"}</Pill> },
    { key: "actions", header: "Actions", hideable: false, cell: (r) => edit ? <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil /></Button><ActionMenu label="More actions" items={[{ label: r.active ? "Make inactive" : "Make active", icon: r.active ? Pause : Play, onClick: () => void put(all.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)), "Saved") }, "-", { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) }]} /></span> : null },
  ]
  const add = edit ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Add indicator</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.performance} active="indicators" />
      <DataList<Indicator>
        id="hr-indicators"
        load={localList(async (p) => all.filter((r) => (p.show === "active" ? r.active : p.show === "inactive" ? !r.active : true)), (r, q) => `${r.name} ${r.category ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version), n: String(all.length) }}
        header={{ title: "Performance indicators", description: "What every review rates out of 5. Only active ones appear when you conduct a review.", primary: add }}
        columns={columns}
        searchPlaceholder="Search indicator or category"
        presetLabel="Show"
        presets={PRESETS}
        filters={[{ key: "category", label: "Category", options: (look.data?.config.lists.indicatorCategories ?? []).map((c) => ({ value: c, label: c })) }]}
        rowClick={(r) => edit && setEditing(r)}
        exportName="performance-indicators"
        emptyState={<EmptyState icon={Gauge} title="No indicators here" action={add} />}
      />
      {editing && <IndicatorDialog row={editing === "new" ? null : editing} all={all} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting?.name}?`} description="Completed reviews keep their ratings." confirmLabel="Delete"
        onConfirm={async () => { await put(all.filter((c) => c.id !== deleting!.id), "Indicator deleted") }} />
    </>
  )
}
