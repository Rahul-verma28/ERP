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
import { MoneyInput } from "@/components/common"
import { WarehouseSelect } from "@/components/creatable-select"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ItemPicker, type ItemOption } from "@/components/pickers"
import { parseSerials } from "@/components/stock-line"
import { NumberStepper } from "@/components/number-stepper"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { ENTRY_LABEL, REASONS, qty, type BatchRow, type StockEntry, type StockLocation, type StockRow, type Tracking } from "@/lib/inventory"
import { todayInIndia } from "@contracts/validation"
import { PageLoading } from "@/components/page-states"

// One form for opening stock, stock in, adjustments and transfers. Lines are items with a quantity
// (in the base unit or the second unit), a cost where stock comes in from outside, a batch with expiry
// for batch items, and serial numbers for serial items.

type Kind = "opening" | "stock_in" | "adjustment" | "transfer"
type Line = {
  key: string
  itemId: string
  name: string
  unit: string
  tracking: Tracking
  altUnit: string | null
  altFactor: number | null
  useAlt: boolean
  quantity: string
  ratePaise: number | null
  batchNo: string
  mfgDate: string
  expiryDate: string
  batchId: string
  serialText: string
}

const HINT: Record<Kind, string> = {
  opening: "What you have on the day you start. Each item gets opening stock once per warehouse.",
  stock_in: "Goods that came in without a purchase bill, such as from another shop of yours. For supplier goods, use Purchase.",
  adjustment: "Damage, loss, samples, expired stock or stock found. Needs a reason.",
  transfer: "Move stock from one warehouse to another. Cost moves with it.",
}

function BatchPicker({ itemId, locationId, value, onChange, includeExpired }: { itemId: string; locationId: string; value: string; onChange: (v: string) => void; includeExpired: boolean }) {
  const batches = useApi<{ data: BatchRow[] }>(locationId ? `/stock/items/${itemId}/batches?locationId=${locationId}${includeExpired ? "&expired=true" : ""}` : null).data?.data
  return (
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} aria-label="Batch">
      <option value="">Earliest expiry first</option>
      {(batches ?? []).map((b) => <option key={b.id} value={b.id}>{b.number}{b.expiryDate ? ` · exp ${formatDate(b.expiryDate)}` : ""}{b.expired ? " (expired)" : ""} · {qty(b.quantity)}</option>)}
    </NativeSelect>
  )
}

function EntryForm() {
  const router = useRouter()
  const params = useSearchParams()
  const kind = (["opening", "stock_in", "adjustment", "transfer"].includes(params.get("kind") ?? "") ? params.get("kind") : "stock_in") as Kind
  const { can } = useAuth()
  const locations = useApi<{ data: StockLocation[] }>("/stock-locations")
  const warehouses = (locations.data?.data ?? []).filter((l) => l.isActive)
  const [locationId, setLocationId] = React.useState("")
  const [toLocationId, setToLocationId] = React.useState("")
  const from = locationId || warehouses.find((g) => g.isDefault)?.id || warehouses[0]?.id || ""
  const stock = useApi<{ data: StockRow[] }>(from ? `/stock?locationId=${from}` : null)
  const [date, setDate] = React.useState(todayInIndia())
  const [reason, setReason] = React.useState("")
  const [direction, setDirection] = React.useState<"in" | "out">("out")
  const [receiveNow, setReceiveNow] = React.useState(true)
  const [party, setParty] = React.useState("")
  const [reference, setReference] = React.useState("")
  const [note, setNote] = React.useState("")
  const [lines, setLines] = React.useState<Line[]>([])
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const costed = kind === "opening" || kind === "stock_in"
  const incoming = costed || (kind === "adjustment" && direction === "in")
  const inStock = (itemId: string) => stock.data?.data.find((r) => r.id === itemId)?.quantity

  const perm = { opening: "inventory.receipt.create", stock_in: "inventory.receipt.create", adjustment: "inventory.stock_adjustment.create", transfer: "inventory.transfer.create" }[kind]
  if (!can(perm)) return <PageHeader title={ENTRY_LABEL[kind]} description="You don't have access to this. Ask your admin." />
  if (!locations.data) return <PageLoading />

  const pick = (picked: ItemOption) => {
    const it = picked as ItemOption & { costPricePaise?: number | null; tracking?: Tracking; altUnit?: string | null; altFactor?: number | null }
    if (it.type !== "product") return toast.error(`${it.name} is a service, so it has no stock`)
    if (it.tracking !== "batch" && lines.some((l) => l.itemId === it.id)) return toast.error(`${it.name} is already on the list`)
    if (!costed && inStock(it.id) === undefined) return toast.error(`${it.name} has no stock yet. Add opening stock or a stock in first.`)
    setLines((ls) => [...ls, {
      key: `${it.id}-${ls.length}-${Date.now()}`, itemId: it.id, name: it.name, unit: it.unit, tracking: it.tracking ?? "none", altUnit: it.altUnit ?? null, altFactor: it.altFactor ?? null,
      useAlt: false, quantity: "", ratePaise: costed ? it.costPricePaise ?? null : null, batchNo: "", mfgDate: "", expiryDate: "", batchId: "", serialText: "",
    }])
  }
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const lineQty = (l: Line) => (l.tracking === "serial" ? parseSerials(l.serialText).length : Number(l.quantity) || 0)
  const total = lines.reduce((s, l) => s + lineQty(l) * (l.ratePaise ?? 0), 0)

  async function save() {
    const errs: Record<string, string> = {}
    if (!lines.length) errs.lines = "Add at least one item"
    lines.forEach((l, i) => {
      if (!(lineQty(l) > 0)) errs[`lines.${i}.quantity`] = l.tracking === "serial" ? "Enter the serial numbers" : "Enter more than 0"
      if (costed && l.ratePaise === null) errs[`lines.${i}.ratePaise`] = "Enter the cost"
      if (incoming && l.tracking === "batch" && !l.batchNo.trim()) errs[`lines.${i}.batchNo`] = "Enter the batch"
    })
    if (kind === "adjustment" && !reason) errs.reason = "Choose a reason"
    if (kind === "transfer" && !toLocationId) errs.toLocationId = "Choose where it goes"
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    try {
      const entry = await api.post<StockEntry>("/stock/entries", {
        kind, locationId: from, toLocationId: kind === "transfer" ? toLocationId : null, date, receiveNow: kind === "transfer" ? receiveNow : undefined,
        reason: kind === "adjustment" ? reason : null, direction: kind === "adjustment" ? direction : undefined,
        party: party || null, reference: reference || null, note: note || null,
        lines: lines.map((l) => ({
          itemId: l.itemId, quantity: lineQty(l), unit: l.useAlt ? "alt" : "base",
          ...(costed ? { ratePaise: l.ratePaise ?? 0 } : {}),
          ...(l.tracking === "batch" && incoming ? { batchNo: l.batchNo.trim(), mfgDate: l.mfgDate || null, expiryDate: l.expiryDate || null } : {}),
          ...(l.tracking === "batch" && !incoming && l.batchId ? { batchId: l.batchId } : {}),
          ...(l.tracking === "serial" ? { serials: parseSerials(l.serialText) } : {}),
        })),
      })
      toast.success(entry.status === "in_transit" ? "Sent. Receive it at the other warehouse when it arrives." : `${ENTRY_LABEL[kind]} saved`)
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
            <Field label={kind === "transfer" ? "From warehouse" : "Warehouse"}>
              <WarehouseSelect value={from} onChange={setLocationId} aria-label="Warehouse" />
            </Field>
            {kind === "transfer" && (
              <Field label="To warehouse" required error={errors.toLocationId}>
                <WarehouseSelect value={toLocationId} onChange={setToLocationId} aria-label="To warehouse" aria-invalid={!!errors.toLocationId} />
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
          {kind === "transfer" && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={!receiveNow} onChange={(e) => setReceiveNow(!e.target.checked)} />
              <span><span className="font-medium">Goods are on the way</span><span className="block text-muted-foreground">Stock leaves now and arrives when the other warehouse receives it.</span></span>
            </label>
          )}

          <div className="grid gap-3">
            {lines.map((l, i) => {
              const have = inStock(l.itemId)
              const n = lineQty(l)
              const base = l.useAlt && l.altFactor ? n * l.altFactor : n
              return (
                <div key={l.key} className="grid gap-2 rounded-2xl border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-medium">{l.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {have !== undefined ? `${qty(have)} ${l.unit} in stock` : "No stock yet"}
                        {(kind === "adjustment" || kind === "transfer") && have !== undefined ? ` · after: ${qty(incoming ? have + base : have - base)}` : ""}
                        {l.useAlt && l.altFactor ? ` · ${qty(base)} ${l.unit}` : ""}
                      </span>
                    </div>
                    <Button variant="ghost" size="icon-sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove ${l.name}`}><Trash2 /></Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    {l.tracking === "serial" ? (
                      <Field label={`Serial numbers (${n})`} error={errors[`lines.${i}.quantity`] ?? errors[`lines.${i}.serials`]} className="sm:col-span-2">
                        <Input value={l.serialText} onChange={(e) => update(i, { serialText: e.target.value })} placeholder="One per piece, comma separated" aria-label={`Serial numbers of ${l.name}`} />
                      </Field>
                    ) : (
                      <Field label="Quantity" error={errors[`lines.${i}.quantity`]}>
                        <NumberStepper decimals value={l.quantity} onChange={(v) => update(i, { quantity: v })} aria-label={`Quantity of ${l.name}`} suffix={l.useAlt ? l.altUnit ?? "" : l.unit} placeholder="0" />
                      </Field>
                    )}
                    {l.altUnit && l.altFactor && l.tracking !== "serial" && (
                      <Field label="Unit">
                        <NativeSelect value={l.useAlt ? "alt" : "base"} onChange={(e) => update(i, { useAlt: e.target.value === "alt" })} aria-label={`Unit of ${l.name}`}>
                          <option value="base">{l.unit}</option>
                          <option value="alt">{l.altUnit} ({l.altFactor} {l.unit})</option>
                        </NativeSelect>
                      </Field>
                    )}
                    {costed && (
                      <Field label={`Cost per ${l.useAlt ? l.altUnit : l.unit}`} error={errors[`lines.${i}.ratePaise`]}>
                        <MoneyInput value={l.ratePaise} onChange={(v) => update(i, { ratePaise: v })} aria-label={`Cost of ${l.name}`} />
                      </Field>
                    )}
                    {l.tracking === "batch" && incoming && (
                      <>
                        <Field label="Batch" required error={errors[`lines.${i}.batchNo`]}><Input value={l.batchNo} onChange={(e) => update(i, { batchNo: e.target.value })} maxLength={40} aria-label={`Batch of ${l.name}`} /></Field>
                        <Field label="Mfg date"><Input type="date" value={l.mfgDate} onChange={(e) => update(i, { mfgDate: e.target.value })} aria-label={`Manufactured on, ${l.name}`} /></Field>
                        <Field label="Expiry"><Input type="date" value={l.expiryDate} onChange={(e) => update(i, { expiryDate: e.target.value })} aria-label={`Expiry of ${l.name}`} /></Field>
                      </>
                    )}
                    {l.tracking === "batch" && !incoming && (
                      <Field label="Batch" error={errors[`lines.${i}.batchId`]} className="sm:col-span-2">
                        <BatchPicker itemId={l.itemId} locationId={from} value={l.batchId} onChange={(v) => update(i, { batchId: v })} includeExpired={reason === "expired"} />
                      </Field>
                    )}
                  </div>
                </div>
              )
            })}
            <ItemPicker onPick={pick} price="cost" locationId={from} />
            {errors.lines && <p className="text-xs text-destructive">{errors.lines}</p>}
            {costed && total > 0 && <p className="text-right text-sm font-medium">Value: <span className="tabular-nums">{formatPaise(Math.round(total))}</span></p>}
          </div>

          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button disabled={busy} onClick={save}>{busy ? "Saving…" : kind === "transfer" && !receiveNow ? "Send" : `Save ${ENTRY_LABEL[kind].toLowerCase()}`}</Button>
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
