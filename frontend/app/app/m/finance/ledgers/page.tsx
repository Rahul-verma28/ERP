"use client"

import * as React from "react"
import { toast } from "sonner"
import { Archive, ArchiveRestore, BookOpen, FilePlus2, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column } from "@/components/data-list"
import { ActionMenu, Pill } from "@/components/page-parts"
import { FinanceTabs } from "@/components/finance/sub-tabs"
import { JournalDialog, LedgerDialog } from "@/components/finance/books"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { GROUP_LABEL, GROUP_TONE, ledgerHref, useLedgers, type Ledger, type LedgerGroup } from "@/lib/finance"
import { cn } from "@/lib/utils"

/** A row of the list: keyed by ledger key; ledgerId is set only on ledgers you added */
type Row = Omit<Ledger, "id"> & { id: string; ledgerId?: string }

// Chart of accounts: every ledger the books use. Most are made for you (each cash and bank account,
// customers, suppliers, GST, sales, purchases, each expense category); add your own for loans,
// capital, vehicles and the like.

const PRESETS: { key: string; label: string; params: Record<string, string> }[] = [
  { key: "all", label: "All", params: {} },
  ...(Object.keys(GROUP_LABEL) as LedgerGroup[]).map((g) => ({ key: g, label: g === "equity" ? "Capital" : `${GROUP_LABEL[g]}s`, params: { group: g } })),
]

export default function LedgersPage() {
  const { can } = useAuth()
  const shared = useLedgers()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Row | "new" | null>(null)
  const [journalFor, setJournalFor] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState<Row | null>(null)
  if (!can("finance.expense.view")) return <PageHeader title="Chart of accounts" description="You don't have access to finance. Ask your admin." />
  const reload = () => { setVersion((v) => v + 1); void shared.reload() }

  async function toggle(l: Row) {
    try {
      await api.patch(`/finance/ledgers/${l.ledgerId}`, { isActive: !l.isActive, version: l.version })
      toast.success(l.isActive ? `${l.name} closed` : `${l.name} reopened`)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const columns: Column<Row>[] = [
    { key: "code", header: "Code", sort: (l) => l.code, csv: (l) => l.code, cell: (l) => <span className="font-mono text-xs text-muted-foreground">{l.code}</span> },
    { key: "name", header: "Ledger", hideable: false, sort: (l) => l.name, csv: (l) => l.name, cell: (l) => <span><span className="font-medium">{l.name}</span>{!l.isActive && <Pill color="slate" className="ml-2">Closed</Pill>}{l.description && <span className="block max-w-72 truncate text-xs text-muted-foreground">{l.description}</span>}</span> },
    { key: "group", header: "Kind", sort: (l) => l.group, csv: (l) => GROUP_LABEL[l.group], cell: (l) => <Pill color={GROUP_TONE[l.group]}>{GROUP_LABEL[l.group]}</Pill> },
    { key: "section", header: "Group", sort: (l) => l.section, csv: (l) => l.section, cell: (l) => <span className="text-muted-foreground">{l.section}</span> },
    { key: "made", header: "Made by", csv: (l) => (l.ledgerId ? "You" : "App"), cell: (l) => <span className="text-xs text-muted-foreground">{l.ledgerId ? "You" : "App"}</span>, defaultHidden: true },
    { key: "balance", header: "Balance", align: "right", sort: (l) => l.balancePaise, csv: (l) => l.balancePaise / 100, cell: (l) => <span className={cn("font-semibold tabular-nums", l.balancePaise < 0 && "text-destructive", !l.balancePaise && "font-normal text-muted-foreground")}>{formatPaise(l.balancePaise)}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (l) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {l.ledgerId && can("finance.expense.edit") && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${l.name}`} onClick={() => setEditing(l)}><Pencil /></Button>}
          <ActionMenu label={`More actions for ${l.name}`} items={[
            { label: "Open ledger", icon: BookOpen, href: ledgerHref(l.key) },
            l.journal && can("finance.expense.create") && { label: "Journal entry with this", icon: FilePlus2, onClick: () => setJournalFor(l.key) },
            "-",
            !!l.ledgerId && can("finance.expense.edit") && { label: l.isActive ? "Close ledger" : "Reopen", icon: l.isActive ? Archive : ArchiveRestore, onClick: () => void toggle(l) },
            !!l.ledgerId && !l.usedInJournals && can("finance.expense.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(l) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("finance.expense.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Add ledger</Button> : undefined

  return (
    <>
      <FinanceTabs group="accountant" active="ledgers" />
      <DataList<Row>
        id="fin-ledgers"
        load={localList(async (p) => {
          const rows = (await api.get<{ data: Ledger[] }>("/finance/ledgers")).data
          return rows.filter((l) => !p.group || l.group === p.group).map((l) => ({ ...l, id: l.key, ledgerId: l.id }))
        }, (l, q) => `${l.code} ${l.name} ${l.section}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{
          title: "Chart of accounts",
          description: "Every ledger in your books. Bills, payments and expenses post to these on their own; add ledgers for loans, capital, vehicles or deposits.",
          primary: add,
          actions: can("finance.expense.create") ? <Button variant="outline" className="h-10 rounded-xl" onClick={() => setJournalFor("")}><FilePlus2 /> Journal entry</Button> : undefined,
        }}
        columns={columns}
        searchPlaceholder="Search ledger, code or group"
        presetLabel="Show"
        presets={PRESETS}
        rowHref={(l) => ledgerHref(l.key)}
        exportName="chart-of-accounts"
        emptyState={<EmptyState icon={BookOpen} title="No ledgers here" action={add} />}
      />
      {editing && <LedgerDialog ledger={editing === "new" ? null : { ...editing, id: editing.ledgerId }} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {journalFor !== null && <JournalDialog preset={journalFor ? { ledgerKey: journalFor } : undefined} onClose={() => setJournalFor(null)} onSaved={() => { setJournalFor(null); reload() }} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title={`Delete ${deleting?.name}?`}
        description="Only a ledger no journal entry uses can be deleted."
        confirmLabel="Delete ledger"
        onConfirm={async () => {
          try {
            await api.delete(`/finance/ledgers/${deleting!.ledgerId}`)
            toast.success("Ledger deleted")
            reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
