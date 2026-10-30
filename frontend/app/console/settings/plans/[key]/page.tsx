"use client"

import * as React from "react"
import { toast } from "sonner"
import { AlertTriangle, Check, CircleDot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ConfirmDialog } from "@/components/common"
import { Field } from "@/components/form"
import { Chip, Failed, Loading, Page, Panel, money } from "@/components/console/kit"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDateTime } from "@/lib/format"
import type { PlanDraft, PlanEditorData } from "@/lib/console"
import type { PlanLimits } from "@/lib/types"
import { cn } from "@/lib/utils"

// Plan editor (blueprint Phase D): change a plan as a draft, see who it affects, then publish.
// Clients already paying keep what they paid until renewal; issued invoices never change.

const LIMIT_FIELDS: { key: keyof PlanLimits; label: string; nullable: boolean }[] = [
  { key: "users", label: "Users", nullable: false },
  { key: "branches", label: "Branches", nullable: false },
  { key: "invoicesPerMonth", label: "Invoices a month", nullable: true },
  { key: "contacts", label: "Customers & leads", nullable: true },
  { key: "items", label: "Products & services", nullable: true },
  { key: "storageMb", label: "Storage (MB)", nullable: false },
  { key: "aiCredits", label: "AI credits a month", nullable: false },
]

const rupees = (p: number | null) => (p === null ? "" : String(p / 100))
const toPaise = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100))

export default function PlanEditorPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = React.use(params)
  const { canConsole } = useAuth()
  const canEdit = canConsole("platform.plan.edit")
  const { data, error, reload, setData } = useApi<PlanEditorData>(`/console/plans/${key}/editor`)
  const [form, setForm] = React.useState<PlanDraft | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState<"save" | "publish" | "discard" | null>(null)
  const [confirm, setConfirm] = React.useState(false)

  if (error) return <Failed error={error} onRetry={reload} />
  if (!data) return <Loading rows={8} className="mx-auto max-w-6xl" />

  const base = data.draft ?? data.live
  const f = form ?? base
  const set = (patch: Partial<PlanDraft>) => setForm({ ...f, ...patch })
  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(base)
  const free = key === "free"
  const mods = new Set(f.fullModules)
  const missingDeps = data.modules.filter((m) => mods.has(m.key)).flatMap((m) => m.dependsOn.filter((d) => !mods.has(d)).map((d) => `${m.name} needs ${data.modules.find((x) => x.key === d)?.name ?? d}`))
  const name = (k: string) => data.modules.find((m) => m.key === k)?.name ?? k

  async function save() {
    setBusy("save")
    setErrors({})
    try {
      setData(await api.put<PlanEditorData>(`/console/plans/${key}/draft`, f))
      setForm(null)
      toast.success("Draft saved. Nothing is live until you publish.")
    } catch (e) {
      setErrors(e instanceof ApiError ? { ...e.fields, form: errorMessage(e) } : { form: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }
  async function publish() {
    setBusy("publish")
    try {
      setData(await api.post<PlanEditorData>(`/console/plans/${key}/publish`))
      setForm(null)
      toast.success(`${f.name} is live`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
      setConfirm(false)
    }
  }
  async function discard() {
    setBusy("discard")
    try {
      setData(await api.delete<PlanEditorData>(`/console/plans/${key}/draft`))
      setForm(null)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const categories = [...new Set(data.modules.map((m) => m.category))]

  return (
    <Page
      back={{ href: "/console/settings/plans", label: "Plans & pricing" }}
      title={
        <span className="flex flex-wrap items-center gap-3">
          {data.live.name}
          {data.draft ? <Chip tone="amber">Draft · not live</Chip> : <Chip tone="green">Live</Chip>}
          {!data.live.isPublic && <Chip tone="grey">Not for sale</Chip>}
        </span>
      }
      subtitle={`${data.impact.onPlan} business${data.impact.onPlan === 1 ? "" : "es"} on this plan · ${data.impact.paying} paying · ${data.impact.trial} on trial`}
      actions={
        canEdit && (
          <>
            {dirty && <Button variant="outline" onClick={() => setForm(null)}>Undo</Button>}
            <Button variant={data.draft && !dirty ? "outline" : "default"} onClick={save} disabled={!dirty || !!busy}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
          </>
        )
      }
      wide
    >
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="grid content-start gap-6">
          <Panel title="Name and sale">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" error={errors.name}>
                <Input id="plan-name" value={f.name} disabled={!canEdit} onChange={(e) => set({ name: e.target.value })} maxLength={40} />
              </Field>
              <Field label="For sale" hint="Off: kept for businesses already on it, hidden from new sales">
                <div className="flex h-9 items-center gap-2"><Switch checked={f.isPublic} disabled={!canEdit} onCheckedChange={(v) => set({ isPublic: v })} aria-label="For sale" /> <span className="text-sm">{f.isPublic ? "Sold" : "Not sold"}</span></div>
              </Field>
              <Field label="One-line description" className="sm:col-span-2" error={errors.tagline}>
                <Input id="plan-tagline" value={f.tagline} disabled={!canEdit} onChange={(e) => set({ tagline: e.target.value })} maxLength={120} />
              </Field>
            </div>
          </Panel>

          {!free && (
            <Panel title="Price" description="Before GST. Leave empty when the plan isn't sold on that cycle (Enterprise is quoted).">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Monthly (₹)" error={errors.monthlyPaise}>
                  <Input id="plan-monthly" inputMode="decimal" value={rupees(f.monthlyPaise)} disabled={!canEdit} onChange={(e) => set({ monthlyPaise: toPaise(e.target.value.replace(/[^\d.]/g, "")) })} placeholder="Not sold monthly" />
                </Field>
                <Field label="Yearly (₹)" error={errors.yearlyPaise} hint={f.monthlyPaise && f.yearlyPaise ? `${Math.round((1 - f.yearlyPaise / (f.monthlyPaise * 12)) * 100)}% less than 12 months` : undefined}>
                  <Input id="plan-yearly" inputMode="decimal" value={rupees(f.yearlyPaise)} disabled={!canEdit} onChange={(e) => set({ yearlyPaise: toPaise(e.target.value.replace(/[^\d.]/g, "")) })} placeholder="Not sold yearly" />
                </Field>
              </div>
            </Panel>
          )}

          <Panel title="Limits" description="Empty means unlimited where allowed.">
            <div className="grid gap-4 sm:grid-cols-3">
              {LIMIT_FIELDS.map((l) => (
                <Field key={l.key} label={l.label} error={errors[`limits.${l.key}`]}>
                  <Input
                    id={`plan-${l.key}`}
                    inputMode="numeric"
                    value={f.limits[l.key] === null ? "" : String(f.limits[l.key])}
                    disabled={!canEdit}
                    placeholder={l.nullable ? "Unlimited" : "0"}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "")
                      set({ limits: { ...f.limits, [l.key]: v === "" ? (l.nullable ? null : 0) : Number(v) } })
                    }}
                  />
                </Field>
              ))}
            </div>
          </Panel>

          <Panel title="Modules" description={free ? "The Free plan gets the free-tier modules: CRM, Products, Billing and Tasks." : "What a business on this plan can use. A module needs the ones it depends on."}>
            {free ? (
              <p className="text-sm text-muted-foreground">Change the free-tier list in Modules.</p>
            ) : (
              <div className="grid gap-5">
                {categories.map((c) => (
                  <div key={c}>
                    <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{c}</div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {data.modules.filter((m) => m.category === c).map((m) => {
                        const on = mods.has(m.key)
                        return (
                          <label key={m.key} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm", on && "border-primary/40 bg-accent/40", !canEdit && "cursor-default")}>
                            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={on} disabled={!canEdit} onChange={() => set({ fullModules: on ? f.fullModules.filter((x) => x !== m.key) : [...f.fullModules, m.key] })} />
                            <span className="min-w-0">
                              <span className="block font-medium">{m.name}</span>
                              {m.dependsOn.length > 0 && <span className="block text-xs text-muted-foreground">Needs {m.dependsOn.map(name).join(", ")}</span>}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {missingDeps.length > 0 && <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {missingDeps.join(" · ")}</p>}
              </div>
            )}
          </Panel>
        </div>

        <div className="grid content-start gap-6 xl:sticky xl:top-20 xl:self-start">
          <Panel title={data.draft ? "Draft" : "Live"} description={data.draft ? `Saved ${data.draftAt ? formatDateTime(data.draftAt) : ""}${data.draftBy ? ` by ${data.draftBy}` : ""}` : "Change anything on the left and save it as a draft first."}>
            {data.draft && data.diff ? (
              <div className="grid gap-4 text-sm">
                {!data.diff.changed && <p className="text-muted-foreground">The draft is the same as the live plan.</p>}
                {data.diff.prices.map((p) => (
                  <div key={p.cycle} className="flex justify-between gap-2"><span className="text-muted-foreground capitalize">{p.cycle} price</span><span className="tabular-nums">{p.from === null ? "—" : money(p.from)} → <b>{p.to === null ? "not sold" : money(p.to)}</b></span></div>
                ))}
                {data.diff.limits.map((l) => (
                  <div key={l.key} className="flex justify-between gap-2"><span className="text-muted-foreground">{LIMIT_FIELDS.find((x) => x.key === l.key)?.label ?? l.key}</span><span className="tabular-nums">{l.from ?? "∞"} → <b>{l.to ?? "∞"}</b></span></div>
                ))}
                {data.diff.added.length > 0 && <div><span className="text-muted-foreground">Adds </span>{data.diff.added.map(name).join(", ")}</div>}
                {data.diff.removed.length > 0 && <div><span className="text-muted-foreground">Removes </span>{data.diff.removed.map(name).join(", ")}</div>}
                {data.diff.text.length > 0 && <div className="text-muted-foreground">Also changes: {data.diff.text.map((t) => (t === "isPublic" ? "for sale" : t)).join(", ")}</div>}

                <div className="grid gap-1.5 rounded-lg bg-muted/50 p-3 text-[13px]">
                  <b className="text-sm">Who it affects</b>
                  <span className="flex items-center gap-2"><CircleDot className="size-3.5 text-primary" /> {data.impact.onPlan} business{data.impact.onPlan === 1 ? "" : "es"} on {data.live.name}</span>
                  {data.diff.removed.length > 0 && data.impact.losingModules > 0 && <span className="flex items-center gap-2 text-amber-700 dark:text-amber-400"><AlertTriangle className="size-3.5" /> {data.impact.losingModules} paying business{data.impact.losingModules === 1 ? "" : "es"} lose {data.diff.removed.map(name).join(", ")} (becomes read-only if used)</span>}
                  {data.diff.prices.length > 0 && <span className="flex items-center gap-2"><Check className="size-3.5 text-emerald-600" /> New prices apply to new orders and renewals; nobody is charged now</span>}
                </div>
                {data.problems.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">{data.problems.join(" · ")}</p>}
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setConfirm(true)} disabled={!!busy || dirty || data.problems.length > 0 || !data.diff.changed} title={dirty ? "Save the draft first" : undefined}>{busy === "publish" ? "Publishing…" : "Publish"}</Button>
                    <Button variant="ghost" onClick={discard} disabled={!!busy}>Discard draft</Button>
                  </div>
                )}
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Monthly</dt><dd className="text-right tabular-nums">{data.live.monthlyPaise === null ? "—" : money(data.live.monthlyPaise)}</dd>
                <dt className="text-muted-foreground">Yearly</dt><dd className="text-right tabular-nums">{data.live.yearlyPaise === null ? "—" : money(data.live.yearlyPaise)}</dd>
                <dt className="text-muted-foreground">Users</dt><dd className="text-right tabular-nums">{data.live.limits.users}</dd>
                <dt className="text-muted-foreground">Modules</dt><dd className="text-right tabular-nums">{free ? 4 : data.live.fullModules.length}</dd>
              </dl>
            )}
          </Panel>
          {errors.form && <p className="text-sm text-destructive">{errors.form}</p>}
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Publish ${f.name}?`}
        description={`The change goes live for the ${data.impact.onPlan} business${data.impact.onPlan === 1 ? "" : "es"} on this plan and for new sales. Prices apply to new orders and renewals.`}
        confirmLabel="Publish"
        onConfirm={publish}
      />
    </Page>
  )
}
