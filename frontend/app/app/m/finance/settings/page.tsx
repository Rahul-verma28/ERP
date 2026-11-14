"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, Pencil, Plus, Target, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, MoneyInput } from "@/components/common"
import { ErrorState, PageLoading } from "@/components/page-states"
import { Section } from "@/components/page-parts"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"

// Finance setup: the categories expenses and other income are filed under. Accounts live on Cash & Bank.

interface Category { id: string; name: string; kind: "expense" | "income"; budgetPaise: number | null }

function Categories({ kind }: { kind: "expense" | "income" }) {
  const { can } = useAuth()
  const { data, error, reload } = useSharedApi<{ data: Category[] }>(`/finance/categories?kind=${kind}`)
  const [adding, setAdding] = React.useState("")
  const [renaming, setRenaming] = React.useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = React.useState<Category | null>(null)
  const [budget, setBudget] = React.useState<{ id: string; value: number | null } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const title = kind === "expense" ? "Expense categories" : "Income categories"

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await work()
      toast.success(done)
      await reload()
      return true
    } catch (e) {
      toast.error(errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  async function add(e: React.FormEvent) {
    e.preventDefault()
    const name = adding.trim()
    if (name.length < 2) return toast.error("Use at least 2 characters")
    if (await run(() => api.post("/finance/categories", { kind, name }), `${name} added`)) setAdding("")
  }
  async function rename() {
    if (!renaming) return
    const name = renaming.name.trim()
    if (name.length < 2) return toast.error("Use at least 2 characters")
    if (await run(() => api.patch(`/finance/categories/${renaming.id}`, { name }), "Renamed on every entry too")) setRenaming(null)
  }

  async function saveBudget() {
    if (!budget) return
    if (await run(() => api.patch(`/finance/categories/${budget.id}`, { budgetPaise: budget.value || null }), budget.value ? "Budget saved" : "Budget removed")) setBudget(null)
  }

  return (
    <Section title={title} description={kind === "expense" ? "Rent, salaries, electricity… Set a monthly budget to see spending against it. Renaming one renames it on every expense." : "Interest, rent received, scrap sale…"} flush>
      {error ? <div className="p-4"><ErrorState error={error} onRetry={() => void reload()} /></div> : !data ? <PageLoading /> : (
        <>
          <ul className="divide-y">
            {data.data.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-5 py-2">
                {renaming?.id === c.id ? (
                  <form className="flex flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); void rename() }}>
                    <Input autoFocus aria-label="New name" maxLength={60} value={renaming.name} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} />
                    <Button type="submit" size="icon-sm" disabled={busy} aria-label="Save name"><Check /></Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel" onClick={() => setRenaming(null)}><X /></Button>
                  </form>
                ) : budget?.id === c.id ? (
                  <form className="flex flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); void saveBudget() }}>
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="ml-auto w-40"><MoneyInput value={budget.value} autoFocus onChange={(v) => setBudget({ id: c.id, value: v })} aria-label={`Monthly budget for ${c.name}`} /></span>
                    <span className="text-xs text-muted-foreground">/ month</span>
                    <Button type="submit" size="icon-sm" disabled={busy} aria-label="Save budget"><Check /></Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel" onClick={() => setBudget(null)}><X /></Button>
                  </form>
                ) : (
                  <>
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="flex items-center gap-0.5">
                      {kind === "expense" && can("finance.expense.edit") && <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" title="Monthly budget" onClick={() => setBudget({ id: c.id, value: c.budgetPaise })}><Target />{c.budgetPaise ? `${formatPaise(c.budgetPaise)}/mo` : "Budget"}</Button>}
                      {can("finance.expense.edit") && <Button variant="ghost" size="icon-sm" title="Rename" aria-label={`Rename ${c.name}`} onClick={() => setRenaming({ id: c.id, name: c.name })}><Pencil /></Button>}
                      {can("finance.expense.delete") && <Button variant="ghost" size="icon-sm" title="Delete" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Trash2 /></Button>}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
          {can("finance.expense.create") && (
            <form onSubmit={add} className="flex gap-2 border-t p-4">
              <Input placeholder={kind === "expense" ? "New category, e.g. Packing material" : "New category, e.g. Commission"} aria-label={`New ${kind} category`} maxLength={60} value={adding} onChange={(e) => setAdding(e.target.value)} />
              <Button type="submit" variant="outline" disabled={busy || !adding.trim()}><Plus /> Add</Button>
            </form>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title={`Delete ${deleting?.name}?`}
        description="Only a category no entry uses can be deleted. If entries use it, rename it instead."
        confirmLabel="Delete category"
        onConfirm={async () => { await run(() => api.delete(`/finance/categories/${deleting!.id}`), "Category deleted") }}
      />
    </Section>
  )
}

export default function FinanceSettingsPage() {
  const { can } = useAuth()
  if (!can("finance.expense.view")) return <PageHeader title="Finance setup" description="You don't have access to finance. Ask your admin." />
  return (
    <div className="grid gap-5">
      <PageHeader title="Finance setup" description="Categories for expenses and other income. Cash and bank accounts are on Cash & Bank; number series are in Settings → Documents." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Categories kind="expense" />
        <Categories kind="income" />
      </div>
    </div>
  )
}
