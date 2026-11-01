"use client"

import { StateSelect } from "@/components/search-select"
import * as React from "react"
import { BUSINESS_TYPES, email as emailRule, length, pan as panRule, panTypeMismatch, phone as phoneRule, pincode as pincodeRule, squish, stateName, upperNoSpaces, type BusinessType } from "@contracts/validation"
import { Input } from "@/components/ui/input"
import { Field, NativeSelect } from "@/components/form"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useForm } from "@/lib/use-form"
import { LogoUpload } from "@/components/logo-upload"
import { StepFooter, StepHeader, type StepProps } from "./wizard"

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const SETUP_REASON = "Set during workspace setup"

export function ProfileStep({ tenant, workspace, refresh, complete, back }: StepProps) {
  const { me, reload } = useAuth()
  const p = workspace.profile
  const a = tenant.address ?? {}
  const form = useForm({
    initial: {
      logoUrl: tenant.logoUrl ?? "",
      line1: a.line1 ?? "",
      line2: a.line2 ?? "",
      city: a.city ?? "",
      pincode: a.pincode ?? "",
      billingStateCode: tenant.billingStateCode ?? "",
      businessType: (p.businessType ?? "") as string,
      pan: p.pan ?? (tenant.gstin ? tenant.gstin.slice(2, 12) : ""),
      fyStartMonth: String(tenant.fyStartMonth),
      phone: p.phone ?? me?.user.mobile ?? "",
      email: p.email ?? me?.user.email ?? "",
    },
    labels: { businessType: "Business type", line1: "Address", city: "City", pincode: "PIN code", billingStateCode: "State", pan: "PAN", logoUrl: "Logo", phone: "Phone", email: "Email" },
    clean: { line1: squish, line2: squish, city: squish, pincode: (v) => v.replace(/\s/g, ""), pan: upperNoSpaces, logoUrl: (v) => v.trim(), email: (v) => v.trim().toLowerCase() },
    fromServer: (path) => (path.startsWith("address.") ? (path.slice(8) as "line1") : (path as "pan")),
    rules: {
      line1: (v) => (!v ? "Add your business address — it's printed on invoices" : length(3, 200, "Address")(v)),
      city: (v) => (!v ? "Add the city" : length(2, 80, "City")(v)),
      pincode: (v) => (!v ? "Add the PIN code" : pincodeRule(v)),
      billingStateCode: (v) => (v ? null : "Choose your state"),
      businessType: (v) => (v ? null : "Choose your business type"),
      pan: (v, all) =>
        v
          ? (panRule(v) ??
            (tenant.gstin && v !== tenant.gstin.slice(2, 12) ? `Must match the PAN inside your GSTIN (${tenant.gstin.slice(2, 12)})` : null) ??
            panTypeMismatch(v, (all.businessType || null) as BusinessType | null))
          : null,
      phone: (v) => (v ? phoneRule(v) : null),
      email: (v) => (v ? emailRule(v) : null),
    },
    onSubmit: async (v, changed) => {
      const tenantPatch: Record<string, unknown> = {}
      if (changed.some((k) => ["line1", "line2", "city", "pincode"].includes(k)) || !tenant.address) {
        tenantPatch.address = { line1: v.line1, line2: v.line2, city: v.city, pincode: v.pincode, state: stateName(v.billingStateCode) ?? undefined }
      }
      if (changed.includes("logoUrl")) tenantPatch.logoUrl = v.logoUrl || null
      if (changed.includes("billingStateCode")) tenantPatch.billingStateCode = v.billingStateCode
      if (changed.includes("fyStartMonth")) tenantPatch.fyStartMonth = Number(v.fyStartMonth)
      if (Object.keys(tenantPatch).length) await api.patch("/tenant", { ...tenantPatch, reason: SETUP_REASON, expectedUpdatedAt: tenant.updatedAt })
      await api.patch("/tenant/profile", { businessType: v.businessType, pan: v.pan, phone: v.phone, email: v.email })
      await Promise.all([refresh(), reload()])
      await complete("done")
    },
  })
  const v = form.values
  const gstLocked = !!tenant.gstin

  return (
    <form {...form.formProps} onSubmit={form.submit} className="flex min-h-full flex-col gap-6">
      <StepHeader title="Business profile" description="This appears on every invoice, quotation and receipt." />
      <LogoUpload value={v.logoUrl} onChange={(url) => form.set("logoUrl", url)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Address line 1" required error={form.errors.line1} className="sm:col-span-2">
          <Input {...form.field("line1")} autoComplete="address-line1" autoFocus />
        </Field>
        <Field label="Address line 2" error={form.errors.line2} className="sm:col-span-2">
          <Input {...form.field("line2")} autoComplete="address-line2" />
        </Field>
        <Field label="City" required error={form.errors.city}>
          <Input {...form.field("city")} autoComplete="address-level2" />
        </Field>
        <Field label="PIN code" required error={form.errors.pincode}>
          <Input mask="pincode" {...form.field("pincode")} autoComplete="postal-code" />
        </Field>
        <Field label="State" required error={form.errors.billingStateCode} hint={gstLocked ? "From your GSTIN — change it in Settings › Business" : undefined}>
          <StateSelect {...form.pick("billingStateCode")} disabled={gstLocked} />
        </Field>
        <Field label="Business type" required error={form.errors.businessType}>
          <NativeSelect {...form.field("businessType")}>
            <option value="">Choose</option>
            {BUSINESS_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="PAN" error={form.errors.pan} hint={tenant.gstin ? "Taken from your GSTIN" : "Optional for proprietors"}>
          <Input mask="pan" {...form.field("pan")} maxLength={10} className="font-mono uppercase" spellCheck={false} />
        </Field>
        <Field label="Financial year starts in" required hint="Locked after your first invoice">
          <NativeSelect {...form.field("fyStartMonth")}>
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>
                {m}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Phone on documents" error={form.errors.phone}>
          <Input mask="phone" {...form.field("phone")} />
        </Field>
        <Field label="Email on documents" error={form.errors.email}>
          <Input {...form.field("email")} type="email" inputMode="email" />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">Time zone India (IST) · Currency Indian Rupee (₹) — change these in Settings › Business.</p>
      <StepFooter back={back} onSkip={() => void complete("skipped")} saving={form.submitting} error={form.formError} />
    </form>
  )
}
