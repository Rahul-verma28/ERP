"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, PackageCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/common"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { ENTRY_LABEL, REASONS, qty, type StockEntry } from "@/lib/inventory"

export default function StockEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { can } = useAuth()
  const { data: e, error, setData } = useApi<StockEntry>(`/stock/entries/${id}`)
  const [busy, setBusy] = React.useState(false)
  if (error) return <p className="text-sm text-muted-foreground">{error.message}</p>
  if (!e) return <div className="grid place-items-center py-24"><Spinner /></div>
  const showValue = can("inventory.valuation.view") || can("inventory.receipt.create")
  const count = e.kind === "count"
  const costed = e.lines.some((l) => l.ratePaise != null)

  async function receive() {
    setBusy(true)
    try {
      setData(await api.post<StockEntry>(`/stock/entries/${id}/receive`))
      toast.success("Received. Stock is in the warehouse now.")
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Link href="/app/m/inventory/entries" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Stock entries</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {ENTRY_LABEL[e.kind]}
            {e.status === "in_transit" && <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">On the way</Badge>}
            {e.status === "received" && <Badge variant="outline">Received {e.receivedAt ? formatDate(e.receivedAt) : ""}</Badge>}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[formatDate(e.entryDate), e.toLocation ? `${e.location} → ${e.toLocation}` : e.location, e.reason ? REASONS.find((r) => r.value === e.reason)?.label : null, e.party, e.reference, showValue ? formatPaise(e.valuePaise) : null].filter(Boolean).join(" · ")}
          </p>
          {e.note && <p className="mt-2 text-sm">{e.note}</p>}
        </div>
        {e.status === "in_transit" && can("inventory.transfer.create") && <Button disabled={busy} onClick={receive}><PackageCheck /> {busy ? "Receiving…" : `Received at ${e.toLocation}`}</Button>}
      </div>
      <Card className="mt-6">
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Item</th>
                {count ? (
                  <>
                    <th className="py-2 pr-3 text-right font-medium">Books</th>
                    <th className="py-2 pr-3 text-right font-medium">Counted</th>
                    <th className="py-2 text-right font-medium">Difference</th>
                  </>
                ) : (
                  <>
                    <th className="py-2 pr-3 text-right font-medium">Quantity</th>
                    {showValue && costed && <th className="py-2 text-right font-medium">Cost per unit</th>}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {e.lines.map((l, i) => (
                <tr key={i} className="border-b border-border/60 align-top">
                  <td className="py-2 pr-3">
                    <Link href={`/app/m/inventory/items/${l.itemId}`} className="hover:underline">{l.name}</Link>
                    {l.batch && <span className="block text-xs text-muted-foreground">Batch {l.batch}</span>}
                    {!!l.batches?.length && <span className="block text-xs text-muted-foreground">{l.batches.map((b) => `Batch ${b.number}${b.expiry ? ` · exp ${formatDate(b.expiry)}` : ""}${l.batches!.length > 1 ? ` (${qty(b.quantity)})` : ""}`).join(", ")}</span>}
                    {!!l.serials?.length && <span className="block text-xs text-muted-foreground">S/N: {l.serials.join(", ")}</span>}
                  </td>
                  {count ? (
                    <>
                      <td className="py-2 pr-3 text-right tabular-nums">{qty(l.system ?? 0)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{qty(l.counted ?? 0)}</td>
                      <td className={"py-2 text-right font-medium tabular-nums" + ((l.difference ?? 0) < 0 ? " text-destructive" : "")}>{(l.difference ?? 0) > 0 ? "+" : ""}{qty(l.difference ?? 0)}</td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-3 text-right tabular-nums">{qty(l.quantity ?? 0)} {l.unit ?? ""}{l.baseQuantity !== undefined && l.baseQuantity !== l.quantity && <span className="block text-xs text-muted-foreground">{qty(l.baseQuantity)} in base unit</span>}</td>
                      {showValue && costed && <td className="py-2 text-right tabular-nums">{l.ratePaise != null ? formatPaise(l.ratePaise) : "—"}</td>}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  )
}
