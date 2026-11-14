"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PageHeader } from "@/components/app-shell"
import { PageLoading } from "@/components/page-states"
import { BudgetReport, CashFlow, DayBook, GstSummary, ProfitLoss } from "@/components/finance/reports"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"

// Reports for the owner: profit, where the money went, GST to pay, budget and each day.
// The balance sheet and trial balance are on Accountant.

type Tab = "pl" | "cash" | "gst" | "budget" | "day"
const TABS: [Tab, string][] = [["pl", "Profit & loss"], ["cash", "Cash flow"], ["gst", "GST summary"], ["budget", "Budget"], ["day", "Day book"]]

export default function FinanceReportsPage() {
  return <React.Suspense fallback={<PageLoading />}><Reports /></React.Suspense>
}

function Reports() {
  const { can, me } = useAuth()
  const router = useRouter()
  const search = useSearchParams()
  const tab = (TABS.find(([k]) => k === search.get("tab"))?.[0] ?? "pl") as Tab
  if (!can("finance.expense.view")) return <PageHeader title="Finance reports" description="You don't have access to finance. Ask your admin." />
  const fy = me?.tenant?.fyStartMonth ?? 4
  return (
    <div className="grid gap-4">
      <PageHeader title="Finance reports" description="Profit, where the money went, GST to pay, budget against spending, and what happened each day." />
      <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border p-1 text-sm print:hidden" role="tablist" aria-label="Reports">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => router.replace(`/app/m/finance/reports${k === "pl" ? "" : `?tab=${k}`}`, { scroll: false })} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", tab === k && "bg-primary text-primary-foreground")}>{l}</button>)}
      </div>
      {tab === "pl" && <ProfitLoss fy={fy} />}
      {tab === "cash" && <CashFlow fy={fy} />}
      {tab === "gst" && <GstSummary fy={fy} />}
      {tab === "budget" && <BudgetReport />}
      {tab === "day" && <DayBook />}
    </div>
  )
}
