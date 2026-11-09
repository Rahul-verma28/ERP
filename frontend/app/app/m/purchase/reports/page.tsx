"use client"

import * as React from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { Spinner } from "@/components/common"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { qty } from "@/lib/inventory"
import { cn } from "@/lib/utils"
import { todayInIndia } from "@contracts/validation"

// Purchase reports: what you owe by age, the purchase register, the input tax credit register,
// and order lines still to come. Each table downloads as CSV.

type Tab = "payables" | "register" | "itc" | "pending"
const TABS: [Tab, string][] = [["payables", "Payables"], ["register", "Purchase register"], ["itc", "ITC register"], ["pending", "Pending orders"]]

function csv(name: string, head: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`
  const blob = new Blob([[head, ...rows].map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `${name}.csv`
  a.click()
}
const rupees = (p: number) => (p / 100).toFixed(2)
const monthStart = () => `${todayInIndia().slice(0, 8)}01`

function Table({ head, rows, right = [] }: { head: string[]; rows: React.ReactNode[][]; right?: number[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr>{head.map((h, i) => <th key={h} className={cn("py-2 pr-3", right.includes(i) && "text-right")}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className={cn("py-2 pr-3", right.includes(j) && "text-right tabular-nums")}>{c}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={head.length} className="py-6 text-center text-muted-foreground">Nothing here</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

interface Ageing { contactId: string; name: string; bills: number; notDuePaise: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; totalPaise: number }
interface RegRow { id: string; kind: string; number: string; date: string; supplierRef: string | null; supplierDate: string | null; supplier: string; gstin: string | null; reverseCharge: boolean; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number }
interface ItcRow { id: string; kind: string; number: string; supplierRef: string | null; supplierDate: string; supplier: string; gstin: string | null; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; reverseCharge: boolean; unpaid180: boolean; claimBy: string }
interface PendingRow { id: string; orderId: string; number: string; date: string; expected: string | null; late: boolean; supplier: string; description: string; unit: string; ordered: number; received: number; pending: number; pendingPaise: number }

function Payables() {
  const r = useApi<{ data: Ageing[]; totals: Omit<Ageing, "contactId" | "name" | "bills"> }>("/purchases/payables").data
  if (!r) return <Spinner />
  const cols = ["notDuePaise", "d1_30", "d31_60", "d61_90", "d90plus", "totalPaise"] as const
  const head = ["Supplier", "Bills", "Not due", "1–30 days", "31–60", "61–90", "Over 90", "Total"]
  return (
    <>
      <button className="justify-self-end text-sm text-primary hover:underline" onClick={() => csv("payables", head, r.data.map((a) => [a.name, a.bills, ...cols.map((c) => rupees(a[c]))]))}>Download CSV</button>
      <Table head={head} right={[1, 2, 3, 4, 5, 6, 7]} rows={[
        ...r.data.map((a) => [<Link key="n" href={`/app/m/purchase/suppliers/${a.contactId}`} className="font-medium hover:underline">{a.name}</Link>, a.bills, ...cols.map((c) => (a[c] ? formatPaise(a[c]) : "—"))]),
        ...(r.data.length ? [[<b key="t">Total</b>, "", ...cols.map((c) => <b key={c}>{formatPaise(r.totals[c])}</b>)]] : []),
      ]} />
    </>
  )
}

function Register({ from, to }: { from: string; to: string }) {
  const r = useApi<{ data: RegRow[]; totals: { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number } }>(`/purchases/register?from=${from}&to=${to}`).data
  if (!r) return <Spinner />
  const head = ["Date", "Number", "Supplier", "GSTIN", "Supplier bill", "Taxable", "CGST", "SGST", "IGST", "Total"]
  return (
    <>
      <button className="justify-self-end text-sm text-primary hover:underline" onClick={() => csv(`purchase-register-${from}-${to}`, [...head, "Reverse charge"], r.data.map((d) => [d.date.slice(0, 10), d.number, d.supplier, d.gstin, d.supplierRef, rupees(d.taxablePaise), rupees(d.cgstPaise), rupees(d.sgstPaise), rupees(d.igstPaise), rupees(d.totalPaise), d.reverseCharge ? "Y" : "N"]))}>Download CSV</button>
      <Table head={head} right={[5, 6, 7, 8, 9]} rows={[
        ...r.data.map((d) => [formatDate(d.date), <Link key="n" href={`/app/m/purchase/${d.id}`} className="font-mono hover:underline">{d.number}{d.kind === "purchase_return" ? " (return)" : ""}</Link>, d.supplier, <span key="g" className="font-mono text-xs">{d.gstin ?? "—"}</span>, d.supplierRef ?? "—", formatPaise(d.taxablePaise), formatPaise(d.cgstPaise), formatPaise(d.sgstPaise), formatPaise(d.igstPaise), formatPaise(d.totalPaise)]),
        ...(r.data.length ? [[<b key="t">Total</b>, "", "", "", "", <b key="a">{formatPaise(r.totals.taxablePaise)}</b>, <b key="b">{formatPaise(r.totals.cgstPaise)}</b>, <b key="c">{formatPaise(r.totals.sgstPaise)}</b>, <b key="d">{formatPaise(r.totals.igstPaise)}</b>, <b key="e">{formatPaise(r.totals.totalPaise)}</b>]] : []),
      ]} />
    </>
  )
}

function Itc({ from, to }: { from: string; to: string }) {
  const r = useApi<{ eligible: boolean; reason: string | null; data: ItcRow[]; totals: { cgstPaise: number; sgstPaise: number; igstPaise: number; reverseChargePaise: number; at180Paise: number } }>(`/purchases/itc?from=${from}&to=${to}`).data
  if (!r) return <Spinner />
  const head = ["Supplier GSTIN", "Supplier", "Bill no.", "Bill date", "Taxable", "CGST", "SGST", "IGST", "Notes"]
  const note = (d: ItcRow) => [d.reverseCharge && "Reverse charge: pay in cash first", d.unpaid180 && "Unpaid over 180 days: reverse credit", d.kind === "purchase_return" ? "Reduces credit" : `Claim by ${formatDate(d.claimBy)}`].filter(Boolean).join(" · ")
  return (
    <>
      {!r.eligible && <p className="rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{r.reason}</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        {[["CGST", r.totals.cgstPaise], ["SGST", r.totals.sgstPaise], ["IGST", r.totals.igstPaise], ["Reverse charge (Sec 9(3))", r.totals.reverseChargePaise]].map(([l, v]) => (
          <Card key={l as string}><CardContent><p className="text-xs text-muted-foreground">{l}</p><p className="text-lg font-semibold tabular-nums">{formatPaise(v as number)}</p></CardContent></Card>
        ))}
      </div>
      {r.totals.at180Paise > 0 && <p className="text-sm text-destructive">Credit of {formatPaise(r.totals.at180Paise)} is on bills unpaid for over 180 days. Rule 37: reverse it until you pay.</p>}
      <p className="text-xs text-muted-foreground">Match these with GSTR-2B before you claim. Credit counts only on bills the supplier has filed (Section 16(2)(aa)).</p>
      <button className="justify-self-end text-sm text-primary hover:underline" onClick={() => csv(`itc-${from}-${to}`, head, r.data.map((d) => [d.gstin, d.supplier, d.supplierRef, d.supplierDate.slice(0, 10), rupees(d.taxablePaise), rupees(d.cgstPaise), rupees(d.sgstPaise), rupees(d.igstPaise), note(d)]))}>Download CSV</button>
      <Table head={head} right={[4, 5, 6, 7]} rows={r.data.map((d) => [<span key="g" className="font-mono text-xs">{d.gstin ?? "—"}</span>, d.supplier, <Link key="n" href={`/app/m/purchase/${d.id}`} className="hover:underline">{d.supplierRef ?? d.number}{d.kind === "purchase_return" ? " (return)" : ""}</Link>, formatDate(d.supplierDate), formatPaise(d.taxablePaise), formatPaise(d.cgstPaise), formatPaise(d.sgstPaise), formatPaise(d.igstPaise), <span key="x" className={cn("text-xs", d.unpaid180 ? "text-destructive" : "text-muted-foreground")}>{note(d)}</span>])} />
    </>
  )
}

function Pending() {
  const r = useApi<{ data: PendingRow[] }>("/purchases/pending").data
  if (!r) return <Spinner />
  const head = ["Order", "Date", "Expected", "Supplier", "Item", "Ordered", "Received", "Pending", "Value"]
  return (
    <>
      <button className="justify-self-end text-sm text-primary hover:underline" onClick={() => csv("pending-orders", head, r.data.map((d) => [d.number, d.date.slice(0, 10), d.expected?.slice(0, 10) ?? "", d.supplier, d.description, d.ordered, d.received, d.pending, rupees(d.pendingPaise)]))}>Download CSV</button>
      <Table head={head} right={[5, 6, 7, 8]} rows={r.data.map((d) => [<Link key="n" href={`/app/m/purchase/${d.orderId}`} className="font-mono hover:underline">{d.number}</Link>, formatDate(d.date), d.expected ? <span key="e" className={d.late ? "font-medium text-destructive" : ""}>{formatDate(d.expected)}</span> : "—", d.supplier, d.description, `${qty(d.ordered)} ${d.unit}`, qty(d.received), <b key="p">{qty(d.pending)}</b>, formatPaise(d.pendingPaise)])} />
    </>
  )
}

export default function PurchaseReportsPage() {
  const { can } = useAuth()
  const [tab, setTab] = React.useState<Tab>("payables")
  const [from, setFrom] = React.useState(monthStart())
  const [to, setTo] = React.useState(todayInIndia())
  if (!can("inventory.supplier_bill.view")) return <PageHeader title="Purchase reports" description="You don't have access to this. Ask your admin." />
  return (
    <>
      <PageHeader title="Purchase reports" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("rounded-full border px-3 py-1.5 text-sm", tab === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{l}</button>
        ))}
        {(tab === "register" || tab === "itc") && (
          <span className="ml-auto flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            From <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
            To <Input type="date" value={to} min={from} max={todayInIndia()} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
          </span>
        )}
      </div>
      <Card><CardContent className="grid gap-3">
        {tab === "payables" && <Payables />}
        {tab === "register" && <Register from={from} to={to} />}
        {tab === "itc" && <Itc from={from} to={to} />}
        {tab === "pending" && <Pending />}
      </CardContent></Card>
    </>
  )
}
