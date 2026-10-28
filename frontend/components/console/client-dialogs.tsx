"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FormError, NativeSelect } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import { ACQUIRER_LABEL, METHOD_LABEL, type AcquiredByType, type AcquisitionMethod, type Catalog, type ClientDetail, type ConsoleMember } from "@/lib/console"

// Client page actions. A short note is asked only where money or access is at stake.

const fail = (err: unknown) => (err instanceof ApiError ? { ...err.fields, form: errorMessage(err) } : { form: errorMessage(err) })

export function ExtendDialog({ client, open, onOpenChange, onDone }: { client: ClientDetail; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [days, setDays] = React.useState("7")
  const [reason, setReason] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const trial = client.status === "trialing"
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      await api.post(`/console/tenants/${client.id}/extend`, { days: Number(days), reason })
      toast.success(trial ? `Trial extended by ${days} days` : `${days} more days to pay`)
      onOpenChange(false)
      onDone()
    } catch (err) {
      setErrors(fail(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{trial ? "Extend the free trial" : "Give more time to pay"}</DialogTitle>
            <DialogDescription>The days are added from today or the current end date, whichever is later.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {["3", "7", "14", "30"].map((d) => (
              <Button key={d} type="button" variant={days === d ? "default" : "outline"} size="sm" onClick={() => setDays(d)}>
                {d} days
              </Button>
            ))}
          </div>
          <Field label="Note" hint="Why — kept with the client's history" error={errors.reason}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Owner was travelling, asked for one more week" required />
          </Field>
          <FormError message={errors.form} />
          <DialogFooter>
            <Button type="submit" disabled={busy || reason.trim().length < 5}>
              {busy ? "Saving…" : `Add ${days} days`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SourceDialog({ client, open, onOpenChange, onDone }: { client: ClientDetail; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { canConsole } = useAuth()
  const members = useApi<{ data: ConsoleMember[] }>(open && canConsole("platform.member.view") ? "/console/members" : null)
  const a = client.acquisition
  const [form, setForm] = React.useState({ byType: (a?.byType ?? "self") as AcquiredByType, byUserId: a?.by?.id ?? "", method: (a?.method ?? "signup") as AcquisitionMethod, reason: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const people = (members.data?.data ?? []).filter((m) => m.status === "active")
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      await api.patch(`/console/tenants/${client.id}/acquisition`, { byType: form.byType, byUserId: form.byType === "self" ? null : form.byUserId || null, method: form.method, referralCode: a?.referralCode ?? null, couponCode: a?.couponCode ?? null, reason: form.reason })
      toast.success("Saved who brought this client in")
      onOpenChange(false)
      onDone()
    } catch (err) {
      setErrors(fail(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Who brought this client in</DialogTitle>
            <DialogDescription>Set when they joined. Change it only when it was recorded wrongly — the client never sees this.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brought in by" error={errors.byType}>
              <NativeSelect value={form.byType} onChange={(e) => setForm({ ...form, byType: e.target.value as AcquiredByType })}>
                {(Object.keys(ACQUIRER_LABEL) as AcquiredByType[]).filter((k) => k !== "partner_user").map((k) => (
                  <option key={k} value={k}>
                    {ACQUIRER_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="How" error={errors.method}>
              <NativeSelect value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as AcquisitionMethod })}>
                {(Object.keys(METHOD_LABEL) as AcquisitionMethod[]).map((k) => (
                  <option key={k} value={k}>
                    {METHOD_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {form.byType !== "self" && (
            <Field label="Person" error={errors.byUserId}>
              <NativeSelect value={form.byUserId} onChange={(e) => setForm({ ...form, byUserId: e.target.value })} required>
                <option value="">Choose…</option>
                {a?.by && !people.some((p) => p.user.id === a.by!.id) && <option value={a.by.id}>{a.by.name}</option>}
                {people.map((p) => (
                  <option key={p.id} value={p.user.id}>
                    {p.user.name} · {p.role.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Note" hint="Why it's being corrected" error={errors.reason}>
            <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Neha's referral wasn't recorded at signup" required />
          </Field>
          <FormError message={errors.form} />
          <DialogFooter>
            <Button type="submit" disabled={busy || form.reason.trim().length < 5}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Partners: move a client to another plan — it shows on the next monthly bill */
export function ChangePlanDialog({ client, open, onOpenChange, onDone }: { client: ClientDetail; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const catalog = useApi<Catalog>(open ? "/console/catalog" : null)
  const [planKey, setPlanKey] = React.useState(client.subscription?.plan?.key ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const plans = (catalog.data?.plans ?? []).filter((p) => p.key !== "free" && p.isPublic)
  const monthly = (key: string) => catalog.data?.prices.find((p) => p.itemType === "plan" && p.itemRef === key && p.cycle === "monthly")?.amountPaise
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.put(`/console/tenants/${client.id}/plan`, { planKey })
      toast.success("Plan changed — it shows on your next bill")
      onOpenChange(false)
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Change plan</DialogTitle>
            <DialogDescription>The new plan&apos;s modules and limits apply at once.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {plans.map((p) => (
              <label key={p.key} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-accent/40">
                <span className="flex items-center gap-3">
                  <input type="radio" name="plan" value={p.key} checked={planKey === p.key} onChange={() => setPlanKey(p.key)} />
                  <span>
                    <span className="block text-sm font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.limits.users} users · {p.fullModules.length} modules
                    </span>
                  </span>
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">{monthly(p.key) !== undefined ? `${formatPaise(monthly(p.key)!, true)}/mo list` : ""}</span>
              </label>
            ))}
          </div>
          <FormError message={error} />
          <DialogFooter>
            <Button type="submit" disabled={busy || !planKey || planKey === client.subscription?.plan?.key}>
              {busy ? "Saving…" : "Change plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
