"use client"

/* eslint-disable @typescript-eslint/no-explicit-any -- widget payloads are read field by field from the tab endpoint */
import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import type { DashboardTab } from "@contracts/dashboard"
import { api, errorMessage } from "@/lib/api"
import { formatDate, formatDateTime } from "@/lib/format"
import { isError, type Query } from "@/lib/dashboard"
import { cn } from "@/lib/utils"
import { ActionButton, Bars, Kpi, KpiRow, Meter, MiniTable, SHADES, WARN, Widget, WidgetLink, money, pill, td, th, tones } from "./parts"

// Every widget of every dashboard tab. A renderer gets its widget's data (or undefined while
// loading, or { error }) and says how wide it is in the 30-column grid.

type Any = any
export interface WidgetCtx {
  q: Query
  reload: () => void
  slow: boolean
  can: (p: string) => boolean
  term: (k: string, f?: string) => string
  go: (href: string) => void
}
export interface WidgetDef {
  span: number
  render: (d: Any, c: WidgetCtx) => React.ReactNode
}

const FULL = 30
const WIDE = 18
const NARROW = 12
const THIRD = 10

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w.endsWith("y") ? `${w.slice(0, -1)}ies` : `${w}s`}`
const METHOD: Record<string, string> = { upi: "UPI", cash: "Cash", card: "Card", bank: "Bank transfer", cheque: "Cheque", other: "Other" }
const STAGE: Record<string, string> = { new: "New", contacted: "Contacted", qualified: "Qualified", converted: "Converted", lost: "Lost" }
const STAGE_COLOR: Record<string, string> = { new: SHADES[3], contacted: SHADES[2], qualified: SHADES[1], converted: "var(--primary)", lost: "var(--input)" }
const ok = (d: Any) => d !== undefined && !isError(d)

function apptStatus(r: { status: string; next?: boolean }) {
  if (r.status === "completed") return <span className={cn(pill, tones.green)}>Done</span>
  if (r.status === "no_show") return <span className={cn(pill, tones.red)}>No-show</span>
  if (r.next) return <span className={cn(pill, tones.blue)}>Next</span>
  if (r.status === "confirmed") return <span className={cn(pill, tones.grey)}>Confirmed</span>
  return <span className={cn(pill, tones.amber)}>Unconfirmed</span>
}

async function remind(ids: string[], reload: () => void) {
  try {
    const r = await api.post<{ sent: number; skipped: { number: string | null; reason: string }[] }>("/invoices/remind", { ids })
    if (r.sent) toast.success(`${plural(r.sent, "reminder")} sent${r.skipped.length ? ` · ${r.skipped.length} skipped` : ""}`)
    if (!r.sent && r.skipped.length) toast.error(r.skipped.map((s) => `${s.number ?? ""} ${s.reason}`.trim()).join(" · "))
    if (r.sent) reload()
  } catch (e) {
    toast.error(errorMessage(e))
  }
}
async function act(fn: () => Promise<unknown>, message: string, reload: () => void) {
  try {
    await fn()
    toast.success(message)
    reload()
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

// ── Overview ──

const overview: Record<string, WidgetDef> = {
  kpis: {
    span: FULL,
    render: (d) => {
      if (!ok(d)) return <KpiSkeleton d={d} />
      return (
        <KpiRow>
          {d.sales && <Kpi label="Sales" value={money(d.sales.value)} change={d.sales.change} note={plural(d.sales.count, "invoice")} href="/app/m/billing" />}
          {d.collected && (
            <Kpi label="Collected" value={money(d.collected.value)} change={d.collected.change} note={d.collected.topMethods.map((m: Any) => `${METHOD[m.method] ?? m.method} ${m.share}%`).join(" · ") || "no payments yet"} />
          )}
          {d.toCollect && <Kpi label="To collect" value={money(d.toCollect.value)} note={`${plural(d.toCollect.count, "invoice")}${d.toCollect.overdue ? ` · ${d.toCollect.overdue} overdue` : ""}`} tone={d.toCollect.overdue ? "red" : undefined} href="/app/m/billing" />}
          {d.expenses && <Kpi label="Expenses" value={money(d.expenses.value)} change={d.expenses.change} goodWhenDown note={plural(d.expenses.count, "entry")} href="/app/m/finance" />}
        </KpiRow>
      )
    },
  },
  inbox: {
    span: WIDE,
    render: (d, c) => {
      const KIND: Record<string, [string, string]> = { overdue: ["Overdue", tones.red], followup: ["Follow-up", tones.blue], task: ["Task", tones.grey], setup: ["Setup", tones.grey], low_stock: ["Stock", tones.amber] }
      return (
        <Widget title={ok(d) ? `Needs you · ${d.count}` : "Needs you"} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.items.length && "You're all caught up — nothing needs you right now."}>
          {ok(d) && (
            <MiniTable>
              <tbody>
                {d.items.slice(0, 8).map((it: Any) => (
                  <tr key={`${it.kind}-${it.id}`}>
                    <td className={cn(td, "w-24")}>
                      <span className={cn(pill, KIND[it.kind][1])}>{KIND[it.kind][0]}</span>
                    </td>
                    <td className={td}>
                      <Link href={it.href} className="font-medium hover:underline">
                        {it.title}
                      </Link>
                      <span className="text-muted-foreground">
                        {it.amountPaise ? ` · ${money(it.amountPaise)}` : ""} · {it.detail}
                      </span>
                    </td>
                    <td className={cn(td, "text-right")}>
                      {it.action === "remind" && c.can("billing.invoice.edit") && <ActionButton onClick={() => remind([it.id], c.reload)}>Send reminder</ActionButton>}
                      {it.action === "done" && it.kind === "followup" && <ActionButton onClick={() => act(() => api.patch(`/activities/${it.id}`, { completed: true }), "Follow-up done", c.reload)}>Done</ActionButton>}
                      {it.action === "done" && it.kind === "task" && <ActionButton onClick={() => act(() => api.patch(`/tasks/${it.id}`, { status: "done" }), "Task done", c.reload)}>Done</ActionButton>}
                      {it.action === "open" && (
                        <Link href={it.href} className="inline-flex h-8 items-center rounded-lg border px-3 text-xs font-semibold hover:bg-muted">
                          Open
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </MiniTable>
          )}
        </Widget>
      )
    },
  },
  today: {
    span: NARROW,
    render: (d, c) => (
      <Widget title={ok(d) ? `Today's appointments · ${d.rows.length}` : "Today's appointments"} right={<WidgetLink href="/app/m/bookings">Calendar</WidgetLink>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.rows.length && "No appointments today."}>
        {ok(d) && (
          <>
            <MiniTable>
              <tbody>
                {d.rows.slice(0, 6).map((r: Any) => (
                  <tr key={r.id}>
                    <td className={cn(td, "w-14 font-semibold tabular-nums")}>{time(r.startAt)}</td>
                    <td className={td}>{r.title}</td>
                    <td className={cn(td, "text-muted-foreground")}>{r.staff ?? "—"}</td>
                    <td className={td}>{apptStatus(r)}</td>
                  </tr>
                ))}
              </tbody>
            </MiniTable>
            <p className="text-xs text-muted-foreground">
              {d.rows.length > 6 ? `${d.rows.length - 6} more today · ` : ""}
              {d.noShowsWeek ? `${plural(d.noShowsWeek, "no-show")} this week` : "No no-shows this week"}
            </p>
          </>
        )}
      </Widget>
    ),
  },
  trend: {
    span: WIDE,
    render: (d, c) => <TrendWidget d={d} c={c} title="Sales vs collected" labels={["Sales", "Collected"]} />,
  },
  activity: {
    span: NARROW,
    render: (d, c) => (
      <Widget title="Recent activity" data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.rows.length && "Nothing in the last 30 days yet."}>
        {ok(d) && (
          <ul className="grid gap-2 text-xs">
            {d.rows.map((r: Any) => (
              <li key={r.id}>
                <strong>{r.who}</strong>{" "}
                <Link href={r.href} className="hover:underline">
                  {r.what}
                </Link>{" "}
                <span className="text-muted-foreground">· {formatDateTime(r.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Widget>
    ),
  },
}

function KpiSkeleton({ d }: { d: Any }) {
  if (isError(d)) return <div className="rounded-xl border border-red-200 bg-card px-3.5 py-3 text-xs dark:border-red-900">Couldn&apos;t load these numbers.</div>
  return (
    <KpiRow>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[86px] animate-pulse rounded-xl border bg-card" />
      ))}
    </KpiRow>
  )
}

function TrendWidget({ d, c, title, labels }: { d: Any; c: WidgetCtx; title: string; labels: [string, string] }) {
  const empty = ok(d) && d.buckets.every((b: Any) => !b.invoiced && !b.collected)
  return (
    <Widget title={`${title} · ${formatDate(c.q.from)} – ${formatDate(c.q.to)}`} data={d} slow={c.slow} onRetry={c.reload} empty={empty && "No invoices in this period yet. Your first invoice shows here."}>
      {ok(d) && <Bars pair={d.hasCollected} labels={d.hasCollected ? labels : undefined} height={150} rows={d.buckets.map((b: Any) => ({ label: b.label, a: b.invoiced, b: b.collected, title: `${b.from === b.to ? formatDate(b.from) : `${formatDate(b.from)} – ${formatDate(b.to)}`}: ${money(b.invoiced)}${d.hasCollected ? ` · collected ${money(b.collected)}` : ""}` }))} />}
    </Widget>
  )
}

// ── Billing ──

const billing: Record<string, WidgetDef> = {
  kpis: {
    span: FULL,
    render: (d) =>
      !ok(d) ? (
        <KpiSkeleton d={d} />
      ) : (
        <KpiRow>
          <Kpi label="Invoiced" value={money(d.invoiced.value)} change={d.invoiced.change} note={plural(d.invoiced.count, "invoice")} href="/app/m/billing" />
          {d.collected && <Kpi label="Collected" value={money(d.collected.value)} change={d.collected.change} note={d.collected.share !== null ? `${d.collected.share}% of invoiced` : ""} />}
          <Kpi label="Outstanding" value={money(d.outstanding.value)} note={`${plural(d.outstanding.count, "invoice")}${d.outstanding.oldestDays !== null ? ` · oldest ${d.outstanding.oldestDays} days` : ""}`} tone={d.outstanding.value ? "red" : undefined} href="/app/m/billing" />
          <Kpi label="Average invoice" value={money(d.average.value)} change={d.average.change} absolute={(n) => money(n)} note="vs previous period" />
        </KpiRow>
      ),
  },
  trend: { span: WIDE, render: (d, c) => <TrendWidget d={d} c={c} title="Invoiced vs collected" labels={["Invoiced", "Collected"]} /> },
  ageing: {
    span: NARROW,
    render: (d, c) => (
      <Widget title="Dues by age" right={<WidgetLink href="/app/m/billing">Open dues</WidgetLink>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.total && "No money is due right now."}>
        {ok(d) && (
          <>
            {d.bands.map((b: Any, i: number) => (
              <Meter key={b.label} label={b.label} value={`${money(b.amount)} · ${b.count}`} pct={d.total ? (b.amount / d.total) * 100 : 0} color={WARN[i]} />
            ))}
            <p className="text-xs text-muted-foreground">Age counted from the invoice date · reminders in Settings › Notifications</p>
          </>
        )}
      </Widget>
    ),
  },
  overdue: {
    span: WIDE,
    render: (d, c) => (
      <Widget
        title={ok(d) ? `Overdue invoices · ${d.count}` : "Overdue invoices"}
        right={
          <div className="flex items-center gap-2">
            {ok(d) && d.rows.length > 0 && c.can("billing.invoice.edit") && <RemindAll ids={d.rows.map((r: Any) => r.id)} reload={c.reload} />}
            <WidgetLink href="/app/m/billing">View list</WidgetLink>
          </div>
        }
        data={d}
        slow={c.slow}
        onRetry={c.reload}
        empty={ok(d) && !d.rows.length && "Nothing is overdue."}
      >
        {ok(d) && (
          <MiniTable>
            <thead>
              <tr>
                <th className={th}>Invoice</th>
                <th className={th}>Customer</th>
                <th className={th}>Overdue</th>
                <th className={cn(th, "text-right")}>Balance</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r: Any) => (
                <tr key={r.id}>
                  <td className={cn(td, "font-mono")}>
                    <Link href={`/app/m/billing/${r.id}`} className="hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td className={td}>{r.customer}</td>
                  <td className={cn(td, "text-red-700 dark:text-red-400")}>{plural(r.days, "day")}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{money(r.balance)}</td>
                  <td className={cn(td, "text-right")}>{c.can("billing.invoice.edit") && (r.email ? <ActionButton onClick={() => remind([r.id], c.reload)}>Remind</ActionButton> : <span className="text-[11px] text-muted-foreground">No email</span>)}</td>
                </tr>
              ))}
            </tbody>
          </MiniTable>
        )}
      </Widget>
    ),
  },
  methods: {
    span: NARROW,
    render: (d, c) => (
      <Widget title="How customers paid" data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.total && "No payments in this period."}>
        {ok(d) && d.rows.map((r: Any, i: number) => <Meter key={r.method} label={METHOD[r.method] ?? r.method} value={`${money(r.amount)} · ${r.share}%`} pct={r.share} color={SHADES[Math.min(i, 3)]} />)}
      </Widget>
    ),
  },
}

function RemindAll({ ids, reload }: { ids: string[]; reload: () => void }) {
  const [asking, setAsking] = React.useState(false)
  if (asking) {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        Email {plural(ids.length, "customer")}?
        <ActionButton onClick={async () => (await remind(ids, reload), setAsking(false))}>Yes, send</ActionButton>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setAsking(false)}>
          Cancel
        </button>
      </span>
    )
  }
  return <ActionButton onClick={() => setAsking(true)}>Remind all</ActionButton>
}

// ── Sales ──

const sales: Record<string, WidgetDef> = {
  kpis: {
    span: FULL,
    render: (d) =>
      !ok(d) ? (
        <KpiSkeleton d={d} />
      ) : (
        <KpiRow>
          <Kpi label="Quotations sent" value={d.sent.count} change={d.sent.change} note={`${money(d.sent.value)} quoted`} href="/app/m/sales" />
          <Kpi label="Won" value={`${d.won.count}${d.won.rate !== null ? ` · ${d.won.rate}%` : ""}`} change={d.won.change} note="turned into invoices" absolute={(n) => `${n} pts`} />
          <Kpi label="Open" value={d.open.count} note={`${money(d.open.value)} · waiting for the customer`} />
          <Kpi label="Expiring this week" value={d.expiring} note="validity ends — follow up" tone={d.expiring ? "red" : undefined} />
        </KpiRow>
      ),
  },
  results: {
    span: WIDE,
    render: (d, c) => (
      <Widget title="Quotations by result" right={<span className="text-xs text-muted-foreground">count · value</span>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.total && "No quotations sent in this period."}>
        {ok(d) && d.rows.map((r: Any, i: number) => <Meter key={r.key} label={r.label} value={`${r.count} · ${money(r.value)}`} pct={d.total ? (r.count / d.total) * 100 : 0} color={["var(--primary)", "#2450D8", "#C27C0E", "var(--input)"][i]} />)}
      </Widget>
    ),
  },
  top: {
    span: NARROW,
    render: (d, c) => (
      <Widget title={`Best-selling ${c.term("entity.item.plural", "services & products").toLowerCase()}`} right={<WidgetLink href="/app/m/catalog">{c.term("entity.item.plural", "Products & services")}</WidgetLink>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.rows.length && "Nothing billed in this period."}>
        {ok(d) && (
          <MiniTable>
            <tbody>
              {d.rows.map((r: Any) => (
                <tr key={r.name}>
                  <td className={td}>{r.name}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{money(r.amount)}</td>
                  <td className={cn(td, "text-right text-muted-foreground tabular-nums")}>{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </MiniTable>
        )}
      </Widget>
    ),
  },
  open: {
    span: FULL,
    render: (d, c) => (
      <Widget title={ok(d) ? `Open quotations · ${d.rows.length}` : "Open quotations"} right={<WidgetLink href="/app/m/sales">View all</WidgetLink>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.rows.length && "No quotations are waiting for an answer."}>
        {ok(d) && (
          <>
            <MiniTable>
              <thead>
                <tr>
                  <th className={th}>Quotation</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Sent</th>
                  <th className={th}>Valid until</th>
                  <th className={cn(th, "text-right")}>Amount</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r: Any) => (
                  <tr key={r.id}>
                    <td className={cn(td, "font-mono")}>
                      <Link href={`/app/m/sales/${r.id}`} className="hover:underline">
                        {r.number}
                      </Link>
                    </td>
                    <td className={td}>{r.customer}</td>
                    <td className={td}>{formatDate(r.sent)}</td>
                    <td className={cn(td, r.expired ? "text-red-700 dark:text-red-400" : r.expiringSoon ? "text-amber-700 dark:text-amber-300" : "")}>{r.validUntil ? `${formatDate(r.validUntil)}${r.expired ? " · expired" : ""}` : "—"}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{money(r.amount)}</td>
                    <td className={cn(td, "text-right")}>
                      {c.can("billing.invoice.create") && (
                        <ActionButton
                          onClick={async () => {
                            try {
                              const inv = await api.post<{ id: string }>(`/quotations/${r.id}/convert`)
                              toast.success("Draft invoice created")
                              c.go(`/app/m/billing/${inv.id}`)
                            } catch (e) {
                              toast.error(errorMessage(e))
                            }
                          }}
                        >
                          Convert to invoice
                        </ActionButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </MiniTable>
            <p className="text-xs text-muted-foreground">Sales orders and deliveries join this tab when Sales &amp; Orders ships</p>
          </>
        )}
      </Widget>
    ),
  },
}

// ── CRM ──

const crm: Record<string, WidgetDef> = {
  kpis: {
    span: FULL,
    render: (d) =>
      !ok(d) ? (
        <KpiSkeleton d={d} />
      ) : (
        <KpiRow>
          <Kpi label="New leads" value={d.leads.value} change={d.leads.change} absolute={(n) => String(n)} note="vs previous period" href="/app/m/crm" />
          <Kpi label="Converted" value={`${d.converted.value}${d.converted.rate !== null ? ` · ${d.converted.rate}%` : ""}`} change={d.converted.change} absolute={(n) => `${n} pts`} note="lead → customer" />
          <Kpi label="New customers" value={d.customers.value} change={d.customers.change} absolute={(n) => String(n)} note="incl. walk-ins" href="/app/m/crm" />
          {d.followUps && <Kpi label="Follow-ups due" value={d.followUps.value} note={d.followUps.overdue ? `${d.followUps.overdue} overdue` : "today and earlier"} tone={d.followUps.overdue ? "red" : undefined} />}
        </KpiRow>
      ),
  },
  stages: {
    span: WIDE,
    render: (d, c) => {
      const max = ok(d) ? Math.max(1, ...d.rows.map((r: Any) => r.count)) : 1
      return (
        <Widget title="Leads by stage" right={<WidgetLink href="/app/m/crm">Open leads</WidgetLink>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && d.rows.every((r: Any) => !r.count) && "No leads added in this period."}>
          {ok(d) && (
            <>
              {d.rows.map((r: Any) => (
                <Meter key={r.stage} label={STAGE[r.stage]} value={r.count} pct={(r.count / max) * 100} color={STAGE_COLOR[r.stage]} href="/app/m/crm" />
              ))}
              <p className="text-xs text-muted-foreground">Stages are the lead statuses; your own pipeline stages arrive with CRM (paid)</p>
            </>
          )}
        </Widget>
      )
    },
  },
  sources: {
    span: NARROW,
    render: (d, c) => (
      <Widget title="Where leads come from" data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.total && "No leads added in this period."}>
        {ok(d) && d.rows.map((r: Any, i: number) => <Meter key={r.source ?? "none"} label={r.source ?? "Not recorded"} value={`${r.count} · ${r.share}%`} pct={r.share} color={r.source ? SHADES[Math.min(i, 3)] : SHADES[4]} />)}
      </Widget>
    ),
  },
  followups: {
    span: WIDE,
    render: (d, c) => (
      <Widget title={ok(d) ? `Follow-ups due · ${d.rows.length}` : "Follow-ups due"} right={<WidgetLink href="/app/m/crm">All activities</WidgetLink>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.rows.length && "No follow-ups due."}>
        {ok(d) && (
          <MiniTable>
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>Who</th>
                <th className={th}>What</th>
                <th className={th}>Owner</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r: Any) => (
                <tr key={r.id}>
                  <td className={cn(td, r.overdue && "text-red-700 dark:text-red-400")}>{r.dueAt ? formatDateTime(r.dueAt) : "—"}</td>
                  <td className={td}>
                    <Link href={`/app/m/crm/${r.contactId}`} className="hover:underline">
                      {r.who}
                    </Link>
                  </td>
                  <td className={td}>{r.what}</td>
                  <td className={cn(td, "text-muted-foreground")}>{r.owner ?? "—"}</td>
                  <td className={cn(td, "text-right")}>{c.can("crm.activity.edit") && <ActionButton onClick={() => act(() => api.patch(`/activities/${r.id}`, { completed: true }), "Follow-up done", c.reload)}>Done</ActionButton>}</td>
                </tr>
              ))}
            </tbody>
          </MiniTable>
        )}
      </Widget>
    ),
  },
  top: {
    span: NARROW,
    render: (d, c) => (
      <Widget title="Top customers" data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.rows.length && "No invoices in this period."}>
        {ok(d) && (
          <MiniTable>
            <tbody>
              {d.rows.map((r: Any) => (
                <tr key={r.id}>
                  <td className={td}>
                    <Link href={`/app/m/crm/${r.id}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className={cn(td, "text-right tabular-nums")}>{money(r.amount)}</td>
                  <td className={cn(td, "text-right text-muted-foreground")}>{plural(r.invoices, "invoice")}</td>
                </tr>
              ))}
            </tbody>
          </MiniTable>
        )}
      </Widget>
    ),
  },
}

// ── Bookings ──

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const bookings: Record<string, WidgetDef> = {
  kpis: {
    span: FULL,
    render: (d) =>
      !ok(d) ? (
        <KpiSkeleton d={d} />
      ) : (
        <KpiRow>
          <Kpi label="Appointments" value={d.total.value} change={d.total.change} absolute={(n) => String(n)} note="in this period" href="/app/m/bookings" />
          <Kpi label="Completed" value={`${d.completed.value}${d.completed.rate !== null ? ` · ${d.completed.rate}%` : ""}`} note="of the ones not cancelled" />
          <Kpi label="No-shows" value={`${d.noShows.value}${d.noShows.rate !== null ? ` · ${d.noShows.rate}%` : ""}`} change={d.noShows.change} goodWhenDown absolute={(n) => String(n)} note="vs previous period" />
          <Kpi label="Cancelled" value={d.cancelled.value} change={d.cancelled.change} goodWhenDown absolute={(n) => String(n)} note="vs previous period" />
        </KpiRow>
      ),
  },
  hours: {
    span: WIDE,
    render: (d, c) => (
      <Widget title="Busy hours" right={<span className="text-xs text-muted-foreground">appointments per hour</span>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && d.rows.every((r: Any) => !r.count) && "No appointments in this period."}>
        {ok(d) && <Bars height={150} rows={d.rows.map((r: Any) => ({ label: String(r.hour % 12 || 12), a: r.count, title: `${r.hour}:00 — ${plural(r.count, "appointment")}` }))} />}
      </Widget>
    ),
  },
  staff: {
    span: NARROW,
    render: (d, c) => (
      <Widget title="Staff utilisation" right={<span className="text-xs text-muted-foreground">booked ÷ working hours</span>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.rows.length && "No appointments with a staff member yet."}>
        {ok(d) && (
          <>
            {d.rows.map((r: Any) => (
              <Meter key={r.id} label={r.name} value={`${r.pct}% · ${plural(r.count, "appt")}`} pct={r.pct} color={r.pct < 40 ? "#C27C0E" : undefined} />
            ))}
            <p className="text-xs text-muted-foreground">Working hours: {d.hoursPerDay} h a day until staff schedules arrive</p>
          </>
        )}
      </Widget>
    ),
  },
  week: {
    span: 15,
    render: (d, c) => (
      <Widget title="Next 7 days" right={<WidgetLink href="/app/m/bookings">Calendar</WidgetLink>} data={d} slow={c.slow} onRetry={c.reload}>
        {ok(d) && (
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px]">
            {d.days.map((x: Any) => (
              <Link key={x.date} href="/app/m/bookings" className="rounded-lg border border-border/60 py-2 hover:border-primary/40">
                <div className="text-muted-foreground">{DOW[new Date(`${x.date}T00:00:00Z`).getUTCDay()]}</div>
                <div className="text-base font-bold tabular-nums">{x.count}</div>
              </Link>
            ))}
          </div>
        )}
      </Widget>
    ),
  },
  noshows: {
    span: 15,
    render: (d, c) => (
      <Widget title={ok(d) ? `No-shows · ${d.rows.length}` : "No-shows"} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.rows.length && "No no-shows in this period."}>
        {ok(d) && (
          <>
            <MiniTable>
              <tbody>
                {d.rows.map((r: Any) => (
                  <tr key={r.id}>
                    <td className={td}>{r.customer ?? "—"}</td>
                    <td className={td}>
                      {r.title} · {formatDate(r.startAt)}
                    </td>
                    <td className={cn(td, "text-muted-foreground")}>{r.times > 1 ? `${r.times} no-shows` : "first"}</td>
                  </tr>
                ))}
              </tbody>
            </MiniTable>
            <p className="text-xs text-muted-foreground">Reminders 24 h and 2 h before cut no-shows (Settings › Notifications)</p>
          </>
        )}
      </Widget>
    ),
  },
}

// ── Finance ──

const finance: Record<string, WidgetDef> = {
  kpis: {
    span: FULL,
    render: (d) =>
      !ok(d) ? (
        <KpiSkeleton d={d} />
      ) : (
        <KpiRow>
          {d.moneyIn && <Kpi label="Money in" value={money(d.moneyIn.value)} change={d.moneyIn.change} note="payments received" />}
          <Kpi label="Money out" value={money(d.moneyOut.value)} change={d.moneyOut.change} goodWhenDown note="expenses paid" href="/app/m/finance" />
          {d.net && <Kpi label="Net cash flow" value={money(d.net.value)} change={d.net.change} absolute={(n) => money(n)} note="in − out" />}
          {d.gst && <Kpi label="GST collected" value={money(d.gst.value)} note="from invoices" />}
        </KpiRow>
      ),
  },
  categories: {
    span: THIRD,
    render: (d, c) => (
      <Widget title="Expenses by category" data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.total && "No expenses in this period."}>
        {ok(d) && d.rows.map((r: Any, i: number) => <Meter key={r.category} label={r.category} value={`${money(r.amount)} · ${r.share}%`} pct={r.share} color={SHADES[Math.min(i, 4)]} />)}
      </Widget>
    ),
  },
  profit: {
    span: THIRD,
    render: (d, c) => (
      <Widget title="Profit snapshot" data={d} slow={c.slow} onRetry={c.reload}>
        {ok(d) && (
          <>
            <table className="w-full text-xs">
              <tbody>
                <tr>
                  <td className={td}>Sales (before GST)</td>
                  <td className={cn(td, "text-right tabular-nums")}>{money(d.sales)}</td>
                </tr>
                <tr>
                  <td className={td}>Expenses</td>
                  <td className={cn(td, "text-right tabular-nums")}>− {money(d.expenses)}</td>
                </tr>
                <tr>
                  <td className={cn(td, "font-bold")}>Profit before tax</td>
                  <td className={cn(td, "text-right font-bold tabular-nums", d.profit < 0 && "text-red-700 dark:text-red-400")}>{money(d.profit)}</td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">Cash basis, from invoices and expenses. Full P&amp;L, bank balances and GST input credit arrive with Finance (paid) and Purchases.</p>
          </>
        )}
      </Widget>
    ),
  },
  gst: {
    span: THIRD,
    render: (d, c) => (
      <Widget title="GST for the period" right={ok(d) && <span className={cn(pill, tones.amber)}>GSTR-3B due {formatDate(d.due)}</span>} data={d} slow={c.slow} onRetry={c.reload}>
        {ok(d) && (
          <>
            <table className="w-full text-xs">
              <tbody>
                {(
                  [
                    ["CGST", d.cgst],
                    ["SGST", d.sgst],
                    ["IGST", d.igst],
                  ] as const
                ).map(([k, v]) => (
                  <tr key={k}>
                    <td className={td}>{k}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{money(v)}</td>
                  </tr>
                ))}
                <tr>
                  <td className={cn(td, "font-bold")}>Output GST</td>
                  <td className={cn(td, "text-right font-bold tabular-nums")}>{money(d.total)}</td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              {d.composition && d.compositionRateBp ? `Composition scheme: about ${money(Math.round((d.taxable * d.compositionRateBp) / 10000))} at ${d.compositionRateBp / 100}% on turnover.` : "Composition businesses see tax at their composition rate instead."}
            </p>
          </>
        )}
      </Widget>
    ),
  },
}

// ── Tasks ──

const tasks: Record<string, WidgetDef> = {
  kpis: {
    span: FULL,
    render: (d) =>
      !ok(d) ? (
        <KpiSkeleton d={d} />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <Kpi label="Open" value={d.open.value} note="to do or in progress" href="/app/m/tasks" />
          <Kpi label="Overdue" value={d.overdue.value} note={d.overdue.value ? "past their due date" : "none late"} tone={d.overdue.value ? "red" : undefined} />
          <Kpi label="Done" value={d.done.value} change={d.done.change} absolute={(n) => String(n)} note="in this period" />
        </div>
      ),
  },
  people: {
    span: NARROW,
    render: (d, c) => (
      <Widget title="Open tasks by person" right={<span className="text-xs text-muted-foreground">open · overdue</span>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.rows.length && "No open tasks."}>
        {ok(d) && d.rows.map((r: Any) => <Meter key={r.id ?? "none"} label={r.name} value={`${r.open}${r.overdue ? ` · ${r.overdue} overdue` : ""}`} pct={r.pct} color={r.overdue ? "#C2410C" : r.id ? undefined : SHADES[4]} />)}
      </Widget>
    ),
  },
  due: {
    span: WIDE,
    render: (d, c) => (
      <Widget title={ok(d) ? `Overdue and due today · ${d.rows.length}` : "Overdue and due today"} right={<WidgetLink href="/app/m/tasks">Tasks</WidgetLink>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.rows.length && "Nothing is late or due today."}>
        {ok(d) && (
          <MiniTable>
            <tbody>
              {d.rows.map((r: Any) => (
                <tr key={r.id}>
                  <td className={cn(td, "w-28", r.overdueDays && "text-red-700 dark:text-red-400")}>{r.overdueDays ? (r.overdueDays === 1 ? "Yesterday" : `${r.overdueDays} days late`) : "Today"}</td>
                  <td className={td}>
                    <Link href={`/app/m/tasks/${r.id}`} className="hover:underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className={cn(td, "text-muted-foreground")}>{r.who ?? "Unassigned"}</td>
                  <td className={cn(td, "text-right")}>{c.can("tasks.task.edit") && <ActionButton onClick={() => act(() => api.patch(`/tasks/${r.id}`, { status: "done" }), "Task done", c.reload)}>Done</ActionButton>}</td>
                </tr>
              ))}
            </tbody>
          </MiniTable>
        )}
      </Widget>
    ),
  },
}

// ── My day (staff) ──

const myday: Record<string, WidgetDef> = {
  kpis: {
    span: FULL,
    render: (d) =>
      !ok(d) ? (
        <KpiSkeleton d={d} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {d.appointments && <Kpi label="My appointments today" value={d.appointments.value} note={`${d.appointments.done} done`} href="/app/m/bookings" />}
          {d.sales && <Kpi label="My sales" value={money(d.sales.value)} change={d.sales.change} note={plural(d.sales.count, "invoice")} />}
          {d.tasks && <Kpi label="My tasks" value={d.tasks.value} note={d.tasks.dueToday ? `${d.tasks.dueToday} due today or late` : "none due today"} tone={d.tasks.dueToday ? "red" : undefined} href="/app/m/tasks" />}
        </div>
      ),
  },
  schedule: {
    span: WIDE,
    render: (d, c) => (
      <Widget title="My schedule" right={<WidgetLink href="/app/m/bookings">Calendar</WidgetLink>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.rows.length && "No appointments for you today."}>
        {ok(d) && (
          <MiniTable>
            <tbody>
              {d.rows.map((r: Any) => (
                <tr key={r.id}>
                  <td className={cn(td, "w-14 font-semibold tabular-nums")}>{time(r.startAt)}</td>
                  <td className={td}>{r.title}</td>
                  <td className={td}>{apptStatus(r)}</td>
                </tr>
              ))}
            </tbody>
          </MiniTable>
        )}
      </Widget>
    ),
  },
  tasks: {
    span: NARROW,
    render: (d, c) => (
      <Widget title="My tasks" right={<WidgetLink href="/app/m/tasks">All tasks</WidgetLink>} data={d} slow={c.slow} onRetry={c.reload} empty={ok(d) && !d.rows.length && "No open tasks. Nice."}>
        {ok(d) && (
          <ul className="grid gap-2 text-[13px]">
            {d.rows.map((r: Any) => (
              <li key={r.id}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="size-4 accent-primary" disabled={!c.can("tasks.task.edit")} onChange={(e) => e.target.checked && act(() => api.patch(`/tasks/${r.id}`, { status: "done" }), "Task done", c.reload)} />
                  {r.title}
                  {r.dueAt && <span className="text-xs text-muted-foreground">· {formatDate(r.dueAt)}</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </Widget>
    ),
  },
}

export const TAB_WIDGETS: Record<DashboardTab, Record<string, WidgetDef>> = { overview, myday, billing, sales, crm, bookings, finance, tasks }
