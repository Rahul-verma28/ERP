"use client"

import { StateSelect } from "@/components/search-select"
import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { email as emailRule, emailSuggestion, gstin as gstinRule, gstinStateMismatch, length, phone as phoneRule, pincode as pincodeRule, squish, stateName, upperNoSpaces } from "@contracts/validation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DiscardChangesDialog, ErrorSummary, Field, FormError, NativeSelect } from "@/components/form"
import { CustomFieldsForm, useCustomFields } from "@/components/custom-fields"
import { UserSelect } from "@/components/pickers"
import { api, ApiError } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { Cancelled, useForm } from "@/lib/use-form"

export interface Contact {
  id: string
  type: "lead" | "customer"
  name: string
  companyName: string | null
  phone: string | null
  email: string | null
  gstin: string | null
  stateCode: string | null
  address: { line1?: string; city?: string; pincode?: string } | null
  leadStatus: "new" | "contacted" | "qualified" | "lost" | "converted" | null
  leadSource: string | null
  ownerId: string | null
  isActive: boolean
  notes: string | null
  custom: Record<string, unknown>
  createdAt: string
  version: number
}

export const LEAD_SOURCES = ["Walk-in", "Phone call", "WhatsApp", "Instagram", "Facebook", "Google", "Website", "Referral", "Other"]

type Duplicate = { id: string; name: string; type: "customer" | "lead" } | null

export function ContactDialog({ kind, contact, onClose, onSaved }: { kind: "customer" | "lead"; contact?: Contact; onClose: () => void; onSaved: (c: Contact) => void }) {
  const { term } = useAuth()
  const fields = useCustomFields(kind === "lead" ? "lead" : "contact")
  const [customErrors, setCustomErrors] = React.useState<Record<string, string>>({})
  const [allowDuplicate, setAllowDuplicate] = React.useState(false)
  const [duplicate, setDuplicate] = React.useState<Duplicate>(null)
  const [discardOpen, setDiscardOpen] = React.useState(false)
  const label = kind === "lead" ? term("entity.lead.singular", "Lead") : term("entity.contact.singular", "Customer")

  const form = useForm({
    initial: {
      name: contact?.name ?? "",
      companyName: contact?.companyName ?? "",
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      gstin: contact?.gstin ?? "",
      stateCode: contact?.stateCode ?? "",
      line1: contact?.address?.line1 ?? "",
      city: contact?.address?.city ?? "",
      pincode: contact?.address?.pincode ?? "",
      leadSource: contact?.leadSource ?? "",
      leadStatus: contact?.leadStatus && contact.leadStatus !== "converted" ? contact.leadStatus : "new",
      ownerId: contact?.ownerId ?? (null as string | null),
      notes: contact?.notes ?? "",
      custom: contact?.custom ?? ({} as Record<string, unknown>),
    },
    labels: { name: "Name", phone: "Phone", email: "Email", gstin: "GSTIN", stateCode: "State", pincode: "PIN code", notes: "Notes" },
    clean: { name: squish, companyName: squish, phone: (v) => v.trim(), email: (v) => v.trim().toLowerCase(), gstin: upperNoSpaces, line1: squish, city: squish, pincode: (v) => v.replace(/\s/g, "") },
    fromServer: (path) => (path.startsWith("address.") ? (path.slice(8) as "line1") : path.startsWith("custom.") ? undefined : (path as "name")),
    rules: {
      name: (v) => (!v.trim() ? "Name is required" : length(2, 160, "Name")(v)),
      companyName: (v) => (v ? length(2, 160, "Company name")(v) : null),
      phone: (v) => (v ? phoneRule(v) : null),
      email: (v) => (v ? emailRule(v) : null),
      gstin: (v, all) => (v ? gstinRule(v) ?? gstinStateMismatch(v, all.stateCode) : null),
      pincode: (v) => (v ? pincodeRule(v) : null),
      notes: (v) => (v.length > 4000 ? "Keep notes under 4,000 characters" : null),
    },
    onSubmit: async (v) => {
      setCustomErrors({})
      setDuplicate(null)
      const body = {
        name: v.name,
        companyName: v.companyName || null,
        phone: v.phone || null,
        email: v.email || null,
        gstin: v.gstin || null,
        stateCode: v.stateCode || (v.gstin.length >= 2 ? v.gstin.slice(0, 2) : null),
        address: v.line1 || v.city || v.pincode ? { line1: v.line1 || undefined, city: v.city || undefined, pincode: v.pincode || undefined } : null,
        ownerId: v.ownerId,
        notes: v.notes || null,
        custom: v.custom,
        ...(kind === "lead" ? { leadSource: v.leadSource || null, leadStatus: v.leadStatus } : {}),
      }
      try {
        const saved = contact
          ? await api.patch<Contact>(`/contacts/${contact.id}`, { ...body, version: contact.version })
          : await api.post<Contact>(kind === "lead" ? "/leads" : "/contacts", { ...body, allowDuplicate })
        toast.success(contact ? "Saved" : `${label} added`)
        onSaved(saved)
      } catch (err) {
        if (err instanceof ApiError && err.code === "CONFLICT" && err.details?.duplicateId) {
          // Shown beside the fields, with a way to open it or add this one anyway
          setDuplicate({ id: String(err.details.duplicateId), name: err.message.split(" already has")[0], type: err.details.duplicateType === "lead" ? "lead" : "customer" })
          throw new Cancelled()
        }
        if (err instanceof ApiError) setCustomErrors(Object.fromEntries(Object.entries(err.fields).filter(([k]) => k.startsWith("custom."))))
        throw err
      }
    },
  })
  const v = form.values

  const suggestion = !form.errors.email && v.email ? emailSuggestion(v.email) : null
  const gstinOk = v.gstin && !gstinRule(v.gstin) && !gstinStateMismatch(v.gstin, v.stateCode)

  const close = () => (form.dirty ? setDiscardOpen(true) : onClose())

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{contact ? `Edit ${label.toLowerCase()}` : `New ${label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>Fields marked * are required. Phone and email are checked for duplicates when you save.</DialogDescription>
        </DialogHeader>
        <form {...form.formProps} onSubmit={form.submit} className="grid gap-4">
          <ErrorSummary fields={form.summary} show={form.submitted} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={form.errors.name} className="sm:col-span-2">
              <Input {...form.field("name")} autoFocus autoComplete="off" />
            </Field>
            <Field label="Phone" error={form.errors.phone} hint="10-digit mobile, or +country code">
              <Input mask="phone" {...form.field("phone")} autoComplete="off" />
            </Field>
            <Field
              label="Email"
              error={form.errors.email}
              hint={
                suggestion ? (
                  <>
                    Did you mean{" "}
                    <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => form.set("email", suggestion)}>
                      {suggestion}
                    </button>
                    ?
                  </>
                ) : undefined
              }
            >
              <Input mask="email" {...form.field("email")} type="email" autoComplete="off" />
            </Field>
            {duplicate && (
              <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 sm:col-span-2 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                <strong>{duplicate.name}</strong> already has this phone or email.{" "}
                <Link href={`/app/m/crm/${duplicate.id}`} className="font-medium underline underline-offset-2">
                  Open {(duplicate.type === "lead" ? term("entity.lead.singular", "Lead") : term("entity.contact.singular", "Customer")).toLowerCase()}
                </Link>
                {!contact && (
                  <label className="mt-1 flex items-center gap-2">
                    <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} /> Add as a separate {label.toLowerCase()} anyway
                  </label>
                )}
              </div>
            )}
            <Field label="Company / business" error={form.errors.companyName}>
              <Input {...form.field("companyName")} />
            </Field>
            <Field label="GSTIN" error={form.errors.gstin} success={gstinOk ? `Valid · ${stateName(v.gstin.slice(0, 2))}` : null} hint="For B2B invoices">
              <Input mask="gstin" {...form.field("gstin")} maxLength={15} className="font-mono uppercase" spellCheck={false} />
            </Field>
            {kind === "lead" && (
              <>
                <Field label="Source">
                  <NativeSelect {...form.field("leadSource")}>
                    <option value="">—</option>
                    {LEAD_SOURCES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Status">
                  <NativeSelect {...form.field("leadStatus")}>
                    {["new", "contacted", "qualified", "lost"].map((s) => (
                      <option key={s} value={s} className="capitalize">
                        {s}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </>
            )}
            <Field label="State (place of supply)" error={form.errors.stateCode}>
              <StateSelect {...form.pick("stateCode")} />
            </Field>
            <Field label="Owner">
              <UserSelect value={v.ownerId} onChange={(o) => form.set("ownerId", o)} emptyLabel="Me" />
            </Field>
            <Field label="Address" error={form.errors.line1} className="sm:col-span-2">
              <Input {...form.field("line1")} />
            </Field>
            <Field label="City" error={form.errors.city}>
              <Input {...form.field("city")} />
            </Field>
            <Field label="PIN code" error={form.errors.pincode}>
              <Input mask="pincode" {...form.field("pincode")} />
            </Field>
          </div>
          <CustomFieldsForm fields={fields} value={v.custom} onChange={(c) => form.set("custom", c)} errors={customErrors} />
          <Field label="Notes" error={form.errors.notes} count={v.notes.length > 3000 ? [v.notes.length, 4000] : undefined}>
            <Textarea {...form.field("notes")} rows={2} />
          </Field>
          <FormError message={form.formError} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.submitting || (!!duplicate && !contact && !allowDuplicate)}>
              {form.submitting ? "Saving…" : contact ? "Save changes" : `Add ${label.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <DiscardChangesDialog open={discardOpen} count={form.changed.length} onKeep={() => setDiscardOpen(false)} onDiscard={onClose} />
    </Dialog>
  )
}
