"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, BookOpen } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell"
import { EmptyState, Spinner } from "@/components/common"
import { DataList, periodFilter } from "@/components/data-list"
import { SupplierDialog } from "@/components/supplier-dialog"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { api, errorMessage } from "@/lib/api"
import { formatDate, formatPaise } from "@/lib/format"
import { stateName } from "@contracts/validation"
import type { Supplier } from "@/lib/purchase"

// One supplier: details, and the ledger of bills, payments and returns with the running balance.

interface LedgerRow { id: string; kind: string; number: string; date: string; details: string; billPaise: number; paidPaise: number; balancePaise: number }

const KIND: Record<string, string> = { purchase_bill: "Invoice", purchase_return: "Return", payment: "Payment", payment_reversal: "Payment reversed" }

export default function SupplierPage() {
  const { id } = useParams<{ id: string }>()
  const { can, me } = useAuth()
  const [editing, setEditing] = React.useState(false)
  const sup = useApi<Supplier>(`/suppliers/${id}`)
  if (sup.error) return <PageHeader title="Not found" description={errorMessage(sup.error)} />
  const s = sup.data
  if (!s) return <div className="grid place-items-center py-24"><Spinner /></div>
  const fmt = (p: number) => `${formatPaise(Math.abs(p))}${p < 0 ? " (they owe you)" : ""}`
  return (
    <>
      <Link href="/app/m/purchase/suppliers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Suppliers</Link>
      <PageHeader
        title={s.companyName || s.name}
        description={[s.companyName ? s.name : null, s.gstin, s.stateCode ? stateName(s.stateCode) : null, s.phone].filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2">
            {can("inventory.supplier_bill.create") && <Link href={`/app/m/purchase/new?kind=purchase_bill&supplier=${s.id}`} className={buttonVariants()}>New invoice</Link>}
            {me?.tenant?.purchaseOrders && can("inventory.purchase_order.create") && <Link href={`/app/m/purchase/new?kind=purchase_order&supplier=${s.id}`} className={buttonVariants({ variant: "outline" })}>New order</Link>}
            {can("inventory.supplier.edit") && <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
          </div>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card><CardContent><p className="text-xs text-muted-foreground">You owe</p><p className="text-xl font-semibold tabular-nums">{fmt(s.balancePaise)}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs text-muted-foreground">Payment days</p><p className="text-xl font-semibold">{s.paymentDays ?? "—"}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs text-muted-foreground">GST</p><p className="text-sm font-medium">{s.gstin ? "Registered: charges GST" : "Not registered: no GST on their bills"}</p></CardContent></Card>
      </div>
      {can("inventory.supplier_bill.view") && (
        <DataList<LedgerRow & { id: string }>
          id="supplier-ledger"
          load={async ({ params, limit, cursor }) => {
            const range = new URLSearchParams({ ...(params.from ? { from: params.from } : {}), ...(params.to ? { to: params.to } : {}) }).toString()
            const r = await api.get<{ openingPaise: number; closingPaise: number; data: LedgerRow[] }>(`/suppliers/${id}/ledger?${range}`)
            const q = (params.q ?? "").toLowerCase()
            const all = r.data.map((x, n) => ({ ...x, docId: x.id, id: `${x.id}-${n}` })).filter((x) => !q || `${x.number} ${x.details}`.toLowerCase().includes(q))
            const start = Number(cursor ?? 0)
            return { ...r, data: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, total: all.length }
          }}
          header={{ title: "Ledger", description: "Every invoice, payment and return with this supplier, and the running balance." }}
          filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
          summary={(r) => <span className="flex flex-wrap gap-x-4 text-sm text-muted-foreground"><span>Opening <strong className="text-foreground tabular-nums">{fmt(Number(r.openingPaise ?? 0))}</strong></span><span>Closing <strong className="text-foreground tabular-nums">{fmt(Number(r.closingPaise ?? 0))}</strong></span></span>}
          columns={[
            { key: "date", header: "Date", hideable: false, csv: (r) => r.date.slice(0, 10), cell: (r) => formatDate(r.date) },
            { key: "entry", header: "Entry", csv: (r) => `${KIND[r.kind] ?? r.kind} ${r.number}`, cell: (r) => <span>{KIND[r.kind] ?? r.kind} <span className="font-mono text-xs">{r.number}</span></span> },
            { key: "details", header: "Details", csv: (r) => r.details, cell: (r) => <span className="text-muted-foreground">{r.details}</span> },
            { key: "bill", header: "Invoice", align: "right", csv: (r) => r.billPaise / 100, cell: (r) => (r.billPaise ? formatPaise(r.billPaise) : "") },
            { key: "paid", header: "Paid or returned", align: "right", csv: (r) => r.paidPaise / 100, cell: (r) => (r.paidPaise ? formatPaise(r.paidPaise) : "") },
            { key: "balance", header: "Balance", align: "right", csv: (r) => r.balancePaise / 100, cell: (r) => <span className="font-medium">{fmt(r.balancePaise)}</span> },
          ]}
          searchPlaceholder="Search number or details"
          rowHref={(r) => `/app/m/purchase/${(r as LedgerRow & { docId: string }).docId}`}
          exportName="supplier-ledger"
          emptyState={<EmptyState icon={BookOpen} title="No invoices or payments yet" />}
        />
      )}
      <SupplierDialog open={editing} onOpenChange={setEditing} supplier={s} onSaved={(n) => sup.setData(n)} />
    </>
  )
}
