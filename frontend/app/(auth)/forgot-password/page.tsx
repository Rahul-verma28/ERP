"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { ArrowLeft, KeyRound, Loader2, Mail, MailCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconInput, PasswordInput, PasswordStrength, passwordChecks } from "@/components/ui/input-group"
import { Field, FormError } from "@/components/form"
import { OtpInput } from "@/components/onboarding"
import { AuthTitle } from "@/components/auth/auth-shell"
import { api, ApiError, errorMessage } from "@/lib/api"
import { email as emailRule, mobileIN, password as passwordRule } from "@contracts/validation"

// Forgot password, in three steps on one page: who you are, the 6-digit code we sent,
// and the new password (twice, with a strength meter). The code can be sent again after 30 s.

const targetError = (v: string) => {
  const t = v.trim()
  if (!t) return "Enter your email or mobile number"
  return t.includes("@") ? emailRule(t) : /^[+\d\s-]+$/.test(t) ? mobileIN(t) : "Enter a valid email or 10-digit mobile number"
}

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [target, setTarget] = React.useState("")
  const [code, setCode] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [sent, setSent] = React.useState(false)
  const [devCode, setDevCode] = React.useState<string | undefined>()
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
    target: targetError(target),
    code: /^\d{6}$/.test(code) ? null : "Enter the 6-digit code",
    password: password ? passwordRule(password) : "Choose a new password",
    confirm: !confirm ? "Type the new password again" : confirm !== password ? "Passwords don't match" : null,
  }
  const show = (k: keyof typeof errs) => (submitted || touched[k] ? errs[k] : null)
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }))
  const isEmail = target.includes("@")

  async function send() {
    setSubmitted(true)
    if (errs.target) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ devCode?: string }>("/auth/otp/send", { target: target.trim(), purpose: "reset" })
      setDevCode(r.devCode)
      setSent(true)
      setWait(30)
      setSubmitted(false)
      setTouched({})
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    setSubmitted(true)
    if (errs.code || errs.password || errs.confirm) return
    setBusy(true)
    setError(null)
    try {
      await api.post("/auth/password/reset", { target: target.trim(), code, password })
      toast.success("Password changed. Sign in with the new one.")
      router.replace("/login")
    } catch (err) {
      if (err instanceof ApiError && err.fields.code) setCode("")
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!sent) {
    return (
      <>
        <AuthTitle icon={<KeyRound className="size-6" />} title="Forgot your password?" subtitle="Enter the email or mobile on your account. We'll send a 6-digit code to set a new password." />
        <form onSubmit={(e) => { e.preventDefault(); void send() }} className="grid gap-4" noValidate>
          <Field label="Email or mobile" error={show("target")}>
            <IconInput icon={Mail} autoComplete="username" autoFocus value={target} onChange={(e) => setTarget(e.target.value)} onBlur={blur("target")} placeholder="you@business.com or 98XXXXXXXX" />
          </Field>
          <FormError message={error} />
          <Button type="submit" size="lg" className="h-11 w-full shadow-[0_8px_20px_-8px] shadow-primary/60" disabled={busy}>{busy && <Loader2 className="animate-spin" />} {busy ? "Sending…" : "Send code"}</Button>
          <Link href="/login" className="inline-flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Back to sign in</Link>
        </form>
      </>
    )
  }

  return (
    <>
      <AuthTitle icon={<MailCheck className="size-6" />} title="Set a new password" subtitle={<>If an account has <b className="text-foreground">{target.trim()}</b>, we sent a 6-digit code {isEmail ? "to that email" : "by SMS"}.</>} />
      <form onSubmit={(e) => { e.preventDefault(); void reset() }} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">6-digit code</span>
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => { setSent(false); setCode(""); setError(null) }}>Use another email or mobile</button>
          </div>
          <OtpInput size="md" value={code} onChange={setCode} invalid={!!show("code")} disabled={busy} />
          {show("code") && <p className="text-xs text-destructive">{errs.code}</p>}
          <p className="text-xs text-muted-foreground">
            {devCode ? <>Development code: <b className="font-mono text-foreground">{devCode}</b> · </> : null}
            {wait > 0 ? `Send again in ${wait}s` : <button type="button" className="font-medium text-primary hover:underline" onClick={() => void send()}>Send the code again</button>}
          </p>
        </div>
        <Field label="New password" error={show("password")}>
          <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} onBlur={blur("password")} placeholder="At least 8 characters" />
        </Field>
        <PasswordStrength value={password} checks={passwordChecks(password)} />
        <Field label="Confirm new password" error={show("confirm")}>
          <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onBlur={blur("confirm")} placeholder="Type it again" />
        </Field>
        <FormError message={error} />
        <Button type="submit" size="lg" className="h-11 w-full shadow-[0_8px_20px_-8px] shadow-primary/60" disabled={busy}>{busy && <Loader2 className="animate-spin" />} {busy ? "Saving…" : "Change password"}</Button>
        <Link href="/login" className="inline-flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Back to sign in</Link>
      </form>
    </>
  )
}
