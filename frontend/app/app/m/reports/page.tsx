"use client"

import * as React from "react"
import Link from "next/link"
import {
  BadgeIndianRupee, BarChart3, Boxes, BriefcaseBusiness, CalendarCheck, CalendarClock, ClipboardList, Clock, FileSpreadsheet, FileText, Hourglass,
  Landmark, ListChecks, PackageSearch, PiggyBank, Plane, Receipt, ScanBarcode, Scale, Search, ShoppingCart, Star, Timer, TrendingUp, Truck, Users, Wallet,
  type LucideIcon,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { NoAccessPage } from "@/components/page-states"

// Report Centre: every report in the app on one page, grouped by area, searchable, with the ones
// a person uses most starred to the top. Only reports the person's role can open are shown; each
// card opens the report on its module's own page.

interface Report { key: string; title: string; description: string; href: string; permission: string; icon: LucideIcon; words?: string }
interface Group { key: string; label: string; color: string; reports: Report[] }

const GROUPS: Group[] = [
  { key: "sales", label: "Sales", color: "blue", reports: [
    { key: "receivables", title: "Receivables", description: "Who owes you and how late, in age buckets.", href: "/app/m/sales/reports?tab=receivables", permission: "reports.report.view", icon: Wallet, words: "ageing outstanding dues debtors" },
    { key: "sales-register", title: "Sales Register", description: "Every invoice, return and debit note with GST.", href: "/app/m/sales/reports?tab=register", permission: "reports.report.view", icon: FileText, words: "invoices gst cgst sgst igst" },
    { key: "sales-customer", title: "Sales by Customer", description: "Who bought the most, after returns.", href: "/app/m/sales/reports?tab=customer", permission: "reports.report.view", icon: Users },
    { key: "sales-item", title: "Sales by Item", description: "What sold the most, quantity and value.", href: "/app/m/sales/reports?tab=item", permission: "reports.report.view", icon: Boxes, words: "product" },
    { key: "profit-item", title: "Profit by Item", description: "Sale value against stock cost, with margin.", href: "/app/m/sales/reports?tab=profit", permission: "reports.report.view", icon: TrendingUp, words: "margin gross profit cost" },
    { key: "collection", title: "Money Collected", description: "Payments received each day by cash, UPI, card or bank.", href: "/app/m/sales/reports?tab=collection", permission: "reports.report.view", icon: BadgeIndianRupee, words: "receipts cash upi" },
    { key: "sales-day", title: "Sales by Day & Month", description: "The day-by-day and month-by-month trend.", href: "/app/m/reports/summary?tab=day", permission: "reports.report.view", icon: BarChart3, words: "daily monthly trend" },
    { key: "sales-pending", title: "Pending Sales Orders", description: "Ordered by customers, not yet delivered.", href: "/app/m/reports/summary?tab=pending", permission: "reports.report.view", icon: Hourglass, words: "backorder" },
    { key: "gst-sheet", title: "GST Sheet (GSTR-1)", description: "B2B, B2C, notes and HSN summary to download for your CA.", href: "/app/m/reports/summary?tab=gst", permission: "reports.report.view", icon: FileSpreadsheet, words: "gstr1 hsn b2b b2c return filing" },
  ] },
  { key: "purchase", label: "Purchase", color: "amber", reports: [
    { key: "payables", title: "Payables", description: "What you owe each supplier and how late.", href: "/app/m/purchase/reports?tab=payables", permission: "inventory.supplier_bill.view", icon: Wallet, words: "creditors dues" },
    { key: "purchase-register", title: "Purchase Register", description: "Every purchase bill and return with GST.", href: "/app/m/purchase/reports?tab=register", permission: "inventory.supplier_bill.view", icon: FileText, words: "bills" },
    { key: "itc", title: "ITC Register", description: "GST you can claim back, bill by bill.", href: "/app/m/purchase/reports?tab=itc", permission: "inventory.supplier_bill.view", icon: Receipt, words: "input tax credit gstr2b" },
    { key: "purchase-pending", title: "Pending Purchase Orders", description: "Ordered from suppliers, not yet received.", href: "/app/m/purchase/reports?tab=pending", permission: "inventory.supplier_bill.view", icon: Truck },
  ] },
  { key: "inventory", label: "Inventory", color: "emerald", reports: [
    { key: "stock-movement", title: "Stock Movement", description: "Opening, in, out and closing per item, with turnover.", href: "/app/m/inventory/reports?tab=movement", permission: "inventory.stock.view", icon: Boxes, words: "stock summary inward outward closing" },
    { key: "stock-now", title: "Stock Summary", description: "What you have now, where, and its value.", href: "/app/m/inventory", permission: "inventory.stock.view", icon: PackageSearch, words: "valuation balance" },
    { key: "expiry", title: "Near Expiry", description: "Batches that expire soon or already have.", href: "/app/m/inventory/reports?tab=expiry", permission: "inventory.stock.view", icon: CalendarClock, words: "batch expired" },
    { key: "ageing", title: "Stock Ageing", description: "How long stock has been sitting.", href: "/app/m/inventory/reports?tab=ageing", permission: "inventory.stock.view", icon: Hourglass, words: "dead slow moving" },
    { key: "stock-date", title: "Stock on a Date", description: "How much you had on any past day.", href: "/app/m/inventory/reports?tab=date", permission: "inventory.stock.view", icon: CalendarCheck },
    { key: "serial", title: "Find Serial", description: "Where a serial or IMEI number is now.", href: "/app/m/inventory/reports?tab=serial", permission: "inventory.stock.view", icon: ScanBarcode, words: "imei" },
  ] },
  { key: "accounts", label: "Accounts & GST", color: "violet", reports: [
    { key: "pl", title: "Profit & Loss", description: "Income less expenses for any period.", href: "/app/m/finance/reports", permission: "finance.expense.view", icon: TrendingUp, words: "p&l pnl income statement" },
    { key: "bs", title: "Balance Sheet", description: "What the business owns and owes.", href: "/app/m/finance/accountant", permission: "finance.expense.view", icon: Scale, words: "assets liabilities" },
    { key: "tb", title: "Trial Balance", description: "Every ledger's balance for your CA.", href: "/app/m/finance/accountant?tab=tb", permission: "finance.expense.view", icon: Landmark, words: "ledger debit credit" },
    { key: "cash", title: "Cash Flow", description: "Where cash came from and went.", href: "/app/m/finance/reports?tab=cash", permission: "finance.expense.view", icon: PiggyBank },
    { key: "gst-summary", title: "GST Summary (GSTR-3B)", description: "GST collected, claimed and payable.", href: "/app/m/finance/reports?tab=gst", permission: "finance.expense.view", icon: Receipt, words: "gstr3b tax payable" },
    { key: "budget", title: "Budget vs Actual", description: "Spending against the budget per category.", href: "/app/m/finance/reports?tab=budget", permission: "finance.expense.view", icon: BarChart3 },
    { key: "daybook", title: "Day Book", description: "Every entry of a day, in order.", href: "/app/m/finance/reports?tab=day", permission: "finance.expense.view", icon: ClipboardList, words: "daily entries" },
    { key: "ledgers", title: "Ledgers", description: "Any account's entries and running balance.", href: "/app/m/finance/ledgers", permission: "finance.expense.view", icon: FileText, words: "account statement" },
  ] },
  { key: "hr", label: "HR & Payroll", color: "rose", reports: [
    { key: "attendance", title: "Attendance Summary", description: "Present, absent, leave, late and overtime per person.", href: "/app/m/hr/reports?tab=attendance", permission: "hr.attendance.view", icon: CalendarCheck, words: "muster" },
    { key: "muster", title: "Monthly Register", description: "The day-by-day attendance grid for the month.", href: "/app/m/hr/attendance/month", permission: "hr.attendance.view", icon: ClipboardList, words: "muster roll" },
    { key: "payroll", title: "Payroll Register", description: "Payslips with PF, ESI and PT split out.", href: "/app/m/hr/reports?tab=payroll", permission: "hr.payroll.view", icon: BadgeIndianRupee, words: "salary pf esi pt challan" },
    { key: "leave", title: "Leave Taken", description: "Leave per person and type, and what is waiting.", href: "/app/m/hr/reports?tab=leave", permission: "hr.leave.view", icon: Plane },
  ] },
  { key: "crm", label: "CRM", color: "cyan", reports: [
    { key: "crm", title: "Leads & Deals", description: "Leads by source and stage, deals won and lost.", href: "/app/m/crm/reports", permission: "crm.lead.view", icon: BriefcaseBusiness, words: "pipeline conversion funnel" },
  ] },
  { key: "work", label: "Tasks & Bookings", color: "slate", reports: [
    { key: "time", title: "Time & Tasks", description: "Hours by project and person, billable value, tasks on time.", href: "/app/m/tasks/reports", permission: "tasks.task.view", icon: Timer, words: "timesheet hours billable" },
    { key: "timesheet", title: "Timesheet", description: "Each person's week of logged time.", href: "/app/m/tasks/timesheet", permission: "tasks.task.view", icon: Clock },
    { key: "approvals", title: "Approvals", description: "Requests waiting, approved and rejected.", href: "/app/m/tasks/approvals", permission: "tasks.approval.view", icon: ListChecks },
    { key: "bookings", title: "Bookings Report", description: "By service, staff and source; earned and no-shows.", href: "/app/m/bookings/reports", permission: "bookings.appointment.view", icon: CalendarCheck, words: "appointments no show" },
  ] },
]

const TINT: Record<string, string> = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-300", amber: "bg-amber-500/10 text-amber-600 dark:text-amber-300", emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-300", rose: "bg-rose-500/10 text-rose-600 dark:text-rose-300", cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300", slate: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
}
const STORE = "reports:starred"
const EVENT = "reports:starred"
const subscribe = (cb: () => void) => { window.addEventListener("storage", cb); window.addEventListener(EVENT, cb); return () => { window.removeEventListener("storage", cb); window.removeEventListener(EVENT, cb) } }
const readRaw = () => { try { return localStorage.getItem(STORE) ?? "[]" } catch { return "[]" } }
const parse = (raw: string) => { try { return new Set<string>(JSON.parse(raw) as string[]) } catch { return new Set<string>() } }

function Card({ r, color, starred, onStar }: { r: Report; color: string; starred: boolean; onStar: () => void }) {
  const Icon = r.icon
  return (
    <div className="group relative flex gap-3 rounded-2xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", TINT[color])}><Icon className="size-5" /></span>
      <Link href={r.href} className="min-w-0 flex-1 after:absolute after:inset-0 after:content-['']">
        <span className="block font-semibold leading-tight">{r.title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{r.description}</span>
      </Link>
      <button type="button" onClick={onStar} aria-label={starred ? `Unstar ${r.title}` : `Star ${r.title}`} aria-pressed={starred}
        className={cn("relative z-10 -m-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted", starred ? "text-amber-500" : "opacity-60 group-hover:opacity-100")}>
        <Star className={cn("size-4", starred && "fill-current")} />
      </button>
    </div>
  )
}

export default function ReportCentrePage() {
  const { can } = useAuth()
  const [q, setQ] = React.useState("")
  // Stars live in this browser only; the server renders none, then the browser fills them in
  const raw = React.useSyncExternalStore(subscribe, readRaw, () => "[]")
  const stars = React.useMemo(() => parse(raw), [raw])
  const toggle = (key: string) => {
    const next = new Set(stars)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    try { localStorage.setItem(STORE, JSON.stringify([...next])) } catch { /* private mode: no stars */ }
    window.dispatchEvent(new Event(EVENT))
  }
  const term = q.trim().toLowerCase()
  const groups = GROUPS.map((g) => ({ ...g, reports: g.reports.filter((r) => can(r.permission) && (!term || `${r.title} ${r.description} ${r.words ?? ""} ${g.label}`.toLowerCase().includes(term))) })).filter((g) => g.reports.length)
  const all = groups.flatMap((g) => g.reports.map((r) => ({ r, color: g.color })))
  const starred = all.filter((x) => stars.has(x.r.key))
  const total = GROUPS.reduce((s, g) => s + g.reports.filter((r) => can(r.permission)).length, 0)

  if (!total) return <NoAccessPage title="Reports" permission="reports.report.view" what="any reports" />
  return (
    <div className="grid gap-6">
      <PageHeader title="Reports" description={`All ${total} reports in one place. Star the ones you use most; they stay on top.`} />
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reports, e.g. GST, profit, attendance" className="h-11 rounded-xl pl-9" aria-label="Search reports" />
      </div>
      {!groups.length && <EmptyState icon={Search} title="No report matches" description="Try another word, like sales, stock or salary." />}
      {starred.length > 0 && (
        <section className="grid gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase"><Star className="size-4 fill-amber-500 text-amber-500" /> Starred</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{starred.map(({ r, color }) => <Card key={r.key} r={r} color={color} starred onStar={() => toggle(r.key)} />)}</div>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.key} className="grid gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">{g.key === "purchase" ? <ShoppingCart className="size-4" /> : null}{g.label}<span className="font-normal normal-case">· {g.reports.length}</span></h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{g.reports.map((r) => <Card key={r.key} r={r} color={g.color} starred={stars.has(r.key)} onStar={() => toggle(r.key)} />)}</div>
        </section>
      ))}
    </div>
  )
}
