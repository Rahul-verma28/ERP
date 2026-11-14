"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { PageHeader } from "@/components/app-shell"
import { PageLoading } from "@/components/page-states"
import { FinanceTabs } from "@/components/finance/sub-tabs"
import { BalanceSheet, TrialBalance } from "@/components/finance/reports"
import { useAuth } from "@/lib/auth"

// Accountant: the books a CA works with — balance sheet and trial balance here,
// journal entries and the chart of accounts one tab over.

export default function AccountantPage() {
  return <React.Suspense fallback={<PageLoading />}><Accountant /></React.Suspense>
}

function Accountant() {
  const { can, me } = useAuth()
  const tab = useSearchParams().get("tab") === "tb" ? "tb" : "bs"
  if (!can("finance.expense.view")) return <PageHeader title="Accountant" description="You don't have access to finance. Ask your admin." />
  return (
    <div className="grid gap-0">
      <FinanceTabs group="accountant" active={tab} />
      <div className="grid gap-4">
        <PageHeader
          title={tab === "bs" ? "Balance sheet" : "Trial balance"}
          description={tab === "bs" ? "What the business owns, what it owes, and the owner's share — made from every bill, payment, expense and journal entry." : "Every ledger's debit or credit balance for your CA. The two totals always match."}
        />
        {tab === "bs" ? <BalanceSheet /> : <TrialBalance fy={me?.tenant?.fyStartMonth ?? 4} />}
      </div>
    </div>
  )
}
