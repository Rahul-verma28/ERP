"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Copy, ExternalLink, Globe, MessageCircle, QrCode } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/app-shell"
import { Field, FormError, NativeSelect } from "@/components/form"
import { Pill, Section } from "@/components/page-parts"
import { FormSection } from "@/components/tasks/forms"
import { PageLoading } from "@/components/page-states"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import type { Service } from "@/lib/bookings"
import { cn } from "@/lib/utils"
import QRCode from "qrcode"
import { InlineSave } from "@/components/save-bar"

// Online booking: one link customers open to pick a service, a person, a day and a free time.
// Turn it on, choose the link and how slots are offered, and share it on WhatsApp or as a QR code.

interface Settings { enabled: boolean; slug: string; title: string; intro: string | null; slotStepMin: number; leadMin: number; maxDaysAhead: number; autoConfirm: boolean }

export default function OnlineBookingPage() {
  const { can } = useAuth()
  const res = useApi<Settings>("/booking-settings")
  const services = useApi<{ data: Service[] }>("/booking-services")
  const [f, setF] = React.useState<Settings | null>(null)
  // What is saved: the last save, else what loaded. Save works only when the form differs from it
  const [base, setBase] = React.useState<Settings | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [showQr, setShowQr] = React.useState(false)
  const s = f ?? res.data ?? null
  const saved = base ?? res.data ?? null
  const dirty = !!f && JSON.stringify(f) !== JSON.stringify(saved)
  if (!can("bookings.resource.edit")) return <PageHeader title="Online booking" description="Only people who manage bookings can change this. Ask your admin." />
  if (!s) return <PageLoading />
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setF({ ...s, [k]: v }); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  const link = typeof window !== "undefined" ? `${window.location.origin}/book/${s.slug}` : `/book/${s.slug}`
  const online = (services.data?.data ?? []).filter((x) => x.online && x.isActive)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!/^[a-z0-9-]{3,40}$/.test(s!.slug)) x.slug = "3 to 40 small letters, numbers or -"
    if (s!.title.trim().length < 2) x.title = "Give the page a title"
    if (s!.enabled && !online.length) x.enabled = "Turn on online booking for at least one service first"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const saved = await api.put<Settings>("/booking-settings", { ...s, title: s!.title.trim(), intro: s!.intro?.trim() || null })
      setF(saved)
      setBase(saved)
      toast.success(saved.enabled ? "Booking page is live" : "Saved. The page is off.")
    } catch (err) { if (err instanceof ApiError) setErrors(err.fields); setError(errorMessage(err)) } finally { setBusy(false) }
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(`Book your appointment with us online: ${link}`)}`

  return (
    <div className="grid gap-5">
      <PageHeader title="Online booking" description="One link for customers to book themselves: a service, a person, a day and a free time. It never offers a time someone is busy or off."
        actions={s.enabled && res.data?.enabled ? <a href={link} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><ExternalLink /> Open the page</a> : undefined} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={save} className="grid content-start gap-4" noValidate>
          <FormSection title="The page">
            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm sm:col-span-2"><span><span className="font-medium">Take bookings online</span><span className="block text-xs text-muted-foreground">{s.enabled ? "Anyone with the link can book" : "The link shows nothing while this is off"}</span></span><Switch checked={s.enabled} onCheckedChange={(v) => set("enabled", v)} aria-label="Take bookings online" /></label>
            {errors.enabled && <p className="text-xs text-destructive sm:col-span-2">{errors.enabled}</p>}
            <Field label="Link" required error={errors.slug} className="sm:col-span-2" hint={link}>
              <div className="flex items-center rounded-xl border bg-background"><span className="pl-3 text-sm text-muted-foreground">/book/</span><Input className="border-0 shadow-none focus-visible:ring-0" value={s.slug} maxLength={40} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} /></div>
            </Field>
            <Field label="Title" required error={errors.title} className="sm:col-span-2"><Input value={s.title} maxLength={120} onChange={(e) => set("title", e.target.value)} /></Field>
            <Field label="A line for customers" className="sm:col-span-2" count={[s.intro?.length ?? 0, 1000]}><Textarea rows={2} maxLength={1000} value={s.intro ?? ""} onChange={(e) => set("intro", e.target.value)} placeholder="e.g. Please arrive 5 minutes early. Pay at the counter." /></Field>
          </FormSection>
          <FormSection title="Times offered">
            <Field label="Start times every"><NativeSelect value={String(s.slotStepMin)} onChange={(e) => set("slotStepMin", Number(e.target.value))}>{[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}</NativeSelect></Field>
            <Field label="Earliest booking"><NativeSelect value={String(s.leadMin)} onChange={(e) => set("leadMin", Number(e.target.value))}>{[[0, "Right away"], [30, "30 minutes from now"], [60, "1 hour from now"], [120, "2 hours from now"], [240, "4 hours from now"], [1440, "Tomorrow onwards"]].map(([m, l]) => <option key={m} value={m}>{l}</option>)}</NativeSelect></Field>
            <Field label="How far ahead"><NativeSelect value={String(s.maxDaysAhead)} onChange={(e) => set("maxDaysAhead", Number(e.target.value))}>{[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}</NativeSelect></Field>
            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm"><span><span className="font-medium">Confirm on its own</span><span className="block text-xs text-muted-foreground">Off: you confirm each one</span></span><Switch checked={s.autoConfirm} onCheckedChange={(v) => set("autoConfirm", v)} aria-label="Confirm on its own" /></label>
          </FormSection>
          <FormError message={error} />
          <InlineSave dirty={dirty} saving={busy} onDiscard={() => { setF(null); setErrors({}); setError(null) }} onSave={() => void save({ preventDefault() {} } as React.FormEvent)} />
        </form>

        <div className="grid content-start gap-5">
          <Section title="Share it" action={<Pill color={res.data?.enabled ? "emerald" : "slate"} dot>{res.data?.enabled ? "Live" : "Off"}</Pill>}>
            <div className="grid gap-2">
              <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm"><Globe className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-mono text-xs">{link}</span></div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(link); toast.success("Link copied") }}><Copy /> Copy link</Button>
                <a href={wa} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-emerald-700 dark:text-emerald-300")}><MessageCircle /> WhatsApp</a>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowQr((v) => !v)}><QrCode /> QR code</Button>
              </div>
              {showQr && <LinkQr link={link} />}
              <p className="text-xs text-muted-foreground">Put the QR code at the counter or on your bill. Save before sharing a new link.</p>
            </div>
          </Section>
          <Section title={`Services shown · ${online.length}`} action={<Link href="/app/m/bookings/services" className="text-sm font-medium text-primary hover:underline">Change</Link>} flush>
            {online.length ? <ul className="divide-y">{online.map((x) => <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"><span className="min-w-0 truncate">{x.name}<span className="block text-xs text-muted-foreground">{x.durationMin} min · {x.staff.length ? x.staff.map((p) => p.name).join(", ") : "Anyone"}</span></span><span className="tabular-nums">{formatPaise(x.pricePaise)}</span></li>)}</ul> : <p className="p-5 text-sm text-muted-foreground">No service is open for online booking. Turn it on in Services.</p>}
          </Section>
        </div>
      </div>
    </div>
  )
}

/** QR code of the booking link, made in the browser */
function LinkQr({ link }: { link: string }) {
  const [src, setSrc] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(link, { margin: 1, width: 320, errorCorrectionLevel: "M" }).then((u) => !cancelled && setSrc(u)).catch(() => !cancelled && setSrc(null))
    return () => { cancelled = true }
  }, [link])
  if (!src) return <span className="mx-auto mt-2 block size-44 rounded-xl bg-muted" aria-hidden />
  return (
    <div className="mt-2 grid justify-items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="QR code for the booking page" src={src} className="size-44 rounded-xl border bg-white p-2" />
      <a href={src} download="booking-qr.png" className="text-xs font-medium text-primary hover:underline">Download QR</a>
    </div>
  )
}
