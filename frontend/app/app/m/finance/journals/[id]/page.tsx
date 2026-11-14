"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { Copy, FilePlus2, Pencil, Printer, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/common"
import { PageError, PageLoading } from "@/components/page-states"
import { ActionMenu, BackLink, DetailHeader, DetailList, Section } from "@/components/page-parts"
import { JournalDialog } from "@/components/finance/books"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { ledgerHref, type Journal } from "@/lib/finance"

// One journal entry, laid out as a voucher: each ledger with its debit or credit.

export default function JournalPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can } = useAuth()
  const { data: j, error, reload } = useApi<Journal>(`/finance/journals/${id}`)
  const [editing, setEditing] = React.useState<"edit" | "copy" | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  if (error) return <PageError error={error} onRetry={() => void reload()} />
  if (!j) return <PageLoading />

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/finance/journals">Journal entries</BackLink>
      <DetailHeader
        title={j.number}
        icon={FilePlus2}
        subtitle={[formatDate(j.journalOn), j.reference].filter(Boolean).join(" · ")}
        actions={<>
          <Button variant="outline" onClick={() => window.print()} className="print:hidden"><Printer /> Print</Button>
          {can("finance.expense.edit") && <Button onClick={() => setEditing("edit")} className="print:hidden"><Pencil /> Edit</Button>}
          <ActionMenu items={[
            can("finance.expense.create") && { label: "Copy as new", icon: Copy, onClick: () => setEditing("copy") },
            "-",
            can("finance.expense.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(true) },
          ]} />
        </>}
      />
      <Section title="Journal voucher" description={j.narration} flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr className="border-b"><th className="px-5 py-2.5 text-left font-medium">Ledger</th><th className="px-5 py-2.5 text-left font-medium">Note</th><th className="px-5 py-2.5 text-right font-medium">Debit</th><th className="px-5 py-2.5 text-right font-medium">Credit</th></tr></thead>
            <tbody className="divide-y">
              {j.lines.map((l, i) => (
                <tr key={l.id ?? i}>
                  <td className="px-5 py-2.5 font-medium"><Link href={ledgerHref(l.ledgerKey)} className="hover:underline">{l.creditPaise ? <span className="pl-6">To {l.ledger}</span> : l.ledger}</Link></td>
                  <td className="px-5 py-2.5 text-muted-foreground">{l.description ?? ""}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{l.debitPaise ? formatPaise(l.debitPaise) : ""}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{l.creditPaise ? formatPaise(l.creditPaise) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40 font-semibold"><tr><td className="px-5 py-2.5" colSpan={2}>Total</td><td className="px-5 py-2.5 text-right tabular-nums">{formatPaise(j.totalPaise)}</td><td className="px-5 py-2.5 text-right tabular-nums">{formatPaise(j.totalPaise)}</td></tr></tfoot>
          </table>
        </div>
      </Section>
      <Section title="Details">
        <DetailList items={[["Date", formatDate(j.journalOn)], ["Reference", j.reference], ["Narration", j.narration], ["Added", formatDate(j.createdAt)]]} />
      </Section>
      {editing && <JournalDialog journal={editing === "edit" ? j : null} copyOf={editing === "copy" ? j : null} onClose={() => setEditing(null)} onSaved={(x) => { setEditing(null); if (x.id !== j.id) router.push(`/app/m/finance/journals/${x.id}`); else void reload() }} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        destructive
        title={`Delete ${j.number}?`}
        description="Every ledger it touched goes back to how it was."
        confirmLabel="Delete entry"
        onConfirm={async () => {
          try {
            await api.delete(`/finance/journals/${j.id}`)
            toast.success("Journal entry deleted")
            router.push("/app/m/finance/journals")
          } catch (err) {
            toast.error(errorMessage(err))
          }
        }}
      />
    </div>
  )
}
