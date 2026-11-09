"use client"

import * as React from "react"
import { toast } from "sonner"
import { Plus, Trash2, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog, EmptyState, MoneyInput } from "@/components/common"
import { DataList, periodFilter, type Column } from "@/components/data-list"
import { Field, FormError, NativeSelect } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHODS } from "@/lib/money"

interface Expense {
  id: string
  category: string
  amountPaise: number
  paidOn: string
  method: string
  payee: string | null
  notes: string | null
  receiptUrl: string | null
  version: number
}

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

function ExpenseDialog({ expense, categories, onClose, onSaved }: { expense?: Expense; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = React.useState({
    category: expense?.category ?? "",
    amountPaise: expense?.amountPaise ?? (null as number | null),
    paidOn: expense?.paidOn.slice(0, 10) ?? todayIST(),
    method: expense?.method ?? "cash",
    payee: expense?.payee ?? "",
    notes: expense?.notes ?? "",
    receiptUrl: expense?.receiptUrl ?? "",
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form.amountPaise) return setErrors({ amountPaise: "Enter an amount" })
    setBusy(true)
    setError(null)
    const body = { ...form, payee: form.payee || null, notes: form.notes || null, receiptUrl: form.receiptUrl || null }
    try {
      if (expense) await api.patch(`/expenses/${expense.id}`, { ...body, version: expense.version })
      else await api.post("/expenses", body)
      toast.success(expense ? "Saved" : "Expense added")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{expense ? "Edit expense" : "Add expense"}</DialogTitle>
          <DialogDescription>Expenses feed your dashboard and, with the paid Finance module, your ledgers.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" error={errors.amountPaise}><MoneyInput value={form.amountPaise} onChange={(v) => set("amountPaise", v)} autoFocus /></Field>
            <Field label="Date" error={errors.paidOn}><Input type="date" value={form.paidOn} max={todayIST()} onChange={(e) => set("paidOn", e.target.value)} /></Field>
            <Field label="Category" error={errors.category}>
              <Input value={form.category} onChange={(e) => set("category", e.target.value)} list="expense-categories" required />
            </Field>
            <Field label="Paid by">
              <NativeSelect value={form.method} onChange={(e) => set("method", e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Paid to"><Input value={form.payee} onChange={(e) => set("payee", e.target.value)} /></Field>
            <Field label="Receipt link" error={errors.receiptUrl} hint="Photo upload arrives with file storage"><Input type="url" value={form.receiptUrl} onChange={(e) => set("receiptUrl", e.target.value)} placeholder="https://" /></Field>
          </div>
          <datalist id="expense-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <Field label="Notes"><Input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Saving…" : expense ? "Save" : "Add expense"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function ExpensesPage() {
  const { can, me } = useAuth()
  const categories = useApi<{ data: string[] }>("/expense-categories").data?.data ?? []
  const [editing, setEditing] = React.useState<Expense | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<Expense | null>(null)
  const [version, setVersion] = React.useState(0)
  const refresh = () => setVersion((v) => v + 1)
  const add = can("finance.expense.create") ? <Button onClick={() => setEditing("new")}><Plus /> Add expense</Button> : undefined
  const columns: Column<Expense>[] = [
    { key: "date", header: "Date", hideable: false, sort: (e) => e.paidOn, csv: (e) => e.paidOn.slice(0, 10), cell: (e) => <span className="text-muted-foreground">{formatDate(e.paidOn)}</span> },
    { key: "category", header: "Category", sort: (e) => e.category, csv: (e) => e.category, cell: (e) => <span className="font-medium">{e.category}{e.notes && <span className="block text-xs font-normal text-muted-foreground">{e.notes}</span>}</span> },
    { key: "payee", header: "Paid to", csv: (e) => e.payee ?? "", cell: (e) => e.payee ?? "—" },
    { key: "method", header: "Method", csv: (e) => e.method, cell: (e) => PAYMENT_METHODS.find((m) => m.value === e.method)?.label },
    { key: "amount", header: "Amount", align: "right", sort: (e) => e.amountPaise, csv: (e) => e.amountPaise / 100, cell: (e) => <span className="font-medium">{formatPaise(e.amountPaise)}</span> },
    ...(can("finance.expense.delete") ? [{ key: "actions", header: "Actions", hideable: false, cell: (e: Expense) => <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="Delete expense" onClick={(ev) => { ev.stopPropagation(); setDeleting(e) }}><Trash2 /></Button> }] : []),
  ]

  return (
    <>
      <DataList<Expense>
        id="expenses"
        path="/expenses"
        params={{ v: String(version) }}
        header={{ title: "Expenses", description: "Record what you spend. Ledgers, P&L and GST reports come with the Finance module.", primary: add }}
        columns={columns}
        searchPlaceholder="Search payee or notes"
        filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4), { key: "category", label: "Category", options: categories.map((c) => ({ value: c, label: c })) }]}
        defaultFilters={{ period: "this_month" }}
        rowClick={can("finance.expense.edit") ? setEditing : undefined}
        exportName="expenses"
        summary={(r) => <span className="text-sm text-muted-foreground">Total <strong className="text-foreground tabular-nums">{formatPaise(Number(r.totalPaise ?? 0))}</strong></span>}
        emptyState={<EmptyState icon={Wallet} title="No expenses yet" description="Add rent, supplies, salaries and other spending to see your real profit." action={add} />}
      />
      {editing && <ExpenseDialog expense={editing === "new" ? undefined : editing} categories={categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title="Delete this expense?"
        description={deleting ? `${deleting.category} · ${formatPaise(deleting.amountPaise)}` : undefined}
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/expenses/${deleting!.id}`)
            toast.success("Deleted")
            refresh()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
