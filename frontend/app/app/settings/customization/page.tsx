"use client"

import * as React from "react"
import { toast } from "sonner"
import { Archive, Plus, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Field, FormError, NativeSelect } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { InlineSave } from "@/components/save-bar"

interface FieldDef {
  id: string
  entity: string
  key: string
  label: string
  type: string
  required: boolean
  options: string[] | null
  archivedAt: string | null
  source: "template" | "tenant"
  version: number
}

const TERM_LABELS: Record<string, string> = {
  "entity.contact.singular": "Customer (singular)",
  "entity.contact.plural": "Customers (plural)",
  "entity.lead.singular": "Lead (singular)",
  "entity.lead.plural": "Leads (plural)",
  "entity.item.singular": "Item (singular)",
  "entity.item.plural": "Items (plural)",
  "entity.appointment.singular": "Appointment (singular)",
  "entity.appointment.plural": "Appointments (plural)",
  "entity.order.singular": "Order (singular)",
  "entity.order.plural": "Orders (plural)",
  "entity.employee.singular": "Employee (singular)",
  "entity.employee.plural": "Employees (plural)",
  "role.service_provider": "Service provider role",
}

const ENTITIES = [
  ["contact", "Customers"],
  ["lead", "Leads"],
  ["item", "Products & services"],
  ["invoice", "Invoices"],
  ["employee", "Employees"],
  ["appointment", "Appointments"],
  ["task", "Tasks"],
  ["ticket", "Tickets"],
] as const

const TYPES = [
  ["text", "Text"],
  ["number", "Number"],
  ["date", "Date"],
  ["dropdown", "Dropdown"],
  ["multi_select", "Multi-select"],
  ["checkbox", "Checkbox"],
] as const

function Terminology({ editable }: { editable: boolean }) {
  const { reload } = useAuth()
  const res = useApi<{ terms: Record<string, string> }>("/config/terms")
  // The words being edited; null = as saved
  const [draft, setDraft] = React.useState<Record<string, string> | null>(null)
  const [busy, setBusy] = React.useState(false)
  if (!res.data) return null
  const data = { terms: draft ?? res.data.terms }
  const setData = (next: { terms: Record<string, string> }) => setDraft(next.terms)
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(res.data.terms)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.put("/config/terms", { terms: data.terms })
      await Promise.all([reload(), res.reload()])
      setDraft(null)
      toast.success("Terminology saved")
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Terminology</CardTitle>
        <CardDescription>Use your industry&apos;s words across the app — e.g. Client, Patient, Student or Member.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.keys(TERM_LABELS).map((k) => (
              <Field key={k} label={TERM_LABELS[k]!}>
                <Input value={data.terms[k] ?? ""} onChange={(e) => setData({ terms: { ...data.terms, [k]: e.target.value } })} disabled={!editable} required maxLength={40} />
              </Field>
            ))}
          </div>
          {editable && <InlineSave dirty={dirty} saving={busy} onDiscard={() => setDraft(null)} onSave={() => void save({ preventDefault() {} } as React.FormEvent)} saveLabel="Save terminology" />}
        </form>
      </CardContent>
    </Card>
  )
}

function CustomFields({ editable }: { editable: boolean }) {
  const [entity, setEntity] = React.useState<string>("contact")
  const { data, reload } = useApi<{ data: FieldDef[] }>(`/config/fields?entity=${entity}`)
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState({ label: "", key: "", type: "text", required: false, options: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)

  const toKey = (label: string) => label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setErrors({})
    try {
      await api.post("/config/fields", {
        entity,
        label: form.label,
        key: form.key || toKey(form.label),
        type: form.type,
        required: form.required,
        options: ["dropdown", "multi_select"].includes(form.type) ? form.options.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      })
      toast.success("Field added")
      setOpen(false)
      setForm({ label: "", key: "", type: "text", required: false, options: "" })
      await reload()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    }
  }

  async function toggleArchive(f: FieldDef) {
    try {
      await api.patch(`/config/fields/${f.id}`, { archived: !f.archivedAt, version: f.version })
      await reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom fields</CardTitle>
        <CardDescription>Add your own fields to records. Inactive fields keep their data but are hidden from forms.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <NativeSelect className="w-56" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Record type">
            {ENTITIES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
          {editable && (
            <Button variant="outline" onClick={() => setOpen(true)}>
              <Plus /> Add field
            </Button>
          )}
        </div>
        <ul className="grid gap-2">
          {data?.data.length === 0 && <li className="text-sm text-muted-foreground">No custom fields for this record type yet.</li>}
          {data?.data.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 text-sm">
              <span className={f.archivedAt ? "text-muted-foreground line-through" : "font-medium"}>{f.label}</span>
              <Badge variant="secondary" className="h-5 text-[10px]">
                {TYPES.find(([t]) => t === f.type)?.[1] ?? f.type}
              </Badge>
              {f.required && <Badge variant="outline" className="h-5 text-[10px]">Required</Badge>}
              {f.source === "template" && <Badge variant="outline" className="h-5 text-[10px]">From template</Badge>}
              {f.options && <span className="truncate text-xs text-muted-foreground">{f.options.join(", ")}</span>}
              {editable && (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => toggleArchive(f)}>
                  {f.archivedAt ? <RotateCcw /> : <Archive />} {f.archivedAt ? "Make active" : "Make inactive"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add custom field</DialogTitle>
            <DialogDescription>Applies to {ENTITIES.find(([k]) => k === entity)?.[1].toLowerCase()}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="grid gap-4">
            <Field label="Label" error={errors.label}>
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required />
            </Field>
            <Field label="Key" error={errors.key} hint={`Used in imports and reports · ${form.key || toKey(form.label) || "auto"}`}>
              <Input value={form.key} placeholder={toKey(form.label)} onChange={(e) => setForm({ ...form, key: e.target.value })} />
            </Field>
            <Field label="Type">
              <NativeSelect value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map(([t, l]) => (
                  <option key={t} value={t}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {["dropdown", "multi_select"].includes(form.type) && (
              <Field label="Options" error={errors.options} hint="Separate with commas">
                <Input value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} required />
              </Field>
            )}
            <div className="flex items-center gap-2">
              <Checkbox id="required" checked={form.required} onCheckedChange={(v) => setForm({ ...form, required: !!v })} />
              <Label htmlFor="required">Required</Label>
            </div>
            <FormError message={error} />
            <DialogFooter>
              <Button type="submit">Add field</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export default function CustomizationPage() {
  const { can } = useAuth()
  const editable = can("tenant.config.edit")
  return (
    <div className="grid gap-6">
      <Terminology editable={editable} />
      <CustomFields editable={editable} />
    </div>
  )
}
