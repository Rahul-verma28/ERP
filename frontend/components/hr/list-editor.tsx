"use client"

import * as React from "react"
import { toast } from "sonner"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/common"
import { Field, FormError } from "@/components/form"
import { Section } from "@/components/page-parts"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { LIST_LABEL, useHrLookups, type HrConfig, type ListKey } from "@/lib/hr"
import { useChanged } from "@/lib/use-dirty"

// One HR type list (award types, loan types, job locations…) as a table: name, description, actions.
// Used by every HR setup page so they all work the same way.

export async function saveHrConfig(patch: Partial<HrConfig>, done = "Saved") {
  try {
    await api.patch("/hr/settings", patch)
    toast.success(done)
    return true
  } catch (e) {
    toast.error(errorMessage(e))
    return false
  }
}

const noteKey = (list: ListKey, name: string) => `${list}::${name}`
const one = (label: string) => label.replace(/ies$/, "y").replace(/s$/, "").toLowerCase()

function ItemDialog({ title, value, note, taken, onClose, onSave }: { title: string; value: string; note: string; taken: (name: string) => boolean; onClose: () => void; onSave: (name: string, note: string) => Promise<boolean> }) {
  const [name, setName] = React.useState(value)
  const [desc, setDesc] = React.useState(note)
  const unchanged = !useChanged([name, desc])
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setError("Enter the name")
    if (taken(n)) return setError("Already in the list")
    setBusy(true)
    if (!(await onSave(n, desc.trim()))) setBusy(false)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Shows in the forms that use this list.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Name" required><Input value={name} autoFocus maxLength={60} onChange={(e) => { setName(e.target.value); setError(null) }} /></Field>
          <Field label="Description"><Textarea rows={2} maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional: when to use it" /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!value && unchanged)}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ListEditor({ list, title, description }: { list: ListKey; title?: string; description?: string }) {
  const { can } = useAuth()
  const look = useHrLookups()
  const edit = can("hr.setup.edit")
  const [editing, setEditing] = React.useState<string | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<string | null>(null)
  const cfg = look.data?.config
  const items = cfg?.lists[list] ?? []
  const notes = cfg?.listNotes ?? {}
  const label = title ?? LIST_LABEL[list]
  const save = async (next: string[], nextNotes: Record<string, string>, done: string) => {
    if (!cfg) return false
    const ok = await saveHrConfig({ lists: { ...cfg.lists, [list]: next }, listNotes: nextNotes } as Partial<HrConfig>, done)
    if (ok) await look.reload()
    return ok
  }
  const taken = (n: string, except?: string) => items.some((x) => x.toLowerCase() === n.toLowerCase() && x !== except)

  return (
    <Section title={label} description={description} action={edit ? <Button size="sm" onClick={() => setEditing("new")}><Plus /> Add</Button> : undefined} flush>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-5 py-2.5 text-left font-medium">Name</th><th className="px-5 py-2.5 text-left font-medium">Description</th><th className="w-24 px-5 py-2.5 text-right font-medium">Actions</th></tr></thead>
          <tbody className="divide-y">
            {items.map((v) => (
              <tr key={v} className="hover:bg-muted/30">
                <td className="px-5 py-2.5 font-medium">{v}</td>
                <td className="px-5 py-2.5 text-muted-foreground">{notes[noteKey(list, v)] || "—"}</td>
                <td className="px-5 py-1.5 text-right">{edit && <span className="inline-flex gap-0.5"><Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${v}`} onClick={() => setEditing(v)}><Pencil /></Button><Button variant="ghost" size="icon-sm" title="Delete" aria-label={`Delete ${v}`} onClick={() => setDeleting(v)}><Trash2 className="text-destructive" /></Button></span>}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={3} className="px-5 py-8 text-center text-muted-foreground">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && (
        <ItemDialog
          title={editing === "new" ? `Add ${one(label)}` : `Edit ${editing}`}
          value={editing === "new" ? "" : editing}
          note={editing === "new" ? "" : notes[noteKey(list, editing)] ?? ""}
          taken={(n) => taken(n, editing === "new" ? undefined : editing)}
          onClose={() => setEditing(null)}
          onSave={async (name, note) => {
            const nextNotes = { ...notes }
            if (editing !== "new") delete nextNotes[noteKey(list, editing)]
            if (note) nextNotes[noteKey(list, name)] = note
            const next = editing === "new" ? [...items, name] : items.map((x) => (x === editing ? name : x))
            const ok = await save(next, nextNotes, editing === "new" ? `${name} added` : "Saved")
            if (ok) setEditing(null)
            return ok
          }}
        />
      )}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting}?`} description="Records already saved with it keep the name." confirmLabel="Delete"
        onConfirm={async () => { const nextNotes = { ...notes }; delete nextNotes[noteKey(list, deleting!)]; await save(items.filter((x) => x !== deleting), nextNotes, `${deleting} deleted`) }} />
    </Section>
  )
}
