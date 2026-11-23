"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, KeyRound, Loader2, Mail, ShieldCheck, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IconInput, PasswordInput } from "@/components/ui/input-group"
import { Field, FormError } from "@/components/form"
import { OtpInput } from "@/components/onboarding"
import { AuthTitle } from "@/components/auth/auth-shell"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { Me } from "@/lib/types"
import { cn } from "@/lib/utils"
import { email as emailRule, mobileIN } from "@contracts/validation"
import { passwordPolicyError, type SecurityPolicy } from "@contracts/account"

/** What /auth/login (and the steps after it) can answer */
type LoginStep =
  | { accessToken: string }
  | { mfaRequired: true; mfaToken: string; email: string }
  | { passwordExpired: true; changeToken: string; policy: SecurityPolicy["password"]; policyText: string }

/** Page after sign-in: ?next=, else the person's start page (My account › Working preferences) */
function landing(me: Me) {
  // Vendors and partners have no business of their own: their panel is the Console
  if (me.workspace === "console" || (!me.tenant && me.console)) return "/console"
  const start = me.user.preferences?.startPage
  return start && start !== "dashboard" && me.modules?.[start as keyof NonNullable<Me["modules"]>] ? `/app/m/${start}` : "/app"
}

/** ?next=/signup?mode=business — only same-site paths, never another origin */
function nextPath() {
  const n = new URLSearchParams(window.location.search).get("next")
  return n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : null
}

/** Email or a 10-digit Indian mobile */
const identifierError = (v: string) => {
  const t = v.trim()
  if (!t) return "Enter your email or mobile number"
  return t.includes("@") ? emailRule(t) : /^[+\d\s-]+$/.test(t) ? mobileIN(t) : "Enter a valid email or 10-digit mobile number"
}

function Spinner() {
  return <Loader2 className="animate-spin" />
}

/** Two choices side by side: Password or Mobile OTP */
function MethodSwitch({ value, onChange }: { value: "password" | "otp"; onChange: (v: "password" | "otp") => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/60 p-1" role="tablist" aria-label="Sign in with">
      {([["password", "Password", KeyRound], ["otp", "Mobile OTP", Smartphone]] as const).map(([k, label, Icon]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={cn("flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors", value === k && "bg-background text-foreground shadow-sm")}>
          <Icon className="size-4" /> {label}
        </button>
      ))}
    </div>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const { signIn, status, me } = useAuth()
  const [method, setMethod] = React.useState<"password" | "otp">("password")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [touched, setTouched] = React.useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = React.useState(false)

  // password
  const [identifier, setIdentifier] = React.useState("")
  const [password, setPassword] = React.useState("")
  // OTP
  const [mobile, setMobile] = React.useState("")
  const [otp, setOtp] = React.useState("")
  const [otpSent, setOtpSent] = React.useState(false)
  const [wait, setWait] = React.useState(0)

  // After the password: two-step code, backup code, lost phone, or an expired password (wireframe A4)
  const [stage, setStage] = React.useState<"credentials" | "mfa" | "backup" | "lost" | "expired">("credentials")
  const [challenge, setChallenge] = React.useState<Extract<LoginStep, { mfaRequired: true }> | null>(null)
  const [expired, setExpired] = React.useState<Extract<LoginStep, { passwordExpired: true }> | null>(null)

  React.useEffect(() => {
    if (status === "authenticated" && me) router.replace(nextPath() ?? landing(me))
  }, [status, me, router])
  React.useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const show = (k: string) => submitted || touched[k]
  const errs = {
    identifier: identifierError(identifier),
    password: password ? null : "Enter your password",
    mobile: mobileIN(mobile),
    otp: /^\d{6}$/.test(otp) ? null : "Enter the 6-digit code",
  }
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }))

  async function finish(accessToken: string) {
    const signedIn = await signIn(accessToken)
    router.replace(nextPath() ?? landing(signedIn))
  }

  /** Continue with whatever the API asks for next */
  async function proceed(step: LoginStep) {
    if ("accessToken" in step) return finish(step.accessToken)
    setError(null)
    if ("mfaRequired" in step) {
      setChallenge(step)
      setStage("mfa")
    } else {
      setExpired(step)
      setStage("expired")
    }
  }

  async function onPassword(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (errs.identifier || errs.password) return
    setBusy(true)
    setError(null)
    try {
      await proceed(await api.post<LoginStep>("/auth/login", { identifier: identifier.trim(), password }))
    } catch (err) {
      const left = err instanceof ApiError ? (err.details?.attemptsLeft as number | undefined) : undefined
      setError(left !== undefined && left <= 2 ? `${errorMessage(err)} ${left} attempt${left === 1 ? "" : "s"} left before sign-in is locked for 15 minutes.` : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function sendOtp() {
    setSubmitted(true)
    if (errs.mobile) return
    setBusy(true)
    setError(null)
    try {
      await api.post("/auth/otp/send", { target: mobile, purpose: "login" })
      setOtpSent(true)
      setWait(30)
      setSubmitted(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onOtp(e?: React.FormEvent, code = otp) {
    e?.preventDefault()
    if (!otpSent) return sendOtp()
    setSubmitted(true)
    if (!/^\d{6}$/.test(code)) return
    setBusy(true)
    setError(null)
    try {
      await proceed(await api.post<LoginStep>("/auth/login", { mobile, otp: code }))
    } catch (err) {
      setOtp("")
      setError(err instanceof ApiError && err.code === "INVALID_CREDENTIALS" ? "Incorrect mobile number or code." : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const switchMethod = (m: "password" | "otp") => {
    setMethod(m)
    setError(null)
    setSubmitted(false)
    setTouched({})
  }
  const back = () => {
    setStage("credentials")
    setChallenge(null)
    setExpired(null)
    setError(null)
  }
  if ((stage === "mfa" || stage === "backup" || stage === "lost") && challenge) {
    return <TwoStepChallenge stage={stage} setStage={setStage} challenge={challenge} onDone={proceed} onBack={back} />
  }
  if (stage === "expired" && expired) return <ExpiredPassword step={expired} onDone={proceed} onBack={back} />

  return (
    <>
      <AuthTitle title="Welcome back" subtitle="Sign in to your AHEAD account to continue." />
      <div className="grid gap-5">
        <MethodSwitch value={method} onChange={switchMethod} />

        {method === "password" ? (
          <form onSubmit={onPassword} className="grid gap-4" noValidate>
            <Field label="Email or mobile" error={show("identifier") ? errs.identifier : null}>
              <IconInput icon={Mail} autoComplete="username" autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} onBlur={blur("identifier")} placeholder="you@business.com or 98XXXXXXXX" />
            </Field>
            <div className="grid gap-1.5">
              <Field label="Password" error={show("password") ? errs.password : null}>
                <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onBlur={blur("password")} placeholder="Your password" />
              </Field>
              <Link href={`/forgot-password${identifier.trim() ? `?for=${encodeURIComponent(identifier.trim())}` : ""}`} className="justify-self-end text-xs font-medium text-primary hover:underline">Forgot password?</Link>
            </div>
            <FormError message={error} />
            <Button type="submit" size="lg" className="h-11 w-full shadow-[0_8px_20px_-8px] shadow-primary/60" disabled={busy}>{busy && <Spinner />} {busy ? "Signing in…" : "Sign in"}</Button>
          </form>
        ) : (
          <form onSubmit={(e) => void onOtp(e)} className="grid gap-4" noValidate>
            <Field label="Mobile number" error={show("mobile") ? errs.mobile : null} hint={otpSent ? undefined : "We'll send a 6-digit code by SMS."}>
              <IconInput icon={Smartphone} mask="mobile" autoComplete="tel" autoFocus value={mobile} onChange={(e) => setMobile(e.target.value)} onBlur={blur("mobile")} disabled={otpSent} placeholder="98XXXXXXXX" />
            </Field>
            {otpSent && (
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">6-digit code</span>
                  <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => { setOtpSent(false); setOtp("")}}>Change number</button>
                </div>
                <OtpInput size="md" value={otp} onChange={setOtp} onComplete={(c) => void onOtp(undefined, c)} invalid={submitted && !!errs.otp} disabled={busy} />
                <p className="text-xs text-muted-foreground">
                  {wait > 0 ? `Send again in ${wait}s` : <button type="button" className="font-medium text-primary hover:underline" onClick={() => void sendOtp()}>Send the code again</button>}
                </p>
              </div>
            )}
            <FormError message={error} />
            <Button type="submit" size="lg" className="h-11 w-full shadow-[0_8px_20px_-8px] shadow-primary/60" disabled={busy}>{busy && <Spinner />} {busy ? "Please wait…" : otpSent ? "Sign in" : "Send code"}</Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          New to AHEAD?{" "}
          <Link href="/signup" className="font-semibold text-primary hover:underline">Start a free trial</Link>
        </p>
      </div>
    </>
  )
}

function TwoStepChallenge({
  stage,
  setStage,
  challenge,
  onDone,
  onBack,
}: {
  stage: "mfa" | "backup" | "lost"
  setStage: (s: "mfa" | "backup" | "lost") => void
  challenge: { mfaToken: string; email: string }
  onDone: (step: LoginStep) => Promise<void>
  onBack: () => void
}) {
  const [code, setCode] = React.useState("")
  const [backup, setBackup] = React.useState("")
  const [trust, setTrust] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const verify = async (body: { code?: string; backupCode?: string }) => {
    setBusy(true)
    setError(null)
    try {
      const out = await api.post<{ accessToken: string; backupCodesLeft?: number }>("/auth/mfa/verify", { mfaToken: challenge.mfaToken, trustDevice: trust, ...body })
      if (out.backupCodesLeft !== undefined) {
        toast(out.backupCodesLeft <= 3 ? `${out.backupCodesLeft} backup codes left — make new ones in My account › Security.` : `${out.backupCodesLeft} backup codes left.`)
      }
      await onDone(out)
    } catch (err) {
      setCode("")
      if (err instanceof ApiError && err.code === "OTP_TOKEN_INVALID") setError("This sign-in took too long. Go back and sign in again.")
      else {
        const left = err instanceof ApiError ? (err.details?.attemptsLeft as number | undefined) : undefined
        setError(`${errorMessage(err)}${left !== undefined && left <= 2 ? ` ${left} more wrong code${left === 1 ? "" : "s"} locks sign-in for 15 minutes.` : ""}`)
      }
    } finally {
      setBusy(false)
    }
  }
  const trustBox = (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-primary" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
      Trust this device for 30 days
    </label>
  )

  if (stage === "lost") {
    return (
      <>
        <AuthTitle icon={<ShieldCheck className="size-6" />} title="Ask your admin" subtitle="Lost your phone and your backup codes?" />
        <div className="grid gap-4 text-sm leading-relaxed">
          <p>An Owner or Admin of your business can reset two-step for you from <strong>Users</strong>. You&apos;ll set it up again at your next sign-in.</p>
          <p className="text-xs text-muted-foreground">The reset is in the audit log and emailed to you. AHEAD support can&apos;t reset it.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStage("mfa")}><ArrowLeft /> Back</Button>
            <Button variant="ghost" onClick={() => setStage("backup")}>Use a backup code</Button>
          </div>
        </div>
      </>
    )
  }

  if (stage === "backup") {
    return (
      <>
        <AuthTitle icon={<KeyRound className="size-6" />} title="Use a backup code" subtitle="One of the 10 codes you saved when you turned on two-step." />
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(backup.trim())) return setError("Backup codes look like 7KQ2-9MZD")
            void verify({ backupCode: backup.trim() })
          }}
        >
          <Field label="Backup code" error={error} hint="Each code works once.">
            <Input value={backup} onChange={(e) => { setBackup(e.target.value.toUpperCase()); setError(null) }} className="h-11 text-center font-mono text-lg tracking-[0.2em] uppercase" autoComplete="one-time-code" maxLength={9} autoFocus spellCheck={false} placeholder="XXXX-XXXX" />
          </Field>
          {trustBox}
          <Button type="submit" size="lg" className="h-11 w-full" disabled={busy}>{busy && <Spinner />} {busy ? "Checking…" : "Sign in"}</Button>
          <button type="button" className="text-center text-sm font-medium text-primary hover:underline" onClick={() => (setError(null), setStage("mfa"))}>Use the app code instead</button>
        </form>
      </>
    )
  }

  return (
    <>
      <AuthTitle icon={<ShieldCheck className="size-6" />} title="Two-step verification" subtitle={<>Enter the 6-digit code from your authenticator app for <strong className="text-foreground">{challenge.email}</strong>.</>} />
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code")
          void verify({ code })
        }}
      >
        <OtpInput size="md" value={code} onChange={setCode} onComplete={(c) => void verify({ code: c })} invalid={!!error} disabled={busy} />
        {trustBox}
        <FormError message={error} />
        <Button type="submit" size="lg" className="h-11 w-full" disabled={busy}>{busy && <Spinner />} {busy ? "Checking…" : "Verify"}</Button>
        <p className="text-center text-sm">
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => (setError(null), setStage("backup"))}>Use a backup code</button>
          <span className="mx-2 text-muted-foreground">·</span>
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => setStage("lost")}>Lost your phone?</button>
        </p>
        <p className="text-center text-xs text-muted-foreground">After 5 wrong codes, sign-in is locked for 15 minutes.</p>
        <button type="button" className="inline-flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={onBack}><ArrowLeft className="size-3.5" /> Sign in as someone else</button>
      </form>
    </>
  )
}

function ExpiredPassword({ step, onDone, onBack }: { step: { changeToken: string; policy: SecurityPolicy["password"]; policyText: string }; onDone: (s: LoginStep) => Promise<void>; onBack: () => void }) {
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string | null>>({})
  const [busy, setBusy] = React.useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = { password: passwordPolicyError(password, step.policy), confirm: !confirm ? "Type the new password again" : confirm !== password ? "Passwords don't match" : null }
    setErrors(errs)
    if (errs.password || errs.confirm) return
    setBusy(true)
    try {
      await onDone(await api.post<LoginStep>("/auth/password/expired", { changeToken: step.changeToken, password }))
    } catch (err) {
      setErrors(err instanceof ApiError && err.fields.password ? { password: err.fields.password } : { form: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <AuthTitle icon={<KeyRound className="size-6" />} title="Time for a new password" subtitle={`Your business asks everyone to change their password regularly. Use ${step.policyText}.`} />
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Field label="New password" error={errors.password}>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        <FormError message={errors.form} />
        <Button type="submit" size="lg" className="h-11 w-full" disabled={busy}>{busy && <Spinner />} {busy ? "Saving…" : "Save and sign in"}</Button>
        <button type="button" className="inline-flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={onBack}><ArrowLeft className="size-3.5" /> Back to sign in</button>
      </form>
    </>
  )
}
