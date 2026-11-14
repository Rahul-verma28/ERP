"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { length } from "@contracts/validation"
import { DOC_TEMPLATES, prefixError, previewNumber, type WorkspacePreferences } from "@contracts/workspace"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { EditableSection } from "@/components/editable-section"
import { Field, FormError } from "@/components/form"
import { ErrorState, NoAccess } from "@/components/page-states"
import { SettingsPage } from "@/components/settings-shell"
import { InvoicePreview } from "@/components/setup/documents-step"
import type { SetupTenant, Workspace } from "@/components/setup/wizard"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useForm } from "@/lib/use-form"
import { useWorkspaceData } from "@/lib/use-workspace"
import { cn } from "@/lib/utils"

// Settings › Documents (wireframe X2): number series, template, print options, terms.

interface Series {
  docType: "invoice" | "quotation" | "receipt" | "credit_note" | "sales_order" | "delivery_challan" | "debit_note" | "purchase_order" | "goods_receipt" | "purchase_bill" | "purchase_return" | "supplier_payment"
  label: string
  prefix: string
  nextNo: number
  lastIssued: string | null
  /** Lowest allowed next number (just after the last one issued) */
  minNext: number
}

const PREFIX_KEY = { invoice: "invoicePrefix", quotation: "quotationPrefix", receipt: "receiptPrefix", credit_note: "creditNotePrefix", sales_order: "salesOrderPrefix", delivery_challan: "deliveryChallanPrefix", debit_note: "debitNotePrefix", purchase_order: "purchaseOrderPrefix", goods_receipt: "goodsReceiptPrefix", purchase_bill: "purchaseBillPrefix", purchase_return: "purchaseReturnPrefix", supplier_payment: "supplierPaymentPrefix", expense: "expensePrefix", income: "incomePrefix", fin_transfer: "transferPrefix", journal: "journalPrefix" } as const

export default function DocumentsSettingsPage() {
  const { can } = useAuth()
  const { tenant, workspace, error, refresh } = useWorkspaceData()
  const series = useApi<{ fy: string; data: Series[] }>("/tenant/sequences")
  if (!can("tenant.settings.view")) return <NoAccess what="Documents" />
  const err = error ?? series.error
  const ready = tenant && workspace && series.data
  const reloadAll = async () => {
    await Promise.all([refresh(), series.reload()])
  }
  return (
    <SettingsPage title="Documents" description="Numbering, templates and what's printed. Issued documents never change.">
      {err && !ready ? (
        <ErrorState error={err} onRetry={reloadAll} />
      ) : !ready ? (
        <>
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </>
      ) : (
        <>
          <SeriesCard fy={series.data!.fy} rows={series.data!.data} onSaved={reloadAll} />
          <div className="grid gap-3.5 lg:grid-cols-2">
            <TemplateCard tenant={tenant} workspace={workspace} refresh={refresh} />
            <PrintCard workspace={workspace} refresh={refresh} />
          </div>
          <TermsCard key={JSON.stringify(workspace.preferences.documents)} workspace={workspace} refresh={refresh} />
        </>
      )}
    </SettingsPage>
  )
}

// ── Number series ──

function SeriesCard({ fy, rows, onSaved }: { fy: string; rows: Series[]; onSaved: () => Promise<void> }) {
  const { can } = useAuth()
  const [editing, setEditing] = React.useState<Series["docType"] | null>(null)
  return (
    <section id="series" className="ui-surface px-[18px] py-3.5">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold">Number series · FY {fy}</h2>
        <span className="text-xs text-muted-foreground">Resets every financial year</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-2.5 py-2 font-semibold">Document</th>
              <th className="px-2.5 py-2 font-semibold">Prefix</th>
              <th className="px-2.5 py-2 font-semibold">Next number</th>
              <th className="px-2.5 py-2 font-semibold">Last issued</th>
              <th className="px-2.5 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              editing === r.docType ? (
                <SeriesEditRow key={r.docType} fy={fy} row={r} onCancel={() => setEditing(null)} onSaved={async () => {
                  await onSaved()
                  setEditing(null)
                }} />
              ) : (
                <tr key={r.docType} className="border-b border-border/60">
                  <td className="px-2.5 py-[9px] font-semibold">{r.label}</td>
                  <td className="px-2.5 py-[9px] font-mono">{r.prefix}</td>
                  <td className="px-2.5 py-[9px] tabular-nums">{String(r.nextNo).padStart(4, "0")}</td>
                  <td className={cn("px-2.5 py-[9px] font-mono", !r.lastIssued && "text-muted-foreground")}>{r.lastIssued ?? "—"}</td>
                  <td className="px-2.5 py-[9px] text-right">
                    {can("tenant.settings.edit") && (
                      <Button variant="outline" size="sm" onClick={() => setEditing(r.docType)} disabled={!!editing} aria-label={`Edit ${r.label} series`}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              )
            )}
            <tr>
              <td className="px-2.5 py-[9px] text-muted-foreground/80">Purchase order</td>
              <td colSpan={4} className="px-2.5 py-[9px] text-xs text-muted-foreground/80">
                Arrives with Purchasing
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SeriesEditRow({ fy, row, onCancel, onSaved }: { fy: string; row: Series; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [prefix, setPrefix] = React.useState(row.prefix)
  const [next, setNext] = React.useState(String(row.nextNo).padStart(4, "0"))
  const [errors, setErrors] = React.useState<{ prefix?: string | null; nextNo?: string | null; form?: string | null }>({})
  const [saving, setSaving] = React.useState(false)
  const n = Number(next)
  const preview = previewNumber(prefix, fy, Number.isFinite(n) && n > 0 ? n : 1)

  const check = () => {
    const e = {
      prefix: prefixError(prefix, fy),
      nextNo: !/^\d{1,7}$/.test(next) || n < 1 ? "Use a whole number from 1" : n < row.minNext ? `Next number can't be lower than ${String(row.minNext).padStart(4, "0")} — ${row.lastIssued} is already issued.` : preview.length > 16 ? "Prefix plus number must stay within 16 characters" : null,
    }
    setErrors(e)
    return !e.prefix && !e.nextNo
  }

  const save = async () => {
    if (!check()) return
    setSaving(true)
    try {
      if (prefix !== row.prefix) await api.put("/tenant/preferences/documents", { [PREFIX_KEY[row.docType]]: prefix.trim() })
      if (n !== row.nextNo) await api.put(`/tenant/sequences/${row.docType}`, { nextNo: n })
      await onSaved()
      toast.success(`${row.label} series saved`)
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        setErrors({ prefix: e.fields[PREFIX_KEY[row.docType]] ?? null, nextNo: e.fields.nextNo ?? null })
      } else setErrors({ form: errorMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="border-b border-border/60 bg-accent/30 align-top">
      <td className="px-2.5 py-[9px] font-semibold">{row.label}</td>
      <td className="px-2.5 py-[9px]">
        <Input aria-label={`${row.label} prefix`} value={prefix} onChange={(e) => setPrefix(e.target.value)} onBlur={check} aria-invalid={!!errors.prefix} className="h-8 w-[130px] font-mono" autoFocus />
        {errors.prefix && <p className="mt-1 max-w-[220px] text-xs text-destructive">{errors.prefix}</p>}
      </td>
      <td className="px-2.5 py-[9px]">
        <Input aria-label={`Next ${row.label.toLowerCase()} number`} value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, ""))} onBlur={check} inputMode="numeric" aria-invalid={!!errors.nextNo} className="h-8 w-20 tabular-nums" />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Preview {preview} · {preview.length} / 16 characters
        </p>
        {errors.nextNo && <p className="mt-1 max-w-[260px] text-xs text-destructive">{errors.nextNo}</p>}
      </td>
      <td className="px-2.5 py-[9px] font-mono">{row.lastIssued ?? "—"}</td>
      <td className="px-2.5 py-[9px]">
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        <FormError message={errors.form} />
      </td>
    </tr>
  )
}

// ── Template ──

function usePreferenceSave(refresh: () => Promise<void>) {
  const [saving, setSaving] = React.useState(false)
  const save = async (patch: Partial<WorkspacePreferences["documents"]>, message: string) => {
    setSaving(true)
    try {
      await api.put("/tenant/preferences/documents", patch)
      await refresh()
      toast.success(message)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  return { saving, save }
}

function Thumb({ kind, brand }: { kind: string; brand: string }) {
  const ln = "h-1.5 rounded-[3px] bg-border"
  if (kind === "modern") {
    return (
      <div className="h-[110px] overflow-hidden rounded-md bg-muted">
        <div className="h-[26px]" style={{ background: brand }} />
        <div className="flex flex-col gap-[5px] p-1.5">
          <div className={ln} />
          <div className={cn(ln, "w-[70%]")} />
        </div>
      </div>
    )
  }
  if (kind === "compact") {
    return (
      <div className="flex h-[110px] flex-col gap-[3px] rounded-md bg-muted p-2">
        <div className={cn(ln, "w-[40%]")} />
        <div className="h-1 rounded-[3px] bg-border" />
        <div className="h-1 rounded-[3px] bg-border" />
        <div className="h-1 w-[60%] rounded-[3px] bg-border" />
      </div>
    )
  }
  return (
    <div className="flex h-[110px] flex-col gap-[5px] rounded-md bg-muted p-2">
      <div className="h-1.5 w-1/2 rounded-[3px]" style={{ background: brand }} />
      <div className={ln} />
      <div className={cn(ln, "w-4/5")} />
      <div className={ln} />
    </div>
  )
}

function TemplateCard({ tenant, workspace, refresh }: { tenant: SetupTenant; workspace: Workspace; refresh: () => Promise<void> }) {
  const { can, me } = useAuth()
  const { saving, save } = usePreferenceSave(refresh)
  const [preview, setPreview] = React.useState(false)
  const d = workspace.preferences.documents
  const brand = me?.tenant?.branding.brandColor ?? "#2450D8"
  const editable = can("tenant.settings.edit")
  return (
    <section id="template" className="flex flex-col gap-2.5 ui-surface px-[18px] py-3.5">
      <h2 className="text-[15px] font-bold">Template</h2>
      <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Invoice template">
        {DOC_TEMPLATES.map((t) => {
          const on = d.template === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!editable || saving}
              onClick={() => !on && save({ template: t.key }, `${t.label} is now the default template`)}
              className={cn("flex flex-col gap-1.5 rounded-[10px] border p-2 text-left text-xs font-semibold transition-shadow disabled:cursor-default", on && "border-primary ring-2 ring-primary/25")}
            >
              <Thumb kind={t.key} brand={brand} />
              {t.label}
              {on ? " · default" : ""}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Preview uses your logo, brand colour and a sample invoice.{" "}
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setPreview(true)}>
          Open full preview
        </button>
      </p>
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{DOC_TEMPLATES.find((t) => t.key === d.template)?.label} template</DialogTitle>
            <DialogDescription>A sample invoice with your details. Real invoices use your items and customer.</DialogDescription>
          </DialogHeader>
          <InvoicePreview
            prefs={workspace.preferences}
            number={previewNumber(d.invoicePrefix, "26-27", 1)}
            tenant={tenant}
            upi={workspace.preferences.payments.upiId}
            showQr={workspace.preferences.payments.showUpiQr}
            bank={workspace.preferences.payments.bankAccount ? { holder: workspace.preferences.payments.bankHolder, account: workspace.preferences.payments.bankAccount, ifsc: workspace.preferences.payments.ifsc } : null}
            brand={brand}
          />
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── Print ──

function PrintCard({ workspace, refresh }: { workspace: Workspace; refresh: () => Promise<void> }) {
  const { can } = useAuth()
  const router = useRouter()
  const { saving, save } = usePreferenceSave(refresh)
  const [savingPay, setSavingPay] = React.useState(false)
  const d = workspace.preferences.documents
  const pay = workspace.preferences.payments
  const editable = can("tenant.settings.edit") && !saving && !savingPay

  const setQr = async (on: boolean) => {
    if (on && !pay.upiId) {
      toast.error("Add your UPI ID in Payments first.", { action: { label: "Open Payments", onClick: () => router.push("/app/settings/payments#upi-id") } })
      return
    }
    setSavingPay(true)
    try {
      await api.put("/tenant/preferences/payments", { showUpiQr: on })
      await refresh()
      toast.success(on ? "UPI QR will be printed" : "UPI QR won't be printed")
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSavingPay(false)
    }
  }

  const row = "flex items-center justify-between gap-3"
  return (
    <section id="print" className="flex flex-col gap-2.5 ui-surface px-[18px] py-3.5 text-[13px]">
      <h2 className="text-[15px] font-bold">Print</h2>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Paper size">
        {(
          [
            ["a4", "A4"],
            ["80mm", "80 mm"],
            ["58mm", "58 mm"],
          ] as const
        ).map(([k, l]) => (
          <Button key={k} type="button" size="sm" variant={d.paper === k ? "default" : "outline"} role="radio" aria-checked={d.paper === k} disabled={!editable} onClick={() => d.paper !== k && save({ paper: k }, `Paper set to ${l}`)}>
            {l}
          </Button>
        ))}
      </div>
      <div className={row}>
        HSN summary table
        <Switch aria-label="HSN summary table" checked={d.showHsnSummary} disabled={!editable} onCheckedChange={(c) => save({ showHsnSummary: c }, c ? "HSN summary will be printed" : "HSN summary hidden")} />
      </div>
      <div className={row}>
        <span>
          UPI QR code{" "}
          {!pay.upiId && (
            <Link href="/app/settings/payments#upi-id" className="text-xs font-semibold text-primary hover:underline">
              Add UPI ID
            </Link>
          )}
        </span>
        <Switch aria-label="UPI QR code" checked={pay.showUpiQr} disabled={!editable} onCheckedChange={setQr} />
      </div>
      <div className={row}>
        Authorised signatory line
        <Switch aria-label="Authorised signatory line" checked={d.showSignatory} disabled={!editable} onCheckedChange={(c) => save({ showSignatory: c }, c ? "Signatory line will be printed" : "Signatory line hidden")} />
      </div>
      <div className={cn(row, "text-muted-foreground/80")}>
        Signature image · needs file storage
        <Switch aria-label="Signature image (not available yet)" checked={false} disabled />
      </div>
    </section>
  )
}

// ── Terms ──

function TermsCard({ workspace, refresh }: { workspace: Workspace; refresh: () => Promise<void> }) {
  const { can } = useAuth()
  const d = workspace.preferences.documents
  const form = useForm({
    initial: { terms: d.terms, quotationTerms: d.quotationTerms },
    labels: { terms: "Terms on invoices", quotationTerms: "Terms on quotations" },
    clean: { terms: (v) => v.trim(), quotationTerms: (v) => v.trim() },
    rules: { terms: length(0, 2000, "Terms"), quotationTerms: length(0, 2000, "Terms") },
    fromServer: (path) => (path === "terms" || path === "quotationTerms" ? path : undefined),
    onSubmit: async (v) => {
      await api.put("/tenant/preferences/documents", { terms: v.terms, quotationTerms: v.quotationTerms })
      await refresh()
      toast.success("Terms saved")
    },
  })
  const view = (label: string, text: string) => (
    <div>
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <p className={cn("mt-0.5 text-[13px] whitespace-pre-wrap", !text && "text-muted-foreground")}>{text || "Not added"}</p>
    </div>
  )
  return (
    <div id="terms">
      <EditableSection
        title="Terms"
        form={form}
        canEdit={can("tenant.settings.edit")}
        view={
          <div className="grid gap-3.5 sm:grid-cols-2">
            {view("On invoices", d.terms)}
            {view("On quotations", d.quotationTerms)}
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="On invoices" error={form.errors.terms} count={[form.values.terms.length, 2000]}>
            <Textarea {...form.field("terms")} rows={4} placeholder="e.g. Services once delivered are not refundable." autoFocus />
          </Field>
          <Field label="On quotations" error={form.errors.quotationTerms} count={[form.values.quotationTerms.length, 2000]}>
            <Textarea {...form.field("quotationTerms")} rows={4} placeholder="e.g. Valid for 15 days from the date above." />
          </Field>
        </div>
      </EditableSection>
    </div>
  )
}
