"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Banknote, CalendarDays, Eye, Landmark, Plus, Undo2, Wallet } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, countBy, localList, periodFilter, type Column } from "@/components/data-list"
import { SummaryCards } from "@/components/summary-cards"
import Link from "next/link"
import type { ContactOption } from "@/components/pickers"
import { methodLabel, PaySupplierDialog, SupplierPaymentDialog, type SupplierPayment } from "@/components/pay-supplier"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise, initials } from "@/lib/format"
import { todayInIndia } from "@contracts/validation"
import { PAYMENT_METHODS } from "@/lib/money"
import { cn } from "@/lib/utils"
import { PageLoading, NoAccessPage } from "@/components/page-states"

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
  if (!can("inventory.supplier_bill.view")) return <NoAccessPage title="Payments Made" permission="inventory.supplier_bill.view" />
  if (params.get("supplier") && preset.loading) return <PageLoading />

  const columns: Column<SupplierPayment>[] = [
    { key: "number", header: "Payment no.", hideable: false, sort: (r) => r.number, csv: (r) => r.number, cell: (r) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.number}</span> },
    { key: "date", header: "Date", sort: (r) => r.paidOn, csv: (r) => r.paidOn.slice(0, 10), cell: (r) => formatDate(r.paidOn) },
    {
      key: "supplier", header: "Supplier", sort: (r) => r.supplier.toLowerCase(), csv: (r) => r.supplier,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(r.supplier)}</span>
          <span className="min-w-0"><Link href={`/app/m/purchase/suppliers/${r.contactId}`} onClick={(e) => e.stopPropagation()} className="block font-medium hover:underline">{r.supplier}</Link><span className="block truncate text-xs text-muted-foreground">{r.supplierGstin ?? r.supplierPhone ?? "—"}</span></span>
        </span>
      ),
    },
    { key: "method", header: "Paid by", csv: (r) => methodLabel(r.method), cell: (r) => <Badge variant="outline">{methodLabel(r.method)}</Badge> },
    { key: "account", header: "Paid from", csv: (r) => r.accountName ?? "", cell: (r) => (r.accountName ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{r.accountKind === "cash" ? <Banknote className="size-3.5" /> : <Landmark className="size-3.5" />}{r.accountName}</span> : "—") },
    { key: "reference", header: "Reference", csv: (r) => r.reference, cell: (r) => <span className="font-mono text-xs">{r.reference ?? "—"}</span> },
    {
      key: "applied", header: "Against", csv: (r) => r.appliedTo.map((a) => a.supplierRef ?? a.number).join(" "),
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.appliedTo.slice(0, 3).map((a) => <Link key={a.paymentId} href={`/app/m/purchase/${a.id}`} onClick={(e) => e.stopPropagation()} title={`${formatPaise(a.amountPaise)} on this invoice`} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-primary/10 hover:text-primary">{a.supplierRef ?? a.number} · {formatPaise(a.amountPaise)}</Link>)}
          {r.appliedTo.length > 3 && <span className="text-xs text-muted-foreground">+{r.appliedTo.length - 3}</span>}
        </span>
      ),
    },
    { key: "amount", header: "Amount", align: "right", sort: (r) => r.amountPaise, csv: (r) => (r.amountPaise / 100).toFixed(2), cell: (r) => <span className={cn("font-semibold tabular-nums", r.reversed && "text-muted-foreground line-through")}>{formatPaise(r.amountPaise)}</span> },
    { key: "status", header: "Status", csv: (r) => (r.reversed ? "Reversed" : "Paid"), cell: (r) => <span className="grid gap-0.5"><span className={cn("inline-flex h-[22px] w-fit items-center rounded-full px-2 text-xs font-semibold", PILL[r.reversed ? "grey" : "green"])}>{r.reversed ? "Reversed" : "Paid"}</span>{r.reversal && <span className="text-[11px] text-muted-foreground">{r.reversal.number} · {formatDate(r.reversal.paidOn)}</span>}</span> },
    { key: "createdBy", header: "Recorded by", defaultHidden: true, csv: (r) => r.createdByName ?? "", cell: (r) => <span className="text-sm">{r.createdByName ?? "—"}{r.createdAt && <span className="block text-[11px] text-muted-foreground">{formatDate(r.createdAt)}</span>}</span> },
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
  const matches = (r: SupplierPayment, q: string) => `${r.number} ${r.supplier} ${r.supplierGstin ?? ""} ${r.accountName ?? ""} ${r.reference ?? ""} ${r.appliedTo.map((a) => `${a.supplierRef ?? ""} ${a.number ?? ""}`).join(" ")}`.toLowerCase().includes(q)

  return (
    <>
      <DataList<SupplierPayment>
        id="payments-made"
        load={localList(async (p) => {
          const qs = new URLSearchParams(Object.entries({ from: p.from, to: p.to, method: p.method }).filter(([, v]) => v) as [string, string][]).toString()
          const rows = (await api.get<{ data: SupplierPayment[] }>(`/payments-made${qs ? `?${qs}` : ""}`)).data
          return rows
        }, matches, {
          filter: (r, p) => (p.view === "reversed" ? r.reversed : p.view === "active" ? !r.reversed : true),
          counts: (rows) => countBy(rows, (r) => (r.reversed ? "reversed" : "active")),
          meta: (rows) => {
            const live = rows.filter((r) => !r.reversed)
            const month = todayInIndia().slice(0, 7)
            const sum = (xs: SupplierPayment[]) => xs.reduce((a, r) => a + r.amountPaise, 0)
            const cash = live.filter((r) => r.method === "cash")
            return { sums: { all: sum(live), month: sum(live.filter((r) => r.paidOn.slice(0, 7) === month)), monthCount: live.filter((r) => r.paidOn.slice(0, 7) === month).length, cash: sum(cash), cashCount: cash.length, bank: sum(live) - sum(cash), bankCount: live.length - cash.length, suppliers: new Set(live.map((r) => r.contactId)).size } }
          },
        })}
        params={{ v: String(version) }}
        header={{
          title: "Payments Made",
          description: "Money paid to suppliers. One payment can clear several of their invoices.",
          primary: newButton,
          more: [{ label: "Purchase Invoices", href: "/app/m/purchase" }, { label: "Payables report", href: "/app/m/purchase/reports" }],
        }}
        columns={columns}
        searchPlaceholder="Search payment, supplier, UTR or invoice no."
        presets={[{ key: "all", label: "All", params: {}, countKey: "all" }, { key: "active", label: "Paid", params: { view: "active" }, countKey: "active" }, { key: "reversed", label: "Reversed", params: { view: "reversed" }, countKey: "reversed" }]}
        tabs
        top={(res) => {
          const s = (res.sums ?? {}) as Record<string, number>
          const c = (res.counts ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Total paid", value: formatPaise(s.all ?? 0), hint: `${c.active ?? 0} payments · ${s.suppliers ?? 0} suppliers`, color: "blue", icon: Wallet },
            { label: "This month", value: formatPaise(s.month ?? 0), hint: `${s.monthCount ?? 0} payments`, color: "violet", icon: CalendarDays },
            { label: "By bank, UPI or card", value: formatPaise(s.bank ?? 0), hint: `${s.bankCount ?? 0} payments`, color: "emerald", icon: Landmark },
            { label: "In cash", value: formatPaise(s.cash ?? 0), hint: `${s.cashCount ?? 0} payments`, color: "amber", icon: Banknote },
            { label: "Reversed", value: c.reversed ?? 0, hint: "Undone, kept on record", color: "rose", icon: Undo2 },
          ]} />
        }}
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
