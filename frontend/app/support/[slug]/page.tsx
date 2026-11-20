"use client"

import * as React from "react"
import { BookOpen, CheckCircle2, ChevronDown, Copy, LifeBuoy, MapPin, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api, ApiError, errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

// The request form a business shares: a customer says what is wrong, with their invoice or serial
// number if they have it, and gets a request number and a private link to follow it. No login.

interface FormData {
  business: { name: string; phone: string | null; city: string | null; logoUrl: string | null }
  title: string
  intro: string | null
  categories: { key: string; label: string }[]
  articles: { id: string; title: string; body: string }[]
}

export default function SupportFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = React.use(params)
  const [page, setPage] = React.useState<FormData | null>(null)
  const [gone, setGone] = React.useState(false)
  const [f, setF] = React.useState({ name: "", phone: "", email: "", category: "", subject: "", description: "", invoiceNumber: "", serial: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState<{ number: string; token: string } | null>(null)
  const [openArticle, setOpenArticle] = React.useState<string | null>(null)
  React.useEffect(() => { api.get<FormData>(`/public/support/${slug}`).then(setPage).catch(() => setGone(true)) }, [slug])
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }

  if (gone) return <Shell><div className="grid place-items-center gap-2 py-20 text-center"><LifeBuoy className="size-10 text-neutral-400" /><p className="font-semibold">This request form is not open</p><p className="text-sm text-neutral-500">Please call the business for help.</p></div></Shell>
  if (!page) return <Shell><p className="py-20 text-center text-sm text-neutral-500">Loading…</p></Shell>

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.name.trim().length < 2) x.name = "Enter your name"
    if (!/^[6-9]\d{9}$/.test(f.phone)) x.phone = "Enter a 10-digit mobile number"
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) x.email = "Enter a valid email"
    if (!f.category) x.category = "Pick what it is about"
    if (f.subject.trim().length < 3) x.subject = "Say what it is about"
    if (f.description.trim().length < 10) x.description = "Tell us a little more (at least 10 letters)"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      setDone(await api.post(`/public/support/${slug}`, { name: f.name.trim(), phone: f.phone, email: f.email.trim() || null, category: f.category, subject: f.subject.trim(), description: f.description.trim(), invoiceNumber: f.invoiceNumber.trim() || null, serial: f.serial.trim() || null }))
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  if (done) {
    const link = `${window.location.origin}/request/${done.token}`
    return (
      <Shell page={page}>
        <div className="grid justify-items-center gap-3 rounded-3xl bg-white p-6 py-10 text-center shadow-sm">
          <CheckCircle2 className="size-14 text-emerald-500" />
          <h2 className="text-xl font-bold">Request received</h2>
          <p className="text-sm text-neutral-600">Your request number is <strong className="font-mono">{done.number}</strong>. {page.business.name} will get back to you soon.</p>
          <div className="mt-2 grid w-full max-w-sm gap-2">
            <a href={link} className="inline-flex h-11 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">Follow your request</a>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(link)} className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-emerald-700"><Copy className="size-4" /> Copy the link to keep it</button>
          </div>
          <p className="text-xs text-neutral-500">Anyone with the link can see this request, so keep it to yourself.</p>
        </div>
      </Shell>
    )
  }

  const input = "h-11 bg-white"
  const field = (k: keyof typeof f, label: string, el: React.ReactNode, req = false) => (
    <label className="grid gap-1 text-sm"><span className="font-medium">{label}{req && <span className="text-rose-600"> *</span>}</span>{el}{errors[k] && <span className="text-xs text-rose-600">{errors[k]}</span>}</label>
  )
  return (
    <Shell page={page}>
      {page.articles.length > 0 && (
        <section className="grid gap-2 rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-semibold"><BookOpen className="size-4 text-emerald-600" /> Before you write: quick answers</h2>
          {page.articles.map((a) => (
            <div key={a.id} className="rounded-2xl border">
              <button type="button" onClick={() => setOpenArticle(openArticle === a.id ? null : a.id)} aria-expanded={openArticle === a.id} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-medium">{a.title}<ChevronDown className={cn("size-4 shrink-0 transition-transform", openArticle === a.id && "rotate-180")} /></button>
              {openArticle === a.id && <p className="border-t px-4 py-3 text-sm whitespace-pre-wrap text-neutral-600">{a.body}</p>}
            </div>
          ))}
        </section>
      )}
      <form onSubmit={submit} className="grid gap-4 rounded-3xl bg-white p-5 shadow-sm" noValidate>
        <h2 className="font-semibold">Tell us what happened</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("name", "Your name", <Input className={input} value={f.name} maxLength={120} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} />, true)}
          {field("phone", "Mobile", <Input className={input} inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))} placeholder="10-digit number" aria-invalid={!!errors.phone} />, true)}
        </div>
        {field("email", "Email", <Input className={input} type="email" value={f.email} maxLength={160} onChange={(e) => set("email", e.target.value)} placeholder="If you'd like replies by email" aria-invalid={!!errors.email} />)}
        <div className="grid gap-1 text-sm">
          <span className="font-medium">What is it about<span className="text-rose-600"> *</span></span>
          <div className="flex flex-wrap gap-2">{page.categories.map((c) => <button key={c.key} type="button" onClick={() => set("category", c.key)} className={cn("rounded-full border px-3 py-1.5 text-sm", f.category === c.key ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800" : "bg-white hover:border-emerald-500")}>{c.label}</button>)}</div>
          {errors.category && <span className="text-xs text-rose-600">{errors.category}</span>}
        </div>
        {field("subject", "In one line", <Input className={input} value={f.subject} maxLength={200} onChange={(e) => set("subject", e.target.value)} placeholder="e.g. Fan stopped working" aria-invalid={!!errors.subject} />, true)}
        {field("description", "Details", <Textarea rows={4} className="bg-white" maxLength={3000} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="When it started, what you have tried" aria-invalid={!!errors.description} />, true)}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("invoiceNumber", "Bill / invoice number", <Input className={input} value={f.invoiceNumber} maxLength={40} onChange={(e) => set("invoiceNumber", e.target.value)} placeholder="If you have it" />)}
          {field("serial", "Serial / IMEI number", <Input className={input} value={f.serial} maxLength={60} onChange={(e) => set("serial", e.target.value)} placeholder="For warranty" />)}
        </div>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <Button type="submit" disabled={busy} className="h-11 bg-emerald-600 text-white hover:bg-emerald-700">{busy ? "Sending…" : "Send request"}</Button>
      </form>
    </Shell>
  )
}

function Shell({ page, children }: { page?: FormData; children: React.ReactNode }) {
  return (
    <div className="light-scope min-h-svh bg-neutral-100 px-4 py-6 text-neutral-900">
      <div className="mx-auto grid max-w-xl gap-5">
        {page && (
          <header className="grid gap-1 rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {page.business.logoUrl ? <img src={page.business.logoUrl} alt="" className="size-12 rounded-xl object-cover" /> : <span className="grid size-12 place-items-center rounded-xl bg-emerald-600 text-lg font-bold text-white">{page.business.name.slice(0, 1)}</span>}
              <div className="min-w-0"><h1 className="truncate text-lg font-bold">{page.title}</h1><p className="flex items-center gap-1 text-xs text-neutral-500">{page.business.name}{page.business.city && <><MapPin className="size-3" />{page.business.city}</>}</p></div>
            </div>
            {page.intro && <p className="mt-2 text-sm text-neutral-600">{page.intro}</p>}
            {page.business.phone && <a href={`tel:${page.business.phone}`} className="mt-1 inline-flex w-fit items-center gap-1.5 text-sm font-medium text-emerald-700"><Phone className="size-4" /> {page.business.phone}</a>}
          </header>
        )}
        <main className="grid gap-4">{children}</main>
        <p className="text-center text-[11px] text-neutral-400">Support by AHEAD</p>
      </div>
    </div>
  )
}
