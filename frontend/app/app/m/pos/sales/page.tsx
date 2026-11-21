"use client"

import * as React from "react"
import Link from "next/link"
import { CalendarDays, Eye, IndianRupee, Printer, Receipt, ShoppingBag, Store, Undo2, Wallet } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { DataList, periodFilter, type Column } from "@/components/data-list"
import { Pill } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise, initials } from "@/lib/format"
import { TENDER_LABEL } from "@/lib/pos"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"

// Counter bills: every bill made at a POS counter, with how it was paid, the shift and cashier.
// Each is an ordinary invoice, so View opens it in Sales Invoices with its payments and returns.

interface Row {
  id: string; number: string; status: string; issueDate: string; at: string | null; totalPaise: number; duePaise: number; returnedPaise: number
  customer: string; phone: string | null; contactId: string | null; counterId: string; counter: string; shiftId: string; shift: string
  cashierId: string | null; cashier: string | null; lines: number; qty: number; paidBy: string; methods: string[]
}

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "")

export default function CounterBillsPage() {
  const { can, me } = useAuth()
  const counters = useApi<{ counters: { id: string; name: string }[] }>(can("billing.pos.view") ? "/pos/sales?limit=1" : null)
  if (!can("billing.pos.view")) return <PageHeader title="Counter Bills" description="You don't have access to the POS counter. Ask your admin." />
  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })
  const status = (r: Row) => (r.status === "cancelled" ? { label: "Cancelled", color: "slate" } : r.duePaise > 0 ? { label: "On account", color: "amber" } : r.returnedPaise > 0 ? { label: "Part returned", color: "violet" } : { label: "Paid", color: "emerald" })
  const columns: Column<Row>[] = [
    { key: "number", header: "Bill no.", hideable: false, sort: (r) => r.number, csv: (r) => r.number, cell: (r) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.number}</span> },
    { key: "date", header: "Date", sort: (r) => r.at ?? r.issueDate, csv: (r) => r.issueDate.slice(0, 10), cell: (r) => <span>{formatDate(r.issueDate)}<span className="block text-xs text-muted-foreground">{time(r.at)}</span></span> },
    {
      key: "customer", header: "Customer", sort: (r) => r.customer.toLowerCase(), csv: (r) => r.customer,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(r.customer)}</span>
          <span className="min-w-0">{r.contactId ? <Link href={`/app/m/sales/customers/${r.contactId}`} onClick={(e) => e.stopPropagation()} className="block font-medium hover:underline">{r.customer}</Link> : <span className="block font-medium">{r.customer}</span>}<span className="block text-xs text-muted-foreground">{r.phone ?? (r.contactId ? "—" : "Walk-in")}</span></span>
        </span>
      ),
    },
    { key: "counter", header: "Counter", sort: (r) => r.counter, csv: (r) => r.counter, cell: (r) => <span className="inline-flex items-center gap-1.5 text-sm"><Store className="size-3.5 text-muted-foreground" />{r.counter}<Link href={`/app/m/pos/shifts/${r.shiftId}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[11px] text-muted-foreground hover:underline">{r.shift}</Link></span> },
    { key: "cashier", header: "Cashier", sort: (r) => r.cashier ?? "", csv: (r) => r.cashier ?? "", cell: (r) => r.cashier ?? "—" },
    { key: "items", header: "Items", align: "right", sort: (r) => r.qty, csv: (r) => r.qty, cell: (r) => <span className="tabular-nums">{Number(r.qty.toFixed(3))}<span className="block text-xs text-muted-foreground">{r.lines} line{r.lines === 1 ? "" : "s"}</span></span> },
    { key: "paidBy", header: "Paid by", csv: (r) => TENDER_LABEL[r.paidBy] ?? r.paidBy, cell: (r) => <Pill color={r.paidBy === "cash" ? "emerald" : r.paidBy === "credit" ? "amber" : r.paidBy === "mixed" ? "violet" : "blue"} title={r.methods.map((m) => TENDER_LABEL[m] ?? m).join(" + ")}>{TENDER_LABEL[r.paidBy] ?? r.paidBy}</Pill> },
    { key: "total", header: "Amount", align: "right", sort: (r) => r.totalPaise, csv: (r) => (r.totalPaise / 100).toFixed(2), cell: (r) => <span className={cn("font-semibold tabular-nums", r.status === "cancelled" && "text-muted-foreground line-through")}>{formatPaise(r.totalPaise)}</span> },
    { key: "due", header: "Due", align: "right", sort: (r) => r.duePaise, csv: (r) => (r.duePaise / 100).toFixed(2), cell: (r) => <span className={cn("tabular-nums", r.duePaise > 0 ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{r.duePaise > 0 ? formatPaise(r.duePaise) : "—"}</span> },
    { key: "returned", header: "Returned", align: "right", defaultHidden: true, sort: (r) => r.returnedPaise, csv: (r) => (r.returnedPaise / 100).toFixed(2), cell: (r) => (r.returnedPaise > 0 ? formatPaise(r.returnedPaise) : "—") },
    { key: "status", header: "Status", csv: (r) => status(r).label, cell: (r) => { const s = status(r); return <Pill color={s.color} dot>{s.label}</Pill> } },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Link href={`/app/m/billing/${r.id}`} className={icon} title="View" aria-label={`View ${r.number}`}><Eye /></Link>
          <a href={`/print/pos/${r.id}`} target="_blank" rel="noreferrer" className={icon} title="Print receipt" aria-label={`Print ${r.number}`}><Printer /></a>
        </span>
      ),
    },
  ]
  const counterButton = <Link href="/app/m/pos" className={cn(buttonVariants(), "h-10 rounded-xl px-4 font-semibold")}><Store /> Open counter</Link>
  return (
    <DataList<Row>
      id="pos-sales"
      path="/pos/sales"
      header={{ title: "Counter Bills", description: "Every bill made at a POS counter. Each is a GST invoice, so its stock, payments and returns are in Sales too.", primary: counterButton, more: [{ label: "Shifts", href: "/app/m/pos/shifts" }, { label: "POS reports", href: "/app/m/pos/reports" }, { label: "Sales Invoices", href: "/app/m/billing" }] }}
      columns={columns}
      rowHref={(r) => `/app/m/billing/${r.id}`}
      searchPlaceholder="Search bill no., customer, phone, counter or cashier"
      presets={[
        { key: "all", label: "All", params: {}, countKey: "all" },
        { key: "paid", label: "Paid", params: { view: "paid" }, countKey: "paid" },
        { key: "due", label: "On account", params: { view: "due" }, countKey: "due" },
        { key: "returned", label: "Returned", params: { view: "returned" }, countKey: "returned" },
        { key: "cancelled", label: "Cancelled", params: { view: "cancelled" }, countKey: "cancelled" },
      ]}
      tabs
      top={(res) => {
        const s = (res.sums ?? {}) as Record<string, number>
        return <SummaryCards items={[
          { label: "Counter sales", value: formatPaise(s.sales ?? 0), hint: `${s.bills ?? 0} bills`, color: "blue", icon: ShoppingBag },
          { label: "Today", value: formatPaise(s.today ?? 0), hint: `${s.todayBills ?? 0} bills`, color: "violet", icon: CalendarDays },
          { label: "Average bill", value: formatPaise(s.average ?? 0), hint: `${Number((s.items ?? 0).toFixed(0))} items sold`, color: "emerald", icon: Receipt },
          { label: "On account", value: formatPaise(s.due ?? 0), hint: "Still owed by customers", color: "amber", icon: Wallet },
          { label: "Returned", value: formatPaise(s.returned ?? 0), hint: "Goods taken back", color: "rose", icon: Undo2 },
        ]} />
      }}
      filters={[
        periodFilter(me?.tenant?.fyStartMonth ?? 4),
        { key: "counterId", label: "Counter", options: (counters.data?.counters ?? []).map((c) => ({ value: c.id, label: c.name })) },
        { key: "method", label: "Paid by", options: ["cash", "upi", "card", "mixed", "credit"].map((m) => ({ value: m, label: TENDER_LABEL[m] })) },
      ]}
      exportName="counter-bills"
      emptyState={<EmptyState icon={IndianRupee} title="No counter bills yet" description="Open a shift at a counter and the bills you make there show up here." action={counterButton} />}
    />
  )
}
