"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Check, CircleDashed, Clock, CreditCard, FileText, Megaphone, MessageSquare, Plus, Sparkles, UserRound } from "lucide-react"
import { Count, DataTable, FilterSelect, IdCell, type Column } from "@/components/console/data-table"
import { useClientTable } from "@/lib/use-table"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormError } from "@/components/form"
import { Chip, Facts, Failed, Loading, Panel, ProgressSteps, Row, ago, money, relDays, tomorrowAt11, type Tone } from "@/components/console/kit"
import { SendNewLink } from "@/components/console/login-link"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatDateTime, formatNumber } from "@/lib/format"
import { MODULE_SHORT, ORDER_STATUS_LABEL, type AccountHealth, type Catalog, type ClientDetail, type ClientSummary, type ClientUser, type OrderStatus, type TimelineEvent, type TimelineKind } from "@/lib/console"
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
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Order</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 font-medium">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {client.orders.map((o) => (
                    <tr key={o.id} className="border-t">
                      <td className="px-3 py-2"><IdCell id={o.id} href={`/console/payments/${o.id}`} /> <span className="text-xs text-muted-foreground">{o.cycle}</span></td>
                      <td className="px-3 py-2"><Chip tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Chip></td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{money(o.totalPaise)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDate(o.paidAt ?? o.createdAt)}</td>
                      <td className="px-3 py-2">{o.invoice ? <Link href={`/console/invoices/${o.invoice.id}`} className="font-mono text-xs text-primary hover:underline">{o.invoice.number}</Link> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          )}
        </div>
      )}
    </Panel>
  )
}

/** Every module, on or off for this client (Console v3: modules visible at a glance) */
export function ModulesPanel({ client }: { client: ClientDetail }) {
  const catalog = useApi<Catalog>("/console/catalog")
  const status = new Map(client.modules.map((m) => [m.key, m.status]))
  const order = Object.keys(MODULE_SHORT)
  const all = (catalog.data?.modules ?? client.modules)
    .map((m) => ({ key: m.key, name: MODULE_SHORT[m.key] ?? m.key, full: "name" in m ? m.name : m.key }))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  return (
    <Panel title="Modules" description={`${client.modules.filter((m) => m.status === "active").length} of ${all.length} switched on`}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
        {all.map((m) => {
          const s = status.get(m.key)
          return (
            <div key={m.key} title={m.full} className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm", s !== "active" && s !== "read_only" && "bg-muted/50 text-muted-foreground")}>
              <span className="min-w-0 truncate">{m.name}</span>
              {s === "active" ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-500" />On</span>
              ) : s === "read_only" ? (
                <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">Read-only</span>
              ) : (
                <span className="shrink-0 text-xs">Off</span>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/** Login link sent → logged in → setup → paid, with "Send new link" until the owner signs in */
export function GettingStarted({ client, canResend }: { client: ClientDetail; canResend: boolean }) {
  const p = client.progress
  if (!p) return null
  return (
    <Panel title="Getting started">
      <ProgressSteps progress={p} partnerBilled={client.billedBy === "partner"} />
      {!p.loggedIn && canResend && (
        <div className="mt-4 grid gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">{p.linkSentAt ? `Login link sent ${formatDate(p.linkSentAt)}. A new link stops the old one.` : "No login link sent yet."}</p>
          <SendNewLink path={`/console/tenants/${client.id}/login-link`} mobile={client.owner?.mobile} label={p.linkSentAt ? "Send new link" : "Send login link"} />
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
  const [status, setStatus] = React.useState("")
  const rows = React.useMemo(() => data?.data.filter((u) => !status || (status === "active" ? u.status === "active" : u.status !== "active")) ?? null, [data, status])
  const table = useClientTable(rows, { name: (u) => u.name, role: (u) => u.role, status: (u) => u.status, lastSignIn: (u) => u.lastSignIn ?? "" })
  if (error) return <Failed error={error} onRetry={reload} />
  const columns: Column<ClientUser>[] = [
    { key: "id", header: "User ID", hidden: true, cell: (u) => <IdCell id={u.id} /> },
    { key: "name", header: "Name", always: true, sortable: true, cell: (u) => <span className="font-medium">{u.name}</span> },
    { key: "role", header: "Role", sortable: true, cell: (u) => <Chip tone="blue">{u.role}</Chip> },
    { key: "twoStep", header: "Two-step", cell: (u) => (u.twoStep ? <Chip tone="green">On</Chip> : <Chip tone="grey">Off</Chip>) },
    { key: "lastSignIn", header: "Last signed in", sortable: true, cell: (u) => <span className="text-muted-foreground">{u.lastSignIn ? ago(u.lastSignIn) : "Not yet"}</span> },
    { key: "status", header: "Status", sortable: true, cell: (u) => (u.status === "active" ? <Chip tone="green">Active</Chip> : <Chip tone="grey">{u.status.replace(/_/g, " ")}</Chip>) },
  ]
  const active = data?.data.filter((u) => u.status === "active").length ?? 0
  return (
    <DataTable
      id="business-users"
      label="Users"
      table={table}
      columns={columns}
      searchFields={[{ key: "name", label: "Name" }, { key: "role", label: "Role" }]}
      summary={data && <><Count tone="green" n={active} label="Active" /><Count tone="grey" n={data.data.length - active} label="Other" /></>}
      filters={<FilterSelect value={status} onChange={setStatus} label="Status" options={[["", "Any status"], ["active", "Active"], ["other", "Invited or off"]]} />}
      empty="No users yet. Names and roles only; the Console never shows the business's own records."
    />
  )
}

/** The latest few events on the Overview, with a link to the full activity. */
export function RecentActivity({ tenantId, onAll }: { tenantId: string; onAll: () => void }) {
  const { data, error, reload } = useApi<{ data: TimelineEvent[] }>(`/console/tenants/${tenantId}/timeline`)
  return (
    <Panel title="Recent activity" action={<button type="button" onClick={onAll} className="text-sm font-medium text-primary hover:underline">All activity & notes</button>}>
      {error ? (
        <Failed error={error} onRetry={reload} />
      ) : !data ? (
        <Loading rows={3} />
      ) : !data.data.length ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ol className="grid gap-1">
          {data.data.slice(0, 6).map((ev) => {
            const k = KIND_ICON[ev.kind]
            return <li key={ev.id}><Row icon={k.icon} tone={k.tone} title={<span className="whitespace-normal">{ev.text}</span>} detail={`${ev.who ? `${ev.who} · ` : ""}${formatDateTime(ev.at)}`} /></li>
          })}
        </ol>
      )}
    </Panel>
  )
}

const HANDOVER_ROWS: { key: "branding" | "config" | "import"; label: string }[] = [
  { key: "branding", label: "Branding" },
  { key: "config", label: "Configuration (financial year, numbering)" },
  { key: "import", label: "Data import" },
]

/** Blueprint Phase B: the handover checklist and where it stands, with "Continue set-up" */
export function HandoverPanel({ client, base }: { client: ClientDetail; base: string }) {
  const h = client.handover
  if (!h) {
    return (
      <Panel title="Handover" description="This business wasn't set up through the onboarding wizard.">
        <Link href={`${base}/onboarding/${client.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Start set-up now</Link>
      </Panel>
    )
  }
  const p = h.progress
  const rows: { label: string; state: "done" | "skipped" | "todo"; detail?: string }[] = [
    { label: "Business, owner and plan", state: "done", detail: formatDate(h.startedAt) },
    ...HANDOVER_ROWS.map((r) => ({ label: r.label, state: h.steps[r.key] ?? ("todo" as const), detail: r.key === "import" && h.imported ? `${h.imported.contacts ?? 0} customers · ${h.imported.items ?? 0} products` : undefined })),
    { label: "Handed over (login link sent)", state: h.sentAt ? "done" : "todo", detail: h.sentAt ? formatDate(h.sentAt) : undefined },
    { label: "Owner signed in", state: client.progress?.loggedIn && h.sentAt ? "done" : "todo" },
    { label: "Owner accepted the handover", state: h.acceptedAt ? "done" : "todo", detail: h.acceptedAt ? formatDate(h.acceptedAt) : undefined },
  ]
  return (
    <Panel
      title="Handover"
      description={p.stage === "accepted" ? "Accepted by the owner. Set-up is complete." : p.stage === "signed_in" ? "Handed over · the owner has signed in and hasn't accepted yet" : p.stage === "sent" ? "Handed over · waiting for the owner to sign in" : `${p.percent}% set up`}
      action={p.nextStep && <Link href={`${base}/onboarding/${client.id}?step=${p.nextStep}`} className={buttonVariants({ size: "sm" })}>Continue set-up</Link>}
    >
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${p.stage === "accepted" ? 100 : p.percent}%` }} />
      </div>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
            {r.state === "done" ? <Check className="size-4 text-emerald-600" /> : <CircleDashed className="size-4 text-muted-foreground" />}
            <span className="flex-1">{r.label}</span>
            <span className="text-xs text-muted-foreground">{r.state === "skipped" ? "Skipped" : r.state === "todo" ? "Not yet" : r.detail}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
