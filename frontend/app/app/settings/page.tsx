"use client"

import { StateSelect } from "@/components/search-select"
import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  BUSINESS_TYPES, gstin as gstinRule, gstinStateMismatch, length, pan as panRule, panTypeMismatch, pincode as pincodeRule, squish, stateName, upperNoSpaces, type BusinessType,
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
import { formatDate } from "@/lib/format"

// Settings › Organization (wireframe X1): business profile, then year, time & formats.

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
  return (
    <SettingsPage title="Organization" description="Your business details, year and formats. Printed on documents.">
      <ProfileCard key={`p-${key}-${JSON.stringify(ws.data.profile)}`} tenant={t} profile={ws.data.profile} onSaved={reload} />
      <FormatsCard key={`f-${key}-${JSON.stringify(ws.data.profile)}`} tenant={t} profile={ws.data.profile} onSaved={reload} />
      {!me?.tenant?.billingStateCode && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-3.5 text-[13px] text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" role="status">
          <span>
            <strong>Taxes needs attention:</strong> add your state so invoices charge CGST + SGST or IGST correctly.
          </span>
          <Link href="/app/settings#business-profile" className="ml-auto font-semibold text-primary hover:underline">
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

function ProfileCard({ tenant, profile, onSaved }: { tenant: Tenant; profile: Profile; onSaved: () => Promise<void> }) {
  const { can, reload } = useAuth()
  const confirm = useConfirmChanges()
  const a = tenant.address ?? {}
  const form = useForm({
    initial: {
      name: tenant.name,
      legalName: tenant.legalName ?? "",
      businessType: (profile.businessType ?? "") as BusinessType | "",
      billingStateCode: tenant.billingStateCode ?? "",
      gstin: tenant.gstin ?? "",
      pan: profile.pan ?? "",
      line1: a.line1 ?? "",
      line2: a.line2 ?? "",
      city: a.city ?? "",
      pincode: a.pincode ?? "",
    },
    labels: { name: "Business name", legalName: "Legal name", businessType: "Business type", billingStateCode: "State", gstin: "GSTIN", pan: "PAN", line1: "Address", city: "City", pincode: "PIN code" },
    clean: { name: squish, legalName: squish, gstin: upperNoSpaces, pan: upperNoSpaces, line1: squish, line2: squish, city: squish, pincode: (v) => v.replace(/\s/g, "") },
    fromServer: (path) =>
      path.startsWith("address.") ? (path.slice(8) as "line1") : (["name", "legalName", "billingStateCode", "gstin", "pan", "businessType"] as const).find((k) => k === path),
    rules: {
      name: (v) => (!v.trim() ? "Business name is required" : length(2, 100, "Business name")(v)),
      legalName: (v) => (v ? length(2, 160, "Legal name")(v) : null),
      billingStateCode: (v) => (v ? null : "Choose your state — it decides CGST + SGST or IGST"),
      gstin: (v, all) => (v ? gstinRule(v) ?? gstinStateMismatch(v, all.billingStateCode) : null),
      pan: (v, all) => {
        if (!v) return null
        const e = panRule(v) ?? panTypeMismatch(v, all.businessType || null)
        if (e) return e
        // A GSTIN carries the PAN in characters 3–12
        return all.gstin.length === 15 && all.gstin.slice(2, 12) !== v ? "PAN doesn't match the GSTIN (characters 3–12)" : null
      },
      line1: (v) => (v ? length(3, 200, "Address")(v) : null),
      city: (v) => (v ? length(2, 80, "City")(v) : null),
      pincode: (v) => (v ? pincodeRule(v) : null),
    },
    onSubmit: async (v, changed) => {
      const rows: DiffRow[] = []
      if (changed.includes("legalName")) rows.push({ label: "Legal name", before: tenant.legalName ?? "", after: v.legalName })
      if (changed.includes("billingStateCode")) rows.push({ label: "State", before: stateName(tenant.billingStateCode) ?? "", after: stateName(v.billingStateCode) ?? "" })
      if (changed.includes("gstin")) rows.push({ label: "GSTIN", before: tenant.gstin ?? "", after: v.gstin })
      const reason = rows.length ? await confirm.ask(rows, "These are printed on every new invoice and decide how GST is worked out. Invoices already issued are not changed.") : undefined

      const patch: Record<string, unknown> = {}
      if (changed.includes("name")) patch.name = v.name
      if (changed.includes("legalName")) patch.legalName = v.legalName || null
      if (changed.includes("billingStateCode")) patch.billingStateCode = v.billingStateCode || null
      if (changed.includes("gstin")) patch.gstin = v.gstin || null
      if (changed.some((k) => ["line1", "line2", "city", "pincode", "billingStateCode"].includes(k))) {
        patch.address = { ...a, line1: v.line1, line2: v.line2, city: v.city, pincode: v.pincode, state: stateName(v.billingStateCode) ?? undefined }
      }
      if (Object.keys(patch).length) await api.patch("/tenant", { ...patch, ...(reason ? { reason } : {}), expectedUpdatedAt: tenant.updatedAt })
      const prof: Record<string, unknown> = {}
      if (changed.includes("businessType")) prof.businessType = v.businessType
      if (changed.includes("pan")) prof.pan = v.pan
      if (changed.includes("gstin")) prof.gstRegistered = !!v.gstin
      if (Object.keys(prof).length) await api.patch("/tenant/profile", prof)
      await Promise.all([onSaved(), reload()])
      toast.success("Business profile saved")
    },
  })

  const address = [a.line1, a.line2, a.city && a.pincode ? `${a.city} ${a.pincode}` : a.city || a.pincode].filter(Boolean).join(", ")
  const gstinOk = form.values.gstin && !gstinRule(form.values.gstin) && !gstinStateMismatch(form.values.gstin, form.values.billingStateCode)

  return (
    <div id="business-profile">
      <EditableSection
        title="Business profile"
        form={form}
        canEdit={can("tenant.settings.edit")}
        confirmDialog={confirm.dialog}
        footerNote={tenant.lastChange ? <LastChanged tenant={tenant} /> : undefined}
        view={
          <ReadOnlyGrid
            className="sm:grid-cols-3"
            items={[
              { label: "Business name", value: tenant.name },
              { label: "Legal name", value: tenant.legalName },
              { label: "Business type", value: typeLabel(profile.businessType) },
              { label: "GSTIN", value: tenant.gstin ? <span className="font-mono">{tenant.gstin}</span> : "Not GST registered" },
              { label: "PAN", value: profile.pan ? <span className="font-mono">{profile.pan}</span> : null },
              { label: "Address", value: address ? `${address}${tenant.billingStateCode ? `, ${stateName(tenant.billingStateCode)}` : ""}` : null },
            ]}
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" required error={form.errors.name}>
            <Input {...form.field("name")} autoComplete="organization" autoFocus />
          </Field>
          <Field label="Legal name" error={form.errors.legalName} hint="As registered, if different">
            <Input {...form.field("legalName")} />
          </Field>
          <Field label="Business type" error={form.errors.businessType}>
            <NativeSelect {...form.field("businessType")}>
              <option value="">Select type</option>
              {BUSINESS_TYPES.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="State" required error={form.errors.billingStateCode}>
            <StateSelect {...form.pick("billingStateCode")} />
          </Field>
          <Field label="GSTIN" error={form.errors.gstin} success={gstinOk ? `Valid · ${stateName(form.values.gstin.slice(0, 2))}` : null} hint="Leave empty if not GST registered">
            <Input mask="gstin" {...form.field("gstin")} maxLength={15} className="font-mono uppercase" autoCapitalize="characters" spellCheck={false} />
          </Field>
          <Field label="PAN" error={form.errors.pan}>
            <Input mask="pan" {...form.field("pan")} maxLength={10} className="font-mono uppercase" autoCapitalize="characters" spellCheck={false} />
          </Field>
          <Field label="Address line 1" error={form.errors.line1} className="sm:col-span-2">
            <Input {...form.field("line1")} autoComplete="address-line1" />
          </Field>
          <Field label="Address line 2" error={form.errors.line2} className="sm:col-span-2">
            <Input {...form.field("line2")} autoComplete="address-line2" />
          </Field>
          <Field label="City" error={form.errors.city}>
            <Input {...form.field("city")} autoComplete="address-level2" />
          </Field>
          <Field label="PIN code" error={form.errors.pincode}>
            <Input mask="pincode" {...form.field("pincode")} autoComplete="postal-code" />
          </Field>
        </div>
      </EditableSection>
    </div>
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
    <div id="formats">
      <EditableSection
        title="Year, time & formats"
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
