"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Copy, ExternalLink, Globe, MessageCircle, QrCode } from "lucide-react"
import QRCode from "qrcode"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/app-shell"
import { Field, FormError } from "@/components/form"
import { Pill, Section } from "@/components/page-parts"
import { PageLoading } from "@/components/page-states"
import { FormSection } from "@/components/tasks/forms"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"

// Customer portal setup: switch it on, choose its link and which parts customers see. Customers
// sign in with their mobile number; or send one customer a sign-in link from their page.

interface Settings { enabled: boolean; slug: string | null; title: string; intro: string | null; showBills: boolean; showQuotes: boolean; allowQuoteReply: boolean; showStatement: boolean; showRequests: boolean; showBookings: boolean }
const PARTS: [keyof Settings, string, string][] = [
  ["showBills", "Bills", "Open, print and pay by UPI; what is due and overdue"],
  ["showQuotes", "Quotations", "See the quotations you sent"],
  ["allowQuoteReply", "Accept or decline quotations", "The answer shows on the quotation for your team"],
  ["showStatement", "Statement", "Every bill and payment with the running balance"],
  ["showRequests", "Requests", "Raise complaints and questions; they become tickets"],
  ["showBookings", "Bookings", "Coming and past appointments, and a link to book again"],
]

export default function PortalSetupPage() {
  const { can } = useAuth()
  const res = useApi<Settings>(can("billing.invoice.view") ? "/portal/settings" : null)
  const [f, setF] = React.useState<Settings | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [showQr, setShowQr] = React.useState(false)
  const s = f ?? res.data ?? null
  if (!can("billing.invoice.view")) return <PageHeader title="Customer portal" description="You don't have access to this. Ask your admin." />
  if (!s) return <PageLoading />
  const canEdit = can("tenant.settings.edit")
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setF({ ...s, [k]: v }); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  const slug = s.slug ?? ""
  const link = typeof window !== "undefined" ? `${window.location.origin}/portal/${res.data?.slug ?? slug}` : ""

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (s!.enabled && !/^[a-z0-9][a-z0-9-]{2,38}$/.test(slug)) x.slug = "3 to 40 small letters, numbers or -"
    if (s!.title.trim().length < 3) x.title = "Give the portal a title"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const saved = await api.put<Settings>("/portal/settings", { ...s, slug: slug || null, title: s!.title.trim(), intro: s!.intro?.trim() || null })
      setF(saved)
      void res.reload()
      toast.success(saved.enabled ? "Saved. The portal is live." : "Saved. The portal is off.")
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(`See your bills, pay by UPI and raise requests here: ${link}`)}`

  return (
    <div className="grid gap-5">
      <PageHeader title="Customer portal" description="One link where your customers see their bills and dues, pay by UPI, answer quotations, download their statement, raise requests and see bookings. They sign in with their mobile number."
        actions={res.data?.enabled && res.data.slug ? <a href={`/portal/${res.data.slug}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><ExternalLink /> Open the portal</a> : undefined} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={save} className="grid content-start gap-4" noValidate>
          <FormSection title="The portal">
            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm sm:col-span-2"><span><span className="font-medium">Customers can sign in</span><span className="block text-xs text-muted-foreground">{s.enabled ? "Anyone whose mobile number is on a customer can sign in with a code" : "The link shows nothing while this is off"}</span></span><Switch checked={s.enabled} disabled={!canEdit} onCheckedChange={(v) => set("enabled", v)} aria-label="Customer portal on" /></label>
            <Field label="Link" required={s.enabled} error={errors.slug} className="sm:col-span-2" hint={slug ? `${typeof window !== "undefined" ? window.location.origin : ""}/portal/${slug}` : "e.g. your shop name"}>
              <div className="flex items-center rounded-xl border bg-background"><span className="pl-3 text-sm text-muted-foreground">/portal/</span><Input className="border-0 shadow-none focus-visible:ring-0" disabled={!canEdit} value={slug} maxLength={40} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} /></div>
            </Field>
            <Field label="Title" required error={errors.title} className="sm:col-span-2"><Input disabled={!canEdit} value={s.title} maxLength={80} onChange={(e) => set("title", e.target.value)} /></Field>
            <Field label="A line for customers" className="sm:col-span-2" count={[s.intro?.length ?? 0, 400]}><Textarea rows={2} disabled={!canEdit} maxLength={400} value={s.intro ?? ""} onChange={(e) => set("intro", e.target.value)} placeholder="e.g. Pay by UPI from your bill. For anything else, raise a request." /></Field>
          </FormSection>
          <FormSection title="What customers see" className="sm:grid-cols-1">
            {PARTS.map(([k, l, hint]) => {
              const off = k === "allowQuoteReply" && !s.showQuotes
              return <label key={k} className={cn("flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm", off && "opacity-50", k === "allowQuoteReply" && "ml-6")}><span><span className="font-medium">{l}</span><span className="block text-xs text-muted-foreground">{hint}</span></span><Switch checked={!!s[k] && !off} disabled={!canEdit || off} onCheckedChange={(v) => set(k, v as never)} aria-label={l} /></label>
            })}
          </FormSection>
          <FormError message={error} />
          {canEdit && <div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></div>}
        </form>

        <div className="grid content-start gap-5">
          <Section title="Share the portal" action={<Pill color={res.data?.enabled ? "emerald" : "slate"} dot>{res.data?.enabled ? "Live" : "Off"}</Pill>}>
            {res.data?.slug ? (
              <div className="grid gap-2">
                <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm"><Globe className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-mono text-xs">{link}</span></div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(link); toast.success("Link copied") }}><Copy /> Copy link</Button>
                  <a href={wa} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-emerald-700 dark:text-emerald-300")}><MessageCircle /> WhatsApp</a>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowQr((v) => !v)}><QrCode /> QR code</Button>
                </div>
                {showQr && <LinkQr link={link} />}
                <p className="text-xs text-muted-foreground">Print the QR on your bills. Customers sign in with the mobile number on their customer record.</p>
              </div>
            ) : <p className="text-sm text-muted-foreground">Choose a link and save to get the portal&apos;s address.</p>}
          </Section>
          <Section title="How customers get in">
            <ol className="grid list-decimal gap-1.5 pl-4 text-sm text-muted-foreground">
              <li>They open the link and type their mobile number.</li>
              <li>A 6-digit code comes by SMS. Numbers you don&apos;t have get nothing.</li>
              <li>Or send one customer their own sign-in link from their page in <Link href="/app/m/sales/customers" className="underline">Customers</Link>; it works for 30 days.</li>
              <li>Turn off one customer&apos;s access from their page any time.</li>
            </ol>
          </Section>
        </div>
      </div>
    </div>
  )
}

/** QR code of the portal link, made in the browser */
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
      <img alt="QR code for the customer portal" src={src} className="size-44 rounded-xl border bg-white p-2" />
      <a href={src} download="portal-qr.png" className="text-xs font-medium text-primary hover:underline">Download QR</a>
    </div>
  )
}
