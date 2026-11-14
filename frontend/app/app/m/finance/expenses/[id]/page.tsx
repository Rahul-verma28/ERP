"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { Copy, ExternalLink, Pencil, Receipt, Trash2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/common"
import { PageError, PageLoading } from "@/components/page-states"
import { ActionMenu, BackLink, DetailHeader, DetailList, Pill, Section, StatGrid } from "@/components/page-parts"
import { ExpenseDialog } from "@/components/finance/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import type { Expense } from "@/lib/finance"

// One expense: what, how much, from which account, and its GST bill.

export default function ExpensePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can } = useAuth()
  const { data: e, error, reload } = useApi<Expense>(`/expenses/${id}`)
  const [editing, setEditing] = React.useState<"edit" | "copy" | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  if (error) return <PageError error={error} onRetry={() => void reload()} />
  if (!e) return <PageLoading />
  const gst = !!e.gstPaise

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/finance/expenses">Expenses</BackLink>
      <DetailHeader
        title={e.number ?? "Expense"}
        icon={Receipt}
        pills={<>{gst && <Pill color="blue">GST bill</Pill>}<Pill>{e.category}</Pill></>}
        subtitle={[formatDate(e.paidOn), e.payee, e.account ? `from ${e.account}` : null].filter(Boolean).join(" · ")}
        actions={<>
          {e.receiptUrl && <a href={e.receiptUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><ExternalLink /> Bill photo</a>}
          {can("finance.expense.edit") && <Button onClick={() => setEditing("edit")}><Pencil /> Edit</Button>}
          <ActionMenu items={[
            can("finance.expense.create") && { label: "Add another like this", icon: Copy, onClick: () => setEditing("copy") },
            "-",
            can("finance.expense.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(true) },
          ]} />
        </>}
      />
      <StatGrid items={[
        { label: "Amount paid", value: formatPaise(e.amountPaise) },
        gst ? { label: "Before GST", value: formatPaise(e.taxablePaise ?? 0), hint: "The cost in profit & loss" } : { label: "Cost", value: formatPaise(e.amountPaise), hint: "No GST bill, so all of it is a cost" },
        gst && { label: "GST to claim back", value: formatPaise(e.gstPaise ?? 0), hint: `${(e.gstRateBp ?? 0) / 100}% on bill ${e.billNo}`, accent: "text-emerald-700 dark:text-emerald-300" },
        { label: "Paid from", value: e.account ?? "—", href: `/app/m/finance/accounts/${e.accountId}` },
      ]} />
      <Section title="Details">
        <DetailList items={[
          ["Category", e.category], ["Date", formatDate(e.paidOn)],
          ["Paid to", e.payee], ["Paid from", e.account ? <Link href={`/app/m/finance/accounts/${e.accountId}`} className="text-primary hover:underline">{e.account}</Link> : null],
          ["Reference", e.reference], gst && ["Supplier bill no.", e.billNo],
          gst && ["Supplier GSTIN", <span key="g" className="font-mono">{e.vendorGstin}</span>], gst && ["GST rate", `${(e.gstRateBp ?? 0) / 100}%`],
          ["Added", formatDate(e.createdAt)],
        ]} />
        {e.notes && <p className="mt-4 rounded-2xl bg-muted/60 p-3 text-sm whitespace-pre-wrap">{e.notes}</p>}
      </Section>
      {editing && <ExpenseDialog expense={editing === "edit" ? e : null} copyOf={editing === "copy" ? e : null} onClose={() => setEditing(null)} onSaved={(x) => { setEditing(null); if (x.id !== e.id) router.push(`/app/m/finance/expenses/${x.id}`); else void reload() }} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        destructive
        title={`Delete ${e.number ?? "this expense"}?`}
        description="It comes off the account it was paid from and out of the reports."
        confirmLabel="Delete expense"
        onConfirm={async () => {
          try {
            await api.delete(`/expenses/${e.id}`)
            toast.success("Expense deleted")
            router.push("/app/m/finance/expenses")
          } catch (err) {
            toast.error(errorMessage(err))
          }
        }}
      />
    </div>
  )
}
