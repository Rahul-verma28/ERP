"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { AlarmClock, BookOpen, FilePlus2, FileText, IndianRupee, MessageCircle, Pencil, Phone, ShoppingCart, Undo2, Wallet } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { EmptyState, StatusBadge } from "@/components/common"
import { DataList, localList, periodFilter, type Column } from "@/components/data-list"
import { ActionMenu, BackLink, DetailHeader, DetailList, Pill, Section, Tabs } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { SupplierDialog } from "@/components/supplier-dialog"
import { methodLabel } from "@/components/pay-supplier"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { api, errorMessage } from "@/lib/api"
import { formatDate, formatPaise } from "@/lib/format"
import { stateName } from "@contracts/validation"
import { invoiceStatus, returnStatus, type Supplier } from "@/lib/purchase"
import { cn } from "@/lib/utils"
import { PageLoading } from "@/components/page-states"

// One supplier, laid out like a statement: totals for a period on top, then their invoices, returns,
// payments and the running ledger. The cards and the first three tabs come from one request.

interface Doc { id: string; kind: string; status: string; number: string; supplierRef: string | null; supplierDate: string | null; issueDate: string; dueDate: string | null; location: string | null; taxablePaise: number; taxPaise: number; totalPaise: number; paidPaise: number; returnedPaise: number; balancePaise: number; overdue: boolean; sourceId: string | null; sourceNumber: string | null; returnReason: string | null; lineCount: number; items: string | null }
interface Pay { id: string; number: string; paidOn: string; method: string; reference: string | null; accountName: string | null; amountPaise: number; reversed: boolean; bills: string[] }
interface Overview { supplier: Supplier; totals: { billedPaise: number; returnedPaise: number; paidPaise: number; balancePaise: number; overduePaise: number }; bills: Doc[]; returns: Doc[]; payments: Pay[] }
interface LedgerRow { id: string; kind: string; number: string; date: string; details: string; billPaise: number; paidPaise: number; balancePaise: number }
type Tab = "invoices" | "returns" | "payments" | "ledger" | "details"

const KIND: Record<string, string> = { purchase_bill: "Invoice", purchase_return: "Return", payment: "Payment", payment_reversal: "Payment reversed" }
const PERIODS = [["this_month", "This month"], ["this_fy", "This year"], ["last_fy", "Last year"], ["all", "All time"]] as const

function range(key: string, fyStart: number): { from: string; to: string } {
  if (key === "all") return { from: "", to: "" }
  if (key === "last_fy") {
    const r = periodFilter(fyStart).toParams!("this_fy")
    const y = (s: string) => `${Number(s.slice(0, 4)) - 1}${s.slice(4)}`
    return { from: y(r.from), to: y(r.to) }
  }
  const r = periodFilter(fyStart).toParams!(key)
  return { from: r.from, to: r.to }
}
const money = (p: number, cls?: string) => <span className={cn("tabular-nums", cls)}>{formatPaise(p)}</span>
const date = (d: string | null) => (d ? formatDate(d) : "—")

export default function SupplierPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can, me } = useAuth()
  const fyStart = me?.tenant?.fyStartMonth ?? 4
  const [editing, setEditing] = React.useState(false)
  const [tab, setTab] = React.useState<Tab>("invoices")
  const [period, setPeriod] = React.useState<string>("this_fy")
  const [dates, setDates] = React.useState(() => range("this_fy", fyStart))
  const qs = new URLSearchParams(Object.entries(dates).filter(([, v]) => v)).toString()
  const res = useApi<Overview>(`/suppliers/${id}/overview${qs ? `?${qs}` : ""}`)
  if (res.error && !res.data) return <PageHeader title="Not found" description={errorMessage(res.error)} />
  const ov = res.data
  if (!ov) return <PageLoading />
  const s = ov.supplier
  const t = ov.totals
  const name = s.companyName || s.name
  const a = s.address ?? {}
  const wa = s.phone ? `https://wa.me/${s.phone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}` : null
  const canBill = can("inventory.supplier_bill.create")
  const canSee = can("inventory.supplier_bill.view")
  const pick = (k: string) => { setPeriod(k); setDates(range(k, fyStart)) }

  const billCols: Column<Doc>[] = [
    { key: "number", header: "Invoice Number", hideable: false, csv: (r) => r.number, cell: (r) => <span className="grid gap-0.5"><span className="font-mono text-xs font-medium text-primary">{r.number}</span>{r.supplierRef && <span className="text-[11px] text-muted-foreground">Their no. {r.supplierRef}</span>}</span> },
    { key: "date", header: "Invoice Date", sort: (r) => r.issueDate, csv: (r) => r.issueDate.slice(0, 10), cell: (r) => date(r.supplierDate ?? r.issueDate) },
    { key: "due", header: "Due Date", csv: (r) => r.dueDate?.slice(0, 10) ?? "", cell: (r) => <span className={r.overdue ? "text-destructive" : ""}>{date(r.dueDate)}{r.overdue && <span className="block text-[11px] font-medium">Overdue</span>}</span> },
    { key: "warehouse", header: "Warehouse", defaultHidden: true, csv: (r) => r.location ?? "", cell: (r) => r.location ?? "—" },
    { key: "items", header: "Items", csv: (r) => r.items ?? "", cell: (r) => <span title={r.items ?? ""} className="block max-w-60 truncate text-[13px]">{r.items ?? "—"}</span> },
    { key: "subtotal", header: "Subtotal", align: "right", csv: (r) => r.taxablePaise / 100, cell: (r) => money(r.taxablePaise) },
    { key: "tax", header: "Tax", align: "right", csv: (r) => r.taxPaise / 100, cell: (r) => money(r.taxPaise) },
    { key: "total", header: "Total Amount", align: "right", sort: (r) => r.totalPaise, csv: (r) => r.totalPaise / 100, cell: (r) => money(r.totalPaise, "font-semibold") },
    { key: "balance", header: "Balance", align: "right", sort: (r) => r.balancePaise, csv: (r) => r.balancePaise / 100, cell: (r) => (r.status === "draft" || r.status === "cancelled" ? "—" : money(r.balancePaise, r.balancePaise > 0 ? "text-orange-600 dark:text-orange-300" : "text-emerald-700 dark:text-emerald-300")) },
    { key: "status", header: "Status", csv: (r) => invoiceStatus(r.status), cell: (r) => <StatusBadge status={r.status} label={invoiceStatus(r.status)} /> },
  ]
  const returnCols: Column<Doc>[] = [
    { key: "number", header: "Return Number", hideable: false, csv: (r) => r.number, cell: (r) => <span className="grid gap-0.5"><span className="font-mono text-xs font-medium text-primary">{r.number}</span>{r.sourceNumber && <span className="text-[11px] text-muted-foreground">Against {r.sourceNumber}</span>}</span> },
    { key: "date", header: "Return Date", csv: (r) => r.issueDate.slice(0, 10), cell: (r) => date(r.issueDate) },
    { key: "warehouse", header: "Warehouse", csv: (r) => r.location ?? "", cell: (r) => r.location ?? "—" },
    { key: "reason", header: "Reason", csv: (r) => r.returnReason ?? "", cell: (r) => r.returnReason ?? "—" },
    { key: "items", header: "Items", csv: (r) => r.items ?? "", cell: (r) => <span title={r.items ?? ""} className="block max-w-60 truncate text-[13px]">{r.items ?? "—"}</span> },
    { key: "total", header: "Total", align: "right", csv: (r) => r.totalPaise / 100, cell: (r) => money(r.totalPaise, "font-semibold") },
    { key: "status", header: "Status", csv: (r) => returnStatus(r.status), cell: (r) => <StatusBadge status={r.status} label={returnStatus(r.status)} /> },
  ]
  const payCols: Column<Pay>[] = [
    { key: "number", header: "Payment Number", hideable: false, csv: (r) => r.number, cell: (r) => <span className="font-mono text-xs font-medium text-primary">{r.number}</span> },
    { key: "date", header: "Payment Date", csv: (r) => r.paidOn.slice(0, 10), cell: (r) => date(r.paidOn) },
    { key: "method", header: "Paid by", csv: (r) => methodLabel(r.method), cell: (r) => <Pill color="blue">{methodLabel(r.method)}</Pill> },
    { key: "account", header: "Paid from", csv: (r) => r.accountName ?? "", cell: (r) => r.accountName ?? "—" },
    { key: "reference", header: "Reference", csv: (r) => r.reference ?? "", cell: (r) => <span className="font-mono text-xs">{r.reference ?? "—"}</span> },
    { key: "against", header: "Against", csv: (r) => r.bills.join(" "), cell: (r) => <span className="flex flex-wrap gap-1">{r.bills.map((b) => <span key={b} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">{b}</span>)}</span> },
    { key: "amount", header: "Amount", align: "right", csv: (r) => r.amountPaise / 100, cell: (r) => money(r.amountPaise, cn("font-semibold", r.reversed && "text-muted-foreground line-through")) },
    { key: "status", header: "Status", csv: (r) => (r.reversed ? "Reversed" : "Paid"), cell: (r) => <Pill color={r.reversed ? "slate" : "emerald"}>{r.reversed ? "Reversed" : "Paid"}</Pill> },
  ]
  const docMatch = (r: Doc, q: string) => `${r.number} ${r.supplierRef ?? ""} ${r.sourceNumber ?? ""} ${r.items ?? ""}`.toLowerCase().includes(q)

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/purchase/suppliers">Suppliers</BackLink>
      <DetailHeader
        title={name}
        initials={name}
        pills={<><Pill color={s.gstin ? "blue" : "slate"}>{s.gstin ? "GST registered" : "Not registered"}</Pill>{!s.isActive && <Pill>Inactive</Pill>}{s.overdueCount ? <Pill color="rose">{s.overdueCount} overdue</Pill> : null}</>}
        subtitle={[s.companyName ? s.name : null, s.gstin, s.stateCode ? stateName(s.stateCode) : null, s.phone, s.email].filter(Boolean).join(" · ") || undefined}
        actions={<>
          {s.phone && <a href={`tel:${s.phone}`} className={buttonVariants({ variant: "outline", size: "icon" })} title={`Call ${s.phone}`} aria-label="Call"><Phone /></a>}
          {wa && <a href={wa} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "icon" }), "text-emerald-700 dark:text-emerald-300")} title="WhatsApp" aria-label="WhatsApp"><MessageCircle /></a>}
          {canBill && <Link href={`/app/m/purchase/payments?new=1&supplier=${s.id}`} className={buttonVariants({ variant: "outline" })}><IndianRupee /> Pay supplier</Link>}
          {canBill && <Link href={`/app/m/purchase/new?kind=purchase_bill&supplier=${s.id}`} className={buttonVariants()}><FilePlus2 /> New invoice</Link>}
          <ActionMenu items={[
            can("inventory.supplier.edit") && { label: "Edit supplier", icon: Pencil, onClick: () => setEditing(true) },
            canBill && { label: "Return goods", icon: Undo2, href: `/app/m/purchase/new?kind=purchase_return&supplier=${s.id}` },
            me?.tenant?.purchaseOrders && can("inventory.purchase_order.create") && { label: "New purchase order", icon: ShoppingCart, href: `/app/m/purchase/new?kind=purchase_order&supplier=${s.id}` },
          ]} />
        </>}
      />

      {canSee && (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-3">
            <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
              {PERIODS.map(([k, label]) => (
                <button key={k} type="button" onClick={() => pick(k)} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors", period === k && "bg-background text-foreground shadow-sm")}>{label}</button>
              ))}
            </div>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">From<Input type="date" className="h-9 w-40" value={dates.from} max={dates.to || undefined} onChange={(e) => { setPeriod("custom"); setDates((d) => ({ ...d, from: e.target.value })) }} /></label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">To<Input type="date" className="h-9 w-40" value={dates.to} min={dates.from || undefined} onChange={(e) => { setPeriod("custom"); setDates((d) => ({ ...d, to: e.target.value })) }} /></label>
            <p className="ml-auto self-center text-xs text-muted-foreground">{dates.from || dates.to ? `${dates.from ? formatDate(dates.from) : "Start"} – ${dates.to ? formatDate(dates.to) : "Today"}` : "Everything so far"}</p>
          </div>
          <SummaryCards items={[
            { label: "Total billed", value: formatPaise(t.billedPaise), hint: `${ov.bills.filter((b) => b.status !== "draft" && b.status !== "cancelled").length} invoices in this period`, color: "blue", icon: FileText },
            { label: "Returns", value: formatPaise(t.returnedPaise), hint: `${ov.returns.length} returns in this period`, color: "amber", icon: Undo2 },
            { label: "Payments", value: formatPaise(t.paidPaise), hint: `${ov.payments.filter((p) => !p.reversed).length} payments in this period`, color: "emerald", icon: Wallet },
            { label: t.balancePaise < 0 ? "They owe you" : "You owe", value: formatPaise(Math.abs(t.balancePaise)), hint: "All time, posted invoices", color: "violet", icon: IndianRupee },
            { label: "Overdue", value: formatPaise(t.overduePaise), hint: s.overdueCount ? `${s.overdueCount} invoices past due` : "Nothing overdue", color: "rose", icon: AlarmClock },
          ]} />
        </>
      )}

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "invoices", label: "Purchase Invoices", count: ov.bills.length, hidden: !canSee },
        { key: "returns", label: "Purchase Returns", count: ov.returns.length, hidden: !canSee },
        { key: "payments", label: "Payments", count: ov.payments.length, hidden: !canSee },
        { key: "ledger", label: "Ledger", hidden: !canSee },
        { key: "details", label: "Details" },
      ]} />

      {tab === "invoices" && canSee && (
        <DataList<Doc>
          id="supplier-bills"
          load={localList(async () => ov.bills, docMatch)}
          params={{ q: qs }}
          header={{ title: "Purchase Invoices", description: "Their invoices to you in this period, newest first." }}
          columns={billCols}
          searchPlaceholder="Search number, their no. or item"
          rowHref={(r) => `/app/m/purchase/${r.id}`}
          exportName="supplier-invoices"
          emptyState={<EmptyState icon={FileText} title="No invoices in this period" action={canBill ? <Link href={`/app/m/purchase/new?kind=purchase_bill&supplier=${s.id}`} className={buttonVariants()}><FilePlus2 /> New invoice</Link> : undefined} />}
        />
      )}
      {tab === "returns" && canSee && (
        <DataList<Doc>
          id="supplier-returns"
          load={localList(async () => ov.returns, docMatch)}
          params={{ q: qs }}
          header={{ title: "Purchase Returns", description: "Goods sent back to this supplier in this period." }}
          columns={returnCols}
          searchPlaceholder="Search number, invoice or item"
          rowHref={(r) => `/app/m/purchase/${r.id}`}
          exportName="supplier-returns"
          emptyState={<EmptyState icon={Undo2} title="No returns in this period" />}
        />
      )}
      {tab === "payments" && canSee && (
        <DataList<Pay>
          id="supplier-payments"
          load={localList(async () => ov.payments, (r, q) => `${r.number} ${r.reference ?? ""} ${r.bills.join(" ")}`.toLowerCase().includes(q))}
          params={{ q: qs }}
          header={{ title: "Payments", description: "What you paid this supplier in this period, and which invoices it went on." }}
          columns={payCols}
          searchPlaceholder="Search payment, reference or invoice"
          rowHref={() => `/app/m/purchase/payments`}
          exportName="supplier-payments"
          emptyState={<EmptyState icon={Wallet} title="No payments in this period" action={canBill ? <Link href={`/app/m/purchase/payments?new=1&supplier=${s.id}`} className={buttonVariants()}>Pay supplier</Link> : undefined} />}
        />
      )}
      {tab === "ledger" && canSee && <Ledger id={s.id} dates={dates} onPayment={() => setTab("payments")} onDoc={(docId) => router.push(`/app/m/purchase/${docId}`)} />}
      {tab === "details" && (
        <Section title="Details" action={can("inventory.supplier.edit") && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}>
          <DetailList items={[
            ["Supplier name", s.name], ["Firm name", s.companyName], ["Mobile", s.phone], ["Email", s.email],
            ["GSTIN", s.gstin ?? "Not registered"], ["State", s.stateCode ? stateName(s.stateCode) : null],
            ["Address", [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(", ")], ["Pay within", s.paymentDays != null ? `${s.paymentDays} days` : null],
            ["Last purchase", s.lastBillOn ? formatDate(s.lastBillOn) : "Never"], ["Supplier since", s.createdAt ? formatDate(s.createdAt) : null],
          ]} />
          {s.notes && <p className="mt-4 rounded-2xl bg-muted/60 p-3 text-sm whitespace-pre-wrap">{s.notes}</p>}
        </Section>
      )}
      <SupplierDialog open={editing} onOpenChange={setEditing} supplier={s} onSaved={() => void res.reload()} />
    </div>
  )
}

/** Every invoice, payment and return with the running balance (its own request: opened on demand) */
function Ledger({ id, dates, onPayment, onDoc }: { id: string; dates: { from: string; to: string }; onPayment: () => void; onDoc: (docId: string) => void }) {
  const fmt = (p: number) => `${formatPaise(Math.abs(p))}${p < 0 ? " (they owe you)" : ""}`
  return (
    <DataList<LedgerRow & { docId: string }>
      id="supplier-ledger"
      params={dates}
      load={async ({ params, limit, cursor }) => {
        const r = await api.get<{ openingPaise: number; closingPaise: number; data: LedgerRow[] }>(`/suppliers/${id}/ledger?${new URLSearchParams(Object.entries({ from: params.from, to: params.to }).filter(([, v]) => v) as [string, string][])}`)
        const q = (params.q ?? "").toLowerCase()
        const all = r.data.map((x, n) => ({ ...x, docId: x.id, id: `${x.id}-${n}` })).filter((x) => !q || `${x.number} ${x.details}`.toLowerCase().includes(q))
        const start = Number(cursor ?? 0)
        return { ...r, data: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, total: all.length }
      }}
      header={{ title: "Ledger", description: "Every invoice, payment and return in this period, and the running balance." }}
      summary={(r) => <span className="flex flex-wrap gap-x-4 text-sm text-muted-foreground"><span>Opening <strong className="text-foreground tabular-nums">{fmt(Number(r.openingPaise ?? 0))}</strong></span><span>Closing <strong className="text-foreground tabular-nums">{fmt(Number(r.closingPaise ?? 0))}</strong></span></span>}
      columns={[
        { key: "date", header: "Date", hideable: false, csv: (r) => r.date.slice(0, 10), cell: (r) => formatDate(r.date) },
        { key: "entry", header: "Entry", csv: (r) => `${KIND[r.kind] ?? r.kind} ${r.number}`, cell: (r) => <span>{KIND[r.kind] ?? r.kind} <span className="font-mono text-xs text-primary">{r.number}</span></span> },
        { key: "details", header: "Details", csv: (r) => r.details, cell: (r) => <span className="text-muted-foreground">{r.details}</span> },
        { key: "bill", header: "Invoice", align: "right", csv: (r) => r.billPaise / 100, cell: (r) => (r.billPaise ? <span className="tabular-nums">{formatPaise(r.billPaise)}</span> : "") },
        { key: "paid", header: "Paid or returned", align: "right", csv: (r) => r.paidPaise / 100, cell: (r) => (r.paidPaise ? <span className="tabular-nums">{formatPaise(r.paidPaise)}</span> : "") },
        { key: "balance", header: "Balance", align: "right", csv: (r) => r.balancePaise / 100, cell: (r) => <span className="font-medium tabular-nums">{fmt(r.balancePaise)}</span> },
      ]}
      searchPlaceholder="Search number or details"
      rowClick={(r) => (r.kind === "purchase_bill" || r.kind === "purchase_return" ? onDoc(r.docId) : onPayment())}
      exportName="supplier-ledger"
      emptyState={<EmptyState icon={BookOpen} title="No invoices or payments in this period" />}
    />
  )
}
