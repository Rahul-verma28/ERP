"use client"

import * as React from "react"
import { toast } from "sonner"
import { Archive, ArchiveRestore, ArrowRightLeft, BookOpen, Pencil, Plus, Star, Wallet, ArrowDownLeft, ArrowUpRight, Banknote, Landmark } from "lucide-react"
import { SummaryCards } from "@/components/summary-cards"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { DataList, countBy, localList, type Column } from "@/components/data-list"
import { ActionMenu, Pill } from "@/components/page-parts"
import { FinanceTabs } from "@/components/finance/sub-tabs"
import { AccountDialog, TransferDialog } from "@/components/finance/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { KIND_ICON, KIND_LABEL, KIND_TONE, masked, useFinAccounts, type FinAccount } from "@/lib/finance"
import { tone } from "@/lib/tones"
import { cn } from "@/lib/utils"

// Cash and bank accounts with their balances. Every payment, expense and transfer moves one.

export default function AccountsPage() {
  const { can } = useAuth()
  const shared = useFinAccounts()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<FinAccount | "new" | null>(null)
  const [moving, setMoving] = React.useState<string | null>(null)
  if (!can("finance.expense.view")) return <PageHeader title="Cash & Bank" description="You don't have access to finance. Ask your admin." />
  const reload = () => { setVersion((v) => v + 1); void shared.reload() }
  const edit = can("finance.expense.edit")

  async function act(a: FinAccount, patch: Record<string, unknown>, done: string) {
    try {
      await api.patch(`/finance/accounts/${a.id}`, { ...patch, version: a.version })
      toast.success(done)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const columns: Column<FinAccount>[] = [
    {
      key: "name", header: "Account", hideable: false, sort: (a) => a.name, csv: (a) => a.name,
      cell: (a) => {
        const Icon = KIND_ICON[a.kind]
        return <span className="flex items-center gap-2.5"><span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tone(KIND_TONE[a.kind]).pill)}><Icon className="size-4" /></span><span><span className="block font-medium">{a.name}{a.isDefault && <Pill color="blue" className="ml-2">Default</Pill>}</span><span className="text-xs text-muted-foreground">{KIND_LABEL[a.kind]}</span></span></span>
      },
    },
    { key: "bank", header: "Bank", csv: (a) => a.bankName ?? "", cell: (a) => (a.bankName ? <span>{a.bankName}<span className="block font-mono text-xs text-muted-foreground">{[masked(a.accountNo), a.ifsc].filter(Boolean).join(" · ")}</span></span> : "—") },
    { key: "in", header: "In this month", align: "right", csv: (a) => a.inThisMonthPaise / 100, cell: (a) => <span className="text-emerald-700 tabular-nums dark:text-emerald-300">{formatPaise(a.inThisMonthPaise)}</span> },
    { key: "out", header: "Out this month", align: "right", csv: (a) => a.outThisMonthPaise / 100, cell: (a) => <span className="text-rose-700 tabular-nums dark:text-rose-300">{formatPaise(a.outThisMonthPaise)}</span> },
    { key: "entries", header: "Entries", align: "right", defaultHidden: true, sort: (a) => a.entries ?? 0, csv: (a) => a.entries ?? 0, cell: (a) => <span className="tabular-nums">{a.entries ?? 0}</span> },
    { key: "balance", header: "Balance", align: "right", sort: (a) => a.balancePaise, csv: (a) => a.balancePaise / 100, cell: (a) => <span className={cn("font-semibold tabular-nums", a.balancePaise < 0 && "text-destructive")}>{formatPaise(a.balancePaise)}</span> },
    { key: "status", header: "Status", csv: (a) => (a.isActive ? "Open" : "Closed"), cell: (a) => <Pill color={a.isActive ? "emerald" : "slate"} dot>{a.isActive ? "Open" : "Closed"}</Pill> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (a) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {edit && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}><Pencil /></Button>}
          <ActionMenu label={`More actions for ${a.name}`} items={[
            { label: "Passbook", icon: BookOpen, href: `/app/m/finance/accounts/${a.id}` },
            a.isActive && can("finance.expense.create") && { label: "Move money from here", icon: ArrowRightLeft, onClick: () => setMoving(a.id) },
            edit && a.isActive && !a.isDefault && a.kind !== "cash" && { label: "Make default", icon: Star, onClick: () => void act(a, { isDefault: true }, `${a.name} is the default`) },
            "-",
            edit && !a.isDefault && (a.isActive ? { label: "Close account", icon: Archive, onClick: () => void act(a, { isActive: false }, `${a.name} closed`) } : { label: "Reopen", icon: ArchiveRestore, onClick: () => void act(a, { isActive: true }, `${a.name} reopened`) }),
          ]} />
        </span>
      ),
    },
  ]
  const add = can("finance.expense.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Add account</Button> : undefined

  return (
    <>
      <FinanceTabs group="cash" active="accounts" />
      <DataList<FinAccount>
        id="fin-accounts"
        load={localList(async () => (await api.get<{ data: FinAccount[] }>("/finance/accounts")).data, (a, q) => `${a.name} ${a.bankName ?? ""} ${a.upiId ?? ""}`.toLowerCase().includes(q), {
          filter: (a, p) => (p.show === "closed" ? !a.isActive : p.show === "open" ? a.isActive : true),
          counts: (rows) => countBy(rows, (a) => (a.isActive ? "open" : "closed")),
          meta: (rows) => {
            const sum = (xs: FinAccount[], k: "balancePaise" | "inThisMonthPaise" | "outThisMonthPaise") => xs.reduce((n, a) => n + a[k], 0)
            const cash = rows.filter((a) => a.kind === "cash")
            return { sums: { total: sum(rows, "balancePaise"), cash: sum(cash, "balancePaise"), other: sum(rows, "balancePaise") - sum(cash, "balancePaise"), in: sum(rows, "inThisMonthPaise"), out: sum(rows, "outThisMonthPaise"), accounts: rows.filter((a) => a.isActive).length } }
          },
        })}
        presetLabel="Show"
        presets={[{ key: "open", label: "Open", params: { show: "open" }, countKey: "open" }, { key: "closed", label: "Closed", params: { show: "closed" }, countKey: "closed" }, { key: "all", label: "All", params: {}, countKey: "all" }]}
        tabs
        top={(res) => {
          const s = (res.sums ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Total balance", value: formatPaise(s.total ?? 0), hint: `${s.accounts ?? 0} open accounts`, color: "blue", icon: Wallet },
            { label: "Cash in hand", value: formatPaise(s.cash ?? 0), hint: "All cash accounts", color: "amber", icon: Banknote },
            { label: "In bank, UPI and cards", value: formatPaise(s.other ?? 0), hint: "Everything not cash", color: "violet", icon: Landmark },
            { label: "In this month", value: formatPaise(s.in ?? 0), hint: "Payments, income, transfers in", color: "emerald", icon: ArrowDownLeft },
            { label: "Out this month", value: formatPaise(s.out ?? 0), hint: "Expenses, payments, transfers out", color: "rose", icon: ArrowUpRight },
          ]} />
        }}
        params={{ v: String(version) }}
        header={{ title: "Cash & Bank", description: "Every account money sits in. Customer payments, supplier payments, expenses and transfers move these balances.", primary: add, actions: can("finance.expense.create") ? <Button variant="outline" className="h-10 rounded-xl" onClick={() => setMoving("")}><ArrowRightLeft /> Move money</Button> : undefined }}
        columns={columns}
        searchPlaceholder="Search account or bank"
        rowHref={(a) => `/app/m/finance/accounts/${a.id}`}
        exportName="accounts"
        emptyState={<EmptyState icon={Wallet} title="No accounts yet" action={add} />}
      />
      {editing && <AccountDialog account={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {moving !== null && <TransferDialog from={moving || undefined} onClose={() => setMoving(null)} onSaved={() => { setMoving(null); reload() }} />}
    </>
  )
}
