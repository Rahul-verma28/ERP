"use client"

import * as React from "react"
import { ArrowDownToLine, ArrowUpFromLine, Boxes, FileBarChart, IndianRupee, PackageX, TrendingDown, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/common"
import { DataList, periodFilter } from "@/components/data-list"
import { SummaryCards } from "@/components/summary-cards"
import { Money, qtyText, range, wholeReport } from "@/components/reports/kit"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"

// Two reports that need both sales and stock: what each item earned over its cost, and how stock
// moved in a period (opening, in, out, closing) with how fast it sells.

interface ProfitRow { id: string; name: string; sku: string | null; unit: string; type: string; category: string | null; quantity: number; invoices: number; salesPaise: number; costPaise: number; profitPaise: number; marginPct: number }
interface MoveRow { id: string; name: string; sku: string | null; unit: string; category: string | null; openQty: number; openPaise: number; inQty: number; inPaise: number; outQty: number; outPaise: number; closeQty: number; closePaise: number; soldQty: number; ins: { kind: string; qty: number }[]; outs: { kind: string; qty: number }[]; turnover: number | null }

const item = (r: { name: string; sku: string | null; category: string | null }) => <span><span className="font-medium">{r.name}</span><span className="block text-xs text-muted-foreground">{[r.sku, r.category].filter(Boolean).join(" · ") || "—"}</span></span>

export function ProfitByItem() {
  const { me } = useAuth()
  return (
    <DataList<ProfitRow>
      id="report-profit-by-item"
      load={wholeReport<ProfitRow>((p) => `/reports/profit?${range(p)}`, (r, q) => `${r.name} ${r.sku ?? ""} ${r.category ?? ""}`.toLowerCase().includes(q))}
      header={{ title: "Profit by Item", description: "What each item sold for (before GST, after returns) against what the stock cost you. Services have no stock cost." }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
      defaultFilters={{ period: "this_month" }}
      top={(r) => {
        const s = (r.sums ?? {}) as Record<string, number>
        return <SummaryCards items={[
          { label: "Sales", value: formatPaise(s.salesPaise ?? 0), hint: "Before GST, after returns", color: "blue", icon: IndianRupee },
          { label: "Cost of goods", value: formatPaise(s.costPaise ?? 0), hint: "Stock value that left", color: "amber", icon: Boxes },
          { label: "Gross profit", value: formatPaise(s.profitPaise ?? 0), hint: `${s.marginPct ?? 0}% margin`, color: (s.profitPaise ?? 0) < 0 ? "rose" : "emerald", icon: (s.profitPaise ?? 0) < 0 ? TrendingDown : TrendingUp },
          { label: "Sold at a loss", value: s.losing ?? 0, hint: "Items below cost", color: "rose", icon: TrendingDown },
        ]} />
      }}
      columns={[
        { key: "name", header: "Item", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: item },
        { key: "type", header: "Type", defaultHidden: true, csv: (r) => r.type, cell: (r) => <Badge variant="outline" className="capitalize">{r.type}</Badge> },
        { key: "qty", header: "Sold", align: "right", sort: (r) => r.quantity, csv: (r) => r.quantity, cell: (r) => <span className="tabular-nums">{qtyText(r.quantity)} <span className="text-xs text-muted-foreground">{r.unit}</span></span> },
        { key: "invoices", header: "Invoices", align: "right", defaultHidden: true, csv: (r) => r.invoices, cell: (r) => r.invoices || "—" },
        { key: "sales", header: "Sales", align: "right", sort: (r) => r.salesPaise, csv: (r) => r.salesPaise / 100, cell: (r) => <Money p={r.salesPaise} /> },
        { key: "cost", header: "Cost", align: "right", sort: (r) => r.costPaise, csv: (r) => r.costPaise / 100, cell: (r) => <Money p={r.costPaise} /> },
        { key: "profit", header: "Profit", align: "right", sort: (r) => r.profitPaise, csv: (r) => r.profitPaise / 100, cell: (r) => <Money p={r.profitPaise} strong tone="auto" /> },
        { key: "margin", header: "Margin", align: "right", sort: (r) => r.marginPct, csv: (r) => r.marginPct, cell: (r) => <span className={cn("tabular-nums", r.marginPct < 0 ? "text-destructive" : r.marginPct < 10 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>{r.marginPct}%</span> },
      ]}
      searchPlaceholder="Search item, SKU or category"
      rowHref={(r) => `/app/m/catalog/${r.id}`}
      exportName="profit-by-item"
      emptyState={<EmptyState icon={FileBarChart} title="No item sales in this period" />}
    />
  )
}

const breakdown = (list: { kind: string; qty: number }[]) => list.map((x) => `${x.kind} ${qtyText(x.qty)}`).join(" · ")

export function StockMovement() {
  const { me } = useAuth()
  return (
    <DataList<MoveRow>
      id="report-stock-movement"
      load={wholeReport<MoveRow>((p) => `/reports/stock-movement?${range(p)}${p.locationId ? `&locationId=${p.locationId}` : ""}`, (r, q) => `${r.name} ${r.sku ?? ""} ${r.category ?? ""}`.toLowerCase().includes(q))}
      header={{ title: "Stock Movement", description: "For each item: what you had at the start, what came in and went out, and what is left. Turnover shows how many times the stock sold over." }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
      defaultFilters={{ period: "this_month" }}
      top={(r) => {
        const s = (r.sums ?? {}) as Record<string, number>
        return <SummaryCards items={[
          { label: "Opening stock", value: formatPaise(s.openPaise ?? 0), hint: "At the start", color: "blue", icon: Boxes },
          { label: "Came in", value: formatPaise(s.inPaise ?? 0), hint: "Bought, returned, moved in", color: "emerald", icon: ArrowDownToLine },
          { label: "Went out", value: formatPaise(s.outPaise ?? 0), hint: "Sold, returned, moved out", color: "amber", icon: ArrowUpFromLine },
          { label: "Closing stock", value: formatPaise(s.closePaise ?? 0), hint: "At the end", color: "violet", icon: Boxes },
          { label: "Not moving", value: s.notMoving ?? 0, hint: "In stock, nothing went out", color: "rose", icon: PackageX },
        ]} />
      }}
      columns={[
        { key: "name", header: "Item", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: item },
        { key: "open", header: "Opening", align: "right", sort: (r) => r.openQty, csv: (r) => r.openQty, cell: (r) => <span className="tabular-nums">{qtyText(r.openQty)}</span> },
        { key: "in", header: "In", align: "right", sort: (r) => r.inQty, csv: (r) => r.inQty, cell: (r) => <span className="tabular-nums text-emerald-600 dark:text-emerald-400" title={breakdown(r.ins)}>{r.inQty ? `+${qtyText(r.inQty)}` : "—"}</span> },
        { key: "out", header: "Out", align: "right", sort: (r) => r.outQty, csv: (r) => r.outQty, cell: (r) => <span className="tabular-nums text-amber-600 dark:text-amber-400" title={breakdown(r.outs)}>{r.outQty ? `−${qtyText(r.outQty)}` : "—"}</span> },
        { key: "close", header: "Closing", align: "right", sort: (r) => r.closeQty, csv: (r) => r.closeQty, cell: (r) => <span className="font-semibold tabular-nums">{qtyText(r.closeQty)} <span className="text-xs font-normal text-muted-foreground">{r.unit}</span></span> },
        { key: "detail", header: "How it moved", defaultHidden: true, csv: (r) => [breakdown(r.ins), breakdown(r.outs)].filter(Boolean).join(" | "), cell: (r) => <span className="text-xs text-muted-foreground">{[breakdown(r.ins), breakdown(r.outs)].filter(Boolean).join(" · ") || "—"}</span> },
        { key: "inValue", header: "In value", align: "right", defaultHidden: true, csv: (r) => r.inPaise / 100, cell: (r) => <Money p={r.inPaise} /> },
        { key: "outValue", header: "Out value", align: "right", defaultHidden: true, csv: (r) => r.outPaise / 100, cell: (r) => <Money p={r.outPaise} /> },
        { key: "closeValue", header: "Closing value", align: "right", sort: (r) => r.closePaise, csv: (r) => r.closePaise / 100, cell: (r) => <Money p={r.closePaise} strong /> },
        { key: "turnover", header: "Turnover", align: "right", sort: (r) => r.turnover ?? -1, csv: (r) => r.turnover ?? "", cell: (r) => r.turnover === null ? <span className="text-muted-foreground">—</span> : <span className={cn("tabular-nums", r.turnover === 0 && "text-destructive")}>{r.turnover}×</span> },
      ]}
      searchPlaceholder="Search item, SKU or category"
      rowHref={(r) => `/app/m/catalog/${r.id}?tab=stock`}
      exportName="stock-movement"
      emptyState={<EmptyState icon={Boxes} title="No stock moved in this period" />}
    />
  )
}
