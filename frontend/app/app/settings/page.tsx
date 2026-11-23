"use client"

import { StateSelect } from "@/components/search-select"
import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  BUSINESS_TYPES, email as emailRule, gstin as gstinRule, phone as phoneRule, gstinStateMismatch, length, pan as panRule, panTypeMismatch, pincode as pincodeRule, squish, stateName, upperNoSpaces, type BusinessType,
} from "@contracts/validation"
import type { WorkspaceProfile } from "@contracts/workspace"
import { DATE_FORMATS } from "@contracts/account"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { EditableSection, ReadOnlyGrid, useConfirmChanges, type DiffRow } from "@/components/editable-section"
import { Field, NativeSelect } from "@/components/form"
import { ErrorState } from "@/components/page-states"
import { SettingsMenu, SettingsPage } from "@/components/settings-shell"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useForm } from "@/lib/use-form"
import { formatDate, initials } from "@/lib/format"
import { formatMobile } from "@/lib/account"
import { FileImg } from "@/components/file-field"
import { cn } from "@/lib/utils"
import { BadgeCheck, Building2, CalendarRange, Check, Landmark, MapPin, Phone, Plus } from "lucide-react"

// Settings › Organization: the business at a glance, then its details, GST & PAN, address, contact
// printed on bills, and year, time & formats. Each card edits on its own.

interface Address {
  line1?: string
  line2?: string
  city?: string
  state?: string
  pincode?: string
}

interface Tenant {
  name: string
  legalName: string | null
  gstin: string | null
  billingStateCode: string | null
  logoUrl: string | null
  timezone: string
  fyStartMonth: number
  address: Address | null
  updatedAt: string
  fyLocked: boolean
  lastChange: { at: string; by: string | null } | null
}

type Profile = WorkspaceProfile

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const fyLabel = (m: number) => `${MONTHS[m - 1]} – ${MONTHS[(m + 10) % 12]}`
const TIME_ZONES = [
  ["Asia/Kolkata", "India (IST)"],
  ["Asia/Dubai", "Gulf (GST, UTC+4)"],
  ["Asia/Singapore", "Singapore (UTC+8)"],
  ["Europe/London", "London (UK)"],
  ["America/New_York", "New York (US Eastern)"],
] as const
const tzLabel = (tz: string) => TIME_ZONES.find(([k]) => k === tz)?.[1] ?? tz
const NUMBER_FORMATS = [
  { key: "indian", label: "1,25,000.00" },
  { key: "international", label: "125,000.00" },
] as const
const typeLabel = (t?: string) => BUSINESS_TYPES.find((b) => b.key === t)?.label ?? null

export default function OrganizationPage() {
  return (
    <>
      <div className="lg:hidden">
        <SettingsMenu variant="list" />
      </div>
      <div className="hidden lg:block">
        <Organization />
      </div>
    </>
  )
}

function Organization() {
  const tenant = useApi<Tenant>("/tenant")
  const ws = useApi<{ profile: Profile }>("/tenant/workspace")
  const { me } = useAuth()
  const error = tenant.error ?? ws.error
  const reload = async () => {
    await Promise.all([tenant.reload(), ws.reload()])
  }
  if (error && (!tenant.data || !ws.data)) return <ErrorState error={error} onRetry={reload} />
  if (!tenant.data || !ws.data) {
    return (
      <SettingsPage title="Organization" description="Your business details, year and formats. Printed on documents.">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
      </SettingsPage>
    )
  }
  const t = tenant.data
  const key = `${t.updatedAt}`
  const pkey = JSON.stringify(ws.data.profile)
  return (
    <SettingsPage title="Organization" description="Your business details, year and formats. Printed on documents.">
      <IdentityCard tenant={t} profile={ws.data.profile} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <BusinessCard key={`b-${key}-${pkey}`} tenant={t} profile={ws.data.profile} onSaved={reload} />
        <TaxIdCard key={`g-${key}-${pkey}`} tenant={t} profile={ws.data.profile} onSaved={reload} />
        <AddressCard key={`a-${key}`} tenant={t} onSaved={reload} />
        <ContactCard key={`c-${pkey}`} profile={ws.data.profile} onSaved={reload} />
      </div>
      <FormatsCard key={`f-${key}-${pkey}`} tenant={t} profile={ws.data.profile} onSaved={reload} />
      {!me?.tenant?.billingStateCode && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-3.5 text-[13px] text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" role="status">
          <span>
            <strong>Taxes needs attention:</strong> add your state so invoices charge CGST + SGST or IGST correctly.
          </span>
          <Link href="/app/settings#gst-pan" className="ml-auto font-semibold text-primary hover:underline">
            Add state
          </Link>
        </div>
      )}
    </SettingsPage>
  )
}

function LastChanged({ tenant }: { tenant: Tenant }) {
  if (!tenant.lastChange) return null
  return (
    <>
      Last changed {formatDate(tenant.lastChange.at)}
      {tenant.lastChange.by ? ` by ${tenant.lastChange.by}` : ""} ·{" "}
      <Link href="/app/settings/audit" className="font-semibold text-primary hover:underline">
        History
      </Link>
    </>
  )
}

// ── The business at a glance: logo, name, tax IDs and how complete the profile is ──

function IdentityCard({ tenant, profile }: { tenant: Tenant; profile: Profile }) {
  const { me } = useAuth()
  const brand = me?.tenant?.branding.brandColor ?? "#2450D8"
  const a = tenant.address ?? {}
  const checks = [
    { done: !!tenant.logoUrl, label: "Logo", href: "/app/settings/branding#logo" },
    { done: !!tenant.billingStateCode, label: "State", href: "#gst-pan" },
    { done: !!(a.line1 && a.city && a.pincode), label: "Address", href: "#address" },
    { done: !!(tenant.gstin || profile.pan), label: "GSTIN or PAN", href: "#gst-pan" },
    { done: !!(profile.phone || profile.email), label: "Phone or email on bills", href: "#contact" },
  ]
  const done = checks.filter((c) => c.done).length
  const chip = "inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium"
  return (
    <section className="ui-surface flex flex-wrap items-center gap-x-8 gap-y-5 overflow-hidden px-5 py-5">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-white">
          <FileImg
            value={tenant.logoUrl}
            alt={`${tenant.name} logo`}
            className="size-full object-contain"
            fallback={
              <span className="grid size-full place-items-center text-lg font-bold text-white" style={{ background: brand }}>
                {initials(tenant.name)}
              </span>
            }
          />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight">{tenant.name}</h2>
          {tenant.legalName && tenant.legalName !== tenant.name && <p className="truncate text-[13px] text-muted-foreground">{tenant.legalName}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tenant.gstin ? (
              <span className={chip}>
                <BadgeCheck className="size-3.5 text-emerald-600" aria-hidden /> GSTIN <span className="font-mono">{tenant.gstin}</span>
              </span>
            ) : (
              <span className={cn(chip, "text-muted-foreground")}>Not GST registered</span>
            )}
            {tenant.billingStateCode && (
              <span className={chip}>
                <MapPin className="size-3.5 text-muted-foreground" aria-hidden /> {stateName(tenant.billingStateCode)}
              </span>
            )}
            {typeLabel(profile.businessType) && <span className={chip}>{typeLabel(profile.businessType)}</span>}
            <span className={chip}>
              <CalendarRange className="size-3.5 text-muted-foreground" aria-hidden /> FY {fyLabel(tenant.fyStartMonth)}
            </span>
          </div>
        </div>
      </div>
      <div className="grid w-full gap-2 sm:w-72">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="font-semibold">{done === checks.length ? "Profile complete" : "Profile details"}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {done} of {checks.length}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={checks.length} aria-valuenow={done} aria-label="Profile completeness">
          <div className={cn("h-full rounded-full transition-all", done === checks.length ? "bg-emerald-500" : "bg-primary")} style={{ width: `${(done / checks.length) * 100}%` }} />
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {checks.map((c) => (
            <li key={c.label}>
              {c.done ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Check className="size-3 text-emerald-600" aria-hidden /> {c.label}
                </span>
              ) : (
                <Link href={c.href} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                  <Plus className="size-3" aria-hidden /> {c.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Save a business change: the tenant fields, then the profile fields; one call each, only when something changed */
async function saveBusiness(tenant: Tenant, patch: Record<string, unknown>, prof: Record<string, unknown>, reason?: string) {
  if (Object.keys(patch).length) await api.patch("/tenant", { ...patch, ...(reason ? { reason } : {}), expectedUpdatedAt: tenant.updatedAt })
  if (Object.keys(prof).length) await api.patch("/tenant/profile", prof)
}

function BusinessCard({ tenant, profile, onSaved }: { tenant: Tenant; profile: Profile; onSaved: () => Promise<void> }) {
  const { can, reload } = useAuth()
  const confirm = useConfirmChanges()
  const form = useForm({
    initial: { name: tenant.name, legalName: tenant.legalName ?? "", businessType: (profile.businessType ?? "") as BusinessType | "" },
    labels: { name: "Business name", legalName: "Legal name", businessType: "Business type" },
    clean: { name: squish, legalName: squish },
    fromServer: (path) => (["name", "legalName", "businessType"] as const).find((k) => k === path),
    rules: {
      name: (v) => (!v.trim() ? "Business name is required" : length(2, 100, "Business name")(v)),
      legalName: (v) => (v ? length(2, 160, "Legal name")(v) : null),
    },
    onSubmit: async (v, changed) => {
      const reason = changed.includes("legalName") ? await confirm.ask([{ label: "Legal name", before: tenant.legalName ?? "", after: v.legalName }], "The legal name is printed on every new invoice. Invoices already issued are not changed.") : undefined
      const patch: Record<string, unknown> = {}
      if (changed.includes("name")) patch.name = v.name
      if (changed.includes("legalName")) patch.legalName = v.legalName || null
      await saveBusiness(tenant, patch, changed.includes("businessType") ? { businessType: v.businessType } : {}, reason)
      await Promise.all([onSaved(), reload()])
      toast.success("Business details saved")
    },
  })
  return (
    <EditableSection
      id="business"
      icon={Building2}
      title="Business details"
      description="The name people see, and the name on your bills."
      form={form}
      canEdit={can("tenant.settings.edit")}
      confirmDialog={confirm.dialog}
      footerNote={tenant.lastChange ? <LastChanged tenant={tenant} /> : undefined}
      view={
        <ReadOnlyGrid
          items={[
            { label: "Business name", value: tenant.name },
            { label: "Legal name", value: tenant.legalName },
            { label: "Business type", value: typeLabel(profile.businessType) },
          ]}
        />
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" required error={form.errors.name}>
          <Input {...form.field("name")} autoComplete="organization" placeholder="e.g. Sharma Electronics" autoFocus />
        </Field>
        <Field label="Legal name" error={form.errors.legalName} hint="As registered, if different">
          <Input {...form.field("legalName")} placeholder="e.g. Sharma Electronics Pvt Ltd" />
        </Field>
        <Field label="Business type" error={form.errors.businessType} className="sm:col-span-2">
          <NativeSelect {...form.field("businessType")}>
            <option value="">Select type</option>
            {BUSINESS_TYPES.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </EditableSection>
  )
}

function TaxIdCard({ tenant, profile, onSaved }: { tenant: Tenant; profile: Profile; onSaved: () => Promise<void> }) {
  const { can, reload } = useAuth()
  const confirm = useConfirmChanges()
  const form = useForm({
    initial: { billingStateCode: tenant.billingStateCode ?? "", gstin: tenant.gstin ?? "", pan: profile.pan ?? "", businessType: profile.businessType ?? "" },
    labels: { billingStateCode: "State", gstin: "GSTIN", pan: "PAN" },
    clean: { gstin: upperNoSpaces, pan: upperNoSpaces },
    fromServer: (path) => (["billingStateCode", "gstin", "pan"] as const).find((k) => k === path),
    rules: {
      billingStateCode: (v) => (v ? null : "Choose your state — it decides CGST + SGST or IGST"),
      gstin: (v, all) => (v ? gstinRule(v) ?? gstinStateMismatch(v, all.billingStateCode) : null),
      pan: (v, all) => {
        if (!v) return null
        const e = panRule(v) ?? panTypeMismatch(v, (all.businessType || null) as BusinessType | null)
        if (e) return e
        // A GSTIN carries the PAN in characters 3–12
        return all.gstin.length === 15 && all.gstin.slice(2, 12) !== v ? "PAN doesn't match the GSTIN (characters 3–12)" : null
      },
    },
    onSubmit: async (v, changed) => {
      const rows: DiffRow[] = []
      if (changed.includes("billingStateCode")) rows.push({ label: "State", before: stateName(tenant.billingStateCode) ?? "", after: stateName(v.billingStateCode) ?? "" })
      if (changed.includes("gstin")) rows.push({ label: "GSTIN", before: tenant.gstin ?? "", after: v.gstin })
      const reason = rows.length ? await confirm.ask(rows, "These are printed on every new invoice and decide how GST is worked out. Invoices already issued are not changed.") : undefined
      const patch: Record<string, unknown> = {}
      if (changed.includes("billingStateCode")) {
        patch.billingStateCode = v.billingStateCode || null
        // The printed address names the state too
        patch.address = { ...(tenant.address ?? {}), state: stateName(v.billingStateCode) ?? undefined }
      }
      if (changed.includes("gstin")) patch.gstin = v.gstin || null
      const prof: Record<string, unknown> = {}
      if (changed.includes("pan")) prof.pan = v.pan
      if (changed.includes("gstin")) prof.gstRegistered = !!v.gstin
      await saveBusiness(tenant, patch, prof, reason)
      await Promise.all([onSaved(), reload()])
      toast.success("GST & PAN saved")
    },
  })
  const gstinOk = form.values.gstin && !gstinRule(form.values.gstin) && !gstinStateMismatch(form.values.gstin, form.values.billingStateCode)
  return (
    <EditableSection
      id="gst-pan"
      icon={Landmark}
      title="GST & PAN"
      description="Your state decides CGST + SGST or IGST on every bill."
      form={form}
      canEdit={can("tenant.settings.edit")}
      confirmDialog={confirm.dialog}
      view={
        <ReadOnlyGrid
          items={[
            { label: "State", value: tenant.billingStateCode ? `${stateName(tenant.billingStateCode)} (${tenant.billingStateCode})` : null },
            { label: "GSTIN", value: tenant.gstin ? <span className="font-mono">{tenant.gstin}</span> : <span className="font-normal text-muted-foreground">Not GST registered</span> },
            { label: "PAN", value: profile.pan ? <span className="font-mono">{profile.pan}</span> : null },
          ]}
        />
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="State" required error={form.errors.billingStateCode} className="sm:col-span-2">
          <StateSelect {...form.pick("billingStateCode")} />
        </Field>
        <Field label="GSTIN" error={form.errors.gstin} success={gstinOk ? `Valid · ${stateName(form.values.gstin.slice(0, 2))}` : null} hint="Leave empty if not GST registered">
          <Input mask="gstin" {...form.field("gstin")} maxLength={15} className="font-mono uppercase" autoCapitalize="characters" spellCheck={false} placeholder="e.g. 27AAKFS1234L1Z5" autoFocus />
        </Field>
        <Field label="PAN" error={form.errors.pan}>
          <Input mask="pan" {...form.field("pan")} maxLength={10} className="font-mono uppercase" autoCapitalize="characters" spellCheck={false} placeholder="e.g. AAKFS1234L" />
        </Field>
      </div>
    </EditableSection>
  )
}

function AddressCard({ tenant, onSaved }: { tenant: Tenant; onSaved: () => Promise<void> }) {
  const { can, reload } = useAuth()
  const a = tenant.address ?? {}
  const form = useForm({
    initial: { line1: a.line1 ?? "", line2: a.line2 ?? "", city: a.city ?? "", pincode: a.pincode ?? "" },
    labels: { line1: "Address", line2: "Address line 2", city: "City", pincode: "PIN code" },
    clean: { line1: squish, line2: squish, city: squish, pincode: (v) => v.replace(/\s/g, "") },
    fromServer: (path) => (path.startsWith("address.") ? (path.slice(8) as "line1") : undefined),
    rules: {
      line1: (v, all) => (v ? length(3, 200, "Address")(v) : all.city || all.pincode ? "Add the street address" : null),
      line2: (v) => (v ? length(0, 200, "Address line 2")(v) : null),
      city: (v, all) => (v ? length(2, 80, "City")(v) : all.line1 ? "Add the city" : null),
      pincode: (v, all) => (v ? pincodeRule(v) : all.line1 ? "Add the PIN code" : null),
    },
    onSubmit: async (v) => {
      await saveBusiness(tenant, { address: { ...a, line1: v.line1, line2: v.line2, city: v.city, pincode: v.pincode, state: stateName(tenant.billingStateCode) ?? undefined } }, {})
      await Promise.all([onSaved(), reload()])
      toast.success("Address saved")
    },
  })
  const lines = [a.line1, a.line2, [a.city, a.pincode].filter(Boolean).join(" "), tenant.billingStateCode ? stateName(tenant.billingStateCode) : null].filter(Boolean)
  return (
    <EditableSection
      id="address"
      icon={MapPin}
      title="Address"
      description="Printed under your name on invoices and quotations."
      form={form}
      canEdit={can("tenant.settings.edit")}
      view={
        lines.length ? (
          <address className="text-sm leading-relaxed font-medium not-italic">
            {lines.map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </address>
        ) : (
          <p className="text-sm text-muted-foreground">No address yet. Customers see it on every bill.</p>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Address line 1" error={form.errors.line1} className="sm:col-span-2">
          <Input {...form.field("line1")} autoComplete="address-line1" placeholder="e.g. Shop 12, MG Road" autoFocus />
        </Field>
        <Field label="Address line 2" error={form.errors.line2} className="sm:col-span-2">
          <Input {...form.field("line2")} autoComplete="address-line2" placeholder="e.g. Near City Mall (optional)" />
        </Field>
        <Field label="City" error={form.errors.city}>
          <Input {...form.field("city")} autoComplete="address-level2" placeholder="e.g. Pune" />
        </Field>
        <Field label="PIN code" error={form.errors.pincode}>
          <Input mask="pincode" {...form.field("pincode")} autoComplete="postal-code" placeholder="e.g. 411001" />
        </Field>
        <p className="text-xs text-muted-foreground sm:col-span-2">State comes from GST & PAN{tenant.billingStateCode ? ` (${stateName(tenant.billingStateCode)})` : ""}.</p>
      </div>
    </EditableSection>
  )
}

function ContactCard({ profile, onSaved }: { profile: Profile; onSaved: () => Promise<void> }) {
  const { can } = useAuth()
  const form = useForm({
    initial: { phone: profile.phone ?? "", email: profile.email ?? "" },
    labels: { phone: "Phone", email: "Email" },
    clean: { phone: (v) => v.trim(), email: (v) => v.trim().toLowerCase() },
    fromServer: (path) => (["phone", "email"] as const).find((k) => k === path),
    rules: { phone: (v) => (v ? phoneRule(v) : null), email: (v) => (v ? emailRule(v) : null) },
    onSubmit: async (v, changed) => {
      await api.patch("/tenant/profile", Object.fromEntries(changed.map((k) => [k, v[k]])))
      await onSaved()
      toast.success("Contact details saved")
    },
  })
  return (
    <EditableSection
      id="contact"
      icon={Phone}
      title="Contact on documents"
      description="The phone and email customers see on your bills."
      form={form}
      canEdit={can("tenant.settings.edit")}
      view={
        <ReadOnlyGrid
          items={[
            { label: "Phone", value: profile.phone ? formatMobile(profile.phone) : null },
            { label: "Email", value: profile.email },
          ]}
        />
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" error={form.errors.phone}>
          <Input mask="phone" {...form.field("phone")} autoComplete="tel" placeholder="e.g. 9876543210" autoFocus />
        </Field>
        <Field label="Email" error={form.errors.email}>
          <Input type="email" {...form.field("email")} autoComplete="email" placeholder="e.g. accounts@yourbusiness.in" />
        </Field>
      </div>
    </EditableSection>
  )
}

function FormatsCard({ tenant, profile, onSaved }: { tenant: Tenant; profile: Profile; onSaved: () => Promise<void> }) {
  const { can, reload } = useAuth()
  const confirm = useConfirmChanges()
  const form = useForm({
    initial: {
      fyStartMonth: String(tenant.fyStartMonth),
      timezone: tenant.timezone,
      dateFormat: profile.dateFormat ?? "d_mmm_yyyy",
      numberFormat: profile.numberFormat ?? "indian",
      weekStart: profile.weekStart ?? "monday",
    },
    labels: { fyStartMonth: "Financial year", timezone: "Time zone", dateFormat: "Date format", numberFormat: "Number format", weekStart: "Week starts" },
    fromServer: (path) => (["fyStartMonth", "timezone", "dateFormat", "numberFormat", "weekStart"] as const).find((k) => k === path),
    onSubmit: async (v, changed) => {
      const reason = changed.includes("fyStartMonth")
        ? await confirm.ask([{ label: "Financial year", before: fyLabel(tenant.fyStartMonth), after: fyLabel(Number(v.fyStartMonth)) }], "Number series and reports follow the financial year.")
        : undefined
      const patch: Record<string, unknown> = {}
      if (changed.includes("fyStartMonth")) patch.fyStartMonth = Number(v.fyStartMonth)
      if (changed.includes("timezone")) patch.timezone = v.timezone
      if (Object.keys(patch).length) await api.patch("/tenant", { ...patch, ...(reason ? { reason } : {}), expectedUpdatedAt: tenant.updatedAt })
      const prof = Object.fromEntries(changed.filter((k) => ["dateFormat", "numberFormat", "weekStart"].includes(k)).map((k) => [k, v[k]]))
      if (Object.keys(prof).length) await api.patch("/tenant/profile", prof)
      await Promise.all([onSaved(), reload()])
      toast.success("Formats saved")
    },
  })

  return (
    <div>
      <EditableSection
        id="formats"
        icon={CalendarRange}
        title="Year, time & formats"
        description="How dates, numbers and the financial year work across the app."
        form={form}
        canEdit={can("tenant.settings.edit")}
        confirmDialog={confirm.dialog}
        view={
          <ReadOnlyGrid
            className="sm:grid-cols-3"
            items={[
              {
                label: "Financial year",
                value: (
                  <>
                    {fyLabel(tenant.fyStartMonth)} {tenant.fyLocked && <span className="text-[11px] text-muted-foreground">· locked (invoices issued)</span>}
                  </>
                ),
              },
              { label: "Time zone", value: tzLabel(tenant.timezone) },
              { label: "Currency", value: "Indian Rupee (₹)" },
              { label: "Date format", value: DATE_FORMATS.find((d) => d.key === (profile.dateFormat ?? "d_mmm_yyyy"))?.label },
              { label: "Number format", value: NUMBER_FORMATS.find((n) => n.key === (profile.numberFormat ?? "indian"))?.label },
              { label: "Week starts", value: profile.weekStart === "sunday" ? "Sunday" : "Monday" },
            ]}
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Financial year starts in" error={form.errors.fyStartMonth} hint={tenant.fyLocked ? "Locked — invoices are already numbered this way" : "Locked once your first invoice is issued"}>
            <NativeSelect {...form.field("fyStartMonth")} disabled={tenant.fyLocked}>
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Time zone" error={form.errors.timezone}>
            <NativeSelect {...form.field("timezone")}>
              {TIME_ZONES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Currency" hint="Other currencies arrive with export invoices">
            <Input value="Indian Rupee (₹)" disabled readOnly />
          </Field>
          <Field label="Date format" error={form.errors.dateFormat} hint="People can choose their own in My account">
            <NativeSelect {...form.field("dateFormat")}>
              {DATE_FORMATS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Number format" error={form.errors.numberFormat}>
            <NativeSelect {...form.field("numberFormat")}>
              {NUMBER_FORMATS.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Week starts on" error={form.errors.weekStart}>
            <NativeSelect {...form.field("weekStart")}>
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
            </NativeSelect>
          </Field>
        </div>
      </EditableSection>
    </div>
  )
}
