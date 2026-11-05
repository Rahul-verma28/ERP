"use client"

import * as React from "react"
import { toast } from "sonner"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { Spinner } from "@/components/common"
import { Field } from "@/components/form"
import { ModuleLocked } from "@/components/page-states"
import { todayInIndia } from "@contracts/validation"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { downloadCsv } from "@/lib/csv"
import { downloadApiFile } from "@/lib/download"
import { GST_STATES, formatDate, formatPaise } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"

// Standard reports: sales by day, month, customer and item, money collected, and the GST sheet.

interface Col<T> {
  header: string
  right?: boolean
  cell: (r: T) => React.ReactNode
  /** Plain value for Excel */
  csv: (r: T) => string | number
  /** Paise to add up in the total row */
  total?: (r: T) => number
}

function ReportTable<T>({ title, rows, cols, exportName }: { title?: string; rows: T[]; cols: Col<T>[]; exportName: string }) {
  const { can } = useAuth()
  const exportCsv = () => downloadCsv(`${exportName}.csv`, [cols.map((c) => c.header), ...rows.map((r) => cols.map((c) => c.csv(r)))])
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{title ?? `${rows.length} row${rows.length === 1 ? "" : "s"}`}</CardTitle>
        {can("reports.report.export") && rows.length > 0 && <Button variant="outline" size="sm" onClick={exportCsv}><Download /> Excel</Button>}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing in this period.</p> : (
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                {cols.map((c) => <th key={c.header} className={cn("py-2 pr-3 font-medium last:pr-0", c.right && "text-right")}>{c.header}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border/60">
                  {cols.map((c) => <td key={c.header} className={cn("py-2 pr-3 last:pr-0", c.right && "text-right tabular-nums")}>{c.cell(r)}</td>)}
                </tr>
              ))}
              {cols.some((c) => c.total) && (
                <tr className="font-semibold">
                  {cols.map((c, i) => <td key={c.header} className={cn("py-2 pr-3 last:pr-0", c.right && "text-right tabular-nums")}>{c.total ? formatPaise(rows.reduce((s, r) => s + c.total!(r), 0)) : i === 0 ? "Total" : ""}</td>)}
                </tr>
              )}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

const rupees = (p: number) => (p / 100).toFixed(2)
const money = <T,>(header: string, pick: (r: T) => number, total = true): Col<T> => ({ header, right: true, cell: (r) => formatPaise(pick(r)), csv: (r) => rupees(pick(r)), total: total ? pick : undefined })

interface SalesRow { key: string; label: string; invoices: number; creditNotes: number; taxablePaise: number; taxPaise: number; totalPaise: number }
interface ItemRow { key: string; label: string; unit: string; quantity: number; taxablePaise: number; taxPaise: number; totalPaise: number }
interface CollectionRow { date: string; cash: number; upi: number; card: number; bank: number; cheque: number; other: number; totalPaise: number }
interface GstAmounts { gstRateBp: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }
interface GstHead { number: string; date: string; buyerName: string | null; gstin: string | null; placeOfSupply: string | null }
interface GstReport {
  b2b: (GstHead & GstAmounts & { totalPaise: number })[]
  b2c: ({ placeOfSupply: string | null } & GstAmounts)[]
  creditNotes: (GstHead & GstAmounts & { invoiceNumber: string | null; noteType: string | null })[]
  hsn: ({ hsnSac: string | null; unit: string; quantity: number } & GstAmounts)[]
  totals: Omit<GstAmounts, "gstRateBp"> & { totalPaise: number; roundOffPaise: number; invoices: number; creditNotes: number }
}

const stateName = (code: string | null) => GST_STATES.find(([c]) => c === code)?.[1] ?? code ?? "—"
const taxCols = <T extends GstAmounts>(): Col<T>[] => [
  { header: "Rate", right: true, cell: (r) => `${r.gstRateBp / 100}%`, csv: (r) => r.gstRateBp / 100 },
  money<T>("Taxable", (r) => r.taxablePaise),
  money<T>("CGST", (r) => r.cgstPaise),
  money<T>("SGST", (r) => r.sgstPaise),
  money<T>("IGST", (r) => r.igstPaise),
]

function Loading({ error }: { error?: { message: string } | null }) {
  return error ? <p className="text-sm text-muted-foreground">{error.message}</p> : <div className="grid place-items-center py-16"><Spinner /></div>
}

function SalesReport({ by, query }: { by: "day" | "month" | "customer"; query: string }) {
  const { data, error } = useApi<{ rows: SalesRow[] }>(`/reports/sales?by=${by}&${query}`)
  if (!data) return <Loading error={error} />
  const first: Col<SalesRow> = by === "customer"
    ? { header: "Customer", cell: (r) => r.label, csv: (r) => r.label }
    : { header: by === "day" ? "Date" : "Month", cell: (r) => (by === "day" ? formatDate(r.key) : r.key), csv: (r) => r.key }
  return (
    <ReportTable
      rows={data.rows}
      exportName={`sales-by-${by}`}
      cols={[
        first,
        { header: "Invoices", right: true, cell: (r) => r.invoices, csv: (r) => r.invoices },
        { header: "Credit notes", right: true, cell: (r) => r.creditNotes, csv: (r) => r.creditNotes },
        money<SalesRow>("Taxable", (r) => r.taxablePaise),
        money<SalesRow>("GST", (r) => r.taxPaise),
        money<SalesRow>("Total", (r) => r.totalPaise),
      ]}
    />
  )
}

function ItemReport({ query }: { query: string }) {
  const { data, error } = useApi<{ rows: ItemRow[] }>(`/reports/sales?by=item&${query}`)
  if (!data) return <Loading error={error} />
  return (
    <ReportTable
      title={`${data.rows.length} item${data.rows.length === 1 ? "" : "s"}, before round-off`}
      rows={data.rows}
      exportName="sales-by-item"
      cols={[
        { header: "Item", cell: (r) => r.label, csv: (r) => r.label },
        { header: "Quantity", right: true, cell: (r) => `${r.quantity} ${r.unit}`, csv: (r) => r.quantity },
        money<ItemRow>("Taxable", (r) => r.taxablePaise),
        money<ItemRow>("GST", (r) => r.taxPaise),
        money<ItemRow>("Total", (r) => r.totalPaise),
      ]}
    />
  )
}

function CollectionReport({ query }: { query: string }) {
  const { data, error } = useApi<{ rows: CollectionRow[] }>(`/reports/collection?${query}`)
  if (!data) return <Loading error={error} />
  return (
    <ReportTable
      rows={data.rows}
      exportName="collection"
      cols={[
        { header: "Date", cell: (r) => formatDate(r.date), csv: (r) => r.date },
        money<CollectionRow>("Cash", (r) => r.cash),
        money<CollectionRow>("UPI", (r) => r.upi),
        money<CollectionRow>("Card", (r) => r.card),
        money<CollectionRow>("Bank", (r) => r.bank),
        money<CollectionRow>("Cheque", (r) => r.cheque),
        money<CollectionRow>("Other", (r) => r.other),
        money<CollectionRow>("Total", (r) => r.totalPaise),
      ]}
    />
  )
}

function GstSheet({ query }: { query: string }) {
  const { can } = useAuth()
  const { data, error } = useApi<GstReport>(`/reports/gst?${query}`)
  if (!data) return <Loading error={error} />
  const t = data.totals
  const figures = [["Invoices", t.invoices], ["Credit notes", t.creditNotes], ["Taxable", formatPaise(t.taxablePaise)], ["CGST", formatPaise(t.cgstPaise)], ["SGST", formatPaise(t.sgstPaise)], ["IGST", formatPaise(t.igstPaise)], ["Round off", formatPaise(t.roundOffPaise)], ["Total", formatPaise(t.totalPaise)]] as const
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-100 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        <p>This is a working sheet for your CA. AHEAD does not file GST; check it with your CA before filing.</p>
        {can("reports.report.export") && (
          <Button variant="outline" size="sm" onClick={() => downloadApiFile(`/reports/gst/download?${query}`, "gst-report.xlsx").catch((e) => toast.error(errorMessage(e)))}><Download /> Download Excel</Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {figures.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-muted p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <ReportTable title="B2B invoices" exportName="gst-b2b" rows={data.b2b} cols={[
        { header: "Invoice", cell: (r) => r.number, csv: (r) => r.number },
        { header: "Date", cell: (r) => formatDate(r.date), csv: (r) => r.date },
        { header: "Customer", cell: (r) => r.buyerName, csv: (r) => r.buyerName ?? "" },
        { header: "GSTIN", cell: (r) => <span className="font-mono text-xs">{r.gstin}</span>, csv: (r) => r.gstin ?? "" },
        { header: "Place of supply", cell: (r) => stateName(r.placeOfSupply), csv: (r) => r.placeOfSupply ?? "" },
        ...taxCols<GstReport["b2b"][number]>(),
      ]} />
      <ReportTable title="B2C summary" exportName="gst-b2c" rows={data.b2c} cols={[
        { header: "Place of supply", cell: (r) => stateName(r.placeOfSupply), csv: (r) => r.placeOfSupply ?? "" },
        ...taxCols<GstReport["b2c"][number]>(),
      ]} />
      <ReportTable title="Credit notes" exportName="gst-credit-notes" rows={data.creditNotes} cols={[
        { header: "Credit note", cell: (r) => r.number, csv: (r) => r.number },
        { header: "Date", cell: (r) => formatDate(r.date), csv: (r) => r.date },
        { header: "Invoice", cell: (r) => r.invoiceNumber, csv: (r) => r.invoiceNumber ?? "" },
        { header: "GSTIN", cell: (r) => <span className="font-mono text-xs">{r.gstin ?? "—"}</span>, csv: (r) => r.gstin ?? "" },
        ...taxCols<GstReport["creditNotes"][number]>(),
      ]} />
      <ReportTable title="HSN summary" exportName="gst-hsn" rows={data.hsn} cols={[
        { header: "HSN/SAC", cell: (r) => r.hsnSac ?? "Not set", csv: (r) => r.hsnSac ?? "" },
        { header: "Quantity", right: true, cell: (r) => `${r.quantity} ${r.unit}`, csv: (r) => r.quantity },
        ...taxCols<GstReport["hsn"][number]>(),
      ]} />
    </div>
  )
}

const TABS = [
  { key: "day", label: "Sales by day" },
  { key: "month", label: "By month" },
  { key: "customer", label: "By customer" },
  { key: "item", label: "By item" },
  { key: "collection", label: "Collection" },
  { key: "gst", label: "GST" },
] as const

export default function ReportsPage() {
  const { me, can } = useAuth()
  const today = todayInIndia()
  const [tab, setTab] = React.useState<(typeof TABS)[number]["key"]>("day")
  const [from, setFrom] = React.useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = React.useState(today)
  const query = `from=${from}&to=${to}`

  if (me?.modules?.reports?.status === "inactive") {
    return (
      <>
        <PageHeader title="Reports" />
        <div className="max-w-xl rounded-xl border bg-card"><ModuleLocked name="Reports" description="Sales, collection and GST reports." canUpgrade={can("tenant.billing.view")} /></div>
      </>
    )
  }
  if (!can("reports.report.view")) return <PageHeader title="Reports" description="You don't have access to reports. Ask your admin." />

  return (
    <>
      <PageHeader title="Reports" description="Credit notes are taken off sales on the day they are issued." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
      </div>
      <div className="mb-5 flex gap-5 overflow-x-auto border-b" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cn("-mb-px shrink-0 border-b-2 border-transparent px-1 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground", tab === t.key && "border-primary text-foreground")}>{t.label}</button>
        ))}
      </div>
      {(tab === "day" || tab === "month" || tab === "customer") && <SalesReport key={tab} by={tab} query={query} />}
      {tab === "item" && <ItemReport query={query} />}
      {tab === "collection" && <CollectionReport query={query} />}
      {tab === "gst" && <GstSheet query={query} />}
    </>
  )
}
