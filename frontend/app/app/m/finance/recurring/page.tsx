"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, Pause, Pencil, Play, Plus, Repeat, SkipForward, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState, MoneyInput } from "@/components/common"
import { DataList, localList, type Column } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { ActionMenu, Pill } from "@/components/page-parts"
import { FinanceTabs } from "@/components/finance/sub-tabs"
import { RecurringDialog } from "@/components/finance/books"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { EVERY_LABEL, useFinAccounts, type Recurring } from "@/lib/finance"

// Repeating expenses: rent, salary, internet. Due ones are recorded with one click (the amount can change).

function status(r: Recurring) {
  if (!r.isActive) return <Pill color="slate" dot>Paused</Pill>
  if (r.ended) return <Pill color="slate" dot>Ended</Pill>
  if (r.isDue) return <Pill color="amber" dot>Due</Pill>
  return <Pill color="emerald" dot>Active</Pill>
}

export default function RecurringPage() {
  const { can } = useAuth()
  const accounts = useFinAccounts()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Recurring | "new" | null>(null)
  const [recording, setRecording] = React.useState<Recurring | null>(null)
  const [deleting, setDeleting] = React.useState<Recurring | null>(null)
  if (!can("finance.expense.view")) return <PageHeader title="Repeating expenses" description="You don't have access to finance. Ask your admin." />
  const reload = () => { setVersion((v) => v + 1); void accounts.reload() }

  async function act(r: Recurring, path: string, body: unknown, done: string) {
    try {
      await api.post(`/finance/recurring/${r.id}/${path}`, body)
      toast.success(done)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const columns: Column<Recurring>[] = [
    { key: "name", header: "Name", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span><span className="font-medium">{r.name}</span><span className="block text-xs text-muted-foreground">{r.category}{r.template.payee ? ` · ${r.template.payee}` : ""}</span></span> },
    { key: "every", header: "How often", csv: (r) => EVERY_LABEL[r.every], cell: (r) => EVERY_LABEL[r.every] },
    { key: "next", header: "Next due", sort: (r) => r.nextOn, csv: (r) => r.nextOn.slice(0, 10), cell: (r) => <span className={r.isDue ? "font-medium text-amber-700 dark:text-amber-300" : ""}>{formatDate(r.nextOn)}{r.endsOn && <span className="block text-xs text-muted-foreground">Ends {formatDate(r.endsOn)}</span>}</span> },
    { key: "account", header: "Paid from", csv: (r) => accounts.data?.data.find((a) => a.id === r.template.accountId)?.name ?? "", cell: (r) => accounts.data?.data.find((a) => a.id === r.template.accountId)?.name ?? "—" },
    { key: "status", header: "Status", csv: (r) => (r.isDue ? "Due" : r.isActive ? "Active" : "Paused"), cell: status },
    { key: "amount", header: "Amount", align: "right", sort: (r) => r.amountPaise, csv: (r) => r.amountPaise / 100, cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.amountPaise)}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {r.isDue && can("finance.expense.create") && <Button size="sm" onClick={() => setRecording(r)}><Check /> Record</Button>}
          {can("finance.expense.edit") && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil /></Button>}
          <ActionMenu label={`More actions for ${r.name}`} items={[
            r.isDue && can("finance.expense.create") && { label: "Skip this time", icon: SkipForward, onClick: () => void act(r, "run", { mode: "skip" }, `${r.name} skipped this time`) },
            can("finance.expense.edit") && (r.isActive ? { label: "Pause", icon: Pause, onClick: () => void act(r, "active", { isActive: false }, `${r.name} paused`) } : { label: "Resume", icon: Play, onClick: () => void act(r, "active", { isActive: true }, `${r.name} resumed`) }),
            r.lastExpenseId && { label: "Last expense", icon: Repeat, href: `/app/m/finance/expenses/${r.lastExpenseId}` },
            "-",
            can("finance.expense.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("finance.expense.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Repeating expense</Button> : undefined

  return (
    <>
      <FinanceTabs group="expenses" active="recurring" />
      <DataList<Recurring>
        id="fin-recurring"
        load={localList(async (p) => {
          const rows = (await api.get<{ data: Recurring[] }>("/finance/recurring")).data
          return p.show === "due" ? rows.filter((r) => r.isDue) : p.show === "paused" ? rows.filter((r) => !r.isActive || r.ended) : rows
        }, (r, q) => `${r.name} ${r.category} ${r.template.payee ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Repeating expenses", description: "Rent, salary, internet, EMIs. Nothing is posted on its own: when one falls due, record it with one click.", primary: add, more: [{ label: "All expenses", href: "/app/m/finance/expenses" }] }}
        columns={columns}
        searchPlaceholder="Search name, category or paid to"
        presetLabel="Show"
        presets={[{ key: "all", label: "All", params: {} }, { key: "due", label: "Due now", params: { show: "due" } }, { key: "paused", label: "Paused or ended", params: { show: "paused" } }]}
        rowClick={(r) => can("finance.expense.edit") && setEditing(r)}
        exportName="repeating-expenses"
        emptyState={<EmptyState icon={Repeat} title="Nothing repeating yet" description="Add rent or salary once; it reminds you each month." action={add} />}
      />
      {editing && <RecurringDialog recurring={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {recording && <RecordDialog r={recording} onClose={() => setRecording(null)} onDone={() => { setRecording(null); reload() }} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title={`Delete ${deleting?.name}?`}
        description="Expenses already recorded from it stay."
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/finance/recurring/${deleting!.id}`)
            toast.success("Deleted")
            reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}

/** Record one that is due: the amount can differ this time (a salary with overtime, a bigger bill) */
function RecordDialog({ r, onClose, onDone }: { r: Recurring; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = React.useState<number | null>(r.amountPaise)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || amount <= 0) return setError("Enter the amount paid")
    setBusy(true)
    try {
      const res = await api.post<{ expense: { number: string } }>(`/finance/recurring/${r.id}/run`, { mode: "record", amountPaise: amount })
      toast.success(`${res.expense.number} recorded`)
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record {r.name}</DialogTitle>
          <DialogDescription>Due {formatDate(r.nextOn)} · {r.category}. The next one moves to the following date.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Amount paid" required hint={amount !== r.amountPaise ? `Usually ${formatPaise(r.amountPaise)}` : undefined}><MoneyInput value={amount} autoFocus onChange={(v) => { setAmount(v); setError(null) }} aria-label="Amount paid" /></Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Recording…" : "Record expense"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
