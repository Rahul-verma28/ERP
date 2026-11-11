"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { BadgeIndianRupee, Building2, MapPin, Receipt, Truck, UserRound } from "lucide-react"
import { email as emailRule, emailSuggestion, gstin as gstinRule, gstinStateMismatch, length, phone as phoneRule, pincode as pincodeRule, squish, stateName, todayInIndia, upperNoSpaces } from "@contracts/validation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { MoneyInput } from "@/components/common"
import { DiscardChangesDialog, ErrorSummary, Field, FormError, NativeSelect } from "@/components/form"
import { CustomFieldsForm, useCustomFields } from "@/components/custom-fields"
import { UserSelect } from "@/components/pickers"
import { StateSelect } from "@/components/search-select"
import { fyStart } from "@/components/customer-ledger"
import { NumberStepper } from "@/components/number-stepper"
import { api, ApiError } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { Cancelled, useForm } from "@/lib/use-form"
import { cn } from "@/lib/utils"

// Adding or editing a lead or a customer. They ask for different things:
// a lead is someone who may buy, so a name and a way to reach them is enough;
// a customer is billed, so the mobile, the state (GST place of supply), the GSTIN when
// registered, the addresses and the payment terms are taken properly, and checked.

export interface Address {
  name?: string | null
  line1?: string
  line2?: string
  city?: string
  pincode?: string
  stateCode?: string
}

export interface Contact {
  id: string
  type: "lead" | "customer"
  name: string
  companyName: string | null
  phone: string | null
  email: string | null
  gstin: string | null
  stateCode: string | null
  address: Address | null
  shippingAddress?: Address | null
  leadStatus: "new" | "contacted" | "qualified" | "lost" | "converted" | null
  leadSource: string | null
  ownerId: string | null
  isActive: boolean
  notes: string | null
  custom: Record<string, unknown>
  creditLimitPaise?: number | null
  priceListId?: string | null
  /** Customers: invoices fall due this many days after their date */
  paymentDays?: number | null
  /** What they owe (negative = you hold their money); only for people who can see dues */
  balancePaise?: number
  overduePaise?: number
  createdAt: string
  version: number
}

export const LEAD_SOURCES = ["Walk-in", "Phone call", "WhatsApp", "Instagram", "Facebook", "Google", "Website", "Referral", "Other"]
/** Payment terms offered first; anything else is typed as a number of days */
export const PAYMENT_TERMS = [0, 7, 15, 30, 45, 60, 90]
export const termsLabel = (days: number | null | undefined) => (days == null || days === 0 ? "Due on receipt" : `${days} days`)

type Duplicate = { id: string; name: string; type: "customer" | "lead" } | null

/** One titled block of a form */
export function FormSection({ icon: Icon, title, hint, children, className }: { icon: React.ElementType; title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-4 border-t pt-5 first:border-t-0 first:pt-0", className)}>
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-primary" aria-hidden /> {title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

type Props = { kind: "customer" | "lead"; contact?: Contact; initialName?: string; onClose: () => void; onSaved: (c: Contact) => void }

export function ContactDialog(props: Props) {
  return props.kind === "lead" ? <LeadForm {...props} /> : <CustomerForm {...props} />
}

function DuplicateNote({ duplicate, editing, allow, setAllow, label }: { duplicate: NonNullable<Duplicate>; editing: boolean; allow: boolean; setAllow: (v: boolean) => void; label: string }) {
  return (
    <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 sm:col-span-2 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <strong>{duplicate.name}</strong> already has this phone or email.{" "}
      <Link href={duplicate.type === "lead" ? `/app/m/crm/${duplicate.id}` : `/app/m/sales/customers/${duplicate.id}`} className="font-medium underline underline-offset-2">Open {duplicate.type === "lead" ? "lead" : "customer"}</Link>
      {!editing && (
        <label className="mt-1 flex items-center gap-2">
          <input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} /> Add as a separate {label.toLowerCase()} anyway
        </label>
      )}
    </div>
  )
}

/** Turn a 409 duplicate answer into the note beside the fields */
function duplicateOf(err: unknown): Duplicate {
  if (err instanceof ApiError && err.code === "CONFLICT" && err.details?.duplicateId) {
    return { id: String(err.details.duplicateId), name: err.message.split(" already has")[0], type: err.details.duplicateType === "lead" ? "lead" : "customer" }
  }
  return null
}

// ── Lead: few fields ────────────────────────────────────────────────

function LeadForm({ contact, initialName, onClose, onSaved }: Props) {
  const { term } = useAuth()
  const fields = useCustomFields("lead")
  const [customErrors, setCustomErrors] = React.useState<Record<string, string>>({})
  const [allowDuplicate, setAllowDuplicate] = React.useState(false)
  const [duplicate, setDuplicate] = React.useState<Duplicate>(null)
  const [discardOpen, setDiscardOpen] = React.useState(false)
  const label = term("entity.lead.singular", "Lead")

  const form = useForm({
    initial: {
      name: contact?.name ?? initialName ?? "",
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      companyName: contact?.companyName ?? "",
      leadSource: contact?.leadSource ?? "",
      leadStatus: contact?.leadStatus && contact.leadStatus !== "converted" ? contact.leadStatus : "new",
      ownerId: contact?.ownerId ?? (null as string | null),
      notes: contact?.notes ?? "",
      custom: contact?.custom ?? ({} as Record<string, unknown>),
    },
    labels: { name: "Name", phone: "Phone", email: "Email", notes: "Looking for" },
    clean: { name: squish, companyName: squish, phone: (v) => v.trim(), email: (v) => v.trim().toLowerCase() },
    rules: {
      name: (v) => (!v.trim() ? "Enter the name" : length(2, 160, "Name")(v)),
      phone: (v, all) => (v ? phoneRule(v) : !all.email ? "Enter a phone number or an email" : null),
      email: (v) => (v ? emailRule(v) : null),
      notes: (v) => (v.length > 4000 ? "Keep it under 4,000 characters" : null),
    },
    onSubmit: async (v) => {
      setCustomErrors({})
      setDuplicate(null)
      const body = { name: v.name, phone: v.phone || null, email: v.email || null, companyName: v.companyName || null, leadSource: v.leadSource || null, leadStatus: v.leadStatus, ownerId: v.ownerId, notes: v.notes || null, custom: v.custom }
      try {
        const saved = contact ? await api.patch<Contact>(`/contacts/${contact.id}`, { ...body, version: contact.version }) : await api.post<Contact>("/leads", { ...body, allowDuplicate })
        toast.success(contact ? "Lead saved" : `${label} added`)
        onSaved(saved)
      } catch (err) {
        const dup = duplicateOf(err)
        if (dup) {
          setDuplicate(dup)
          throw new Cancelled()
        }
        if (err instanceof ApiError) setCustomErrors(Object.fromEntries(Object.entries(err.fields).filter(([k]) => k.startsWith("custom."))))
        throw err
      }
    },
  })
  const v = form.values
  const close = () => (form.dirty ? setDiscardOpen(true) : onClose())

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{contact ? `Edit ${contact.name}` : `New ${label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>Someone who may buy. A name and a phone or email is enough; convert them to a customer when they buy.</DialogDescription>
        </DialogHeader>
        <form {...form.formProps} onSubmit={form.submit} className="grid gap-4">
          <ErrorSummary fields={form.summary} show={form.submitted} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={form.errors.name} className="sm:col-span-2"><Input {...form.field("name")} autoFocus autoComplete="off" /></Field>
            <Field label="Phone" required={!v.email} error={form.errors.phone} hint="10-digit mobile"><Input mask="phone" {...form.field("phone")} autoComplete="off" /></Field>
            <Field label="Email" error={form.errors.email}><Input mask="email" type="email" {...form.field("email")} autoComplete="off" /></Field>
            {duplicate && <DuplicateNote duplicate={duplicate} editing={!!contact} allow={allowDuplicate} setAllow={setAllowDuplicate} label={label} />}
            <Field label="Company"><Input {...form.field("companyName")} /></Field>
            <Field label="Source" hint="Where they came from">
              <NativeSelect {...form.field("leadSource")}>
                <option value="">Choose a source</option>
                {LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}
              </NativeSelect>
            </Field>
            {contact && (
              <Field label="Status">
                <NativeSelect {...form.field("leadStatus")}>
                  {[["new", "New"], ["contacted", "Contacted"], ["qualified", "Qualified"], ["lost", "Lost"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </NativeSelect>
              </Field>
            )}
            <Field label="Assigned to"><UserSelect value={v.ownerId} onChange={(o) => form.set("ownerId", o)} emptyLabel="Me" /></Field>
            <Field label="Looking for" error={form.errors.notes} className="sm:col-span-2"><Textarea {...form.field("notes")} rows={2} placeholder="What they asked about, budget, when they need it" /></Field>
          </div>
          <CustomFieldsForm fields={fields} value={v.custom} onChange={(c) => form.set("custom", c)} errors={customErrors} />
          <FormError message={form.formError} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={form.submitting || (!!duplicate && !contact && !allowDuplicate)}>{form.submitting ? "Saving…" : contact ? "Save changes" : `Add ${label.toLowerCase()}`}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <DiscardChangesDialog open={discardOpen} count={form.changed.length} onKeep={() => setDiscardOpen(false)} onDiscard={onClose} />
    </Dialog>
  )
}

// ── Customer: everything a bill needs ───────────────────────────────

function CustomerForm({ contact, initialName, onClose, onSaved }: Props) {
  const { term, can, me } = useAuth()
  const priceLists = useApi<{ data: { id: string; name: string }[] }>(can("catalog.price_list.view") ? "/price-lists" : null)
  const fields = useCustomFields("contact")
  const [customErrors, setCustomErrors] = React.useState<Record<string, string>>({})
  const [allowDuplicate, setAllowDuplicate] = React.useState(false)
  const [duplicate, setDuplicate] = React.useState<Duplicate>(null)
  const [discardOpen, setDiscardOpen] = React.useState(false)
  const label = term("entity.contact.singular", "Customer")
  const today = todayInIndia()
  const days = contact?.paymentDays ?? null
  const ship = contact?.shippingAddress ?? null

  const form = useForm({
    initial: {
      name: contact?.name ?? initialName ?? "",
      companyName: contact?.companyName ?? "",
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      ownerId: contact?.ownerId ?? (null as string | null),
      registered: contact ? !!contact.gstin : false,
      gstin: contact?.gstin ?? "",
      stateCode: contact?.stateCode ?? me?.tenant?.billingStateCode ?? "",
      line1: contact?.address?.line1 ?? "",
      line2: contact?.address?.line2 ?? "",
      city: contact?.address?.city ?? "",
      pincode: contact?.address?.pincode ?? "",
      sameShipping: !ship,
      shipName: ship?.name ?? "",
      shipLine1: ship?.line1 ?? "",
      shipLine2: ship?.line2 ?? "",
      shipCity: ship?.city ?? "",
      shipPincode: ship?.pincode ?? "",
      shipState: ship?.stateCode ?? "",
      terms: days == null ? "0" : PAYMENT_TERMS.includes(days) ? String(days) : "custom",
      customDays: days != null && !PAYMENT_TERMS.includes(days) ? String(days) : "",
      creditLimitPaise: contact?.creditLimitPaise ?? (null as number | null),
      priceListId: contact?.priceListId ?? "",
      openingPaise: null as number | null,
      openingDate: fyStart(today, me?.tenant?.fyStartMonth ?? 4),
      notes: contact?.notes ?? "",
      custom: contact?.custom ?? ({} as Record<string, unknown>),
    },
    labels: { name: "Customer name", phone: "Mobile", email: "Email", gstin: "GSTIN", stateCode: "State", pincode: "PIN code", shipLine1: "Delivery address", shipCity: "Delivery city", shipPincode: "Delivery PIN code", shipState: "Delivery state", customDays: "Payment days", openingDate: "Opening balance date", notes: "Notes" },
    clean: { name: squish, companyName: squish, phone: (v) => v.trim(), email: (v) => v.trim().toLowerCase(), gstin: upperNoSpaces, line1: squish, line2: squish, city: squish, pincode: (v) => v.replace(/\s/g, ""), shipLine1: squish, shipLine2: squish, shipCity: squish, shipPincode: (v) => v.replace(/\s/g, "") },
    fromServer: (path) => (path.startsWith("address.") ? (path.slice(8) as "line1") : path.startsWith("shippingAddress.") ? ({ line1: "shipLine1", city: "shipCity", pincode: "shipPincode", stateCode: "shipState" } as Record<string, "shipLine1" | "shipCity" | "shipPincode" | "shipState">)[path.slice(16)] : path === "opening.date" ? "openingDate" : path.startsWith("custom.") ? undefined : (path as "name")),
    rules: {
      name: (v) => (!v.trim() ? "Enter the customer's name" : length(2, 160, "Name")(v)),
      companyName: (v) => (v ? length(2, 160, "Firm name")(v) : null),
      phone: (v) => (!v ? "Enter the mobile number" : phoneRule(v)),
      email: (v) => (v ? emailRule(v) : null),
      gstin: (v, all) => (!all.registered ? null : !v ? "Enter the GSTIN, or choose Not registered" : gstinRule(v) ?? gstinStateMismatch(v, all.stateCode)),
      stateCode: (v) => (!v ? "Choose the state" : null),
      pincode: (v) => (v ? pincodeRule(v) : null),
      shipLine1: (v, all) => (!all.sameShipping && !v.trim() ? "Enter the delivery address" : null),
      shipCity: (v, all) => (!all.sameShipping && !v.trim() ? "Enter the city" : null),
      shipPincode: (v, all) => (all.sameShipping ? null : !v ? "Enter the PIN code" : pincodeRule(v)),
      shipState: (v, all) => (!all.sameShipping && !v ? "Choose the state" : null),
      customDays: (v, all) => (all.terms !== "custom" ? null : !v ? "Enter the number of days" : Number(v) > 365 ? "Use 1 to 365 days" : null),
      openingDate: (v, all) => (!all.openingPaise ? null : !v ? "Choose the date" : v > today ? "The date can't be in the future" : null),
      notes: (v) => (v.length > 4000 ? "Keep notes under 4,000 characters" : null),
    },
    onSubmit: async (v) => {
      setCustomErrors({})
      setDuplicate(null)
      const paymentDays = v.terms === "custom" ? Number(v.customDays) : Number(v.terms) || null
      const body = {
        name: v.name,
        companyName: v.companyName || null,
        phone: v.phone || null,
        email: v.email || null,
        gstin: v.registered ? v.gstin || null : null,
        stateCode: v.stateCode || null,
        address: v.line1 || v.line2 || v.city || v.pincode ? { line1: v.line1 || undefined, line2: v.line2 || undefined, city: v.city || undefined, pincode: v.pincode || undefined } : null,
        shippingAddress: v.sameShipping ? null : { name: v.shipName || null, line1: v.shipLine1, line2: v.shipLine2 || null, city: v.shipCity, pincode: v.shipPincode, stateCode: v.shipState },
        ownerId: v.ownerId,
        paymentDays,
        creditLimitPaise: v.creditLimitPaise,
        priceListId: v.priceListId || null,
        notes: v.notes || null,
        custom: v.custom,
      }
      try {
        const saved = contact
          ? await api.patch<Contact>(`/contacts/${contact.id}`, { ...body, version: contact.version })
          : await api.post<Contact>("/contacts", { ...body, allowDuplicate, opening: v.openingPaise ? { amountPaise: v.openingPaise, date: v.openingDate } : null })
        toast.success(contact ? "Customer saved" : `${label} added`)
        onSaved(saved)
      } catch (err) {
        const dup = duplicateOf(err)
        if (dup) {
          setDuplicate(dup)
          throw new Cancelled()
        }
        if (err instanceof ApiError) setCustomErrors(Object.fromEntries(Object.entries(err.fields).filter(([k]) => k.startsWith("custom."))))
        throw err
      }
    },
  })
  const v = form.values
  const suggestion = !form.errors.email && v.email ? emailSuggestion(v.email) : null
  const gstinOk = v.registered && v.gstin && !gstinRule(v.gstin) && !gstinStateMismatch(v.gstin, v.stateCode)
  const close = () => (form.dirty ? setDiscardOpen(true) : onClose())
  const lists = priceLists.data?.data ?? []

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{contact ? `Edit ${contact.companyName || contact.name}` : `New ${label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>Fields marked * are needed to bill this customer. The mobile and email are checked for duplicates.</DialogDescription>
        </DialogHeader>
        <form {...form.formProps} onSubmit={form.submit} className="grid gap-5">
          <ErrorSummary fields={form.summary} show={form.submitted} />

          <FormSection icon={UserRound} title="Basic details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer name" required error={form.errors.name} hint="The person you deal with"><Input {...form.field("name")} autoFocus autoComplete="off" /></Field>
              <Field label="Firm name" error={form.errors.companyName} hint="Printed on the bill when given"><Input {...form.field("companyName")} autoComplete="off" /></Field>
              <Field label="Mobile" required error={form.errors.phone} hint="For reminders on WhatsApp and SMS"><Input mask="phone" {...form.field("phone")} autoComplete="off" /></Field>
              <Field
                label="Email"
                error={form.errors.email}
                hint={suggestion ? <>Did you mean <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => form.set("email", suggestion)}>{suggestion}</button>?</> : "Bills and statements can go here"}
              >
                <Input mask="email" type="email" {...form.field("email")} autoComplete="off" />
              </Field>
              {duplicate && <DuplicateNote duplicate={duplicate} editing={!!contact} allow={allowDuplicate} setAllow={setAllowDuplicate} label={label} />}
              <Field label="Salesperson"><UserSelect value={v.ownerId} onChange={(o) => form.set("ownerId", o)} emptyLabel="Me" /></Field>
            </div>
          </FormSection>

          <FormSection icon={Receipt} title="GST" hint="Decides CGST + SGST (same state) or IGST (other state) on every bill.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="GST registration" required>
                <NativeSelect value={v.registered ? "yes" : "no"} onChange={(e) => form.set("registered", e.target.value === "yes")} aria-label="GST registration">
                  <option value="no">Not registered (B2C)</option>
                  <option value="yes">Registered business (B2B)</option>
                </NativeSelect>
              </Field>
              {v.registered ? (
                <Field label="GSTIN" required error={form.errors.gstin} success={gstinOk ? `Valid · ${stateName(v.gstin.slice(0, 2))}` : null}>
                  <Input mask="gstin" {...form.field("gstin")} onChange={(e) => { const g = upperNoSpaces(e.target.value); form.set("gstin", g); if (/^\d{2}/.test(g)) form.set("stateCode", g.slice(0, 2)) }} maxLength={15} className="font-mono uppercase" spellCheck={false} />
                </Field>
              ) : <div className="hidden sm:block" />}
              <Field label="State (place of supply)" required error={form.errors.stateCode} hint={v.registered ? "Filled from the GSTIN" : "Where the customer is"}>
                <StateSelect {...form.pick("stateCode")} />
              </Field>
            </div>
          </FormSection>

          <FormSection icon={MapPin} title="Billing address" hint="Printed on the bill.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Address line 1" error={form.errors.line1}><Input {...form.field("line1")} placeholder="Shop, building, street" /></Field>
              <Field label="Address line 2" error={form.errors.line2}><Input {...form.field("line2")} placeholder="Area, landmark" /></Field>
              <Field label="City" error={form.errors.city}><Input {...form.field("city")} /></Field>
              <Field label="PIN code" error={form.errors.pincode}><Input mask="pincode" {...form.field("pincode")} /></Field>
            </div>
          </FormSection>

          <FormSection icon={Truck} title="Shipping address">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={v.sameShipping} onChange={(e) => form.set("sameShipping", e.target.checked)} /> Same as the billing address
            </label>
            {!v.sameShipping && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Deliver to (name)" hint="Empty: the customer's name"><Input {...form.field("shipName")} /></Field>
                <Field label="Address line 1" required error={form.errors.shipLine1}><Input {...form.field("shipLine1")} placeholder="Shop, building, street" /></Field>
                <Field label="Address line 2"><Input {...form.field("shipLine2")} placeholder="Area, landmark" /></Field>
                <Field label="City" required error={form.errors.shipCity}><Input {...form.field("shipCity")} /></Field>
                <Field label="PIN code" required error={form.errors.shipPincode}><Input mask="pincode" {...form.field("shipPincode")} /></Field>
                <Field label="State" required error={form.errors.shipState}><StateSelect {...form.pick("shipState")} /></Field>
              </div>
            )}
          </FormSection>

          <FormSection icon={BadgeIndianRupee} title="Payment and credit">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Payment terms" hint="Sets the due date on new invoices">
                <NativeSelect {...form.field("terms")}>
                  {PAYMENT_TERMS.map((d) => <option key={d} value={String(d)}>{termsLabel(d)}</option>)}
                  <option value="custom">Other number of days</option>
                </NativeSelect>
              </Field>
              {v.terms === "custom" ? (
                <Field label="Payment days" required error={form.errors.customDays}><NumberStepper max={365} suffix="days" value={v.customDays} onChange={(x) => form.set("customDays", x)} placeholder="e.g. 21" aria-label="Payment days" /></Field>
              ) : <div className="hidden sm:block" />}
              <Field label="Credit limit" hint="Bills above this need approval. Empty: no limit.">
                <MoneyInput value={v.creditLimitPaise} onChange={(a) => form.set("creditLimitPaise", a)} aria-label="Credit limit" />
              </Field>
              {can("catalog.price_list.view") && (
                <Field label="Price list" hint="New bills use these rates">
                  <NativeSelect
                    value={v.priceListId}
                    onChange={(e) => (e.target.value === "__manage" ? window.open("/app/m/catalog/price-lists", "_blank", "noopener") : form.set("priceListId", e.target.value))}
                    aria-label="Price list"
                  >
                    <option value="">Standard prices</option>
                    {lists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    <option value="__manage">Manage or add price lists…</option>
                  </NativeSelect>
                </Field>
              )}
            </div>
          </FormSection>

          {!contact && can("billing.invoice.approve") && (
            <FormSection icon={Building2} title="Opening balance" hint="What this customer already owed you before AHEAD. Not counted as a sale.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount they owe"><MoneyInput value={v.openingPaise} onChange={(a) => form.set("openingPaise", a)} aria-label="Opening balance" /></Field>
                <Field label="As on date" required={!!v.openingPaise} error={form.errors.openingDate}><Input type="date" max={today} {...form.field("openingDate")} /></Field>
              </div>
            </FormSection>
          )}

          <CustomFieldsForm fields={fields} value={v.custom} onChange={(c) => form.set("custom", c)} errors={customErrors} />
          <Field label="Notes" error={form.errors.notes} hint="Only your team sees this"><Textarea {...form.field("notes")} rows={2} /></Field>
          <FormError message={form.formError} />
          <DialogFooter className="sticky bottom-0 gap-2 border-t bg-popover pt-3">
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={form.submitting || (!!duplicate && !contact && !allowDuplicate)}>{form.submitting ? "Saving…" : contact ? "Save changes" : `Add ${label.toLowerCase()}`}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <DiscardChangesDialog open={discardOpen} count={form.changed.length} onKeep={() => setDiscardOpen(false)} onDiscard={onClose} />
    </Dialog>
  )
}
