"use client"

import * as React from "react"
import { Copy, Mail, MessageCircle, Smartphone } from "lucide-react"
import { cn } from "@/lib/utils"

// Development only: every SMS, WhatsApp and email the server would have sent (sign-in codes,
// portal codes, invitations), newest first, refreshing on its own. Live servers answer 404.

interface Msg { channel: "sms" | "whatsapp" | "email"; to: string; template: string; subject?: string; text: string; at: string }
const ICON = { sms: Smartphone, whatsapp: MessageCircle, email: Mail }
const codeIn = (text: string) => text.match(/\b(\d{6})\b/)?.[1] ?? null

export default function DevMessagesPage() {
  const [rows, setRows] = React.useState<Msg[] | null>(null)
  const [off, setOff] = React.useState(false)
  React.useEffect(() => {
    let live = true
    const load = () => fetch("/api/v1/dev/messages", { credentials: "omit" }).then(async (r) => {
      if (!live) return
      if (r.status === 404) return setOff(true)
      setRows(((await r.json()) as { data: Msg[] }).data)
    }).catch(() => undefined)
    void load()
    const t = setInterval(load, 3000)
    return () => { live = false; clearInterval(t) }
  }, [])
  return (
    <div className="light-scope min-h-svh bg-neutral-100 px-4 py-6 text-neutral-900">
      <div className="mx-auto grid max-w-2xl gap-4">
        <header className="rounded-3xl bg-white p-5 shadow-sm">
          <h1 className="text-lg font-bold">Dev messages</h1>
          <p className="text-sm text-neutral-600">SMS, WhatsApp and email the server would have sent while no provider is connected: sign-in and portal codes, invitations. Newest first; refreshes every 3 seconds. Only in development.</p>
        </header>
        {off && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">This server is not in development mode, so messages go to the real provider.</p>}
        {rows && !rows.length && <p className="rounded-3xl bg-white p-8 text-center text-sm text-neutral-500 shadow-sm">Nothing sent since the server started. Ask for a code and it shows here.</p>}
        {rows?.map((m, i) => {
          const I = ICON[m.channel] ?? Mail
          const code = codeIn(m.text)
          return (
            <article key={`${m.at}-${i}`} className="grid gap-2 rounded-3xl bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <I className="size-4 text-emerald-600" />
                <span className="font-semibold">{m.to}</span>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{m.template}</span>
                <span className="ml-auto text-xs text-neutral-500">{new Date(m.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
              </div>
              {m.subject && <p className="text-sm font-medium">{m.subject}</p>}
              <p className="text-sm whitespace-pre-wrap break-words text-neutral-700">{m.text}</p>
              {code && (
                <button type="button" onClick={() => void navigator.clipboard?.writeText(code)} className={cn("inline-flex w-fit items-center gap-2 rounded-xl border px-3 py-1.5 font-mono text-lg tracking-[.3em] hover:border-emerald-500")} title="Copy the code">
                  {code}<Copy className="size-4 text-neutral-400" />
                </button>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
