"use client"

import * as React from "react"
import { toast } from "sonner"
import { Building2, MapPin, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FormError, NativeSelect } from "@/components/form"
import { StateSelect } from "@/components/search-select"
import { FormSection } from "@/components/contact-dialog"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { StockLocation } from "@/lib/inventory"

// The one warehouse form, used on Manage Warehouses and from every warehouse dropdown.
// Where it is must be complete: e-way bills and stock transfers name the place goods leave from.

type Form = { name: string; contactPerson: string; address: string; city: string; zipCode: string; stateCode: string; phone: string; email: string; status: string; isDefault: boolean }

export function WarehouseFormDialog({ warehouse, initialName = "", onClose, onSaved }: { warehouse: StockLocation | null; initialName?: string; onClose: () => void; onSaved: (w: StockLocation) => void }) {
  const { me } = useAuth()
  const [form, setForm] = React.useState<Form>({
    name: warehouse?.name ?? initialName,
    contactPerson: warehouse?.contactPerson ?? "",
    address: warehouse?.address ?? "",
    city: warehouse?.city ?? "",
    zipCode: warehouse?.zipCode ?? "",
    // A new warehouse is most often in the business's own state
    stateCode: warehouse?.stateCode ?? (warehouse ? "" : me?.tenant?.billingStateCode ?? ""),
    phone: warehouse?.phone ?? "",
    email: warehouse?.email ?? "",
    status: warehouse && !warehouse.isActive ? "closed" : "active",
    isDefault: false,
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e))
    setError(null)
  }

  function check() {
    const e: Record<string, string> = {}
    if (form.name.trim().length < 2) e.name = "Enter the warehouse name (at least 2 letters)"
    if (form.address.trim().length < 3) e.address = "Enter the address"
    if (form.city.trim().length < 2) e.city = "Enter the city"
    if (!/^[1-9]\d{5}$/.test(form.zipCode)) e.zipCode = form.zipCode ? "PIN code is 6 digits and can't start with 0" : "Enter the PIN code"
    if (!form.stateCode) e.stateCode = "Choose the state"
    if (form.phone && !/^(\+\d[\d ]{7,17}|[6-9]\d{9}|0\d{9,11})$/.test(form.phone.replace(/\s/g, ""))) e.phone = "Enter a 10-digit mobile or a landline with STD code"
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) e.email = "Enter a valid email"
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    // A dropdown's form can sit inside another form (an invoice): keep the submit here
    ev.stopPropagation()
    if (!check()) return setError("Fix the marked fields first.")
    setBusy(true)
    const { status, isDefault, ...details } = form
    const body = { ...details, name: details.name.trim(), address: details.address.trim(), city: details.city.trim(), contactPerson: details.contactPerson.trim() || null, phone: details.phone || null, email: details.email.trim() || null }
    try {
      const saved = warehouse
        ? await api.patch<StockLocation>(`/stock-locations/${warehouse.id}`, { ...body, ...(status === "active" !== warehouse.isActive ? { isActive: status === "active" } : {}) })
        : await api.post<StockLocation>("/stock-locations", { ...body, ...(isDefault ? { isDefault: true } : {}) })
      toast.success(warehouse ? "Warehouse saved" : `${saved.name} added`)
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{warehouse ? "Edit warehouse" : "New warehouse"}</DialogTitle>
          <DialogDescription>A shop, godown or store where you keep stock. Sales and purchases pick it to move stock in or out.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-5" noValidate>
          <FormSection icon={Building2} title="Warehouse">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Warehouse name" required error={errors.name} hint="As your staff call it" className="sm:col-span-2">
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Ghaziabad godown" maxLength={60} autoFocus />
              </Field>
              <Field label="In-charge" error={errors.contactPerson} hint="Who receives and sends goods here">
                <Input mask="name" value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} placeholder="e.g. Suresh Kumar" />
              </Field>
              {warehouse && !warehouse.isDefault ? (
                <Field label="Status" hint="A closed warehouse can't take new stock">
                  <NativeSelect value={form.status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
                    <option value="active">Active</option>
                    <option value="closed">Closed</option>
                  </NativeSelect>
                </Field>
              ) : !warehouse ? (
                <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} /> Make this the default warehouse
                </label>
              ) : null}
            </div>
          </FormSection>

          <FormSection icon={MapPin} title="Address" hint="Printed as the dispatch-from address on e-way bills">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Address" required error={errors.address} className="sm:col-span-2">
                <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Plot, building, street, area" maxLength={300} />
              </Field>
              <Field label="City" required error={errors.city}><Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Ghaziabad" maxLength={80} /></Field>
              <Field label="PIN code" required error={errors.zipCode}><Input mask="pincode" value={form.zipCode} onChange={(e) => set("zipCode", e.target.value)} placeholder="6 digits, e.g. 201001" /></Field>
              <Field label="State" required error={errors.stateCode} className="sm:col-span-2">
                <StateSelect value={form.stateCode} onChange={(v) => set("stateCode", v)} aria-label="State" />
              </Field>
            </div>
          </FormSection>

          <FormSection icon={Phone} title="Contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone" error={errors.phone} hint="Mobile or landline with STD code"><Input mask="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="e.g. 9876543210" /></Field>
              <Field label="Email" error={errors.email}><Input mask="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="e.g. godown@yourshop.in" /></Field>
            </div>
          </FormSection>

          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : warehouse ? "Save warehouse" : "Add warehouse"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
