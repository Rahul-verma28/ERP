"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, FolderOpen, Pencil, PlusCircle, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/form"
import { WarehouseFormDialog } from "@/components/warehouse-form"
import type { StockLocation } from "@/lib/inventory"
import { SearchSelect, type SelectOption } from "@/components/search-select"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi as useApi } from "@/lib/use-api"

// Any dropdown whose records may not exist yet. "Manage or add" opens a modal to add, rename, remove
// and pick, so nobody leaves the form. For a new kind of record, wrap ManagedSelect with its calls.

export interface ManagedRow {
  id: string
  name: string
  /** Shown beside the name, e.g. Default */
  tag?: string
  /** This row cannot be removed */
  locked?: boolean
}

const message = (e: unknown) => (e instanceof ApiError ? (e.fields.name ?? e.message) : errorMessage(e))

function NameRow({ initial, placeholder, onSave, onCancel }: { initial: string; placeholder: string; onSave: (name: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = React.useState(initial)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save() {
    if (!name.trim()) return setError("Enter a name")
    setBusy(true)
    setError(null)
    try {
      await onSave(name.trim())
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-1 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save() } }} placeholder={placeholder} maxLength={60} autoFocus aria-label="Name" />
        <Button type="button" size="icon-sm" disabled={busy} aria-label="Save" title="Save" onClick={() => void save()}><Check /></Button>
        <Button type="button" variant="outline" size="icon-sm" aria-label="Cancel" title="Cancel" onClick={onCancel}><X /></Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function ManageDialog({ noun, plural, rows, typed, selected, canAdd, canEdit, canRemove, removeLabel = "Delete", removeQuestion, onAdd, onRename, onRemove, onApply, onClose, onOpenForm }: {
  noun: string
  plural: string
  rows: ManagedRow[]
  /** Text typed in the dropdown's search: starts a new one with that name */
  typed: string
  selected: string
  canAdd: boolean
  canEdit: boolean
  canRemove: boolean
  removeLabel?: string
  removeQuestion: string
  onAdd: (name: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onApply: (id: string) => void
  onClose: () => void
  /** Records with more than a name: add and edit open their full form instead of the inline name row */
  onOpenForm?: (id: string | null) => void
}) {
  const [adding, setAdding] = React.useState(!!typed && !onOpenForm)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [removing, setRemoving] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const link = "inline-flex items-center gap-1 text-[13px] hover:text-primary"
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage {title(plural)}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{plural}</p>
          {canAdd && <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" onClick={() => { if (onOpenForm) return onOpenForm(null); setAdding(true); setEditing(null) }}><PlusCircle className="size-4" /> Add new {noun}</button>}
        </div>
        <div className="max-h-[50svh] divide-y overflow-y-auto rounded-xl border">
          {adding && (
            <NameRow initial={typed} placeholder={`New ${noun} name`} onCancel={() => setAdding(false)} onSave={async (name) => { await onAdd(name); setAdding(false) }} />
          )}
          {rows.map((r) =>
            editing === r.id ? (
              <NameRow key={r.id} initial={r.name} placeholder="Name" onCancel={() => setEditing(null)} onSave={async (name) => { await onRename(r.id, name); setEditing(null) }} />
            ) : (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <FolderOpen className="size-4 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">{r.name}</span>
                  {r.tag && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{r.tag}</span>}
                  {r.id === selected && <Check className="size-4 text-primary" aria-label="Selected" />}
                </span>
                {removing === r.id ? (
                  <span className="flex items-center gap-3 text-[13px]">
                    {removeQuestion}
                    <button type="button" className="font-semibold text-destructive hover:underline" onClick={() => { setError(null); onRemove(r.id).then(() => setRemoving(null)).catch((e) => { setError(message(e)); setRemoving(null) }) }}>Yes</button>
                    <button type="button" className="font-semibold hover:underline" onClick={() => setRemoving(null)}>No</button>
                  </span>
                ) : (
                  <span className="flex items-center gap-3">
                    <button type="button" className={link} onClick={() => onApply(r.id)}>Apply this {noun}</button>
                    {canEdit && <button type="button" className={link} onClick={() => { if (onOpenForm) return onOpenForm(r.id); setEditing(r.id); setAdding(false) }}><Pencil className="size-3.5" /> Edit</button>}
                    {canRemove && !r.locked && <button type="button" className={link} onClick={() => setRemoving(r.id)}><Trash2 className="size-3.5" /> {removeLabel}</button>}
                  </span>
                )}
              </div>
            )
          )}
          {!rows.length && !adding && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No {plural} yet.</p>}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  "aria-label"?: string
  "aria-invalid"?: boolean
}

function ManagedSelect({ noun, plural, rows, placeholder, canManage, dialog, ...props }: SelectProps & { noun: string; plural: string; rows: ManagedRow[]; canManage: boolean; dialog: (typed: string, close: () => void) => React.ReactNode }) {
  const [open, setOpen] = React.useState<string | null>(null)
  return (
    <>
      <SearchSelect {...props} options={rows.map((r) => ({ value: r.id, label: r.name }))} placeholder={placeholder ?? `Select ${noun}`} searchPlaceholder={`Search ${plural}…`} searchable onCreate={canManage ? setOpen : undefined} createLabel={`Manage or add ${plural}`} />
      {open !== null && dialog(open, () => setOpen(null))}
    </>
  )
}

interface Named {
  id: string
  name: string
}

export function CategorySelect(props: SelectProps) {
  const { can } = useAuth()
  const list = useApi<{ data: Named[] }>("/item-categories")
  const rows = list.data?.data ?? []
  const canAdd = can("catalog.category.create")
  const canEdit = can("catalog.category.edit")
  const canRemove = can("catalog.category.delete")
  return (
    <ManagedSelect
      {...props}
      noun="category"
      plural="categories"
      rows={rows}
      canManage={canAdd || canEdit || canRemove}
      dialog={(typed, close) => (
        <ManageDialog
          noun="category"
          plural="categories"
          rows={rows}
          typed={typed}
          selected={props.value}
          canAdd={canAdd}
          canEdit={canEdit}
          canRemove={canRemove}
          removeQuestion="Items stay, without a category. Delete?"
          onClose={close}
          onApply={(id) => { props.onChange(id); close() }}
          onAdd={async (name) => { const c = await api.post<Named>("/item-categories", { name }); await list.reload(); props.onChange(c.id); toast.success(`${name} added`) }}
          onRename={async (id, name) => { await api.patch(`/item-categories/${id}`, { name }); await list.reload() }}
          onRemove={async (id) => { await api.delete(`/item-categories/${id}`); await list.reload(); if (props.value === id) props.onChange("") }}
        />
      )}
    />
  )
}

export function WarehouseSelect(props: SelectProps) {
  const { can } = useAuth()
  const list = useApi<{ data: StockLocation[] }>("/stock-locations")
  const all = list.data?.data ?? []
  const rows = all.filter((w) => w.isActive).map((w) => ({ id: w.id, name: w.city ? `${w.name} · ${w.city}` : w.name, tag: w.isDefault ? "Default" : undefined, locked: w.isDefault }))
  const canAdd = can("inventory.warehouse.create")
  const canEdit = can("inventory.warehouse.edit")
  // null = closed; "new" = add; an id = edit that one
  const [formFor, setFormFor] = React.useState<{ id: string | null; name: string } | null>(null)
  return (
    <>
      <ManagedSelect
        {...props}
        noun="warehouse"
        plural="warehouses"
        rows={rows}
        canManage={canAdd || canEdit}
        dialog={(typed, close) =>
          // Typed a name that is not in the list: go straight to the new warehouse form
          typed.trim() && canAdd ? (
            <WarehouseFormDialog warehouse={null} initialName={typed.trim()} onClose={close} onSaved={async (w) => { await list.reload(); props.onChange(w.id); close() }} />
          ) : (
            <ManageDialog
              noun="warehouse"
              plural="warehouses"
              rows={rows}
              typed=""
              selected={props.value}
              canAdd={canAdd}
              canEdit={canEdit}
              canRemove={canEdit}
              removeLabel="Close"
              removeQuestion="Close this warehouse?"
              onClose={close}
              onOpenForm={(id) => setFormFor({ id, name: "" })}
              onApply={(id) => { props.onChange(id); close() }}
              onAdd={async () => undefined}
              onRename={async () => undefined}
              onRemove={async (id) => { await api.patch(`/stock-locations/${id}`, { isActive: false }); await list.reload(); if (props.value === id) props.onChange("") }}
            />
          )
        }
      />
      {formFor && (
        <WarehouseFormDialog
          warehouse={formFor.id ? all.find((w) => w.id === formFor.id) ?? null : null}
          initialName={formFor.name}
          onClose={() => setFormFor(null)}
          onSaved={async (w) => { await list.reload(); if (!formFor.id) props.onChange(w.id); setFormFor(null) }}
        />
      )}
    </>
  )
}

const STANDARD_UNITS: SelectOption[] = [
  ["pcs", "Pieces (pcs)"], ["box", "Box"], ["pack", "Pack"], ["set", "Set"], ["pair", "Pair"], ["dozen", "Dozen"], ["kg", "Kilogram (kg)"], ["g", "Gram (g)"], ["quintal", "Quintal"], ["ton", "Tonne"],
  ["l", "Litre (l)"], ["ml", "Millilitre (ml)"], ["m", "Metre (m)"], ["ft", "Feet (ft)"], ["sqft", "Square feet"], ["bottle", "Bottle"], ["bag", "Bag"], ["roll", "Roll"], ["strip", "Strip"], ["hour", "Hour"], ["month", "Month"], ["service", "Service"],
].map(([value, label]) => ({ value, label }))

/** A unit is only a word on the item, so there is nothing to rename or remove: just add one */
export function UnitSelect({ placeholder, ...props }: SelectProps) {
  const used = useApi<{ data: string[] }>("/item-units")
  const [creating, setCreating] = React.useState<string | null>(null)
  const [added, setAdded] = React.useState<string[]>([])
  const known = new Set(STANDARD_UNITS.map((u) => u.value))
  const extra = [...new Set([...(used.data?.data ?? []), ...added, props.value].filter((u) => u && !known.has(u)))].map((u) => ({ value: u, label: u }))
  return (
    <>
      <SearchSelect {...props} options={[...STANDARD_UNITS, ...extra]} placeholder={placeholder ?? "Select unit"} searchPlaceholder="Search unit…" onCreate={setCreating} createLabel="Add unit" />
      {creating !== null && <AddUnitDialog initial={creating} onClose={() => setCreating(null)} onAdd={(u) => { setAdded((a) => [...a, u]); props.onChange(u); setCreating(null) }} />}
    </>
  )
}

function AddUnitDialog({ initial, onClose, onAdd }: { initial: string; onClose: () => void; onAdd: (unit: string) => void }) {
  const [name, setName] = React.useState(initial)
  const [error, setError] = React.useState<string | null>(null)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add unit</DialogTitle>
          <DialogDescription>For example carton, drum or tray.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (!name.trim()) return setError("Enter a name"); onAdd(name.trim()) }}>
          <Field label="Name" required error={error}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus /></Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
