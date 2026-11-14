"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Copy, Eye, FilePlus2, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, periodFilter, type Column } from "@/components/data-list"
import { ActionMenu } from "@/components/page-parts"
import { FinanceTabs } from "@/components/finance/sub-tabs"
import { JournalDialog } from "@/components/finance/books"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { useFinAccounts, useLedgers, type Journal } from "@/lib/finance"

// Journal entries: what no bill, payment or expense records — loans, capital, GST paid, depreciation.

export default function JournalsPage() {
  const router = useRouter()
  const { can, me } = useAuth()
  const ledgers = useLedgers()
  const accounts = useFinAccounts()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<{ journal?: Journal; copy?: Journal } | null>(null)
  const [deleting, setDeleting] = React.useState<Journal | null>(null)
  if (!can("finance.expense.view")) return <PageHeader title="Journal entries" description="You don't have access to finance. Ask your admin." />
  const reload = () => { setVersion((v) => v + 1); void ledgers.reload(); void accounts.reload() }

  const columns: Column<Journal>[] = [
    { key: "number", header: "Number", hideable: false, sort: (j) => j.number, csv: (j) => j.number, cell: (j) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{j.number}</span> },
    { key: "date", header: "Date", sort: (j) => j.journalOn, csv: (j) => j.journalOn.slice(0, 10), cell: (j) => formatDate(j.journalOn) },
    { key: "narration", header: "Narration", csv: (j) => j.narration, cell: (j) => <span><span className="font-medium">{j.narration}</span>{j.reference && <span className="block font-mono text-xs text-muted-foreground">{j.reference}</span>}</span> },
    {
      key: "lines", header: "Debit → Credit", csv: (j) => j.lines.map((l) => `${l.ledger} ${l.debitPaise ? "Dr" : "Cr"}`).join("; "),
      cell: (j) => {
        const dr = j.lines.filter((l) => l.debitPaise).map((l) => l.ledger)
        const cr = j.lines.filter((l) => l.creditPaise).map((l) => l.ledger)
        return <span className="grid text-xs"><span><span className="text-muted-foreground">Dr</span> {dr.join(", ")}</span><span><span className="text-muted-foreground">Cr</span> {cr.join(", ")}</span></span>
      },
    },
    { key: "amount", header: "Amount", align: "right", sort: (j) => j.totalPaise, csv: (j) => j.totalPaise / 100, cell: (j) => <span className="font-semibold tabular-nums">{formatPaise(j.totalPaise)}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (j) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {can("finance.expense.edit") && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${j.number}`} onClick={() => setEditing({ journal: j })}><Pencil /></Button>}
          <ActionMenu label={`More actions for ${j.number}`} items={[
            { label: "Open", icon: Eye, href: `/app/m/finance/journals/${j.id}` },
            can("finance.expense.create") && { label: "Copy as new", icon: Copy, onClick: () => setEditing({ copy: j }) },
            "-",
            can("finance.expense.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(j) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("finance.expense.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing({})}><Plus /> Journal entry</Button> : undefined

  return (
    <>
      <FinanceTabs group="accountant" active="journals" />
      <DataList<Journal>
        id="fin-journals"
        load={localList(async (p) => {
          const qs = new URLSearchParams(Object.entries({ from: p.from, to: p.to, ledgerKey: p.ledgerKey }).filter(([, v]) => v) as [string, string][]).toString()
          return (await api.get<{ data: Journal[] }>(`/finance/journals${qs ? `?${qs}` : ""}`)).data
        }, (j, q) => `${j.number} ${j.narration} ${j.reference ?? ""} ${j.lines.map((l) => l.ledger).join(" ")}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{
          title: "Journal entries",
          description: "For what no bill or payment records: a loan taken, money the owner put in or took out, GST paid, depreciation. Debits always equal credits.",
          primary: add,
        }}
        columns={columns}
        searchPlaceholder="Search number, narration or ledger"
        filters={[
          periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period"),
          { key: "ledgerKey", label: "Ledger", options: (ledgers.data?.data ?? []).filter((l) => l.journal).map((l) => ({ value: l.key, label: l.name })) },
        ]}
        rowHref={(j) => `/app/m/finance/journals/${j.id}`}
        exportName="journal-entries"
        emptyState={<EmptyState icon={FilePlus2} title="No journal entries yet" description="Took a loan or put in your own money? Record it here so the balance sheet is right." action={add} />}
      />
      {editing && <JournalDialog journal={editing.journal} copyOf={editing.copy} onClose={() => setEditing(null)} onSaved={(j) => { setEditing(null); reload(); if (!editing.journal) router.prefetch(`/app/m/finance/journals/${j.id}`) }} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title={`Delete ${deleting?.number ?? "this entry"}?`}
        description="Every ledger it touched goes back to how it was. The number is not used again."
        confirmLabel="Delete entry"
        onConfirm={async () => {
          try {
            await api.delete(`/finance/journals/${deleting!.id}`)
            toast.success("Journal entry deleted")
            reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
