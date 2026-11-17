"use client"

import * as React from "react"
import { toast } from "sonner"
import { Pause, Pencil, Play, Plus, RefreshCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column } from "@/components/data-list"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ActionMenu, Pill } from "@/components/page-parts"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { saveHrConfig } from "@/components/hr/list-editor"
import { useAuth } from "@/lib/auth"
import { FREQUENCY, useHrLookups, type Cycle } from "@/lib/hr"

// Review cycles: how often people are reviewed. Picked when setting up a review.

function CycleDialog({ cycle, all, onClose, onSaved }: { cycle: Cycle | null; all: Cycle[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ name: cycle?.name ?? "", frequency: cycle?.frequency ?? "quarterly", description: cycle?.description ?? "", active: cycle?.active ?? true })
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const name = f.name.trim()
    if (name.length < 2) return setError("Enter the cycle name")
    if (all.some((c) => c.id !== cycle?.id && c.name.toLowerCase() === name.toLowerCase())) return setError("A cycle with this name already exists")
    setBusy(true)
    const row: Cycle = { id: cycle?.id ?? crypto.randomUUID(), name, frequency: f.frequency as Cycle["frequency"], description: f.description.trim() || null, active: f.active }
    const next = cycle ? all.map((c) => (c.id === cycle.id ? row : c)) : [...all, row]
    if (await saveHrConfig({ cycles: next }, cycle ? "Cycle saved" : `${name} added`)) onSaved()
    else setBusy(false)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{cycle ? `Edit ${cycle.name}` : "Add review cycle"}</DialogTitle><DialogDescription>How often a review of this kind happens.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Name" required><Input value={f.name} autoFocus maxLength={60} onChange={(e) => { setF({ ...f, name: e.target.value }); setError(null) }} placeholder="e.g. Annual appraisal" /></Field>
          <Field label="How often"><NativeSelect value={f.frequency} aria-label="How often" onChange={(e) => setF({ ...f, frequency: e.target.value as Cycle["frequency"] })}>{Object.entries(FREQUENCY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
          <Field label="Description"><Textarea rows={2} maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Optional, e.g. Done in April for pay revisions" /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function CyclesPage() {
  const { can } = useAuth()
  const look = useHrLookups()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Cycle | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<Cycle | null>(null)
  if (!can("hr.performance.view")) return <PageHeader title="Review cycles" description="You don't have access to this. Ask your admin." />
  const edit = can("hr.setup.edit")
  const all = look.data?.config.cycles ?? []
  const reload = async () => { await look.reload(); setVersion((v) => v + 1) }
  const put = async (next: Cycle[], done: string) => { if (await saveHrConfig({ cycles: next }, done)) await reload() }
  const columns: Column<Cycle>[] = [
    { key: "name", header: "Cycle", hideable: false, sort: (c) => c.name, csv: (c) => c.name, cell: (c) => <span className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><RefreshCcw className="size-4" /></span><span><span className="block font-medium">{c.name}</span>{c.description && <span className="text-xs text-muted-foreground">{c.description}</span>}</span></span> },
    { key: "frequency", header: "How often", csv: (c) => FREQUENCY[c.frequency], cell: (c) => FREQUENCY[c.frequency] },
    { key: "status", header: "Status", csv: (c) => (c.active ? "Active" : "Inactive"), cell: (c) => <Pill color={c.active ? "emerald" : "slate"} dot>{c.active ? "Active" : "Inactive"}</Pill> },
    { key: "actions", header: "Actions", hideable: false, cell: (c) => edit ? <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Pencil /></Button><ActionMenu label="More actions" items={[{ label: c.active ? "Make inactive" : "Make active", icon: c.active ? Pause : Play, onClick: () => void put(all.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)), "Saved") }, "-", { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(c) }]} /></span> : null },
  ]
  const add = edit ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Add cycle</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.performance} active="cycles" />
      <DataList<Cycle>
        id="hr-cycles"
        load={localList(async () => all, (c, q) => c.name.toLowerCase().includes(q))}
        params={{ v: String(version), n: String(all.length) }}
        header={{ title: "Review cycles", description: "How often people are reviewed: quarterly, yearly, at the end of probation.", primary: add }}
        columns={columns}
        searchPlaceholder="Search cycle"
        rowClick={(c) => edit && setEditing(c)}
        exportName="review-cycles"
        emptyState={<EmptyState icon={RefreshCcw} title="No review cycles" action={add} />}
      />
      {editing && <CycleDialog cycle={editing === "new" ? null : editing} all={all} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting?.name}?`} description="Reviews already made keep the name." confirmLabel="Delete"
        onConfirm={async () => { await put(all.filter((c) => c.id !== deleting!.id), "Cycle deleted"); toast.dismiss() }} />
    </>
  )
}
