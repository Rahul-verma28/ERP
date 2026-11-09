"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { IDLE_OPTIONS, cidrError, ipAllowed, describePasswordPolicy, type SecurityPolicy } from "@contracts/account"
import { changeReason } from "@contracts/validation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ErrorState, NoAccess } from "@/components/page-states"
import { SettingsPage } from "@/components/settings-shell"
import { api, ApiError, errorMessage } from "@/lib/api"
import { timeAgo, type SessionRow } from "@/lib/account"
import { useAuth } from "@/lib/auth"
import { formatDateTime } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import type { Role } from "@/lib/types"
import { cn } from "@/lib/utils"

// Settings › Users & security (wireframe X3): the rules for everyone who signs in to this
// business. Every change shows before → after, asks for a reason and emails the owner.

interface SecurityData {
  policy: SecurityPolicy
  currentIp: string | null
  currentIpAllowed: boolean
  me: { mfaEnabled: boolean; isOwner: boolean }
  withoutMfa: { userId: string; name: string; role: string }[]
  adminsWithoutMfa: number
}

const card = "flex flex-col gap-2.5 ui-surface px-4 py-3.5"
const k = "text-xs font-semibold text-muted-foreground"
const pill = "inline-flex h-5 items-center rounded-full px-[7px] text-[11px] font-semibold"
const MFA_LABEL: Record<SecurityPolicy["mfa"]["policy"], string> = { off: "Off", admins: "Owner & admins", everyone: "Everyone", roles: "Per role" }
const idleLabel = (m: number) => IDLE_OPTIONS.find((o) => o.value === m)?.label ?? `${m} minutes`

export default function UsersSecurityPage() {
  const { can, me } = useAuth()
  const sec = useApi<SecurityData>(can("tenant.settings.view") ? "/tenant/security" : null)
  const roles = useApi<{ data: Role[] }>(can("tenant.role.view") ? "/roles" : null)
  const [pending, setPending] = React.useState<{ policy: SecurityPolicy; rows: [string, string, string][]; allowSelfExclusion?: boolean } | null>(null)
  if (!can("tenant.settings.view")) return <NoAccess what="Users & security" />
  if (sec.error && !sec.data) return <ErrorState error={sec.error} onRetry={sec.reload} />
  const editable = can("tenant.settings.edit")
  const data = sec.data

  /** Every change goes through the confirm dialog (diff + reason). */
  const propose = (policy: SecurityPolicy, rows: [string, string, string][], allowSelfExclusion?: boolean) => setPending({ policy, rows, allowSelfExclusion })

  return (
    <SettingsPage title="Users & security" description={`Rules for everyone who signs in to ${me?.tenant?.name ?? "this business"}. Changes ask for a reason and email the owner.`}>
      {!data ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <TwoStepPolicy data={data} roles={roles.data?.data ?? []} editable={editable} propose={propose} />
            <PasswordPolicy policy={data.policy} editable={editable} propose={propose} />
            <SessionPolicy policy={data.policy} editable={editable} propose={propose} />
            <NetworksPolicy data={data} editable={editable} propose={propose} />
          </div>
          {can("tenant.member.view") && <TeamSessions />}
          {can("tenant.audit.view") && <SignInHistory />}
        </>
      )}
      <ConfirmPolicy pending={pending} onClose={() => setPending(null)} onSaved={sec.reload} />
    </SettingsPage>
  )
}

type Propose = (policy: SecurityPolicy, rows: [string, string, string][], allowSelfExclusion?: boolean) => void

function ConfirmPolicy({ pending, onClose, onSaved }: { pending: { policy: SecurityPolicy; rows: [string, string, string][]; allowSelfExclusion?: boolean } | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = React.useState("")
  const [touched, setTouched] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const reasonError = touched ? changeReason(reason) : null
  const close = () => {
    setReason("")
    setTouched(false)
    setError(null)
    onClose()
  }
  const save = async () => {
    setTouched(true)
    if (changeReason(reason) || !pending) return
    setBusy(true)
    setError(null)
    try {
      const mfa = { policy: pending.policy.mfa.policy, roleIds: pending.policy.mfa.roleIds, graceDays: pending.policy.mfa.graceDays }
      await api.put("/tenant/security", { policy: { ...pending.policy, mfa }, reason: reason.trim(), allowSelfExclusion: !!pending.allowSelfExclusion })
      toast.success("Security settings saved. The owner has been emailed.")
      await onSaved()
      close()
    } catch (e) {
      setError(e instanceof ApiError && Object.keys(e.fields).length ? Object.values(e.fields)[0] : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm security change</DialogTitle>
          <DialogDescription>Applies to everyone in the business from their next sign-in or request. The reason is kept in the audit log and emailed to the owner.</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-xl border text-sm">
          <div className="grid grid-cols-3 gap-2 bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Setting</span>
            <span>Before</span>
            <span>After</span>
          </div>
          {pending?.rows.map(([label, before, after]) => (
            <div key={label} className="grid grid-cols-3 gap-2 border-t px-3 py-2">
              <span className="font-medium">{label}</span>
              <span className="break-words text-muted-foreground line-through">{before}</span>
              <span className="break-words text-emerald-700 dark:text-emerald-400">{after}</span>
            </div>
          ))}
        </div>
        <Field label="Reason for the change" required error={reasonError} count={[reason.trim().length, 500]} hint="10–500 characters">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} rows={3} autoFocus />
        </Field>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Back
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Confirm & save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Two-step verification ──

function TwoStepPolicy({ data, roles, editable, propose }: { data: SecurityData; roles: Role[]; editable: boolean; propose: Propose }) {
  const p = data.policy
  const [choice, setChoice] = React.useState(p.mfa.policy)
  const [roleIds, setRoleIds] = React.useState(p.mfa.roleIds)
  const [grace, setGrace] = React.useState(String(p.mfa.graceDays))
  const dirty = choice !== p.mfa.policy || roleIds.join() !== p.mfa.roleIds.join() || Number(grace) !== p.mfa.graceDays
  const needsOwn = choice !== "off" && !data.me.mfaEnabled
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "role"
  const describe = (c: string, ids: string[]) => (c === "roles" ? `Per role: ${ids.map(roleName).join(", ") || "none"}` : MFA_LABEL[c as SecurityPolicy["mfa"]["policy"]])

  return (
    <section id="two-step" className={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">Two-step verification</h2>
        {data.withoutMfa.length > 0 && (
          <span className={cn(pill, "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200")} title={data.withoutMfa.map((w) => w.name).join(", ")}>
            {data.withoutMfa.length} {p.mfa.policy === "off" ? "admin" : "person"}
            {data.withoutMfa.length === 1 ? "" : "s"} without it
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Who needs two-step verification">
        {(Object.keys(MFA_LABEL) as SecurityPolicy["mfa"]["policy"][]).map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={choice === o}
            disabled={!editable}
            onClick={() => setChoice(o)}
            className={cn("h-8 rounded-lg border px-2.5 text-xs font-semibold", choice === o ? "border-primary bg-accent text-accent-foreground" : "border-input bg-card")}
          >
            {MFA_LABEL[o]}
          </button>
        ))}
      </div>
      {choice === "roles" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Roles that need two-step">
          {roles.map((r) => (
            <label key={r.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
              <input type="checkbox" className="accent-primary" disabled={!editable} checked={roleIds.includes(r.id)} onChange={(e) => setRoleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))} />
              {r.name}
            </label>
          ))}
        </div>
      )}
      {choice !== "off" && (
        <label className="flex items-center gap-2 text-xs">
          Grace period
          <NativeSelect className="h-8 w-28 text-xs" value={grace} disabled={!editable} onChange={(e) => setGrace(e.target.value)} aria-label="Grace period">
            {[0, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d === 0 ? "None" : `${d} days`}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      <p className="text-xs leading-relaxed text-foreground/80">
        {choice === "off" ? (
          "Nobody is required to use it. People can still turn it on for themselves."
        ) : (
          <>
            People who haven&apos;t set it up get <strong>{Number(grace) || 0} days</strong> (banner in the app), then must set it up when they next sign in.{" "}
            {data.me.mfaEnabled ? "You already use it, so you can't be locked out." : ""}
          </>
        )}
      </p>
      {needsOwn && dirty && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Turn on two-step for yourself first, so you can&apos;t lock yourself out.{" "}
          <Link href="/app/account/two-step" className="font-semibold underline">
            Set it up
          </Link>
        </p>
      )}
      {dirty && editable && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => (setChoice(p.mfa.policy), setRoleIds(p.mfa.roleIds), setGrace(String(p.mfa.graceDays)))}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={needsOwn || (choice === "roles" && !roleIds.length)}
            onClick={() =>
              propose({ ...p, mfa: { ...p.mfa, policy: choice, roleIds: choice === "roles" ? roleIds : [], graceDays: Number(grace) } }, [
                ["Who needs it", describe(p.mfa.policy, p.mfa.roleIds), describe(choice, roleIds)],
                ...(Number(grace) !== p.mfa.graceDays ? ([["Grace period", `${p.mfa.graceDays} days`, `${grace} days`]] as [string, string, string][]) : []),
              ])
            }
          >
            Save
          </Button>
        </div>
      )}
    </section>
  )
}

// ── Passwords ──

function PasswordPolicy({ policy, editable, propose }: { policy: SecurityPolicy; editable: boolean; propose: Propose }) {
  const p = policy.password
  const [open, setOpen] = React.useState(false)
  const [d, setD] = React.useState(p)
  const must = [p.requireNumber && "a number", p.requireSymbol && "a symbol"].filter(Boolean).join(" and ") || "a letter"
  const summary = (x: typeof p) => describePasswordPolicy(x)
  const expiry = (n: number) => (n ? `${n} days` : "Never")
  return (
    <section id="passwords" className={cn(card, "gap-2")}>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold">Passwords</h2>
        {editable && (
          <Button variant="outline" size="sm" onClick={() => (setD(p), setOpen(true))}>
            Edit
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className={k}>Minimum length</div>
          <div className="mt-0.5 text-[13px]">{p.minLength} characters</div>
        </div>
        <div>
          <div className={k}>Must include</div>
          <div className="mt-0.5 text-[13px]">{must}</div>
        </div>
        <div>
          <div className={k}>Common passwords</div>
          <div className="mt-0.5 text-[13px]">{p.blockCommon ? "Blocked" : "Allowed"}</div>
        </div>
        <div>
          <div className={k}>Expiry · reuse</div>
          <div className="mt-0.5 text-[13px]">
            {expiry(p.expiryDays)} · {p.reuseBlock ? `last ${p.reuseBlock} blocked` : "no check"}
          </div>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Password rules</DialogTitle>
            <DialogDescription>Apply when people set or change a password. Existing passwords keep working until they expire.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <Field label="Minimum length" hint="8–32 characters">
              <NativeSelect value={String(d.minLength)} onChange={(e) => setD({ ...d, minLength: Number(e.target.value) })}>
                {[8, 10, 12, 14, 16, 20, 24, 32].map((n) => (
                  <option key={n} value={n}>
                    {n} characters
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {(
              [
                ["requireNumber", "Must include a number"],
                ["requireSymbol", "Must include a symbol"],
                ["blockCommon", "Block common passwords"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between">
                {label}
                <Switch aria-label={label} checked={d[key]} onCheckedChange={(c) => setD({ ...d, [key]: c })} />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expires after">
                <NativeSelect value={String(d.expiryDays)} onChange={(e) => setD({ ...d, expiryDays: Number(e.target.value) as 0 | 90 | 180 })}>
                  <option value="0">Never</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                </NativeSelect>
              </Field>
              <Field label="Can't reuse">
                <NativeSelect value={String(d.reuseBlock)} onChange={(e) => setD({ ...d, reuseBlock: Number(e.target.value) as 0 | 3 | 5 })}>
                  <option value="0">No check</option>
                  <option value="3">Last 3</option>
                  <option value="5">Last 5</option>
                </NativeSelect>
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={JSON.stringify(d) === JSON.stringify(p)}
              onClick={() => {
                setOpen(false)
                propose({ ...policy, password: d }, [
                  ["Needs", summary(p), summary(d)],
                  ...(d.blockCommon !== p.blockCommon ? ([["Common passwords", p.blockCommon ? "Blocked" : "Allowed", d.blockCommon ? "Blocked" : "Allowed"]] as [string, string, string][]) : []),
                  ...(d.expiryDays !== p.expiryDays ? ([["Expiry", expiry(p.expiryDays), expiry(d.expiryDays)]] as [string, string, string][]) : []),
                  ...(d.reuseBlock !== p.reuseBlock ? ([["Reuse", p.reuseBlock ? `Last ${p.reuseBlock}` : "No check", d.reuseBlock ? `Last ${d.reuseBlock}` : "No check"]] as [string, string, string][]) : []),
                ])
              }}
            >
              Review change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── Sessions ──

function SessionPolicy({ policy, editable, propose }: { policy: SecurityPolicy; editable: boolean; propose: Propose }) {
  const s = policy.sessions
  const [open, setOpen] = React.useState(false)
  const [d, setD] = React.useState(s)
  return (
    <section id="sessions" className={cn(card, "gap-2")}>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold">Sessions</h2>
        {editable && (
          <Button variant="outline" size="sm" onClick={() => (setD(s), setOpen(true))}>
            Edit
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className={k}>Sign out after inactivity</div>
          <div className="mt-0.5 text-[13px]">{idleLabel(s.idleMinutes)}</div>
        </div>
        <div>
          <div className={k}>Longest session</div>
          <div className="mt-0.5 text-[13px]">
            {s.maxDays} day{s.maxDays === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sessions</DialogTitle>
            <DialogDescription>People who belong to several businesses get the strictest setting.</DialogDescription>
          </DialogHeader>
          <Field label="Sign out after inactivity">
            <NativeSelect value={String(d.idleMinutes)} onChange={(e) => setD({ ...d, idleMinutes: Number(e.target.value) as typeof d.idleMinutes })}>
              {IDLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Longest session" hint="Then everyone signs in again, even if active">
            <NativeSelect value={String(d.maxDays)} onChange={(e) => setD({ ...d, maxDays: Number(e.target.value) as typeof d.maxDays })}>
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={d.idleMinutes === s.idleMinutes && d.maxDays === s.maxDays}
              onClick={() => {
                setOpen(false)
                propose({ ...policy, sessions: d }, [
                  ...(d.idleMinutes !== s.idleMinutes ? ([["Inactivity sign-out", idleLabel(s.idleMinutes), idleLabel(d.idleMinutes)]] as [string, string, string][]) : []),
                  ...(d.maxDays !== s.maxDays ? ([["Longest session", `${s.maxDays} days`, `${d.maxDays} days`]] as [string, string, string][]) : []),
                ])
              }}
            >
              Review change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── Allowed networks ──

function NetworksPolicy({ data, editable, propose }: { data: SecurityData; editable: boolean; propose: Propose }) {
  const list = data.policy.ipAllowlist
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState(list.join("\n"))
  const entries = text.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)
  const errors = entries.map(cidrError).filter(Boolean)
  const excludesMe = entries.length > 0 && !ipAllowed(data.currentIp ?? undefined, entries)
  const [ack, setAck] = React.useState(false)
  const shown = (l: string[]) => (l.length ? l.join(", ") : "Anywhere")
  return (
    <section id="networks" className={cn(card, "gap-2")}>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold">Allowed networks</h2>
        {editable && (
          <Button variant="outline" size="sm" onClick={() => (setText(list.join("\n")), setAck(false), setOpen(true))}>
            Edit
          </Button>
        )}
      </div>
      <div className="text-[13px]">{list.length ? list.join(", ") : "Anywhere (no IP restriction)"}</div>
      <p className="text-xs text-muted-foreground">Your current IP: {data.currentIp ?? "unknown"} · a list that leaves it out shows a warning before saving.</p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Allowed networks</DialogTitle>
            <DialogDescription>Only these IPv4 addresses or ranges can use the business. Leave empty to allow anywhere.</DialogDescription>
          </DialogHeader>
          <Field label="One per line" error={errors[0]} hint="e.g. 49.36.112.0/24 for an office, or a single address">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="font-mono text-sm" />
          </Field>
          {excludesMe && !errors.length && (
            <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <input type="checkbox" className="mt-0.5 accent-primary" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              This list leaves out your current IP ({data.currentIp}). You&apos;ll lose access from here as soon as it&apos;s saved. I understand.
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!!errors.length || (excludesMe && !ack) || entries.join() === list.join()}
              onClick={() => {
                setOpen(false)
                propose({ ...data.policy, ipAllowlist: entries }, [["Allowed networks", shown(list), shown(entries)]], excludesMe)
              }}
            >
              Review change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── Active sessions across the team ──

function TeamSessions() {
  const { can } = useAuth()
  const { data, reload } = useApi<{ data: SessionRow[] }>("/tenant/sessions")
  const [busy, setBusy] = React.useState(false)
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(message)
      await reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const rows = data?.data
  return (
    <section id="active-sessions" className={cn(card, "gap-1.5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">Active sessions{rows ? ` · ${rows.length}` : ""}</h2>
        {can("tenant.member.edit") && (
          <Button variant="outline" size="sm" className="text-destructive" disabled={busy || !rows || rows.length < 2} onClick={() => run(() => api.post("/tenant/sessions/sign-out-others"), "Everyone else was signed out")}>
            Sign out everyone except me
          </Button>
        )}
      </div>
      {!rows ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-semibold">Person</th>
                <th className="px-2 py-1.5 font-semibold">Device</th>
                <th className="px-2 py-1.5 font-semibold">Where</th>
                <th className="px-2 py-1.5 font-semibold">Last active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.familyId} className="border-b border-border/60 last:border-0">
                  <td className="px-2 py-[7px]">{r.current ? <><strong>{r.userName}</strong> · this device</> : r.userName}</td>
                  <td className="px-2 py-[7px]">{r.device}</td>
                  <td className="px-2 py-[7px]">{r.ip ?? "—"}</td>
                  <td className="px-2 py-[7px]">{r.current ? "Now" : timeAgo(r.lastActiveAt)}</td>
                  <td className="px-2 py-[7px] text-right">
                    {!r.current && can("tenant.member.edit") && (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => api.delete(`/tenant/sessions/${r.familyId}`), `${r.userName} was signed out on ${r.device}`)}>
                        Sign out
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── Sign-in history ──

interface SignIn {
  id: string
  at: string
  person: string
  outcome: string
  label: string
  failed: boolean
  ip: string | null
  device: string
}

function SignInHistory() {
  const [failed, setFailed] = React.useState(false)
  const { data } = useApi<{ data: SignIn[] }>(`/tenant/sign-ins?days=30${failed ? "&failed=1" : ""}`)
  const [exporting, setExporting] = React.useState(false)
  const tone = (o: string) =>
    o === "success" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : ["locked", "mfa_locked", "expired_password"].includes(o) ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : o === "mfa_challenge" ? "bg-muted text-foreground/80" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
  const exportCsv = async () => {
    setExporting(true)
    try {
      const { downloadApiFile } = await import("@/lib/download")
      await downloadApiFile(`/tenant/sign-ins?days=90&format=csv${failed ? "&failed=1" : ""}`, "sign-in-history.csv")
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }
  return (
    <section id="sign-ins" className={cn(card, "gap-1.5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">Sign-in history</h2>
        <div className="flex gap-1.5">
          <Button variant={failed ? "default" : "outline"} size="sm" aria-pressed={failed} onClick={() => setFailed((f) => !f)}>
            Failed only
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </div>
      </div>
      {!data ? (
        <Skeleton className="h-24" />
      ) : !data.data.length ? (
        <p className="py-3 text-[13px] text-muted-foreground">{failed ? "No failed sign-ins in the last 30 days." : "No sign-ins recorded yet."}</p>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full min-w-[560px] text-xs">
            <tbody>
              {data.data.map((e) => (
                <tr key={e.id} className="border-b border-border/60 last:border-0">
                  <td className="px-2 py-[7px] whitespace-nowrap">{formatDateTime(e.at)}</td>
                  <td className="px-2 py-[7px]">{e.person}</td>
                  <td className="px-2 py-[7px]">
                    <span className={cn(pill, tone(e.outcome))}>{e.label}</span>
                  </td>
                  <td className="px-2 py-[7px] text-muted-foreground">
                    {e.ip ?? "—"} · {e.device}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
