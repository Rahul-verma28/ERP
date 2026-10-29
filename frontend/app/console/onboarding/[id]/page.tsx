"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Check, CircleDashed } from "lucide-react"
import { BRAND_COLORS, DOC_TEMPLATES, FONTS, prefixError, previewNumber } from "@contracts/workspace"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FormError, NativeSelect } from "@/components/form"
import { Failed, Loading, Page, Panel } from "@/components/console/kit"
import { ImportMapper } from "@/components/console/import-mapper"
import { LoginLinkBox, type LoginLink } from "@/components/console/login-link"
import { WizardRail, type OnboardingStepKey, type RailState } from "@/components/console/wizard-rail"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"
import { useConsoleBase } from "@/lib/console-base"
import { formatDate } from "@/lib/format"
import type { HandoverStep, OnboardingDetail } from "@/lib/console"
import { cn } from "@/lib/utils"

// Onboarding wizard, steps 4–7 (blueprint S3): branding, configuration, data import, then
// review & hand over. Each step saves on the business, so anyone can come back and finish it.

type Step = HandoverStep | "handover"
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

export default function OnboardingWizardPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <React.Suspense>
      <Wizard params={params} />
    </React.Suspense>
  )
}

function Wizard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const router = useRouter()
  const search = useSearchParams()
  const base = useConsoleBase()
  const { data, error, reload, setData } = useApi<OnboardingDetail>(`/console/onboarding/${id}`)

  if (error) return <Failed error={error} onRetry={reload} />
  if (!data) return <Loading rows={6} className="mx-auto max-w-6xl" />

  const asked = search.get("step") as Step | null
  const step: Step = asked && ["branding", "config", "import", "handover"].includes(asked) ? asked : data.progress.nextStep ?? "handover"
  const go = (s: Step) => router.replace(`${base}/onboarding/${id}?step=${s}`, { scroll: false })
  const nextOf = (s: Step): Step => (s === "branding" ? "config" : s === "config" ? "import" : "handover")
  const done = (s: Step) => (reload(), go(nextOf(s)))

  const stepState = (k: HandoverStep): RailState => (step === k ? "current" : data.handover.steps[k] === "done" ? "done" : data.handover.steps[k] === "skipped" ? "skipped" : "todo")
  const states: Partial<Record<OnboardingStepKey, RailState>> = {
    business: "done",
    owner: "done",
    plan: "done",
    branding: stepState("branding"),
    config: stepState("config"),
    import: stepState("import"),
    handover: step === "handover" ? "current" : data.handover.sentAt ? "done" : "todo",
  }

  async function skip(s: HandoverStep) {
    try {
      await api.post(`/console/onboarding/${id}/skip`, { step: s })
      done(s)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Page back={{ href: `${base}/onboarding`, label: "Onboarding" }} title={`Set up ${data.name}`} subtitle={`Owner: ${data.owner.name} · ${data.progress.percent}% done`} wide>
      <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <WizardRail states={states} onSelect={(k) => ["branding", "config", "import", "handover"].includes(k) && go(k as Step)} title="Each step saves as you go. You can leave and come back." />
        </div>
        <div className="min-w-0">
          {step === "branding" && <BrandingStep data={data} onSaved={() => done("branding")} onSkip={() => skip("branding")} />}
          {step === "config" && <ConfigStep data={data} onSaved={() => done("config")} onSkip={() => skip("config")} onBack={() => go("branding")} />}
          {step === "import" && (
            <Panel title={<StepTitle n={6} title="Data import" />} description="Bring in customers and products from a spreadsheet. You can do this more than once, or skip it.">
              <ImportMapper tenantId={id} onImported={() => reload()} />
              <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                <Button type="button" variant="ghost" onClick={() => go("config")}>Back</Button>
                <div className="flex gap-2">
                  {data.handover.steps.import !== "done" && <Button type="button" variant="outline" onClick={() => skip("import")}>Skip for now</Button>}
                  {data.handover.steps.import === "done" && <Button type="button" onClick={() => go("handover")}>Continue</Button>}
                </div>
              </div>
            </Panel>
          )}
          {step === "handover" && <HandoverStepPanel data={data} onSent={(d) => setData(d)} onBack={() => go("import")} />}
        </div>
      </div>
    </Page>
  )
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <span className="grid gap-1">
      <span className="text-[11px] font-semibold tracking-[0.08em] text-primary uppercase">Step {n} of 7</span>
      <span className="text-xl">{title}</span>
    </span>
  )
}

function Footer({ onBack, onSkip, saving, label = "Save and continue" }: { onBack?: () => void; onSkip?: () => void; saving: boolean; label?: string }) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
      {onBack ? <Button type="button" variant="ghost" onClick={onBack}>Back</Button> : <span />}
      <div className="flex gap-2">
        {onSkip && <Button type="button" variant="outline" onClick={onSkip}>Skip for now</Button>}
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : label}</Button>
      </div>
    </div>
  )
}

function BrandingStep({ data, onSaved, onSkip }: { data: OnboardingDetail; onSaved: () => void; onSkip: () => void }) {
  const [b, setB] = React.useState(data.branding)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const family = FONTS.find((f) => f.key === b.font)?.family ?? "Inter"
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.put(`/console/onboarding/${data.id}/branding`, b)
      onSaved()
    } catch (x) {
      setError(errorMessage(x))
    } finally {
      setSaving(false)
    }
  }
  return (
    <form onSubmit={save}>
      <Panel title={<StepTitle n={4} title="Branding" />} description="The colour and font the business sees in its ERP. The owner can change this later in Settings › Branding.">
        <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
          <div className="grid content-start gap-5">
            <Field label="Brand colour">
              <div className="flex flex-wrap items-center gap-2">
                {BRAND_COLORS.map((c) => (
                  <button key={c.hex} type="button" title={c.name} aria-label={c.name} aria-pressed={b.brandColor.toLowerCase() === c.hex.toLowerCase()} onClick={() => setB((x) => ({ ...x, brandColor: c.hex }))} className={cn("size-8 rounded-full ring-offset-2 ring-offset-card", b.brandColor.toLowerCase() === c.hex.toLowerCase() && "ring-2 ring-foreground")} style={{ background: c.hex }} />
                ))}
                <input id="ob-color" type="color" value={b.brandColor} onChange={(e) => setB((x) => ({ ...x, brandColor: e.target.value }))} className="h-8 w-10 cursor-pointer rounded-md border bg-card p-0.5" aria-label="Custom colour" />
                <code className="text-xs text-muted-foreground">{b.brandColor.toUpperCase()}</code>
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Font">
                <NativeSelect value={b.font} onChange={(e) => setB((x) => ({ ...x, font: e.target.value }))}>
                  {FONTS.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Appearance">
                <NativeSelect value={b.theme} onChange={(e) => setB((x) => ({ ...x, theme: e.target.value as OnboardingDetail["branding"]["theme"] }))}>
                  <option value="system">Follow the device</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </NativeSelect>
              </Field>
              <Field label="Density">
                <NativeSelect value={b.density} onChange={(e) => setB((x) => ({ ...x, density: e.target.value as OnboardingDetail["branding"]["density"] }))}>
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </NativeSelect>
              </Field>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border bg-background" style={{ fontFamily: family }} aria-label="Preview">
            <div className="flex items-center gap-2 border-b bg-card px-3 py-2.5 text-sm font-semibold">
              <span className="size-6 rounded-md" style={{ background: b.brandColor }} /> {data.name}
            </div>
            <div className={cn("grid gap-2", b.density === "compact" ? "p-2" : "p-4")}>
              <div className="rounded-lg border bg-card p-3">
                <div className="text-[11px] tracking-wide text-muted-foreground uppercase">Today</div>
                <div className="text-lg font-semibold tabular-nums">₹48,250</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: b.brandColor }}>New invoice</span>
                <span className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: b.brandColor, color: b.brandColor }}>Add customer</span>
              </div>
            </div>
          </div>
        </div>
        <FormError message={error} />
        <Footer onSkip={onSkip} saving={saving} />
      </Panel>
    </form>
  )
}

function ConfigStep({ data, onSaved, onSkip, onBack }: { data: OnboardingDetail; onSaved: () => void; onSkip: () => void; onBack: () => void }) {
  const invoiceSeq = data.config.sequences.find((s) => s.docType === "invoice")
  const [f, setF] = React.useState({
    fyStartMonth: data.config.fyStartMonth,
    invoicePrefix: data.config.documents.invoicePrefix,
    quotationPrefix: data.config.documents.quotationPrefix,
    receiptPrefix: data.config.documents.receiptPrefix,
    template: data.config.documents.template,
    invoiceStartAt: invoiceSeq && invoiceSeq.nextNo > 1 ? String(invoiceSeq.nextNo) : "",
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const fy = data.config.fy
  const local = { invoicePrefix: prefixError(f.invoicePrefix, fy), quotationPrefix: prefixError(f.quotationPrefix, fy), receiptPrefix: prefixError(f.receiptPrefix, fy) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (Object.values(local).some(Boolean)) return setErrors(Object.fromEntries(Object.entries(local).filter(([, v]) => v)) as Record<string, string>)
    setSaving(true)
    setErrors({})
    try {
      await api.put(`/console/onboarding/${data.id}/config`, { ...f, invoiceStartAt: f.invoiceStartAt ? Number(f.invoiceStartAt) : null })
      onSaved()
    } catch (x) {
      setErrors(x instanceof ApiError ? { ...x.fields, form: errorMessage(x) } : { form: errorMessage(x) })
    } finally {
      setSaving(false)
    }
  }
  const prefix = (key: "invoicePrefix" | "quotationPrefix" | "receiptPrefix", label: string) => (
    <Field label={label} error={errors[key] || local[key] || undefined} hint={!local[key] ? `First number: ${previewNumber(f[key], fy, key === "invoicePrefix" && f.invoiceStartAt ? Number(f.invoiceStartAt) : 1)}` : undefined}>
      <Input id={`ob-${key}`} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value.toUpperCase().replace(/\s/g, "") })} maxLength={12} />
    </Field>
  )
  return (
    <form onSubmit={save}>
      <Panel title={<StepTitle n={5} title="Configuration" />} description="Financial year and how invoices, quotations and receipts are numbered. GST allows up to 16 characters per number.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Financial year starts in" error={errors.fyStartMonth} hint="April for most Indian businesses">
            <NativeSelect value={String(f.fyStartMonth)} onChange={(e) => setF({ ...f, fyStartMonth: Number(e.target.value) })}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Invoice look" error={errors.template}>
            <NativeSelect value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}>
              {DOC_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </NativeSelect>
          </Field>
          {prefix("invoicePrefix", "Invoice prefix")}
          <Field label="Moving from another tool? First invoice number" error={errors.invoiceStartAt} hint="Leave empty to start at 1">
            <Input id="ob-start" inputMode="numeric" value={f.invoiceStartAt} onChange={(e) => setF({ ...f, invoiceStartAt: e.target.value.replace(/\D/g, "") })} placeholder="1" />
          </Field>
          {prefix("quotationPrefix", "Quotation prefix")}
          {prefix("receiptPrefix", "Receipt prefix")}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Use {"{FY}"} for the year ({fy}). Letters, digits, / and - only.</p>
        <FormError message={errors.form} />
        <Footer onBack={onBack} onSkip={onSkip} saving={saving} />
      </Panel>
    </form>
  )
}

function HandoverStepPanel({ data, onSent, onBack }: { data: OnboardingDetail; onSent: (d: OnboardingDetail) => void; onBack: () => void }) {
  const base = useConsoleBase()
  const [busy, setBusy] = React.useState(false)
  const [link, setLink] = React.useState<LoginLink | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const h = data.handover
  const items: { label: string; state: "done" | "skipped" | "todo"; detail?: string }[] = [
    { label: "Business, owner and plan", state: "done" },
    { label: "Branding", state: h.steps.branding ?? "todo", detail: h.steps.branding === "done" ? data.branding.brandColor.toUpperCase() : undefined },
    { label: "Configuration", state: h.steps.config ?? "todo", detail: h.steps.config === "done" ? `FY from ${MONTHS[data.config.fyStartMonth - 1]} · first invoice ${previewNumber(data.config.documents.invoicePrefix, data.config.fy, data.config.sequences.find((q) => q.docType === "invoice")?.nextNo ?? 1)}` : undefined },
    { label: "Data import", state: h.steps.import ?? "todo", detail: `${data.counts.contacts} customers · ${data.counts.items} products` },
  ]
  async function send() {
    setBusy(true)
    setError(null)
    try {
      const l = await api.post<LoginLink>(`/console/onboarding/${data.id}/handover`)
      setLink(l)
      toast.success(`Login link sent to ${data.owner.name}`)
      onSent({ ...data, handover: { ...h, sentAt: new Date().toISOString() } })
    } catch (x) {
      setError(errorMessage(x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title={<StepTitle n={7} title="Review & hand over" />} description="Check what's set up, then send the owner their login link. They verify their mobile, choose a password and accept the handover in their ERP.">
      <ul className="grid gap-2">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
            {i.state === "done" ? <Check className="size-4 text-emerald-600" /> : <CircleDashed className="size-4 text-muted-foreground" />}
            <span className="flex-1">{i.label}</span>
            <span className="text-xs text-muted-foreground">{i.state === "skipped" ? "Skipped" : i.state === "todo" ? "Not done" : i.detail}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 rounded-xl border bg-muted/30 p-4 text-sm">
        <p className="font-medium">{data.owner.name}</p>
        <p className="text-muted-foreground">{data.owner.mobile} · {data.owner.email}</p>
        {h.sentAt && !link && <p className="mt-2 text-muted-foreground">Handed over {formatDate(h.sentAt)}. {data.owner.lastLoginAt ? "The owner has signed in." : "Waiting for the owner to sign in."}</p>}
      </div>
      {link && <LoginLinkBox link={link} mobile={data.owner.mobile} message={`Hi ${data.owner.name}, your ${data.name} workspace on AHEAD is ready. Set up your login here:`} className="mt-4" />}
      <FormError message={error} />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onBack}>Back</Button>
        <div className="flex gap-2">
          <Link href={`${base}/clients/${data.id}?tab=handover`} className={buttonVariants({ variant: "outline" })}>Open business</Link>
          <Button type="button" onClick={send} disabled={busy}>{busy ? "Sending…" : h.sentAt ? "Send a new login link" : "Hand over & send login link"}</Button>
        </div>
      </div>
    </Panel>
  )
}
