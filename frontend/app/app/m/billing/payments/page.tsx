"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Eye, Plus, Printer, Undo2, Wallet } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog, EmptyState, Spinner } from "@/components/common"
import { DataList, periodFilter, type Column } from "@/components/data-list"
import type { ContactOption } from "@/components/pickers"
import { KIND_LABEL, methodLabel, ReceiptDialog, ReceiveDialog, type Receipt } from "@/components/receive-payment"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHODS } from "@/lib/money"
import { cn } from "@/lib/utils"

// Payments received: money in from customers. One receipt can clear several bills; what is not put
// on a bill stays with the customer as an advance for a later invoice.

const PILL = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  blue: "bg-primary/10 text-primary",
  grey: "bg-muted text-muted-foreground",
}

export default function PaymentsReceivedPage() {
  const { can, me } = useAuth()
  const params = useSearchParams()
  const presetContact = useApi<ContactOption>(params.get("contact") ? `/contacts/${params.get("contact")}?view=summary` : null)
  const [receiving, setReceiving] = React.useState(params.get("new") === "1")
  const [viewing, setViewing] = React.useState<string | null>(null)
  const [reversing, setReversing] = React.useState<Receipt | null>(null)
  const [version, setVersion] = React.useState(0)
  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })
  const canCreate = can("billing.payment.create")

  const status = (r: Receipt) => (r.reversed ? { label: "Reversed", tone: "grey" as const } : r.unusedPaise > 0 ? { label: "Advance left", tone: "blue" as const } : { label: "Received", tone: "green" as const })
  const columns: Column<Receipt>[] = [
    { key: "number", header: "Receipt no.", hideable: false, sort: (r) => r.number, csv: (r) => r.number, cell: (r) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.number}</span> },
    { key: "date", header: "Date", sort: (r) => r.paidOn, csv: (r) => r.paidOn.slice(0, 10), cell: (r) => formatDate(r.paidOn) },
    { key: "customer", header: "Customer", sort: (r) => r.customer?.toLowerCase() ?? "", csv: (r) => r.customer, cell: (r) => <span className="font-medium">{r.customer ?? "—"}</span> },
    { key: "method", header: "Paid by", csv: (r) => methodLabel(r.method), cell: (r) => <Badge variant="outline">{methodLabel(r.method)}</Badge> },
    { key: "reference", header: "Reference", csv: (r) => r.reference, cell: (r) => <span className="font-mono text-xs">{r.reference ?? "—"}</span> },
    {
      key: "applied", header: "Put on", csv: (r) => r.appliedTo.map((a) => a.number).join(" "),
      cell: (r) => (r.appliedTo.length === 0 ? <span className="text-muted-foreground">{r.reversed ? "—" : "Advance"}</span> : (
        <span className="flex flex-wrap gap-1">
          {r.appliedTo.slice(0, 3).map((a) => <span key={a.id} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">{a.number ?? KIND_LABEL[a.kind]}</span>)}
          {r.appliedTo.length > 3 && <span className="text-xs text-muted-foreground">+{r.appliedTo.length - 3}</span>}
        </span>
      )),
    },
    { key: "amount", header: "Amount", align: "right", sort: (r) => r.amountPaise, csv: (r) => (r.amountPaise / 100).toFixed(2), cell: (r) => <span className={cn("font-semibold tabular-nums", r.reversed && "line-through text-muted-foreground")}>{formatPaise(r.amountPaise)}</span> },
    { key: "unused", header: "Advance left", align: "right", defaultHidden: true, sort: (r) => r.unusedPaise, csv: (r) => (r.unusedPaise / 100).toFixed(2), cell: (r) => <span className="tabular-nums">{r.unusedPaise > 0 ? formatPaise(r.unusedPaise) : "—"}</span> },
    {
      key: "status", header: "Status", csv: (r) => status(r).label,
      cell: (r) => { const s = status(r); return <span className={cn("inline-flex h-[22px] items-center rounded-full px-2 text-xs font-semibold whitespace-nowrap", PILL[s.tone])}>{s.label}</span> },
    },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={icon} title="View" aria-label={`View ${r.number}`} onClick={() => setViewing(r.id)}><Eye /></button>
          {!r.reversed && <a href={`/print/receipt/${r.id}`} target="_blank" rel="noreferrer" className={icon} title="Print receipt" aria-label={`Print ${r.number}`}><Printer /></a>}
          {!r.reversed && can("billing.payment.approve") && <Button variant="ghost" size="icon-sm" className="text-destructive" title="Reverse" aria-label={`Reverse ${r.number}`} onClick={() => setReversing(r)}><Undo2 /></Button>}
        </span>
      ),
    },
  ]
  const newButton = canCreate && <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setReceiving(true)}><Plus /> Receive payment</Button>

  if (params.get("contact") && presetContact.loading) return <div className="grid place-items-center py-24"><Spinner /></div>

  return (
    <>
      <DataList<Receipt>
        id="payments-received"
        path="/payments"
        params={{ v: String(version) }}
        header={{
          title: "Payments Received",
          description: "Money in from customers. One payment can clear several bills; the rest stays as an advance.",
          primary: newButton,
          more: [
            { label: "Dues and reminders", href: "/app/m/billing/dues" },
            { label: "Sales Invoices", href: "/app/m/billing" },
          ],
        }}
        columns={columns}
        searchPlaceholder="Search receipt, customer, reference or bill no."
        presets={[
          { key: "all", label: "All", params: {} },
          { key: "active", label: "Received", params: { view: "active" } },
          { key: "advance", label: "Advances", params: { view: "advance" } },
          { key: "reversed", label: "Reversed", params: { view: "reversed" } },
        ]}
        filters={[
          periodFilter(me?.tenant?.fyStartMonth ?? 4),
          { key: "method", label: "Paid by", options: PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label })) },
        ]}
        exportName="payments-received"
        emptyState={<EmptyState icon={Wallet} title="No payments yet" description="When a customer pays, record it here once and put it on one bill or several." action={newButton} />}
      />
      {receiving && <ReceiveDialog initial={presetContact.data ?? null} onClose={() => setReceiving(false)} onSaved={() => { setReceiving(false); setVersion((v) => v + 1) }} />}
      {viewing && <ReceiptDialog id={viewing} onClose={() => setViewing(null)} />}
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        destructive
        title={`Reverse ${reversing?.number}?`}
        description={`It comes off ${reversing?.appliedTo.length ? reversing.appliedTo.map((a) => a.number).join(", ") : "the customer's advance"} and an opposite entry is added. The original stays on record.`}
        confirmLabel="Reverse payment"
        onConfirm={async () => {
          try {
            await api.post(`/receipts/${reversing!.id}/reverse`)
            toast.success("Payment reversed")
            setVersion((v) => v + 1)
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
