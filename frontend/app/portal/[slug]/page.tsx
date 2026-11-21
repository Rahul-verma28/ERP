"use client"

import * as React from "react"
import { AlertCircle, ArrowLeftRight, CalendarCheck, CheckCircle2, ChevronRight, ExternalLink, FileText, Home as HomeIcon, IndianRupee, LifeBuoy, LogOut, MapPin, Phone, Printer, Receipt, Wallet, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, errorMessage } from "@/lib/api"
import { formatPaise } from "@/lib/format"
import { DOC_KIND, DOC_STATUS, REQ_STATUS, loadSession, portalApi, saveSession, type Account, type Booking, type Doc, type Home, type PortalInfo, type PortalSession, type Request } from "@/lib/portal"
import { cn } from "@/lib/utils"

// The customer portal a business shares: sign in with a mobile number (a code by SMS) or the link
// the business sent; then the customer's dues and bills (open, print, pay by UPI), quotations to
// accept or decline, their statement, their requests and their bookings. No staff login involved.

type Tab = "home" | "bills" | "statement" | "requests" | "bookings"
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
const fyStart = () => { const t = new Date(Date.now() + 330 * 60_000); const y = t.getUTCMonth() >= 3 ? t.getUTCFullYear() : t.getUTCFullYear() - 1; return `${y}-04-01` }
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

export default function PortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = React.use(params)
  const [info, setInfo] = React.useState<PortalInfo | null>(null)
  const [gone, setGone] = React.useState(false)
  const [session, setSession] = React.useState<PortalSession | null | undefined>(undefined)
  const [linkError, setLinkError] = React.useState<string | null>(null)

  React.useEffect(() => {
    portalApi<PortalInfo>(slug, "").then(setInfo).catch(() => setGone(true))
    const link = new URLSearchParams(window.location.search).get("t")
    if (link) {
      window.history.replaceState(null, "", window.location.pathname)
      portalApi<{ token: string; accounts: Account[] }>(slug, "/link", { method: "POST", body: { token: link } })
        .then((r) => { const s = { token: r.token, accounts: r.accounts, accountId: r.accounts[0].id }; saveSession(slug, s); setSession(s) })
        .catch((e) => { setLinkError(errorMessage(e)); setSession(loadSession(slug)) })
    } else void Promise.resolve().then(() => setSession(loadSession(slug)))
  }, [slug])

  const signOut = React.useCallback(() => { saveSession(slug, null); setSession(null) }, [slug])

  if (gone) return <Shell><Empty icon={Wallet} title="This portal is not open" text="Please call the business." /></Shell>
  if (!info || session === undefined) return <Shell><p className="py-20 text-center text-sm text-neutral-500">Loading…</p></Shell>
  if (!session) return <Shell info={info}><SignIn slug={slug} note={linkError} onIn={(s) => { saveSession(slug, s); setSession(s) }} /></Shell>
  return <Portal slug={slug} info={info} session={session} onSession={(s) => { saveSession(slug, s); setSession(s) }} onSignOut={signOut} />
}

// ---------------------------------------------------------------- sign in

function SignIn({ slug, note, onIn }: { slug: string; note: string | null; onIn: (s: PortalSession) => void }) {
  const [mobile, setMobile] = React.useState("")
  const [code, setCode] = React.useState("")
  const [step, setStep] = React.useState<"mobile" | "code">("mobile")
  const [dev, setDev] = React.useState<string | null>(null)
  const [devNote, setDevNote] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(note)
  const [busy, setBusy] = React.useState(false)
  const [accounts, setAccounts] = React.useState<{ token: string; accounts: Account[] } | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!/^[6-9]\d{9}$/.test(mobile)) return setError("Enter your 10-digit mobile number")
    setBusy(true); setError(null)
    try {
      const r = await portalApi<{ sent: boolean; devCode?: string; devNote?: string }>(slug, "/code", { method: "POST", body: { mobile } })
      setDev(r.devCode ?? null); setDevNote(r.devNote ?? null); setStep("code")
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code")
    setBusy(true); setError(null)
    try {
      const r = await portalApi<{ token: string; accounts: Account[] }>(slug, "/verify", { method: "POST", body: { mobile, code } })
      if (r.accounts.length === 1) onIn({ token: r.token, accounts: r.accounts, accountId: r.accounts[0].id })
      else setAccounts(r)
    } catch (err) {
      const left = err instanceof ApiError ? (err.details as { attemptsLeft?: number } | undefined)?.attemptsLeft : undefined
      setError(`${errorMessage(err)}${left !== undefined ? ` ${left} tries left.` : ""}`)
    } finally { setBusy(false) }
  }

  if (accounts) return (
    <Card title="Which account?">
      <p className="text-sm text-neutral-600">Your number is on more than one account. Choose one; you can switch later.</p>
      <div className="grid gap-2">{accounts.accounts.map((a) => <button key={a.id} type="button" onClick={() => onIn({ token: accounts.token, accounts: accounts.accounts, accountId: a.id })} className="flex items-center justify-between gap-3 rounded-2xl border bg-white p-4 text-left hover:border-emerald-500"><span><span className="block font-semibold">{a.name}</span><span className="text-xs text-neutral-500">{[a.person, a.gstin].filter(Boolean).join(" · ")}</span></span><ChevronRight className="size-4 text-neutral-400" /></button>)}</div>
    </Card>
  )
  return (
    <Card title="Sign in">
      <p className="text-sm text-neutral-600">Use the mobile number you gave the business. We send a 6-digit code by SMS.</p>
      {step === "mobile" ? (
        <form onSubmit={send} className="grid gap-3" noValidate>
          <label className="grid gap-1 text-sm"><span className="font-medium">Mobile number</span><Input className="h-11 bg-white" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={mobile} onChange={(e) => { setMobile(e.target.value.replace(/\D/g, "")); setError(null) }} placeholder="10-digit number" autoFocus /></label>
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <Button type="submit" disabled={busy} className="h-11 bg-emerald-600 text-white hover:bg-emerald-700">{busy ? "Sending…" : "Send code"}</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="grid gap-3" noValidate>
          <p className="text-sm">If <strong>{mobile}</strong> is with the business, a code is on its way. <button type="button" className="font-medium text-emerald-700 underline" onClick={() => { setStep("mobile"); setCode(""); setError(null) }}>Change number</button></p>
          <label className="grid gap-1 text-sm"><span className="font-medium">Code</span><Input className="h-11 bg-white text-center text-lg tracking-[.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setError(null) }} autoFocus /></label>
          {dev && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Testing mode: the code is <strong className="font-mono tracking-widest">{dev}</strong> (also on <a href="/dev/messages" target="_blank" rel="noreferrer" className="underline">Dev messages</a>)</p>}
          {devNote && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Testing mode: {devNote}</p>}
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <Button type="submit" disabled={busy} className="h-11 bg-emerald-600 text-white hover:bg-emerald-700">{busy ? "Checking…" : "Sign in"}</Button>
          <button type="button" className="text-sm text-neutral-500 underline" onClick={(e) => void send(e as unknown as React.FormEvent)}>Send the code again</button>
        </form>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- the portal

function Portal({ slug, info, session, onSession, onSignOut }: { slug: string; info: PortalInfo; session: PortalSession; onSession: (s: PortalSession) => void; onSignOut: () => void }) {
  const [tab, setTab] = React.useState<Tab>("home")
  const [home, setHome] = React.useState<Home | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)
  const reload = () => setVersion((v) => v + 1)
  React.useEffect(() => {
    let off = false
    portalApi<Home>(slug, "/home", { session }).then((h) => !off && (setHome(h), setError(null))).catch((e) => {
      if (off) return
      if (e instanceof ApiError && e.status === 401) onSignOut()
      else setError(errorMessage(e))
    })
    return () => { off = true }
  }, [slug, session, version, onSignOut])
  const tabs: [Tab, string, React.ElementType, boolean][] = [
    ["home", "Home", HomeIcon, true], ["bills", info.parts.bills ? "Bills" : "Quotations", FileText, info.parts.bills || info.parts.quotes],
    ["statement", "Statement", Receipt, info.parts.statement], ["requests", "Requests", LifeBuoy, info.parts.requests], ["bookings", "Bookings", CalendarCheck, info.parts.bookings],
  ]
  const account = session.accounts.find((a) => a.id === session.accountId)

  return (
    <Shell info={info} wide right={<button type="button" onClick={onSignOut} className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800"><LogOut className="size-4" /> Sign out</button>}>
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-3xl bg-white px-5 py-4 shadow-sm">
        <span className="min-w-0"><span className="block text-xs text-neutral-500">Signed in as</span><span className="block truncate font-semibold">{account?.name ?? home?.customer.name}</span></span>
        {session.accounts.length > 1 && (
          <label className="flex items-center gap-2 text-sm"><ArrowLeftRight className="size-4 text-neutral-500" /><select className="rounded-lg border bg-white px-2 py-1" value={session.accountId} onChange={(e) => { onSession({ ...session, accountId: e.target.value }); setHome(null); setTab("home") }} aria-label="Account">{session.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        )}
      </section>
      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Portal">
        {tabs.filter((t) => t[3]).map(([k, l, I]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium", tab === k ? "border-emerald-600 bg-emerald-600 text-white" : "bg-white text-neutral-700 hover:border-emerald-500")}><I className="size-4" />{l}</button>)}
      </nav>
      {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {tab === "home" && (home ? <HomeTab home={home} info={info} go={setTab} /> : !error && <Loading />)}
      {tab === "bills" && <BillsTab slug={slug} session={session} info={info} onChanged={reload} />}
      {tab === "statement" && <StatementTab slug={slug} session={session} />}
      {tab === "requests" && <RequestsTab slug={slug} session={session} />}
      {tab === "bookings" && <BookingsTab slug={slug} session={session} />}
    </Shell>
  )
}

function HomeTab({ home, info, go }: { home: Home; info: PortalInfo; go: (t: Tab) => void }) {
  const d = home.dues
  return (
    <div className="grid gap-4">
      <section className={cn("grid gap-1 rounded-3xl p-5 text-white shadow-sm", d.overduePaise ? "bg-rose-600" : d.duePaise ? "bg-amber-600" : "bg-emerald-600")}>
        <span className="text-sm opacity-90">{d.duePaise ? "You owe" : "All clear"}</span>
        <span className="text-3xl font-bold tabular-nums">{formatPaise(d.duePaise)}</span>
        <span className="text-sm opacity-90">{d.overduePaise ? `${formatPaise(d.overduePaise)} is past its due date` : d.duePaise ? `${d.openBills} bill${d.openBills === 1 ? "" : "s"} open${d.nextDue ? ` · next due ${day(d.nextDue)}` : ""}` : "Nothing to pay right now. Thank you!"}</span>
        {d.creditPaise > 0 && <span className="text-xs opacity-90">You have {formatPaise(d.creditPaise)} of credit with us</span>}
        {d.duePaise > 0 && info.parts.bills && <Button onClick={() => go("bills")} className="mt-2 w-fit bg-white text-neutral-900 hover:bg-white/90"><IndianRupee /> See bills and pay</Button>}
      </section>
      <div className="grid grid-cols-2 gap-3">
        <Stat icon={Receipt} label="Bought this year" value={formatPaise(home.year.boughtPaise)} hint={`${home.year.bills} bills`} />
        <Stat icon={Wallet} label="Last payment" value={home.lastPayment ? formatPaise(home.lastPayment.amountPaise) : "—"} hint={home.lastPayment ? day(home.lastPayment.paidOn) : "None yet"} />
      </div>
      {(home.waiting.quotes > 0 || home.waiting.requests > 0) && (
        <section className="grid gap-2 rounded-3xl bg-white p-5 shadow-sm">
          {home.waiting.quotes > 0 && info.parts.quotes && <Row onClick={() => go("bills")} icon={FileText} title={`${home.waiting.quotes} quotation${home.waiting.quotes === 1 ? "" : "s"} waiting for you`} text="Accept or decline in one tap" />}
          {home.waiting.requests > 0 && info.parts.requests && <Row onClick={() => go("requests")} icon={LifeBuoy} title={`${home.waiting.requests} request${home.waiting.requests === 1 ? "" : "s"} open`} text="See what the team said" />}
        </section>
      )}
      {home.bookings.length > 0 && (
        <section className="grid gap-2 rounded-3xl bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Coming up</h3>
          {home.bookings.map((b) => <div key={b.id} className="flex items-center gap-3 text-sm"><CalendarCheck className="size-4 text-emerald-600" /><span className="min-w-0 flex-1 truncate">{b.service ?? b.title}</span><span className="shrink-0 text-neutral-500">{when(b.startAt)}</span></div>)}
        </section>
      )}
      <section className="grid gap-1 rounded-3xl bg-white p-5 text-sm shadow-sm">
        <h3 className="mb-1 font-semibold">Your details with us</h3>
        <p>{home.customer.name}{home.customer.person ? ` · ${home.customer.person}` : ""}</p>
        {home.customer.gstin && <p className="font-mono text-xs">GSTIN {home.customer.gstin}</p>}
        <p className="text-neutral-500">{[home.customer.phone, home.customer.email].filter(Boolean).join(" · ")}</p>
        {home.customer.address && <p className="text-neutral-500">{[home.customer.address.line1, home.customer.address.city, home.customer.address.pincode].filter(Boolean).join(", ")}</p>}
        <p className="mt-1 text-xs text-neutral-400">Something wrong here? Raise a request or call us.</p>
      </section>
    </div>
  )
}

function BillsTab({ slug, session, info, onChanged }: { slug: string; session: PortalSession; info: PortalInfo; onChanged: () => void }) {
  const [res, setRes] = React.useState<{ data: Doc[]; canReply: boolean } | null>(null)
  const [show, setShow] = React.useState<"due" | "all" | "quotes">(info.parts.bills ? "due" : "quotes")
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const load = React.useCallback(() => portalApi<{ data: Doc[]; canReply: boolean }>(slug, "/documents", { session }).then(setRes).catch((e) => setError(errorMessage(e))), [slug, session])
  React.useEffect(() => { void load() }, [load])
  async function reply(d: Doc, decision: "accepted" | "declined") {
    setBusy(d.id); setError(null)
    try { await portalApi(slug, `/quotes/${d.id}`, { session, method: "POST", body: { decision } }); await load(); onChanged() } catch (e) { setError(errorMessage(e)) } finally { setBusy(null) }
  }
  if (!res) return error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : <Loading />
  const rows = res.data.filter((d) => (show === "quotes" ? d.kind === "quotation" : d.kind !== "quotation" && (show === "all" || d.duePaise > 0)))
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {([["due", "To pay", info.parts.bills], ["all", "All bills", info.parts.bills], ["quotes", "Quotations", info.parts.quotes]] as const).filter((x) => x[2]).map(([k, l]) => <button key={k} type="button" onClick={() => setShow(k)} className={cn("rounded-full border px-3 py-1.5 text-sm", show === k ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800" : "bg-white")}>{l}</button>)}
      </div>
      {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {!rows.length && <Empty icon={show === "due" ? CheckCircle2 : FileText} title={show === "due" ? "Nothing to pay" : "Nothing here yet"} text={show === "due" ? "All your bills are paid." : ""} />}
      {rows.map((d) => {
        const st = d.kind === "quotation" && d.status === "sent" && d.dueDate && d.dueDate.slice(0, 10) < today() ? DOC_STATUS.expired : DOC_STATUS[d.status] ?? { label: d.status, tone: "bg-neutral-200" }
        return (
          <article key={d.id} className="grid gap-2 rounded-3xl bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0"><span className="block text-xs text-neutral-500">{DOC_KIND[d.kind]} · {day(d.issueDate)}</span><span className="block font-mono text-sm font-semibold">{d.number ?? "—"}</span></span>
              <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", d.overdue ? "bg-rose-100 text-rose-800" : st.tone)}>{d.overdue ? "Overdue" : st.label}</span>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <span><span className="block text-lg font-bold tabular-nums">{formatPaise(d.totalPaise)}</span>{d.duePaise > 0 && d.duePaise !== d.totalPaise && <span className="text-xs text-neutral-500">{formatPaise(d.duePaise)} left to pay</span>}{d.dueDate && d.kind !== "quotation" && d.duePaise > 0 && <span className={cn("block text-xs", d.overdue ? "text-rose-700" : "text-neutral-500")}>Due {day(d.dueDate)}</span>}{d.kind === "quotation" && d.dueDate && <span className="block text-xs text-neutral-500">Valid till {day(d.dueDate)}</span>}</span>
              <span className="flex flex-wrap gap-2">
                {d.shareToken && <a href={`/d/${d.shareToken}`} target="_blank" rel="noreferrer" className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium", d.duePaise > 0 ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border bg-white")}>{d.duePaise > 0 ? <><IndianRupee className="size-4" /> Open and pay</> : <><ExternalLink className="size-4" /> Open</>}</a>}
                {d.kind === "quotation" && d.status === "sent" && res.canReply && !(d.dueDate && d.dueDate.slice(0, 10) < today()) && <>
                  <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => void reply(d, "declined")}><XCircle /> Decline</Button>
                  <Button size="sm" disabled={busy === d.id} className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void reply(d, "accepted")}><CheckCircle2 /> Accept</Button>
                </>}
              </span>
            </div>
          </article>
        )
      })}
    </div>
  )
}

interface Statement { broughtForwardPaise: number; closingPaise: number; rows: { id: string; date: string; type: string; number: string | null; against: string | null; method: string | null; debitPaise: number; creditPaise: number; balancePaise: number }[] }
const ENTRY: Record<string, string> = { invoice: "Bill", credit_note: "Credit note", debit_note: "Debit note", opening_balance: "Opening balance", receipt: "Payment", advance: "Advance paid", refund: "Refund", reversal: "Payment reversed" }

function StatementTab({ slug, session }: { slug: string; session: PortalSession }) {
  const [from, setFrom] = React.useState(fyStart())
  const [to, setTo] = React.useState(today())
  const [res, setRes] = React.useState<{ key: string; data: Statement | null; error: string | null } | null>(null)
  const key = `${from}|${to}`
  React.useEffect(() => {
    let off = false
    portalApi<Statement>(slug, `/statement?from=${from}&to=${to}`, { session }).then((d) => !off && setRes({ key, data: d, error: null })).catch((e) => !off && setRes({ key, data: null, error: errorMessage(e) }))
    return () => { off = true }
  }, [slug, session, from, to, key])
  const s = res?.key === key ? res : null
  return (
    <section className="grid gap-3 rounded-3xl bg-white p-5 shadow-sm print:shadow-none">
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <label className="grid gap-1 text-xs"><span>From</span><Input type="date" className="h-9 bg-white" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label className="grid gap-1 text-xs"><span>To</span><Input type="date" className="h-9 bg-white" value={to} min={from} max={today()} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => window.print()}><Printer /> Download</Button>
      </div>
      {!s ? <Loading /> : s.error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{s.error}</p> : s.data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="border-b text-left text-xs text-neutral-500"><th className="py-2">Date</th><th>Entry</th><th className="text-right">Billed</th><th className="text-right">Paid</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              <tr className="border-b border-neutral-100 text-neutral-500"><td className="py-2" colSpan={4}>Brought forward</td><td className="text-right tabular-nums">{formatPaise(s.data.broughtForwardPaise)}</td></tr>
              {s.data.rows.map((r) => <tr key={r.id} className="border-b border-neutral-100"><td className="py-2 whitespace-nowrap">{day(r.date)}</td><td><span className="block">{ENTRY[r.type] ?? r.type} {r.number && <span className="font-mono text-xs">{r.number}</span>}</span>{r.against && <span className="text-xs text-neutral-500">for {r.against}</span>}</td><td className="text-right tabular-nums">{r.debitPaise ? formatPaise(r.debitPaise) : ""}</td><td className="text-right tabular-nums text-emerald-700">{r.creditPaise ? formatPaise(r.creditPaise) : ""}</td><td className="text-right font-medium tabular-nums">{formatPaise(r.balancePaise)}</td></tr>)}
              <tr className="font-semibold"><td className="py-2" colSpan={4}>{s.data.closingPaise > 0 ? "You owe" : s.data.closingPaise < 0 ? "We owe you" : "Settled"}</td><td className="text-right tabular-nums">{formatPaise(Math.abs(s.data.closingPaise))}</td></tr>
            </tbody>
          </table>
          {!s.data.rows.length && <p className="py-4 text-center text-sm text-neutral-500">Nothing in these dates.</p>}
        </div>
      )}
    </section>
  )
}

function RequestsTab({ slug, session }: { slug: string; session: PortalSession }) {
  const [res, setRes] = React.useState<{ data: Request[]; categories: { key: string; label: string }[] } | null>(null)
  const [bills, setBills] = React.useState<Doc[]>([])
  const [form, setForm] = React.useState<{ category: string; subject: string; description: string; invoiceId: string } | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState<string | null>(null)
  const load = React.useCallback(() => portalApi<{ data: Request[]; categories: { key: string; label: string }[] }>(slug, "/requests", { session }).then(setRes).catch((e) => setError(errorMessage(e))), [slug, session])
  React.useEffect(() => { void load(); portalApi<{ data: Doc[] }>(slug, "/documents", { session }).then((r) => setBills(r.data.filter((d) => d.kind === "invoice"))).catch(() => undefined) }, [load, slug, session])
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const f = form!
    const x: Record<string, string> = {}
    if (!f.category) x.category = "Pick what it is about"
    if (f.subject.trim().length < 3) x.subject = "Say what it is about"
    if (f.description.trim().length < 10) x.description = "Tell us a little more (at least 10 letters)"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true); setError(null)
    try {
      const r = await portalApi<{ number: string }>(slug, "/requests", { session, method: "POST", body: { category: f.category, subject: f.subject.trim(), description: f.description.trim(), invoiceId: f.invoiceId || null } })
      setDone(r.number); setForm(null); await load()
    } catch (err) { if (err instanceof ApiError) setErrors(err.fields); setError(errorMessage(err)) } finally { setBusy(false) }
  }
  if (!res) return error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : <Loading />
  return (
    <div className="grid gap-3">
      {done && <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="size-4" /> Request {done} received. We will update you here.</p>}
      {form ? (
        <form onSubmit={submit} className="grid gap-3 rounded-3xl bg-white p-5 shadow-sm" noValidate>
          <h3 className="font-semibold">New request</h3>
          <div className="grid gap-1 text-sm"><span className="font-medium">What is it about <span className="text-rose-600">*</span></span><div className="flex flex-wrap gap-2">{res.categories.map((c) => <button key={c.key} type="button" onClick={() => { setForm({ ...form, category: c.key }); setErrors({}) }} className={cn("rounded-full border px-3 py-1.5 text-sm", form.category === c.key ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800" : "bg-white")}>{c.label}</button>)}</div>{errors.category && <span className="text-xs text-rose-600">{errors.category}</span>}</div>
          <label className="grid gap-1 text-sm"><span className="font-medium">In one line <span className="text-rose-600">*</span></span><Input className="h-10 bg-white" maxLength={200} value={form.subject} onChange={(e) => { setForm({ ...form, subject: e.target.value }); setErrors({}) }} />{errors.subject && <span className="text-xs text-rose-600">{errors.subject}</span>}</label>
          <label className="grid gap-1 text-sm"><span className="font-medium">Details <span className="text-rose-600">*</span></span><Textarea rows={4} className="bg-white" maxLength={3000} value={form.description} onChange={(e) => { setForm({ ...form, description: e.target.value }); setErrors({}) }} />{errors.description && <span className="text-xs text-rose-600">{errors.description}</span>}</label>
          {bills.length > 0 && <label className="grid gap-1 text-sm"><span className="font-medium">About a bill</span><select className="h-10 rounded-xl border bg-white px-2" value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value })}><option value="">No bill</option>{bills.map((b) => <option key={b.id} value={b.id}>{b.number} · {day(b.issueDate)} · {formatPaise(b.totalPaise)}</option>)}</select></label>}
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setForm(null)}>Cancel</Button><Button type="submit" disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">{busy ? "Sending…" : "Send request"}</Button></div>
        </form>
      ) : <Button onClick={() => { setDone(null); setForm({ category: "", subject: "", description: "", invoiceId: "" }) }} className="h-11 w-fit bg-emerald-600 text-white hover:bg-emerald-700"><LifeBuoy /> Raise a request</Button>}
      {!res.data.length && !form && <Empty icon={LifeBuoy} title="No requests yet" text="Complaints, repairs and questions you raise show here." />}
      {res.data.map((r) => {
        const st = REQ_STATUS[r.status] ?? { label: r.status, tone: "bg-neutral-200" }
        return <a key={r.number} href={`/request/${r.publicToken}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-3xl bg-white p-4 shadow-sm hover:ring-1 hover:ring-emerald-500"><span className="min-w-0 flex-1"><span className="block text-xs text-neutral-500"><span className="font-mono">{r.number}</span> · {day(r.createdAt)}</span><span className="block truncate font-medium">{r.subject}</span></span><span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", st.tone)}>{st.label}</span><ChevronRight className="size-4 shrink-0 text-neutral-400" /></a>
      })}
    </div>
  )
}

function BookingsTab({ slug, session }: { slug: string; session: PortalSession }) {
  const [now] = React.useState(() => Date.now())
  const [res, setRes] = React.useState<{ data: Booking[]; bookingSlug: string | null } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { portalApi<{ data: Booking[]; bookingSlug: string | null }>(slug, "/bookings", { session }).then(setRes).catch((e) => setError(errorMessage(e))) }, [slug, session])
  if (!res) return error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : <Loading />
  const coming = res.data.filter((b) => new Date(b.startAt).getTime() >= now && ["scheduled", "confirmed"].includes(b.status)).reverse()
  const past = res.data.filter((b) => !coming.includes(b))
  const label: Record<string, string> = { scheduled: "Booked", confirmed: "Confirmed", completed: "Done", cancelled: "Cancelled", no_show: "Missed" }
  const item = (b: Booking) => <div key={b.id} className="flex items-center gap-3 rounded-2xl border bg-white p-3 text-sm"><CalendarCheck className={cn("size-5 shrink-0", b.status === "cancelled" || b.status === "no_show" ? "text-neutral-400" : "text-emerald-600")} /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{b.service ?? b.title}</span><span className="text-xs text-neutral-500">{when(b.startAt)}{b.staff ? ` · with ${b.staff}` : ""}</span></span><span className="shrink-0 text-xs text-neutral-500">{label[b.status] ?? b.status}</span></div>
  return (
    <div className="grid gap-3">
      {res.bookingSlug && <a href={`/book/${res.bookingSlug}`} target="_blank" rel="noreferrer" className="inline-flex h-11 w-fit items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"><CalendarCheck className="size-4" /> Book a visit</a>}
      <section className="grid gap-2 rounded-3xl bg-white p-5 shadow-sm"><h3 className="font-semibold">Coming up</h3>{coming.length ? coming.map(item) : <p className="text-sm text-neutral-500">Nothing booked.</p>}</section>
      {past.length > 0 && <section className="grid gap-2 rounded-3xl bg-white p-5 shadow-sm"><h3 className="font-semibold">Earlier</h3>{past.slice(0, 20).map(item)}</section>}
    </div>
  )
}

// ---------------------------------------------------------------- pieces

function Shell({ info, wide, right, children }: { info?: PortalInfo; wide?: boolean; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="light-scope min-h-svh bg-neutral-100 px-4 py-6 text-neutral-900 print:bg-white print:p-0">
      <div className={cn("mx-auto grid gap-4", wide ? "max-w-2xl" : "max-w-md")}>
        {info && (
          <header className="grid gap-1 rounded-3xl bg-white p-5 shadow-sm print:shadow-none">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {info.business.logoUrl ? <img src={info.business.logoUrl} alt="" className="size-12 rounded-xl object-cover" /> : <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-600 text-lg font-bold text-white">{info.business.name.slice(0, 1)}</span>}
              <div className="min-w-0 flex-1"><h1 className="truncate text-lg font-bold">{info.title}</h1><p className="flex items-center gap-1 text-xs text-neutral-500">{info.business.name}{info.business.city && <><MapPin className="size-3" />{info.business.city}</>}</p></div>
              {right && <span className="print:hidden">{right}</span>}
            </div>
            {info.intro && <p className="mt-1 text-sm text-neutral-600 print:hidden">{info.intro}</p>}
            {info.business.phone && <a href={`tel:${info.business.phone}`} className="mt-1 inline-flex w-fit items-center gap-1.5 text-sm font-medium text-emerald-700 print:hidden"><Phone className="size-4" /> {info.business.phone}</a>}
          </header>
        )}
        <main className="grid gap-4">{children}</main>
        <p className="text-center text-[11px] text-neutral-400 print:hidden">Customer portal by AHEAD</p>
      </div>
    </div>
  )
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="grid gap-3 rounded-3xl bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">{title}</h2>{children}</section>
}
function Stat({ icon: I, label, value, hint }: { icon: React.ElementType; label: string; value: string; hint: string }) {
  return <div className="grid gap-0.5 rounded-3xl bg-white p-4 shadow-sm"><span className="flex items-center gap-1.5 text-xs text-neutral-500"><I className="size-3.5" />{label}</span><span className="text-lg font-bold tabular-nums">{value}</span><span className="text-xs text-neutral-500">{hint}</span></div>
}
function Row({ icon: I, title, text, onClick }: { icon: React.ElementType; title: string; text: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-2xl border p-3 text-left hover:border-emerald-500"><I className="size-5 shrink-0 text-emerald-600" /><span className="min-w-0 flex-1"><span className="block font-medium">{title}</span><span className="text-xs text-neutral-500">{text}</span></span><ChevronRight className="size-4 text-neutral-400" /></button>
}
function Empty({ icon: I, title, text }: { icon: React.ElementType; title: string; text: string }) {
  return <div className="grid place-items-center gap-2 rounded-3xl bg-white py-12 text-center shadow-sm"><I className="size-10 text-neutral-300" /><p className="font-semibold">{title}</p>{text && <p className="max-w-xs text-sm text-neutral-500">{text}</p>}</div>
}
function Loading() {
  return <p className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-500"><AlertCircle className="size-4 animate-pulse" /> Loading…</p>
}
