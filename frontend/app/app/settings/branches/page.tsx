"use client"

import { StateSelect } from "@/components/search-select"
import * as React from "react"
import { toast } from "sonner"
import { Building2, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/common"
import { DataList, localList } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { GST_STATES } from "@/lib/format"
import type { Branch } from "@/lib/types"

export default function BranchesPage() {
  const { can, me } = useAuth()
  const { data, reload } = useApi<{ data: Branch[] }>("/branches")
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState({ name: "", code: "", stateCode: "", gstin: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [version, setVersion] = React.useState(0)
  const count = data?.data.length ?? 0
  const limit = me?.limits?.branches ?? 1

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      await api.post("/branches", { name: form.name, code: form.code, stateCode: form.stateCode || undefined, gstin: form.gstin || undefined })
      toast.success("Branch added")
      setOpen(false)
      setForm({ name: "", code: "", stateCode: "", gstin: "" })
      await reload()
      setVersion((v) => v + 1)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <DataList<Branch>
        id="branches"
        load={localList(async () => (await api.get<{ data: Branch[] }>("/branches")).data, (b, q) => `${b.name} ${b.code} ${b.gstin ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Branches", description: `Locations with their own GSTIN, address and invoice series. ${count} of ${limit} used on your plan.`, primary: can("tenant.branch.create") ? <Button onClick={() => setOpen(true)} disabled={count >= limit}><Plus /> Add branch</Button> : undefined }}
        columns={[
          { key: "name", header: "Name", hideable: false, sort: (b) => b.name, cell: (b) => <span className="font-medium">{b.name}{b.isDefault && <Badge variant="secondary" className="ml-2">Default</Badge>}</span> },
          { key: "code", header: "Code", cell: (b) => b.code },
          { key: "state", header: "State", cell: (b) => GST_STATES.find(([c]) => c === b.stateCode)?.[1] ?? "—" },
          { key: "gstin", header: "GSTIN", cell: (b) => <span className="font-mono text-xs">{b.gstin ?? "—"}</span> },
        ]}
        searchPlaceholder="Search branches"
        emptyState={<EmptyState icon={Building2} title="No branches yet" />}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add branch</DialogTitle>
            <DialogDescription>Each branch can have its own address and GSTIN.</DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="grid gap-4">
            <Field label="Branch name" error={errors.name}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label="Short code" error={errors.code} hint="e.g. NOIDA-2">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required />
            </Field>
            <Field label="State" error={errors.stateCode}>
              <StateSelect value={form.stateCode} onChange={(v) => setForm({ ...form, stateCode: v })} />
            </Field>
            <Field label="GSTIN (optional)" error={errors.gstin}>
              <Input mask="gstin" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
            </Field>
            <FormError message={error} />
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add branch"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
