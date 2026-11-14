"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRightLeft, BookOpen, CheckCheck, Pencil, Plus, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState, MoneyInput } from "@/components/common"
import { DataList, periodFilter } from "@/components/data-list"
import { PageError, PageLoading } from "@/components/page-states"
import { ActionMenu, BackLink, DetailHeader, Pill, StatGrid } from "@/components/page-parts"
import { AccountDialog, ExpenseDialog, IncomeDialog, TransferDialog } from "@/components/finance/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { KIND_ICON, KIND_LABEL, masked, useFinAccounts } from "@/lib/finance"
import { cn } from "@/lib/utils"

// One account's passbook: every rupee in and out, with the running balance, like a bank statement.

interface Row { id: string; date: string; kind: string; number: string | null; party: string | null; details: string | null; inPaise: number; outPaise: number; balancePaise: number; href: string | null; clearedOn: string | null }
const KIND: Record<string, { label: string; color: string }> = {
  opening: { label: "Opening balance", color: "slate" }, receipt: { label: "Payment received", color: "emerald" }, refund: { label: "Refund", color: "rose" },
  supplier_payment: { label: "Paid to supplier", color: "orange" }, expense: { label: "Expense", color: "rose" }, income: { label: "Other income", color: "emerald" },
  transfer_in: { label: "Transfer in", color: "blue" }, transfer_out: { label: "Transfer out", color: "blue" }, charges: { label: "Charges", color: "amber" }, journal: { label: "Journal", color: "violet" },
}

export default function AccountPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can, me } = useAuth()
  const accounts = useFinAccounts()
  const [version, setVersion] = React.useState(0)
  const [open, setOpen] = React.useState<"edit" | "expense" | "income" | "transfer" | null>(null)
  const [bank, setBank] = React.useState<number | null>(null)
  const [books, setBooks] = React.useState<{ clearedPaise: number; unclearedCount: number } | null>(null)
  if (accounts.error) return <PageError error={accounts.error} onRetry={() => void accounts.reload()} />
  if (!accounts.data) return <PageLoading />
  const a = accounts.data.data.find((x) => x.id === id)
  if (!a) return <PageError error={new Error("This account was not found.")} onRetry={() => router.push("/app/m/finance/accounts")} />
  const Icon = KIND_ICON[a.kind]
  const done = () => { setOpen(null); setVersion((v) => v + 1); void accounts.reload() }
  const write = can("finance.expense.create")
  const reconciles = a.kind !== "cash"
  async function mark(rows: Row[], cleared: boolean) {
    const ids = rows.filter((r) => r.kind !== "opening").map((r) => r.id)
    if (!ids.length) return
    try {
      await api.post(`/finance/accounts/${id}/reconcile`, { entryIds: ids, cleared })
      toast.success(`${ids.length} entr${ids.length === 1 ? "y" : "ies"} marked ${cleared ? "cleared" : "not cleared"}`)
      setVersion((v) => v + 1)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const diff = bank === null || !books ? null : bank - books.clearedPaise

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/finance/accounts">Cash & Bank</BackLink>
      <DetailHeader
        title={a.name}
        icon={Icon}
        pills={<>{a.isDefault && <Pill color="blue">Default</Pill>}<Pill color={a.isActive ? "emerald" : "slate"} dot>{a.isActive ? "Open" : "Closed"}</Pill></>}
        subtitle={[KIND_LABEL[a.kind], a.bankName, masked(a.accountNo), a.ifsc, a.upiId].filter(Boolean).join(" · ")}
        actions={<>
          {write && a.isActive && <Button variant="outline" onClick={() => setOpen("transfer")}><ArrowRightLeft /> Move money</Button>}
          {write && a.isActive && <Button onClick={() => setOpen("expense")}><Plus /> Add expense</Button>}
          <ActionMenu items={[
            can("finance.expense.edit") && { label: "Edit account", icon: Pencil, onClick: () => setOpen("edit") },
            write && a.isActive && { label: "Other income into this", icon: TrendingUp, onClick: () => setOpen("income") },
          ]} />
        </>}
      />
      <StatGrid items={[
        { label: "Balance today", value: formatPaise(a.balancePaise), accent: a.balancePaise < 0 ? "text-destructive" : undefined },
        { label: "In this month", value: formatPaise(a.inThisMonthPaise), accent: "text-emerald-700 dark:text-emerald-300" },
        { label: "Out this month", value: formatPaise(a.outThisMonthPaise), accent: "text-rose-700 dark:text-rose-300" },
        { label: "Opening balance", value: formatPaise(a.openingPaise), hint: a.openingDate ? `As on ${formatDate(a.openingDate)}` : "Not set" },
      ]} />
      {a.takesUnassigned && <p className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">UPI, card and bank payments recorded without an account land here.</p>}
      {reconciles && can("finance.expense.edit") && (
        <section className="ui-surface grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div>
            <h2 className="flex items-center gap-2 font-semibold"><CheckCheck className="size-4" /> Match with the bank statement</h2>
            <p className="text-xs text-muted-foreground">Tick the entries you see on the statement (select rows, then “Mark cleared”). Cleared balance should equal the bank&apos;s balance.</p>
          </div>
          <label className="grid gap-1 text-xs text-muted-foreground">Balance as per bank<MoneyInput value={bank} onChange={setBank} aria-label="Balance as per bank statement" /></label>
          <div className="grid gap-0.5 text-sm"><span className="text-xs text-muted-foreground">Cleared in books</span><strong className="tabular-nums">{books ? formatPaise(books.clearedPaise) : "—"}</strong>{books && <span className="text-xs text-muted-foreground">{books.unclearedCount} not cleared</span>}</div>
          <div className="grid gap-0.5 text-sm"><span className="text-xs text-muted-foreground">Difference</span><strong className={cn("tabular-nums", diff === 0 ? "text-emerald-700 dark:text-emerald-300" : diff !== null && "text-destructive")}>{diff === null ? "Enter the bank balance" : diff === 0 ? "Matched" : formatPaise(diff)}</strong></div>
        </section>
      )}
      <DataList<Row>
        id="fin-statement"
        params={{ v: String(version) }}
        load={async ({ params, limit, cursor }) => {
          const qs = new URLSearchParams(Object.entries({ from: params.from, to: params.to }).filter(([, v]) => v) as [string, string][]).toString()
          const r = await api.get<{ broughtForwardPaise: number; closingPaise: number; inPaise: number; outPaise: number; clearedPaise: number; unclearedCount: number; data: Row[] }>(`/finance/accounts/${id}/statement${qs ? `?${qs}` : ""}`)
          setBooks({ clearedPaise: r.clearedPaise, unclearedCount: r.unclearedCount })
          const q = (params.q ?? "").toLowerCase()
          const all = [...r.data].reverse().filter((x) => params.show !== "open" || (!x.clearedOn && x.kind !== "opening")).filter((x) => params.show !== "cleared" || !!x.clearedOn).filter((x) => !q || `${x.number ?? ""} ${x.party ?? ""} ${x.details ?? ""}`.toLowerCase().includes(q))
          const start = Number(cursor ?? 0)
          return { ...r, data: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, total: all.length }
        }}
        header={{ title: "Passbook", description: "Newest first, with the balance after each entry." }}
        filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
        presetLabel={reconciles ? "Show" : undefined}
        presets={reconciles ? [{ key: "all", label: "All", params: {} }, { key: "open", label: "Not cleared", params: { show: "open" } }, { key: "cleared", label: "Cleared", params: { show: "cleared" } }] : undefined}
        bulkActions={reconciles && can("finance.expense.edit") ? [{ label: "Mark cleared", run: (rows) => mark(rows, true) }, { label: "Mark not cleared", run: (rows) => mark(rows, false) }] : undefined}
        summary={(r) => <span className="flex flex-wrap gap-x-4 text-sm text-muted-foreground"><span>Brought forward <strong className="text-foreground tabular-nums">{formatPaise(Number(r.broughtForwardPaise ?? 0))}</strong></span><span>In <strong className="text-emerald-700 tabular-nums dark:text-emerald-300">{formatPaise(Number(r.inPaise ?? 0))}</strong></span><span>Out <strong className="text-rose-700 tabular-nums dark:text-rose-300">{formatPaise(Number(r.outPaise ?? 0))}</strong></span><span>Closing <strong className="text-foreground tabular-nums">{formatPaise(Number(r.closingPaise ?? 0))}</strong></span></span>}
        columns={[
          { key: "date", header: "Date", hideable: false, csv: (r) => r.date.slice(0, 10), cell: (r) => formatDate(r.date) },
          { key: "kind", header: "Entry", csv: (r) => KIND[r.kind]?.label ?? r.kind, cell: (r) => <span className="grid gap-0.5"><Pill color={KIND[r.kind]?.color}>{KIND[r.kind]?.label ?? r.kind}</Pill>{r.number && <span className="font-mono text-xs text-muted-foreground">{r.number}</span>}</span> },
          { key: "party", header: "With", csv: (r) => r.party ?? "", cell: (r) => <span>{r.party ?? "—"}{r.details && <span className="block text-xs text-muted-foreground">{r.details}</span>}</span> },
          { key: "in", header: "In", align: "right", csv: (r) => r.inPaise / 100, cell: (r) => (r.inPaise ? <span className="text-emerald-700 tabular-nums dark:text-emerald-300">{formatPaise(r.inPaise)}</span> : "") },
          { key: "out", header: "Out", align: "right", csv: (r) => r.outPaise / 100, cell: (r) => (r.outPaise ? <span className="text-rose-700 tabular-nums dark:text-rose-300">{formatPaise(r.outPaise)}</span> : "") },
          ...(reconciles ? [{ key: "cleared", header: "Bank", csv: (r: Row) => r.clearedOn?.slice(0, 10) ?? "", cell: (r: Row) => (r.kind === "opening" ? "" : r.clearedOn ? <Pill color="emerald" dot>Cleared {formatDate(r.clearedOn)}</Pill> : <Pill color="slate">Not cleared</Pill>) }] : []),
          { key: "balance", header: "Balance", align: "right", csv: (r) => r.balancePaise / 100, cell: (r) => <span className={cn("font-semibold tabular-nums", r.balancePaise < 0 && "text-destructive")}>{formatPaise(r.balancePaise)}</span> },
        ]}
        searchPlaceholder="Search number, name or details"
        rowClick={(r) => { if (r.href) router.push(r.href) }}
        exportName={`passbook-${a.name.toLowerCase().replace(/\W+/g, "-")}`}
        emptyState={<EmptyState icon={BookOpen} title="No entries yet" description="Payments, expenses and transfers through this account show here." />}
      />
      {open === "edit" && <AccountDialog account={a} onClose={() => setOpen(null)} onSaved={done} />}
      {open === "expense" && <ExpenseDialog copyOf={{ accountId: a.id } as never} onClose={() => setOpen(null)} onSaved={done} />}
      {open === "income" && <IncomeDialog income={null} onClose={() => setOpen(null)} onSaved={done} />}
      {open === "transfer" && <TransferDialog from={a.id} onClose={() => setOpen(null)} onSaved={done} />}
    </div>
  )
}
