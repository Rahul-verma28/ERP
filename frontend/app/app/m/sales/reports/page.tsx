"use client"

import * as React from "react"
import Link from "next/link"
import { FileBarChart } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { DataList, periodFilter, type ListLoader } from "@/components/data-list"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"
import { todayInIndia } from "@contracts/validation"

// Sales reports, the same five a shop owner and their CA ask for, each on the shared table:
// who owes and how late, the sales register, sales by customer and by item, and money collected.

interface Ageing { id: string; contactId: string | null; name: string; bills: number; notDuePaise: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; totalPaise: number }
interface RegRow { id: string; kind: string; number: string; date: string; customer: string; gstin: string | null; placeOfSupply: string | null; against: string | null; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number }
interface ByRow { id: string; key: string; label: string; invoices?: number; creditNotes?: number; unit?: string; quantity?: number; taxablePaise: number; taxPaise: number; totalPaise: number }
interface CashRow { id: string; date: string; cash: number; upi: number; card: number; bank: number; cheque: number; other: number; totalPaise: number }

const monthStart = () => `${todayInIndia().slice(0, 8)}01`
const money = (p: number) => <span className="tabular-nums">{p ? formatPaise(p) : "—"}</span>
const total = (label: string, p: number) => <span className="text-sm text-muted-foreground">{label} <strong className="text-foreground tabular-nums">{formatPaise(p)}</strong></span>
const range = (p: Record<string, string>) => `from=${p.from ?? monthStart()}&to=${p.to ?? todayInIndia()}`
const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0)

/** A report the API returns whole: searched and paged here, with the full rows kept for totals */
function report<T>(url: (params: Record<string, string>) => string, match: (row: T, q: string) => boolean, shape: (row: T, i: number) => T = (r) => r, key: "data" | "rows" = "data"): ListLoader<T> {
  return async ({ params, limit, cursor }) => {
    const r = await api.get<Record<string, unknown>>(url(params))
    const q = (params.q ?? "").toLowerCase()
    const all = ((r[key] as T[]) ?? []).map(shape).filter((row) => !q || match(row, q))
    const start = Number(cursor ?? 0)
    return { ...r, all, data: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, total: all.length }
  }
}
const docHref = (r: { id: string; kind: string }) => (r.kind === "credit_note" ? `/app/m/billing/credit-notes/${r.id}` : r.kind === "debit_note" ? `/app/m/billing/debit-notes/${r.id}` : `/app/m/billing/${r.id}`)
const KIND: Record<string, string> = { invoice: "Invoice", credit_note: "Return", debit_note: "Debit note" }

function Receivables() {
  return (
    <DataList<Ageing>
      id="report-receivables"
      load={report<Ageing>(() => "/reports/receivables", (r, q) => r.name.toLowerCase().includes(q))}
      header={{ title: "Receivables", description: "What each customer owes, by how many days it is late after the due date." }}
      summary={(r) => {
        const t = (r.totals ?? {}) as { totalPaise?: number; d90plus?: number }
        return <span className="flex flex-wrap gap-x-4">{total("Total to collect", t.totalPaise ?? 0)}{!!t.d90plus && <span className="text-sm text-destructive">{formatPaise(t.d90plus)} over 90 days</span>}</span>
      }}
      columns={[
        { key: "name", header: "Customer", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
        { key: "bills", header: "Bills", align: "right", sort: (r) => r.bills, csv: (r) => r.bills, cell: (r) => r.bills },
        { key: "notDue", header: "Not due", align: "right", csv: (r) => r.notDuePaise / 100, cell: (r) => money(r.notDuePaise) },
        { key: "d1", header: "1–30 days", align: "right", csv: (r) => r.d1_30 / 100, cell: (r) => money(r.d1_30) },
        { key: "d31", header: "31–60", align: "right", csv: (r) => r.d31_60 / 100, cell: (r) => <span className={r.d31_60 ? "text-orange-600 dark:text-orange-300" : ""}>{money(r.d31_60)}</span> },
        { key: "d61", header: "61–90", align: "right", csv: (r) => r.d61_90 / 100, cell: (r) => <span className={r.d61_90 ? "text-orange-600 dark:text-orange-300" : ""}>{money(r.d61_90)}</span> },
        { key: "d90", header: "Over 90", align: "right", csv: (r) => r.d90plus / 100, cell: (r) => <span className={r.d90plus ? "font-medium text-destructive" : ""}>{money(r.d90plus)}</span> },
        { key: "total", header: "Total", align: "right", sort: (r) => r.totalPaise, csv: (r) => r.totalPaise / 100, cell: (r) => <span className="font-semibold">{money(r.totalPaise)}</span> },
      ]}
      searchPlaceholder="Search customer"
      rowHref={(r) => (r.contactId ? `/app/m/sales/customers/${r.contactId}` : "/app/m/billing")}
      exportName="receivables"
      emptyState={<EmptyState icon={FileBarChart} title="Nobody owes you money" description="Posted invoices that are not fully paid show here." />}
    />
  )
}

function Register() {
  const { me } = useAuth()
  return (
    <DataList<RegRow>
      id="report-sales-register"
      load={report<RegRow>((p) => `/reports/sales-register?${range(p)}`, (r, q) => `${r.number} ${r.customer} ${r.gstin ?? ""}`.toLowerCase().includes(q))}
      header={{ title: "Sales Register", description: "Every posted invoice, return and debit note in the period, with GST. Returns count minus." }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
      defaultFilters={{ period: "this_month" }}
      summary={(r) => {
        const t = (r.totals ?? {}) as { taxablePaise?: number; cgstPaise?: number; sgstPaise?: number; igstPaise?: number; totalPaise?: number }
        return <span className="flex flex-wrap gap-x-4 text-sm text-muted-foreground"><span>Taxable <strong className="text-foreground">{formatPaise(t.taxablePaise ?? 0)}</strong></span><span>GST <strong className="text-foreground">{formatPaise((t.cgstPaise ?? 0) + (t.sgstPaise ?? 0) + (t.igstPaise ?? 0))}</strong></span><span>Total <strong className="text-foreground">{formatPaise(t.totalPaise ?? 0)}</strong></span></span>
      }}
      columns={[
        { key: "date", header: "Date", hideable: false, sort: (r) => r.date, csv: (r) => r.date.slice(0, 10), cell: (r) => formatDate(r.date) },
        { key: "number", header: "Number", csv: (r) => r.number, cell: (r) => <Link href={docHref(r)} onClick={(e) => e.stopPropagation()} className="inline-flex rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary hover:underline">{r.number}</Link> },
        { key: "kind", header: "Type", csv: (r) => KIND[r.kind] ?? r.kind, cell: (r) => <Badge variant="outline" className={cn(r.kind === "credit_note" && "text-destructive")}>{KIND[r.kind] ?? r.kind}</Badge> },
        { key: "customer", header: "Customer", sort: (r) => r.customer, csv: (r) => r.customer, cell: (r) => <span><span className="font-medium">{r.customer}</span>{r.gstin && <span className="block font-mono text-xs text-muted-foreground">{r.gstin}</span>}</span> },
        { key: "against", header: "Against", defaultHidden: true, csv: (r) => r.against ?? "", cell: (r) => r.against ?? "—" },
        { key: "taxable", header: "Taxable", align: "right", csv: (r) => r.taxablePaise / 100, cell: (r) => money(r.taxablePaise) },
        { key: "cgst", header: "CGST", align: "right", csv: (r) => r.cgstPaise / 100, cell: (r) => money(r.cgstPaise) },
        { key: "sgst", header: "SGST", align: "right", csv: (r) => r.sgstPaise / 100, cell: (r) => money(r.sgstPaise) },
        { key: "igst", header: "IGST", align: "right", csv: (r) => r.igstPaise / 100, cell: (r) => money(r.igstPaise) },
        { key: "total", header: "Total", align: "right", sort: (r) => r.totalPaise, csv: (r) => r.totalPaise / 100, cell: (r) => <span className="font-semibold">{money(r.totalPaise)}</span> },
      ]}
      searchPlaceholder="Search number, customer or GSTIN"
      rowHref={docHref}
      exportName="sales-register"
      emptyState={<EmptyState icon={FileBarChart} title="Nothing in this period" />}
    />
  )
}

function SalesBy({ by }: { by: "customer" | "item" }) {
  const { me } = useAuth()
  const item = by === "item"
  return (
    <DataList<ByRow>
      id={`report-sales-by-${by}`}
      load={report<ByRow>((p) => `/reports/sales?by=${by}&${range(p)}`, (r, q) => r.label.toLowerCase().includes(q), (r, i) => ({ ...r, id: `${r.key}-${i}` }), "rows")}
      header={{ title: item ? "Sales by Item" : "Sales by Customer", description: item ? "What sold most in the period, after returns." : "Who bought most in the period, after returns." }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
      defaultFilters={{ period: "this_month" }}
      summary={(r) => total("Total sales", sum((r.all as ByRow[]) ?? [], (x) => x.totalPaise))}
      columns={[
        { key: "label", header: item ? "Item" : "Customer", hideable: false, sort: (r) => r.label, csv: (r) => r.label, cell: (r) => <span className="font-medium">{r.label}</span> },
        ...(item
          ? [{ key: "qty", header: "Quantity sold", align: "right" as const, sort: (r: ByRow) => r.quantity ?? 0, csv: (r: ByRow) => r.quantity ?? 0, cell: (r: ByRow) => <span className="tabular-nums">{r.quantity} {r.unit}</span> }]
          : [{ key: "bills", header: "Invoices", align: "right" as const, sort: (r: ByRow) => r.invoices ?? 0, csv: (r: ByRow) => r.invoices ?? 0, cell: (r: ByRow) => r.invoices }, { key: "returns", header: "Returns", align: "right" as const, defaultHidden: true, csv: (r: ByRow) => r.creditNotes ?? 0, cell: (r: ByRow) => r.creditNotes || "—" }]),
        { key: "taxable", header: "Taxable", align: "right", sort: (r) => r.taxablePaise, csv: (r) => r.taxablePaise / 100, cell: (r) => money(r.taxablePaise) },
        { key: "tax", header: "GST", align: "right", csv: (r) => r.taxPaise / 100, cell: (r) => money(r.taxPaise) },
        { key: "total", header: "Total", align: "right", sort: (r) => r.totalPaise, csv: (r) => r.totalPaise / 100, cell: (r) => <span className="font-semibold">{money(r.totalPaise)}</span> },
      ]}
      searchPlaceholder={item ? "Search item" : "Search customer"}
      exportName={item ? "sales-by-item" : "sales-by-customer"}
      emptyState={<EmptyState icon={FileBarChart} title="No sales in this period" />}
    />
  )
}

function Collection() {
  const { me } = useAuth()
  return (
    <DataList<CashRow>
      id="report-collection"
      load={report<CashRow>((p) => `/reports/collection?${range(p)}`, (r, q) => r.date.includes(q), (r) => ({ ...r, id: r.date }), "rows")}
      header={{ title: "Money Collected", description: "Payments received each day, by how they were paid. Match it with your cash box and bank." }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
      defaultFilters={{ period: "this_month" }}
      summary={(r) => total("Collected", sum((r.all as CashRow[]) ?? [], (x) => x.totalPaise))}
      columns={[
        { key: "date", header: "Date", hideable: false, sort: (r) => r.date, csv: (r) => r.date, cell: (r) => formatDate(r.date) },
        { key: "cash", header: "Cash", align: "right", csv: (r) => r.cash / 100, cell: (r) => money(r.cash) },
        { key: "upi", header: "UPI", align: "right", csv: (r) => r.upi / 100, cell: (r) => money(r.upi) },
        { key: "card", header: "Card", align: "right", csv: (r) => r.card / 100, cell: (r) => money(r.card) },
        { key: "bank", header: "Bank", align: "right", csv: (r) => r.bank / 100, cell: (r) => money(r.bank) },
        { key: "cheque", header: "Cheque", align: "right", csv: (r) => r.cheque / 100, cell: (r) => money(r.cheque) },
        { key: "other", header: "Other", align: "right", defaultHidden: true, csv: (r) => r.other / 100, cell: (r) => money(r.other) },
        { key: "total", header: "Total", align: "right", sort: (r) => r.totalPaise, csv: (r) => r.totalPaise / 100, cell: (r) => <span className="font-semibold">{money(r.totalPaise)}</span> },
      ]}
      searchPlaceholder="Search date (2026-11)"
      exportName="money-collected"
      emptyState={<EmptyState icon={FileBarChart} title="Nothing collected in this period" />}
    />
  )
}

const TABS = [["receivables", "Receivables"], ["register", "Sales Register"], ["customer", "By Customer"], ["item", "By Item"], ["collection", "Money Collected"]] as const

export default function SalesReportsPage() {
  const { can } = useAuth()
  const [tab, setTab] = React.useState<(typeof TABS)[number][0]>("receivables")
  if (!can("reports.report.view")) return <PageHeader title="Sales reports" description="You don't have access to reports. Ask your admin." />
  return (
    <div className="grid gap-4">
      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border p-1 text-sm" role="tablist" aria-label="Reports">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", tab === k && "bg-primary text-primary-foreground")}>{l}</button>)}
      </div>
      {tab === "receivables" && <Receivables />}
      {tab === "register" && <Register />}
      {tab === "customer" && <SalesBy by="customer" />}
      {tab === "item" && <SalesBy by="item" />}
      {tab === "collection" && <Collection />}
    </div>
  )
}
