"use client"

import { Banknote, CreditCard, Landmark, Smartphone } from "lucide-react"
import { useSharedApi } from "@/lib/use-api"

// Finance shared types: cash and bank accounts, expenses, other income, transfers.

export type AccountKind = "cash" | "bank" | "wallet" | "card"
export interface FinAccount {
  id: string
  name: string
  kind: AccountKind
  bankName: string | null
  accountNo: string | null
  ifsc: string | null
  upiId: string | null
  openingPaise: number
  openingDate: string | null
  isDefault: boolean
  isActive: boolean
  notes: string | null
  balancePaise: number
  inThisMonthPaise: number
  outThisMonthPaise: number
  entries: number
  isCash: boolean
  takesUnassigned: boolean
  version: number
}

export interface Expense {
  id: string
  number: string | null
  category: string
  amountPaise: number
  paidOn: string
  method: string
  accountId: string
  account: string | null
  payee: string | null
  contactId: string | null
  reference: string | null
  notes: string | null
  receiptUrl: string | null
  billNo: string | null
  vendorGstin: string | null
  taxablePaise: number | null
  gstRateBp: number | null
  gstPaise: number | null
  createdAt: string
  version: number
}

export interface Income {
  id: string
  number: string
  receivedOn: string
  category: string
  accountId: string
  account: string | null
  amountPaise: number
  payer: string | null
  reference: string | null
  notes: string | null
  version: number
}

export interface Transfer {
  id: string
  number: string
  transferOn: string
  fromAccountId: string
  toAccountId: string
  fromAccount: string
  toAccount: string
  amountPaise: number
  chargesPaise: number
  reference: string | null
  notes: string | null
}

export const KIND_LABEL: Record<AccountKind, string> = { cash: "Cash", bank: "Bank account", wallet: "UPI / wallet", card: "Credit card" }
export const KIND_ICON = { cash: Banknote, bank: Landmark, wallet: Smartphone, card: CreditCard }
export const KIND_TONE: Record<AccountKind, string> = { cash: "emerald", bank: "blue", wallet: "violet", card: "amber" }

/** Last 4 digits only, as banks print them */
export const masked = (no: string | null) => (no ? `•••• ${no.slice(-4)}` : null)

// ── Books ──

export type LedgerGroup = "asset" | "liability" | "equity" | "income" | "expense"
export const GROUP_LABEL: Record<LedgerGroup, string> = { asset: "Asset", liability: "Liability", equity: "Capital", income: "Income", expense: "Expense" }
export const GROUP_TONE: Record<LedgerGroup, string> = { asset: "blue", liability: "orange", equity: "violet", income: "emerald", expense: "rose" }
export const GROUP_HINT: Record<LedgerGroup, string> = {
  asset: "Something the business owns: a vehicle, machinery, a deposit, money lent",
  liability: "Something the business owes: a bank loan, a loan from a friend, a salary not yet paid",
  equity: "The owner's money: capital put in, drawings taken out",
  income: "Money earned that is not a sale",
  expense: "A cost of running the business, e.g. depreciation",
}

export interface Ledger {
  key: string
  code: string
  name: string
  group: LedgerGroup
  section: string
  system: boolean
  journal: boolean
  isActive: boolean
  id?: string
  description?: string | null
  version?: number
  balancePaise: number
  usedInJournals: boolean
}

export interface JournalLine { id?: string; ledgerKey: string; ledger?: string; debitPaise: number; creditPaise: number; description: string | null }
export interface Journal { id: string; number: string; journalOn: string; narration: string; reference: string | null; totalPaise: number; version: number; createdAt: string; lines: JournalLine[] }

export interface Recurring {
  id: string
  name: string
  every: "week" | "month" | "quarter" | "year"
  nextOn: string
  endsOn: string | null
  isActive: boolean
  ended: boolean
  isDue: boolean
  amountPaise: number
  category: string
  lastExpenseId: string | null
  version: number
  template: { category: string; amountPaise: number; accountId: string; payee?: string | null; notes?: string | null; reference?: string | null }
}
export const EVERY_LABEL: Record<Recurring["every"], string> = { week: "Every week", month: "Every month", quarter: "Every 3 months", year: "Every year" }

export function useLedgers() {
  return useSharedApi<{ data: Ledger[] }>("/finance/ledgers")
}

/** Ledger page link: keys hold ":" so they travel as a query string */
export const ledgerHref = (key: string) => `/app/m/finance/ledgers/view?key=${encodeURIComponent(key)}`

export function useFinAccounts() {
  return useSharedApi<{ data: FinAccount[] }>("/finance/accounts")
}
