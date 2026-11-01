"use client"

import * as React from "react"
import { bankAccount, ifsc as ifscRule, length, upiId as upiRule, upperNoSpaces } from "@contracts/validation"
import { DOC_TEMPLATES, prefixError, previewNumber, type WorkspacePreferences } from "@contracts/workspace"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/form"
import { ChoiceChip } from "@/components/onboarding"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { initials } from "@/lib/format"
import { useForm } from "@/lib/use-form"
import { UpiQr } from "@/components/upi-qr"
import { cn } from "@/lib/utils"
import { StepFooter, StepHeader, type StepProps } from "./wizard"

/** "26-27" for today in India with the business's FY start month. */
export function currentFy(startMonth: number) {
  const now = new Date(Date.now() + 330 * 60_000)
  const y = now.getUTCFullYear()
  const startYear = now.getUTCMonth() + 1 >= startMonth ? y : y - 1
  return startMonth === 1 ? String(startYear) : `${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`
}

export function DocumentsStep({ tenant, workspace, refresh, complete, back }: StepProps) {
  const { me } = useAuth()
  const d = workspace.preferences.documents
  const pay = workspace.preferences.payments
  const fy = currentFy(tenant.fyStartMonth)
  const form = useForm({
    initial: {
      invoicePrefix: d.invoicePrefix,
      quotationPrefix: d.quotationPrefix,
      receiptPrefix: d.receiptPrefix,
      invoiceStartAt: "",
      template: d.template as string,
      paper: d.paper as string,
      terms: d.terms,
      bankHolder: pay.bankHolder || (tenant.legalName ?? tenant.name),
      bankAccount: pay.bankAccount,
      bankAccountConfirm: pay.bankAccount,
      ifsc: pay.ifsc,
      upiId: pay.upiId,
      showUpiQr: pay.showUpiQr,
    },
    labels: { invoicePrefix: "Invoice prefix", quotationPrefix: "Quotation prefix", receiptPrefix: "Receipt prefix", invoiceStartAt: "Start number", bankAccount: "Account number", bankAccountConfirm: "Re-enter account number", ifsc: "IFSC", upiId: "UPI ID", terms: "Terms" },
    clean: { invoicePrefix: (v) => v.trim(), quotationPrefix: (v) => v.trim(), receiptPrefix: (v) => v.trim(), ifsc: upperNoSpaces, bankAccount: (v) => v.replace(/\s/g, ""), bankAccountConfirm: (v) => v.replace(/\s/g, ""), upiId: (v) => v.trim() },
    rules: {
      invoicePrefix: (v) => prefixError(v, fy),
      quotationPrefix: (v) => prefixError(v, fy),
      receiptPrefix: (v) => prefixError(v, fy),
      invoiceStartAt: (v) => (v && !/^[1-9]\d{0,6}$/.test(v) ? "Use a whole number from 1" : null),
      terms: (v) => length(0, 2000, "Terms")(v),
      bankHolder: (v, all) => (all.bankAccount && !v.trim() ? "Add the account holder name" : null),
      bankAccount: (v, all) => (v ? bankAccount(v) : all.ifsc ? "Add the account number" : null),
      bankAccountConfirm: (v, all) => (all.bankAccount && v !== all.bankAccount ? "Account numbers don't match" : null),
      ifsc: (v, all) => (v ? ifscRule(v) : all.bankAccount ? "Add the IFSC" : null),
      upiId: (v, all) => (v ? upiRule(v) : all.showUpiQr ? "Add a UPI ID to print the QR code" : null),
    },
    fromServer: (path) => (path as "upiId"),
    onSubmit: async (v) => {
      await api.put("/tenant/preferences/documents", { invoicePrefix: v.invoicePrefix, quotationPrefix: v.quotationPrefix, receiptPrefix: v.receiptPrefix, template: v.template, paper: v.paper, terms: v.terms })
      await api.put("/tenant/preferences/payments", { bankHolder: v.bankAccount ? v.bankHolder : "", bankAccount: v.bankAccount, ifsc: v.ifsc, upiId: v.upiId, showUpiQr: v.showUpiQr })
      if (v.invoiceStartAt) await api.post("/tenant/sequences/invoice-start", { startAt: Number(v.invoiceStartAt) })
      await refresh()
      await complete("done")
    },
  })
  const v = form.values
  const accountOk = v.bankAccount && !bankAccount(v.bankAccount) && v.bankAccountConfirm === v.bankAccount

  return (
    <form {...form.formProps} onSubmit={form.submit} className="flex min-h-full flex-col gap-6">
      <StepHeader title="Invoices & payments" description="How your documents are numbered, how they look and how customers pay you. All optional." />
      <div className="grid gap-8 xl:grid-cols-[1fr_22rem]">
        <div className="grid content-start gap-6">
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">Numbering</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Invoice prefix" error={form.errors.invoicePrefix} hint={`Next: ${previewNumber(v.invoicePrefix, fy, Number(v.invoiceStartAt) || 1)}`}>
                <Input {...form.field("invoicePrefix")} className="font-mono" />
              </Field>
              <Field label="Quotation prefix" error={form.errors.quotationPrefix} hint={`Next: ${previewNumber(v.quotationPrefix, fy, 1)}`}>
                <Input {...form.field("quotationPrefix")} className="font-mono" />
              </Field>
              <Field label="Receipt prefix" error={form.errors.receiptPrefix} hint={`Next: ${previewNumber(v.receiptPrefix, fy, 1)}`}>
                <Input {...form.field("receiptPrefix")} className="font-mono" />
              </Field>
              <Field label="Start invoices at" error={form.errors.invoiceStartAt} hint="Moving from another app? Use your next invoice number. Leave empty to start at 1." className="sm:col-span-3">
                <Input {...form.field("invoiceStartAt")} inputMode="numeric" placeholder="1" className="max-w-40" />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">Use {"{FY}"} for the financial year. GST allows up to 16 characters in an invoice number.</p>
          </section>

          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">Template</h2>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Invoice template">
              {DOC_TEMPLATES.map((t) => (
                <ChoiceChip key={t.key} selected={v.template === t.key} onClick={() => form.set("template", t.key)}>
                  {t.label}
                </ChoiceChip>
              ))}
              <span className="mx-1 w-px bg-border" aria-hidden />
              <ChoiceChip selected={v.paper === "a4"} onClick={() => form.set("paper", "a4")}>
                A4
              </ChoiceChip>
              <ChoiceChip selected={v.paper === "80mm"} onClick={() => form.set("paper", "80mm")}>
                Receipt · 80 mm
              </ChoiceChip>
            </div>
            <Field label="Terms on invoices" error={form.errors.terms} count={[v.terms.length, 2000]}>
              <Textarea {...form.field("terms")} rows={2} placeholder="e.g. Goods once sold will not be taken back." />
            </Field>
          </section>

          <section className="grid gap-3">
            <h2 className="text-sm font-semibold">Get paid</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Account holder" error={form.errors.bankHolder} className="sm:col-span-2">
                <Input {...form.field("bankHolder")} />
              </Field>
              <Field label="Account number" error={form.errors.bankAccount}>
                <Input {...form.field("bankAccount")} inputMode="numeric" autoComplete="off" />
              </Field>
              <Field label="Re-enter account number" error={form.errors.bankAccountConfirm} success={accountOk ? "Matches" : null}>
                <Input {...form.field("bankAccountConfirm")} inputMode="numeric" autoComplete="off" onPaste={(e) => e.preventDefault()} />
              </Field>
              <Field label="IFSC" error={form.errors.ifsc} hint="11 characters, e.g. HDFC0001234">
                <Input mask="ifsc" {...form.field("ifsc")} maxLength={11} className="font-mono uppercase" />
              </Field>
              <Field label="UPI ID" error={form.errors.upiId} hint="name@bank">
                <Input mask="noSpaces" {...form.field("upiId")} autoComplete="off" />
              </Field>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <Checkbox checked={v.showUpiQr} onCheckedChange={(c) => form.set("showUpiQr", !!c)} /> Print a UPI QR code on invoices
            </label>
          </section>
        </div>

        <InvoicePreview prefs={{ ...workspace.preferences, documents: { ...workspace.preferences.documents, template: v.template as "classic", terms: v.terms } }} number={previewNumber(v.invoicePrefix || "INV/{FY}/", fy, Number(v.invoiceStartAt) || 1)} tenant={tenant} upi={v.upiId} showQr={v.showUpiQr} bank={accountOk ? { holder: v.bankHolder, account: v.bankAccount, ifsc: v.ifsc } : null} brand={me?.tenant?.branding.brandColor} />
      </div>
      <StepFooter back={back} onSkip={() => void complete("skipped")} saving={form.submitting} error={form.formError} />
    </form>
  )
}

export function InvoicePreview({
  prefs,
  number,
  tenant,
  upi,
  showQr,
  bank,
  brand,
}: {
  prefs: WorkspacePreferences
  number: string
  tenant: StepProps["tenant"]
  upi: string
  showQr: boolean
  bank: { holder: string; account: string; ifsc: string } | null
  brand?: string
}) {
  const t = prefs.documents.template
  const intra = true
  return (
    <aside className="h-fit rounded-3xl bg-muted/60 p-4 xl:sticky xl:top-4" aria-label="Invoice preview">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Live preview</p>
      <div className={cn("grid gap-3 rounded-xl bg-white p-4 text-[11px] leading-snug text-neutral-900 shadow-sm", t === "compact" && "gap-2 p-3 text-[10px]")}>
        <div className={cn("flex items-start justify-between gap-3", t === "modern" && "-mx-4 -mt-4 rounded-t-xl p-4 text-white")} style={t === "modern" ? { background: brand ?? "#2450D8" } : undefined}>
          <div className="flex items-center gap-2">
            {tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logoUrl} alt="" className="size-8 rounded object-contain" />
            ) : (
              <span className="grid size-8 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: t === "modern" ? "rgba(255,255,255,.2)" : (brand ?? "#2450D8") }}>
                {initials(tenant.name)}
              </span>
            )}
            <div>
              <p className="text-xs font-bold">{tenant.legalName || tenant.name}</p>
              {tenant.gstin && <p className={t === "modern" ? "text-white/80" : "text-neutral-500"}>GSTIN {tenant.gstin}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold">{tenant.gstin ? "TAX INVOICE" : "INVOICE"}</p>
            <p className="font-mono">{number}</p>
          </div>
        </div>
        <p className="border-t pt-2 text-neutral-500">Bill to: Meera Kulkarni</p>
        <div className="grid grid-cols-[3fr_1fr_1fr] gap-1 bg-neutral-100 px-1 py-1 font-semibold">
          <span>Item</span>
          <span>HSN/SAC</span>
          <span className="text-right">Amount</span>
        </div>
        <div className="grid grid-cols-[3fr_1fr_1fr] gap-1 px-1">
          <span>Sample item</span>
          <span>999721</span>
          <span className="text-right">1,500.00</span>
        </div>
        <div className="grid grid-cols-[3fr_1fr_1fr] gap-1 px-1 text-neutral-500">
          <span>{intra ? "CGST 9% + SGST 9%" : "IGST 18%"}</span>
          <span />
          <span className="text-right">270.00</span>
        </div>
        <div className="flex justify-between border-t pt-2 text-xs font-bold">
          <span>Total</span>
          <span>₹1,770.00</span>
        </div>
        {(bank || upi) && (
          <div className="flex gap-3 border-t pt-2">
            {showQr && upi && !upiRule(upi) && <UpiQr upiId={upi} payee={tenant.legalName || tenant.name} amountPaise={177000} size={56} />}
            <div className="text-neutral-600">
              {upi && <p>UPI: {upi}</p>}
              {bank && (
                <p>
                  {bank.holder} · A/c ••••{bank.account.slice(-4)} · {bank.ifsc}
                </p>
              )}
            </div>
          </div>
        )}
        {prefs.documents.terms && <p className="whitespace-pre-wrap text-neutral-500">{prefs.documents.terms}</p>}
      </div>
    </aside>
  )
}
