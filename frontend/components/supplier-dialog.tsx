"use client"

import * as React from "react"
import { toast } from "sonner"
import { MapPin, ReceiptText, User, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FormError, NativeSelect } from "@/components/form"
import { FormSection } from "@/components/contact-dialog"
import { NumberStepper } from "@/components/number-stepper"
import { StateSelect } from "@/components/search-select"
import { email as emailRule, gstin as gstinRule, gstinStateMismatch, phone as phoneRule, pincode as pincodeRule } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import type { Supplier } from "@/lib/purchase"

// Add or change a supplier, in the same sections as a customer: who they are, GST, address, terms.
// A registered supplier must give a GSTIN (input credit depends on it); the state comes from it.

type Props = { open: boolean; onOpenChange: (o: boolean) => void; supplier?: Supplier | null; onSaved: (s: Supplier) => void; initialName?: string }

export function SupplierDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <SupplierForm {...props} />}
    </Dialog>
  )
}

function SupplierForm({ onOpenChange, supplier, onSaved, initialName = "" }: Props) {
  const a = supplier?.address ?? {}
  const [form, setForm] = React.useState({
    name: supplier?.name ?? initialName, companyName: supplier?.companyName ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "",
    registered: supplier ? (supplier.gstin ? "yes" : "no") : "yes", gstin: supplier?.gstin ?? "", stateCode: supplier?.stateCode ?? "",
    line1: a.line1 ?? "", line2: a.line2 ?? "", city: a.city ?? "", pincode: a.pincode ?? "",
    paymentDays: supplier?.paymentDays == null ? "" : String(supplier.paymentDays), notes: supplier?.notes ?? "",
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  type K = keyof typeof form
  const put = (k: K, v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e))
    setError(null)
  }
  const set = (k: K) => (e: React.ChangeEvent<HTMLInputElement>) => put(k, e.target.value)
  const registered = form.registered === "yes"

  function check() {
    const e: Record<string, string> = {}
    if (form.name.trim().length < 2) e.name = "Enter the supplier's name"
    if (form.phone && phoneRule(form.phone)) e.phone = phoneRule(form.phone)!
    if (form.email && emailRule(form.email)) e.email = emailRule(form.email)!
    if (registered) {
      if (!form.gstin) e.gstin = "Enter the GSTIN, or choose Not registered"
      else if (gstinRule(form.gstin)) e.gstin = gstinRule(form.gstin)!
      else if (gstinStateMismatch(form.gstin, form.stateCode)) e.stateCode = gstinStateMismatch(form.gstin, form.stateCode)!
    }
    if (!form.stateCode) e.stateCode = "Choose the state"
    if (form.pincode && pincodeRule(form.pincode)) e.pincode = pincodeRule(form.pincode)!
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    // This form can open from inside a purchase form: keep the submit here
    ev.stopPropagation()
    if (!check()) return setError("Fix the marked fields first.")
    setBusy(true)
    const has = form.line1 || form.city || form.pincode
    const body = {
      name: form.name.trim(), companyName: form.companyName.trim(), gstin: registered ? form.gstin.trim().toUpperCase() : "", stateCode: form.stateCode, phone: form.phone.trim(), email: form.email.trim(),
      paymentDays: form.paymentDays === "" ? null : Number(form.paymentDays), notes: form.notes.trim(),
      address: has ? { line1: form.line1.trim(), line2: form.line2.trim(), city: form.city.trim(), pincode: form.pincode.trim() } : null,
    }
    try {
      const s = supplier ? await api.patch<Supplier>(`/suppliers/${supplier.id}`, { ...body, version: supplier.version }) : await api.post<Supplier>("/suppliers", body)
      toast.success(supplier ? "Supplier saved" : `${s.name} added`)
      onSaved(s)
      onOpenChange(false)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{supplier ? `Edit ${supplier.name}` : "New supplier"}</DialogTitle>
        <DialogDescription>Who you buy from. Their GSTIN decides whether you can claim GST back on their invoices.</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="grid gap-5" noValidate>
        <FormSection icon={User} title="Basic details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier name" required error={errors.name} hint="Contact person or owner"><Input value={form.name} onChange={set("name")} maxLength={160} placeholder="e.g. Ramesh Gupta" autoFocus /></Field>
            <Field label="Firm name" error={errors.companyName} hint="As printed on their invoice"><Input value={form.companyName} onChange={set("companyName")} maxLength={160} placeholder="e.g. Gupta Wholesale" /></Field>
            <Field label="Mobile" error={errors.phone} hint="For payment messages on WhatsApp"><Input mask="phone" value={form.phone} onChange={set("phone")} placeholder="e.g. 9876543210" /></Field>
            <Field label="Email" error={errors.email}><Input mask="email" type="email" value={form.email} onChange={set("email")} placeholder="e.g. accounts@supplier.in" /></Field>
          </div>
        </FormSection>

        <FormSection icon={ReceiptText} title="GST" hint="Unregistered suppliers charge no GST, so there is nothing to claim back.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="GST registration" required>
              <NativeSelect value={form.registered} onChange={(e) => { put("registered", e.target.value); put("gstin", e.target.value === "yes" ? form.gstin : "") }} aria-label="GST registration">
                <option value="yes">Registered (has GSTIN)</option>
                <option value="no">Not registered</option>
              </NativeSelect>
            </Field>
            {registered && (
              <Field label="GSTIN" required error={errors.gstin} hint="15 characters; the state fills in from it">
                <Input mask="gstin" value={form.gstin} className="font-mono" placeholder="e.g. 09AABCG1234K1Z2" onChange={(e) => { const v = e.target.value; put("gstin", v); if (/^\d\d/.test(v)) put("stateCode", v.slice(0, 2)) }} />
              </Field>
            )}
            <Field label="State" required error={errors.stateCode} hint="Same state: CGST + SGST · other state: IGST" className={registered ? "sm:col-span-2" : undefined}>
              <StateSelect value={form.stateCode} onChange={(v) => put("stateCode", v ?? "")} aria-label="State" />
            </Field>
          </div>
        </FormSection>

        <FormSection icon={MapPin} title="Address">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Address line 1" className="sm:col-span-2"><Input value={form.line1} onChange={set("line1")} maxLength={200} placeholder="Shop, building, street" /></Field>
            <Field label="Address line 2" className="sm:col-span-2"><Input value={form.line2} onChange={set("line2")} maxLength={200} placeholder="Area, landmark (optional)" /></Field>
            <Field label="City"><Input value={form.city} onChange={set("city")} maxLength={100} placeholder="e.g. Delhi" /></Field>
            <Field label="PIN code" error={errors.pincode}><Input mask="pincode" value={form.pincode} onChange={set("pincode")} placeholder="6 digits" /></Field>
          </div>
        </FormSection>

        <FormSection icon={Wallet} title="Payment terms">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pay within" error={errors.paymentDays} hint="Their invoices fall due this many days after the invoice date">
              <NumberStepper max={365} suffix="days" value={form.paymentDays} onChange={(v) => put("paymentDays", v)} placeholder="e.g. 30" />
            </Field>
            <Field label="Notes" error={errors.notes}><Input value={form.notes} onChange={set("notes")} maxLength={1000} placeholder="e.g. Delivers on Tuesdays" /></Field>
          </div>
        </FormSection>

        <FormError message={error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save supplier"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
