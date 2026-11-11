"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/common"
import { WarehouseSelect } from "@/components/creatable-select"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ItemPicker } from "@/components/pickers"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { qty } from "@/lib/inventory"
import { useSharedApi as useApi } from "@/lib/use-api"
import { todayInIndia } from "@contracts/validation"

// The three things done to one item's stock, each a small dialog opened from a table row:
// add (it came in), adjust (correct it), move (another warehouse). Batch and serial items need
// numbers chosen, so they go to the full stock entry form instead.

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
const FULL_FORM: Record<Kind, string> = { add: "stock_in", adjust: "adjustment", move: "transfer" }
const REASONS = [
  { value: "damage", label: "Damaged" },
  { value: "loss", label: "Lost or stolen" },
  { value: "expired", label: "Expired" },
  { value: "sample", label: "Given as sample" },
  { value: "found", label: "Found extra" },
  { value: "other", label: "Other" },
]

/** The default warehouse, until someone picks one */
function useStartWarehouse() {
  const list = useApi<{ data: { id: string; isDefault: boolean; isActive: boolean }[] }>("/stock-locations").data?.data
  return list?.find((w) => w.isDefault && w.isActive)?.id ?? ""
}

export function StockDialog({ kind, item: given, onClose, onDone }: { kind: Kind; item: StockTarget | null; onClose: () => void; onDone: () => void }) {
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
  const [note, setNote] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const from = picked || start
  const here = item?.warehouses?.find((w) => w.id === from)?.quantity ?? 0
  const tracked = !!item && (item.tracking ?? "none") !== "none"
  const n = Number(quantity)

  async function save() {
    const p: Record<string, string> = {}
    if (!item) p.item = "Choose an item"
    if (!from) p.locationId = "Choose a warehouse"
    if (kind === "move" && !to) p.toLocationId = "Choose a warehouse"
    if (kind === "move" && from && from === to) p.toLocationId = "Choose a different warehouse"
    if (quantity === "" || (mode !== "count" || kind !== "adjust" ? !(n > 0) : n < 0)) p.quantity = kind === "adjust" && mode === "count" ? "Enter what you counted" : "Enter more than 0"
    setErrors(p)
    if (Object.keys(p).length) return
    setBusy(true)
    setError(null)
    const date = todayInIndia()
    try {
      if (kind === "add") await api.post("/stock/entries", { kind: "stock_in", locationId: from, date, note: note || null, lines: [{ itemId: item!.id, quantity: n, ratePaise: rate ?? 0 }] })
      else if (kind === "move") await api.post("/stock/entries", { kind: "transfer", locationId: from, toLocationId: to, date, receiveNow: true, note: note || null, lines: [{ itemId: item!.id, quantity: n }] })
      else if (mode === "count") await api.post("/stock/counts", { locationId: from, note: note || null, lines: [{ itemId: item!.id, counted: n }] })
      else await api.post("/stock/entries", { kind: "adjustment", locationId: from, date, direction: mode, reason: mode === "in" ? "found" : reason, note: note || null, lines: [{ itemId: item!.id, quantity: n }] })
      toast.success(kind === "add" ? `${qty(n)} ${item!.unit} added` : kind === "move" ? "Stock moved" : "Stock corrected")
      onDone()
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields)
      setError(errorMessage(e))
      setBusy(false)
    }
  }

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
              ) : <ItemPicker onPick={(i) => setItem({ id: i.id, name: i.name, unit: i.unit, tracking: (i as { tracking?: StockTarget["tracking"] }).tracking, costPaise: i.costPricePaise ?? null })} placeholder="Search or scan an item" />}
            </Field>
          )}
          {given && <p className="rounded-xl bg-muted px-3 py-2 text-sm"><span className="font-medium">{given.name}</span>{given.sku ? ` · ${given.sku}` : ""}</p>}
          {tracked ? (
            <p className="rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">This item is tracked by batch or serial number, so the numbers must be chosen. <Link href={`/app/m/inventory/new?kind=${FULL_FORM[kind]}`} className="font-medium text-primary hover:underline">Open the full form</Link>.</p>
          ) : (
            <>
              <div className={kind === "move" ? "grid grid-cols-2 gap-4" : "grid gap-4"}>
                <Field label={kind === "move" ? "From warehouse" : "Warehouse"} required hint={item?.warehouses ? `${qty(here)} ${item.unit} here now` : undefined} error={errors.locationId}><WarehouseSelect value={from} onChange={setPicked} aria-label={kind === "move" ? "From warehouse" : "Warehouse"} aria-invalid={!!errors.locationId} /></Field>
                {kind === "move" && <Field label="To warehouse" required error={errors.toLocationId}><WarehouseSelect value={to} onChange={setTo} aria-label="To warehouse" aria-invalid={!!errors.toLocationId} /></Field>}
              </div>
              {kind === "adjust" && (
                <div className="inline-flex w-fit rounded-xl border p-1 text-sm" role="radiogroup" aria-label="What to do">
                  {([["out", "Remove"], ["in", "Add"], ["count", "Set exact count"]] as const).map(([v, l]) => (
                    <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)} className={`rounded-lg px-3 py-1.5 font-medium ${mode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{l}</button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label={kind === "adjust" && mode === "count" ? "Counted quantity" : "Quantity"} required error={errors.quantity ?? errors["lines.0.quantity"] ?? errors["lines.0.counted"]}>
                  <Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d.]/g, ""))} placeholder={item?.unit ?? "0"} autoFocus={!!given} />
                </Field>
                {kind === "adjust" && mode === "out" && <Field label="Reason" required><NativeSelect value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">{REASONS.filter((r) => r.value !== "found").map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</NativeSelect></Field>}
                {kind === "adjust" && mode === "count" && quantity !== "" && <p className="self-end pb-2 text-sm text-muted-foreground">{n === here ? "Matches the books" : `${n > here ? "+" : "−"}${qty(Math.abs(n - here))} ${item?.unit ?? ""} against the books`}</p>}
                {kind === "add" && showCost && <Field label={`Cost per ${item?.unit ?? "unit"}`}><MoneyInput value={rate} onChange={setRate} aria-label="Cost" /></Field>}
              </div>
              <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={kind === "add" ? "Supplier or reason" : "Optional"} /></Field>
            </>
          )}
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || tracked} onClick={save}>{busy ? "Saving…" : TITLE[kind]}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
