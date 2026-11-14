"use client"

import * as React from "react"
import { toast } from "sonner"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/common"
import { WarehouseSelect } from "@/components/creatable-select"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ItemPicker } from "@/components/pickers"
import { parseSerials } from "@/components/stock-line"
import { NumberStepper } from "@/components/number-stepper"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { qty, type BatchRow } from "@/lib/inventory"
import { useApi, useSharedApi } from "@/lib/use-api"
import { todayInIndia } from "@contracts/validation"

// The three things done to one item's stock, each a small dialog opened from a table row:
// add (it came in), adjust (correct it), move (another warehouse). Batch items take a batch
// number coming in and a batch going out; serial items take their serial numbers.

export interface StockTarget {
  id: string
  name: string
  unit: string
  sku?: string | null
  tracking?: "none" | "batch" | "serial"
  /** Cost of one unit, to value stock that comes in */
  costPaise?: number | null
  warehouses?: { id: string; name: string; quantity: number }[]
}

type Kind = "add" | "adjust" | "move"

const TITLE: Record<Kind, string> = { add: "Add stock", adjust: "Adjust stock", move: "Move stock" }
const REASONS = [
  { value: "damage", label: "Damaged" },
  { value: "loss", label: "Lost or stolen" },
  { value: "expired", label: "Expired" },
  { value: "sample", label: "Given as sample" },
  { value: "other", label: "Other" },
]

/** The default warehouse, until someone picks one */
function useStartWarehouse() {
  const list = useSharedApi<{ data: { id: string; isDefault: boolean; isActive: boolean }[] }>("/stock-locations").data?.data
  return list?.find((w) => w.isDefault && w.isActive)?.id ?? ""
}

export function StockDialog({ kind, item: given, onClose, onDone, locationId: fixed }: { kind: Kind; item: StockTarget | null; onClose: () => void; onDone: () => void; /** Start in this warehouse */ locationId?: string }) {
  const { me } = useAuth()
  const showCost = !!me?.fieldAccess?.["item.cost_price"] && me.fieldAccess["item.cost_price"] !== "hidden"
  const start = useStartWarehouse()
  const [item, setItem] = React.useState<StockTarget | null>(given)
  const [picked, setPicked] = React.useState("")
  const [to, setTo] = React.useState("")
  const [mode, setMode] = React.useState<"in" | "out" | "count">("out")
  const [reason, setReason] = React.useState("damage")
  const [quantity, setQuantity] = React.useState("")
  const [rate, setRate] = React.useState<number | null>(given?.costPaise ?? null)
  const [batchNo, setBatchNo] = React.useState("")
  const [mfgDate, setMfgDate] = React.useState("")
  const [expiryDate, setExpiryDate] = React.useState("")
  const [batchId, setBatchId] = React.useState("")
  const [serialText, setSerialText] = React.useState("")
  const [note, setNote] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const from = picked || fixed || start
  const tracking = item?.tracking ?? "none"
  const incoming = kind === "add" || (kind === "adjust" && mode === "in")
  const counting = kind === "adjust" && mode === "count"
  const batches = useApi<{ data: BatchRow[] }>(item && tracking === "batch" && !incoming && from ? `/stock/items/${item.id}/batches?locationId=${from}&expired=true` : null).data?.data ?? []
  const chosenBatch = batches.find((b) => b.id === batchId)
  const here = counting && chosenBatch ? chosenBatch.quantity : (item?.warehouses?.find((w) => w.id === from)?.quantity ?? 0)
  const serials = parseSerials(serialText)
  const n = tracking === "serial" && !counting ? serials.length : Number(quantity)

  async function save() {
    const p: Record<string, string> = {}
    if (!item) p.item = "Choose an item"
    if (!from) p.locationId = "Choose a warehouse"
    if (kind === "move" && !to) p.toLocationId = "Choose a warehouse"
    if (kind === "move" && from && from === to) p.toLocationId = "Choose a different warehouse"
    if (tracking === "serial" && !counting && !serials.length) p.serials = "Enter at least one serial number"
    else if (counting ? quantity === "" || n < 0 : !(n > 0)) p.quantity = counting ? "Enter what you counted" : "Enter more than 0"
    if (tracking === "batch" && incoming && !batchNo.trim()) p.batchNo = "Enter the batch number"
    if (tracking === "batch" && counting && !batchId) p.batchId = "Choose the batch you counted"
    setErrors(p)
    if (Object.keys(p).length) return
    setBusy(true)
    setError(null)
    const date = todayInIndia()
    const line = {
      itemId: item!.id,
      quantity: n,
      ...(tracking === "batch" && incoming ? { batchNo: batchNo.trim(), mfgDate: mfgDate || null, expiryDate: expiryDate || null } : {}),
      ...(tracking === "batch" && !incoming && batchId ? { batchId } : {}),
      ...(tracking === "serial" ? { serials } : {}),
    }
    try {
      if (kind === "add") await api.post("/stock/entries", { kind: "stock_in", locationId: from, date, note: note || null, lines: [{ ...line, ratePaise: rate ?? 0 }] })
      else if (kind === "move") await api.post("/stock/entries", { kind: "transfer", locationId: from, toLocationId: to, date, receiveNow: true, note: note || null, lines: [line] })
      else if (counting) await api.post("/stock/counts", { locationId: from, note: note || null, lines: [{ itemId: item!.id, batchId: batchId || null, counted: n }] })
      else await api.post("/stock/entries", { kind: "adjustment", locationId: from, date, direction: mode, reason: mode === "in" ? "found" : reason, note: note || null, lines: [line] })
      toast.success(kind === "add" ? `${qty(n)} ${item!.unit} added` : kind === "move" ? "Stock moved" : "Stock corrected")
      onDone()
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields)
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const modes = ([["out", "Remove"], ["in", "Add"], ["count", "Set exact count"]] as const).filter(([v]) => v !== "count" || tracking !== "serial")
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{TITLE[kind]}</DialogTitle>
          <DialogDescription>
            {kind === "add" ? "Stock that came in without a purchase invoice." : kind === "move" ? "The total stays the same. Only the place changes." : "Correct the count after damage, loss or a physical check."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {!given && (
            <Field label="Item" required error={errors.item}>
              {item ? (
                <div className="flex h-10 items-center justify-between rounded-xl bg-muted px-3 text-sm">
                  <span className="truncate font-medium">{item.name}</span>
                  <button type="button" aria-label="Change item" onClick={() => setItem(null)}><X className="size-4 text-muted-foreground" /></button>
                </div>
              ) : <ItemPicker onPick={(i) => setItem({ id: i.id, name: i.name, unit: i.unit, tracking: (i as { tracking?: StockTarget["tracking"] }).tracking, costPaise: i.costPricePaise ?? null })} price="cost" />}
            </Field>
          )}
          {given && <p className="rounded-xl bg-muted px-3 py-2 text-sm"><span className="font-medium">{given.name}</span>{given.sku ? ` · ${given.sku}` : ""}{tracking !== "none" && <span className="text-muted-foreground"> · tracked by {tracking}</span>}</p>}
          <div className={kind === "move" ? "grid grid-cols-2 gap-4" : "grid gap-4"}>
            <Field label={kind === "move" ? "From warehouse" : "Warehouse"} required hint={item?.warehouses ? `${qty(item.warehouses.find((w) => w.id === from)?.quantity ?? 0)} ${item.unit} here now` : undefined} error={errors.locationId}><WarehouseSelect value={from} onChange={(v) => { setPicked(v); setBatchId("") }} aria-label={kind === "move" ? "From warehouse" : "Warehouse"} aria-invalid={!!errors.locationId} /></Field>
            {kind === "move" && <Field label="To warehouse" required error={errors.toLocationId}><WarehouseSelect value={to} onChange={setTo} aria-label="To warehouse" aria-invalid={!!errors.toLocationId} /></Field>}
          </div>
          {kind === "adjust" && (
            <div className="inline-flex w-fit rounded-xl border p-1 text-sm" role="radiogroup" aria-label="What to do">
              {modes.map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)} className={`rounded-lg px-3 py-1.5 font-medium ${mode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{l}</button>
              ))}
            </div>
          )}
          {tracking === "batch" && incoming && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Batch no." required error={errors.batchNo ?? errors["lines.0.batchNo"]}><Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} maxLength={40} /></Field>
              <Field label="Mfg date"><Input type="date" value={mfgDate} onChange={(e) => setMfgDate(e.target.value)} /></Field>
              <Field label="Expiry"><Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></Field>
            </div>
          )}
          {tracking === "batch" && !incoming && (
            <Field label="Batch" required={counting} hint={counting ? undefined : "Empty: the one expiring first"} error={errors.batchId ?? errors["lines.0.batchId"]}>
              <NativeSelect value={batchId} onChange={(e) => setBatchId(e.target.value)} aria-label="Batch">
                {!counting && <option value="">Expiring first</option>}
                {counting && <option value="">Choose a batch</option>}
                {batches.map((b) => <option key={b.id} value={b.id}>{b.number} · {qty(b.quantity)} {item?.unit}{b.expiryDate ? ` · exp ${formatDate(b.expiryDate)}` : ""}{b.expired ? " · expired" : ""}</option>)}
              </NativeSelect>
            </Field>
          )}
          {tracking === "serial" && !counting ? (
            <Field label={`Serial numbers (${serials.length})`} required hint="One per piece, comma separated" error={errors.serials ?? errors["lines.0.serials"] ?? errors["lines.0.quantity"]}>
              <Input value={serialText} onChange={(e) => setSerialText(e.target.value)} placeholder="IMEI or serial numbers" autoFocus={!!given} />
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Field label={counting ? "Counted quantity" : "Quantity"} required error={errors.quantity ?? errors["lines.0.quantity"] ?? errors["lines.0.counted"]}>
                <NumberStepper decimals value={quantity} onChange={setQuantity} suffix={item?.unit} placeholder="0" autoFocus={!!given} />
              </Field>
              {kind === "adjust" && mode === "out" && <Field label="Reason" required><NativeSelect value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">{REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</NativeSelect></Field>}
              {counting && quantity !== "" && <p className="self-end pb-2 text-sm text-muted-foreground">{n === here ? "Matches the books" : `${n > here ? "+" : "−"}${qty(Math.abs(n - here))} ${item?.unit ?? ""} against the books`}</p>}
              {kind === "add" && showCost && <Field label={`Cost per ${item?.unit ?? "unit"}`}><MoneyInput value={rate} onChange={setRate} aria-label="Cost" /></Field>}
            </div>
          )}
          {tracking === "serial" && kind === "adjust" && mode === "out" && <Field label="Reason" required><NativeSelect value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">{REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</NativeSelect></Field>}
          {tracking === "serial" && kind === "add" && showCost && <Field label={`Cost per ${item?.unit ?? "unit"}`}><MoneyInput value={rate} onChange={setRate} aria-label="Cost" /></Field>}
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={kind === "add" ? "Supplier or reason" : "Optional"} /></Field>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{busy ? "Saving…" : TITLE[kind]}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
