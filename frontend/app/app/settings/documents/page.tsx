"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Hash, LayoutTemplate, Loader2, PenLine, Printer, ScrollText, Trash2, Upload } from "lucide-react"
import { DOC_TEMPLATES, prefixError, previewNumber, type WorkspacePreferences } from "@contracts/workspace"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { InlineSave } from "@/components/save-bar"
import { Field, FormError } from "@/components/form"
import { DocPreview } from "@/components/doc-preview"
import { ErrorState, NoAccess } from "@/components/page-states"
import { SettingsPage } from "@/components/settings-shell"
import { SectionHead } from "@/components/settings-parts"
import type { SetupTenant, Workspace } from "@/components/setup/wizard"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { checkFile, uploadFile, useFileLink } from "@/lib/files"
import { useApi } from "@/lib/use-api"
import { useWorkspaceData } from "@/lib/use-workspace"
import { cn } from "@/lib/utils"

// Settings › Documents: how bills look (template, paper, what's printed, signature, terms) with the
// real document redrawn live beside the settings, then the number series. Issued documents keep
// what they were issued with.

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

const TEMPLATE_NOTE: Record<string, string> = {
  classic: "Clean black and white. Prints well on any printer.",
  modern: "Your brand colour on the title, table and total.",
  compact: "Smaller type, so long bills fit on fewer pages.",
}

const TERMS_MAX = 2000

type Docs = WorkspacePreferences["documents"]
type Look = Pick<Docs, "template" | "paper" | "showHsnSummary" | "showSignatory" | "signatureUrl" | "terms" | "quotationTerms"> & { showUpiQr: boolean }

const lookOf = (w: Workspace): Look => {
  const d = w.preferences.documents
  return { template: d.template, paper: d.paper, showHsnSummary: d.showHsnSummary, showSignatory: d.showSignatory, signatureUrl: d.signatureUrl ?? null, terms: d.terms, quotationTerms: d.quotationTerms, showUpiQr: w.preferences.payments.showUpiQr }
}

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
    <SettingsPage title="Documents" description="How your invoices and quotations look and how they're numbered. Issued documents never change.">
      {err && !ready ? (
        <ErrorState error={err} onRetry={reloadAll} />
      ) : !ready ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
          <Skeleton className="h-[560px] rounded-xl" />
          <Skeleton className="h-[620px] rounded-2xl" />
        </div>
      ) : (
        <>
          {/* Keyed by what is stored: after a save the form starts again from it */}
          <LookAndPreview key={JSON.stringify(lookOf(workspace))} tenant={tenant} workspace={workspace} refresh={refresh} />
          <SeriesCard fy={series.data!.fy} rows={series.data!.data} onSaved={reloadAll} />
        </>
      )}
    </SettingsPage>
  )
}

// ── Look & print, with the live preview ──

function LookAndPreview({ tenant, workspace, refresh }: { tenant: SetupTenant; workspace: Workspace; refresh: () => Promise<void> }) {
  const { can, me } = useAuth()
  const router = useRouter()
  const saved = lookOf(workspace)
  const [draft, setDraft] = React.useState(saved)
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Partial<Record<"terms" | "quotationTerms", string>>>({})
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const editable = can("tenant.settings.edit") && !saving
  const pay = workspace.preferences.payments
  const brand = me?.tenant?.branding.brandColor ?? workspace.preferences.branding.brandColor ?? "#2450D8"
  const set = (patch: Partial<Look>) => setDraft((x) => ({ ...x, ...patch }))

  const setQr = (on: boolean) => {
    if (on && !pay.upiId) {
      toast.error("Add your UPI ID in Payments first.", { action: { label: "Open Payments", onClick: () => router.push("/app/settings/payments#upi-id") } })
      return
    }
    set({ showUpiQr: on })
  }

  const check = (d: Look) => {
    const e: typeof errors = {}
    if (d.terms.trim().length > TERMS_MAX) e.terms = `Keep terms within ${TERMS_MAX} characters`
    if (d.quotationTerms.trim().length > TERMS_MAX) e.quotationTerms = `Keep terms within ${TERMS_MAX} characters`
    setErrors(e)
    return !e.terms && !e.quotationTerms
  }

  const save = async () => {
    if (!check(draft)) return
    setSaving(true)
    try {
      const { showUpiQr, ...docs } = { ...draft, terms: draft.terms.trim(), quotationTerms: draft.quotationTerms.trim() }
      // Only what changed is sent
      const patch = Object.fromEntries(Object.entries(docs).filter(([k, v]) => v !== saved[k as keyof Look])) as Partial<Docs>
      if (Object.keys(patch).length) await api.put("/tenant/preferences/documents", patch)
      if (showUpiQr !== saved.showUpiQr) await api.put("/tenant/preferences/payments", { showUpiQr })
      await refresh()
      toast.success("Document settings saved")
    } catch (e) {
      if (e instanceof ApiError && (e.fields.terms || e.fields.quotationTerms)) setErrors({ terms: e.fields.terms, quotationTerms: e.fields.quotationTerms })
      else toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const docsForPreview: Docs = { ...workspace.preferences.documents, ...draft }
  const payForPreview = { ...pay, showUpiQr: draft.showUpiQr }
  const row = "flex items-center justify-between gap-3 py-2.5"

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
      <div className="grid gap-4">
        <section id="template" className="ui-surface px-[18px] py-4">
          <SectionHead icon={LayoutTemplate} title="Template" description="The look of every invoice, quotation, order and note." />
          <div className="grid gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label="Invoice template">
            {DOC_TEMPLATES.map((t) => {
              const on = draft.template === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!editable}
                  onClick={() => set({ template: t.key })}
                  className={cn("flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-all hover:border-primary/50 disabled:cursor-default disabled:hover:border-border", on && "border-primary ring-2 ring-primary/25 hover:border-primary")}
                >
                  <Thumb kind={t.key} brand={brand} />
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold">
                    {t.label}
                    {saved.template === t.key && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none font-medium whitespace-nowrap text-muted-foreground">In use</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{TEMPLATE_NOTE[t.key]}</span>
                </button>
              )
            })}
          </div>
          {draft.template === "modern" && (
            <p className="mt-2.5 text-xs text-muted-foreground">
              Uses your brand colour{" "}
              <span className="inline-block size-2.5 rounded-full align-middle" style={{ background: brand }} aria-hidden />{" "}
              <Link href="/app/settings/branding" className="font-semibold text-primary hover:underline">
                Change in Branding
              </Link>
            </p>
          )}
        </section>

        <section id="print" className="ui-surface px-[18px] py-4 text-[13px]">
          <SectionHead icon={Printer} title="Paper & what's printed" description="A4 for normal printers; 80 mm or 58 mm for a till (thermal) printer." />
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Paper size">
            {(
              [
                ["a4", "A4", "Office printer"],
                ["80mm", "80 mm", "Wide receipt roll"],
                ["58mm", "58 mm", "Small receipt roll"],
              ] as const
            ).map(([k, l, hint]) => (
              <button key={k} type="button" role="radio" aria-checked={draft.paper === k} disabled={!editable} onClick={() => set({ paper: k })} className={cn("rounded-xl border px-3 py-2 text-left transition-all disabled:cursor-default", draft.paper === k ? "border-primary bg-primary/5 ring-2 ring-primary/25" : "hover:border-primary/50")}>
                <span className="block text-sm font-semibold">{l}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 divide-y">
            <div className={row}>
              <span>
                <span className="block font-medium">HSN summary table</span>
                <span className="block text-xs text-muted-foreground">Tax by HSN/SAC code under the items (A4 only)</span>
              </span>
              <Switch aria-label="HSN summary table" checked={draft.showHsnSummary} disabled={!editable} onCheckedChange={(c) => set({ showHsnSummary: c })} />
            </div>
            <div className={row}>
              <span>
                <span className="block font-medium">UPI QR code on unpaid invoices</span>
                <span className="block text-xs text-muted-foreground">
                  {pay.upiId ? (
                    <>
                      Pays to <span className="font-mono">{pay.upiId}</span> for the amount due
                    </>
                  ) : (
                    <Link href="/app/settings/payments#upi-id" className="font-semibold text-primary hover:underline">
                      Add a UPI ID in Payments first
                    </Link>
                  )}
                </span>
              </span>
              <Switch aria-label="UPI QR code" checked={draft.showUpiQr} disabled={!editable} onCheckedChange={setQr} />
            </div>
            <div className={row}>
              <span>
                <span className="block font-medium">Authorised signatory</span>
                <span className="block text-xs text-muted-foreground">&ldquo;For your business&rdquo; with a place to sign</span>
              </span>
              <Switch aria-label="Authorised signatory" checked={draft.showSignatory} disabled={!editable} onCheckedChange={(c) => set({ showSignatory: c })} />
            </div>
          </div>
        </section>

        <section id="signature" className="ui-surface px-[18px] py-4 text-[13px]">
          <SectionHead icon={PenLine} title="Signature" description="Printed above “Authorised signatory”. Leave it empty to sign by hand." />
          <SignatureField value={draft.signatureUrl} onChange={(v) => set({ signatureUrl: v })} disabled={!editable} />
          {draft.signatureUrl && !draft.showSignatory && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Turn on “Authorised signatory” above to print the signature.</p>}
        </section>

        <section id="terms" className="ui-surface px-[18px] py-4">
          <SectionHead icon={ScrollText} title="Terms" description="Printed at the bottom. You can still change them on any one document." />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="On invoices" error={errors.terms} count={[draft.terms.length, TERMS_MAX]}>
              <Textarea value={draft.terms} onChange={(e) => set({ terms: e.target.value })} onBlur={() => check(draft)} rows={4} disabled={!editable} placeholder="e.g. Goods once sold will not be taken back. Interest @18% after the due date." aria-invalid={!!errors.terms} />
            </Field>
            <Field label="On quotations" error={errors.quotationTerms} count={[draft.quotationTerms.length, TERMS_MAX]}>
              <Textarea value={draft.quotationTerms} onChange={(e) => set({ quotationTerms: e.target.value })} onBlur={() => check(draft)} rows={4} disabled={!editable} placeholder="e.g. Prices valid for 15 days. 50% advance with the order." aria-invalid={!!errors.quotationTerms} />
            </Field>
          </div>
        </section>

        <div className={cn(dirty && "sticky bottom-3 z-10 rounded-xl border bg-background/95 px-4 pb-3 shadow-lg backdrop-blur")}>
          <InlineSave dirty={dirty} saving={saving} onDiscard={() => { setDraft(saved); setErrors({}) }} onSave={() => void save()} saveLabel="Save changes" />
        </div>
      </div>

      <DocPreview tenant={tenant} workspace={workspace} docs={docsForPreview} pay={payForPreview} brand={brand} className="xl:sticky xl:top-4" />
    </div>
  )
}

function SignatureField({ value, onChange, disabled }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  const input = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const { link } = useFileLink(value)
  const pick = async (file?: File) => {
    if (!file) return
    setError(null)
    const bad = checkFile(file, "image")
    if (bad) return setError(bad)
    if (file.size > 1024 * 1024) return setError(`This file is ${(file.size / 1024 / 1024).toFixed(1)} MB — use one up to 1 MB.`)
    setBusy(true)
    try {
      onChange((await uploadFile(file, { kind: "image", field: "signature" })).ref)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed p-3">
      <span className="grid h-16 w-44 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white text-xs text-neutral-400">
        {value && link ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={link.url} alt="Signature" className="max-h-14 max-w-40 object-contain" />
        ) : busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          "No signature"
        )}
      </span>
      <div className="grid gap-1.5">
        <p className="text-xs text-muted-foreground">PNG with a clear background looks best · JPG of a signature on white paper works too · up to 1 MB</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />} {busy ? "Uploading…" : value ? "Replace" : "Upload signature"}
          </Button>
          {value && (
            <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} onClick={() => onChange(null)}>
              <Trash2 /> Remove
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Signature image" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = "" }} />
    </div>
  )
}

function Thumb({ kind, brand }: { kind: string; brand: string }) {
  const ln = "h-1.5 rounded-[3px] bg-neutral-200"
  if (kind === "modern") {
    return (
      <div className="h-[92px] overflow-hidden rounded-md border-t-4 bg-white p-2 ring-1 ring-black/5" style={{ borderTopColor: brand }}>
        <div className="mb-1.5 flex justify-between">
          <div className="h-2 w-1/3 rounded-[3px]" style={{ background: brand }} />
          <div className="h-2 w-1/4 rounded-[3px]" style={{ background: brand }} />
        </div>
        <div className="mb-1 h-2 rounded-[3px]" style={{ background: brand, opacity: 0.85 }} />
        <div className="flex flex-col gap-[4px]">
          <div className={ln} />
          <div className={cn(ln, "w-[70%]")} />
          <div className="ml-auto h-2 w-1/3 rounded-[3px]" style={{ background: brand }} />
        </div>
      </div>
    )
  }
  if (kind === "compact") {
    return (
      <div className="flex h-[92px] flex-col gap-[3px] rounded-md bg-white p-2 ring-1 ring-black/5">
        <div className="mb-0.5 h-1.5 w-[40%] rounded-[3px] bg-neutral-400" />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={cn("h-1 rounded-[2px] bg-neutral-200", i === 6 && "w-[60%]")} />
        ))}
      </div>
    )
  }
  return (
    <div className="flex h-[92px] flex-col gap-[5px] rounded-md bg-white p-2 ring-1 ring-black/5">
      <div className="flex justify-between">
        <div className="h-2 w-1/3 rounded-[3px] bg-neutral-500" />
        <div className="h-2 w-1/4 rounded-[3px] bg-neutral-500" />
      </div>
      <div className="h-px bg-neutral-300" />
      <div className={ln} />
      <div className={cn(ln, "w-4/5")} />
      <div className={ln} />
      <div className="ml-auto h-1.5 w-1/3 rounded-[3px] bg-neutral-500" />
    </div>
  )
}

// ── Number series ──

function SeriesCard({ fy, rows, onSaved }: { fy: string; rows: Series[]; onSaved: () => Promise<void> }) {
  const { can } = useAuth()
  const [editing, setEditing] = React.useState<Series["docType"] | null>(null)
  return (
    <section id="series" className="ui-surface px-[18px] py-4">
      <SectionHead icon={Hash} title={`Number series · FY ${fy}`} description="How every document is numbered. Numbers restart each financial year and never repeat." />
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

