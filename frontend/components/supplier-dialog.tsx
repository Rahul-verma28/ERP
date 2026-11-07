"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FormError } from "@/components/form"
import { StateSelect } from "@/components/search-select"
import { api, ApiError, errorMessage } from "@/lib/api"
import type { Supplier } from "@/lib/purchase"

// Add or change a supplier: name, GSTIN (state comes from it), phone, payment days, address.

type Props = { open: boolean; onOpenChange: (o: boolean) => void; supplier?: Supplier | null; onSaved: (s: Supplier) => void }

export function SupplierDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <SupplierForm {...props} />}
    </Dialog>
  )
}

function SupplierForm({ onOpenChange, supplier, onSaved }: Props) {
  const a = supplier?.address ?? {}
  const [form, setForm] = React.useState({
    name: supplier?.name ?? "", companyName: supplier?.companyName ?? "", gstin: supplier?.gstin ?? "", stateCode: supplier?.stateCode ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "",
    paymentDays: supplier?.paymentDays == null ? "" : String(supplier.paymentDays), line1: a.line1 ?? "", city: a.city ?? "", pincode: a.pincode ?? "", notes: supplier?.notes ?? "",
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function save() {
    if (form.name.trim().length < 2) return setErrors({ name: "Use at least 2 characters" })
    setBusy(true)
    setError(null)
    const gstin = form.gstin.trim().toUpperCase()
    const address = form.line1 || form.city || form.pincode ? { line1: form.line1.trim(), city: form.city.trim(), pincode: form.pincode.trim() } : null
    const body = {
      name: form.name.trim(), companyName: form.companyName.trim(), gstin, stateCode: form.stateCode || (gstin.length >= 2 ? gstin.slice(0, 2) : null), phone: form.phone.trim(), email: form.email.trim(),
      paymentDays: form.paymentDays === "" ? null : Number(form.paymentDays), address, notes: form.notes.trim(),
    }
    try {
      const s = supplier ? await api.patch<Supplier>(`/suppliers/${supplier.id}`, { ...body, version: supplier.version }) : await api.post<Supplier>("/suppliers", body)
      toast.success(supplier ? "Supplier saved" : `${s.name} added`)
      onSaved(s)
      onOpenChange(false)
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields)
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{supplier ? `Edit ${supplier.name}` : "New supplier"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required error={errors.name}><Input value={form.name} onChange={set("name")} maxLength={160} /></Field>
          <Field label="Firm name" error={errors.companyName}><Input value={form.companyName} onChange={set("companyName")} maxLength={160} /></Field>
          <Field label="GSTIN" hint="Empty if not registered: they charge no GST" error={errors.gstin}><Input value={form.gstin} onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase(), stateCode: e.target.value.length >= 2 && /^\d\d/.test(e.target.value) ? e.target.value.slice(0, 2) : f.stateCode }))} maxLength={15} className="font-mono" /></Field>
          <Field label="State" error={errors.stateCode}><StateSelect value={form.stateCode} onChange={(v) => setForm((f) => ({ ...f, stateCode: v ?? "" }))} /></Field>
          <Field label="Phone" error={errors.phone}><Input value={form.phone} onChange={set("phone")} inputMode="tel" maxLength={15} /></Field>
          <Field label="Email" error={errors.email}><Input value={form.email} onChange={set("email")} type="email" /></Field>
          <Field label="Payment days" hint="Bills fall due this many days after their date" error={errors.paymentDays}><Input value={form.paymentDays} onChange={(e) => setForm((f) => ({ ...f, paymentDays: e.target.value.replace(/\D/g, "").slice(0, 3) }))} inputMode="numeric" /></Field>
          <Field label="Address"><Input value={form.line1} onChange={set("line1")} maxLength={200} /></Field>
          <Field label="City"><Input value={form.city} onChange={set("city")} maxLength={100} /></Field>
          <Field label="PIN code"><Input value={form.pincode} onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) }))} inputMode="numeric" /></Field>
          <Field label="Notes" className="sm:col-span-2"><Input value={form.notes} onChange={set("notes")} maxLength={1000} /></Field>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save supplier"}</Button>
        </DialogFooter>
      </DialogContent>
  )
}
