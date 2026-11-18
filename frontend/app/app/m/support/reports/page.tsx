"use client"

import * as React from "react"
import { AlarmClock, CheckCircle2, FileBarChart, Inbox, Star, Timer } from "lucide-react"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { DataList, periodFilter } from "@/components/data-list"
import { SummaryCards } from "@/components/summary-cards"
import { DOT } from "@/components/tasks/forms"
import { ist, range, wholeReport } from "@/components/reports/kit"
import { useAuth } from "@/lib/auth"
import { duration } from "@/lib/support"
import { cn } from "@/lib/utils"

// Customer Service report: tickets in a period by category, person, channel, customer or day, with
// how fast the first reply and the fix came, how many met the SLA, and the customers' rating.

interface Row { id: string; label: string; color?: string; total: number; open: number; resolved: number; overdue: number; avgFirstMin: number | null; avgResolveMin: number | null; slaMetPct: number | null; csat: number | null; rated: number }
const BY = [["category", "By Category"], ["agent", "By Person"], ["channel", "By Channel"], ["customer", "By Customer"], ["day", "By Day"]] as const
const HEAD: Record<string, string> = { category: "Category", agent: "Handled by", channel: "Came in by", customer: "Customer", day: "Day" }
const pct = (v: number | null) => (v === null ? <span className="text-muted-foreground">—</span> : <span className={cn("tabular-nums", v < 70 ? "text-destructive" : v < 90 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>{v}%</span>)

function Report() {
  const { can, me } = useAuth()
  const [by, setBy] = React.useState<(typeof BY)[number][0]>("category")
  if (!can("support.ticket.view")) return <PageHeader title="Customer service report" description="You don't have access to customer service. Ask your admin." />
  return (
    <DataList<Row>
      key={by}
      id="support-report"
      load={wholeReport<Row>((p) => `/support/report?by=${by}&${range(p)}`, (r, q) => r.label.toLowerCase().includes(q))}
      header={{ title: "Customer Service Report", description: "How many requests came in, how fast you answered and fixed them, and how happy customers were.", more: [{ label: "Tickets", href: "/app/m/support" }] }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
      defaultFilters={{ period: "this_month" }}
      top={(r) => {
        const s = (r.sums ?? {}) as Record<string, number | null>
        return (
          <div className="grid gap-4">
            <SummaryCards items={[
              { label: "Tickets", value: s.total ?? 0, hint: `${s.open ?? 0} still open`, color: "blue", icon: Inbox },
              { label: "Resolved", value: s.resolved ?? 0, hint: s.total ? `${Math.round(((s.resolved ?? 0) / s.total) * 100)}% of them` : "—", color: "emerald", icon: CheckCircle2 },
              { label: "First reply", value: duration(s.avgFirstMin), hint: "Average time to answer", color: "amber", icon: Timer },
              { label: "Fixed in", value: duration(s.avgResolveMin), hint: s.slaMetPct !== null && s.slaMetPct !== undefined ? `${s.slaMetPct}% within SLA` : "Average time to resolve", color: "violet", icon: AlarmClock },
              { label: "Rating", value: s.csat ? `${s.csat} / 5` : "—", hint: s.rated ? `${s.rated} customers rated` : "No ratings yet", color: "rose", icon: Star },
            ]} />
            <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border p-1 text-sm" role="tablist" aria-label="Group by">
              {BY.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={by === k} onClick={() => setBy(k)} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", by === k && "bg-primary text-primary-foreground")}>{l}</button>)}
            </div>
          </div>
        )
      }}
      columns={[
        { key: "label", header: HEAD[by], hideable: false, sort: (r) => r.label, csv: (r) => r.label, cell: (r) => <span className="flex items-center gap-2 font-medium">{r.color && <span className={cn("size-2.5 shrink-0 rounded-full", DOT[r.color] ?? DOT.slate)} />}{by === "day" ? ist(r.label) : r.label}</span> },
        { key: "total", header: "Tickets", align: "right", sort: (r) => r.total, csv: (r) => r.total, cell: (r) => <span className="font-semibold tabular-nums">{r.total}</span> },
        { key: "open", header: "Open", align: "right", csv: (r) => r.open, cell: (r) => r.open || "—" },
        { key: "resolved", header: "Resolved", align: "right", csv: (r) => r.resolved, cell: (r) => r.resolved || "—" },
        { key: "overdue", header: "Late now", align: "right", sort: (r) => r.overdue, csv: (r) => r.overdue, cell: (r) => <span className={cn("tabular-nums", r.overdue ? "font-medium text-destructive" : "text-muted-foreground")}>{r.overdue || "—"}</span> },
        { key: "first", header: "First reply", align: "right", sort: (r) => r.avgFirstMin ?? 1e9, csv: (r) => r.avgFirstMin ?? "", cell: (r) => duration(r.avgFirstMin) },
        { key: "fix", header: "Fixed in", align: "right", sort: (r) => r.avgResolveMin ?? 1e9, csv: (r) => r.avgResolveMin ?? "", cell: (r) => duration(r.avgResolveMin) },
        { key: "sla", header: "Within SLA", align: "right", sort: (r) => r.slaMetPct ?? -1, csv: (r) => r.slaMetPct ?? "", cell: (r) => pct(r.slaMetPct) },
        { key: "csat", header: "Rating", align: "right", sort: (r) => r.csat ?? 0, csv: (r) => r.csat ?? "", cell: (r) => (r.csat ? <span className="inline-flex items-center gap-1 tabular-nums"><Star className="size-3.5 fill-amber-400 text-amber-400" />{r.csat}<span className="text-xs text-muted-foreground">({r.rated})</span></span> : <span className="text-muted-foreground">—</span>) },
      ]}
      searchPlaceholder={`Search ${HEAD[by].toLowerCase()}`}
      rowHref={(r) => (by === "agent" && r.id !== "none" ? `/app/m/support?view=all&assigneeId=${r.id}` : by === "customer" && !r.id.startsWith("g:") ? `/app/m/sales/customers/${r.id}` : "/app/m/support?view=all")}
      exportName={`support-by-${by}`}
      emptyState={<EmptyState icon={FileBarChart} title="No tickets in this period" />}
    />
  )
}

export default function SupportReportPage() {
  return <React.Suspense><Report /></React.Suspense>
}
