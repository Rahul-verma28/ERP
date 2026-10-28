"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Field, FormError } from "@/components/form"
import { OtpInput } from "@/components/onboarding"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { Me } from "@/lib/types"
import { passwordPolicyError, type SecurityPolicy } from "@contracts/account"
import { toast } from "sonner"

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

export default function LoginPage() {
  const router = useRouter()
  const { signIn, status, me } = useAuth()
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  // password tab
  const [identifier, setIdentifier] = React.useState("")
  const [password, setPassword] = React.useState("")
  // OTP tab
  const [mobile, setMobile] = React.useState("")
  const [otp, setOtp] = React.useState("")
  const [otpSent, setOtpSent] = React.useState(false)
  const [devCode, setDevCode] = React.useState<string | undefined>()

  // After the password: two-step code, backup code, lost phone, or an expired password (wireframe A4)
  const [stage, setStage] = React.useState<"credentials" | "mfa" | "backup" | "lost" | "expired">("credentials")
  const [challenge, setChallenge] = React.useState<Extract<LoginStep, { mfaRequired: true }> | null>(null)
  const [expired, setExpired] = React.useState<Extract<LoginStep, { passwordExpired: true }> | null>(null)

  React.useEffect(() => {
    if (status === "authenticated" && me) router.replace(nextPath() ?? landing(me))
  }, [status, me, router])

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
    setBusy(true)
    setError(null)
    try {
      await proceed(await api.post<LoginStep>("/auth/login", { identifier, password }))
    } catch (err) {
      const left = err instanceof ApiError ? (err.details?.attemptsLeft as number | undefined) : undefined
      setError(left !== undefined && left <= 2 ? `${errorMessage(err)} ${left} attempt${left === 1 ? "" : "s"} left before sign-in is locked for 15 minutes.` : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function sendOtp() {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ devCode?: string }>("/auth/otp/send", { target: mobile, purpose: "login" })
      setOtpSent(true)
      setDevCode(r.devCode)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onOtp(e: React.FormEvent) {
    e.preventDefault()
    if (!otpSent) return sendOtp()
    setBusy(true)
    setError(null)
    try {
      await proceed(await api.post<LoginStep>("/auth/login", { mobile, otp }))
    } catch (err) {
      setError(err instanceof ApiError && err.code === "INVALID_CREDENTIALS" ? "Incorrect mobile number or code." : errorMessage(err))
    } finally {
      setBusy(false)
    }
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
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Welcome back. Sign in to your business account.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Tabs defaultValue="password" onValueChange={() => setError(null)}>
          <TabsList className="w-full">
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="otp">Mobile OTP</TabsTrigger>
          </TabsList>

          <TabsContent value="password">
            <form onSubmit={onPassword} className="grid gap-4 pt-4">
              <Field label="Email or mobile">
                <Input autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
              </Field>
              <Field label="Password">
                <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              <div className="-mt-2 text-right">
                <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
                  Forgot password?
                </Link>
              </div>
              <FormError message={error} />
              <Button type="submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="otp">
            <form onSubmit={onOtp} className="grid gap-4 pt-4">
              <Field label="Mobile number">
                <Input inputMode="tel" autoComplete="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} disabled={otpSent} required />
              </Field>
              {otpSent && (
                <Field label="6-digit code" hint={devCode ? `Development code: ${devCode}` : "Sent by SMS"}>
                  <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} required />
                </Field>
              )}
              <FormError message={error} />
              <Button type="submit" disabled={busy}>
                {busy ? "Please wait…" : otpSent ? "Sign in" : "Send code"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <p className="text-center text-sm text-muted-foreground">
          New to AHEAD?{" "}
          <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
            Start a free trial
          </Link>
        </p>
      </CardContent>
    </Card>
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

  if (stage === "lost") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Ask your admin</CardTitle>
          <CardDescription>Lost your phone and your backup codes?</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm leading-relaxed">
          <p>
            An Owner or Admin of your business can reset two-step for you from <strong>Settings › Team</strong>. You&apos;ll set it up again at your next sign-in.
          </p>
          <p className="text-xs text-muted-foreground">The reset is in the audit log and emailed to you. AHEAD support can&apos;t reset it.</p>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={() => setStage("mfa")}>
              Back
            </Button>
            <Button variant="ghost" onClick={() => setStage("backup")}>
              Use a backup code
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (stage === "backup") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Use a backup code</CardTitle>
          <CardDescription>One of the 10 codes you saved when you turned on two-step.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(backup.trim())) return setError("Backup codes look like 7KQ2-9MZD")
              void verify({ backupCode: backup.trim() })
            }}
          >
            <Field label="Backup code" error={error} hint="Each code works once.">
              <Input value={backup} onChange={(e) => setBackup(e.target.value.toUpperCase())} className="font-mono uppercase" autoComplete="one-time-code" maxLength={9} autoFocus spellCheck={false} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
              Trust this device for 30 days
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? "Checking…" : "Sign in"}
            </Button>
            <p className="text-center text-xs">
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => (setError(null), setStage("mfa"))}>
                Use the app code instead
              </button>
            </p>
          </form>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Two-step verification</CardTitle>
        <CardDescription>
          Enter the 6-digit code from your authenticator app for <strong className="text-foreground">{challenge.email}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code")
            void verify({ code })
          }}
        >
          <OtpInput size="md" value={code} onChange={setCode} onComplete={(c) => void verify({ code: c })} invalid={!!error} disabled={busy} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
            Trust this device for 30 days
          </label>
          <FormError message={error} />
          <Button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Verify"}
          </Button>
          <p className="text-xs">
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => (setError(null), setStage("backup"))}>
              Use a backup code instead
            </button>{" "}
            ·{" "}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setStage("lost")}>
              Lost your phone?
            </button>
          </p>
          <p className="text-xs text-muted-foreground">After 5 wrong codes, sign-in is locked for 15 minutes.</p>
          <button type="button" className="justify-self-start text-xs text-muted-foreground hover:text-foreground" onClick={onBack}>
            ← Sign in as someone else
          </button>
        </form>
      </CardContent>
    </Card>
  )
}

function ExpiredPassword({ step, onDone, onBack }: { step: { changeToken: string; policy: SecurityPolicy["password"]; policyText: string }; onDone: (s: LoginStep) => Promise<void>; onBack: () => void }) {
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string | null>>({})
  const [busy, setBusy] = React.useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = { password: passwordPolicyError(password, step.policy), confirm: confirm !== password ? "Passwords don't match" : null }
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
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Time for a new password</CardTitle>
        <CardDescription>Your business asks everyone to change their password regularly. Use {step.policyText}.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <Field label="New password" error={errors.password}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />
          </Field>
          <Field label="Confirm new password" error={errors.confirm}>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          <FormError message={errors.form} />
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save and sign in"}
          </Button>
          <button type="button" className="justify-self-start text-xs text-muted-foreground hover:text-foreground" onClick={onBack}>
            ← Back to sign in
          </button>
        </form>
      </CardContent>
    </Card>
  )
}
