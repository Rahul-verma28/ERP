"use client"

import * as React from "react"
import { Banknote, Package, Receipt, ShoppingBag, Undo2 } from "lucide-react"
import { EmptyState } from "@/components/common"
import { DataList, periodFilter } from "@/components/data-list"
import { SummaryCards } from "@/components/summary-cards"
import { ist, qtyText, range, wholeReport } from "@/components/reports/kit"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { TENDER_LABEL } from "@/lib/pos"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"
import { NoAccessPage } from "@/components/page-states"

// POS report: counter sales in a period by day, hour, item, category, cashier, counter or how
// they were paid, with the bills, quantity, sales before and after GST and the average bill.

interface Row { id: string; key: string; label: string; bills: number; qty: number; salesPaise: number; taxablePaise: number; averagePaise: number }
const BY = [["day", "By Day"], ["hour", "By Hour"], ["item", "By Item"], ["category", "By Category"], ["cashier", "By Cashier"], ["counter", "By Counter"], ["method", "By Payment"]] as const
const HEAD: Record<string, string> = { day: "Day", hour: "Hour", item: "Item", category: "Category", cashier: "Cashier", counter: "Counter", method: "Paid by" }

export default function PosReportPage() {
  const { can, me } = useAuth()
  const [by, setBy] = React.useState<(typeof BY)[number][0]>("day")
  const meta = useApi<{ counters: { id: string; name: string }[] }>(can("billing.pos.view") ? "/pos/sales?limit=1" : null)
  if (!can("billing.pos.view")) return <NoAccessPage title="POS report" permission="billing.pos.view" />
  const itemly = by === "item" || by === "category"
  return (
    <DataList<Row>
      key={by}
      id={`pos-report-${by}`}
      load={wholeReport<Row>((p) => `/pos/report?by=${by}&${range(p)}${p.counterId ? `&counterId=${p.counterId}` : ""}`, (r, q) => r.label.toLowerCase().includes(q), "rows")}
      header={{ title: "POS Report", description: "What sold at the counters, when, by whom and how it was paid.", more: [{ label: "Counter Bills", href: "/app/m/pos/sales" }, { label: "Shifts", href: "/app/m/pos/shifts" }] }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period"), { key: "counterId", label: "Counter", options: (meta.data?.counters ?? []).map((c) => ({ value: c.id, label: c.name })) }]}
      defaultFilters={{ period: "this_month" }}
      top={(r) => {
        const s = (r.totals ?? {}) as Record<string, number>
        const methods = (r.methods ?? []) as { method: string; amountPaise: number }[]
        const cash = methods.find((m) => m.method === "cash")?.amountPaise ?? 0
        return (
          <div className="grid gap-4">
            <SummaryCards items={[
              { label: "Counter sales", value: formatPaise(s.salesPaise ?? 0), hint: `${s.bills ?? 0} bills`, color: "blue", icon: ShoppingBag },
              { label: "Before GST", value: formatPaise(s.taxablePaise ?? 0), hint: `GST ${formatPaise((s.salesPaise ?? 0) - (s.taxablePaise ?? 0))}`, color: "violet", icon: Receipt },
              { label: "Average bill", value: formatPaise(s.averagePaise ?? 0), hint: `${qtyText(s.items ?? 0)} items sold`, color: "emerald", icon: Package },
              { label: "Taken in cash", value: formatPaise(cash), hint: methods.filter((m) => m.method !== "cash").map((m) => `${TENDER_LABEL[m.method] ?? m.method} ${formatPaise(m.amountPaise, true)}`).join(" · ") || "No other payments", color: "amber", icon: Banknote },
              { label: "Returns", value: formatPaise(s.returnsPaise ?? 0), hint: `${s.returns ?? 0} returns`, color: "rose", icon: Undo2 },
            ]} />
            <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border p-1 text-sm" role="tablist" aria-label="Group by">
              {BY.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={by === k} onClick={() => setBy(k)} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", by === k && "bg-primary text-primary-foreground")}>{l}</button>)}
            </div>
          </div>
        )
      }}
      columns={[
        { key: "label", header: HEAD[by], hideable: false, sort: (r) => r.key, csv: (r) => r.label, cell: (r) => <span className="font-medium">{by === "day" ? ist(r.label) : by === "method" ? TENDER_LABEL[r.label] ?? r.label : r.label}</span> },
        ...(itemly
          ? [{ key: "qty", header: "Quantity", align: "right" as const, sort: (r: Row) => r.qty, csv: (r: Row) => r.qty, cell: (r: Row) => <span className="tabular-nums">{qtyText(r.qty)}</span> }]
          : [{ key: "bills", header: by === "method" ? "Payments" : "Bills", align: "right" as const, sort: (r: Row) => (by === "method" ? r.qty : r.bills), csv: (r: Row) => (by === "method" ? r.qty : r.bills), cell: (r: Row) => <span className="tabular-nums">{by === "method" ? r.qty : r.bills}</span> }]),
        ...(by === "method" ? [] : [{ key: "taxable", header: "Before GST", align: "right" as const, sort: (r: Row) => r.taxablePaise, csv: (r: Row) => (r.taxablePaise / 100).toFixed(2), cell: (r: Row) => <span className="tabular-nums">{formatPaise(r.taxablePaise)}</span> }]),
        { key: "sales", header: by === "method" ? "Received" : "Sales", align: "right", sort: (r) => r.salesPaise, csv: (r) => (r.salesPaise / 100).toFixed(2), cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.salesPaise)}</span> },
        ...(itemly || by === "method" ? [] : [{ key: "avg", header: "Average bill", align: "right" as const, sort: (r: Row) => r.averagePaise, csv: (r: Row) => (r.averagePaise / 100).toFixed(2), cell: (r: Row) => <span className="tabular-nums">{formatPaise(r.averagePaise)}</span> }]),
      ]}
      exportName={`pos-report-${by}`}
      emptyState={<EmptyState icon={ShoppingBag} title="No counter sales in this period" description="Pick another period, or make a sale at the counter." />}
    />
  )
}
