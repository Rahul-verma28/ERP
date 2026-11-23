"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, Banknote, Clock, Eye, Smartphone, Store, TrendingUp } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/common"
import { DataList, periodFilter, type Column } from "@/components/data-list"
import { Pill } from "@/components/page-parts"
import { Difference } from "@/components/pos/bits"
import { SummaryCards } from "@/components/summary-cards"
import { useAuth } from "@/lib/auth"
import { formatDateTime, formatPaise } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"
import { NoAccessPage } from "@/components/page-states"

// Shifts: each person's time at a counter, what they sold, the cash expected against the cash
// counted at close, and any short or extra.

interface Row {
  id: string; number: string; status: "open" | "closed"; counterId: string; counter: string; openedBy: string; cashier: string; openedAt: string; closedAt: string | null; closedBy: string | null
  openingCashPaise: number; bills: number; salesPaise: number; cashPaise: number; otherPaise: number
  expectedCashPaise: number | null; countedCashPaise: number | null; differencePaise: number | null; depositPaise: number; note: string | null
}

export default function ShiftsPage() {
  const { can, me } = useAuth()
  const meta = useApi<{ counters: { id: string; name: string }[] }>(can("billing.pos.view") ? "/pos/shifts?limit=1" : null)
  if (!can("billing.pos.view")) return <NoAccessPage title="Shifts" permission="billing.pos.view" />
  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })
  const columns: Column<Row>[] = [
    { key: "number", header: "Shift", hideable: false, sort: (r) => r.number, csv: (r) => r.number, cell: (r) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.number}</span> },
    { key: "counter", header: "Counter", sort: (r) => r.counter, csv: (r) => r.counter, cell: (r) => <span className="inline-flex items-center gap-1.5 font-medium"><Store className="size-3.5 text-muted-foreground" />{r.counter}</span> },
    { key: "cashier", header: "Cashier", sort: (r) => r.cashier, csv: (r) => r.cashier, cell: (r) => r.cashier },
    { key: "opened", header: "Opened", sort: (r) => r.openedAt, csv: (r) => r.openedAt, cell: (r) => <span className="text-sm">{formatDateTime(r.openedAt)}</span> },
    { key: "closed", header: "Closed", sort: (r) => r.closedAt ?? "", csv: (r) => r.closedAt ?? "", cell: (r) => (r.closedAt ? <span className="text-sm">{formatDateTime(r.closedAt)}</span> : <Pill color="emerald" dot>Open now</Pill>) },
    { key: "bills", header: "Bills", align: "right", sort: (r) => r.bills, csv: (r) => r.bills, cell: (r) => <span className="tabular-nums">{r.bills}</span> },
    { key: "sales", header: "Sales", align: "right", sort: (r) => r.salesPaise, csv: (r) => (r.salesPaise / 100).toFixed(2), cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.salesPaise)}</span> },
    { key: "cash", header: "Cash taken", align: "right", sort: (r) => r.cashPaise, csv: (r) => (r.cashPaise / 100).toFixed(2), cell: (r) => <span className="tabular-nums">{formatPaise(r.cashPaise)}</span> },
    { key: "other", header: "UPI & card", align: "right", sort: (r) => r.otherPaise, csv: (r) => (r.otherPaise / 100).toFixed(2), cell: (r) => <span className="tabular-nums">{formatPaise(r.otherPaise)}</span> },
    { key: "expected", header: "Cash expected", align: "right", defaultHidden: true, csv: (r) => ((r.expectedCashPaise ?? 0) / 100).toFixed(2), cell: (r) => (r.expectedCashPaise === null ? "—" : formatPaise(r.expectedCashPaise)) },
    { key: "counted", header: "Counted", align: "right", csv: (r) => ((r.countedCashPaise ?? 0) / 100).toFixed(2), cell: (r) => (r.countedCashPaise === null ? "—" : <span className="tabular-nums">{formatPaise(r.countedCashPaise)}</span>) },
    { key: "difference", header: "Difference", align: "right", sort: (r) => r.differencePaise ?? 0, csv: (r) => ((r.differencePaise ?? 0) / 100).toFixed(2), cell: (r) => <Difference paise={r.differencePaise} /> },
    { key: "note", header: "Note", defaultHidden: true, csv: (r) => r.note ?? "", cell: (r) => <span className="text-sm">{r.note ?? "—"}</span> },
    { key: "actions", header: "Actions", hideable: false, cell: (r) => <span onClick={(e) => e.stopPropagation()}><Link href={`/app/m/pos/shifts/${r.id}`} className={icon} title="View" aria-label={`View ${r.number}`}><Eye /></Link></span> },
  ]
  const counterButton = <Link href="/app/m/pos" className={cn(buttonVariants(), "h-10 rounded-xl px-4 font-semibold")}><Store /> Open counter</Link>
  return (
    <DataList<Row>
      id="pos-shifts"
      path="/pos/shifts"
      header={{ title: "Shifts", description: "Each person's time at a counter: what they sold and whether the cash in the drawer matched at close.", primary: counterButton, more: [{ label: "Counter Bills", href: "/app/m/pos/sales" }, { label: "POS reports", href: "/app/m/pos/reports" }] }}
      columns={columns}
      rowHref={(r) => `/app/m/pos/shifts/${r.id}`}
      searchPlaceholder="Search shift, counter, cashier or note"
      presets={[
        { key: "all", label: "All", params: {}, countKey: "all" },
        { key: "open", label: "Open", params: { view: "open" }, countKey: "open" },
        { key: "closed", label: "Closed", params: { view: "closed" }, countKey: "closed" },
        { key: "short", label: "Short", params: { view: "short" }, countKey: "short" },
        { key: "over", label: "Over", params: { view: "over" }, countKey: "over" },
      ]}
      tabs
      top={(res) => {
        const s = (res.sums ?? {}) as Record<string, number>
        const c = (res.counts ?? {}) as Record<string, number>
        return <SummaryCards items={[
          { label: "Sales in shifts", value: formatPaise(s.sales ?? 0), hint: `${s.bills ?? 0} bills · ${c.all ?? 0} shifts`, color: "blue", icon: TrendingUp },
          { label: "Cash taken", value: formatPaise(s.cash ?? 0), hint: "Net of cash refunds", color: "emerald", icon: Banknote },
          { label: "UPI & card", value: formatPaise(s.other ?? 0), hint: "Into the bank account", color: "violet", icon: Smartphone },
          { label: "Open now", value: c.open ?? 0, hint: "Shifts not closed yet", color: "amber", icon: Clock },
          { label: "Short / over", value: `${formatPaise(s.short ?? 0, true)} / ${formatPaise(s.over ?? 0, true)}`, hint: `${c.short ?? 0} short · ${c.over ?? 0} over`, color: "rose", icon: AlertTriangle },
        ]} />
      }}
      filters={[
        periodFilter(me?.tenant?.fyStartMonth ?? 4),
        { key: "counterId", label: "Counter", options: (meta.data?.counters ?? []).map((c) => ({ value: c.id, label: c.name })) },
      ]}
      exportName="pos-shifts"
      emptyState={<EmptyState icon={Clock} title="No shifts yet" description="A shift starts when someone opens a counter with the cash in the drawer." action={counterButton} />}
    />
  )
}
