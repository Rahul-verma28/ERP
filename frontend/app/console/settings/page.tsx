"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Building2, Megaphone, Palette, Percent, RefreshCw, Timer, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DiscardChangesDialog, NativeSelect } from "@/components/form"
import { Failed, Loading, Page, ago } from "@/components/console/kit"
import { BrandFields, BrandPreview } from "@/components/console/brand-editor"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { GST_STATES } from "@/lib/format"
import type { Branding, Catalog, SettingRow } from "@/lib/console"
import type { PlanLimits } from "@/lib/types"
import { cn } from "@/lib/utils"

// Console settings: one page, one section at a time. Each section explains what it controls,
// shows the current values ready to change, and saves with one button. Changes reach everyone
// within a minute.

type Values = Record<string, unknown>
type Billing = { legalName: string; gstin: string; stateCode: string; address: string; sac: string; gstRateBp: number }
type Announcement = { text: string; tone: "info" | "warning"; until: string | null } | null
type SectionKey = "company" | "appearance" | "trial" | "renewals" | "discounts" | "announcement"

const SECTIONS: { key: SectionKey; label: string; icon: LucideIcon; title: string; intro: string; keys: string[] }[] = [
  { key: "company", label: "Company & invoices", icon: Building2, title: "Company & invoices", intro: "AHEAD's own details, printed as the seller on every GST invoice AHEAD sends to a business. Payment links and invoices stay blocked until these are complete.", keys: ["ahead.billing"] },
  { key: "appearance", label: "Appearance", icon: Palette, title: "Appearance", intro: "The theme every new business starts with. Businesses that already exist keep their look, and an owner can still change theirs in the ERP under Settings › Branding.", keys: ["defaults.branding"] },
  { key: "trial", label: "Free trial", icon: Timer, title: "Free trial", intro: "What someone who signs up on the website gets before paying: how long, which plan, and how much they can use.", keys: ["trial.days", "trial.plan_key", "trial.limits"] },
  { key: "renewals", label: "Renewals", icon: RefreshCw, title: "Renewals & unpaid orders", intro: "How long a business keeps working after a renewal is missed, and how long an order made by your team can stay unpaid.", keys: ["grace.days_monthly", "grace.days_yearly", "onboarding.unpaid_cancel_days"] },
  { key: "discounts", label: "Discounts", icon: Percent, title: "Discounts", intro: "How much your team can take off a price on their own. Anything higher waits for an Admin's approval.", keys: ["sales.discount_limits", "referral.welcome_discount_percent"] },
  { key: "announcement", label: "Announcement", icon: Megaphone, title: "Announcement", intro: "One line shown at the top of every business's ERP, for example planned maintenance. Leave the text empty to show nothing.", keys: ["announcement.banner"] },
]

const ROLE_LABEL: Record<string, string> = { console_staff: "Staff", console_sales: "Sales", vendor: "Vendor" }
const LIMITS: { key: keyof PlanLimits; label: string; nullable?: boolean }[] = [
  { key: "users", label: "Users" },
  { key: "branches", label: "Branches" },
  { key: "contacts", label: "Customers & suppliers", nullable: true },
  { key: "items", label: "Products", nullable: true },
  { key: "invoicesPerMonth", label: "Invoices a month", nullable: true },
  { key: "storageMb", label: "Storage (MB)" },
  { key: "aiCredits", label: "AI credits" },
]

const num = (v: string) => (v === "" ? 0 : Number(v))
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const billingReady = (b: Billing) => !!(b.legalName.trim() && b.gstin && b.stateCode && b.address.trim())

export default function SettingsPage() {
  return (
    <React.Suspense>
      <Settings />
    </React.Suspense>
  )
}

function Settings() {
  const router = useRouter()
  const params = useSearchParams()
  const { canConsole } = useAuth()
  const canEdit = canConsole("platform.setting.edit")
  const settings = useApi<{ data: SettingRow[] }>("/console/settings")
  const catalog = useApi<Catalog>(canConsole("platform.plan.view") ? "/console/catalog" : null)

  const [draft, setDraft] = React.useState<Values>({})
  const [seen, setSeen] = React.useState<SettingRow[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [leaving, setLeaving] = React.useState<SectionKey | null>(null)

  // Start the form again from the stored values whenever the server sends them
  const rows = settings.data?.data ?? null
  if (rows && rows !== seen) {
    setSeen(rows)
    setDraft(Object.fromEntries(rows.map((r) => [r.key, r.value])))
    return <Loading rows={8} className="mx-auto max-w-6xl" />
  }

  if (settings.error) return <Failed error={settings.error} onRetry={settings.reload} />
  if (!rows) return <Loading rows={8} className="mx-auto max-w-6xl" />

  const asked = params.get("section") as SectionKey | null
  const section = SECTIONS.find((s) => s.key === asked) ?? SECTIONS[0]
  const stored = (k: string) => rows.find((r) => r.key === k)
  const dirtyKeys = section.keys.filter((k) => !same(draft[k], stored(k)?.value))
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }))
  const resetSection = () => setDraft((d) => ({ ...d, ...Object.fromEntries(section.keys.map((k) => [k, stored(k)?.value])) }))
  const overridden = section.keys.filter((k) => stored(k)?.overridden)
  const last = section.keys.map((k) => stored(k)).filter((r) => r?.changedAt).sort((a, b) => (b!.changedAt! > a!.changedAt! ? 1 : -1))[0]

  function open(k: SectionKey) {
    if (k === section.key) return
    if (dirtyKeys.length) return setLeaving(k)
    setError(null)
    router.replace(`/console/settings?section=${k}`, { scroll: false })
  }

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      toast.success(message)
      settings.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  // One at a time, so the first problem stops the rest
  const save = () => run(async () => { for (const k of dirtyKeys) await api.put(`/console/settings/${k}`, { value: draft[k] }) }, "Saved. Everyone sees it within a minute.")
  const useDefaults = () => run(async () => { for (const k of overridden) await api.delete(`/console/settings/${k}`) }, "Back to AHEAD's defaults")

  const billing = draft["ahead.billing"] as Billing

  return (
    <Page eyebrow="Console" title="Settings" subtitle="How AHEAD works for every business. Pick a section, change what you need and save." wide>
      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:grid lg:overflow-visible lg:pb-0">
            {SECTIONS.map((s) => {
              const needs = s.key === "company" && !billingReady(stored("ahead.billing")!.value as Billing)
              return (
                <li key={s.key} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => open(s.key)}
                    aria-current={s.key === section.key ? "page" : undefined}
                    className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap transition-colors hover:bg-muted", s.key === section.key && "bg-accent font-medium text-accent-foreground hover:bg-accent")}
                  >
                    <s.icon className="size-4 shrink-0 opacity-70" />
                    <span className="flex-1">{s.label}</span>
                    {needs && <span className="size-2 rounded-full bg-amber-500" title="Needs details" aria-label="Needs details" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <section aria-labelledby="section-title" className="min-w-0 rounded-xl border bg-card">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 sm:px-6">
            <div className="max-w-2xl">
              <h2 id="section-title" className="text-lg font-semibold">{section.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{section.intro}</p>
            </div>
            <p className="text-xs text-muted-foreground">{last ? `Last changed ${ago(last.changedAt).toLowerCase()}${last.changedBy ? ` by ${last.changedBy}` : ""}` : "AHEAD's defaults"}</p>
          </header>

          {!canEdit && <p className="border-b bg-muted/40 px-5 py-2.5 text-sm text-muted-foreground sm:px-6">You can see these settings. Only an Admin changes them.</p>}

          <fieldset disabled={!canEdit || busy} className="@container px-5 sm:px-6">
            {section.key === "company" && (
              <>
                {!billingReady(billing) && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">Fill in the legal name, GSTIN, state and address to send invoices and payment links.</p>}
                <Item id="b-name" label="Legal name" hint="As registered for GST">
                  <Input id="b-name" value={billing.legalName} onChange={(e) => set("ahead.billing", { ...billing, legalName: e.target.value })} />
                </Item>
                <Item id="b-gstin" label="GSTIN" hint="15 characters; its first two digits must match the state">
                  <Input id="b-gstin" value={billing.gstin} maxLength={15} className="font-mono uppercase" onChange={(e) => set("ahead.billing", { ...billing, gstin: e.target.value.toUpperCase().replace(/\s/g, "") })} />
                </Item>
                <Item id="b-state" label="State" hint="Decides CGST + SGST or IGST on each invoice">
                  <NativeSelect id="b-state" value={billing.stateCode} onChange={(e) => set("ahead.billing", { ...billing, stateCode: e.target.value })}>
                    <option value="">Choose a state</option>
                    {GST_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                  </NativeSelect>
                </Item>
                <Item id="b-address" label="Address">
                  <Input id="b-address" value={billing.address} onChange={(e) => set("ahead.billing", { ...billing, address: e.target.value })} />
                </Item>
                <Item id="b-sac" label="SAC code and GST rate" hint="For software subscriptions: 998314 at 18%">
                  <div className="flex gap-2">
                    <Input id="b-sac" value={billing.sac} maxLength={8} className="w-32" onChange={(e) => set("ahead.billing", { ...billing, sac: e.target.value.replace(/\D/g, "") })} aria-label="SAC code" />
                    <div className="relative w-28">
                      <Input type="number" min={0} max={28} value={String(billing.gstRateBp / 100)} onChange={(e) => set("ahead.billing", { ...billing, gstRateBp: Math.round(num(e.target.value) * 100) })} aria-label="GST rate in percent" className="pr-7" />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                </Item>
                <Item label="On the invoice" hint="How the seller block prints">
                  <div className="rounded-lg border bg-background p-4 text-sm leading-relaxed">
                    <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">From</div>
                    <div className="font-semibold">{billing.legalName || "Legal name"}</div>
                    <div className="text-muted-foreground">{billing.address || "Address"}</div>
                    <div className="text-muted-foreground">
                      GSTIN {billing.gstin || "—"} · {GST_STATES.find(([c]) => c === billing.stateCode)?.[1] ?? "State"} · SAC {billing.sac || "—"} · GST {billing.gstRateBp / 100}%
                    </div>
                  </div>
                </Item>
              </>
            )}

            {section.key === "appearance" && (
              <div className="grid gap-6 py-5 @3xl:grid-cols-[1fr_20rem]">
                <BrandFields idPrefix="theme" value={draft["defaults.branding"] as Branding} onChange={(b) => set("defaults.branding", b)} />
                <div className="grid content-start gap-2">
                  <div className="text-xs font-medium text-muted-foreground">Preview of a new business</div>
                  <BrandPreview value={draft["defaults.branding"] as Branding} name="New business" />
                </div>
              </div>
            )}

            {section.key === "trial" && (
              <>
                <Item id="t-days" label="Length" hint="Days from signup until payment is needed">
                  <Unit id="t-days" unit="days" min={1} max={90} value={draft["trial.days"] as number} onChange={(v) => set("trial.days", v)} />
                </Item>
                <Item id="t-plan" label="Plan during the trial" hint="Decides which modules a trial business can open">
                  <NativeSelect id="t-plan" value={String(draft["trial.plan_key"])} onChange={(e) => set("trial.plan_key", e.target.value)} className="max-w-xs">
                    {(catalog.data?.plans ?? [{ key: String(draft["trial.plan_key"]), name: String(draft["trial.plan_key"]) }]).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                  </NativeSelect>
                </Item>
                <Item label="Limits during the trial" hint="Leave a box empty for no limit where allowed">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    {LIMITS.map((f) => {
                      const limits = draft["trial.limits"] as PlanLimits
                      const v = limits[f.key]
                      return (
                        <label key={f.key} className="grid gap-1 text-xs text-muted-foreground">
                          {f.label}
                          <Input type="number" min={0} value={v === null ? "" : String(v)} placeholder={f.nullable ? "No limit" : "0"} onChange={(e) => set("trial.limits", { ...limits, [f.key]: e.target.value === "" && f.nullable ? null : num(e.target.value) })} />
                        </label>
                      )
                    })}
                  </div>
                </Item>
              </>
            )}

            {section.key === "renewals" && (
              <>
                <Item id="g-month" label="After a missed monthly renewal" hint="The business keeps working this long, then its modules lock">
                  <Unit id="g-month" unit="days" min={0} max={60} value={draft["grace.days_monthly"] as number} onChange={(v) => set("grace.days_monthly", v)} />
                </Item>
                <Item id="g-year" label="After a missed yearly renewal">
                  <Unit id="g-year" unit="days" min={0} max={90} value={draft["grace.days_yearly"] as number} onChange={(v) => set("grace.days_yearly", v)} />
                </Item>
                <Item id="u-days" label="Unpaid order lapses after" hint="For a business your team created that never paid its first order">
                  <Unit id="u-days" unit="days" min={1} max={60} value={draft["onboarding.unpaid_cancel_days"] as number} onChange={(v) => set("onboarding.unpaid_cancel_days", v)} />
                </Item>
              </>
            )}

            {section.key === "discounts" && (
              <>
                {Object.keys(ROLE_LABEL).map((role) => {
                  const limits = draft["sales.discount_limits"] as Record<string, number>
                  return (
                    <Item key={role} id={`d-${role}`} label={`${ROLE_LABEL[role]} can give up to`} hint={role === "vendor" ? "On the businesses they bring in" : undefined}>
                      <Unit id={`d-${role}`} unit="%" min={0} max={100} value={limits[role] ?? 0} onChange={(v) => set("sales.discount_limits", { ...limits, [role]: v })} />
                    </Item>
                  )
                })}
                <Item id="w-pct" label="Welcome discount" hint="Off the first payment of a business that signed up with a vendor's or salesperson's link or code, when the order has no other discount">
                  <Unit id="w-pct" unit="%" min={0} max={50} value={draft["referral.welcome_discount_percent"] as number} onChange={(v) => set("referral.welcome_discount_percent", v)} />
                </Item>
              </>
            )}

            {section.key === "announcement" && <AnnouncementFields value={draft["announcement.banner"] as Announcement} onChange={(v) => set("announcement.banner", v)} />}
          </fieldset>

          {canEdit && (
            <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t bg-card/95 px-5 py-3 backdrop-blur sm:px-6">
              <div className="min-w-0 text-sm">
                {error ? <span className="text-destructive">{error}</span> : dirtyKeys.length ? <span className="font-medium">You have unsaved changes</span> : overridden.length ? (
                  <button type="button" disabled={busy} onClick={useDefaults} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Reset to AHEAD’s defaults</button>
                ) : <span className="text-muted-foreground">Using AHEAD’s defaults</span>}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" disabled={busy || !dirtyKeys.length} onClick={() => (resetSection(), setError(null))}>Discard</Button>
                <Button type="button" disabled={busy || !dirtyKeys.length} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>
              </div>
            </footer>
          )}
        </section>
      </div>

      <DiscardChangesDialog
        open={!!leaving}
        count={dirtyKeys.length}
        onKeep={() => setLeaving(null)}
        onDiscard={() => {
          resetSection()
          setError(null)
          router.replace(`/console/settings?section=${leaving}`, { scroll: false })
          setLeaving(null)
        }}
      />
    </Page>
  )
}

/** A settings row: what it is on the left, the control on the right. */
function Item({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b py-4 last:border-0 @2xl:grid-cols-[15rem_1fr] @2xl:gap-6">
      <div>
        {id ? <label htmlFor={id} className="text-sm font-medium">{label}</label> : <div className="text-sm font-medium">{label}</div>}
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Unit({ id, unit, value, onChange, min, max }: { id: string; unit: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <div className="relative w-36">
      <Input id={id} type="number" min={min} max={max} value={String(value ?? 0)} onChange={(e) => onChange(num(e.target.value))} className="pr-12" />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">{unit}</span>
    </div>
  )
}

function AnnouncementFields({ value, onChange }: { value: Announcement; onChange: (v: Announcement) => void }) {
  // Keep what is typed even while the text is empty; an empty text saves as "no announcement"
  const [local, setLocal] = React.useState(value ?? { text: "", tone: "info" as const, until: null })
  const update = (patch: Partial<NonNullable<Announcement>>) => {
    const next = { ...local, ...patch }
    setLocal(next)
    onChange(next.text.trim() ? next : null)
  }
  return (
    <>
      <Item id="a-text" label="Text" hint="Up to 200 characters">
        <Input id="a-text" maxLength={200} value={local.text} onChange={(e) => update({ text: e.target.value })} placeholder="e.g. AHEAD will be down for maintenance on Sunday 2–3 AM" />
      </Item>
      <Item id="a-tone" label="Style">
        <NativeSelect id="a-tone" value={local.tone} onChange={(e) => update({ tone: e.target.value as "info" | "warning" })} className="max-w-xs">
          <option value="info">Information (blue)</option>
          <option value="warning">Warning (amber)</option>
        </NativeSelect>
      </Item>
      <Item id="a-until" label="Show until" hint="Empty keeps it until you remove the text">
        <Input id="a-until" type="date" className="w-44" value={local.until ? local.until.slice(0, 10) : ""} onChange={(e) => update({ until: e.target.value ? new Date(`${e.target.value}T23:59:59+05:30`).toISOString() : null })} />
      </Item>
      <Item label="Preview" hint="Top of every business's ERP">
        {local.text.trim() ? (
          <div className={cn("rounded-lg px-3 py-2 text-sm", local.tone === "warning" ? "bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100" : "bg-accent text-accent-foreground")}>{local.text}</div>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing is shown right now.</p>
        )}
      </Item>
    </>
  )
}
