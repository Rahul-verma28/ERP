"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/input-group"
import { Field, FormError } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"

// The login link a business owner receives when AHEAD sets up their workspace. They verify their
// mobile, choose their own password and land in their workspace.

interface LinkInfo {
  kind: "client_owner"
  name: string
  email: string
  mobile: string
  businessName: string | null
  needsPassword: boolean
  expiresAt: string
}

export default function StartPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = React.use(params)
  const info = useApi<LinkInfo>(`/auth/start/${token}`)

  if (info.loading) return <Card><CardHeader><CardDescription>Opening your link…</CardDescription></CardHeader></Card>
  if (!info.data) {
    const used = info.error instanceof ApiError && info.error.details?.used
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{used ? "You're already set up" : "This link doesn't work"}</CardTitle>
          <CardDescription>{info.error?.message ?? "Ask the person who added you to send a new link."}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className={buttonVariants({ className: "w-full" })}>Go to sign in</Link>
        </CardContent>
      </Card>
    )
  }
  return <SetupForm token={token} info={info.data} />
}

function SetupForm({ token, info }: { token: string; info: LinkInfo }) {
  const router = useRouter()
  const { signIn } = useAuth()
  const [sent, setSent] = React.useState(false)
  const [code, setCode] = React.useState("")
  // Choosing a password: the code is checked on its own first
  const [checked, setChecked] = React.useState(false)
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [signInRequired, setSignInRequired] = React.useState(false)

  const title = `Set up your login for ${info.businessName}`

  async function sendCode() {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/auth/start/${token}/otp`)
      setSent(true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function checkCode() {
    if (!/^\d{6}$/.test(code)) return setFields({ code: "Enter the 6-digit code" })
    setBusy(true)
    setError(null)
    setFields({})
    try {
      await api.post(`/auth/start/${token}/check`, { code })
      setChecked(true)
    } catch (e) {
      setCode("")
      setFields({ code: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!sent) return sendCode()
    if (info.needsPassword && !checked) return checkCode()
    setBusy(true)
    setError(null)
    setFields({})
    try {
      const r = await api.post<{ accessToken?: string; signInRequired?: boolean }>(`/auth/start/${token}`, { code, password: info.needsPassword ? password : undefined })
      if (r.signInRequired || !r.accessToken) return setSignInRequired(true)
      await signIn(r.accessToken)
      router.replace("/app")
    } catch (e) {
      // A field error shows under its field; only other problems show at the bottom
      const f = e instanceof ApiError ? e.fields : {}
      // The code ran out or was wrong after all: ask for it again
      if (f.code || (e instanceof ApiError && e.code === "OTP_INVALID")) setChecked(false)
      setFields(f)
      setError(Object.values(f).some(Boolean) ? null : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (signInRequired)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Mobile verified</CardTitle>
          <CardDescription>Your account uses two-step sign-in, so sign in the usual way to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className={buttonVariants({ className: "w-full" })}>Sign in</Link>
        </CardContent>
      </Card>
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>
          Hi {info.name}. {info.needsPassword ? "Verify your mobile and choose a password. Only you will know it." : "Verify your mobile to continue with your existing password."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="truncate">{info.email}</dd>
            <dt className="text-muted-foreground">Mobile</dt>
            <dd className="tabular-nums">{info.mobile}</dd>
          </dl>
          {sent && checked && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">Mobile verified. Now choose your password.</p>
          )}
          {sent && !checked && (
            <Field label="6-digit code" hint={`Sent by SMS to ${info.mobile}`} error={fields.code}>
              <Input id="start-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus />
            </Field>
          )}
          {sent && info.needsPassword && checked && (
            <Field label="Choose a password" hint="At least 8 characters, with a letter and a number" error={fields.password}>
              <PasswordInput id="start-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
            </Field>
          )}
          <FormError message={error} />
          <Button type="submit" disabled={busy}>
            {busy ? "Please wait…" : !sent ? `Send code to ${info.mobile}` : info.needsPassword ? (checked ? "Set up my login" : "Check code") : "Continue"}
          </Button>
          {sent && !checked && (
            <button type="button" className="text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={sendCode} disabled={busy}>
              Send the code again
            </button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
