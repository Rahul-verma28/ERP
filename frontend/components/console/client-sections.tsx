"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Check, CircleDashed, Clock, CreditCard, FileText, Megaphone, MessageSquare, Plus, Sparkles, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormError } from "@/components/form"
import { Chip, Empty, Facts, Failed, Loading, Panel, Row, ago, money, relDays, tomorrowAt11, type Tone } from "@/components/console/kit"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatDateTime, formatNumber } from "@/lib/format"
import { ORDER_STATUS_LABEL, type AccountHealth, type ClientDetail, type ClientSummary, type ClientUser, type OrderStatus, type TimelineEvent, type TimelineKind } from "@/lib/console"
import { cn } from "@/lib/utils"

// The one-page client view: plan & payments, activity & notes, owner, next step, setup and users.
// Counts and status only — never the client's business records.

const ORDER_TONE: Record<OrderStatus, Tone> = { pending_approval: "amber", awaiting_payment: "amber", paid: "green", cancelled: "grey" }

export function PlanAndPayments({ client }: { client: ClientDetail }) {
  const sub = client.subscription
  const partnerBilled = client.billedBy === "partner"
  const items = [
    { label: "Plan", value: client.status === "free" ? "Free" : sub?.plan ? `${sub.plan.name}${sub.cycle && !partnerBilled ? ` · ${sub.cycle === "yearly" ? "yearly" : "monthly"}` : ""}` : "—" },
    { label: "Billed by", value: partnerBilled ? `${client.partner?.name ?? "Partner"} (partner)` : "AHEAD" },
  ]
  if (client.status === "trialing" && sub?.trialEndsAt) items.push({ label: "Free trial ends", value: `${formatDate(sub.trialEndsAt)} (${relDays(sub.trialEndsAt)})` })
  if (sub?.currentPeriodEnd && !partnerBilled) items.push({ label: "Paid until", value: formatDate(sub.currentPeriodEnd) })
  if (sub?.graceEndsAt) items.push({ label: "Must pay by", value: formatDate(sub.graceEndsAt) })
  return (
    <Panel title="Plan & payments">
      <Facts items={items} />
      {!partnerBilled && (
        <div className="mt-5">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Orders</h3>
          {client.orders.length ? (
            <div className="divide-y rounded-xl border">
              {client.orders.map((o) => (
                <Link key={o.id} href={`/console/payments/${o.id}`} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50">
                  <CreditCard className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium tabular-nums">{money(o.totalPaise)}</span>
                    <span className="text-muted-foreground"> · {o.cycle} · {formatDate(o.createdAt)}</span>
                    {o.invoice && <span className="ml-2 font-mono text-xs text-muted-foreground">{o.invoice.number}</span>}
                  </span>
                  <Chip tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Chip>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          )}
        </div>
      )}
    </Panel>
  )
}

const KIND_ICON: Record<TimelineKind, { icon: typeof FileText; tone: Tone }> = {
  plan: { icon: Sparkles, tone: "blue" },
  payment: { icon: CreditCard, tone: "green" },
  note: { icon: MessageSquare, tone: "grey" },
  followup: { icon: Check, tone: "blue" },
  reminder: { icon: Megaphone, tone: "amber" },
  account: { icon: UserRound, tone: "grey" },
}

export function ActivityAndNotes({ tenantId }: { tenantId: string }) {
  const { canConsole } = useAuth()
  const { data, error, reload } = useApi<{ data: TimelineEvent[] }>(`/console/tenants/${tenantId}/timeline`)
  const [body, setBody] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/console/tenants/${tenantId}/notes`, { body, privateToTeam: false })
      setBody("")
      reload()
    } catch (x) {
      setErr(errorMessage(x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title="Activity & notes" description="What happened with this client. Notes are internal — the client never sees them.">
      {canConsole("platform.note.create") && (
        <form onSubmit={add} className="mb-4 grid gap-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Add a note — a call, a promise, what they asked for…" aria-label="New note" />
          <div className="flex items-center justify-between gap-2">
            <FormError message={err} />
            <Button type="submit" size="sm" className="ml-auto" disabled={busy || body.trim().length < 2}>
              {busy ? "Saving…" : "Add note"}
            </Button>
          </div>
        </form>
      )}
      {error ? (
        <Failed error={error} onRetry={reload} />
      ) : !data ? (
        <Loading rows={3} />
      ) : !data.data.length ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ol className="relative grid gap-1 before:absolute before:top-2 before:bottom-2 before:left-[17px] before:w-px before:bg-border">
          {data.data.slice(0, 30).map((ev) => {
            const k = KIND_ICON[ev.kind]
            return (
              <li key={ev.id} className="relative">
                <Row icon={k.icon} tone={k.tone} title={<span className="whitespace-normal">{ev.text}</span>} detail={`${ev.who ? `${ev.who} · ` : ""}${formatDateTime(ev.at)}`} />
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}

export function OwnerPanel({ client, showContact }: { client: ClientDetail; showContact: boolean }) {
  const o = client.owner
  return (
    <Panel title="Owner">
      {o ? (
        <Facts
          className="sm:grid-cols-1"
          items={[
            { label: "Name", value: o.name },
            ...(showContact ? [{ label: "Email", value: o.email }, { label: "Mobile", value: o.mobile }] : []),
            { label: "Last signed in", value: o.lastLoginAt ? ago(o.lastLoginAt) : "Not yet" },
          ]}
        />
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </Panel>
  )
}

export function NextStep({ tenantId }: { tenantId: string }) {
  const { canConsole } = useAuth()
  const { data, reload } = useApi<ClientSummary>(`/console/tenants/${tenantId}/summary`)
  const [adding, setAdding] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [due, setDue] = React.useState(tomorrowAt11)
  const [error, setError] = React.useState<string | null>(null)
  const next = data?.next
  async function close(body: { done?: boolean; snoozeDays?: number }) {
    try {
      await api.post(`/console/followups/${next!.id}/close`, body)
      toast.success(body.done ? "Done" : "Moved to tomorrow")
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.post("/console/followups", { title, dueAt: new Date(due).toISOString(), tenantId })
      setAdding(false)
      setTitle("")
      reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <Panel title="Next step">
      {!data ? (
        <Loading rows={1} />
      ) : next ? (
        <div className="grid gap-3">
          <div>
            <p className="text-sm font-medium">{next.title}</p>
            <p className={cn("text-[13px]", new Date(next.dueAt) < new Date() ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground")}>
              {new Date(next.dueAt) < new Date() ? "Overdue · " : ""}
              {formatDateTime(next.dueAt)}
              {next.owner ? ` · ${next.owner}` : ""}
            </p>
          </div>
          {canConsole("platform.prospect.edit") && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => close({ done: true })}>
                <Check /> Done
              </Button>
              <Button size="sm" variant="outline" onClick={() => close({ snoozeDays: 1 })}>
                <Clock /> Tomorrow
              </Button>
            </div>
          )}
        </div>
      ) : adding ? (
        <form onSubmit={add} className="grid gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call about the yearly plan" aria-label="What to do" required minLength={2} autoFocus />
          <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="When" required />
          <FormError message={error} />
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Nothing planned.</p>
          {canConsole("platform.prospect.create") && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus /> Plan a follow-up
            </Button>
          )}
        </div>
      )}
    </Panel>
  )
}

const limitText = (l: { used: number; max: number | null }) => `${formatNumber(l.used)} of ${l.max === null ? "unlimited" : formatNumber(l.max)}`

export function SetupAndUsage({ tenantId }: { tenantId: string }) {
  const { data: h, error, reload } = useApi<AccountHealth>(`/console/tenants/${tenantId}/health`)
  if (error) return <Failed error={error} onRetry={reload} />
  const done = h ? h.setup.filter((s) => s.state === "done").length : 0
  return (
    <Panel title="Setup & usage" description="Counts only — no business data">
      {!h ? (
        <Loading rows={3} />
      ) : (
        <div className="grid gap-5">
          <div>
            <div className="mb-1.5 flex justify-between text-[13px]">
              <span className="font-medium">Setup</span>
              <span className="text-muted-foreground">
                {done} of {h.setup.length} done
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(done / Math.max(1, h.setup.length)) * 100}%` }} />
            </div>
            <ul className="mt-3 grid gap-1.5">
              {h.setup.map((s) => (
                <li key={s.key} className="flex items-center gap-2 text-[13px]">
                  {s.state === "done" ? <Check className="size-4 text-emerald-600" /> : <CircleDashed className="size-4 text-muted-foreground" />}
                  <span className={s.state === "done" ? "" : "text-muted-foreground"}>{s.label}</span>
                  {s.state === "skipped" && <span className="text-xs text-muted-foreground">(skipped)</span>}
                </li>
              ))}
            </ul>
          </div>
          <Facts
            className="sm:grid-cols-2"
            items={[
              { label: "Customers", value: formatNumber(h.records.customers) },
              { label: "Invoices", value: formatNumber(h.records.invoices) },
              { label: "Users", value: limitText(h.limits.users) },
              { label: "Invoices this month", value: limitText(h.limits.invoicesThisMonth) },
            ]}
          />
          {(h.errors.failedJobs > 0 || h.errors.importBadRows > 0) && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              In the last 7 days: {h.errors.failedJobs} failed background job{h.errors.failedJobs === 1 ? "" : "s"}, {h.errors.importBadRows} import row{h.errors.importBadRows === 1 ? "" : "s"} with errors.
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

export function UsersPanel({ tenantId }: { tenantId: string }) {
  const { data, error, reload } = useApi<{ data: ClientUser[] }>(`/console/tenants/${tenantId}/users`)
  if (error) return <Failed error={error} onRetry={reload} />
  return (
    <Panel title={`Users${data ? ` · ${data.data.length}` : ""}`} description="Names and roles only" padded={false}>
      <div className="px-3 pb-3">
        {!data ? (
          <Loading rows={2} className="px-2" />
        ) : data.data.length ? (
          <div className="divide-y">
            {data.data.map((u) => (
              <Row key={u.id} icon={UserRound} tone="grey" title={u.name} detail={`${u.role}${u.status !== "active" ? ` · ${u.status}` : ""} · ${u.lastSignIn ? `signed in ${ago(u.lastSignIn)}` : "not signed in yet"}`} />
            ))}
          </div>
        ) : (
          <Empty icon={UserRound} title="No users yet" />
        )}
      </div>
    </Panel>
  )
}
