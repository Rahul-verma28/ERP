"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"

// The few pages under one Finance menu item, as tabs at the top of each:
// Expenses (expenses, other income, repeating), Cash & Bank (accounts, transfers) and
// Accountant (balance sheet, trial balance, journal entries, chart of accounts).

const GROUPS = {
  expenses: [
    ["expenses", "Expenses", "/app/m/finance/expenses"],
    ["income", "Other income", "/app/m/finance/income"],
    ["recurring", "Repeating", "/app/m/finance/recurring"],
  ],
  cash: [
    ["accounts", "Accounts", "/app/m/finance/accounts"],
    ["transfers", "Transfers", "/app/m/finance/transfers"],
  ],
  accountant: [
    ["bs", "Balance sheet", "/app/m/finance/accountant"],
    ["tb", "Trial balance", "/app/m/finance/accountant?tab=tb"],
    ["journals", "Journal entries", "/app/m/finance/journals"],
    ["ledgers", "Chart of accounts", "/app/m/finance/ledgers"],
  ],
} as const

type Group = keyof typeof GROUPS
type Key<G extends Group> = (typeof GROUPS)[G][number][0]

export function FinanceTabs<G extends Group>({ group, active, badge }: { group: G; active: Key<G>; badge?: Partial<Record<Key<G>, number>> }) {
  return (
    <nav className="mb-4 flex w-fit max-w-full flex-wrap gap-1 rounded-xl border p-1 text-sm print:hidden" aria-label="Pages">
      {GROUPS[group].map(([k, label, href]) => {
        const count = badge?.[k as Key<G>]
        return (
          <Link key={k} href={href} aria-current={k === active ? "page" : undefined} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium text-muted-foreground hover:text-foreground", k === active && "bg-primary text-primary-foreground hover:text-primary-foreground")}>
            {label}
            {!!count && <span className={cn("rounded-full px-1.5 text-xs tabular-nums", k === active ? "bg-primary-foreground/20" : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200")}>{count}</span>}
          </Link>
        )
      })}
    </nav>
  )
}
