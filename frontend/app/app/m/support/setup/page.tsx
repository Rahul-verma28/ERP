"use client"

import * as React from "react"
import { toast } from "sonner"
import { Copy, ExternalLink, Globe, MessageCircle, Plus, QrCode, Trash2 } from "lucide-react"
import QRCode from "qrcode"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/app-shell"
import { Field, FormError, NativeSelect } from "@/components/form"
import { Pill, Section } from "@/components/page-parts"
import { PageLoading } from "@/components/page-states"
import { DOT, FormSection } from "@/components/tasks/forms"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { PRIORITY, type SupportSettings, type TicketPriority } from "@/lib/support"
import { cn } from "@/lib/utils"

// Customer Service setup on one page: what tickets can be about, how fast each priority must be
// answered and fixed, the warranty, who gets new tickets, closing and ratings, and the online
// request form customers use to raise one themselves. One Save sends it all.

const COLORS = ["blue", "emerald", "violet", "amber", "rose", "cyan", "slate"]
const keyOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30)

export default function SupportSetupPage() {
  const { can } = useAuth()
  const res = useApi<SupportSettings>("/support/settings")
  const [f, setF] = React.useState<SupportSettings | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [showQr, setShowQr] = React.useState(false)
  const s = f ?? res.data ?? null
  if (!can("support.sla.edit")) return <PageHeader title="Customer service setup" description="Only people who manage customer service can change this. Ask your admin." />
  if (!s) return <PageLoading />
  const set = <K extends keyof SupportSettings>(k: K, v: SupportSettings[K]) => { setF({ ...s, [k]: v }); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  const slug = s.slug ?? ""
  const link = typeof window !== "undefined" ? `${window.location.origin}/support/${slug}` : `/support/${slug}`
  const setHours = (p: TicketPriority, k: "respondH" | "resolveH", v: number) => set("sla", { ...s.sla, [p]: { ...s.sla[p], [k]: v } })

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (s!.formEnabled && !/^[a-z0-9][a-z0-9-]{2,38}$/.test(slug)) x.slug = "3 to 40 small letters, numbers or -"
    if (s!.title.trim().length < 3) x.title = "Give the form a title"
    if (!s!.categories.length) x.categories = "Keep at least one category"
    if (s!.categories.some((c) => c.label.trim().length < 2)) x.categories = "Every category needs a name"
    if (new Set(s!.categories.map((c) => c.key)).size !== s!.categories.length) x.categories = "Two categories have the same name"
    for (const p of Object.keys(PRIORITY) as TicketPriority[]) {
      const h = s!.sla[p]
      if (!(h.respondH > 0) || !(h.resolveH > 0)) x[`sla.${p}`] = "Enter hours"
      else if (h.resolveH < h.respondH) x[`sla.${p}`] = "Fix time can't be before the first reply"
    }
    if (!(s!.warrantyMonths >= 0 && s!.warrantyMonths <= 120)) x.warrantyMonths = "0 to 120 months"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const saved = await api.put<SupportSettings>("/support/settings", { ...s, slug: slug || null, title: s!.title.trim(), intro: s!.intro?.trim() || null, categories: s!.categories.map((c) => ({ ...c, label: c.label.trim() })) })
      setF(saved)
      void res.reload()
      toast.success(saved.formEnabled ? "Saved. The request form is live." : "Saved")
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(`Need help with something you bought from us? Raise a request here: ${link}`)}`

  return (
    <div className="grid gap-5">
      <PageHeader title="Customer service setup" description="What tickets are about, how fast you answer, warranty, who gets new tickets, and the form customers use."
        actions={s.formEnabled && res.data?.formEnabled && res.data.slug ? <a href={`/support/${res.data.slug}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><ExternalLink /> Open the form</a> : undefined} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={save} className="grid content-start gap-4" noValidate>
          <FormSection title="Categories" className="sm:grid-cols-1">
            <ul className="grid gap-2">
              {s.categories.map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  <div className="flex gap-1" role="radiogroup" aria-label={`Colour of ${c.label || "category"}`}>{COLORS.map((col) => <button key={col} type="button" role="radio" aria-checked={c.color === col} aria-label={col} onClick={() => set("categories", s.categories.map((y, j) => (j === i ? { ...y, color: col } : y)))} className={cn("size-5 rounded-full", DOT[col], c.color === col ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "opacity-50")} />)}</div>
                  <Input value={c.label} maxLength={40} aria-label="Category name" onChange={(e) => set("categories", s.categories.map((y, j) => (j === i ? { ...y, label: e.target.value, key: y.key && res.data?.categories.some((o) => o.key === y.key) ? y.key : keyOf(e.target.value) } : y)))} />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${c.label}`} className="text-destructive" disabled={s.categories.length <= 1} onClick={() => set("categories", s.categories.filter((_, j) => j !== i))}><Trash2 /></Button>
                </li>
              ))}
            </ul>
            {errors.categories && <p className="text-xs text-destructive">{errors.categories}</p>}
            <Button type="button" variant="outline" size="sm" className="w-fit" disabled={s.categories.length >= 20} onClick={() => set("categories", [...s.categories, { key: `cat_${s.categories.length + 1}`, label: "", color: "slate" }])}><Plus /> Add category</Button>
            <p className="text-xs text-muted-foreground">Old tickets keep their category if you rename one.</p>
          </FormSection>

          <FormSection title="How fast (SLA)" className="sm:grid-cols-1">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 font-medium">Priority</th><th className="py-2 font-medium">First reply within</th><th className="py-2 font-medium">Fixed within</th></tr></thead>
                <tbody>
                  {(["urgent", "high", "medium", "low"] as TicketPriority[]).map((p) => (
                    <tr key={p} className="border-b border-border/60 align-top">
                      <td className="py-2"><Pill color={PRIORITY[p].color} dot>{PRIORITY[p].label}</Pill></td>
                      <td className="py-2 pr-3"><div className="flex items-center gap-1.5"><HoursInput value={s.sla[p].respondH} onChange={(v) => setHours(p, "respondH", v)} label={`${PRIORITY[p].label} first reply hours`} /><span className="text-xs text-muted-foreground">hours</span></div></td>
                      <td className="py-2"><div className="flex items-center gap-1.5"><HoursInput value={s.sla[p].resolveH} onChange={(v) => setHours(p, "resolveH", v)} label={`${PRIORITY[p].label} fix hours`} /><span className="text-xs text-muted-foreground">hours</span></div>{errors[`sla.${p}`] && <p className="mt-1 text-xs text-destructive">{errors[`sla.${p}`]}</p>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Counted in clock hours from when the ticket comes in. Changing a ticket&apos;s priority moves its times.</p>
          </FormSection>

          <FormSection title="Handling">
            <Field label="Warranty" error={errors.warrantyMonths} hint="From the sale date of the serial or invoice"><div className="flex items-center gap-1.5"><Input inputMode="numeric" value={String(s.warrantyMonths)} onChange={(e) => set("warrantyMonths", Number(e.target.value.replace(/\D/g, "") || 0))} aria-label="Warranty months" /><span className="text-xs text-muted-foreground">months</span></div></Field>
            <Field label="New tickets go to"><NativeSelect value={s.autoAssign} onChange={(e) => set("autoAssign", e.target.value as SupportSettings["autoAssign"])}><option value="none">Nobody: someone takes it</option><option value="round_robin">Each person in turn</option></NativeSelect></Field>
            <Field label="Close resolved tickets after" hint="If the customer doesn't reply"><NativeSelect value={String(s.autoCloseDays)} onChange={(e) => set("autoCloseDays", Number(e.target.value))}>{[[0, "Never: close by hand"], [3, "3 days"], [7, "7 days"], [14, "14 days"], [30, "30 days"]].map(([d, l]) => <option key={d} value={d}>{l}</option>)}</NativeSelect></Field>
            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm"><span><span className="font-medium">Ask for a rating</span><span className="block text-xs text-muted-foreground">On the customer&apos;s link once resolved</span></span><Switch checked={s.askRating} onCheckedChange={(v) => set("askRating", v)} aria-label="Ask for a rating" /></label>
          </FormSection>

          <FormSection title="Online request form">
            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm sm:col-span-2"><span><span className="font-medium">Customers can raise requests online</span><span className="block text-xs text-muted-foreground">{s.formEnabled ? "Anyone with the link can raise one and follow it" : "The link shows nothing while this is off"}</span></span><Switch checked={s.formEnabled} onCheckedChange={(v) => set("formEnabled", v)} aria-label="Online request form" /></label>
            <Field label="Link" required={s.formEnabled} error={errors.slug} className="sm:col-span-2" hint={slug ? link : "e.g. your shop name"}>
              <div className="flex items-center rounded-xl border bg-background"><span className="pl-3 text-sm text-muted-foreground">/support/</span><Input className="border-0 shadow-none focus-visible:ring-0" value={slug} maxLength={40} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} /></div>
            </Field>
            <Field label="Title" required error={errors.title} className="sm:col-span-2"><Input value={s.title} maxLength={80} onChange={(e) => set("title", e.target.value)} /></Field>
            <Field label="A line for customers" className="sm:col-span-2" count={[s.intro?.length ?? 0, 400]}><Textarea rows={2} maxLength={400} value={s.intro ?? ""} onChange={(e) => set("intro", e.target.value)} placeholder="e.g. Keep your invoice number handy. We reply within a working day." /></Field>
          </FormSection>
          <FormError message={error} />
          <div className="flex justify-end gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></div>
        </form>

        <div className="grid content-start gap-5">
          <Section title="Share the form" action={<Pill color={res.data?.formEnabled ? "emerald" : "slate"} dot>{res.data?.formEnabled ? "Live" : "Off"}</Pill>}>
            {res.data?.slug ? (
              <div className="grid gap-2">
                <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm"><Globe className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-mono text-xs">{link}</span></div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(link); toast.success("Link copied") }}><Copy /> Copy link</Button>
                  <a href={wa} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-emerald-700 dark:text-emerald-300")}><MessageCircle /> WhatsApp</a>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowQr((v) => !v)}><QrCode /> QR code</Button>
                </div>
                {showQr && <LinkQr link={link} />}
                <p className="text-xs text-muted-foreground">Print the QR on your bill or warranty card. Each customer gets a private link to follow their request.</p>
              </div>
            ) : <p className="text-sm text-muted-foreground">Choose a link and save to get the form&apos;s address.</p>}
          </Section>
          <Section title="How it works">
            <ol className="grid list-decimal gap-1.5 pl-4 text-sm text-muted-foreground">
              <li>A ticket gets a number and its reply and fix times from the SLA above.</li>
              <li>Late ones go to the top of the list and show in red.</li>
              <li>Replies reach the customer on their link, WhatsApp or email; notes stay inside.</li>
              <li>Resolving asks what was done; the customer is asked to rate it.</li>
            </ol>
          </Section>
        </div>
      </div>
    </div>
  )
}

/** Hours with decimals (0.5 = 30 minutes): typed as text, kept as a number */
function HoursInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [text, setText] = React.useState(String(value))
  return <Input className="w-24" inputMode="decimal" value={text} aria-label={label} onChange={(e) => { const t = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"); setText(t); onChange(Number(t) || 0) }} />
}

/** QR code of the form link, made in the browser */
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
      <img alt="QR code for the request form" src={src} className="size-44 rounded-xl border bg-white p-2" />
      <a href={src} download="support-qr.png" className="text-xs font-medium text-primary hover:underline">Download QR</a>
    </div>
  )
}
