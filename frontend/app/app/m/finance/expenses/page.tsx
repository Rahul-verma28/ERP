"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import Link from "next/link"
import { AlarmClock, Banknote, CalendarDays, Copy, Eye, Landmark, PieChart, Pencil, Plus, Receipt, Repeat, Trash2, Wallet } from "lucide-react"
import { SummaryCards } from "@/components/summary-cards"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, periodFilter, type Column } from "@/components/data-list"
import { ActionMenu, Pill } from "@/components/page-parts"
import { FinanceTabs } from "@/components/finance/sub-tabs"
import { ExpenseDialog } from "@/components/finance/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { useFinAccounts, type Expense, type Recurring } from "@/lib/finance"

const vsLast = (now: number, before: number) => (before ? `${now >= before ? "▲" : "▼"} ${Math.abs(Math.round(((now - before) / before) * 100))}% vs last month (${formatPaise(before)})` : "Nothing last month")

// Expenses: money spent to run the business. GST bills are marked, so their GST can be claimed back.

export default function ExpensesPage() {
  const router = useRouter()
  const { can, me } = useAuth()
  const categories = useSharedApi<{ data: { id: string; name: string }[] }>("/finance/categories?kind=expense")
  const accounts = useFinAccounts()
  const recurring = useSharedApi<{ data: Recurring[]; due: number }>("/finance/recurring")
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<{ expense?: Expense; copy?: Expense } | null>(null)
  const [deleting, setDeleting] = React.useState<Expense | null>(null)
  if (!can("finance.expense.view")) return <PageHeader title="Expenses" description="You don't have access to expenses. Ask your admin." />
  const reload = () => { setVersion((v) => v + 1); void accounts.reload(); void recurring.reload() }

  const columns: Column<Expense>[] = [
    { key: "number", header: "Expense no.", hideable: false, sort: (r) => r.number ?? "", csv: (r) => r.number ?? "", cell: (r) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.number ?? "—"}</span> },
    { key: "date", header: "Date", sort: (r) => r.paidOn, csv: (r) => r.paidOn.slice(0, 10), cell: (r) => formatDate(r.paidOn) },
    { key: "category", header: "Category", sort: (r) => r.category, csv: (r) => r.category, cell: (r) => <span className="font-medium">{r.category}</span> },
    { key: "payee", header: "Paid to", csv: (r) => r.payee ?? "", cell: (r) => <span>{r.payee ?? "—"}{(r.vendorGstin || r.notes) && <span className="block max-w-56 truncate text-xs text-muted-foreground">{r.vendorGstin ? <span className="font-mono">{r.vendorGstin}</span> : r.notes}</span>}</span> },
    { key: "account", header: "Paid from", csv: (r) => r.account ?? "", cell: (r) => (r.account ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{r.accountKind === "cash" ? <Banknote className="size-3.5" /> : <Landmark className="size-3.5" />}{r.account}</span> : "—") },
    { key: "method", header: "Paid by", defaultHidden: true, csv: (r) => r.method, cell: (r) => <span className="capitalize">{r.method}</span> },
    { key: "gst", header: "GST bill", csv: (r) => (r.gstPaise ? (r.gstPaise / 100).toFixed(2) : ""), cell: (r) => (r.gstPaise ? <span className="grid gap-0.5"><Pill color="blue">{(r.gstRateBp ?? 0) / 100}% GST</Pill><span className="text-xs text-muted-foreground tabular-nums">{formatPaise(r.gstPaise)} to claim</span></span> : <span className="text-muted-foreground">—</span>) },
    { key: "photo", header: "Bill photo", defaultHidden: true, csv: (r) => (r.receiptUrl ? "Yes" : ""), cell: (r) => (r.receiptUrl ? <a href={r.receiptUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-sm font-medium text-primary hover:underline">Open</a> : <span className="text-muted-foreground">—</span>) },
    { key: "createdBy", header: "Entered by", defaultHidden: true, csv: (r) => r.createdByName ?? "", cell: (r) => <span className="text-sm">{r.createdByName ?? "—"}<span className="block text-[11px] text-muted-foreground">{formatDate(r.createdAt)}</span></span> },
    { key: "ref", header: "Reference", defaultHidden: true, csv: (r) => r.reference ?? r.billNo ?? "", cell: (r) => <span className="font-mono text-xs">{r.billNo ?? r.reference ?? "—"}</span> },
    { key: "amount", header: "Amount", align: "right", sort: (r) => r.amountPaise, csv: (r) => (r.amountPaise / 100).toFixed(2), cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.amountPaise)}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {can("finance.expense.edit") && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${r.number ?? "expense"}`} onClick={() => setEditing({ expense: r })}><Pencil /></Button>}
          <ActionMenu label={`More actions for ${r.number ?? "expense"}`} items={[
            { label: "Open", icon: Eye, href: `/app/m/finance/expenses/${r.id}` },
            can("finance.expense.create") && { label: "Add another like this", icon: Copy, onClick: () => setEditing({ copy: r }) },
            r.receiptUrl && { label: "Open bill photo", icon: Receipt, onClick: () => window.open(r.receiptUrl!, "_blank", "noopener") },
            "-",
            can("finance.expense.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("finance.expense.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing({})}><Plus /> Add expense</Button> : undefined

  return (
    <>
      <FinanceTabs group="expenses" active="expenses" badge={{ recurring: recurring.data?.due }} />
      {!!recurring.data?.due && (
        <Link href="/app/m/finance/recurring" className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <span className="flex items-center gap-2"><Repeat className="size-4" /><strong>{recurring.data.due}</strong> repeating expense{recurring.data.due === 1 ? " is" : "s are"} due: {recurring.data.data.filter((r) => r.isDue).map((r) => r.name).slice(0, 3).join(", ")}</span>
          <span className="font-medium">Review and record →</span>
        </Link>
      )}
      <DataList<Expense>
        id="expenses"
        path="/expenses"
        params={{ v: String(version) }}
        header={{
          title: "Expenses",
          description: "Rent, salaries, bills and everything else spent to run the business. Mark GST bills to claim their GST back.",
          primary: add,
          more: [{ label: "Categories and budgets", href: "/app/m/finance/settings" }, { label: "Budget vs spent", href: "/app/m/finance/reports?tab=budget" }, { label: "Profit & loss", href: "/app/m/finance/reports" }],
        }}
        columns={columns}
        searchPlaceholder="Search number, paid to, bill no. or note"
        presetLabel="Show"
        presets={[{ key: "all", label: "All", params: {}, countKey: "all" }, { key: "gst", label: "With GST bill", params: { gst: "true" }, countKey: "gst" }, { key: "nogst", label: "Without GST bill", params: { gst: "false" }, countKey: "nogst" }]}
        tabs
        top={(res) => {
          const s = (res.sums ?? {}) as Record<string, number | string | null>
          const n = (k: string) => Number(s[k] ?? 0)
          const c = (res.counts ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Spent", value: formatPaise(n("total")), hint: `${c.all ?? 0} expenses as filtered`, color: "blue", icon: Wallet },
            { label: "This month", value: formatPaise(n("month")), hint: vsLast(n("month"), n("lastMonth")), color: "violet", icon: CalendarDays },
            { label: "GST to claim", value: formatPaise(n("gst")), hint: `${c.gst ?? 0} GST bills`, color: "emerald", icon: Receipt },
            { label: "Top category", value: (s.topCategory as string | null) ?? "—", hint: s.topCategory ? `${formatPaise(n("topCategoryPaise"))} of ${n("categories")} categories` : "No expenses yet", color: "amber", icon: PieChart },
            n("budget")
              ? { label: "Monthly budget", value: `${Math.round((n("month") / n("budget")) * 100)}% used`, hint: `${formatPaise(n("month"))} of ${formatPaise(n("budget"))}`, color: n("month") > n("budget") ? "rose" : "slate", icon: AlarmClock, href: "/app/m/finance/reports?tab=budget" }
              : { label: "Paid in cash", value: formatPaise(n("cash")), hint: "Set budgets in Finance settings", color: "slate", icon: Banknote, href: "/app/m/finance/settings" },
          ]} />
        }}
        filters={[
          periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period"),
          { key: "category", label: "Category", options: (categories.data?.data ?? []).map((c) => ({ value: c.name, label: c.name })) },
          { key: "accountId", label: "Paid from", options: (accounts.data?.data ?? []).map((a) => ({ value: a.id, label: a.name })) },
        ]}
        summary={(r) => <span className="flex flex-wrap gap-x-4 text-sm text-muted-foreground"><span>Total <strong className="text-foreground tabular-nums">{formatPaise(Number(r.totalPaise ?? 0))}</strong></span>{Number(r.gstPaise ?? 0) > 0 && <span>GST to claim <strong className="text-foreground tabular-nums">{formatPaise(Number(r.gstPaise))}</strong></span>}</span>}
        rowHref={(r) => `/app/m/finance/expenses/${r.id}`}
        exportName="expenses"
        emptyState={<EmptyState icon={Receipt} title="No expenses yet" description="Add rent, salaries and bills here so your profit is right." action={add} />}
      />
      {editing && <ExpenseDialog expense={editing.expense} copyOf={editing.copy} onClose={() => setEditing(null)} onSaved={(e) => { setEditing(null); reload(); if (!editing.expense) router.prefetch(`/app/m/finance/expenses/${e.id}`) }} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title={`Delete ${deleting?.number ?? "this expense"}?`}
        description="It comes off the account it was paid from and out of the reports. The number is not used again."
        confirmLabel="Delete expense"
        onConfirm={async () => {
          try {
            await api.delete(`/expenses/${deleting!.id}`)
            toast.success("Expense deleted")
            reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
