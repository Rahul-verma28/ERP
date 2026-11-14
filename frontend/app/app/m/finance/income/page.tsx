"use client"

import * as React from "react"
import { toast } from "sonner"
import { Pencil, Plus, Trash2, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, periodFilter, type Column } from "@/components/data-list"
import { ActionMenu } from "@/components/page-parts"
import { FinanceTabs } from "@/components/finance/sub-tabs"
import { IncomeDialog } from "@/components/finance/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { useFinAccounts, type Income } from "@/lib/finance"

// Other income: money in that is not a sale, like interest, rent received or scrap sold.

export default function IncomePage() {
  const { can, me } = useAuth()
  const categories = useSharedApi<{ data: { id: string; name: string }[] }>("/finance/categories?kind=income")
  const accounts = useFinAccounts()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Income | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<Income | null>(null)
  if (!can("finance.expense.view")) return <PageHeader title="Other income" description="You don't have access to finance. Ask your admin." />
  const reload = () => { setVersion((v) => v + 1); void accounts.reload() }

  const columns: Column<Income>[] = [
    { key: "number", header: "Number", hideable: false, sort: (r) => r.number, csv: (r) => r.number, cell: (r) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.number}</span> },
    { key: "date", header: "Date", sort: (r) => r.receivedOn, csv: (r) => r.receivedOn.slice(0, 10), cell: (r) => formatDate(r.receivedOn) },
    { key: "category", header: "Category", sort: (r) => r.category, csv: (r) => r.category, cell: (r) => <span className="font-medium">{r.category}</span> },
    { key: "payer", header: "Received from", csv: (r) => r.payer ?? "", cell: (r) => <span>{r.payer ?? "—"}{r.notes && <span className="block max-w-56 truncate text-xs text-muted-foreground">{r.notes}</span>}</span> },
    { key: "account", header: "Received in", csv: (r) => r.account ?? "", cell: (r) => r.account ?? "—" },
    { key: "ref", header: "Reference", defaultHidden: true, csv: (r) => r.reference ?? "", cell: (r) => <span className="font-mono text-xs">{r.reference ?? "—"}</span> },
    { key: "amount", header: "Amount", align: "right", sort: (r) => r.amountPaise, csv: (r) => (r.amountPaise / 100).toFixed(2), cell: (r) => <span className="font-semibold text-emerald-700 tabular-nums dark:text-emerald-300">{formatPaise(r.amountPaise)}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {can("finance.expense.edit") && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${r.number}`} onClick={() => setEditing(r)}><Pencil /></Button>}
          <ActionMenu label={`More actions for ${r.number}`} items={[
            can("finance.expense.edit") && { label: "Edit", icon: Pencil, onClick: () => setEditing(r) },
            "-",
            can("finance.expense.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("finance.expense.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Add income</Button> : undefined

  return (
    <>
      <FinanceTabs group="expenses" active="income" />
      <DataList<Income>
        id="incomes"
        load={localList(async (p) => {
          const qs = new URLSearchParams(Object.entries({ from: p.from, to: p.to, category: p.category, accountId: p.accountId }).filter(([, v]) => v) as [string, string][]).toString()
          return (await api.get<{ data: Income[] }>(`/incomes${qs ? `?${qs}` : ""}`)).data
        }, (r, q) => `${r.number} ${r.payer ?? ""} ${r.category} ${r.reference ?? ""} ${r.notes ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{
          title: "Other income",
          description: "Money in that is not a sale — bank interest, rent received, scrap sold, commission. It adds to profit.",
          primary: add,
          more: [{ label: "Income categories", href: "/app/m/finance/settings" }, { label: "Profit & loss", href: "/app/m/finance/reports" }],
        }}
        columns={columns}
        searchPlaceholder="Search number, received from or note"
        filters={[
          periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period"),
          { key: "category", label: "Category", options: (categories.data?.data ?? []).map((c) => ({ value: c.name, label: c.name })) },
          { key: "accountId", label: "Received in", options: (accounts.data?.data ?? []).map((a) => ({ value: a.id, label: a.name })) },
        ]}
        summary={(r) => { const rows = (r.data as Income[] | undefined) ?? []; return rows.length ? <span className="text-sm text-muted-foreground">This page <strong className="text-foreground tabular-nums">{formatPaise(rows.reduce((s, i) => s + i.amountPaise, 0))}</strong></span> : null }}
        rowClick={(r) => can("finance.expense.edit") && setEditing(r)}
        exportName="other-income"
        emptyState={<EmptyState icon={TrendingUp} title="No other income yet" description="Bank interest, rent received or scrap sold go here." action={add} />}
      />
      {editing && <IncomeDialog income={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title={`Delete ${deleting?.number ?? "this income"}?`}
        description="It comes off the account it was received in and out of profit."
        confirmLabel="Delete income"
        onConfirm={async () => {
          try {
            await api.delete(`/incomes/${deleting!.id}`)
            toast.success("Income deleted")
            reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
