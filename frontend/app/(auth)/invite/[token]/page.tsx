"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Field, FormError } from "@/components/form"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"

interface Preview {
  tenantName: string
  roleName: string
  name: string | null
  email: string | null
  mobile: string | null
  hasAccount: boolean
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = React.use(params)
  const preview = useApi<Preview>(`/invitations/${token}`)

  if (preview.loading) return <Card><CardHeader><CardDescription>Loading invitation…</CardDescription></CardHeader></Card>
  if (!preview.data)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Invitation unavailable</CardTitle>
          <CardDescription>{preview.error?.message ?? "This invitation is no longer valid. Ask your administrator to send a new one."}</CardDescription>
        </CardHeader>
      </Card>
    )
  return <InviteForm token={token} p={preview.data} />
}

function InviteForm({ token, p }: { token: string; p: Preview }) {
  const router = useRouter()
  const { signIn } = useAuth()
  const [name, setName] = React.useState(p.name ?? "")
  const [email, setEmail] = React.useState(p.email ?? "")
  const [mobile, setMobile] = React.useState(p.mobile ?? "")
  const [otp, setOtp] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [devCode, setDevCode] = React.useState<string | undefined>()
  const [otpSent, setOtpSent] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function sendOtp() {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ devCode?: string }>("/auth/otp/send", { target: mobile, purpose: "invite" })
      setDevCode(r.devCode)
      setOtpSent(true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!p.hasAccount && !otpSent) return sendOtp()
    setBusy(true)
    setError(null)
    try {
      await api.post(`/invitations/${token}/accept`, p.hasAccount ? { password } : { name, email: email || undefined, mobile: mobile || undefined, otp, password })
      const login = await api.post<{ accessToken: string }>("/auth/login", { identifier: p.email ?? mobile, password })
      await signIn(login.accessToken)
      router.replace("/app")
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Join {p.tenantName}</CardTitle>
        <CardDescription>
          You&apos;ve been invited as <strong>{p.roleName}</strong>.
          {p.hasAccount ? " Enter your existing AHEAD password to accept." : " Create your login to accept."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          {!p.hasAccount && (
            <>
              <Field label="Your name">
                <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
              </Field>
              <Field label="Email">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!p.email} required />
              </Field>
              <Field label="Mobile number">
                <Input mask="mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} disabled={!!p.mobile || otpSent} required />
              </Field>
              {otpSent && (
                <Field label="6-digit code" hint={devCode ? `Development code: ${devCode}` : "Sent by SMS"}>
                  <Input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} required />
                </Field>
              )}
            </>
          )}
          {(p.hasAccount || otpSent) && (
            <Field label={p.hasAccount ? "Your password" : "Create a password"} hint={p.hasAccount ? undefined : "At least 8 characters"}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
            </Field>
          )}
          <FormError message={error} />
          <Button type="submit" disabled={busy}>
            {busy ? "Please wait…" : !p.hasAccount && !otpSent ? "Verify mobile" : "Accept invitation"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
