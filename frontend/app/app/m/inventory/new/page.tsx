"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { MoneyInput, Spinner } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ItemPicker, type ItemOption } from "@/components/pickers"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import { ENTRY_LABEL, REASONS, qty, type StockEntry, type StockLocation, type StockRow } from "@/lib/inventory"
import { todayInIndia } from "@contracts/validation"

// One form for opening stock, stock in, adjustments and transfers. Lines are items with a quantity,
// and a cost where stock comes in from outside.

type Kind = "opening" | "stock_in" | "adjustment" | "transfer"
type Line = { itemId: string; name: string; unit: string; quantity: string; ratePaise: number | null }

const HINT: Record<Kind, string> = {
  opening: "What you have on the day you start. Each item gets opening stock once per godown.",
  stock_in: "Goods that came in, with what they cost. Use this until Purchase is set up.",
  adjustment: "Damage, loss, samples or stock found. Needs a reason.",
  transfer: "Move stock from one godown to another. Cost moves with it.",
}

function EntryForm() {
  const router = useRouter()
  const params = useSearchParams()
  const kind = (["opening", "stock_in", "adjustment", "transfer"].includes(params.get("kind") ?? "") ? params.get("kind") : "stock_in") as Kind
  const { can } = useAuth()
  const locations = useApi<{ data: StockLocation[] }>("/stock-locations")
  const godowns = (locations.data?.data ?? []).filter((l) => l.isActive)
  const [locationId, setLocationId] = React.useState("")
  const [toLocationId, setToLocationId] = React.useState("")
  const from = locationId || godowns.find((g) => g.isDefault)?.id || godowns[0]?.id || ""
  const stock = useApi<{ data: StockRow[] }>(from ? `/stock?locationId=${from}` : null)
  const [date, setDate] = React.useState(todayInIndia())
  const [reason, setReason] = React.useState("")
  const [direction, setDirection] = React.useState<"in" | "out">("out")
  const [party, setParty] = React.useState("")
  const [reference, setReference] = React.useState("")
  const [note, setNote] = React.useState("")
  const [lines, setLines] = React.useState<Line[]>([])
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const costed = kind === "opening" || kind === "stock_in"
  const inStock = (itemId: string) => stock.data?.data.find((r) => r.id === itemId)?.quantity

  const perm = { opening: "inventory.receipt.create", stock_in: "inventory.receipt.create", adjustment: "inventory.stock_adjustment.create", transfer: "inventory.transfer.create" }[kind]
  if (!can(perm)) return <PageHeader title={ENTRY_LABEL[kind]} description="You don't have access to this. Ask your admin." />
  if (!locations.data) return <div className="grid place-items-center py-24"><Spinner /></div>

  const pick = (it: ItemOption) => {
    if (it.type !== "product") return toast.error(`${it.name} is a service, so it has no stock`)
    if (lines.some((l) => l.itemId === it.id)) return toast.error(`${it.name} is already on the list`)
    if (!costed && inStock(it.id) === undefined) return toast.error(`${it.name} has no stock yet. Add opening stock or a stock in first.`)
    const cost = (it as ItemOption & { costPricePaise?: number | null }).costPricePaise
    setLines((ls) => [...ls, { itemId: it.id, name: it.name, unit: it.unit, quantity: "", ratePaise: costed ? cost ?? null : null }])
  }
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (l.ratePaise ?? 0), 0)

  async function save() {
    const errs: Record<string, string> = {}
    if (!lines.length) errs.lines = "Add at least one item"
    lines.forEach((l, i) => {
      if (!(Number(l.quantity) > 0)) errs[`lines.${i}.quantity`] = "Enter more than 0"
      if (costed && l.ratePaise === null) errs[`lines.${i}.ratePaise`] = "Enter the cost"
    })
    if (kind === "adjustment" && !reason) errs.reason = "Choose a reason"
    if (kind === "transfer" && !toLocationId) errs.toLocationId = "Choose where it goes"
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    try {
      const entry = await api.post<StockEntry>("/stock/entries", {
        kind, locationId: from, toLocationId: kind === "transfer" ? toLocationId : null, date,
        reason: kind === "adjustment" ? reason : null, direction: kind === "adjustment" ? direction : undefined,
        party: party || null, reference: reference || null, note: note || null,
        lines: lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), ...(costed ? { ratePaise: l.ratePaise ?? 0 } : {}) })),
      })
      toast.success(`${ENTRY_LABEL[kind]} saved`)
      router.push(`/app/m/inventory/entries/${entry.id}`)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <>
      <Link href="/app/m/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Stock</Link>
      <PageHeader title={ENTRY_LABEL[kind]} description={HINT[kind]} />
      <Card>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {godowns.length > 1 && (
              <Field label={kind === "transfer" ? "From godown" : "Godown"}>
                <NativeSelect value={from} onChange={(e) => setLocationId(e.target.value)} aria-label="Godown">
                  {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </NativeSelect>
              </Field>
            )}
            {kind === "transfer" && (
              <Field label="To godown" required error={errors.toLocationId}>
                <NativeSelect value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} aria-label="To godown">
                  <option value="">Choose</option>
                  {godowns.filter((g) => g.id !== from).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </NativeSelect>
              </Field>
            )}
            <Field label="Date" error={errors.date}><Input type="date" value={date} max={todayInIndia()} onChange={(e) => setDate(e.target.value)} /></Field>
            {kind === "adjustment" && (
              <>
                <Field label="Reason" required error={errors.reason}>
                  <NativeSelect value={reason} onChange={(e) => {
                    const r = REASONS.find((x) => x.value === e.target.value)
                    setReason(e.target.value)
                    if (r?.direction) setDirection(r.direction)
                  }} aria-label="Reason">
                    <option value="">Choose</option>
                    {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="Stock">
                  <NativeSelect value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")} aria-label="Add or remove">
                    <option value="out">Remove from stock</option>
                    <option value="in">Add to stock</option>
                  </NativeSelect>
                </Field>
              </>
            )}
            {kind === "stock_in" && (
              <>
                <Field label="Supplier"><Input value={party} onChange={(e) => setParty(e.target.value)} maxLength={100} /></Field>
                <Field label="Bill or challan no."><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={50} /></Field>
              </>
            )}
          </div>

          <div className="grid gap-2">
            {lines.length > 0 && (
              <div className="hidden grid-cols-[1fr_7rem_9rem_2rem] gap-2 px-1 text-xs text-muted-foreground sm:grid">
                <span>Item</span><span>Quantity</span><span>{costed ? "Cost per unit" : ""}</span><span />
              </div>
            )}
            {lines.map((l, i) => {
              const have = inStock(l.itemId)
              return (
                <div key={l.itemId} className="grid items-start gap-2 rounded-2xl border p-2 sm:grid-cols-[1fr_7rem_9rem_2rem] sm:border-0 sm:p-0">
                  <div className="py-2 text-sm">
                    <span className="font-medium">{l.name}</span>
                    {have !== undefined && <span className="block text-xs text-muted-foreground">{qty(have)} {l.unit} in stock{kind === "adjustment" || kind === "transfer" ? ` · after: ${qty(direction === "in" && kind === "adjustment" ? have + (Number(l.quantity) || 0) : have - (Number(l.quantity) || 0))}` : ""}</span>}
                  </div>
                  <Field label="" error={errors[`lines.${i}.quantity`]}>
                    <Input inputMode="decimal" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value.replace(/[^\d.]/g, "") })} aria-label={`Quantity of ${l.name}`} placeholder={l.unit} />
                  </Field>
                  {costed ? (
                    <Field label="" error={errors[`lines.${i}.ratePaise`]}><MoneyInput value={l.ratePaise} onChange={(v) => update(i, { ratePaise: v })} aria-label={`Cost of ${l.name}`} /></Field>
                  ) : <span />}
                  <Button variant="ghost" size="icon-sm" className="mt-1" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove ${l.name}`}><Trash2 /></Button>
                </div>
              )
            })}
            <ItemPicker onPick={pick} placeholder="Search products to add" />
            {errors.lines && <p className="text-xs text-destructive">{errors.lines}</p>}
            {costed && total > 0 && <p className="text-right text-sm font-medium">Value: <span className="tabular-nums">{formatPaise(Math.round(total))}</span></p>}
          </div>

          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button disabled={busy} onClick={save}>{busy ? "Saving…" : `Save ${ENTRY_LABEL[kind].toLowerCase()}`}</Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

export default function NewStockEntryPage() {
  return (
    <React.Suspense>
      <EntryForm />
    </React.Suspense>
  )
}
