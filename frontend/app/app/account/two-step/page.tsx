"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import QRCode from "qrcode"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormError } from "@/components/form"
import { OtpInput } from "@/components/onboarding"
import { BackupCodes } from "@/components/backup-codes"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useAccountBase } from "@/lib/account-base"
import { cn } from "@/lib/utils"

// Turn on two-step verification (wireframe A3). Four steps side by side; the secret is only
// stored once the code in step 3 matches, so leaving midway changes nothing.

type Step = 1 | 2 | 3 | 4

export default function TwoStepSetupPage() {
  return (
    <React.Suspense>
      <TwoStepSetup />
    </React.Suspense>
  )
}

function TwoStepSetup() {
  const router = useRouter()
  const base = useAccountBase()
  const params = useSearchParams()
  const { me, reload, signOut } = useAuth()
  const changing = params.get("change") === "1"
  const forced = !!me?.security.mustSetUpMfa
  const [step, setStep] = React.useState<Step>(1)
  const [password, setPassword] = React.useState("")
  const [setup, setSetup] = React.useState<{ setupToken: string; secret: string; otpauthUrl: string } | null>(null)
  const [qr, setQr] = React.useState<string | null>(null)
  const [code, setCode] = React.useState("")
  const [codes, setCodes] = React.useState<string[] | null>(null)
  const [saved, setSaved] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!setup) return
    let live = true
    QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 300, errorCorrectionLevel: "M" }).then((url) => live && setQr(url))
    return () => {
      live = false
    }
  }, [setup])

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return setError("Enter your password")
    setBusy(true)
    setError(null)
    try {
      setSetup(await api.post("/account/mfa/start", { password }))
      setPassword("")
      setStep(2)
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.password ?? err.message) : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (c = code) => {
    if (!/^\d{6}$/.test(c)) return setError("Enter the 6-digit code")
    setBusy(true)
    setError(null)
    try {
      const out = await api.post<{ backupCodes: string[] }>("/account/mfa/confirm", { setupToken: setup!.setupToken, code: c })
      setCodes(out.backupCodes)
      setStep(4)
    } catch (err) {
      setCode("")
      if (err instanceof ApiError && err.code === "OTP_TOKEN_INVALID") {
        setStep(1)
        setSetup(null)
      }
      setError(err instanceof ApiError && err.code === "VALIDATION_FAILED" ? err.message : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    await reload()
    router.replace(forced ? base.home : `${base.account}/security`)
  }

  const cardClass = (n: Step) =>
    cn("flex min-h-[420px] flex-col gap-3 rounded-[14px] border bg-card p-5", step === n && "border-primary ring-2 ring-primary/20", step < n && "opacity-55", step > n && "bg-card/70")
  const cap = (n: Step) => (
    <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[.06em] text-muted-foreground uppercase">
      {step > n && <Check className="size-3.5 text-emerald-600" />} Step {n} of 4
    </span>
  )
  const title = "m-0 text-[17px] font-bold"
  const p = "m-0 text-[13px] leading-relaxed text-foreground/80"

  return (
    <div className={cn("mx-auto flex w-full max-w-[1220px] flex-col gap-4", forced && "min-h-svh justify-center p-4 sm:p-7")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {forced ? (
            <p className="text-xs text-muted-foreground">{me?.security.requiredBy.join(", ")} requires two-step verification. Set it up to continue.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              <Link href={`${base.account}/security`} className="hover:underline">
                My account › Security
              </Link>
            </p>
          )}
          <h1 className="text-[22px] font-bold tracking-tight">{changing ? "Change your authenticator app" : "Turn on two-step verification"}</h1>
        </div>
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
          {changing ? "Your current app keeps working until step 3 succeeds" : "Nothing changes until step 3 succeeds"}
          {forced && (
            <Button variant="ghost" size="sm" onClick={() => signOut().then(() => router.replace("/login"))}>
              Sign out
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* 1 · password */}
        <form className={cardClass(1)} onSubmit={start}>
          {cap(1)}
          <p className={title}>Confirm it&apos;s you</p>
          <p className={p}>Enter your password to continue.</p>
          <label className="text-xs font-semibold" htmlFor="mfa-pw">
            Password
          </label>
          <Input id="mfa-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" disabled={step !== 1} autoFocus aria-invalid={step === 1 && !!error} />
          {step === 1 && <FormError message={error} />}
          <Button type="submit" className="mt-auto" disabled={step !== 1 || busy}>
            {busy && step === 1 ? "Checking…" : "Continue"}
          </Button>
        </form>

        {/* 2 · scan */}
        <div className={cardClass(2)}>
          {cap(2)}
          <p className={title}>Scan with your app</p>
          <p className={p}>Google Authenticator, Microsoft Authenticator or Authy.</p>
          <div className="grid size-[150px] place-items-center self-center rounded-lg border-[6px] border-white bg-white shadow-[0_0_0_1px_var(--border)]">
            {qr && step >= 2 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR code for your authenticator app" className="size-full" />
            ) : (
              <span className="text-center text-[11px] text-muted-foreground">QR code appears after step 1</span>
            )}
          </div>
          <p className={cn(p, "text-xs")}>Can&apos;t scan? Enter this key:</p>
          <div className="rounded-md bg-muted px-1.5 py-1 text-center font-mono text-[13px] tracking-wide select-all">{setup ? setup.secret.match(/.{1,4}/g)!.join(" ") : "•••• •••• •••• ••••"}</div>
          <Button type="button" className="mt-auto" disabled={step !== 2} onClick={() => (setError(null), setStep(3))}>
            Next
          </Button>
        </div>

        {/* 3 · code */}
        <form
          className={cardClass(3)}
          onSubmit={(e) => {
            e.preventDefault()
            void verify()
          }}
        >
          {cap(3)}
          <p className={title}>Enter the code</p>
          <p className={p}>Type the 6-digit code your app shows now.</p>
          <OtpInput size="sm" value={code} onChange={setCode} onComplete={(c) => void verify(c)} invalid={step === 3 && !!error} disabled={step !== 3 || busy} autoFocus={false} />
          {step === 3 && error && <p className="text-xs text-destructive">{error}</p>}
          <div className="mt-auto flex gap-2">
            <Button type="button" variant="outline" disabled={step !== 3 || busy} onClick={() => setStep(2)}>
              Back
            </Button>
            <Button type="submit" className="flex-1" disabled={step !== 3 || busy}>
              {busy && step === 3 ? "Checking…" : "Verify"}
            </Button>
          </div>
        </form>

        {/* 4 · backup codes */}
        <div className={cardClass(4)}>
          {cap(4)}
          <p className={title}>Save backup codes</p>
          <p className={p}>Each works once if you lose your phone. They won&apos;t be shown again.</p>
          {codes ? (
            <BackupCodes codes={codes} account={me?.user.email} />
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} className="rounded-md bg-muted px-1.5 py-1 text-center font-mono text-[13px] text-muted-foreground">
                  ••••-••••
                </span>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" className="size-4 accent-primary" checked={saved} onChange={(e) => setSaved(e.target.checked)} disabled={step !== 4} />
            I&apos;ve saved my backup codes
          </label>
          <Button type="button" className="mt-auto" disabled={step !== 4 || !saved} onClick={finish}>
            {changing ? "Done" : "Turn on"}
          </Button>
        </div>
      </div>
    </div>
  )
}
