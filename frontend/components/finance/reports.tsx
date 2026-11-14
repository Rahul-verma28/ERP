"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BookOpen, ChevronLeft, ChevronRight, Printer, Scale } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/common"
import { DataList, periodFilter } from "@/components/data-list"
import { NativeSelect } from "@/components/form"
import { ErrorState, PageLoading } from "@/components/page-states"
import { Pill, Section, StatGrid } from "@/components/page-parts"
import { api } from "@/lib/api"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { GROUP_LABEL, GROUP_TONE, ledgerHref, type LedgerGroup } from "@/lib/finance"
import { cn } from "@/lib/utils"
import { todayInIndia } from "@contracts/validation"

// The finance statements, shared by Reports (for the owner) and Accountant (for the CA):
// profit & loss, cash flow, GST summary, budget, day book, balance sheet and trial balance.

interface PL {
  from: string; to: string
  sales: { invoicesPaise: number; debitNotesPaise: number; returnsPaise: number; netPaise: number }
  cost: { openingStockPaise: number; purchasesPaise: number; returnsPaise: number; otherPaise: number; closingStockPaise: number; netPaise: number }
  grossProfitPaise: number
  otherIncome: { rows: { key: string; name: string; amountPaise: number }[]; totalPaise: number }
  expenses: { rows: { key: string; name: string; amountPaise: number }[]; totalPaise: number }
  netProfitPaise: number
}
interface BSRow { key: string; name: string; section: string; amountPaise: number }
interface BS { date: string; fyStart: string; assets: BSRow[]; liabilities: BSRow[]; equity: BSRow[]; assetsPaise: number; liabilitiesPaise: number; equityPaise: number }
interface TBRow { id: string; key: string; code: string; name: string; group: LedgerGroup; section: string; debitPaise: number; creditPaise: number }
interface Tax { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }
interface GST {
  claimsItc: boolean; composition: boolean; registered: boolean
  counts: Record<string, number>
  output: { invoices: Tax; debitNotes: Tax; creditNotes: Tax }; outputTotal: Tax; rcm: Tax
  input: { bills: Tax; returns: Tax; expenses: Tax }; inputTotal: Tax
  netPaise: number; paidPaise: number; leftPaise: number
}
interface Budget { month: string; data: { id: string; name: string; budgetPaise: number | null; spentPaise: number }[]; budgetPaise: number; spentInBudgetPaise: number; spentPaise: number; over: number }
interface CF { openingPaise: number; inPaise: number; outPaise: number; closingPaise: number; byKind: { kind: string; label: string; inPaise: number; outPaise: number }[]; byMonth: { month: string; inPaise: number; outPaise: number; netPaise: number }[] }
interface DayRow { id: string; type: string; number: string | null; party: string | null; account: string | null; amountPaise: number; direction: "in" | "out"; cancelled: boolean; href: string | null }

const PERIODS = [["this_month", "This month"], ["last_month", "Last month"], ["this_fy", "This financial year"], ["last_30", "Last 30 days"], ["custom", "Pick dates"]] as const
type Period = (typeof PERIODS)[number][0]

const PrintButton = () => <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden"><Printer /> Print</Button>

/** Period picker shared by the statements: a preset, or two dates */
function usePeriod(fy: number, initial: Period = "this_month") {
  const [period, setPeriod] = React.useState<Period>(initial)
  const [custom, setCustom] = React.useState({ from: `${todayInIndia().slice(0, 8)}01`, to: todayInIndia() })
  const range = period === "custom" ? custom : (periodFilter(fy).toParams!(period) as { from: string; to: string })
  const picker = (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <div className="w-52"><NativeSelect aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></div>
      {period === "custom" && <>
        <Input type="date" aria-label="From" className="w-40" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
        <span className="text-sm text-muted-foreground">to</span>
        <Input type="date" aria-label="To" className="w-40" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
      </>}
      <PrintButton />
    </div>
  )
  return { range, picker }
}

function Bar({ note, picker }: { note: React.ReactNode; picker: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{note}</p>{picker}</div>
}

function Line({ label, value, minus, strong, href, indent }: { label: React.ReactNode; value: number; minus?: boolean; strong?: boolean; href?: string; indent?: boolean }) {
  const text = href ? <Link href={href} className="hover:underline">{label}</Link> : label
  return (
    <div className={cn("flex items-center justify-between gap-3 px-5 py-2.5 text-sm", strong && "bg-muted/50 font-semibold", indent && "pl-9 text-muted-foreground")}>
      <span>{text}</span>
      <span className={cn("tabular-nums", value < 0 && "text-destructive")}>{minus && value ? "− " : ""}{formatPaise(Math.abs(value))}</span>
    </div>
  )
}

function Result({ label, value, good }: { label: string; value: number; good: boolean }) {
  return <div className={cn("flex items-center justify-between px-5 py-3.5 text-base font-bold", good ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-destructive/10 text-destructive")}><span>{label}</span><span className="tabular-nums">{formatPaise(Math.abs(value))}</span></div>
}

export function ProfitLoss({ fy }: { fy: number }) {
  const { range, picker } = usePeriod(fy)
  const { data, error, reload } = useApi<PL>(`/finance/profit-and-loss?from=${range.from}&to=${range.to}`)
  const loss = (data?.netProfitPaise ?? 0) < 0
  return (
    <div className="grid gap-4">
      <Bar note={<>{formatDate(range.from)} – {formatDate(range.to)} · amounts before GST</>} picker={picker} />
      {error ? <ErrorState error={error} onRetry={() => void reload()} /> : !data ? <PageLoading /> : <>
        <StatGrid items={[
          { label: "Net sales", value: formatPaise(data.sales.netPaise) },
          { label: data.grossProfitPaise < 0 ? "Gross loss" : "Gross profit", value: formatPaise(Math.abs(data.grossProfitPaise)), hint: data.sales.netPaise ? `${Math.round((data.grossProfitPaise / data.sales.netPaise) * 100)}% of sales` : undefined },
          { label: "Expenses", value: formatPaise(data.expenses.totalPaise), href: "/app/m/finance/expenses" },
          { label: loss ? "Net loss" : "Net profit", value: formatPaise(Math.abs(data.netProfitPaise)), accent: loss ? "text-destructive" : "text-emerald-700 dark:text-emerald-300" },
        ]} />
        <Section title="Profit & loss statement" description="From posted invoices, bills, expenses and journal entries. Stock is valued at cost from the stock ledger." flush>
          <div className="divide-y">
            <Line label="Sales (invoices)" value={data.sales.invoicesPaise} href={ledgerHref("sales")} indent />
            {!!data.sales.debitNotesPaise && <Line label="Add: debit notes" value={data.sales.debitNotesPaise} indent />}
            {!!data.sales.returnsPaise && <Line label="Less: sales returns" value={data.sales.returnsPaise} minus indent />}
            <Line label="Net sales" value={data.sales.netPaise} strong />
            {!!data.cost.openingStockPaise && <Line label="Opening stock" value={data.cost.openingStockPaise} indent href={ledgerHref("stock")} />}
            <Line label="Add: purchases (with freight on bills)" value={data.cost.purchasesPaise} href={ledgerHref("purchases")} indent />
            {!!data.cost.returnsPaise && <Line label="Less: purchase returns" value={data.cost.returnsPaise} minus indent />}
            {!!data.cost.otherPaise && <Line label="Other purchase entries" value={data.cost.otherPaise} indent />}
            {!!data.cost.closingStockPaise && <Line label="Less: closing stock" value={data.cost.closingStockPaise} minus indent href={ledgerHref("stock")} />}
            <Line label="Cost of goods sold" value={data.cost.netPaise} minus strong />
            <Line label={data.grossProfitPaise < 0 ? "Gross loss" : "Gross profit"} value={data.grossProfitPaise} strong />
            {data.otherIncome.rows.map((r) => <Line key={r.key} label={r.name} value={r.amountPaise} indent href={ledgerHref(r.key)} />)}
            <Line label="Other income" value={data.otherIncome.totalPaise} strong />
            {data.expenses.rows.map((r) => <Line key={r.key} label={r.name} value={r.amountPaise} indent href={ledgerHref(r.key)} />)}
            <Line label="Expenses" value={data.expenses.totalPaise} minus strong />
            <Result label={loss ? "Net loss" : "Net profit"} value={data.netProfitPaise} good={!loss} />
          </div>
        </Section>
      </>}
    </div>
  )
}

export function BalanceSheet() {
  const today = todayInIndia()
  const [date, setDate] = React.useState(today)
  const { data, error, reload } = useApi<BS>(`/finance/balance-sheet?date=${date}`)
  const diff = data ? data.assetsPaise - data.liabilitiesPaise - data.equityPaise : 0
  const side = (title: string, rows: BSRow[], total: number) => (
    <Section title={title} flush>
      <div className="divide-y">
        {rows.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nothing here.</p> : rows.map((r) => <Line key={r.key} label={r.name} value={r.amountPaise} href={r.key.includes(":") || ["receivables", "payables", "stock", "capital", "opening"].includes(r.key) ? ledgerHref(r.key) : undefined} />)}
        <Line label={`Total ${title.toLowerCase()}`} value={total} strong />
      </div>
    </Section>
  )
  return (
    <div className="grid gap-4">
      <Bar
        note={data ? <>As on {formatDate(data.date)} · profit this year counted from {formatDate(data.fyStart)}</> : "As on a date"}
        picker={<div className="flex items-center gap-2 print:hidden"><Input type="date" aria-label="As on" className="w-40" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} /><PrintButton /></div>}
      />
      {error ? <ErrorState error={error} onRetry={() => void reload()} /> : !data ? <PageLoading /> : <>
        <StatGrid items={[
          { label: "What you own", value: formatPaise(data.assetsPaise) },
          { label: "What you owe", value: formatPaise(data.liabilitiesPaise) },
          { label: "Owner's worth", value: formatPaise(data.equityPaise), accent: data.equityPaise < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300" },
          { label: "Books", value: diff === 0 ? "Balanced" : `Off by ${formatPaise(Math.abs(diff))}`, accent: diff === 0 ? "text-emerald-700 dark:text-emerald-300" : "text-destructive" },
        ]} />
        <div className="grid gap-4 lg:grid-cols-2">
          {side("Assets", data.assets, data.assetsPaise)}
          <div className="grid content-start gap-4">
            {side("Liabilities", data.liabilities, data.liabilitiesPaise)}
            {side("Capital", data.equity, data.equityPaise)}
            <div className="ui-surface flex items-center justify-between px-5 py-3.5 font-bold"><span>Liabilities + capital</span><span className="tabular-nums">{formatPaise(data.liabilitiesPaise + data.equityPaise)}</span></div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Loans, capital, vehicles and deposits come from journal entries. Add them on <Link href="/app/m/finance/journals" className="text-primary hover:underline">Journal entries</Link> so this is complete.</p>
      </>}
    </div>
  )
}

export function TrialBalance({ fy }: { fy: number }) {
  const router = useRouter()
  const { range, picker } = usePeriod(fy, "this_fy")
  return (
    <div className="grid gap-4">
      <Bar note={<>{formatDate(range.from)} – {formatDate(range.to)} · capital, assets and liabilities from the start; income and expenses in the period</>} picker={picker} />
      <DataList<TBRow>
        id="fin-trial-balance"
        params={{ from: range.from, to: range.to }}
        load={async ({ params, limit, cursor }) => {
          const r = await api.get<{ debitPaise: number; creditPaise: number; data: Omit<TBRow, "id">[] }>(`/finance/trial-balance?from=${params.from}&to=${params.to}`)
          const q = (params.q ?? "").toLowerCase()
          const all = r.data.map((x) => ({ ...x, id: x.key })).filter((x) => !q || `${x.code} ${x.name} ${x.section}`.toLowerCase().includes(q))
          const start = Number(cursor ?? 0)
          return { ...r, data: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, total: all.length }
        }}
        header={{ title: "Trial balance", description: "Every ledger's debit or credit balance. The two totals must match." }}
        summary={(r) => {
          const ok = Number(r.debitPaise) === Number(r.creditPaise)
          return <span className="flex flex-wrap items-center gap-x-4 text-sm text-muted-foreground"><span>Debit <strong className="text-foreground tabular-nums">{formatPaise(Number(r.debitPaise ?? 0))}</strong></span><span>Credit <strong className="text-foreground tabular-nums">{formatPaise(Number(r.creditPaise ?? 0))}</strong></span><span className={cn("flex items-center gap-1 font-medium", ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}><Scale className="size-3.5" />{ok ? "Balanced" : "Not balanced"}</span></span>
        }}
        columns={[
          { key: "code", header: "Code", csv: (r) => r.code, cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.code}</span> },
          { key: "name", header: "Ledger", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: "group", header: "Kind", csv: (r) => GROUP_LABEL[r.group], cell: (r) => <Pill color={GROUP_TONE[r.group]}>{GROUP_LABEL[r.group]}</Pill> },
          { key: "dr", header: "Debit", align: "right", sort: (r) => r.debitPaise, csv: (r) => r.debitPaise / 100, cell: (r) => (r.debitPaise ? <span className="tabular-nums">{formatPaise(r.debitPaise)}</span> : "") },
          { key: "cr", header: "Credit", align: "right", sort: (r) => r.creditPaise, csv: (r) => r.creditPaise / 100, cell: (r) => (r.creditPaise ? <span className="tabular-nums">{formatPaise(r.creditPaise)}</span> : "") },
        ]}
        searchPlaceholder="Search ledger or code"
        rowClick={(r) => { if (r.key !== "profit_bf") router.push(ledgerHref(r.key)) }}
        exportName={`trial-balance-${range.to}`}
        emptyState={<EmptyState icon={Scale} title="Nothing recorded yet" description="Bills, payments and expenses show up here as they are posted." />}
      />
    </div>
  )
}

export function GstSummary({ fy }: { fy: number }) {
  const { range, picker } = usePeriod(fy, "last_month")
  const { data, error, reload } = useApi<GST>(`/finance/gst-summary?from=${range.from}&to=${range.to}`)
  const total = (t: Tax) => t.cgstPaise + t.sgstPaise + t.igstPaise
  const row = (label: string, t: Tax, opts: { strong?: boolean; href?: string; count?: number } = {}) => (
    <tr className={cn(opts.strong && "bg-muted/50 font-semibold")}>
      <td className="px-5 py-2.5">{opts.href ? <Link href={opts.href} className="hover:underline">{label}</Link> : label}{opts.count ? <span className="ml-1 text-xs text-muted-foreground">({opts.count})</span> : null}</td>
      {[t.taxablePaise, t.cgstPaise, t.sgstPaise, t.igstPaise, total(t)].map((v, i) => <td key={i} className={cn("px-5 py-2.5 text-right tabular-nums", v < 0 && "text-destructive")}>{v ? formatPaise(v) : "—"}</td>)}
    </tr>
  )
  const head = <thead className="text-xs text-muted-foreground"><tr className="border-b"><th className="px-5 py-2.5 text-left font-medium" /><th className="px-5 py-2.5 text-right font-medium">Taxable</th><th className="px-5 py-2.5 text-right font-medium">CGST</th><th className="px-5 py-2.5 text-right font-medium">SGST</th><th className="px-5 py-2.5 text-right font-medium">IGST</th><th className="px-5 py-2.5 text-right font-medium">Total GST</th></tr></thead>
  return (
    <div className="grid gap-4">
      <Bar note={<>{formatDate(range.from)} – {formatDate(range.to)} · what GSTR-3B asks for. GSTR-3B is due on the 20th of the next month.</>} picker={picker} />
      {error ? <ErrorState error={error} onRetry={() => void reload()} /> : !data ? <PageLoading /> : <>
        {!data.registered && <p className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">Your business has no GSTIN in settings, so no input credit is counted: GST on bills is part of the cost.</p>}
        {data.composition && <p className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">Composition scheme: no input credit (Section 10(4)). You pay the composition rate on turnover in CMP-08.</p>}
        <StatGrid items={[
          { label: "GST on sales", value: formatPaise(total(data.outputTotal) + total(data.rcm)), hint: total(data.rcm) ? `Includes ${formatPaise(total(data.rcm))} reverse charge` : undefined },
          { label: "Input credit", value: formatPaise(total(data.inputTotal)), accent: "text-emerald-700 dark:text-emerald-300" },
          { label: data.netPaise >= 0 ? "GST to pay" : "Credit to carry forward", value: formatPaise(Math.abs(data.netPaise)), accent: data.netPaise > 0 ? "text-rose-700 dark:text-rose-300" : undefined },
          { label: "Paid or set off", value: formatPaise(data.paidPaise), hint: data.leftPaise > 0 ? `${formatPaise(data.leftPaise)} still to pay` : "Nothing left to pay", href: "/app/m/finance/journals" },
        ]} />
        <Section title="Tax on sales (outward supplies)" flush>
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">{head}<tbody className="divide-y">
            {row("Invoices", data.output.invoices, { count: data.counts.invoices, href: "/app/m/sales/reports" })}
            {row("Debit notes", data.output.debitNotes, { count: data.counts.debitNotes })}
            {row("Less: sales returns", data.output.creditNotes, { count: data.counts.creditNotes })}
            {total(data.rcm) !== 0 && row("Reverse charge you pay", data.rcm)}
            {row("Total output tax", { taxablePaise: data.outputTotal.taxablePaise, cgstPaise: data.outputTotal.cgstPaise + data.rcm.cgstPaise, sgstPaise: data.outputTotal.sgstPaise + data.rcm.sgstPaise, igstPaise: data.outputTotal.igstPaise + data.rcm.igstPaise }, { strong: true })}
          </tbody></table></div>
        </Section>
        <Section title="Input tax credit" description="Match purchase bills with GSTR-2B before you claim them (Rule 36(4))." flush>
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">{head}<tbody className="divide-y">
            {row("Purchase bills", data.input.bills, { count: data.counts.bills, href: "/app/m/purchase/reports" })}
            {row("Less: purchase returns", data.input.returns, { count: data.counts.returns })}
            {row("Expenses with a GST bill", data.input.expenses, { count: data.counts.expenses, href: "/app/m/finance/expenses" })}
            {row("Total input credit", data.inputTotal, { strong: true })}
          </tbody></table></div>
        </Section>
        <p className="text-xs text-muted-foreground">Paid the GST? Record it as a journal entry (&quot;GST paid to government&quot;) so it shows here and in the balance sheet.</p>
      </>}
    </div>
  )
}

export function BudgetReport() {
  const [month, setMonth] = React.useState(todayInIndia().slice(0, 7))
  const { data, error, reload } = useApi<Budget>(`/finance/budget?month=${month}`)
  return (
    <div className="grid gap-4">
      <Bar note="Each expense category against its monthly budget, before GST you claim back." picker={<div className="flex items-center gap-2 print:hidden"><Input type="month" aria-label="Month" className="w-44" value={month} max={todayInIndia().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} /><Link href="/app/m/finance/settings" className="text-sm text-primary hover:underline">Set budgets</Link></div>} />
      {error ? <ErrorState error={error} onRetry={() => void reload()} /> : !data ? <PageLoading /> : <>
        <StatGrid items={[
          { label: "Budget", value: formatPaise(data.budgetPaise) },
          { label: "Spent in budgeted heads", value: formatPaise(data.spentInBudgetPaise), accent: data.spentInBudgetPaise > data.budgetPaise && data.budgetPaise > 0 ? "text-destructive" : undefined },
          { label: "All expenses", value: formatPaise(data.spentPaise), href: "/app/m/finance/expenses" },
          { label: "Over budget", value: String(data.over), hint: data.over ? "categories" : "None", accent: data.over ? "text-destructive" : "text-emerald-700 dark:text-emerald-300" },
        ]} />
        <Section title="By category" flush>
          {data.data.length === 0 ? <div className="p-6"><EmptyState icon={Scale} title="No budgets yet" description="Set a monthly budget for rent, salaries or any expense head in Finance setup." action={<Link href="/app/m/finance/settings" className="text-sm text-primary hover:underline">Set budgets</Link>} /></div> : (
            <ul className="divide-y">
              {data.data.map((r) => {
                const pct = r.budgetPaise ? Math.round((r.spentPaise / r.budgetPaise) * 100) : null
                return (
                  <li key={r.id} className="grid gap-1.5 px-5 py-3 text-sm">
                    <span className="flex items-center justify-between gap-3"><Link href={ledgerHref(`exp:${r.name}`)} className="font-medium hover:underline">{r.name}</Link><span className="tabular-nums">{formatPaise(r.spentPaise)}{r.budgetPaise ? <span className="text-muted-foreground"> of {formatPaise(r.budgetPaise)}</span> : <span className="text-muted-foreground"> · no budget</span>}</span></span>
                    {pct !== null && <span className="flex items-center gap-2"><span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", pct > 100 ? "bg-destructive" : pct > 80 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(pct, 100)}%` }} /></span><span className={cn("w-12 text-right text-xs tabular-nums", pct > 100 && "font-semibold text-destructive")}>{pct}%</span></span>}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </>}
    </div>
  )
}

export function CashFlow({ fy }: { fy: number }) {
  const { range, picker } = usePeriod(fy)
  const { data, error, reload } = useApi<CF>(`/finance/cash-flow?from=${range.from}&to=${range.to}`)
  const ins = data?.byKind.filter((k) => k.inPaise) ?? []
  const outs = data?.byKind.filter((k) => k.outPaise) ?? []
  return (
    <div className="grid gap-4">
      <Bar note={<>{formatDate(range.from)} – {formatDate(range.to)} · all cash, bank and UPI together; transfers between them left out</>} picker={picker} />
      {error ? <ErrorState error={error} onRetry={() => void reload()} /> : !data ? <PageLoading /> : <>
        <StatGrid items={[
          { label: "Opening balance", value: formatPaise(data.openingPaise) },
          { label: "Money in", value: formatPaise(data.inPaise), accent: "text-emerald-700 dark:text-emerald-300" },
          { label: "Money out", value: formatPaise(data.outPaise), accent: "text-rose-700 dark:text-rose-300" },
          { label: "Closing balance", value: formatPaise(data.closingPaise), accent: data.closingPaise < 0 ? "text-destructive" : undefined, href: "/app/m/finance/accounts" },
        ]} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Where money came from" flush>
            <div className="divide-y">
              {ins.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nothing came in.</p> : ins.map((k) => <Line key={k.kind} label={k.label} value={k.inPaise} />)}
              <Line label="Total in" value={data.inPaise} strong />
            </div>
          </Section>
          <Section title="Where money went" flush>
            <div className="divide-y">
              {outs.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nothing went out.</p> : outs.map((k) => <Line key={k.kind} label={k.label} value={k.outPaise} />)}
              <Line label="Total out" value={data.outPaise} strong />
            </div>
          </Section>
        </div>
        {data.byMonth.length > 1 && (
          <Section title="Month by month" flush>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr className="border-b"><th className="px-5 py-2.5 text-left font-medium">Month</th><th className="px-5 py-2.5 text-right font-medium">In</th><th className="px-5 py-2.5 text-right font-medium">Out</th><th className="px-5 py-2.5 text-right font-medium">Net</th></tr></thead>
                <tbody className="divide-y">
                  {data.byMonth.map((m) => (
                    <tr key={m.month}>
                      <td className="px-5 py-2.5">{new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</td>
                      <td className="px-5 py-2.5 text-right text-emerald-700 tabular-nums dark:text-emerald-300">{formatPaise(m.inPaise)}</td>
                      <td className="px-5 py-2.5 text-right text-rose-700 tabular-nums dark:text-rose-300">{formatPaise(m.outPaise)}</td>
                      <td className={cn("px-5 py-2.5 text-right font-semibold tabular-nums", m.netPaise < 0 && "text-destructive")}>{formatPaise(m.netPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </>}
    </div>
  )
}

export function DayBook() {
  const router = useRouter()
  const [date, setDate] = React.useState(todayInIndia())
  const shift = (days: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); setDate(d.toISOString().slice(0, 10)) }
  const today = todayInIndia()
  return (
    <DataList<DayRow>
      id="fin-day-book"
      params={{ date }}
      load={async ({ params, limit, cursor }) => {
        const r = await api.get<{ data: DayRow[] }>(`/finance/day-book?date=${params.date}`)
        const q = (params.q ?? "").toLowerCase()
        const all = r.data.filter((x) => !q || `${x.type} ${x.number ?? ""} ${x.party ?? ""} ${x.account ?? ""}`.toLowerCase().includes(q))
        const start = Number(cursor ?? 0)
        const live = all.filter((x) => !x.cancelled)
        return { all, inPaise: live.filter((x) => x.direction === "in").reduce((s, x) => s + x.amountPaise, 0), outPaise: live.filter((x) => x.direction === "out").reduce((s, x) => s + x.amountPaise, 0), data: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, total: all.length }
      }}
      header={{
        title: "Day book",
        description: "Everything recorded on one day: sales, purchases, payments, expenses and transfers.",
        actions: (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => shift(-1)}><ChevronLeft /></Button>
            <Input type="date" aria-label="Day" className="w-40" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Button variant="outline" size="icon" aria-label="Next day" disabled={date >= today} onClick={() => shift(1)}><ChevronRight /></Button>
          </div>
        ),
      }}
      summary={(r) => <span className="flex flex-wrap gap-x-4 text-sm text-muted-foreground"><span>{formatDate(date)}</span><span>In <strong className="text-emerald-700 tabular-nums dark:text-emerald-300">{formatPaise(Number(r.inPaise ?? 0))}</strong></span><span>Out <strong className="text-rose-700 tabular-nums dark:text-rose-300">{formatPaise(Number(r.outPaise ?? 0))}</strong></span></span>}
      columns={[
        { key: "type", header: "Entry", hideable: false, csv: (r) => r.type, cell: (r) => <span className="grid gap-0.5"><span className="font-medium">{r.type}</span>{r.cancelled && <Pill color="slate">Cancelled</Pill>}</span> },
        { key: "number", header: "Number", csv: (r) => r.number ?? "", cell: (r) => (r.number ? <span className="font-mono text-xs">{r.number}</span> : "—") },
        { key: "party", header: "With", csv: (r) => r.party ?? "", cell: (r) => r.party ?? "—" },
        { key: "account", header: "Account", csv: (r) => r.account ?? "", cell: (r) => r.account ?? <span className="text-muted-foreground">On credit</span> },
        { key: "in", header: "In", align: "right", csv: (r) => (r.direction === "in" ? r.amountPaise / 100 : ""), cell: (r) => (r.direction === "in" ? <span className={cn("tabular-nums text-emerald-700 dark:text-emerald-300", r.cancelled && "line-through opacity-60")}>{formatPaise(r.amountPaise)}</span> : "") },
        { key: "out", header: "Out", align: "right", csv: (r) => (r.direction === "out" ? r.amountPaise / 100 : ""), cell: (r) => (r.direction === "out" ? <span className={cn("tabular-nums text-rose-700 dark:text-rose-300", r.cancelled && "line-through opacity-60")}>{formatPaise(r.amountPaise)}</span> : "") },
      ]}
      searchPlaceholder="Search entry, number or name"
      rowClick={(r) => { if (r.href) router.push(r.href) }}
      exportName={`day-book-${date}`}
      emptyState={<EmptyState icon={BookOpen} title="Nothing on this day" description="Pick another day with the arrows or the date." />}
    />
  )
}

