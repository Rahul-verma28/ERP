"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRightLeft, Plus, Receipt, TrendingUp } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { PageError, PageLoading } from "@/components/page-states"
import { Pill, Section, StatGrid } from "@/components/page-parts"
import { AccountDialog, ExpenseDialog, IncomeDialog, TransferDialog } from "@/components/finance/forms"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { KIND_ICON, KIND_LABEL, KIND_TONE, masked, useFinAccounts, type FinAccount } from "@/lib/finance"
import { tone } from "@/lib/tones"
import { cn } from "@/lib/utils"

// Finance home: what is in cash and bank, money in and out this month, profit, and who owes whom.

interface Overview {
  accounts: FinAccount[]
  cashPaise: number
  bankPaise: number
  month: { inPaise: number; outPaise: number; profitPaise: number; expensesPaise: number }
  receivablePaise: number
  payablePaise: number
  byMonth: { month: string; inPaise: number; outPaise: number }[]
  recentExpenses: { id: string; number: string | null; paidOn: string; category: string; payee: string | null; amountPaise: number }[]
}

export default function FinanceOverviewPage() {
  const { can } = useAuth()
  const { data, error, reload } = useApi<Overview>("/finance/overview")
  const accounts = useFinAccounts()
  const [open, setOpen] = React.useState<"expense" | "income" | "transfer" | "account" | null>(null)
  if (!can("finance.expense.view")) return <PageHeader title="Finance" description="You don't have access to finance. Ask your admin." />
  if (error) return <PageError error={error} onRetry={() => void reload()} />
  if (!data) return <PageLoading />
  const done = () => { setOpen(null); void reload(); void accounts.reload() }
  const write = can("finance.expense.create")

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Finance"
        description="Your cash and bank balances, money in and out, and profit — all from the bills, payments and expenses you record."
        actions={<div className="flex flex-wrap gap-2">
          {write && <>
          <Button variant="outline" onClick={() => setOpen("transfer")}><ArrowRightLeft /> Move money</Button>
          <Button variant="outline" onClick={() => setOpen("income")}><TrendingUp /> Other income</Button>
          <Button onClick={() => setOpen("expense")}><Plus /> Add expense</Button>
          </>}
        </div>}
      />
      <StatGrid items={[
        { label: "Cash in hand", value: formatPaise(data.cashPaise), accent: data.cashPaise < 0 ? "text-destructive" : undefined },
        { label: "In bank and UPI", value: formatPaise(data.bankPaise), accent: data.bankPaise < 0 ? "text-destructive" : undefined },
        { label: "Money in this month", value: formatPaise(data.month.inPaise), accent: "text-emerald-700 dark:text-emerald-300", href: "/app/m/finance/reports?tab=cash" },
        { label: "Money out this month", value: formatPaise(data.month.outPaise), accent: "text-rose-700 dark:text-rose-300", href: "/app/m/finance/reports?tab=cash" },
      ]} />
      <StatGrid items={[
        { label: data.month.profitPaise < 0 ? "Loss this month" : "Profit this month", value: formatPaise(Math.abs(data.month.profitPaise)), hint: "Sales − purchases − expenses", accent: data.month.profitPaise < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300", href: "/app/m/finance/reports" },
        { label: "Expenses this month", value: formatPaise(data.month.expensesPaise), hint: "Before GST you claim back", href: "/app/m/finance/expenses" },
        { label: "Customers owe you", value: formatPaise(data.receivablePaise), href: "/app/m/sales/reports" },
        { label: "You owe suppliers", value: formatPaise(data.payablePaise), href: "/app/m/purchase/reports" },
      ]} />

      <Section title="Cash and bank" description="Open one for its passbook" action={write && <Button size="sm" variant="outline" onClick={() => setOpen("account")}><Plus /> Add account</Button>} flush>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.accounts.filter((a) => a.isActive).map((a) => {
            const Icon = KIND_ICON[a.kind]
            return (
              <Link key={a.id} href={`/app/m/finance/accounts/${a.id}`} className="grid gap-3 rounded-2xl border bg-card p-4 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2.5"><span className={cn("grid size-9 place-items-center rounded-xl", tone(KIND_TONE[a.kind]).pill)}><Icon className="size-4" /></span><span><span className="block font-semibold">{a.name}</span><span className="text-xs text-muted-foreground">{[a.bankName, masked(a.accountNo)].filter(Boolean).join(" ") || KIND_LABEL[a.kind]}</span></span></span>
                  {a.isDefault && <Pill color="blue">Default</Pill>}
                </div>
                <p className={cn("text-2xl font-bold tabular-nums", a.balancePaise < 0 && "text-destructive")}>{formatPaise(a.balancePaise)}</p>
                <p className="flex justify-between text-xs text-muted-foreground"><span className="text-emerald-700 dark:text-emerald-300">+{formatPaise(a.inThisMonthPaise)}</span><span className="text-rose-700 dark:text-rose-300">−{formatPaise(a.outThisMonthPaise)}</span><span>this month</span></p>
              </Link>
            )
          })}
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Money in and out" description="By month, this financial period">
          {data.byMonth.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nothing yet this month.</p> : (
            <ul className="grid gap-3">
              {data.byMonth.map((m) => {
                const max = Math.max(1, ...data.byMonth.flatMap((x) => [x.inPaise, x.outPaise]))
                return (
                  <li key={m.month} className="grid gap-1 text-sm">
                    <span className="text-xs text-muted-foreground">{new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
                    <span className="flex items-center gap-2"><span className="h-2.5 rounded-full bg-emerald-500" style={{ width: `${(m.inPaise / max) * 70 + 1}%` }} /><span className="tabular-nums">{formatPaise(m.inPaise)} in</span></span>
                    <span className="flex items-center gap-2"><span className="h-2.5 rounded-full bg-rose-500" style={{ width: `${(m.outPaise / max) * 70 + 1}%` }} /><span className="tabular-nums">{formatPaise(m.outPaise)} out</span></span>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
        <Section title="Recent expenses" action={<Link href="/app/m/finance/expenses" className={buttonVariants({ variant: "ghost", size: "sm" })}>See all</Link>} flush>
          {data.recentExpenses.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No expenses yet. Add rent, salary and bills so profit is right.</p> : (
            <ul className="divide-y">
              {data.recentExpenses.map((e) => (
                <li key={e.id}>
                  <Link href={`/app/m/finance/expenses/${e.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-muted/40">
                    <span className="flex min-w-0 items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"><Receipt className="size-4" /></span><span className="min-w-0"><span className="block font-medium">{e.category}</span><span className="block truncate text-xs text-muted-foreground">{formatDate(e.paidOn)}{e.payee ? ` · ${e.payee}` : ""}</span></span></span>
                    <span className="font-semibold tabular-nums">{formatPaise(e.amountPaise)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {open === "expense" && <ExpenseDialog onClose={() => setOpen(null)} onSaved={done} />}
      {open === "income" && <IncomeDialog onClose={() => setOpen(null)} onSaved={done} />}
      {open === "transfer" && <TransferDialog onClose={() => setOpen(null)} onSaved={done} />}
      {open === "account" && <AccountDialog account={null} onClose={() => setOpen(null)} onSaved={done} />}
    </div>
  )
}
