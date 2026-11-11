"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { Spinner } from "@/components/common"
import { SupplierDialog } from "@/components/supplier-dialog"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { errorMessage } from "@/lib/api"
import { formatDate, formatPaise } from "@/lib/format"
import { stateName } from "@contracts/validation"
import type { Supplier } from "@/lib/purchase"

// One supplier: details, and the ledger of bills, payments and returns with the running balance.

interface LedgerRow { id: string; kind: string; number: string; date: string; details: string; billPaise: number; paidPaise: number; balancePaise: number }

const KIND: Record<string, string> = { purchase_bill: "Invoice", purchase_return: "Return", payment: "Payment", payment_reversal: "Payment reversed" }

export default function SupplierPage() {
  const { id } = useParams<{ id: string }>()
  const { can, me } = useAuth()
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [editing, setEditing] = React.useState(false)
  const sup = useApi<Supplier>(`/suppliers/${id}`)
  const range = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()
  const ledger = useApi<{ openingPaise: number; closingPaise: number; data: LedgerRow[] }>(can("inventory.supplier_bill.view") ? `/suppliers/${id}/ledger?${range}` : null)
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
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card><CardContent><p className="text-xs text-muted-foreground">You owe</p><p className="text-xl font-semibold tabular-nums">{fmt(s.balancePaise)}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs text-muted-foreground">Payment days</p><p className="text-xl font-semibold">{s.paymentDays ?? "—"}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs text-muted-foreground">GST</p><p className="text-sm font-medium">{s.gstin ? "Registered: charges GST" : "Not registered: no GST on their bills"}</p></CardContent></Card>
      </div>
      {ledger.data && (
        <Card>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">Ledger</span>
              <label className="flex items-center gap-2 text-muted-foreground">From <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></label>
              <label className="flex items-center gap-2 text-muted-foreground">To <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Entry</th><th className="py-2 pr-3">Details</th><th className="py-2 pr-3 text-right">Bill</th><th className="py-2 pr-3 text-right">Paid / returned</th><th className="py-2 text-right">Balance</th></tr></thead>
                <tbody>
                  {from && <tr className="border-t"><td className="py-2 pr-3" colSpan={5}>Opening balance</td><td className="py-2 text-right tabular-nums">{fmt(ledger.data.openingPaise)}</td></tr>}
                  {ledger.data.data.map((r, i) => (
                    <tr key={`${r.number}-${i}`} className="border-t">
                      <td className="py-2 pr-3">{formatDate(r.date)}</td>
                      <td className="py-2 pr-3"><Link href={`/app/m/purchase/${r.id}`} className="hover:underline">{KIND[r.kind] ?? r.kind} <span className="font-mono text-xs">{r.number}</span></Link></td>
                      <td className="py-2 pr-3 text-muted-foreground">{r.details}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.billPaise ? formatPaise(r.billPaise) : ""}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.paidPaise ? formatPaise(r.paidPaise) : ""}</td>
                      <td className="py-2 text-right tabular-nums">{fmt(r.balancePaise)}</td>
                    </tr>
                  ))}
                  {!ledger.data.data.length && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No bills or payments in this period</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-right text-sm font-semibold">Closing: {fmt(ledger.data.closingPaise)}</p>
          </CardContent>
        </Card>
      )}
      <SupplierDialog open={editing} onOpenChange={setEditing} supplier={s} onSaved={(n) => sup.setData(n)} />
    </>
  )
}
