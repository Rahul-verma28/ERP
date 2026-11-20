"use client"

import * as React from "react"
import { CheckCircle2, Clock, LifeBuoy, Phone, Send, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { api, errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

// A customer's private link to their request: where it stands, the business's replies, a box to
// write back (which brings a resolved request back to the team), and a rating once it is resolved.

interface Request {
  business: { name: string; phone: string | null; logoUrl: string | null }
  number: string
  subject: string
  status: string
  statusLabel: string
  createdAt: string
  resolvedAt: string | null
  category: string
  rating: number | null
  feedback: string | null
  canRate: boolean
  canReply: boolean
  messages: { id: string; kind: "reply" | "customer" | "event"; at: string; body: string | null; from: string | null }[]
}
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
const TONE: Record<string, string> = { new: "bg-blue-100 text-blue-800", open: "bg-violet-100 text-violet-800", pending: "bg-amber-100 text-amber-800", on_hold: "bg-neutral-200 text-neutral-700", resolved: "bg-emerald-100 text-emerald-800", closed: "bg-neutral-200 text-neutral-700" }

export default function RequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = React.use(params)
  const [r, setR] = React.useState<Request | null>(null)
  const [gone, setGone] = React.useState(false)
  const [body, setBody] = React.useState("")
  const [stars, setStars] = React.useState(0)
  const [feedback, setFeedback] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { api.get<Request>(`/public/requests/${token}`).then(setR).catch(() => setGone(true)) }, [token])

  if (gone) return <Shell><div className="grid place-items-center gap-2 py-20 text-center"><LifeBuoy className="size-10 text-neutral-400" /><p className="font-semibold">This link doesn&apos;t work</p><p className="text-sm text-neutral-500">Check the link, or call the business with your request number.</p></div></Shell>
  if (!r) return <Shell><p className="py-20 text-center text-sm text-neutral-500">Loading…</p></Shell>

  async function send(path: "reply" | "rate", payload: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      setR(await api.post<Request>(`/public/requests/${token}/${path}`, payload))
      setBody("")
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell r={r}>
      <section className="grid gap-2 rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-sm font-semibold text-emerald-700">{r.number}</span>
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", TONE[r.status] ?? TONE.open)}>{r.statusLabel}</span>
        </div>
        <h2 className="text-lg font-bold">{r.subject}</h2>
        <p className="flex items-center gap-1.5 text-xs text-neutral-500"><Clock className="size-3.5" /> Raised {when(r.createdAt)} · {r.category}{r.resolvedAt ? ` · resolved ${when(r.resolvedAt)}` : ""}</p>
      </section>

      <section className="grid gap-3 rounded-3xl bg-white p-5 shadow-sm">
        <h3 className="font-semibold">Updates</h3>
        <ol className="grid gap-3">
          {r.messages.map((m) => m.kind === "event" ? (
            <li key={m.id} className="flex items-center gap-2 text-xs text-neutral-500"><span className="h-px flex-1 bg-neutral-200" />{m.body} · {when(m.at)}<span className="h-px flex-1 bg-neutral-200" /></li>
          ) : (
            <li key={m.id} className={cn("max-w-[88%] rounded-2xl px-4 py-2.5 text-sm", m.kind === "customer" ? "ml-auto bg-emerald-600 text-white" : "bg-neutral-100")}>
              <p className={cn("mb-0.5 text-[11px]", m.kind === "customer" ? "text-emerald-100" : "text-neutral-500")}>{m.from} · {when(m.at)}</p>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </li>
          ))}
        </ol>
        {r.canReply ? (
          <form onSubmit={(e) => { e.preventDefault(); if (body.trim().length < 2) return setError("Write something"); void send("reply", { body: body.trim() }) }} className="grid gap-2 border-t pt-3">
            <Textarea rows={3} maxLength={3000} className="bg-white" value={body} onChange={(e) => { setBody(e.target.value); setError(null) }} placeholder={r.status === "resolved" ? "Still a problem? Write here and it goes back to the team." : "Write back to the team"} aria-label="Your message" />
            <Button type="submit" disabled={busy} className="justify-self-end bg-emerald-600 text-white hover:bg-emerald-700"><Send /> {busy ? "Sending…" : "Send"}</Button>
          </form>
        ) : <p className="border-t pt-3 text-sm text-neutral-500">This request is closed. For anything new, please raise another request.</p>}
      </section>

      {r.canRate && (
        <section className="grid gap-3 rounded-3xl bg-white p-5 shadow-sm">
          <h3 className="font-semibold">How did we do?</h3>
          <div className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => setStars(n)}><Star className={cn("size-8", n <= stars ? "fill-amber-400 text-amber-400" : "text-neutral-300")} /></button>)}</div>
          <Textarea rows={2} maxLength={1000} className="bg-white" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Anything we could do better (optional)" aria-label="Feedback" />
          <Button type="button" disabled={busy || !stars} onClick={() => void send("rate", { rating: stars, feedback: feedback.trim() || null })} className="justify-self-end bg-emerald-600 text-white hover:bg-emerald-700">Send rating</Button>
        </section>
      )}
      {r.rating && <p className="flex items-center justify-center gap-1.5 text-sm text-neutral-600"><CheckCircle2 className="size-4 text-emerald-600" /> Thank you for rating us {r.rating}/5.</p>}
      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
    </Shell>
  )
}

function Shell({ r, children }: { r?: Request; children: React.ReactNode }) {
  return (
    <div className="light-scope min-h-svh bg-neutral-100 px-4 py-6 text-neutral-900">
      <div className="mx-auto grid max-w-xl gap-4">
        {r && (
          <header className="flex items-center gap-3 rounded-3xl bg-white p-4 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {r.business.logoUrl ? <img src={r.business.logoUrl} alt="" className="size-10 rounded-xl object-cover" /> : <span className="grid size-10 place-items-center rounded-xl bg-emerald-600 font-bold text-white">{r.business.name.slice(0, 1)}</span>}
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{r.business.name}</span><span className="text-xs text-neutral-500">Your request</span></span>
            {r.business.phone && <a href={`tel:${r.business.phone}`} className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700"><Phone className="size-4" /> Call</a>}
          </header>
        )}
        <main className="grid gap-4">{children}</main>
        <p className="text-center text-[11px] text-neutral-400">Support by AHEAD</p>
      </div>
    </div>
  )
}
