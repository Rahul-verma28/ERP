"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CalendarClock } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FormError, NativeSelect } from "@/components/form"
import { Chip, Panel, money } from "@/components/console/kit"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"
import { formatDate } from "@/lib/format"
import { MODULE_SHORT, type Catalog, type ClientDetail, type ModuleSwitch, type PlanChangePreview } from "@/lib/console"
import { cn } from "@/lib/utils"

// Business › Plan & billing (blueprint Phase D): modules with per-business switches, change
// plan for a paying business (pro-rated upgrade now, or at the renewal date), and the change
// waiting for renewal.

function SwitchDialog({ client, moduleKey, current, onClose, onDone }: { client: ClientDetail; moduleKey: string; current: ModuleSwitch | null; onClose: () => void; onDone: () => void }) {
  const on = client.modules.find((m) => m.key === moduleKey)?.status === "active"
  const [state, setState] = React.useState<"on" | "off">(current?.state ?? (on ? "off" : "on"))
  const [until, setUntil] = React.useState(current?.until?.slice(0, 10) ?? "")
  const [reason, setReason] = React.useState(current?.reason ?? "")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const label = MODULE_SHORT[moduleKey] ?? moduleKey
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      await api.put(`/console/tenants/${client.id}/module-switches/${moduleKey}`, { state, reason, until: until ? new Date(`${until}T23:59:59+05:30`).toISOString() : null })
      toast.success(`${label} switched ${state} for ${client.name}`)
      onDone()
    } catch (x) {
      setErrors(x instanceof ApiError ? { ...x.fields, form: errorMessage(x) } : { form: errorMessage(x) })
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    try {
      await api.delete(`/console/tenants/${client.id}/module-switches/${moduleKey}`)
      toast.success(`${label} follows the plan again`)
      onDone()
    } catch (x) {
      toast.error(errorMessage(x))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{label} for {client.name}</DialogTitle>
            <DialogDescription>Overrides the plan for this business only. Use it for a demo or a special deal, ideally with an end date.</DialogDescription>
          </DialogHeader>
          <div className="flex w-fit rounded-lg border p-1" role="group" aria-label="Switch">
            {(["on", "off"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={state === s} onClick={() => setState(s)} className={cn("h-8 rounded-md px-4 text-[13px] font-medium", state === s ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
                {s === "on" ? "Turn on" : "Turn off"}
              </button>
            ))}
          </div>
          <Field label="Until" hint="Leave empty for no end date" error={errors.until}>
            <Input id="switch-until" type="date" value={until} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setUntil(e.target.value)} />
          </Field>
          <Field label="Why" required error={errors.reason} hint="Shown on the Modules page and in the audit trail">
            <Input id="switch-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Two-week HR demo" maxLength={200} />
          </Field>
          <FormError message={errors.form} />
          <DialogFooter className="gap-2">
            {current && <Button type="button" variant="ghost" onClick={remove} disabled={busy}>Follow the plan again</Button>}
            <Button type="submit" disabled={busy || reason.trim().length < 3}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Modules on/off for this business, with switches for the AHEAD team */
export function ModulesWithSwitches({ client, canSwitch, onChanged }: { client: ClientDetail; canSwitch: boolean; onChanged: () => void }) {
  const catalog = useApi<Catalog>("/console/catalog")
  const switches = useApi<{ data: ModuleSwitch[] }>(canSwitch ? `/console/tenants/${client.id}/module-switches` : null)
  const [editing, setEditing] = React.useState<string | null>(null)
  const status = new Map(client.modules.map((m) => [m.key, m.status]))
  const sw = new Map((switches.data?.data ?? []).map((s) => [s.moduleKey, s]))
  const order = Object.keys(MODULE_SHORT)
  const fullName = new Map((catalog.data?.modules ?? []).map((m) => [m.key, m.name]))
  const keys = catalog.data ? catalog.data.modules.map((m) => m.key) : client.modules.map((m) => m.key)
  const all = keys.map((k) => ({ key: k, name: MODULE_SHORT[k] ?? k, full: fullName.get(k) ?? k })).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  return (
    <Panel title="Modules" description={`${client.modules.filter((m) => m.status === "active").length} of ${all.length} on${sw.size ? ` · ${sw.size} switched for this business` : ""}`}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {all.map((m) => {
          const s = status.get(m.key)
          const o = sw.get(m.key)
          const body = (
            <>
              <span className="min-w-0">
                <span className="block truncate">{m.name}</span>
                {o && <span className="block text-[11px] text-primary">Switched {o.state}{o.until ? ` · ${formatDate(o.until)}` : ""}</span>}
              </span>
              {s === "active" ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-500" />On</span>
              ) : s === "read_only" ? (
                <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">Read-only</span>
              ) : (
                <span className="shrink-0 text-xs">Off</span>
              )}
            </>
          )
          const cls = cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm", s !== "active" && s !== "read_only" && "bg-muted/50 text-muted-foreground", o && "border-primary/40")
          return canSwitch ? (
            <button key={m.key} type="button" title={`${m.full}: switch for this business`} onClick={() => setEditing(m.key)} className={cn(cls, "hover:border-primary/50")}>{body}</button>
          ) : (
            <div key={m.key} title={m.full} className={cls}>{body}</div>
          )
        })}
      </div>
      {canSwitch && <p className="mt-3 text-xs text-muted-foreground">Click a module to turn it on or off for this business only.</p>}
      {editing && <SwitchDialog client={client} moduleKey={editing} current={sw.get(editing) ?? null} onClose={() => setEditing(null)} onDone={() => (setEditing(null), switches.reload(), onChanged())} />}
    </Panel>
  )
}

/** Change plan for a paying business: live preview, then an order (upgrade) or a scheduled change */
export function ChangePlanPaidDialog({ client, onClose, onDone }: { client: ClientDetail; onClose: () => void; onDone: () => void }) {
  const catalog = useApi<Catalog>("/console/catalog")
  const currentKey = client.subscription?.plan?.key ?? ""
  const [planKey, setPlanKey] = React.useState("")
  const [cycle, setCycle] = React.useState<"monthly" | "yearly">(client.subscription?.cycle ?? "monthly")
  const plans = (catalog.data?.plans ?? []).filter((p) => p.isPublic && p.key !== "free" && catalog.data!.prices.some((x) => x.itemType === "plan" && x.itemRef === p.key))
  const chosen = planKey || plans.find((p) => p.key !== currentKey)?.key || ""
  const preview = useApi<PlanChangePreview>(chosen ? `/console/tenants/${client.id}/plan-change?planKey=${chosen}&cycle=${cycle}` : null)
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState<{ orderId: string } | null>(null)
  async function confirm() {
    setBusy(true)
    try {
      const r = await api.post<{ kind: "upgrade"; orderId: string } | { kind: "scheduled"; effectiveAt: string; to: string }>(`/console/tenants/${client.id}/plan-change`, { planKey: chosen, cycle })
      if (r.kind === "upgrade") setDone({ orderId: r.orderId })
      else {
        toast.success(`${r.to} from ${formatDate(r.effectiveAt)}`)
        onDone()
      }
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const p = preview.data
  return (
    <Dialog open onOpenChange={(o) => !o && (done ? onDone() : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change plan</DialogTitle>
          <DialogDescription>Now on {client.subscription?.plan?.name} · {client.subscription?.cycle}, renews {client.subscription?.currentPeriodEnd ? formatDate(client.subscription.currentPeriodEnd) : "—"}.</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="grid gap-3 text-sm">
            <p>The upgrade order is ready. The new plan starts as soon as it&apos;s paid; the renewal date stays the same.</p>
            <Link href={`/console/payments/${done.orderId}`} className={buttonVariants()}>Open order and send payment link</Link>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New plan">
                <NativeSelect value={chosen} onChange={(e) => setPlanKey(e.target.value)}>
                  {plans.map((pl) => (
                    <option key={pl.key} value={pl.key} disabled={pl.key === currentKey && cycle === client.subscription?.cycle}>{pl.name}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Billing">
                <NativeSelect value={cycle} onChange={(e) => setCycle(e.target.value as "monthly" | "yearly")}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </NativeSelect>
              </Field>
            </div>
            <div className="rounded-xl border bg-muted/30 p-3 text-sm">
              {preview.error ? (
                <p className="text-destructive">{preview.error.message}</p>
              ) : !p ? (
                <p className="text-muted-foreground">Working out the price…</p>
              ) : p.kind === "upgrade" ? (
                <div className="grid gap-1">
                  <b>Upgrade now: {p.from} → {p.to}</b>
                  <span className="text-muted-foreground">Pay the difference for the {p.daysLeft} days left. Renewal stays on {formatDate(p.renewsAt)}.</span>
                  <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Before GST</span><span className="tabular-nums">{money(p.taxablePaise)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span className="tabular-nums">{money(p.gstPaise)}</span></div>
                  <div className="flex justify-between font-semibold"><span>To pay now</span><span className="tabular-nums">{money(p.totalPaise)}</span></div>
                </div>
              ) : (
                <div className="grid gap-1">
                  <b>From the renewal date: {p.from} → {p.to} · {p.cycle}</b>
                  <span className="text-muted-foreground">Nothing to pay now. On {formatDate(p.effectiveAt)} the renewal bills {money(p.renewalPaise)} + GST.</span>
                </div>
              )}
            </div>
          </div>
        )}
        {!done && (
          <DialogFooter>
            <Button onClick={confirm} disabled={busy || !p}>{busy ? "Saving…" : p?.kind === "upgrade" ? "Create upgrade order" : "Schedule change"}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function PendingChangeNotice({ client, canEdit, onDone }: { client: ClientDetail; canEdit: boolean; onDone: () => void }) {
  const c = client.pendingChange
  if (!c) return null
  async function cancel() {
    try {
      await api.delete(`/console/tenants/${client.id}/plan-change`)
      toast.success("Plan change cancelled")
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-accent/40 px-4 py-3 text-sm">
      <CalendarClock className="size-4 text-primary" />
      <span className="flex-1">Moves to <b>{c.planName}</b> · {c.cycle} on {formatDate(c.effectiveAt)}, when it renews.</span>
      <Chip tone="blue">Scheduled</Chip>
      {canEdit && <Button size="sm" variant="outline" onClick={cancel}>Cancel change</Button>}
    </div>
  )
}
