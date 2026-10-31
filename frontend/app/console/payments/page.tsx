"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Building2, CalendarClock, Copy, CreditCard, ExternalLink, FileText, Hourglass, Link as LinkIcon, Wallet } from "lucide-react"
import { Chip, ClientStatus, Failed, Page, PageTabs, Stat, StatGrid, money, relDays, type Tone } from "@/components/console/kit"
import { DataTable, FilterSelect, IdCell, type Column, type RowAction } from "@/components/console/data-table"
import { useClientTable, useServerTable } from "@/lib/use-table"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { ORDER_STATUS_LABEL, type BillingSummary, type InvoiceRow, type OrderRow, type OrderStatus, type PaymentRow, type RenewalRow } from "@/lib/console"

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

const ORDER_STATUS: [string, string][] = [["", "Any status"], ...ORDER_TABS.filter((t) => t.value).map((t) => [t.value, t.label] as [string, string])]
const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`), () => toast.error(`Couldn't copy the ${what.toLowerCase()}`))
const gstOf = (o: OrderRow) => (o.cgstPaise ?? 0) + (o.sgstPaise ?? 0) + (o.igstPaise ?? 0)

function Orders() {
  const router = useRouter()
  const params = useSearchParams()
  const [status, setStatus] = React.useState(params.get("status") ?? "")
  const table = useServerTable<OrderRow>("/console/orders", { status })
  const columns: Column<OrderRow>[] = [
    { key: "id", header: "Order ID", cell: (o) => <IdCell id={o.id} href={`/console/payments/${o.id}`} /> },
    { key: "business", header: "Business", always: true, cell: (o) => <Link href={`/console/clients/${o.tenantId}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{o.clientName ?? "Business"}</Link> },
    { key: "kind", header: "Type", cell: (o) => KIND[o.kind] ?? o.kind },
    { key: "plan", header: "Plan", cell: (o) => o.planName ?? "—" },
    { key: "cycle", header: "Cycle", cell: (o) => (o.cycle === "yearly" ? "Yearly" : "Monthly") },
    { key: "status", header: "Status", cell: (o) => <span className="inline-flex items-center gap-2"><Chip tone={TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Chip>{o.status === "awaiting_payment" && <span className="text-[12.5px] text-muted-foreground">cancels {relDays(o.expiresAt)}</span>}</span> },
    { key: "list", header: "List price", align: "right", hidden: true, cell: (o) => (o.listPaise !== null ? formatPaise(o.listPaise) : "—") },
    { key: "discount", header: "Discount", align: "right", cell: (o) => (o.discountPaise ? <span title={o.couponCode ? `Coupon ${o.couponCode}` : undefined}>{formatPaise(o.discountPaise)}{o.discountBp ? <span className="text-muted-foreground"> · {o.discountBp / 100}%</span> : null}</span> : "—") },
    { key: "taxable", header: "Before GST", align: "right", hidden: true, cell: (o) => (o.taxablePaise !== null ? formatPaise(o.taxablePaise) : "—") },
    { key: "gst", header: "GST", align: "right", hidden: true, cell: (o) => formatPaise(gstOf(o)) },
    { key: "total", header: "Total", align: "right", cell: (o) => <span className="font-medium">{formatPaise(o.totalPaise)}</span> },
    { key: "coupon", header: "Coupon", hidden: true, cell: (o) => o.couponCode ?? "—" },
    { key: "created", header: "Created", cell: (o) => <span className="text-muted-foreground">{formatDate(o.createdAt)}</span> },
    { key: "paid", header: "Paid on", cell: (o) => <span className="text-muted-foreground">{o.paidAt ? formatDate(o.paidAt) : "—"}</span> },
    { key: "by", header: "Created by", cell: (o) => o.createdByName ?? "—" },
    { key: "invoice", header: "Invoice", cell: (o) => (o.invoice ? <Link href={`/console/invoices/${o.invoice.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12.5px] text-primary hover:underline">{o.invoice.number}</Link> : <span className="text-muted-foreground">—</span>) },
  ]
  const actions = (o: OrderRow): RowAction[] => [
    { label: "Open order", icon: ExternalLink, href: `/console/payments/${o.id}` },
    { label: "Open business", icon: Building2, href: `/console/clients/${o.tenantId}?tab=plan` },
    { label: "Open invoice", icon: FileText, href: o.invoice ? `/console/invoices/${o.invoice.id}` : undefined, hidden: !o.invoice },
    { label: "Copy payment link", icon: LinkIcon, onClick: () => copy(o.paymentLinkUrl!, "Payment link"), hidden: !o.paymentLinkUrl || o.status !== "awaiting_payment", separator: true },
    { label: "Copy order ID", icon: Copy, onClick: () => copy(o.id, "Order ID"), separator: !o.paymentLinkUrl || o.status !== "awaiting_payment" },
  ]
  return (
    <DataTable
      id="orders"
      label="Orders"
      table={table}
      columns={columns}
      actions={actions}
      noSearch
      onRowClick={(o) => router.push(`/console/payments/${o.id}`)}
      filters={<FilterSelect value={status} onChange={setStatus} label="Order status" options={ORDER_STATUS} />}
      empty={<span className="inline-flex items-center gap-2"><CreditCard className="size-4" /> No orders here. An order is made when a business is onboarded on a paid plan, converted, upgraded or renewed.</span>}
    />
  )
}

function Payments() {
  const table = useServerTable<PaymentRow>("/console/billing/payments", {})
  const columns: Column<PaymentRow>[] = [
    { key: "id", header: "Payment ID", cell: (p) => <IdCell id={p.id} /> },
    { key: "received", header: "Received", always: true, cell: (p) => formatDate(p.receivedAt) },
    { key: "business", header: "Business", cell: (p) => <Link href={`/console/clients/${p.tenantId}?tab=plan`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{p.business}</Link> },
    { key: "kind", header: "For", cell: (p) => KIND[p.kind] ?? p.kind },
    { key: "plan", header: "Plan", cell: (p) => (p.plan ? `${p.plan}${p.cycle ? ` · ${p.cycle === "yearly" ? "Yearly" : "Monthly"}` : ""}` : "—") },
    { key: "method", header: "Method", cell: (p) => METHOD[p.method] ?? p.method },
    { key: "reference", header: "Reference", cell: (p) => <span className="font-mono text-[12.5px]">{p.reference ?? "—"}</span> },
    { key: "gateway", header: "Gateway payment ID", hidden: true, cell: (p) => <span className="font-mono text-[12.5px]">{p.gatewayPaymentId ?? "—"}</span> },
    { key: "amount", header: "Amount", align: "right", cell: (p) => <span className="font-medium">{money(p.amountPaise)}</span> },
    { key: "by", header: "Recorded by", cell: (p) => p.recordedBy ?? "—" },
    { key: "order", header: "Order", cell: (p) => <IdCell id={p.orderId} href={`/console/payments/${p.orderId}`} /> },
    { key: "invoice", header: "Invoice", cell: (p) => (p.invoice ? <Link href={`/console/invoices/${p.invoice.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12.5px] text-primary hover:underline">{p.invoice.number}</Link> : "—") },
  ]
  const actions = (p: PaymentRow): RowAction[] => [
    { label: "Open order", icon: ExternalLink, href: `/console/payments/${p.orderId}` },
    { label: "Open business", icon: Building2, href: `/console/clients/${p.tenantId}?tab=plan` },
    { label: "Open invoice", icon: FileText, href: p.invoice ? `/console/invoices/${p.invoice.id}` : undefined, hidden: !p.invoice },
    { label: "Copy reference", icon: Copy, onClick: () => copy(p.reference!, "Reference"), hidden: !p.reference, separator: true },
  ]
  return <DataTable id="payments" label="Payments received" table={table} columns={columns} actions={actions} noSearch empty={<span className="inline-flex items-center gap-2"><Wallet className="size-4" /> No payments yet.</span>} />
}

function Invoices() {
  const table = useServerTable<InvoiceRow>("/console/billing/invoices", {})
  const columns: Column<InvoiceRow>[] = [
    { key: "number", header: "Invoice number", always: true, cell: (i) => <Link href={`/console/invoices/${i.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12.5px] text-primary hover:underline">{i.number}</Link> },
    { key: "id", header: "Invoice ID", hidden: true, cell: (i) => <IdCell id={i.id} /> },
    { key: "business", header: "Business", cell: (i) => <Link href={`/console/clients/${i.tenantId}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{i.business}</Link> },
    { key: "date", header: "Date", cell: (i) => formatDate(i.issuedAt) },
    { key: "taxable", header: "Before GST", align: "right", cell: (i) => money(i.taxablePaise) },
    { key: "gst", header: "GST", align: "right", cell: (i) => <span className="text-muted-foreground">{money(i.gstPaise)}</span> },
    { key: "total", header: "Total", align: "right", cell: (i) => <span className="font-medium">{money(i.totalPaise)}</span> },
    { key: "order", header: "Order", cell: (i) => (i.orderId ? <IdCell id={i.orderId} href={`/console/payments/${i.orderId}`} /> : "—") },
  ]
  const actions = (i: InvoiceRow): RowAction[] => [
    { label: "Open invoice", icon: FileText, href: `/console/invoices/${i.id}` },
    { label: "Open order", icon: ExternalLink, href: i.orderId ? `/console/payments/${i.orderId}` : undefined, hidden: !i.orderId },
    { label: "Open business", icon: Building2, href: `/console/clients/${i.tenantId}` },
    { label: "Copy invoice number", icon: Copy, onClick: () => copy(i.number, "Invoice number"), separator: true },
  ]
  return <DataTable id="invoices" label="Invoices" table={table} columns={columns} actions={actions} noSearch empty={<span className="inline-flex items-center gap-2"><FileText className="size-4" /> No invoices yet. AHEAD&apos;s GST invoice is issued when an order is paid.</span>} />
}

function Renewals() {
  const { data, error, reload } = useApi<{ data: RenewalRow[] }>("/console/billing/renewals")
  const rows = React.useMemo(() => data?.data.map((r) => ({ ...r, id: r.tenantId })) ?? null, [data])
  const table = useClientTable(rows, { business: (r) => r.business, plan: (r) => r.plan, renews: (r) => r.renewsAt ?? "", status: (r) => r.status })
  if (error) return <Failed error={error} onRetry={reload} />
  const columns: Column<RenewalRow & { id: string }>[] = [
    { key: "business", header: "Business", always: true, sortable: true, cell: (r) => <Link href={`/console/clients/${r.tenantId}?tab=plan`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{r.business}</Link> },
    { key: "id", header: "Business ID", hidden: true, cell: (r) => <IdCell id={r.tenantId} /> },
    { key: "plan", header: "Plan", sortable: true, cell: (r) => <span>{r.plan} · {r.cycle}{r.changeTo && <span className="text-primary"> → {r.changeTo}</span>}</span> },
    { key: "renews", header: "Renews", sortable: true, cell: (r) => (r.status === "past_due" ? <span className="text-red-700 dark:text-red-400">Was due {r.renewsAt ? formatDate(r.renewsAt) : ""}</span> : r.renewsAt ? `${formatDate(r.renewsAt)} · ${relDays(r.renewsAt)}` : "—") },
    { key: "grace", header: "Grace until", cell: (r) => (r.graceEndsAt ? formatDate(r.graceEndsAt) : "—") },
    { key: "order", header: "Renewal order", cell: (r) => (r.order ? <Link href={`/console/payments/${r.order.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{money(r.order.totalPaise)} · {r.order.status === "paid" ? "paid" : r.order.hasLink ? "link sent" : "waiting"}</Link> : <span className="text-muted-foreground">Not made yet</span>) },
    { key: "status", header: "Status", sortable: true, cell: (r) => <ClientStatus status={r.status} /> },
  ]
  const actions = (r: RenewalRow): RowAction[] => [
    { label: "Open business", icon: Building2, href: `/console/clients/${r.tenantId}?tab=plan` },
    { label: "Open renewal order", icon: ExternalLink, href: r.order ? `/console/payments/${r.order.id}` : undefined, hidden: !r.order },
  ]
  return (
    <DataTable
      id="renewals"
      label="Renewals"
      table={table}
      columns={columns}
      actions={actions}
      searchFields={[{ key: "business", label: "Business" }, { key: "plan", label: "Plan" }]}
      summary={<span className="text-muted-foreground">Next 30 days, and past due. The order and payment link go out 7 days before.</span>}
      empty="No renewals in the next 30 days."
    />
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
    <Page wide eyebrow="Workspace" title="Billing" subtitle={vendor ? "Orders and payments from the businesses you brought in." : "Orders, money received, AHEAD's GST invoices and renewals coming up."}>
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
