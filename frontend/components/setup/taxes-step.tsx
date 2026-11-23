"use client"

import * as React from "react"
import { stateName } from "@contracts/validation"
import { NativeSelect } from "@/components/form"
import { ChoiceChip } from "@/components/onboarding"
import { api } from "@/lib/api"
import { useForm } from "@/lib/use-form"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { BadgeCheck, Info } from "lucide-react"
import { StepFooter, StepHeader, type StepProps } from "./wizard"

const GST_RATES = [0, 500, 1200, 1800, 2800]

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:ring-3 focus-visible:ring-primary/30 focus-visible:outline-none",
        checked ? "bg-primary" : "bg-muted-foreground/30"
      )}
    >
      <span
        className={cn(
          "absolute top-1 left-1 size-4 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-5"
        )}
      />
    </button>
  )
}

function Row({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b py-4 last:border-b-0">
      <div className="min-w-56 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

/** Where the business stands with GST: decides which rows below matter */
function GstStatus({
  registered,
  gstin,
  stateCode,
  composition,
}: {
  registered: boolean
  gstin: string | null
  stateCode: string | null
  composition: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm",
        registered
          ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30"
          : "bg-muted/50"
      )}
    >
      {registered ? (
        <BadgeCheck className="size-5 shrink-0 text-emerald-600" aria-hidden />
      ) : (
        <Info className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        {registered ? (
          <>
            <p className="font-semibold">
              GST registered · <span className="font-mono">{gstin}</span>
              {stateCode && ` · ${stateName(stateCode)}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {composition
                ? "On composition: bills are Bills of Supply with no GST shown."
                : "Sales inside your state get CGST + SGST; to other states, IGST."}
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold">Not GST registered</p>
            <p className="text-xs text-muted-foreground">
              Your bills are plain invoices with no GST. Add a GSTIN when you
              register and the GST settings appear here.
            </p>
          </>
        )}
      </div>
      <Link
        href="/app/settings#gst-pan"
        className="text-xs font-semibold text-primary hover:underline"
      >
        {registered ? "Change GSTIN" : "Add GSTIN"}
      </Link>
    </div>
  )
}

export function TaxesStep({
  tenant,
  workspace,
  refresh,
  complete,
  back,
}: StepProps) {
  const t = workspace.preferences.taxes
  const registered = !!tenant.gstin
  const form = useForm({
    initial: {
      composition:
        registered && (t.composition || !!workspace.profile.composition),
      compositionRateBp: t.compositionRateBp ? String(t.compositionRateBp) : "",
      pricesIncludeTax: t.pricesIncludeTax,
      defaultGstRateBp: String(t.defaultGstRateBp),
      hsnDigits: t.hsnDigits,
      reverseCharge: t.reverseCharge,
      roundOff: !!t.roundOff,
      eInvoicing: !!t.eInvoicing,
    },
    rules: {
      compositionRateBp: (v, all) =>
        all.composition && !v ? "Choose your composition rate" : null,
    },
    onSubmit: async (v) => {
      await api.put("/tenant/preferences/taxes", {
        composition: v.composition,
        compositionRateBp: v.composition ? Number(v.compositionRateBp) : null,
        pricesIncludeTax: v.pricesIncludeTax,
        defaultGstRateBp: Number(v.defaultGstRateBp),
        hsnDigits: v.hsnDigits,
        reverseCharge: v.reverseCharge,
        roundOff: v.roundOff,
        eInvoicing: registered && !v.composition && v.eInvoicing,
      })
      await refresh()
      await complete("done")
    },
  })
  const v = form.values

  return (
    <form
      {...form.formProps}
      onSubmit={form.submit}
      className="flex min-h-full flex-col gap-6"
    >
      <StepHeader
        title="Taxes"
        description={
          registered
            ? `GST registered · ${tenant.gstin} · ${stateName(tenant.billingStateCode)}. Sales inside your state get CGST + SGST, others IGST.`
            : "You're not GST registered, so invoices show no GST. You can add a GSTIN any time in Settings › Business."
        }
      />
      <GstStatus
        registered={registered}
        gstin={tenant.gstin}
        stateCode={tenant.billingStateCode}
        composition={v.composition}
      />
      <div className="rounded-3xl border px-5">
        {registered && (
          <>
            <Row
              title="Composition scheme"
              description="Invoices become Bill of Supply and show no GST."
            >
              <div className="flex items-center gap-3">
                {v.composition && (
                  <NativeSelect
                    name="compositionRateBp"
                    value={v.compositionRateBp}
                    onChange={(e) =>
                      form.set("compositionRateBp", e.target.value)
                    }
                    aria-label="Composition rate"
                    aria-invalid={!!form.errors.compositionRateBp || undefined}
                    className="w-36"
                  >
                    <option value="">Rate</option>
                    <option value="100">1% (traders)</option>
                    <option value="500">5% (restaurants)</option>
                    <option value="600">6% (services)</option>
                  </NativeSelect>
                )}
                <Toggle
                  checked={v.composition}
                  onChange={(c) => form.set("composition", c)}
                  label="Composition scheme"
                />
              </div>
            </Row>
            {form.errors.compositionRateBp && (
              <p className="-mt-2 pb-2 text-xs text-destructive">
                {form.errors.compositionRateBp}
              </p>
            )}
            <Row
              title="Prices you enter include GST"
              description="Default for new items. ₹1,770 incl. GST = ₹1,500 + ₹270 GST."
            >
              <div className="flex gap-2">
                <ChoiceChip
                  selected={v.pricesIncludeTax}
                  onClick={() => form.set("pricesIncludeTax", true)}
                >
                  Include GST
                </ChoiceChip>
                <ChoiceChip
                  selected={!v.pricesIncludeTax}
                  onClick={() => form.set("pricesIncludeTax", false)}
                >
                  Exclude GST
                </ChoiceChip>
              </div>
            </Row>
          </>
        )}
        <Row
          title="Round bills to the whole rupee"
          description="Default for new bills. ₹117.60 becomes ₹118. You can change it on each bill."
        >
          <Toggle
            checked={v.roundOff}
            onChange={(c) => form.set("roundOff", c)}
            label="Round off"
          />
        </Row>
        {registered && (
          <>
            <Row
              title="Default GST rate for new items"
              description="Each item can still have its own rate."
            >
              <NativeSelect
                {...form.field("defaultGstRateBp")}
                className="w-28"
                aria-label="Default GST rate"
              >
                {GST_RATES.map((r) => (
                  <option key={r} value={String(r)}>
                    {r / 100}%
                  </option>
                ))}
              </NativeSelect>
            </Row>
            <Row
              title="HSN / SAC digits on invoices"
              description="4 digits if last year's turnover was up to ₹5 Cr, 6 digits above that."
            >
              <div className="flex gap-2">
                <ChoiceChip
                  selected={v.hsnDigits === 4}
                  onClick={() => form.set("hsnDigits", 4)}
                >
                  4 digits
                </ChoiceChip>
                <ChoiceChip
                  selected={v.hsnDigits === 6}
                  onClick={() => form.set("hsnDigits", 6)}
                >
                  6 digits
                </ChoiceChip>
              </div>
            </Row>
            {!v.composition && (
              <Row
                title="E-invoicing"
                description="Turn on if your turnover is above the e-invoice limit (₹5 Cr). B2B bills then get an E-invoice button for the portal file."
              >
                <Toggle
                  checked={v.eInvoicing}
                  onChange={(c) => form.set("eInvoicing", c)}
                  label="E-invoicing"
                />
              </Row>
            )}
            <Row
              title="Reverse charge on sales"
              description="Turn on only if your customers pay the GST for some sales."
            >
              <Toggle
                checked={v.reverseCharge}
                onChange={(c) => form.set("reverseCharge", c)}
                label="Reverse charge"
              />
            </Row>
            <Row
              title="TDS / TCS"
              description="Coming later. You'll find it here."
            >
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Later
              </span>
            </Row>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Not sure? Leave the defaults — your CA can change them any time.
      </p>
      <StepFooter
        back={back}
        onSkip={() => void complete("skipped")}
        saving={form.submitting}
        error={form.formError}
        saveLabel={registered ? "Save & continue" : "Continue"}
        dirty={form.dirty}
      />
    </form>
  )
}
