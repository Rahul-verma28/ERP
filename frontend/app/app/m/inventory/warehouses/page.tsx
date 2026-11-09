"use client"

import * as React from "react"
import { toast } from "sonner"
import { Archive, ArchiveRestore, MapPin, Pencil, Phone, Plus, Star, Warehouse } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { DataList, localList } from "@/components/data-list"
import { Field, FormError, NativeSelect } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import type { StockLocation } from "@/lib/inventory"

function WarehouseDialog({ warehouse, onClose, onSaved }: { warehouse: StockLocation | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = React.useState({ name: warehouse?.name ?? "", address: warehouse?.address ?? "", city: warehouse?.city ?? "", zipCode: warehouse?.zipCode ?? "", phone: warehouse?.phone ?? "", email: warehouse?.email ?? "", status: warehouse && !warehouse.isActive ? "closed" : "active" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (form.name.trim().length < 2) return setErrors({ name: "Use at least 2 characters" })
    setBusy(true)
    setError(null)
    setErrors({})
    const { status, ...details } = form
    try {
      if (warehouse) await api.patch(`/stock-locations/${warehouse.id}`, { ...details, ...(status === "active" !== warehouse.isActive ? { isActive: status === "active" } : {}) })
      else await api.post("/stock-locations", details)
      toast.success("Warehouse saved")
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
        <DialogHeader><DialogTitle>{warehouse ? "Edit Warehouse" : "Create Warehouse"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <Field label="Name" required error={errors.name}><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Enter warehouse name" maxLength={60} autoFocus /></Field>
          <Field label="Address" error={errors.address}><Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Enter full address" maxLength={300} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="City" error={errors.city}><Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Enter city" maxLength={80} /></Field>
            <Field label="PIN code" error={errors.zipCode}><Input inputMode="numeric" value={form.zipCode} onChange={(e) => set("zipCode", e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Enter PIN code" /></Field>
            <Field label="Phone" error={errors.phone}><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Enter phone number" maxLength={20} /></Field>
            <Field label="Email" error={errors.email}><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="Enter email address" /></Field>
          </div>
          {warehouse && !warehouse.isDefault && (
            <Field label="Status">
              <NativeSelect value={form.status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </NativeSelect>
            </Field>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : warehouse ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function WarehousesPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const reload = () => setVersion((v) => v + 1)
  const [editing, setEditing] = React.useState<StockLocation | "new" | null>(null)
  if (!can("inventory.stock.view")) return <PageHeader title="Warehouses" description="You don't have access to stock. Ask your admin." />
  const act = async (g: StockLocation, patch: Record<string, unknown>, done: string) => {
    try {
      await api.patch(`/stock-locations/${g.id}`, patch)
      toast.success(done)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <>
      <DataList<StockLocation>
        id="warehouses"
        load={localList(async () => (await api.get<{ data: StockLocation[] }>("/stock-locations")).data, (w, q) => `${w.name} ${w.city ?? ""} ${w.address ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Manage Warehouses", description: "Where you keep stock. Sales take stock from the default warehouse.", primary: can("inventory.warehouse.create") ? <Button onClick={() => setEditing("new")}><Plus /> Create warehouse</Button> : undefined }}
        columns={[
          {
            key: "name", header: "Name", hideable: false, sort: (g) => g.name,
            cell: (g) => (
              <span className="flex items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Warehouse className="size-4" aria-hidden /></span>
                <span className="min-w-0"><span className="block font-medium">{g.name}{g.isDefault && <Badge variant="outline" className="ml-2">Default</Badge>}</span>{g.email && <span className="block text-xs text-muted-foreground">{g.email}</span>}</span>
              </span>
            ),
          },
          { key: "address", header: "Address", cell: (g) => (g.address ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5 text-muted-foreground" aria-hidden />{g.address}</span> : "—") },
          { key: "city", header: "City", sort: (g) => g.city ?? "", cell: (g) => g.city ?? "—" },
          { key: "zip", header: "PIN code", cell: (g) => (g.zipCode ? <Badge variant="outline">{g.zipCode}</Badge> : "—") },
          { key: "phone", header: "Phone", cell: (g) => (g.phone ? <span className="inline-flex items-center gap-1.5 tabular-nums"><Phone className="size-3.5 text-muted-foreground" aria-hidden />{g.phone}</span> : "—") },
          { key: "items", header: "Items in stock", align: "right", defaultHidden: true, sort: (g) => g.itemsInStock, cell: (g) => g.itemsInStock },
          { key: "value", header: "Value", align: "right", defaultHidden: true, sort: (g) => g.valuePaise, cell: (g) => formatPaise(g.valuePaise) },
          { key: "status", header: "Status", cell: (g) => <Badge variant={g.isActive ? "secondary" : "outline"}>{g.isActive ? "Active" : "Closed"}</Badge> },
          ...(can("inventory.warehouse.edit") ? [{
            key: "actions", header: "Actions", hideable: false,
            cell: (g: StockLocation) => (
              <span className="flex gap-0.5">
                <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)}><Pencil /></Button>
                {g.isActive && !g.isDefault && <Button variant="ghost" size="icon-sm" title="Make default" aria-label={`Make ${g.name} default`} onClick={() => act(g, { isDefault: true }, `${g.name} is the default`)}><Star /></Button>}
                {!g.isDefault && <Button variant="ghost" size="icon-sm" title={g.isActive ? "Close" : "Reopen"} aria-label={`${g.isActive ? "Close" : "Reopen"} ${g.name}`} onClick={() => act(g, { isActive: !g.isActive }, g.isActive ? `${g.name} closed` : `${g.name} reopened`)}>{g.isActive ? <Archive /> : <ArchiveRestore />}</Button>}
              </span>
            ),
          }] : []),
        ]}
        searchPlaceholder="Search warehouses"
        emptyState={<EmptyState icon={Warehouse} title="No warehouses yet" />}
      />
      {editing && <WarehouseDialog warehouse={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}
