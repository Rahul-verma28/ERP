"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CalendarClock, CreditCard, FileText, Hourglass, Wallet } from "lucide-react"
import { LoadMore } from "@/components/common"
import { Chip, ClientStatus, Empty, Failed, Loading, Page, PageTabs, Panel, Stat, StatGrid, money, relDays, type Tone } from "@/components/console/kit"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useList } from "@/lib/use-list"
import { formatDate, formatPaise } from "@/lib/format"
import { ORDER_STATUS_LABEL, type BillingSummary, type InvoiceRow, type OrderRow, type OrderStatus, type PaymentRow, type RenewalRow } from "@/lib/console"
import { cn } from "@/lib/utils"

// Billing (blueprint Phase D): four numbers, then Orders, Payments received, AHEAD invoices and
// Renewals coming up. Everything stays inside the person's scope (vendors see their own).

type Tab = "orders" | "payments" | "invoices" | "renewals"

const ORDER_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "awaiting_payment", label: "Waiting for payment" },
  { value: "pending_approval", label: "Discount to approve" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
]
const TONE: Record<OrderStatus, Tone> = { pending_approval: "amber", awaiting_payment: "amber", paid: "green", cancelled: "grey" }
const KIND: Record<string, string> = { fresh: "First payment", renewal: "Renewal", upgrade: "Upgrade" }
const METHOD: Record<string, string> = { upi: "UPI", bank_transfer: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card", gateway: "Online", razorpay: "Online" }

function Orders() {
  const router = useRouter()
  const params = useSearchParams()
  const [status, setStatus] = React.useState(params.get("status") ?? "")
  const list = useList<OrderRow>("/console/orders", { status })
  return (
    <div className="grid gap-4">
      <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1" role="tablist" aria-label="Order status">
        {ORDER_TABS.map((t) => (
          <button key={t.value || "all"} type="button" role="tab" aria-selected={status === t.value} onClick={() => setStatus(t.value)} className={cn("h-8 shrink-0 rounded-lg px-3 text-[13px] font-medium", status === t.value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      <Panel padded={false}>
        {list.error ? (
          <div className="p-5"><Failed error={list.error} onRetry={list.reload} /></div>
        ) : list.loading ? (
          <Loading rows={5} className="p-5" />
        ) : !list.rows.length ? (
          <Empty icon={CreditCard} title="No orders here" text="An order is made when a business is onboarded on a paid plan, converted, upgraded or renewed." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Business</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 text-right font-medium">Amount</th>
                  <th className="px-3 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((o) => (
                  <tr key={o.id} onClick={() => router.push(`/console/payments/${o.id}`)} className="cursor-pointer border-b last:border-0 hover:bg-muted/50">
                    <td className="px-5 py-3">
                      <Link href={`/console/payments/${o.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{o.clientName ?? "Business"}</Link>
                      <div className="text-[13px] text-muted-foreground">
                        {KIND[o.kind] ?? o.kind} · {o.cycle === "yearly" ? "Yearly" : "Monthly"}
                        {o.discountBp > 0 && ` · ${o.discountBp / 100}% off`}
                        {o.createdByName ? ` · by ${o.createdByName}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Chip tone={TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Chip>
                      {o.status === "awaiting_payment" && <div className="mt-1 text-[13px] text-muted-foreground">cancels {relDays(o.expiresAt)}</div>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatPaise(o.totalPaise)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{formatDate(o.paidAt ?? o.createdAt)}</td>
                    <td className="px-5 py-3">
                      {o.invoice ? <Link href={`/console/invoices/${o.invoice.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[13px] hover:underline">{o.invoice.number}</Link> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Panel>
    </div>
  )
}

function Payments() {
  const list = useList<PaymentRow>("/console/billing/payments", {})
  return (
    <Panel padded={false}>
      {list.error ? (
        <div className="p-5"><Failed error={list.error} onRetry={list.reload} /></div>
      ) : list.loading ? (
        <Loading rows={5} className="p-5" />
      ) : !list.rows.length ? (
        <Empty icon={Wallet} title="No payments yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                <th className="px-5 py-3 font-medium">Received</th>
                <th className="px-3 py-3 font-medium">Business</th>
                <th className="px-3 py-3 font-medium">How</th>
                <th className="px-3 py-3 text-right font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-5 py-3 whitespace-nowrap">{formatDate(p.receivedAt)}<div className="text-[13px] text-muted-foreground">{KIND[p.kind] ?? p.kind}</div></td>
                  <td className="px-3 py-3"><Link href={`/console/clients/${p.tenantId}?tab=plan`} className="font-medium hover:underline">{p.business}</Link></td>
                  <td className="px-3 py-3 whitespace-nowrap">{METHOD[p.method] ?? p.method}<div className="text-[13px] text-muted-foreground">{p.reference ?? ""}{p.recordedBy ? ` · ${p.recordedBy}` : ""}</div></td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(p.amountPaise)}</td>
                  <td className="px-5 py-3">{p.invoice ? <Link href={`/console/invoices/${p.invoice.id}`} className="font-mono text-[13px] hover:underline">{p.invoice.number}</Link> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
    </Panel>
  )
}

function Invoices() {
  const list = useList<InvoiceRow>("/console/billing/invoices", {})
  return (
    <Panel padded={false}>
      {list.error ? (
        <div className="p-5"><Failed error={list.error} onRetry={list.reload} /></div>
      ) : list.loading ? (
        <Loading rows={5} className="p-5" />
      ) : !list.rows.length ? (
        <Empty icon={FileText} title="No invoices yet" text="AHEAD's GST invoice is issued when an order is paid." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                <th className="px-5 py-3 font-medium">Number</th>
                <th className="px-3 py-3 font-medium">Business</th>
                <th className="px-3 py-3 font-medium">Date</th>
                <th className="px-3 py-3 text-right font-medium">Before GST</th>
                <th className="px-3 py-3 text-right font-medium">GST</th>
                <th className="px-5 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="px-5 py-3"><Link href={`/console/invoices/${i.id}`} className="font-mono text-[13px] hover:underline">{i.number}</Link></td>
                  <td className="px-3 py-3">{i.business}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{formatDate(i.issuedAt)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{money(i.taxablePaise)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{money(i.gstPaise)}</td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums">{money(i.totalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
    </Panel>
  )
}

function Renewals() {
  const { data, error, reload } = useApi<{ data: RenewalRow[] }>("/console/billing/renewals")
  if (error) return <Failed error={error} onRetry={reload} />
  return (
    <Panel padded={false} title="Renewals" description="Paying businesses renewing in the next 30 days, and those past their renewal date. The renewal order and payment link go out 7 days before.">
      {!data ? (
        <Loading rows={5} className="p-5" />
      ) : !data.data.length ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">No renewals in the next 30 days.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                <th className="px-5 py-3 font-medium">Business</th>
                <th className="px-3 py-3 font-medium">Plan</th>
                <th className="px-3 py-3 font-medium">Renews</th>
                <th className="px-3 py-3 font-medium">Renewal order</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((r) => (
                <tr key={r.tenantId} className="border-b last:border-0">
                  <td className="px-5 py-3"><Link href={`/console/clients/${r.tenantId}?tab=plan`} className="font-medium hover:underline">{r.business}</Link></td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.plan} · {r.cycle}{r.changeTo && <div className="text-[13px] text-primary">Moves to {r.changeTo}</div>}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.status === "past_due" ? <span className="text-red-700 dark:text-red-400">Was due {r.renewsAt ? formatDate(r.renewsAt) : ""}</span> : r.renewsAt ? `${formatDate(r.renewsAt)} · ${relDays(r.renewsAt)}` : "—"}{r.graceEndsAt && <div className="text-[13px] text-muted-foreground">Grace until {formatDate(r.graceEndsAt)}</div>}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.order ? <Link href={`/console/payments/${r.order.id}`} className="hover:underline">{money(r.order.totalPaise)} · {r.order.status === "paid" ? "paid" : r.order.hasLink ? "link sent" : "waiting"}</Link> : <span className="text-muted-foreground">Not made yet</span>}</td>
                  <td className="px-5 py-3"><ClientStatus status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function Billing() {
  const router = useRouter()
  const params = useSearchParams()
  const { me } = useAuth()
  const vendor = me?.console?.audience === "vendor"
  const tab = (["orders", "payments", "invoices", "renewals"] as const).find((t) => t === params.get("tab")) ?? "orders"
  const setTab = (t: Tab) => router.replace(t === "orders" ? "/console/payments" : `/console/payments?tab=${t}`, { scroll: false })
  const { data: s } = useApi<BillingSummary>("/console/billing/summary")
  const month = new Date().toLocaleString("en-IN", { month: "long" })
  return (
    <Page eyebrow="Workspace" title="Billing" subtitle={vendor ? "Orders and payments from the businesses you brought in." : "Orders, money received, AHEAD's GST invoices and renewals coming up."}>
      <StatGrid>
        {s ? (
          <>
            <Stat icon={Wallet} label={`Received in ${month}`} value={money(s.receivedPaise)} hint={`${s.receivedCount} payment${s.receivedCount === 1 ? "" : "s"} · last month ${money(s.receivedLastMonthPaise)}`} />
            <Stat icon={Hourglass} label="Waiting for payment" value={money(s.waitingPaise)} hint={`${s.waitingCount} order${s.waitingCount === 1 ? "" : "s"}${s.approvals ? ` · ${s.approvals} discount${s.approvals === 1 ? "" : "s"} to approve` : ""}`} tone={s.approvals ? "warn" : undefined} />
            <Stat icon={CreditCard} label="Payment overdue" value={s.overdue} hint="Past the renewal date, in grace" tone={s.overdue ? "warn" : undefined} />
            <Stat icon={CalendarClock} label="Renewals · 30 days" value={s.renewals30d} hint="See Renewals" />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[138px] animate-pulse rounded-xl bg-muted" />)
        )}
      </StatGrid>
      <PageTabs tabs={[{ key: "orders", label: "Orders" }, { key: "payments", label: "Payments received" }, { key: "invoices", label: "Invoices" }, { key: "renewals", label: "Renewals" }]} active={tab} onChange={setTab} />
      {tab === "orders" && <Orders />}
      {tab === "payments" && <Payments />}
      {tab === "invoices" && <Invoices />}
      {tab === "renewals" && <Renewals />}
    </Page>
  )
}

export default function BillingPage() {
  return (
    <React.Suspense>
      <Billing />
    </React.Suspense>
  )
}
