"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Eye, Plus, Undo2, Wallet } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState, Spinner } from "@/components/common"
import { DataList, localList, periodFilter, type Column } from "@/components/data-list"
import type { ContactOption } from "@/components/pickers"
import { methodLabel, PaySupplierDialog, SupplierPaymentDialog, type SupplierPayment } from "@/components/pay-supplier"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHODS } from "@/lib/money"
import { cn } from "@/lib/utils"

// Payments made: money paid to suppliers. One payment can clear several of a supplier's invoices.

const PILL = { green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", grey: "bg-muted text-muted-foreground" }

export default function PaymentsMadePage() {
  const { can, me } = useAuth()
  const params = useSearchParams()
  const preset = useApi<ContactOption>(params.get("supplier") ? `/suppliers/${params.get("supplier")}` : null)
  const [paying, setPaying] = React.useState(params.get("new") === "1")
  const [viewing, setViewing] = React.useState<string | null>(null)
  const [reversing, setReversing] = React.useState<SupplierPayment | null>(null)
  const [version, setVersion] = React.useState(0)
  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })
  if (!can("inventory.supplier_bill.view")) return <PageHeader title="Payments Made" description="You don't have access to this. Ask your admin." />
  if (params.get("supplier") && preset.loading) return <div className="grid place-items-center py-24"><Spinner /></div>

  const columns: Column<SupplierPayment>[] = [
    { key: "number", header: "Payment no.", hideable: false, sort: (r) => r.number, csv: (r) => r.number, cell: (r) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.number}</span> },
    { key: "date", header: "Date", sort: (r) => r.paidOn, csv: (r) => r.paidOn.slice(0, 10), cell: (r) => formatDate(r.paidOn) },
    { key: "supplier", header: "Supplier", sort: (r) => r.supplier.toLowerCase(), csv: (r) => r.supplier, cell: (r) => <span className="font-medium">{r.supplier}</span> },
    { key: "method", header: "Paid by", csv: (r) => methodLabel(r.method), cell: (r) => <Badge variant="outline">{methodLabel(r.method)}</Badge> },
    { key: "reference", header: "Reference", csv: (r) => r.reference, cell: (r) => <span className="font-mono text-xs">{r.reference ?? "—"}</span> },
    {
      key: "applied", header: "Against", csv: (r) => r.appliedTo.map((a) => a.supplierRef ?? a.number).join(" "),
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.appliedTo.slice(0, 3).map((a) => <span key={a.paymentId} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]">{a.supplierRef ?? a.number}</span>)}
          {r.appliedTo.length > 3 && <span className="text-xs text-muted-foreground">+{r.appliedTo.length - 3}</span>}
        </span>
      ),
    },
    { key: "amount", header: "Amount", align: "right", sort: (r) => r.amountPaise, csv: (r) => (r.amountPaise / 100).toFixed(2), cell: (r) => <span className={cn("font-semibold tabular-nums", r.reversed && "text-muted-foreground line-through")}>{formatPaise(r.amountPaise)}</span> },
    { key: "status", header: "Status", csv: (r) => (r.reversed ? "Reversed" : "Paid"), cell: (r) => <span className={cn("inline-flex h-[22px] items-center rounded-full px-2 text-xs font-semibold", PILL[r.reversed ? "grey" : "green"])}>{r.reversed ? "Reversed" : "Paid"}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={icon} title="View" aria-label={`View ${r.number}`} onClick={() => setViewing(r.id)}><Eye /></button>
          {!r.reversed && can("inventory.supplier_bill.approve") && <Button variant="ghost" size="icon-sm" className="text-destructive" title="Reverse" aria-label={`Reverse ${r.number}`} onClick={() => setReversing(r)}><Undo2 /></Button>}
        </span>
      ),
    },
  ]
  const newButton = can("inventory.supplier_bill.create") && <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setPaying(true)}><Plus /> Pay supplier</Button>
  const matches = (r: SupplierPayment, q: string) => `${r.number} ${r.supplier} ${r.reference ?? ""} ${r.appliedTo.map((a) => `${a.supplierRef ?? ""} ${a.number ?? ""}`).join(" ")}`.toLowerCase().includes(q)

  return (
    <>
      <DataList<SupplierPayment>
        id="payments-made"
        load={localList(async (p) => {
          const qs = new URLSearchParams(Object.entries({ from: p.from, to: p.to, method: p.method }).filter(([, v]) => v) as [string, string][]).toString()
          const rows = (await api.get<{ data: SupplierPayment[] }>(`/payments-made${qs ? `?${qs}` : ""}`)).data
          return p.view === "reversed" ? rows.filter((r) => r.reversed) : p.view === "active" ? rows.filter((r) => !r.reversed) : rows
        }, matches)}
        params={{ v: String(version) }}
        header={{
          title: "Payments Made",
          description: "Money paid to suppliers. One payment can clear several of their invoices.",
          primary: newButton,
          more: [{ label: "Purchase Invoices", href: "/app/m/purchase" }, { label: "Payables report", href: "/app/m/purchase/reports" }],
        }}
        columns={columns}
        searchPlaceholder="Search payment, supplier, UTR or invoice no."
        presets={[{ key: "all", label: "All", params: {} }, { key: "active", label: "Paid", params: { view: "active" } }, { key: "reversed", label: "Reversed", params: { view: "reversed" } }]}
        filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4), { key: "method", label: "Paid by", options: PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label })) }]}
        exportName="payments-made"
        emptyState={<EmptyState icon={Wallet} title="No payments yet" description="When you pay a supplier, record it here once and put it on one invoice or several." action={newButton} />}
      />
      {paying && <PaySupplierDialog initial={preset.data ?? null} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); setVersion((v) => v + 1) }} />}
      {viewing && <SupplierPaymentDialog id={viewing} onClose={() => setViewing(null)} />}
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        destructive
        title={`Reverse ${reversing?.number}?`}
        description={`It comes off ${reversing?.appliedTo.map((a) => a.supplierRef ?? a.number).join(", ")} and an opposite entry is added. The original stays on record.`}
        confirmLabel="Reverse payment"
        onConfirm={async () => {
          try {
            await api.post(`/payments-made/${reversing!.id}/reverse`)
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
