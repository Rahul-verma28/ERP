"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { passwordStrength } from "@contracts/validation"
import { passwordPolicyError } from "@contracts/account"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, FormError } from "@/components/form"
import { OtpInput } from "@/components/onboarding"
import { ErrorState } from "@/components/page-states"
import { BackupCodes } from "@/components/backup-codes"
import { api, ApiError, errorMessage, setAccessToken } from "@/lib/api"
import { timeAgo, type AccountOverview, type SessionRow } from "@/lib/account"
import { useAuth } from "@/lib/auth"
import { formatDate, formatDateTime } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { useAccountBase } from "@/lib/account-base"
import { cn } from "@/lib/utils"

// My account › Security (wireframe A2): password, two-step verification, backup codes,
// where you're signed in and the last 30 days of sign-ins.

const card = "flex flex-col gap-2.5 rounded-xl border bg-card px-[18px] py-4"
const pill = "inline-flex h-5 items-center rounded-full px-[7px] text-[11px] font-semibold"

export default function SecurityPage() {
  const account = useApi<AccountOverview>("/account")
  const sessions = useApi<{ sessions: SessionRow[] }>("/account/sessions")
  const error = account.error ?? sessions.error
  if (error && !account.data) return <ErrorState error={error} onRetry={account.reload} />
  return (
    <div className="grid max-w-5xl content-start gap-3.5 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <h1 className="text-[22px] font-bold tracking-tight">Security</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Password, two-step verification and where you&apos;re signed in.</p>
      </div>
      {!account.data ? (
        <>
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </>
      ) : (
        <>
          <PasswordCard account={account.data} onChanged={sessions.reload} />
          <div className="flex flex-col gap-3.5">
            <TwoStepCard account={account.data} onChanged={account.reload} />
            {account.data.security.mfaEnabled && <BackupCodesCard account={account.data} onChanged={account.reload} />}
          </div>
          <SessionsCard rows={sessions.data?.sessions ?? null} reload={sessions.reload} />
          <SignInsCard />
        </>
      )}
    </div>
  )
}

// ── Change password ──

const STRENGTH_TONE = ["bg-muted", "bg-red-600", "bg-amber-600", "bg-amber-600", "bg-emerald-600"]

function PasswordCard({ account, onChanged }: { account: AccountOverview; onChanged: () => Promise<void> }) {
  const policy = account.security.passwordPolicy
  const [current, setCurrent] = React.useState("")
  const [next, setNext] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [signOutOthers, setSignOutOthers] = React.useState(true)
  const [errors, setErrors] = React.useState<Record<string, string | null>>({})
  const [busy, setBusy] = React.useState(false)
  const personal = [account.profile.name.split(" ")[0], account.profile.email.split("@")[0], account.profile.mobile.slice(-10)]
  const policyError = (pw: string) => {
    const e = passwordPolicyError(pw, policy, personal)
    // Say which business asks for a longer password
    return e && e.startsWith("Use at least") && account.security.passwordPolicySetBy && policy.minLength > 8 ? `${account.security.passwordPolicySetBy} needs ${account.security.passwordPolicyText}` : e
  }
  const strength = passwordStrength(next)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = {
      current: current ? null : "Enter your current password",
      password: !next ? "Enter a new password" : policyError(next),
      confirm: confirm !== next ? "Passwords don't match" : null,
    }
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    setBusy(true)
    try {
      const out = await api.post<{ signedOut: number }>("/account/password", { current, password: next, signOutOthers })
      setCurrent("")
      setNext("")
      setConfirm("")
      toast.success(out.signedOut ? `Password updated. ${out.signedOut} other session${out.signedOut === 1 ? "" : "s"} signed out.` : "Password updated.")
      await onChanged()
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors({ current: err.fields.current ?? null, password: err.fields.password ?? null })
      else setErrors({ form: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={card} onSubmit={submit} noValidate>
      <h2 className="text-[15px] font-bold">Change password</h2>
      <Field label="Current password" error={errors.current}>
        <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </Field>
      <Field label="New password" error={errors.password} hint={!errors.password ? `Needs ${account.security.passwordPolicyText}` : undefined}>
        <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} onBlur={() => next && setErrors((x) => ({ ...x, password: policyError(next) }))} autoComplete="new-password" />
      </Field>
      {next && (
        <div className="-mt-1 flex gap-1" aria-label={`Strength ${strength} of 4`}>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={cn("h-1 flex-1 rounded-full", i <= strength ? STRENGTH_TONE[strength] : "bg-muted")} />
          ))}
        </div>
      )}
      <Field label="Confirm new password" error={errors.confirm}>
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </Field>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" className="size-4 accent-primary" checked={signOutOthers} onChange={(e) => setSignOutOthers(e.target.checked)} />
        Sign out my other devices
      </label>
      {account.security.passwordChangedAt && <p className="text-xs text-muted-foreground">Last changed {formatDate(account.security.passwordChangedAt)}</p>}
      <FormError message={errors.form} />
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </div>
    </form>
  )
}

// ── Two-step verification ──

function TwoStepCard({ account, onChanged }: { account: AccountOverview; onChanged: () => Promise<void> }) {
  const base = useAccountBase()
  const s = account.security
  const required = s.requiredBy.length > 0
  const [off, setOff] = React.useState(false)
  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold">Two-step verification</h2>
        {s.mfaEnabled ? (
          <span className={cn(pill, "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300")}>On · authenticator app</span>
        ) : (
          <span className={cn(pill, "bg-muted text-muted-foreground")}>Off</span>
        )}
      </div>
      <p className="text-[13px] text-foreground/80">
        {s.mfaEnabled ? "Asked when you sign in on a new device." : "Adds a code from your phone when you sign in on a new device."}{" "}
        {required && `Required by ${s.requiredBy.map((r) => r.name).join(", ")}${s.requiredBy.some((r) => r.tenantId) ? "" : ""}.`}
        {!s.mfaEnabled && s.deadline && <strong> Set it up by {formatDate(s.deadline)}.</strong>}
      </p>
      <div className="flex flex-wrap gap-2">
        {s.mfaEnabled ? (
          <>
            <Link href={`${base.account}/two-step?change=1`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Change app
            </Link>
            <Button variant="outline" size="sm" disabled={required} title={required ? `${s.requiredBy[0].name} requires it` : undefined} onClick={() => setOff(true)}>
              Turn off
            </Button>
          </>
        ) : (
          <Link href={`${base.account}/two-step`} className={buttonVariants({ size: "sm" })}>
            Turn on
          </Link>
        )}
      </div>
      {s.mfaEnabled && required && <p className="text-xs text-muted-foreground">Turn off is disabled while one of your businesses requires two-step.</p>}
      <TurnOffDialog open={off} onClose={() => setOff(false)} onDone={onChanged} />
    </section>
  )
}

function TurnOffDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [password, setPassword] = React.useState("")
  const [code, setCode] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string | null>>({})
  const [busy, setBusy] = React.useState(false)
  const submit = async () => {
    const e = { password: password ? null : "Enter your password", code: /^\d{6}$/.test(code) ? null : "Enter the 6-digit code" }
    setErrors(e)
    if (e.password || e.code) return
    setBusy(true)
    try {
      await api.post("/account/mfa/disable", { password, code })
      toast.success("Two-step verification is off")
      onClose()
      await onDone()
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors({ password: err.fields.password ?? null, code: err.fields.code ?? null })
      else setErrors({ form: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Turn off two-step verification?</DialogTitle>
          <DialogDescription>Your account will be protected by your password only. Trusted devices and backup codes stop working.</DialogDescription>
        </DialogHeader>
        <Field label="Password" error={errors.password}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        </Field>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Code from your app</span>
          <OtpInput size="sm" value={code} onChange={setCode} invalid={!!errors.code} autoFocus={false} />
          {errors.code && <p className="text-xs text-destructive">{errors.code}</p>}
        </div>
        <FormError message={errors.form} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it on
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? "Turning off…" : "Turn off"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BackupCodesCard({ account, onChanged }: { account: AccountOverview; onChanged: () => Promise<void> }) {
  const left = account.security.backupCodesLeft
  const [asking, setAsking] = React.useState(false)
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [codes, setCodes] = React.useState<string[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  const make = async () => {
    if (!password) return setError("Enter your password")
    setBusy(true)
    try {
      const out = await api.post<{ backupCodes: string[] }>("/account/mfa/backup-codes", { password })
      setCodes(out.backupCodes)
      setPassword("")
      setError(null)
      await onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields.password ?? e.message) : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={cn(card, "gap-2")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold">Backup codes</h2>
        <span className={cn("text-xs font-semibold", left <= 3 ? "text-amber-700" : "text-muted-foreground")}>{left} of 10 left</span>
      </div>
      <p className="text-[13px] text-foreground/80">Use one if you lose your phone. Each works once.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
          Make new codes
        </Button>
        <span className="text-xs text-muted-foreground">Old codes stop working</span>
      </div>
      <Dialog
        open={asking}
        onOpenChange={(o) => {
          if (!o) {
            setAsking(false)
            setCodes(null)
            setError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{codes ? "Your new backup codes" : "Make new backup codes"}</DialogTitle>
            <DialogDescription>{codes ? "Save them now — they won't be shown again. Your old codes no longer work." : "Enter your password. Your current codes will stop working."}</DialogDescription>
          </DialogHeader>
          {codes ? (
            <BackupCodes codes={codes} />
          ) : (
            <Field label="Password" error={error}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && make()} autoComplete="current-password" autoFocus />
            </Field>
          )}
          <DialogFooter>
            {codes ? (
              <Button onClick={() => (setAsking(false), setCodes(null))}>Done</Button>
            ) : (
              <Button onClick={make} disabled={busy}>
                {busy ? "Making…" : "Make new codes"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── Where you're signed in ──

function SessionsCard({ rows, reload }: { rows: SessionRow[] | null; reload: () => Promise<void> }) {
  const router = useRouter()
  const { signOut } = useAuth()
  const [notMe, setNotMe] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)
  const act = async (id: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(id)
    try {
      await fn()
      toast.success(message)
      await reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  const others = rows?.filter((r) => !r.current).length ?? 0
  return (
    <section className={cn(card, "gap-1.5 lg:col-span-2")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">Where you&apos;re signed in</h2>
        <Button variant="outline" size="sm" className="text-destructive" disabled={!others || busy !== null} onClick={() => act("all", () => api.post("/account/sessions/sign-out-others"), "Signed out of all other devices")}>
          Sign out all other devices
        </Button>
      </div>
      {!rows ? (
        <Skeleton className="h-28" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <tbody>
              {rows.map((r) => (
                <tr key={r.familyId} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3">
                    <strong>{r.device}</strong>{" "}
                    {r.current && <span className={cn(pill, "bg-accent text-accent-foreground")}>This device</span>}
                    {!r.current && r.trusted && <span className={cn(pill, "bg-muted text-foreground/80")}>Trusted 30 days</span>}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{r.ip ?? "—"}</td>
                  <td className="py-2 pr-3" title={`Signed in ${formatDateTime(r.signedInAt)}`}>
                    {r.current ? "Active now" : timeAgo(r.lastActiveAt)}
                  </td>
                  <td className="py-2 text-right">
                    {!r.current && (
                      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => act(r.familyId, () => api.delete(`/account/sessions/${r.familyId}`), `Signed out ${r.device}`)}>
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
      <p className="text-xs text-muted-foreground">
        Don&apos;t recognise one?{" "}
        <button type="button" className="font-semibold text-destructive hover:underline" onClick={() => setNotMe(true)}>
          This wasn&apos;t me
        </button>{" "}
        signs out everywhere and asks you to change your password.
      </p>
      <Dialog open={notMe} onOpenChange={setNotMe}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Secure your account?</DialogTitle>
            <DialogDescription>We&apos;ll sign you out on every device, including this one, and forget trusted devices. Then reset your password with a code.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotMe(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={async () => {
                setBusy("not-me")
                try {
                  await api.post("/account/sessions/not-me")
                  setAccessToken(null)
                  await signOut().catch(() => undefined)
                  router.replace("/forgot-password?reason=not-me")
                } catch (e) {
                  toast.error(errorMessage(e))
                  setBusy(null)
                }
              }}
            >
              Sign out everywhere
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

const OUTCOME: Record<string, { label: string; tone: string }> = {
  success: { label: "Signed in", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  wrong_password: { label: "Wrong password", tone: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
  locked: { label: "Locked 15 min", tone: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  mfa_challenge: { label: "Two-step asked", tone: "bg-muted text-foreground/80" },
  mfa_failed: { label: "Wrong two-step code", tone: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
  mfa_locked: { label: "Two-step locked", tone: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  expired_password: { label: "Password expired", tone: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
}

function SignInsCard() {
  const { data } = useApi<{ events: { id: string; at: string; outcome: string; method: string | null; ip: string | null; device: string }[] }>("/account/sign-ins")
  return (
    <section className={cn(card, "gap-1.5 lg:col-span-2")}>
      <h2 className="text-[15px] font-bold">Sign-in history · last 30 days</h2>
      {!data ? (
        <Skeleton className="h-24" />
      ) : !data.events.length ? (
        <p className="text-[13px] text-muted-foreground">No sign-ins recorded yet.</p>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full min-w-[520px] text-xs">
            <tbody>
              {data.events.map((e) => {
                const o = OUTCOME[e.outcome] ?? { label: e.outcome, tone: "bg-muted" }
                const twoStep = e.outcome === "success" && /\+(app|backup_code)$/.test(e.method ?? "")
                return (
                  <tr key={e.id} className="border-b border-border/60 last:border-0">
                    <td className="py-[7px] pr-3 whitespace-nowrap">{formatDateTime(e.at)}</td>
                    <td className="py-[7px] pr-3">
                      <span className={cn(pill, o.tone)}>
                        {o.label}
                        {twoStep ? " · two-step" : ""}
                      </span>
                    </td>
                    <td className="py-[7px] text-muted-foreground">
                      {e.ip ?? "—"} · {e.device}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
