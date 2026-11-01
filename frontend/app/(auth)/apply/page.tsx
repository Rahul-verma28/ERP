"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FormError } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { email as emailRule, gstin as gstinRule, gstinStateMismatch, mobileIN, personName } from "@contracts/validation"
import { StateSelect } from "@/components/search-select"
import { cn } from "@/lib/utils"

// Website: apply to work with AHEAD (blueprint Phase G). A vendor brings businesses and earns
// on them; a partner resells AHEAD under its own name and is billed monthly. AHEAD reviews each
// application; if approved, the person gets a login link to set their own password.

type Kind = "vendor" | "partner"
const KINDS: Record<Kind, { title: string; text: string }> = {
  vendor: { title: "Vendor", text: "You introduce businesses to AHEAD with your own link and code. AHEAD bills them." },
  partner: { title: "Partner", text: "You sell AHEAD to your clients, look after them and get one monthly bill from AHEAD at a discount." },
}

export default function ApplyPage() {
  return (
    <React.Suspense>
      <Apply />
    </React.Suspense>
  )
}

function Apply() {
  const params = useSearchParams()
  const [kind, setKind] = React.useState<Kind>(params.get("type") === "partner" ? "partner" : "vendor")
  const [f, setF] = React.useState({ name: "", company: "", email: "", mobile: "", city: "", stateCode: "", gstin: "", message: "", website: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const bad = Object.fromEntries(
      Object.entries({
        name: !f.name.trim() ? "Enter your name" : personName(f.name),
        company: kind === "partner" && !f.company.trim() ? "Enter your company name" : null,
        email: !f.email.trim() ? "Enter your email" : emailRule(f.email),
        mobile: !f.mobile ? "Enter your mobile number" : mobileIN(f.mobile),
        gstin: f.gstin ? gstinRule(f.gstin) ?? gstinStateMismatch(f.gstin, f.stateCode) : null,
      }).filter(([, v]) => v)
    ) as Record<string, string>
    setErrors(bad)
    if (Object.keys(bad).length) return
    setBusy(true)
    try {
      await api.post("/public/applications", { kind, ...f, company: f.company || null, city: f.city || null, stateCode: f.stateCode || null, gstin: f.gstin || null, message: f.message || null })
      setSent(true)
    } catch (x) {
      if (x instanceof ApiError && x.fields) setErrors(x.fields)
      setError(errorMessage(x))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <Card>
        <CardContent className="grid justify-items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-10 text-emerald-600" />
          <h1 className="text-xl font-semibold">Thank you, we have your application</h1>
          <p className="max-w-sm text-sm text-muted-foreground">Someone from AHEAD will look at it within two working days. If it is approved, you get a link by email to set your password and sign in.</p>
          <Link href="/" className="text-sm font-medium text-primary hover:underline">Back to the website</Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Work with AHEAD</CardTitle>
        <CardDescription>Tell us a little about you. AHEAD reviews every application.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">I want to become a</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(KINDS) as Kind[]).map((k) => (
                <label key={k} className={cn("grid cursor-pointer gap-1 rounded-lg border p-3 text-sm transition-colors", kind === k ? "border-primary bg-accent/60 ring-2 ring-primary/15" : "hover:border-primary/40")}>
                  <span className="flex items-center gap-2 font-medium">
                    <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="accent-[var(--primary)]" />
                    {KINDS[k].title}
                  </span>
                  <span className="text-xs text-muted-foreground">{KINDS[k].text}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field label="Your name" error={errors.name} required>
            <Input mask="name" value={f.name} onChange={set("name")} autoComplete="name" />
          </Field>
          <Field label={kind === "partner" ? "Company name" : "Company name (optional)"} error={errors.company} required={kind === "partner"}>
            <Input value={f.company} onChange={set("company")} autoComplete="organization" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" error={errors.email} required>
              <Input mask="email" type="email" value={f.email} onChange={set("email")} autoComplete="email" />
            </Field>
            <Field label="Mobile" error={errors.mobile} required>
              <Input mask="mobile" value={f.mobile} onChange={set("mobile")} autoComplete="tel" placeholder="98765 43210" />
            </Field>
            <Field label="City" error={errors.city}>
              <Input value={f.city} onChange={set("city")} autoComplete="address-level2" />
            </Field>
            <Field label="State" error={errors.stateCode}>
              <StateSelect value={f.stateCode} onChange={(v) => setF((x) => ({ ...x, stateCode: v }))} />
            </Field>
          </div>
          {kind === "partner" && (
            <Field label="GSTIN (optional)" error={errors.gstin} hint="Needed on the monthly bill if you claim GST">
              <Input mask="gstin" value={f.gstin} onChange={(e) => setF((x) => ({ ...x, gstin: e.target.value }))} className="font-mono" />
            </Field>
          )}
          <Field label="Anything we should know? (optional)" error={errors.message} count={[f.message.length, 1000]}>
            <Textarea value={f.message} onChange={set("message")} maxLength={1000} placeholder="e.g. the kind of businesses you work with, and roughly how many" />
          </Field>
          {/* Left empty by people; bots fill it */}
          <input type="text" name="website" value={f.website} onChange={set("website")} tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" />
          <FormError message={error} />
          <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send application"}</Button>
          <p className="text-center text-xs text-muted-foreground">Already work with AHEAD? <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link></p>
        </form>
      </CardContent>
    </Card>
  )
}
