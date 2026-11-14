"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { BookOpen, FilePlus2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/common"
import { DataList, periodFilter } from "@/components/data-list"
import { PageError, PageLoading } from "@/components/page-states"
import { BackLink, DetailHeader, Pill } from "@/components/page-parts"
import { JournalDialog } from "@/components/finance/books"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { GROUP_LABEL, GROUP_TONE, useLedgers } from "@/lib/finance"
import { cn } from "@/lib/utils"

// One ledger's entries: where each came from, debit, credit and the running balance.

interface Row { id: string; date: string; type: string; number: string | null; party: string | null; narration: string; debitPaise: number; creditPaise: number; balancePaise: number; href: string | null }
const TYPE: Record<string, string> = {
  invoice: "Sale", debit_note: "Debit note", credit_note: "Sales return", opening_balance: "Opening balance", purchase_bill: "Purchase", purchase_return: "Purchase return",
  receipt: "Receipt", supplier_payment: "Payment", expense: "Expense", income: "Other income", transfer: "Transfer", journal: "Journal", opening: "Opening balance",
}

export default function LedgerViewPage() {
  return <React.Suspense fallback={<PageLoading />}><LedgerView /></React.Suspense>
}

function LedgerView() {
  const key = useSearchParams().get("key") ?? ""
  const router = useRouter()
  const { can, me } = useAuth()
  const ledgers = useLedgers()
  const [version, setVersion] = React.useState(0)
  const [adding, setAdding] = React.useState(false)
  if (ledgers.error) return <PageError error={ledgers.error} onRetry={() => void ledgers.reload()} />
  if (!ledgers.data) return <PageLoading />
  const l = ledgers.data.data.find((x) => x.key === key)
  if (!l) return <PageError error={new Error("This ledger was not found.")} onRetry={() => router.push("/app/m/finance/ledgers")} />
  const fy = me?.tenant?.fyStartMonth ?? 4
  const pl = l.group === "income" || l.group === "expense"

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/finance/ledgers">Chart of accounts</BackLink>
      <DetailHeader
        title={l.name}
        icon={BookOpen}
        pills={<><Pill color={GROUP_TONE[l.group]}>{GROUP_LABEL[l.group]}</Pill>{!l.isActive && <Pill color="slate">Closed</Pill>}</>}
        subtitle={[l.code && `Code ${l.code}`, l.section, l.description].filter(Boolean).join(" · ")}
        actions={l.journal && can("finance.expense.create") ? <Button onClick={() => setAdding(true)}><FilePlus2 /> Journal entry</Button> : undefined}
      />
      {key === "stock" && <p className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">Stock is valued from the stock ledger, at what it cost. Open Inventory → Reports for item-wise value.</p>}
      <DataList<Row>
        id="fin-ledger"
        params={{ v: String(version), key }}
        defaultFilters={{ period: "this_fy" }}
        load={async ({ params, limit, cursor }) => {
          const range = (params.from && params.to ? { from: params.from, to: params.to } : periodFilter(fy).toParams!("this_fy")) as { from: string; to: string }
          const r = await api.get<{ broughtForwardPaise: number; closingPaise: number; debitPaise: number; creditPaise: number; data: Row[] }>(`/finance/ledgers/statement?key=${encodeURIComponent(key)}&from=${range.from}&to=${range.to}`)
          const q = (params.q ?? "").toLowerCase()
          const all = [...r.data].reverse().filter((x) => !q || `${x.number ?? ""} ${x.party ?? ""} ${x.narration}`.toLowerCase().includes(q))
          const start = Number(cursor ?? 0)
          return { ...r, data: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, total: all.length }
        }}
        header={{ title: "Entries", description: pl ? "Income and expense ledgers start each period at nothing." : "Newest first, with the balance after each entry." }}
        filters={[periodFilter(fy, "Period")]}
        summary={(r) => (
          <span className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
            {!pl && <span>Brought forward <strong className="text-foreground tabular-nums">{formatPaise(Number(r.broughtForwardPaise ?? 0))}</strong></span>}
            <span>Debit <strong className="text-foreground tabular-nums">{formatPaise(Number(r.debitPaise ?? 0))}</strong></span>
            <span>Credit <strong className="text-foreground tabular-nums">{formatPaise(Number(r.creditPaise ?? 0))}</strong></span>
            <span>Closing <strong className="text-foreground tabular-nums">{formatPaise(Number(r.closingPaise ?? 0))}</strong></span>
          </span>
        )}
        columns={[
          { key: "date", header: "Date", hideable: false, csv: (r) => r.date.slice(0, 10), cell: (r) => formatDate(r.date) },
          { key: "type", header: "Entry", csv: (r) => TYPE[r.type] ?? r.type, cell: (r) => <span className="grid gap-0.5"><span className="font-medium">{TYPE[r.type] ?? r.type}</span>{r.number && <span className="font-mono text-xs text-muted-foreground">{r.number}</span>}</span> },
          { key: "narration", header: "Details", csv: (r) => [r.party, r.narration].filter(Boolean).join(" · "), cell: (r) => <span>{r.party && <span className="block">{r.party}</span>}<span className="text-xs text-muted-foreground">{r.narration}</span></span> },
          { key: "dr", header: "Debit", align: "right", csv: (r) => r.debitPaise / 100, cell: (r) => (r.debitPaise ? <span className="tabular-nums">{formatPaise(r.debitPaise)}</span> : "") },
          { key: "cr", header: "Credit", align: "right", csv: (r) => r.creditPaise / 100, cell: (r) => (r.creditPaise ? <span className="tabular-nums">{formatPaise(r.creditPaise)}</span> : "") },
          { key: "balance", header: "Balance", align: "right", csv: (r) => r.balancePaise / 100, cell: (r) => <span className={cn("font-semibold tabular-nums", r.balancePaise < 0 && "text-destructive")}>{formatPaise(r.balancePaise)}</span> },
        ]}
        searchPlaceholder="Search number, name or details"
        rowClick={(r) => { if (r.href) router.push(r.href) }}
        exportName={`ledger-${l.name.toLowerCase().replace(/\W+/g, "-")}`}
        emptyState={<EmptyState icon={BookOpen} title="No entries in this period" description="Pick another period from Filters." />}
      />
      {adding && <JournalDialog preset={{ ledgerKey: key }} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setVersion((v) => v + 1); void ledgers.reload() }} />}
    </div>
  )
}
