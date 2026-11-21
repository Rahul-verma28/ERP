"use client"

import { StateSelect } from "@/components/search-select"
import * as React from "react"
import { toast } from "sonner"
import { Archive, ArchiveRestore, Building2, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/common"
import { DataList, localList } from "@/components/data-list"
import { ActionMenu, Pill } from "@/components/page-parts"
import { Field, FormError } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useChanged } from "@/lib/use-dirty"
import { GST_STATES } from "@/lib/format"
import type { Branch } from "@/lib/types"

// Branches: add, edit, and make inactive the ones no longer used (their records stay).

export default function BranchesPage() {
  const { can, me } = useAuth()
  const { data, reload } = useApi<{ data: Branch[] }>("/branches")
  const [editing, setEditing] = React.useState<Branch | "new" | null>(null)
  const [version, setVersion] = React.useState(0)
  const count = data?.data.length ?? 0
  const limit = me?.limits?.branches ?? 1
  const canEdit = can("tenant.branch.edit")
  const refresh = async () => {
    await reload()
    setVersion((v) => v + 1)
  }

  async function toggle(b: Branch) {
    try {
      await api.patch(`/branches/${b.id}`, { isActive: b.isActive === false })
      toast.success(b.isActive === false ? `${b.name} is active again` : `${b.name} is inactive`)
      await refresh()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid gap-4">
      <DataList<Branch>
        id="branches"
        load={localList(async () => (await api.get<{ data: Branch[] }>("/branches")).data, (b, q) => `${b.name} ${b.code} ${b.gstin ?? ""}`.toLowerCase().includes(q), {
          filter: (b, p) => (p.show === "active" ? b.isActive !== false : p.show === "inactive" ? b.isActive === false : true),
          counts: (rows) => ({ all: rows.length, active: rows.filter((b) => b.isActive !== false).length, inactive: rows.filter((b) => b.isActive === false).length }),
        })}
        params={{ v: String(version) }}
        header={{
          title: "Branches",
          description: `Locations with their own GSTIN, address and invoice series. ${count} of ${limit} used on your plan.`,
          primary: can("tenant.branch.create") ? <Button onClick={() => setEditing("new")} disabled={count >= limit}><Plus /> Add branch</Button> : undefined,
        }}
        presetLabel="Show"
        presets={[
          { key: "active", label: "Active", params: { show: "active" }, countKey: "active" },
          { key: "inactive", label: "Inactive", params: { show: "inactive" }, countKey: "inactive" },
          { key: "all", label: "All", params: {}, countKey: "all" },
        ]}
        columns={[
          { key: "name", header: "Name", hideable: false, sort: (b) => b.name, csv: (b) => b.name, cell: (b) => <span className="flex items-center gap-2 font-medium">{b.name}{b.isDefault && <Pill color="blue">Main</Pill>}</span> },
          { key: "code", header: "Code", csv: (b) => b.code, cell: (b) => <span className="font-mono text-xs">{b.code}</span> },
          { key: "state", header: "State", csv: (b) => GST_STATES.find(([c]) => c === b.stateCode)?.[1] ?? "", cell: (b) => GST_STATES.find(([c]) => c === b.stateCode)?.[1] ?? <span className="text-muted-foreground">—</span> },
          { key: "gstin", header: "GSTIN", csv: (b) => b.gstin ?? "", cell: (b) => (b.gstin ? <span className="font-mono text-xs">{b.gstin}</span> : <span className="text-muted-foreground">Not registered</span>) },
          { key: "status", header: "Status", csv: (b) => (b.isActive === false ? "Inactive" : "Active"), cell: (b) => <Pill color={b.isActive === false ? "slate" : "emerald"} dot>{b.isActive === false ? "Inactive" : "Active"}</Pill> },
          {
            key: "actions", header: "Actions", hideable: false,
            cell: (b) => canEdit ? (
              <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${b.name}`} onClick={() => setEditing(b)}><Pencil /></Button>
                <ActionMenu label={`More actions for ${b.name}`} items={[
                  !b.isDefault && (b.isActive === false ? { label: "Make active", icon: ArchiveRestore, onClick: () => void toggle(b) } : { label: "Make inactive", icon: Archive, onClick: () => void toggle(b) }),
                ]} />
              </span>
            ) : null,
          },
        ]}
        rowClick={(b) => canEdit && setEditing(b)}
        searchPlaceholder="Search name, code or GSTIN"
        exportName="branches"
        emptyState={<EmptyState icon={Building2} title="No branches yet" />}
      />
      {editing && <BranchDialog branch={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} />}
    </div>
  )
}

function BranchDialog({ branch, onClose, onSaved }: { branch: Branch | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = React.useState({ name: branch?.name ?? "", code: branch?.code ?? "", stateCode: branch?.stateCode ?? "", gstin: branch?.gstin ?? "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const unchanged = !useChanged(form)

  function check() {
    const e: Record<string, string> = {}
    if (form.name.trim().length < 2) e.name = "Enter the branch name"
    if (!/^[A-Z0-9-]{2,12}$/.test(form.code)) e.code = "2–12 letters, digits or dashes"
    if (form.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(form.gstin)) e.gstin = "Enter a valid 15-character GSTIN"
    else if (form.gstin && form.stateCode && form.gstin.slice(0, 2) !== form.stateCode) e.gstin = "The GSTIN belongs to another state"
    setErrors(e)
    return !Object.keys(e).length
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!check()) return
    setBusy(true)
    setError(null)
    try {
      const body = { name: form.name.trim(), code: form.code, stateCode: form.stateCode || undefined, gstin: form.gstin || undefined }
      if (branch) await api.patch(`/branches/${branch.id}`, body)
      else await api.post("/branches", body)
      toast.success(branch ? "Branch saved" : "Branch added")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.name}` : "Add branch"}</DialogTitle>
          <DialogDescription>Each branch can have its own state and GSTIN, printed on its bills.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} noValidate className="grid gap-4">
          <Field label="Branch name" required error={errors.name}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Noida Sector 18" autoFocus aria-invalid={!!errors.name} />
          </Field>
          <Field label="Short code" required error={errors.code} hint="Used in bill numbers">
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12) })} placeholder="e.g. NOIDA-2" aria-invalid={!!errors.code} />
          </Field>
          <Field label="State" error={errors.stateCode}>
            <StateSelect value={form.stateCode} onChange={(v) => setForm({ ...form, stateCode: v })} />
          </Field>
          <Field label="GSTIN" error={errors.gstin} hint="Leave empty if this branch isn't registered separately">
            <Input mask="gstin" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="e.g. 09ABCDE1234F1Z5" aria-invalid={!!errors.gstin} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || (!!branch && unchanged)}>{busy ? "Saving…" : branch ? "Save branch" : "Add branch"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
