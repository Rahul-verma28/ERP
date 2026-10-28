"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Failed, Loading, Page, Panel } from "@/components/console/kit"
import { Field, NativeSelect } from "@/components/form"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import type { Catalog, SettingRow } from "@/lib/console"
import type { PlanLimits } from "@/lib/types"
import { GST_STATES } from "@/lib/format"
import { Pencil } from "lucide-react"

type Announcement = { text: string; tone: "info" | "warning"; until: string | null } | null

const ROLE_LABEL: Record<string, string> = { console_sales_executive: "Sales Executive", console_sales_manager: "Sales Manager", vendor: "Vendor" }
const LIMITS: { key: keyof PlanLimits; label: string }[] = [
  { key: "users", label: "Users" },
  { key: "branches", label: "Branches" },
  { key: "contacts", label: "Contacts" },
  { key: "items", label: "Items" },
  { key: "invoicesPerMonth", label: "Invoices / month" },
  { key: "storageMb", label: "Storage (MB)" },
  { key: "aiCredits", label: "AI credits" },
]

/** One card = a group of settings saved together. Read-only until Edit; Save applies at once. */
function SettingCard({
  title,
  description,
  keys,
  rows,
  canEdit,
  onSaved,
  children,
}: {
  title: string
  description: string
  keys: string[]
  rows: SettingRow[]
  canEdit: boolean
  onSaved: () => void
  children: (draft: Record<string, unknown>, set: (key: string, value: unknown) => void) => React.ReactNode
}) {
  const initial = React.useMemo(() => Object.fromEntries(keys.map((k) => [k, rows.find((r) => r.key === k)?.value])), [keys, rows])
  const [draft, setDraft] = React.useState(initial)
  const [busy, setBusy] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const dirty = keys.filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(initial[k]))
  const overridden = rows.filter((r) => keys.includes(r.key) && r.overridden)

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true)
    try {
      await fn()
      toast.success(message)
      setEditing(false)
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={title}
      description={description}
      action={
        canEdit && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
        )
      }
    >
      <fieldset disabled={!editing || busy} className="grid gap-4">
        {children(draft, (key, value) => setDraft((d) => ({ ...d, [key]: value })))}
      </fieldset>
      {editing && (
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t pt-4">
          {overridden.length > 0 && (
            <Button variant="ghost" disabled={busy} onClick={() => run(() => Promise.all(overridden.map((r) => api.delete(`/console/settings/${r.key}`))), "Back to the defaults")}>
              Use defaults
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(initial)
              setEditing(false)
            }}
          >
            Cancel
          </Button>
          <Button disabled={busy || !dirty.length} onClick={() => run(() => Promise.all(dirty.map((k) => api.put(`/console/settings/${k}`, { value: draft[k] }))), "Saved")}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </Panel>
  )
}

const num = (v: string) => (v === "" ? 0 : Number(v))

export default function ConsoleSettingsPage() {
  const { canConsole } = useAuth()
  const settings = useApi<{ data: SettingRow[] }>("/console/settings")
  const catalog = useApi<Catalog>(canConsole("platform.plan.view") ? "/console/catalog" : null)
  const canEdit = canConsole("platform.setting.edit")

  if (settings.error) return <Failed error={settings.error} onRetry={settings.reload} />
  if (!settings.data) return <Loading rows={6} className="mx-auto max-w-6xl" />
  const rows = settings.data.data
  // Re-mount cards after a save so drafts restart from the stored values
  const v = rows.map((r) => r.version).join("-")
  const common = { rows, canEdit, onSaved: settings.reload }

  return (
    <Page title="Rules & billing details" subtitle="Free trial, discount limits and the details printed on AHEAD's invoices. Changes apply to everyone within a minute." back={{ href: "/console/settings", label: "Settings" }}>
      <div className="grid gap-6 lg:grid-cols-2">
        <SettingCard key={`trial-${v}`} title="Free trial" description="How long a new signup can try AHEAD, and the grace period after a missed renewal" keys={["trial.days", "trial.plan_key", "grace.days_monthly", "grace.days_yearly"]} {...common}>
          {(d, set) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Trial length (days)">
                <Input type="number" min={1} max={90} value={String(d["trial.days"])} onChange={(e) => set("trial.days", num(e.target.value))} />
              </Field>
              <Field label="Trial plan" hint="Plan a new trial is attached to">
                {catalog.data ? (
                  <NativeSelect value={String(d["trial.plan_key"])} onChange={(e) => set("trial.plan_key", e.target.value)}>
                    {catalog.data.plans.map((p) => (
                      <option key={p.key} value={p.key}>{p.name}</option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input value={String(d["trial.plan_key"])} onChange={(e) => set("trial.plan_key", e.target.value)} />
                )}
              </Field>
              <Field label="Grace after failed monthly renewal (days)">
                <Input type="number" min={0} max={60} value={String(d["grace.days_monthly"])} onChange={(e) => set("grace.days_monthly", num(e.target.value))} />
              </Field>
              <Field label="Grace after failed yearly renewal (days)">
                <Input type="number" min={0} max={90} value={String(d["grace.days_yearly"])} onChange={(e) => set("grace.days_yearly", num(e.target.value))} />
              </Field>
            </div>
          )}
        </SettingCard>

        <SettingCard key={`limits-${v}`} title="Trial limits" description="What a client on a free trial can use (empty = unlimited)" keys={["trial.limits"]} {...common}>
          {(d, set) => {
            const limits = d["trial.limits"] as PlanLimits
            return (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {LIMITS.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <Input
                      type="number"
                      min={0}
                      value={limits[f.key] === null ? "" : String(limits[f.key])}
                      onChange={(e) => set("trial.limits", { ...limits, [f.key]: e.target.value === "" && ["contacts", "items", "invoicesPerMonth"].includes(f.key) ? null : num(e.target.value) })}
                    />
                  </Field>
                ))}
              </div>
            )
          }}
        </SettingCard>

        <SettingCard key={`discount-${v}`} title="Discount limits" description="The highest discount each person can give. Anything above waits for a Super Admin's approval." keys={["sales.discount_limits"]} {...common}>
          {(d, set) => {
            const limits = d["sales.discount_limits"] as Record<string, number>
            return (
              <div className="grid gap-4 sm:grid-cols-3">
                {Object.keys(ROLE_LABEL).map((role) => (
                  <Field key={role} label={`${ROLE_LABEL[role]} (%)`}>
                    <Input type="number" min={0} max={100} value={String(limits[role] ?? 0)} onChange={(e) => set("sales.discount_limits", { ...limits, [role]: num(e.target.value) })} />
                  </Field>
                ))}
              </div>
            )
          }}
        </SettingCard>

        <SettingCard key={`banner-${v}`} title="Announcement" description="One line shown at the top of every client's app — e.g. planned maintenance" keys={["announcement.banner"]} {...common}>
          {(d, set) => {
            const a = d["announcement.banner"] as Announcement
            const value = a ?? { text: "", tone: "info" as const, until: null }
            const update = (patch: Partial<NonNullable<Announcement>>) => {
              const next = { ...value, ...patch }
              set("announcement.banner", next.text.trim() ? next : null)
            }
            return (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Text" className="sm:col-span-2" hint="Leave empty to show nothing">
                  <Input maxLength={200} value={value.text} onChange={(e) => update({ text: e.target.value })} />
                </Field>
                <Field label="Style">
                  <NativeSelect value={value.tone} onChange={(e) => update({ tone: e.target.value as "info" | "warning" })}>
                    <option value="info">Information</option>
                    <option value="warning">Warning</option>
                  </NativeSelect>
                </Field>
                <Field label="Show until" hint="Empty = until removed">
                  <Input
                    type="date"
                    value={value.until ? value.until.slice(0, 10) : ""}
                    onChange={(e) => update({ until: e.target.value ? new Date(`${e.target.value}T23:59:59+05:30`).toISOString() : null })}
                  />
                </Field>
              </div>
            )
          }}
        </SettingCard>

        <SettingCard
          key={`billing-${v}`}
          title="AHEAD billing details"
          description="Printed on AHEAD's GST invoices. Payment links and invoices need these filled in."
          keys={["ahead.billing", "onboarding.unpaid_cancel_days"]}
          {...common}
        >
          {(d, set) => {
            const b = d["ahead.billing"] as { legalName: string; gstin: string; stateCode: string; address: string; sac: string; gstRateBp: number }
            const update = (patch: Partial<typeof b>) => set("ahead.billing", { ...b, ...patch })
            return (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Legal name">
                  <Input value={b.legalName} onChange={(e) => update({ legalName: e.target.value })} />
                </Field>
                <Field label="GSTIN">
                  <Input value={b.gstin} maxLength={15} onChange={(e) => update({ gstin: e.target.value.toUpperCase() })} />
                </Field>
                <Field label="State">
                  <NativeSelect value={b.stateCode} onChange={(e) => update({ stateCode: e.target.value })}>
                    <option value="">Not set — invoicing is blocked</option>
                    {GST_STATES.map(([code, name]) => (
                      <option key={code} value={code}>{name}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Address">
                  <Input value={b.address} onChange={(e) => update({ address: e.target.value })} />
                </Field>
                <Field label="SAC code">
                  <Input value={b.sac} maxLength={8} onChange={(e) => update({ sac: e.target.value })} />
                </Field>
                <Field label="GST rate (%)">
                  <Input type="number" min={0} max={28} value={String(b.gstRateBp / 100)} onChange={(e) => update({ gstRateBp: Math.round(num(e.target.value) * 100) })} />
                </Field>
                <Field label="Unpaid order lapses after (days)" hint="Sales-created clients that never pay">
                  <Input type="number" min={1} max={60} value={String(d["onboarding.unpaid_cancel_days"])} onChange={(e) => set("onboarding.unpaid_cancel_days", num(e.target.value))} />
                </Field>
              </div>
            )
          }}
        </SettingCard>
      </div>
    </Page>
  )
}
