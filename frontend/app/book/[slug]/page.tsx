"use client"

import * as React from "react"
import { ArrowLeft, CalendarCheck, CheckCircle2, Clock, MapPin, Phone, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api, ApiError, errorMessage } from "@/lib/api"
import { formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"

// The online booking page a business shares: pick a service, a person (or anyone), a day and a free
// time, then a name and mobile number. No login. Times are checked again when booking.

interface PageData {
  business: { name: string; phone: string | null; city: string | null; logoUrl: string | null }
  title: string
  intro: string | null
  maxDaysAhead: number
  services: { id: string; name: string; description: string | null; pricePaise: number; durationMin: number; staffIds: string[] }[]
  staff: { id: string; name: string }[]
}
interface Slot { time: string; startAt: string; staff: { id: string; name: string }[] }

const DAY = 86_400_000
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10)
const dayLabel = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-IN", { ...o, timeZone: "UTC" })

export default function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = React.use(params)
  const [page, setPage] = React.useState<PageData | null>(null)
  const [gone, setGone] = React.useState(false)
  const [serviceId, setServiceId] = React.useState<string | null>(null)
  const [staffId, setStaffId] = React.useState<string>("")
  const [date, setDate] = React.useState(istToday())
  const [found, setFound] = React.useState<{ key: string; slots: Slot[] } | null>(null)
  const [slot, setSlot] = React.useState<Slot | null>(null)
  const [form, setForm] = React.useState({ name: "", phone: "", notes: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [version, setVersion] = React.useState(0)
  const [done, setDone] = React.useState<{ service: string; date: string; time: string; staff: string | null; status: string } | null>(null)

  React.useEffect(() => { api.get<PageData>(`/public/book/${slug}`).then(setPage).catch(() => setGone(true)) }, [slug])
  // Free times for the chosen service, person and day; a change of any of them asks again
  const key = serviceId ? `${serviceId}|${staffId}|${date}|${version}` : ""
  React.useEffect(() => {
    if (!key) return
    let off = false
    const [id, who, day] = key.split("|")
    api.get<{ slots: Slot[] }>(`/public/book/${slug}/slots?date=${day}&itemId=${id}${who ? `&staffId=${who}` : ""}`).then((r) => !off && setFound({ key, slots: r.slots })).catch(() => !off && setFound({ key, slots: [] }))
    return () => { off = true }
  }, [slug, key])
  const slots = found?.key === key ? found.slots : null

  if (gone) return <Shell><div className="grid place-items-center gap-2 py-20 text-center"><CalendarCheck className="size-10 text-neutral-400" /><p className="font-semibold">Online booking is not open</p><p className="text-sm text-neutral-500">Please call the business to book.</p></div></Shell>
  if (!page) return <Shell><p className="py-20 text-center text-sm text-neutral-500">Loading…</p></Shell>
  const service = page.services.find((s) => s.id === serviceId)
  const people = service?.staffIds.length ? page.staff.filter((p) => service.staffIds.includes(p.id)) : page.staff
  const days = Array.from({ length: Math.min(page.maxDaysAhead, 14) }, (_, i) => addDays(istToday(), i))

  async function book(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (form.name.trim().length < 2) x.name = "Enter your name"
    if (!/^[6-9]\d{9}$/.test(form.phone)) x.phone = "Enter a 10-digit mobile number"
    setErrors(x)
    if (Object.keys(x).length || !slot || !service) return
    setBusy(true)
    setError(null)
    try {
      setDone(await api.post(`/public/book/${slug}`, { itemId: service.id, staffId: staffId || null, startAt: slot.startAt, name: form.name.trim(), phone: form.phone, notes: form.notes.trim() || null }))
    } catch (err) {
      if (err instanceof ApiError && err.fields.startAt) { setSlot(null); setVersion((v) => v + 1) }
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  if (done) return (
    <Shell page={page}>
      <div className="grid justify-items-center gap-3 py-10 text-center">
        <CheckCircle2 className="size-14 text-emerald-500" />
        <h2 className="text-xl font-bold">{done.status === "confirmed" ? "You're booked!" : "Request received"}</h2>
        <p className="text-sm text-neutral-600">{done.service} on {dayLabel(done.date, { weekday: "long", day: "numeric", month: "long" })} at {done.time}{done.staff ? ` with ${done.staff}` : ""}.</p>
        <p className="text-sm text-neutral-500">{done.status === "confirmed" ? "See you then." : `${page.business.name} will confirm it with you shortly.`}</p>
        {page.business.phone && <a href={`tel:${page.business.phone}`} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700"><Phone className="size-4" /> {page.business.phone}</a>}
      </div>
    </Shell>
  )

  return (
    <Shell page={page}>
      {!service ? (
        <Step n={1} title="Choose a service">
          <div className="grid gap-2">
            {page.services.map((s) => (
              <button key={s.id} type="button" onClick={() => { setServiceId(s.id); setStaffId(""); setSlot(null) }} className="flex items-center justify-between gap-3 rounded-2xl border bg-white p-4 text-left transition hover:border-emerald-500 hover:shadow-sm">
                <span className="min-w-0"><span className="block font-semibold">{s.name}</span><span className="flex items-center gap-1 text-xs text-neutral-500"><Clock className="size-3" />{s.durationMin} min</span>{s.description && <span className="mt-1 block text-xs text-neutral-500">{s.description}</span>}</span>
                <span className="font-semibold tabular-nums">{formatPaise(s.pricePaise)}</span>
              </button>
            ))}
            {!page.services.length && <p className="text-sm text-neutral-500">No services are open for online booking right now.</p>}
          </div>
        </Step>
      ) : (
        <div className="grid gap-5">
          <button type="button" onClick={() => setServiceId(null)} className="flex w-fit items-center gap-1.5 text-sm font-medium text-emerald-700"><ArrowLeft className="size-4" /> {service.name} · {service.durationMin} min · {formatPaise(service.pricePaise)}</button>
          {people.length > 1 && (
            <Step n={2} title="With whom">
              <div className="flex flex-wrap gap-2">
                {[{ id: "", name: "Anyone free" }, ...people].map((p) => <button key={p.id} type="button" onClick={() => { setStaffId(p.id); setSlot(null) }} className={cn("inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1.5 text-sm", staffId === p.id ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800" : "hover:border-emerald-500")}><User className="size-3.5" />{p.name}</button>)}
              </div>
            </Step>
          )}
          <Step n={people.length > 1 ? 3 : 2} title="Pick a day and time">
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {days.map((d) => <button key={d} type="button" onClick={() => { setDate(d); setSlot(null) }} className={cn("grid min-w-14 justify-items-center rounded-xl border bg-white px-2 py-1.5 text-xs", date === d ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "hover:border-emerald-500")}><span className="font-medium">{dayLabel(d, { weekday: "short" })}</span><span className="text-base font-bold">{dayLabel(d, { day: "numeric" })}</span><span>{dayLabel(d, { month: "short" })}</span></button>)}
            </div>
            {!slots ? <p className="py-4 text-sm text-neutral-500">Finding free times…</p> : slots.length ? (
              <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                {slots.map((s) => <button key={s.startAt} type="button" onClick={() => setSlot(s)} className={cn("rounded-lg border bg-white py-2 text-sm font-medium tabular-nums", slot?.startAt === s.startAt ? "border-emerald-600 bg-emerald-600 text-white" : "hover:border-emerald-500")}>{s.time}</button>)}
              </div>
            ) : <p className="py-4 text-sm text-neutral-500">No free time that day. Please pick another day.</p>}
          </Step>
          {slot && (
            <Step n={people.length > 1 ? 4 : 3} title="Your details">
              <form onSubmit={book} className="grid gap-3" noValidate>
                <label className="grid gap-1 text-sm"><span className="font-medium">Name <span className="text-rose-600">*</span></span><Input value={form.name} maxLength={120} onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors({}) }} aria-invalid={!!errors.name} />{errors.name && <span className="text-xs text-rose-600">{errors.name}</span>}</label>
                <label className="grid gap-1 text-sm"><span className="font-medium">Mobile <span className="text-rose-600">*</span></span><Input inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => { setForm({ ...form, phone: e.target.value.replace(/\D/g, "") }); setErrors({}) }} aria-invalid={!!errors.phone} placeholder="10-digit number" />{errors.phone && <span className="text-xs text-rose-600">{errors.phone}</span>}</label>
                <label className="grid gap-1 text-sm"><span className="font-medium">Anything we should know</span><Textarea rows={2} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
                {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
                <Button type="submit" disabled={busy} className="h-11 bg-emerald-600 text-white hover:bg-emerald-700">{busy ? "Booking…" : `Book ${dayLabel(date, { day: "numeric", month: "short" })} at ${slot.time}`}</Button>
              </form>
            </Step>
          )}
        </div>
      )}
    </Shell>
  )
}

function Shell({ page, children }: { page?: PageData; children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-neutral-100 px-4 py-6 text-neutral-900">
      <div className="mx-auto grid max-w-xl gap-5">
        {page && (
          <header className="grid gap-1 rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {page.business.logoUrl ? <img src={page.business.logoUrl} alt="" className="size-12 rounded-xl object-cover" /> : <span className="grid size-12 place-items-center rounded-xl bg-emerald-600 text-lg font-bold text-white">{page.business.name.slice(0, 1)}</span>}
              <div className="min-w-0"><h1 className="truncate text-lg font-bold">{page.title}</h1><p className="flex items-center gap-1 text-xs text-neutral-500">{page.business.name}{page.business.city && <><MapPin className="size-3" />{page.business.city}</>}</p></div>
            </div>
            {page.intro && <p className="mt-2 text-sm text-neutral-600">{page.intro}</p>}
          </header>
        )}
        <main className="rounded-3xl bg-white/60 p-1">{children}</main>
        <p className="text-center text-[11px] text-neutral-400">Booking by AHEAD</p>
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-3xl bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold"><span className="grid size-6 place-items-center rounded-full bg-emerald-600 text-xs text-white">{n}</span>{title}</h2>
      {children}
    </section>
  )
}
