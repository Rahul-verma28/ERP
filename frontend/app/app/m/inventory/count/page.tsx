"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { SearchInput, Spinner } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { qty, type StockEntry, type StockLocation, type StockRow } from "@/lib/inventory"

// Count what is on the shelf. Only items with a count typed in are posted; each difference
// against the books becomes a count entry today.

export default function StockCountPage() {
  const router = useRouter()
  const { can } = useAuth()
  const locations = useApi<{ data: StockLocation[] }>("/stock-locations")
  const godowns = (locations.data?.data ?? []).filter((l) => l.isActive)
  const [locationId, setLocationId] = React.useState("")
  const at = locationId || godowns.find((g) => g.isDefault)?.id || godowns[0]?.id || ""
  const stock = useApi<{ data: StockRow[] }>(at ? `/stock?locationId=${at}` : null)
  const [counted, setCounted] = React.useState<Record<string, string>>({})
  const [blind, setBlind] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [note, setNote] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  if (!can("inventory.stock_count.create")) return <PageHeader title="Stock count" description="You don't have access to counts. Ask your admin." />
  if (!locations.data) return <div className="grid place-items-center py-24"><Spinner /></div>

  const rows = (stock.data?.data ?? []).filter((r) => r.isActive && (!search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.sku ?? "").toLowerCase().includes(search.toLowerCase())))
  const filled = Object.entries(counted).filter(([, v]) => v !== "")
  const differences = filled.filter(([id, v]) => Number(v) !== (stock.data?.data.find((r) => r.id === id)?.quantity ?? 0)).length

  async function post() {
    if (!filled.length) return setError("Type a count for at least one item")
    setBusy(true)
    setError(null)
    try {
      const entry = await api.post<StockEntry>("/stock/counts", { locationId: at, note: note || null, lines: filled.map(([itemId, v]) => ({ itemId, counted: Number(v) })) })
      toast.success(differences ? `Count posted · ${differences} difference${differences === 1 ? "" : "s"}` : "Count posted · no differences")
      router.push(`/app/m/inventory/entries/${entry.id}`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <>
      <Link href="/app/m/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Stock</Link>
      <PageHeader title="Stock count" description="Type what you count. Items left blank are not changed. Differences are posted today." />
      <Card>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
            {godowns.length > 1 ? (
              <Field label="Godown">
                <NativeSelect value={at} onChange={(e) => { setLocationId(e.target.value); setCounted({}) }} aria-label="Godown">
                  {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </NativeSelect>
              </Field>
            ) : <span />}
            <SearchInput value={search} onChange={setSearch} placeholder="Find an item" />
            <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground"><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> Hide book quantity</label>
          </div>
          {!stock.data ? <div className="grid place-items-center py-10"><Spinner /></div> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No tracked items here yet.</p> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Item</th>
                  {!blind && <th className="py-2 pr-3 text-right font-medium">Books</th>}
                  <th className="py-2 pr-3 text-right font-medium">Counted</th>
                  {!blind && <th className="py-2 text-right font-medium">Difference</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const v = counted[r.id] ?? ""
                  const diff = v === "" ? null : Number(v) - r.quantity
                  return (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="py-2 pr-3">{r.name}<span className="block text-xs text-muted-foreground">{r.unit}</span></td>
                      {!blind && <td className="py-2 pr-3 text-right tabular-nums">{qty(r.quantity)}</td>}
                      <td className="py-2 pr-3 text-right"><Input inputMode="decimal" value={v} onChange={(e) => setCounted((c) => ({ ...c, [r.id]: e.target.value.replace(/[^\d.]/g, "") }))} className="ml-auto h-8 w-24 text-right" aria-label={`Counted ${r.name}`} /></td>
                      {!blind && <td className={"py-2 text-right tabular-nums" + (diff !== null && diff < 0 ? " text-destructive" : "")}>{diff === null ? "" : `${diff > 0 ? "+" : ""}${qty(diff)}`}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
          <FormError message={error} />
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-muted-foreground">{filled.length} counted · {differences} different</span>
            <Button disabled={busy} onClick={post}>{busy ? "Posting…" : "Post count"}</Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
