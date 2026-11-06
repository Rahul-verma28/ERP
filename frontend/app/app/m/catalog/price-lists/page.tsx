"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, Plus, Tags, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState, MoneyInput, SearchInput, Spinner } from "@/components/common"
import { Field, FormError } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useDebounced } from "@/lib/use-list"
import { formatPaise } from "@/lib/format"

// Rates for a group of customers: a discount on everything, and exact prices for some items.

interface PriceList {
  id: string
  name: string
  discountBp: number
  itemCount: number
  customerCount: number
}
interface Item {
  id: string
  name: string
  pricePaise: number
}

function PriceListDialog({ list, onClose, onSaved }: { list: PriceList | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(list?.name ?? "")
  const [discount, setDiscount] = React.useState(list ? String(list.discountBp / 100) : "")
  const [search, setSearch] = React.useState("")
  const q = useDebounced(search, 250)
  const items = useApi<{ data: Item[] }>(`/items?limit=50${q ? `&q=${encodeURIComponent(q)}` : ""}`)
  const saved = useApi<{ data: { itemId: string; pricePaise: number }[] }>(list ? `/price-lists/${list.id}/items` : null)
  const [edits, setEdits] = React.useState<Record<string, number | null>>({})
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const discountBp = Math.round(Number(discount || 0) * 100)
  const exact = (id: string) => (id in edits ? edits[id] : saved.data?.data.find((r) => r.itemId === id)?.pricePaise ?? null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setErrors({ name: "Use at least 2 characters" })
    if (discountBp < 0 || discountBp > 10_000) return setErrors({ discountBp: "Enter 0 to 100" })
    setBusy(true)
    setError(null)
    try {
      const body = { name: name.trim(), discountBp }
      const row = list ? await api.patch<{ id: string }>(`/price-lists/${list.id}`, body) : await api.post<{ id: string }>("/price-lists", body)
      for (const [itemId, pricePaise] of Object.entries(edits)) await api.put(`/price-lists/${row.id}/items/${itemId}`, { pricePaise })
      toast.success("Price list saved")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{list ? `Edit ${list.name}` : "New price list"}</DialogTitle>
          <DialogDescription>The discount applies to every item. An exact price below wins over it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wholesale" autoFocus /></Field>
            <Field label="Discount %" error={errors.discountBp}><Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></Field>
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search items" />
          {!items.data ? <div className="grid place-items-center py-6"><Spinner /></div> : items.data.data.length === 0 ? <p className="text-sm text-muted-foreground">No items yet.</p> : (
            <ul className="grid gap-2">
              {items.data.data.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    {it.name}
                    <span className="block text-xs text-muted-foreground">Standard {formatPaise(it.pricePaise)} · With discount {formatPaise(Math.round((it.pricePaise * (10_000 - discountBp)) / 10_000))}</span>
                  </span>
                  <div className="w-32 shrink-0"><MoneyInput value={exact(it.id)} onChange={(v) => setEdits({ ...edits, [it.id]: v })} aria-label={`Exact price for ${it.name}`} /></div>
                </li>
              ))}
            </ul>
          )}
          <FormError message={error} />
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save price list"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function PriceListsPage() {
  const { can } = useAuth()
  const { data, error, reload } = useApi<{ data: PriceList[] }>(can("catalog.price_list.view") ? "/price-lists" : null)
  const [editing, setEditing] = React.useState<PriceList | "new" | null>(null)
  const [removing, setRemoving] = React.useState<PriceList | null>(null)

  if (!can("catalog.price_list.view")) return <PageHeader title="Price lists" description="You don't have access to price lists. Ask your admin." />

  const add = can("catalog.price_list.create") && <Button onClick={() => setEditing("new")}><Plus /> New price list</Button>
  return (
    <>
      <Link href="/app/m/catalog" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Items</Link>
      <PageHeader title="Price lists" description="Wholesale, retail or any other rates. Choose a list on the customer, and their new bills use it." actions={add || undefined} />
      {error ? <p className="text-sm text-muted-foreground">{error.message}</p> : !data ? <div className="grid place-items-center py-24"><Spinner /></div> : data.data.length === 0 ? (
        <EmptyState icon={Tags} title="No price lists yet" description="Make one for wholesale customers, then choose it on those customers." action={add || undefined} />
      ) : (
        <Card>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 text-right font-medium">Discount</th>
                  <th className="py-2 pr-3 text-right font-medium">Exact prices</th>
                  <th className="py-2 pr-3 text-right font-medium">Customers</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((l) => (
                  <tr key={l.id} className="border-b border-border/60">
                    <td className="py-2 pr-3">{can("catalog.price_list.edit") ? <button className="font-medium hover:underline" onClick={() => setEditing(l)}>{l.name}</button> : l.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.discountBp / 100}%</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.itemCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.customerCount}</td>
                    <td className="py-2 text-right">{can("catalog.price_list.delete") && <Button variant="ghost" size="icon-xs" aria-label={`Delete ${l.name}`} onClick={() => setRemoving(l)}><Trash2 /></Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {editing && <PriceListDialog list={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        title={`Delete ${removing?.name}?`}
        description={`${removing?.customerCount ?? 0} customers go back to standard prices. Bills already made don't change.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/price-lists/${removing!.id}`)
            toast.success("Price list deleted")
            await reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
