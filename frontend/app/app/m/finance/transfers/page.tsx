"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowRight, ArrowRightLeft, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, periodFilter, type Column } from "@/components/data-list"
import { ActionMenu } from "@/components/page-parts"
import { FinanceTabs } from "@/components/finance/sub-tabs"
import { TransferDialog } from "@/components/finance/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { useFinAccounts, type Transfer } from "@/lib/finance"

// Money moved between your own accounts: cash deposited in bank, bank to UPI, card bill paid.

export default function TransfersPage() {
  const { can, me } = useAuth()
  const accounts = useFinAccounts()
  const [version, setVersion] = React.useState(0)
  const [adding, setAdding] = React.useState(false)
  const [deleting, setDeleting] = React.useState<Transfer | null>(null)
  if (!can("finance.expense.view")) return <PageHeader title="Transfers" description="You don't have access to finance. Ask your admin." />
  const reload = () => { setVersion((v) => v + 1); void accounts.reload() }

  const columns: Column<Transfer>[] = [
    { key: "number", header: "Number", hideable: false, sort: (r) => r.number, csv: (r) => r.number, cell: (r) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.number}</span> },
    { key: "date", header: "Date", sort: (r) => r.transferOn, csv: (r) => r.transferOn.slice(0, 10), cell: (r) => formatDate(r.transferOn) },
    {
      key: "route", header: "From → To", csv: (r) => `${r.fromAccount} → ${r.toAccount}`,
      cell: (r) => <span className="flex flex-wrap items-center gap-1.5 font-medium"><Link href={`/app/m/finance/accounts/${r.fromAccountId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{r.fromAccount}</Link><ArrowRight className="size-3.5 text-muted-foreground" /><Link href={`/app/m/finance/accounts/${r.toAccountId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{r.toAccount}</Link></span>,
    },
    { key: "ref", header: "Reference", csv: (r) => r.reference ?? "", cell: (r) => <span>{r.reference ? <span className="font-mono text-xs">{r.reference}</span> : "—"}{r.notes && <span className="block max-w-56 truncate text-xs text-muted-foreground">{r.notes}</span>}</span> },
    { key: "charges", header: "Charges", align: "right", csv: (r) => (r.chargesPaise / 100).toFixed(2), cell: (r) => (r.chargesPaise ? <span className="text-amber-700 tabular-nums dark:text-amber-300">{formatPaise(r.chargesPaise)}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "amount", header: "Amount", align: "right", sort: (r) => r.amountPaise, csv: (r) => (r.amountPaise / 100).toFixed(2), cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.amountPaise)}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <ActionMenu label={`More actions for ${r.number}`} items={[
            { label: `Open ${r.fromAccount}`, icon: ArrowRightLeft, href: `/app/m/finance/accounts/${r.fromAccountId}` },
            "-",
            can("finance.expense.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("finance.expense.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setAdding(true)}><Plus /> Move money</Button> : undefined

  return (
    <>
      <FinanceTabs group="cash" active="transfers" />
      <DataList<Transfer>
        id="fin-transfers"
        load={localList(async (p) => {
          const qs = new URLSearchParams(Object.entries({ from: p.from, to: p.to, accountId: p.accountId }).filter(([, v]) => v) as [string, string][]).toString()
          return (await api.get<{ data: Transfer[] }>(`/finance/transfers${qs ? `?${qs}` : ""}`)).data
        }, (r, q) => `${r.number} ${r.fromAccount} ${r.toAccount} ${r.reference ?? ""} ${r.notes ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Transfers", description: "Money moved between your own accounts — cash deposited in bank, bank to UPI, card bill paid. Not income, not an expense.", primary: add }}
        columns={columns}
        searchPlaceholder="Search number, account or reference"
        filters={[
          periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period"),
          { key: "accountId", label: "Account", options: (accounts.data?.data ?? []).map((a) => ({ value: a.id, label: a.name })) },
        ]}
        exportName="transfers"
        emptyState={<EmptyState icon={ArrowRightLeft} title="No transfers yet" description="Deposited cash in the bank? Record it here so both balances stay right." action={add} />}
      />
      {adding && <TransferDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title={`Delete ${deleting?.number ?? "this transfer"}?`}
        description="The money goes back to the account it came from, and any charges are removed."
        confirmLabel="Delete transfer"
        onConfirm={async () => {
          try {
            await api.delete(`/finance/transfers/${deleting!.id}`)
            toast.success("Transfer deleted")
            reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
