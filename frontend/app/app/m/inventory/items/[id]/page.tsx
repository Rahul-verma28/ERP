"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/common"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { qty } from "@/lib/inventory"

// One item's stock ledger: every move, where it came from, and the balance after it.

interface Ledger {
  item: { id: string; name: string; sku: string | null; unit: string; reorderLevel: number | null }
  quantity: number
  valuePaise: number
  averagePaise: number
  byLocation: { locationId: string; location: string; quantity: number; valuePaise: number }[]
  rows: {
    id: string; date: string; kind: string; label: string; location: string; quantity: number; ratePaise: number; valuePaise: number; balance: number
    sourceType: string; sourceId: string; reversal: boolean; document: { number: string | null; kind: string; party: string | null } | null
  }[]
}

const DOC_HREF: Record<string, string> = { invoice: "/app/m/billing/", delivery_challan: "/app/m/sales/challans/", credit_note: "/app/m/billing/credit-notes/", stock_entry: "/app/m/inventory/entries/" }

export default function ItemStockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { can } = useAuth()
  const { data, error } = useApi<Ledger>(`/stock/items/${id}`)
  const showValue = can("inventory.valuation.view") || can("inventory.receipt.create")

  if (error) return <p className="text-sm text-muted-foreground">{error.message}</p>
  if (!data) return <div className="grid place-items-center py-24"><Spinner /></div>
  const u = data.item.unit
  return (
    <>
      <Link href="/app/m/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Stock</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{data.item.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{[data.item.sku, data.item.reorderLevel !== null ? `Low-stock level ${qty(data.item.reorderLevel)} ${u}` : null].filter(Boolean).join(" · ") || "Stock ledger"}</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-muted p-4"><p className="text-xs text-muted-foreground">In stock</p><p className={"mt-1 text-xl font-semibold tabular-nums" + (data.quantity < 0 ? " text-destructive" : "")}>{qty(data.quantity)} {u}</p></div>
        {showValue && <div className="rounded-2xl bg-muted p-4"><p className="text-xs text-muted-foreground">Value</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatPaise(data.valuePaise)}</p></div>}
        {showValue && <div className="rounded-2xl bg-muted p-4"><p className="text-xs text-muted-foreground">Average cost</p><p className="mt-1 text-xl font-semibold tabular-nums">{data.quantity > 0 ? formatPaise(data.averagePaise) : "—"}</p></div>}
      </div>

      {data.byLocation.length > 1 && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">By godown</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {data.byLocation.map((b) => <li key={b.locationId} className="flex justify-between"><span>{b.location}</span><span className="tabular-nums">{qty(b.quantity)} {u}</span></li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Ledger</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No movement yet.</p>
          ) : (
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">What</th>
                  <th className="py-2 pr-3 font-medium">Godown</th>
                  <th className="py-2 pr-3 text-right font-medium">In</th>
                  <th className="py-2 pr-3 text-right font-medium">Out</th>
                  {showValue && <th className="py-2 pr-3 text-right font-medium">Rate</th>}
                  <th className="py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="py-2 pr-3">
                      <Link href={`${DOC_HREF[r.sourceType] ?? "#"}${r.sourceId}`} className="hover:underline">
                        {r.label}{r.document?.number && <span className="ml-1 font-mono text-xs">{r.document.number}</span>}
                      </Link>
                      {r.reversal && <Badge variant="outline" className="ml-2">Undone</Badge>}
                      {r.document?.party && <span className="block text-xs text-muted-foreground">{r.document.party}</span>}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{r.location}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.quantity > 0 ? qty(r.quantity) : ""}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.quantity < 0 ? qty(-r.quantity) : ""}</td>
                    {showValue && <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatPaise(r.ratePaise)}</td>}
                    <td className={"py-2 text-right font-medium tabular-nums" + (r.balance < 0 ? " text-destructive" : "")}>{qty(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
