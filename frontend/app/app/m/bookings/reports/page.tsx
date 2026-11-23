"use client"

import * as React from "react"
import { CalendarCheck, CalendarX, FileBarChart, IndianRupee, Receipt, UserX } from "lucide-react"
import { EmptyState } from "@/components/common"
import { DataList, periodFilter } from "@/components/data-list"
import { SummaryCards } from "@/components/summary-cards"
import { DOT } from "@/components/tasks/forms"
import { Money, hours, ist, range, wholeReport } from "@/components/reports/kit"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"
import { NoAccessPage } from "@/components/page-states"

// Bookings report: appointments by service, person, where they came from, day or customer, with
// what they earned, how much of it is invoiced and how often people did not turn up.

interface Row { id: string; label: string; color?: string; total: number; completed: number; noShow: number; cancelled: number; upcoming: number; minutes: number; earnedPaise: number; invoicedPaise: number; customers: number; noShowPct: number; avgPaise: number }
const BY = [["service", "By Service"], ["staff", "By Staff"], ["source", "By Source"], ["customer", "By Customer"], ["day", "By Day"]] as const
const HEAD: Record<string, string> = { service: "Service", staff: "Staff", source: "Booked through", customer: "Customer", day: "Day" }
const num = (v: number, tone?: string) => <span className={cn("tabular-nums", !v && "text-muted-foreground", v > 0 && tone)}>{v || "—"}</span>

function Report() {
  const { can, me } = useAuth()
  const [by, setBy] = React.useState<(typeof BY)[number][0]>("service")
  if (!can("bookings.appointment.view")) return <NoAccessPage title="Bookings report" permission="bookings.appointment.view" />
  return (
    <DataList<Row>
      key={by}
      id="bookings-report"
      load={wholeReport<Row>((p) => `/reports/bookings?by=${by}&${range(p)}`, (r, q) => r.label.toLowerCase().includes(q))}
      header={{ title: "Bookings Report", description: "What each service, person and channel brought in, how much is invoiced, and who did not turn up." }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
      defaultFilters={{ period: "this_month" }}
      top={(r) => {
        const s = (r.sums ?? {}) as Record<string, number>
        return (
          <div className="grid gap-4">
            <SummaryCards items={[
              { label: "Appointments", value: s.total ?? 0, hint: `${s.cancelled ?? 0} cancelled`, color: "blue", icon: CalendarCheck },
              { label: "Completed", value: s.completed ?? 0, hint: s.total ? `${Math.round(((s.completed ?? 0) / s.total) * 100)}% of booked` : "—", color: "emerald", icon: CalendarCheck },
              { label: "Earned", value: formatPaise(s.earnedPaise ?? 0), hint: "From completed visits", color: "violet", icon: IndianRupee },
              { label: "Not invoiced", value: formatPaise((s.earnedPaise ?? 0) - (s.invoicedPaise ?? 0)), hint: "Completed, no invoice yet", color: "amber", icon: Receipt },
              { label: "No-shows", value: `${s.noShowPct ?? 0}%`, hint: `${s.noShow ?? 0} did not come`, color: "rose", icon: UserX },
            ]} />
            <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border p-1 text-sm" role="tablist" aria-label="Group by">
              {BY.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={by === k} onClick={() => setBy(k)} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", by === k && "bg-primary text-primary-foreground")}>{l}</button>)}
            </div>
          </div>
        )
      }}
      columns={[
        { key: "label", header: HEAD[by], hideable: false, sort: (r) => r.label, csv: (r) => r.label, cell: (r) => <span className="flex items-center gap-2 font-medium">{r.color && <span className={cn("size-2.5 shrink-0 rounded-full", DOT[r.color] ?? DOT.blue)} />}{by === "day" ? ist(r.label) : r.label}</span> },
        { key: "total", header: "Booked", align: "right", sort: (r) => r.total, csv: (r) => r.total, cell: (r) => num(r.total) },
        { key: "completed", header: "Completed", align: "right", sort: (r) => r.completed, csv: (r) => r.completed, cell: (r) => num(r.completed, "text-emerald-600 dark:text-emerald-400") },
        { key: "upcoming", header: "Still to come", align: "right", csv: (r) => r.upcoming, cell: (r) => num(r.upcoming) },
        { key: "noShow", header: "No-show", align: "right", sort: (r) => r.noShow, csv: (r) => r.noShow, cell: (r) => <span className="tabular-nums">{r.noShow ? <span className="text-destructive">{r.noShow} <span className="text-xs">({r.noShowPct}%)</span></span> : <span className="text-muted-foreground">—</span>}</span> },
        { key: "cancelled", header: "Cancelled", align: "right", csv: (r) => r.cancelled, cell: (r) => num(r.cancelled) },
        { key: "customers", header: "Customers", align: "right", defaultHidden: by === "customer", csv: (r) => r.customers, cell: (r) => num(r.customers) },
        { key: "time", header: "Time spent", align: "right", defaultHidden: true, sort: (r) => r.minutes, csv: (r) => Math.round(r.minutes / 6) / 10, cell: (r) => hours(r.minutes) },
        { key: "avg", header: "Average", align: "right", defaultHidden: true, csv: (r) => r.avgPaise / 100, cell: (r) => <Money p={r.avgPaise} /> },
        { key: "invoiced", header: "Invoiced", align: "right", csv: (r) => r.invoicedPaise / 100, cell: (r) => <Money p={r.invoicedPaise} /> },
        { key: "earned", header: "Earned", align: "right", sort: (r) => r.earnedPaise, csv: (r) => r.earnedPaise / 100, cell: (r) => <Money p={r.earnedPaise} strong /> },
      ]}
      searchPlaceholder={`Search ${HEAD[by].toLowerCase()}`}
      rowHref={(r) => (by === "day" ? `/app/m/bookings?mode=day&date=${r.id}` : by === "customer" && !r.id.startsWith("guest:") ? `/app/m/sales/customers/${r.id}` : "/app/m/bookings/list")}
      exportName={`bookings-by-${by}`}
      emptyState={<EmptyState icon={by === "day" ? CalendarX : FileBarChart} title="No appointments in this period" />}
    />
  )
}

export default function BookingsReportPage() {
  return <React.Suspense><Report /></React.Suspense>
}
