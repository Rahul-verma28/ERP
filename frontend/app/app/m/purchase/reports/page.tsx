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
import { qty } from "@/lib/inventory"
import { cn } from "@/lib/utils"
import { todayInIndia } from "@contracts/validation"

// Purchase reports, each on the shared table: what you owe by age, the purchase register, the input
// tax credit register, and order lines still to come (only for businesses that use purchase orders).

interface Ageing { id: string; contactId: string; name: string; bills: number; notDuePaise: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; totalPaise: number }
interface RegRow { id: string; kind: string; number: string; date: string; supplierRef: string | null; supplierDate: string | null; supplier: string; gstin: string | null; reverseCharge: boolean; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number }
interface ItcRow { id: string; kind: string; number: string; supplierRef: string | null; supplierDate: string; supplier: string; gstin: string | null; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; reverseCharge: boolean; unpaid180: boolean; claimBy: string }
interface PendingRow { id: string; orderId: string; number: string; date: string; expected: string | null; late: boolean; supplier: string; description: string; unit: string; ordered: number; received: number; pending: number; pendingPaise: number }

const monthStart = () => `${todayInIndia().slice(0, 8)}01`
const money = (p: number) => <span className="tabular-nums">{p ? formatPaise(p) : "—"}</span>
const total = (label: string, p: unknown) => <span className="text-sm text-muted-foreground">{label} <strong className="text-foreground tabular-nums">{formatPaise(Number(p ?? 0))}</strong></span>

/** A report the API returns whole: searched and paged here, its totals kept for the summary */
function report<T>(url: (params: Record<string, string>) => string, match: (row: T, q: string) => boolean, shape: (row: T) => T = (r) => r): ListLoader<T> {
  return async ({ params, limit, cursor }) => {
    const r = await api.get<{ data: T[] } & Record<string, unknown>>(url(params))
    const q = (params.q ?? "").toLowerCase()
    const all = r.data.map(shape).filter((row) => !q || match(row, q))
    const start = Number(cursor ?? 0)
    return { ...r, data: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, total: all.length }
  }
}
const range = (p: Record<string, string>) => `from=${p.from ?? monthStart()}&to=${p.to ?? todayInIndia()}`
const doc = (id: string, number: string, extra = "") => <Link href={`/app/m/purchase/${id}`} className="inline-flex rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{number}{extra}</Link>

function Payables() {
  return (
    <DataList<Ageing>
      id="report-payables"
      load={report<Ageing>(() => "/purchases/payables", (r, q) => r.name.toLowerCase().includes(q), (r) => ({ ...r, id: r.contactId }))}
      header={{ title: "Payables", description: "What you owe each supplier, by how late it is." }}
      summary={(r) => total("Total owed", (r.totals as { totalPaise?: number } | undefined)?.totalPaise)}
      columns={[
        { key: "name", header: "Supplier", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
        { key: "bills", header: "Invoices", align: "right", sort: (r) => r.bills, csv: (r) => r.bills, cell: (r) => r.bills },
        { key: "notDue", header: "Not due", align: "right", csv: (r) => r.notDuePaise / 100, cell: (r) => money(r.notDuePaise) },
        { key: "d1", header: "1–30 days", align: "right", csv: (r) => r.d1_30 / 100, cell: (r) => money(r.d1_30) },
        { key: "d31", header: "31–60", align: "right", csv: (r) => r.d31_60 / 100, cell: (r) => money(r.d31_60) },
        { key: "d61", header: "61–90", align: "right", csv: (r) => r.d61_90 / 100, cell: (r) => money(r.d61_90) },
        { key: "d90", header: "Over 90", align: "right", csv: (r) => r.d90plus / 100, cell: (r) => <span className={r.d90plus ? "font-medium text-destructive" : ""}>{money(r.d90plus)}</span> },
        { key: "total", header: "Total", align: "right", sort: (r) => r.totalPaise, csv: (r) => r.totalPaise / 100, cell: (r) => <span className="font-semibold">{money(r.totalPaise)}</span> },
      ]}
      searchPlaceholder="Search supplier"
      rowHref={(r) => `/app/m/purchase/suppliers/${r.contactId}`}
      exportName="payables"
      emptyState={<EmptyState icon={FileBarChart} title="You owe nothing" description="Posted invoices that are not fully paid show here." />}
    />
  )
}

function Register() {
  const { me } = useAuth()
  return (
    <DataList<RegRow>
      id="report-register"
      load={report<RegRow>((p) => `/purchases/register?${range(p)}`, (r, q) => `${r.number} ${r.supplier} ${r.supplierRef ?? ""} ${r.gstin ?? ""}`.toLowerCase().includes(q))}
      header={{ title: "Purchase Register", description: "Every posted invoice and completed return in the period." }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
      defaultFilters={{ period: "this_month" }}
      summary={(r) => total("Total", (r.totals as { totalPaise?: number } | undefined)?.totalPaise)}
      columns={[
        { key: "date", header: "Date", hideable: false, sort: (r) => r.date, csv: (r) => r.date.slice(0, 10), cell: (r) => formatDate(r.date) },
        { key: "number", header: "Number", csv: (r) => r.number, cell: (r) => doc(r.id, r.number, r.kind === "purchase_return" ? " · return" : "") },
        { key: "supplier", header: "Supplier", sort: (r) => r.supplier, csv: (r) => r.supplier, cell: (r) => <span><span className="font-medium">{r.supplier}</span>{r.gstin && <span className="block font-mono text-xs text-muted-foreground">{r.gstin}</span>}</span> },
        { key: "ref", header: "Supplier invoice", csv: (r) => r.supplierRef ?? "", cell: (r) => r.supplierRef ?? "—" },
        { key: "taxable", header: "Taxable", align: "right", csv: (r) => r.taxablePaise / 100, cell: (r) => money(r.taxablePaise) },
        { key: "cgst", header: "CGST", align: "right", csv: (r) => r.cgstPaise / 100, cell: (r) => money(r.cgstPaise) },
        { key: "sgst", header: "SGST", align: "right", csv: (r) => r.sgstPaise / 100, cell: (r) => money(r.sgstPaise) },
        { key: "igst", header: "IGST", align: "right", csv: (r) => r.igstPaise / 100, cell: (r) => money(r.igstPaise) },
        { key: "total", header: "Total", align: "right", sort: (r) => r.totalPaise, csv: (r) => r.totalPaise / 100, cell: (r) => <span className="font-semibold">{money(r.totalPaise)}</span> },
      ]}
      searchPlaceholder="Search number, supplier or GSTIN"
      rowHref={(r) => `/app/m/purchase/${r.id}`}
      exportName="purchase-register"
      emptyState={<EmptyState icon={FileBarChart} title="Nothing in this period" />}
    />
  )
}

function Itc() {
  const { me } = useAuth()
  return (
    <DataList<ItcRow>
      id="report-itc"
      load={report<ItcRow>((p) => `/purchases/itc?${range(p)}`, (r, q) => `${r.supplier} ${r.supplierRef ?? ""} ${r.gstin ?? ""}`.toLowerCase().includes(q))}
      header={{ title: "ITC Register", description: "GST you can claim back. Match it with GSTR-2B before you claim: credit counts only on invoices the supplier has filed." }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
      defaultFilters={{ period: "this_month" }}
      summary={(r) => {
        const t = (r.totals ?? {}) as { cgstPaise?: number; sgstPaise?: number; igstPaise?: number; at180Paise?: number }
        return <span className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">{r.eligible === false && <span className="text-amber-700 dark:text-amber-300">{String(r.reason ?? "")}</span>}<span>CGST <strong className="text-foreground">{formatPaise(t.cgstPaise ?? 0)}</strong></span><span>SGST <strong className="text-foreground">{formatPaise(t.sgstPaise ?? 0)}</strong></span><span>IGST <strong className="text-foreground">{formatPaise(t.igstPaise ?? 0)}</strong></span>{!!t.at180Paise && <span className="text-destructive">{formatPaise(t.at180Paise)} unpaid over 180 days</span>}</span>
      }}
      columns={[
        { key: "gstin", header: "Supplier GSTIN", hideable: false, csv: (r) => r.gstin ?? "", cell: (r) => <span className="font-mono text-xs">{r.gstin ?? "—"}</span> },
        { key: "supplier", header: "Supplier", sort: (r) => r.supplier, csv: (r) => r.supplier, cell: (r) => <span className="font-medium">{r.supplier}</span> },
        { key: "ref", header: "Invoice no.", csv: (r) => r.supplierRef ?? "", cell: (r) => doc(r.id, r.supplierRef ?? r.number) },
        { key: "date", header: "Invoice date", sort: (r) => r.supplierDate, csv: (r) => r.supplierDate.slice(0, 10), cell: (r) => formatDate(r.supplierDate) },
        { key: "taxable", header: "Taxable", align: "right", csv: (r) => r.taxablePaise / 100, cell: (r) => money(r.taxablePaise) },
        { key: "cgst", header: "CGST", align: "right", csv: (r) => r.cgstPaise / 100, cell: (r) => money(r.cgstPaise) },
        { key: "sgst", header: "SGST", align: "right", csv: (r) => r.sgstPaise / 100, cell: (r) => money(r.sgstPaise) },
        { key: "igst", header: "IGST", align: "right", csv: (r) => r.igstPaise / 100, cell: (r) => money(r.igstPaise) },
        {
          key: "note", header: "Note", csv: (r) => [r.reverseCharge && "Reverse charge", r.unpaid180 && "Unpaid over 180 days"].filter(Boolean).join("; "),
          cell: (r) => <span className="flex flex-wrap gap-1">{r.reverseCharge && <Badge variant="outline">Reverse charge</Badge>}{r.unpaid180 && <Badge variant="outline" className="text-destructive">Unpaid 180+ days</Badge>}{r.kind === "purchase_return" ? <Badge variant="outline">Reduces credit</Badge> : <span className="text-xs text-muted-foreground">Claim by {formatDate(r.claimBy)}</span>}</span>,
        },
      ]}
      searchPlaceholder="Search supplier, invoice or GSTIN"
      rowHref={(r) => `/app/m/purchase/${r.id}`}
      exportName="itc-register"
      emptyState={<EmptyState icon={FileBarChart} title="No GST to claim in this period" />}
    />
  )
}

function Pending() {
  return (
    <DataList<PendingRow>
      id="report-pending"
      load={report<PendingRow>(() => "/purchases/pending", (r, q) => `${r.number} ${r.supplier} ${r.description}`.toLowerCase().includes(q))}
      header={{ title: "Pending Orders", description: "Ordered but not yet received." }}
      columns={[
        { key: "order", header: "Order", hideable: false, csv: (r) => r.number, cell: (r) => doc(r.orderId, r.number) },
        { key: "supplier", header: "Supplier", sort: (r) => r.supplier, csv: (r) => r.supplier, cell: (r) => <span className="font-medium">{r.supplier}</span> },
        { key: "item", header: "Item", csv: (r) => r.description, cell: (r) => r.description },
        { key: "expected", header: "Expected", csv: (r) => r.expected?.slice(0, 10) ?? "", cell: (r) => (r.expected ? <span className={cn(r.late && "font-medium text-destructive")}>{formatDate(r.expected)}{r.late && " · late"}</span> : "—") },
        { key: "pending", header: "Pending", align: "right", sort: (r) => r.pending, csv: (r) => r.pending, cell: (r) => `${qty(r.pending)} ${r.unit}` },
        { key: "value", header: "Value", align: "right", sort: (r) => r.pendingPaise, csv: (r) => r.pendingPaise / 100, cell: (r) => money(r.pendingPaise) },
      ]}
      searchPlaceholder="Search order, supplier or item"
      rowHref={(r) => `/app/m/purchase/${r.orderId}`}
      exportName="pending-orders"
      emptyState={<EmptyState icon={FileBarChart} title="Nothing pending" />}
    />
  )
}

export default function PurchaseReportsPage() {
  const { can, me } = useAuth()
  const tabs = [["payables", "Payables"], ["register", "Purchase Register"], ["itc", "ITC Register"], ...(me?.tenant?.purchaseOrders ? [["pending", "Pending Orders"]] : [])] as [string, string][]
  const [tab, setTab] = React.useState("payables")
  if (!can("inventory.supplier_bill.view")) return <PageHeader title="Purchase reports" description="You don't have access to this. Ask your admin." />
  return (
    <div className="grid gap-4">
      <div className="flex w-fit flex-wrap gap-1 rounded-xl border p-1 text-sm" role="tablist" aria-label="Reports">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", tab === k && "bg-primary text-primary-foreground")}>{l}</button>)}
      </div>
      {tab === "payables" && <Payables />}
      {tab === "register" && <Register />}
      {tab === "itc" && <Itc />}
      {tab === "pending" && <Pending />}
    </div>
  )
}
