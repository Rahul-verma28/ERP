"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { Spinner } from "@/components/common"
import { PurchaseNav } from "@/components/purchase-list"
import { SupplierPicker, type ContactOption } from "@/components/pickers"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import { qty } from "@/lib/inventory"

// Items at or under their low-stock level, less what is already on order. Pick quantities and a
// supplier; one purchase order is made per supplier at the last purchase price.

interface Row { id: string; itemId: string; name: string; unit: string; available: number; reorderLevel: number; onOrder: number; suggest: number; supplierId: string | null; supplier: string | null; ratePaise: number | null }
type Pick = { on: boolean; quantity: string; supplier: ContactOption | null }

export default function ReorderPage() {
  const { can } = useAuth()
  const router = useRouter()
  const list = useApi<{ data: Row[] }>(can("inventory.purchase_order.view") ? "/purchases/reorder" : null)
  const [picks, setPicks] = React.useState<Record<string, Pick>>({})
  const [busy, setBusy] = React.useState(false)
  const suggested = (r: Row): Pick => ({ on: r.suggest > 0 && !!r.supplierId, quantity: String(r.suggest || ""), supplier: r.supplierId ? { id: r.supplierId, name: r.supplier ?? "" } : null })
  const pickOf = (r: Row) => picks[r.itemId] ?? suggested(r)
  if (!can("inventory.purchase_order.view")) return <PageHeader title="Low stock" description="You don't have access to this. Ask your admin." />
  if (!list.data) return <div className="grid place-items-center py-24"><Spinner /></div>
  const rows = list.data.data
  const set = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { ...(p[id] ?? suggested(rows.find((r) => r.itemId === id)!)), ...patch } }))
  const chosen = rows.filter((r) => pickOf(r).on && Number(pickOf(r).quantity) > 0 && pickOf(r).supplier)

  async function make() {
    setBusy(true)
    try {
      const r = await api.post<{ data: { id: string; number: string; supplier: string }[] }>("/purchases/reorder", { lines: chosen.map((c) => ({ itemId: c.itemId, contactId: pickOf(c).supplier!.id, quantity: Number(pickOf(c).quantity) })) })
      toast.success(`${r.data.length} purchase order${r.data.length > 1 ? "s" : ""} made: ${r.data.map((d) => d.number).join(", ")}`)
      router.push(r.data.length === 1 ? `/app/m/purchase/${r.data[0].id}` : "/app/m/purchase/orders")
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Low stock" description="Items at or under their low-stock level. Suggested quantity fills back to twice that level, less what is already ordered." actions={<div className="flex flex-wrap gap-2"><PurchaseNav /></div>} />
      <Card>
        <CardContent className="grid gap-3">
          {!list.data.data.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing is low. Set a low-stock level on items in <Link href="/app/m/catalog" className="text-primary hover:underline">Products</Link> to see them here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2 pr-3" /><th className="py-2 pr-3">Item</th><th className="py-2 pr-3 text-right">Available</th><th className="py-2 pr-3 text-right">Low level</th><th className="py-2 pr-3 text-right">On order</th><th className="py-2 pr-3">Order qty</th><th className="py-2 pr-3">Supplier</th><th className="py-2 text-right">Last price</th></tr></thead>
                <tbody>
                  {list.data.data.map((r) => {
                    const p = pickOf(r)
                    return (
                      <tr key={r.itemId} className="border-t align-middle">
                        <td className="py-2 pr-3"><input type="checkbox" checked={p.on} onChange={(e) => set(r.itemId, { on: e.target.checked })} aria-label={`Order ${r.name}`} /></td>
                        <td className="py-2 pr-3 font-medium"><Link href={`/app/m/inventory/items/${r.itemId}`} className="hover:underline">{r.name}</Link></td>
                        <td className="py-2 pr-3 text-right tabular-nums text-amber-700 dark:text-amber-300">{qty(r.available)} {r.unit}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{qty(r.reorderLevel)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.onOrder ? qty(r.onOrder) : "—"}</td>
                        <td className="py-2 pr-3"><Input value={p.quantity} onChange={(e) => set(r.itemId, { quantity: e.target.value.replace(/[^\d.]/g, ""), on: true })} inputMode="decimal" className="h-9 w-24" aria-label={`Quantity of ${r.name}`} /></td>
                        <td className="min-w-56 py-2 pr-3"><SupplierPicker value={p.supplier} onChange={(s) => set(r.itemId, { supplier: s })} /></td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">{r.ratePaise ? formatPaise(r.ratePaise) : "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {can("inventory.purchase_order.create") && !!list.data.data.length && (
            <div className="flex justify-end">
              <Button disabled={busy || !chosen.length} onClick={make}>{busy ? "Making…" : `Make purchase orders (${chosen.length})`}</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
