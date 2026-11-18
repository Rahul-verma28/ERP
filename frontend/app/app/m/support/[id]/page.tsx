"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlarmClock, BookOpen, CheckCircle2, Clock, Copy, Lock, Mail, MessageCircle, Pencil, Phone, RotateCcw, Send, ShieldCheck, ShieldX, Star, Trash2, UserCheck } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog, Spinner } from "@/components/common"
import { NativeSelect } from "@/components/form"
import { ActionMenu, Avatar, BackLink, DetailHeader, DetailList, Pill, Section, StatGrid, Steps, Tabs } from "@/components/page-parts"
import { PageError, PageLoading } from "@/components/page-states"
import { AboutCard, RecordHistory, useTabParam } from "@/components/record-kit"
import { ResolveDialog, TicketDialog } from "@/components/support/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatDateTime, formatPaise } from "@/lib/format"
import { CHANNEL, OPEN_STATUSES, PRIORITY, STATUS, categoryOf, duration, slaText, useAgents, useSupportSettings, waLink, type Article, type Message, type Ticket, type TicketPriority, type TicketStatus } from "@/lib/support"
import { cn } from "@/lib/utils"

// One ticket: the conversation with the customer (and the team's internal notes), the SLA clocks,
// who has it, the product and its warranty, and its history. Reply, take it, put it on hold or
// resolve it from here; a reply can go on WhatsApp or email too.

type Tab = "conversation" | "history"
const TABS: Tab[] = ["conversation", "history"]
const EVENT: Record<string, (m: Message, agent: (id: string | null) => string) => string> = {
  created: () => "Ticket created",
  raised: () => "Raised by the customer on the request form",
  status: (m) => `Status: ${STATUS[(m.meta?.to as TicketStatus) ?? "open"]?.label ?? m.meta?.to}${m.meta?.byCustomer ? " (customer replied)" : ""}`,
  reopened: (m) => `Reopened${m.meta?.byCustomer ? " by the customer's reply" : ""}`,
  assigned: (m, agent) => (m.meta?.to ? `Given to ${agent(m.meta.to as string)}` : "Taken off the person"),
  priority: (m) => `Priority: ${PRIORITY[m.meta?.from as TicketPriority]?.label} → ${PRIORITY[m.meta?.to as TicketPriority]?.label}`,
  category: () => "Category changed",
  closed: (m) => (m.meta?.auto ? "Closed by itself after the resolved days" : "Closed"),
  rated: (m) => `Customer rated ${m.meta?.rating}/5`,
}

function Thread({ t, agent }: { t: Ticket; agent: (id: string | null) => string }) {
  const first = t.description ? [{ id: "desc", kind: "customer" as const, body: t.description, by: t.customer.name ?? "Customer", authorId: null, meta: null, createdAt: t.createdAt }] : []
  return (
    <ol className="grid gap-3">
      {[...first, ...t.messages].map((m) => {
        if (m.kind === "event") return <li key={m.id} className="flex items-center gap-2 px-1 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />{(EVENT[m.body ?? ""] ?? (() => m.body ?? ""))(m, agent)} · {formatDateTime(m.createdAt)}<span className="h-px flex-1 bg-border" /></li>
        const mine = m.kind === "reply" || m.kind === "note"
        return (
          <li key={m.id} className={cn("flex gap-3", mine && "flex-row-reverse")}>
            <Avatar name={m.by} className="size-8 shrink-0" />
            <div className={cn("max-w-[85%] rounded-2xl border px-4 py-2.5 text-sm", m.kind === "note" ? "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10" : m.kind === "reply" ? "border-primary/20 bg-primary/5" : "bg-card")}>
              <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><span className="font-semibold text-foreground">{m.by}</span>{m.kind === "note" && <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><Lock className="size-3" /> Internal note</span>}{m.kind === "reply" && m.meta?.channel && m.meta.channel !== "portal" ? <span>· sent on {String(m.meta.channel) === "whatsapp" ? "WhatsApp" : String(m.meta.channel)}</span> : null}<span>· {formatDateTime(m.createdAt)}</span></p>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </div>
          </li>
        )
      })}
      {!first.length && !t.messages.some((m) => m.kind !== "event") && <li className="py-6 text-center text-sm text-muted-foreground">No messages yet. Write the first reply below.</li>}
    </ol>
  )
}

function ReplyBox({ t, onSent }: { t: Ticket; onSent: () => void }) {
  const { can } = useAuth()
  const [kind, setKind] = React.useState<"reply" | "note">("reply")
  const [body, setBody] = React.useState("")
  const [then, setThen] = React.useState<"" | "pending" | "on_hold" | "resolved">("")
  const [articleId, setArticleId] = React.useState<string | undefined>()
  const [busy, setBusy] = React.useState(false)
  const replies = useApi<{ data: Article[] }>(can("support.kb.view") ? "/support/articles?kind=reply" : null)
  const name = t.customer.person ?? t.customer.name ?? ""
  if (t.status === "closed") return <p className="rounded-2xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">This ticket is closed. Reopen it to reply.</p>

  async function send(channel: "portal" | "whatsapp" | "email") {
    if (!body.trim()) return toast.error("Write the reply first")
    if (channel === "whatsapp" && t.customer.phone) window.open(waLink(t.customer.phone, body.trim()), "_blank")
    if (channel === "email" && t.customer.email) window.open(`mailto:${t.customer.email}?subject=${encodeURIComponent(`${t.number}: ${t.subject}`)}&body=${encodeURIComponent(body.trim())}`)
    setBusy(true)
    try {
      await api.post(`/support/tickets/${t.id}/replies`, { body: body.trim(), kind, channel, then: kind === "reply" && then ? then : undefined, articleId })
      toast.success(kind === "note" ? "Note added" : then === "resolved" ? "Replied and resolved" : "Reply saved")
      setBody("")
      setThen("")
      setArticleId(undefined)
      onSent()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={cn("grid gap-3 rounded-2xl border p-3", kind === "note" ? "border-amber-200 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5" : "bg-card")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border bg-background p-0.5 text-sm" role="radiogroup" aria-label="Reply or note">
          {(["reply", "note"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn("rounded-[10px] px-3 py-1 font-medium text-muted-foreground", kind === k && "bg-primary text-primary-foreground")}>{k === "reply" ? "Reply to customer" : "Internal note"}</button>)}
        </div>
        {!!replies.data?.data.length && (
          <div className="ml-auto w-56"><NativeSelect value="" aria-label="Saved reply" onChange={(e) => { const a = replies.data!.data.find((r) => r.id === e.target.value); if (a) { setBody((b) => `${b}${b ? "\n" : ""}${a.body.replace(/\{name\}/g, name)}`); setArticleId(a.id) } }}><option value="">Insert a saved reply…</option>{replies.data.data.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</NativeSelect></div>
        )}
      </div>
      <Textarea rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "note" ? "Only your team sees this" : `Write to ${name || "the customer"}…`} aria-label="Message" />
      <div className="flex flex-wrap items-center gap-2">
        {kind === "reply" && (
          <div className="w-52"><NativeSelect value={then} onChange={(e) => setThen(e.target.value as typeof then)} aria-label="After sending"><option value="">Keep it open</option><option value="pending">Then wait for the customer</option><option value="on_hold">Then put on hold</option><option value="resolved">Then mark resolved</option></NativeSelect></div>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          {kind === "reply" && t.customer.phone && <Button type="button" variant="outline" disabled={busy} className="text-emerald-700 dark:text-emerald-300" onClick={() => void send("whatsapp")}><MessageCircle /> WhatsApp</Button>}
          {kind === "reply" && t.customer.email && <Button type="button" variant="outline" disabled={busy} onClick={() => void send("email")}><Mail /> Email</Button>}
          <Button type="button" disabled={busy} onClick={() => void send("portal")}>{busy ? "Saving…" : kind === "note" ? <><Lock /> Add note</> : <><Send /> Save reply</>}</Button>
        </span>
      </div>
      {kind === "reply" && <p className="text-[11px] text-muted-foreground">The customer sees replies on their request link. WhatsApp and Email open with the text ready, and the reply is kept here.</p>}
    </div>
  )
}

function TicketPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can } = useAuth()
  const { data: t, error, reload } = useApi<Ticket>(`/support/tickets/${id}`)
  const settings = useSupportSettings().data
  const agents = useAgents().data
  const [tab, setTab] = useTabParam<Tab>(TABS, "conversation")
  const [editing, setEditing] = React.useState(false)
  const [resolving, setResolving] = React.useState<"resolved" | "closed" | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [now] = React.useState(() => Date.now())
  if (error) return <PageError error={error} onRetry={() => void reload()} />
  if (!t) return <PageLoading />
  const canEdit = can("support.ticket.edit")
  const open = OPEN_STATUSES.includes(t.status)
  const cat = categoryOf(settings?.categories, t.category)
  const agent = (aid: string | null) => (aid ? agents?.data.find((a) => a.id === aid)?.name ?? "someone" : "nobody")
  const me = agents?.me
  const first = slaText(t.firstResponseDue, t.firstResponseAt, now)
  const fix = slaText(t.resolveDue, t.resolvedAt, now)
  const link = typeof window !== "undefined" ? `${window.location.origin}/request/${t.publicToken}` : ""

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true)
    try {
      await api.patch(`/support/tickets/${t!.id}`, { ...body, version: t!.version })
      toast.success(done)
      await reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const steps = (["new", "open", "pending", "resolved", "closed"] as TicketStatus[]).map((s, i, all) => {
    const at = all.indexOf(t.status === "on_hold" ? "pending" : t.status)
    return { key: s, label: s === "pending" && t.status === "on_hold" ? "On hold" : STATUS[s].label, state: (i < at ? "done" : i === at ? "current" : "todo") as "done" | "current" | "todo", color: STATUS[s].color }
  })

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/support">Tickets</BackLink>
      <DetailHeader
        title={<><span className="font-mono text-lg text-primary">{t.number}</span> {t.subject}</>}
        pills={<><Pill color={STATUS[t.status].color}>{STATUS[t.status].label}</Pill><Pill color={PRIORITY[t.priority].color} dot>{PRIORITY[t.priority].label}</Pill><Pill color={cat.color}>{cat.label}</Pill>{t.reopened > 0 && <Pill color="amber">Reopened {t.reopened}×</Pill>}</>}
        subtitle={`${t.customer.name ?? "Customer"} · came in by ${CHANNEL[t.channel]} · ${formatDateTime(t.createdAt)}`}
        extra={t.labels.length ? <span className="flex flex-wrap gap-1">{t.labels.map((l) => <span key={l} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{l}</span>)}</span> : undefined}
        actions={<>
          {canEdit && open && !t.assigneeId && me && agents?.data.some((a) => a.id === me) && <Button variant="outline" disabled={busy} onClick={() => void patch({ assigneeId: me }, "It's yours")}><UserCheck /> Take it</Button>}
          {canEdit && open && <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setResolving("resolved")}><CheckCircle2 /> Resolve</Button>}
          {canEdit && !open && <Button variant="outline" disabled={busy} onClick={() => void patch({ status: "open" }, "Reopened")}><RotateCcw /> Reopen</Button>}
          {canEdit && t.status !== "closed" && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
          <ActionMenu items={[
            { label: "Copy the customer's link", icon: Copy, onClick: () => void navigator.clipboard?.writeText(link).then(() => toast.success("Link copied. The customer can follow and reply there.")) },
            t.customer.phone && { label: "Send the link on WhatsApp", icon: MessageCircle, onClick: () => window.open(waLink(t.customer.phone!, `Hello ${t.customer.person ?? t.customer.name}, your request ${t.number} is noted. Follow it here: ${link}`), "_blank") },
            t.customer.phone && { label: "Call", icon: Phone, href: `tel:${t.customer.phone}` },
            "-",
            canEdit && open && t.status !== "pending" && { label: "Waiting on customer", onClick: () => void patch({ status: "pending" }, "Waiting on the customer") },
            canEdit && open && t.status !== "on_hold" && { label: "Put on hold", onClick: () => void patch({ status: "on_hold" }, "On hold") },
            canEdit && t.status === "resolved" && { label: "Close", onClick: () => setResolving("closed") },
            canEdit && open && { label: "Close without a fix", onClick: () => setResolving("closed") },
            "-",
            can("support.ticket.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(true) },
          ]} />
        </>}
      />
      <Steps steps={steps} label="Status" onStep={canEdit ? (k) => { if (k === "resolved") setResolving("resolved"); else if (k === "closed") setResolving("closed"); else if (k !== "new") void patch({ status: k }, `Status: ${STATUS[k as TicketStatus].label}`) } : undefined} />
      <StatGrid items={[
        { label: "First reply", value: t.firstResponseAt ? duration(Math.round((new Date(t.firstResponseAt).getTime() - new Date(t.createdAt).getTime()) / 60_000)) : first?.text ?? "—", hint: t.firstResponseAt ? (t.firstResponseDue && new Date(t.firstResponseAt) <= new Date(t.firstResponseDue) ? "Within SLA" : "After the SLA") : t.firstResponseDue ? `Due ${formatDateTime(t.firstResponseDue)}` : undefined, icon: AlarmClock, color: t.firstResponseAt ? "emerald" : first?.late ? "rose" : "blue", accent: !t.firstResponseAt && first?.late ? "text-destructive" : undefined },
        { label: t.resolvedAt ? "Resolved in" : "Fix by", value: t.resolvedAt ? duration(Math.round((new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()) / 60_000)) : fix?.text ?? "—", hint: t.resolvedAt ? (t.resolveDue && new Date(t.resolvedAt) <= new Date(t.resolveDue) ? "Within SLA" : "After the SLA") : t.resolveDue ? `Due ${formatDateTime(t.resolveDue)}` : undefined, icon: Clock, color: t.resolvedAt ? "emerald" : fix?.late ? "rose" : "violet", accent: !t.resolvedAt && fix?.late ? "text-destructive" : undefined },
        { label: "Handled by", value: t.assignee?.name ?? "Nobody yet", hint: t.createdByName ? `Raised by ${t.createdByName}` : "Raised by the customer", icon: UserCheck, color: t.assignee ? "blue" : "amber" },
        { label: "Rating", value: t.rating ? `${t.rating} / 5` : "—", hint: t.feedback ?? (t.rating ? "No comment" : open ? "Asked when resolved" : "Not rated yet"), icon: Star, color: t.rating && t.rating <= 2 ? "rose" : "emerald" },
      ]} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: "conversation", label: "Conversation", count: t.messages.filter((m) => m.kind !== "event").length }, { key: "history", label: "History" }]} />

      {tab === "conversation" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="grid content-start gap-4">
            <Section title="Conversation" description="Replies the customer sees, and notes only your team sees">
              <Thread t={t} agent={agent} />
            </Section>
            {canEdit && <ReplyBox t={t} onSent={() => void reload()} />}
          </div>
          <div className="grid content-start gap-4">
            <Section title="Customer" action={t.customer.id ? <Link href={t.customer.type === "lead" ? `/app/m/crm/${t.customer.id}` : `/app/m/sales/customers/${t.customer.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Open</Link> : <span className="text-xs text-muted-foreground">Not in your customers</span>}>
              <div className="flex items-center gap-3"><Avatar name={t.customer.name ?? "?"} className="size-10" /><div className="min-w-0"><p className="truncate font-semibold">{t.customer.name}</p>{t.customer.person && <p className="text-xs text-muted-foreground">{t.customer.person}</p>}</div></div>
              <DetailList cols={1} items={[["Mobile", t.customer.phone ? <a href={`tel:${t.customer.phone}`} className="hover:underline">{t.customer.phone}</a> : null], ["Email", t.customer.email], t.customer.gstin ? ["GSTIN", <span key="g" className="font-mono text-xs">{t.customer.gstin}</span>] : null]} />
              {t.otherTickets.length > 0 && (
                <div className="mt-3 grid gap-1 border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground">Their other tickets</p>
                  {t.otherTickets.map((o) => <Link key={o.id} href={`/app/m/support/${o.id}`} className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-muted"><span className="min-w-0 truncate"><span className="font-mono text-xs text-primary">{o.number}</span> {o.subject}</span><Pill color={STATUS[o.status].color}>{STATUS[o.status].label}</Pill></Link>)}
                </div>
              )}
            </Section>
            <Section title="Details">
              <div className="grid gap-3 text-sm">
                {([
                  ["Status", <NativeSelect key="s" disabled={!canEdit || busy} value={t.status} onChange={(e) => { const v = e.target.value as TicketStatus; if (v === "resolved" || v === "closed") setResolving(v); else void patch({ status: v }, `Status: ${STATUS[v].label}`) }} aria-label="Status">{(Object.keys(STATUS) as TicketStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}</NativeSelect>],
                  ["Priority", <NativeSelect key="p" disabled={!canEdit || busy || !open} value={t.priority} onChange={(e) => void patch({ priority: e.target.value }, "Priority changed; SLA times updated")} aria-label="Priority">{(Object.keys(PRIORITY) as TicketPriority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}</NativeSelect>],
                  ["Handled by", <NativeSelect key="a" disabled={!canEdit || busy || !open} value={t.assigneeId ?? ""} onChange={(e) => void patch({ assigneeId: e.target.value || null }, e.target.value ? `Given to ${agent(e.target.value)}` : "Taken off")} aria-label="Handled by"><option value="">Not assigned</option>{(agents?.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect>],
                  ["Category", <NativeSelect key="c" disabled={!canEdit || busy || !open} value={t.category} onChange={(e) => void patch({ category: e.target.value }, "Category changed")} aria-label="Category">{(settings?.categories ?? [cat]).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</NativeSelect>],
                ] as [string, React.ReactNode][]).map(([k, v]) => <label key={k} className="grid gap-1"><span className="text-xs text-muted-foreground">{k}</span>{v}</label>)}
              </div>
            </Section>
            <Section title="Product & warranty">
              {!t.item && !t.serial && !t.invoice ? <p className="text-sm text-muted-foreground">No product or invoice linked. {canEdit && <button type="button" className="font-medium text-primary underline" onClick={() => setEditing(true)}>Add them</button>} to check the warranty.</p> : (
                <div className="grid gap-3">
                  <DetailList cols={1} items={[
                    ["Product", t.item ? <Link href={`/app/m/catalog/${t.item.id}`} className="hover:underline">{t.item.name}</Link> : null],
                    ["Serial / IMEI", t.serial ? <span className="font-mono text-xs">{t.serial}</span> : null],
                    ["Invoice", t.invoice ? <Link href={`/app/m/billing/${t.invoice.id}`} className="font-mono text-xs text-primary hover:underline">{t.invoice.number} · {formatDate(t.invoice.issueDate)} · {formatPaise(t.invoice.totalPaise)}</Link> : null],
                  ]} />
                  {t.warranty ? (
                    <div className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-sm", t.warranty.inWarranty ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200" : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200")}>
                      {t.warranty.inWarranty ? <ShieldCheck className="mt-0.5 size-4 shrink-0" /> : <ShieldX className="mt-0.5 size-4 shrink-0" />}
                      <span><span className="font-semibold">{t.warranty.inWarranty ? "In warranty" : "Out of warranty"}</span> till {formatDate(t.warranty.endsOn)}<span className="block text-xs opacity-80">Sold {formatDate(t.warranty.soldOn)}{t.warranty.fromSerial && t.warranty.invoice ? ` on ${t.warranty.invoice.number}` : ""} · {t.warranty.months} months</span></span>
                    </div>
                  ) : <p className="text-xs text-muted-foreground">No sale found for this serial or invoice, so the warranty can&apos;t be worked out.</p>}
                </div>
              )}
            </Section>
            <Section title="Help articles" action={<Link href="/app/m/support/knowledge" className={buttonVariants({ variant: "ghost", size: "sm" })}><BookOpen /> Open</Link>}>
              <p className="text-xs text-muted-foreground">Saved replies are in the reply box. Write common answers once in the knowledge base.</p>
            </Section>
          </div>
        </div>
      )}
      {tab === "history" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <RecordHistory kind="ticket" id={t.id} created={{ at: t.createdAt, by: t.createdByName ?? "the customer" }} />
          <AboutCard id={t.id} createdAt={t.createdAt} createdBy={t.createdByName ?? "Customer (request form)"} updatedAt={t.updatedAt} className="h-fit" />
        </div>
      )}

      {editing && <TicketDialog ticket={t} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload() }} />}
      {resolving && <ResolveDialog ticket={t} to={resolving} onClose={() => setResolving(null)} onSaved={() => { setResolving(null); void reload() }} />}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} destructive title={`Delete ${t.number}?`} description="The ticket and its whole conversation are removed. This can't be undone." confirmLabel="Delete" onConfirm={async () => { try { await api.delete(`/support/tickets/${t.id}`); toast.success("Ticket deleted"); router.push("/app/m/support") } catch (e) { toast.error(errorMessage(e)) } }} />
      {busy && <span className="sr-only"><Spinner /></span>}
    </div>
  )
}

export default function Page() {
  return <React.Suspense><TicketPage /></React.Suspense>
}
