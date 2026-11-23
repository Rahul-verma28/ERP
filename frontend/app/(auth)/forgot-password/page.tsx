"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, Mail, MailCheck, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconInput, PasswordInput, PasswordStrength, passwordChecks } from "@/components/ui/input-group"
import { Field, FormError } from "@/components/form"
import { OtpInput } from "@/components/onboarding"
import { AuthTitle } from "@/components/auth/auth-shell"
import { api, ApiError, errorMessage } from "@/lib/api"
import { email as emailRule, mobileIN, password as passwordRule } from "@contracts/validation"

// Forgot password, one step at a time: who you are (a code goes out only if that account exists),
// the 6-digit code (checked on its own), then the new password twice. The code can be sent again
// after 30 s; the password step has 10 minutes before the code must be asked for again.

type Step = "who" | "code" | "password"

const targetError = (v: string) => {
  const t = v.trim()
  if (!t) return "Enter your email or mobile number"
  return t.includes("@") ? emailRule(t) : /^[+\d\s-]+$/.test(t) ? mobileIN(t) : "Enter a valid email or 10-digit mobile number"
}

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [step, setStep] = React.useState<Step>("who")
  const [target, setTarget] = React.useState("")
  const [targetErr, setTargetErr] = React.useState<string | null>(null)
  const [code, setCode] = React.useState("")
  const [resetToken, setResetToken] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [wait, setWait] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [submitted, setSubmitted] = React.useState(false)
  const [touched, setTouched] = React.useState<Record<string, boolean>>({})

  // Coming from sign-in with the email already typed
  React.useEffect(() => {
    const given = new URLSearchParams(window.location.search).get("for")
    if (given) Promise.resolve().then(() => setTarget(given))
  }, [])
  React.useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const errs = {
    target: targetErr ?? targetError(target),
    code: /^\d{6}$/.test(code) ? null : "Enter the 6-digit code",
    password: password ? passwordRule(password) : "Choose a new password",
    confirm: !confirm ? "Type the new password again" : confirm !== password ? "Passwords don't match" : null,
  }
  const show = (k: keyof typeof errs) => (submitted || touched[k] ? errs[k] : null)
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }))
  const isEmail = target.trim().includes("@")
  const goTo = (s: Step) => {
    setStep(s)
    setSubmitted(false)
    setTouched({})
    setError(null)
  }

  async function send(again = false) {
    setSubmitted(true)
    if (targetError(target)) return
    setBusy(true)
    setError(null)
    try {
      await api.post("/auth/otp/send", { target: target.trim(), purpose: "reset" })
      setWait(30)
      setCode("")
      if (again) toast.success(isEmail ? "A new code is on its way to your email." : "A new code is on its way by SMS.")
      else goTo("code")
    } catch (err) {
      // No account with that email or mobile: said beside the field, nothing is sent
      if (err instanceof ApiError && err.fields.target) {
        setTargetErr(err.message)
        if (again) goTo("who")
      } else setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function verify(value = code) {
    setSubmitted(true)
    if (!/^\d{6}$/.test(value)) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ resetToken: string }>("/auth/password/reset/verify", { target: target.trim(), code: value })
      setResetToken(r.resetToken)
      goTo("password")
    } catch (err) {
      setCode("")
      const left = err instanceof ApiError ? (err.details as { attemptsLeft?: number } | undefined)?.attemptsLeft : undefined
      setError(left != null && left > 0 ? `${errorMessage(err)} ${left} ${left === 1 ? "try" : "tries"} left.` : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    setSubmitted(true)
    if (errs.password || errs.confirm) return
    setBusy(true)
    setError(null)
    try {
      await api.post("/auth/password/reset", { resetToken, password })
      toast.success("Password changed. Sign in with the new one.")
      router.replace(`/login${isEmail ? `?for=${encodeURIComponent(target.trim())}` : ""}`)
    } catch (err) {
      // Ran out (10 minutes) or already used: back to the code
      if (err instanceof ApiError && err.code === "OTP_TOKEN_INVALID") {
        setResetToken("")
        setCode("")
        goTo("code")
        setWait(0)
      }
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const back = (
    <Link href="/login" className="inline-flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" /> Back to sign in
    </Link>
  )
  const submitClass = "h-11 w-full shadow-[0_8px_20px_-8px] shadow-primary/60"

  if (step === "who") {
    return (
      <>
        <AuthTitle icon={<KeyRound className="size-6" />} title="Forgot your password?" subtitle="Enter the email or mobile on your account. We'll send a 6-digit code to set a new password." />
        <form onSubmit={(e) => { e.preventDefault(); void send() }} className="grid gap-4" noValidate>
          <Field label="Email or mobile" error={show("target")}>
            <IconInput icon={Mail} autoComplete="username" autoFocus value={target} onChange={(e) => { setTarget(e.target.value); setTargetErr(null) }} onBlur={blur("target")} placeholder="you@business.com or 98XXXXXXXX" aria-invalid={!!show("target")} />
          </Field>
          {targetErr && (
            <p className="-mt-2 text-xs text-muted-foreground">
              New here?{" "}
              <Link href="/signup" className="font-medium text-primary hover:underline">
                Create an account
              </Link>
            </p>
          )}
          <FormError message={error} />
          <Button type="submit" size="lg" className={submitClass} disabled={busy}>{busy && <Loader2 className="animate-spin" />} {busy ? "Sending…" : "Send code"}</Button>
          {back}
        </form>
      </>
    )
  }

  if (step === "code") {
    return (
      <>
        <AuthTitle icon={<MailCheck className="size-6" />} title="Check your code" subtitle={<>We sent a 6-digit code {isEmail ? "to" : "by SMS to"} <b className="text-foreground">{target.trim()}</b>. It works for 5 minutes.</>} />
        <form onSubmit={(e) => { e.preventDefault(); void verify() }} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">6-digit code</span>
              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => { setCode(""); goTo("who") }}>
                Use another email or mobile
              </button>
            </div>
            <OtpInput size="md" value={code} onChange={setCode} onComplete={(c) => void verify(c)} invalid={!!show("code") || !!error} disabled={busy} />
            {show("code") && !error && <p className="text-xs text-destructive">{errs.code}</p>}
            <p className="text-xs text-muted-foreground">
              {isEmail ? "Not in your inbox? Check spam. " : ""}
              {wait > 0 ? `Send again in ${wait}s` : <button type="button" className="font-medium text-primary hover:underline" onClick={() => void send(true)} disabled={busy}>Send the code again</button>}
            </p>
          </div>
          <FormError message={error} />
          <Button type="submit" size="lg" className={submitClass} disabled={busy}>{busy && <Loader2 className="animate-spin" />} {busy ? "Checking…" : "Continue"}</Button>
          {back}
        </form>
      </>
    )
  }

  return (
    <>
      <AuthTitle icon={<ShieldCheck className="size-6" />} title="Set a new password" subtitle="Choose a password you don't use anywhere else." />
      <form onSubmit={(e) => { e.preventDefault(); void reset() }} className="grid gap-4" noValidate>
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden /> Code checked for <b className="font-semibold">{target.trim()}</b>
        </p>
        <Field label="New password" error={show("password")}>
          <PasswordInput autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} onBlur={blur("password")} placeholder="At least 8 characters" />
        </Field>
        <PasswordStrength value={password} checks={passwordChecks(password)} />
        <Field label="Confirm new password" error={show("confirm")}>
          <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onBlur={blur("confirm")} placeholder="Type it again" />
        </Field>
        <FormError message={error} />
        <Button type="submit" size="lg" className={submitClass} disabled={busy}>{busy && <Loader2 className="animate-spin" />} {busy ? "Saving…" : "Change password"}</Button>
        {back}
      </form>
    </>
  )
}
