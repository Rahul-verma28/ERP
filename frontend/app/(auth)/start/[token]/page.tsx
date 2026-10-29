"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Field, FormError } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"

// Console v3: the login link a client owner or a Console user receives. They verify their
// mobile, choose their own password and land in their workspace.

interface LinkInfo {
  kind: "client_owner" | "console_member"
  name: string
  email: string
  mobile: string
  businessName: string | null
  partnerName: string | null
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
  const [devCode, setDevCode] = React.useState<string | undefined>()
  const [code, setCode] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [signInRequired, setSignInRequired] = React.useState(false)

  const forConsole = info.kind === "console_member"
  const title = info.partnerName ? `Join the ${info.partnerName} partner portal` : forConsole ? "Join the AHEAD Console" : `Set up your login for ${info.businessName}`

  async function sendCode() {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ devCode?: string }>(`/auth/start/${token}/otp`)
      setDevCode(r.devCode)
      setSent(true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!sent) return sendCode()
    setBusy(true)
    setError(null)
    setFields({})
    try {
      const r = await api.post<{ accessToken?: string; signInRequired?: boolean }>(`/auth/start/${token}`, { code, password: info.needsPassword ? password : undefined })
      if (r.signInRequired || !r.accessToken) return setSignInRequired(true)
      await signIn(r.accessToken)
      router.replace(info.partnerName ? "/partner" : forConsole ? "/console" : "/app")
    } catch (e) {
      // A field error shows under its field; only other problems show at the bottom
      const f = e instanceof ApiError ? e.fields : {}
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
          {sent && (
            <Field label="6-digit code" hint={devCode ? `Development code: ${devCode}` : `Sent by SMS to ${info.mobile}`} error={fields.code}>
              <Input id="start-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus />
            </Field>
          )}
          {sent && info.needsPassword && (
            <Field label="Choose a password" hint="At least 8 characters, with a letter and a number" error={fields.password}>
              <Input id="start-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
            </Field>
          )}
          <FormError message={error} />
          <Button type="submit" disabled={busy}>
            {busy ? "Please wait…" : !sent ? `Send code to ${info.mobile}` : info.needsPassword ? "Set up my login" : "Continue"}
          </Button>
          {sent && (
            <button type="button" className="text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={sendCode} disabled={busy}>
              Send the code again
            </button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
