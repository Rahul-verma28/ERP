"use client"

import { StateSelect } from "@/components/search-select"
import * as React from "react"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {count} of {limit} branch{limit === 1 ? "" : "es"} used on your plan.
        </p>
        {can("tenant.branch.create") && (
          <Button onClick={() => setOpen(true)} disabled={count >= limit}>
            <Plus /> Add branch
          </Button>
        )}
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>State</TableHead>
                <TableHead>GSTIN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.data.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="pl-6 font-medium">
                    {b.name} {b.isDefault && <Badge variant="secondary" className="ml-2">Default</Badge>}
                  </TableCell>
                  <TableCell>{b.code}</TableCell>
                  <TableCell>{GST_STATES.find(([c]) => c === b.stateCode)?.[1] ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{b.gstin ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
