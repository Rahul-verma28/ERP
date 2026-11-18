"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { MoneyInput, SearchInput, Spinner } from "@/components/common"
import { Field, FormError } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"
import { useDebounced } from "@/lib/use-list"
import { formatPaise } from "@/lib/format"

// A price list's name, its discount on everything, and exact prices for some items. Used from the
// list of price lists and from a price list's own page.

export interface PriceList {
  id: string
  name: string
  discountBp: number
  itemCount: number
  customerCount: number
  customers?: string[]
  sold30Paise?: number
  createdAt?: string
}
interface Item { id: string; name: string; pricePaise: number }

export function PriceListDialog({ list, onClose, onSaved }: { list: Pick<PriceList, "id" | "name" | "discountBp"> | null; onClose: () => void; onSaved: (id: string) => void }) {
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
      onSaved(row.id)
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
            <Field label="Discount %" error={errors.discountBp}><NumberStepper decimals max={100} suffix="%" value={discount} onChange={setDiscount} placeholder="e.g. 10" /></Field>
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
