"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeftRight, CalendarDays, Eye, Plus, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { WarehouseSelect } from "@/components/creatable-select"
import { DataList, type Column } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { ItemPicker, type ItemOption } from "@/components/pickers"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { qty, type StockEntry, type Tracking } from "@/lib/inventory"
import { todayInIndia } from "@contracts/validation"

// Moving stock from one warehouse to another.

type Picked = ItemOption & { tracking?: Tracking }

function TransferDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [item, setItem] = React.useState<Picked | null>(null)
  const [quantity, setQuantity] = React.useState("")
  const [date, setDate] = React.useState(todayInIndia())
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const tracked = item && (item.tracking ?? "none") !== "none"
  async function save() {
    const p: Record<string, string> = {}
    if (!from) p.locationId = "Choose a warehouse"
    if (!to) p.toLocationId = "Choose a warehouse"
    if (from && from === to) p.toLocationId = "Choose a different warehouse"
    if (!item) p.item = "Choose a product"
    if (!(Number(quantity) > 0)) p.quantity = "Enter more than 0"
    setErrors(p)
    if (Object.keys(p).length) return
    setBusy(true)
    setError(null)
    try {
      await api.post("/stock/entries", { kind: "transfer", locationId: from, toLocationId: to, date, receiveNow: true, lines: [{ itemId: item!.id, quantity: Number(quantity) }] })
      toast.success("Stock transferred")
      onDone()
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields)
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Transfer</DialogTitle>
          <DialogDescription>Total stock stays the same. It only changes place.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="From warehouse" required error={errors.locationId}><WarehouseSelect value={from} onChange={setFrom} aria-label="From warehouse" aria-invalid={!!errors.locationId} /></Field>
            <Field label="To warehouse" required error={errors.toLocationId}><WarehouseSelect value={to} onChange={setTo} aria-label="To warehouse" aria-invalid={!!errors.toLocationId} /></Field>
          </div>
          <Field label="Product" required error={errors.item}>
            {item ? (
              <div className="flex h-10 items-center justify-between rounded-xl bg-muted px-3 text-sm">
                <span className="truncate font-medium">{item.name}</span>
                <button type="button" aria-label="Change product" onClick={() => setItem(null)}><X className="size-4 text-muted-foreground" /></button>
              </div>
            ) : <ItemPicker onPick={(i) => setItem(i as Picked)} placeholder="Search or scan a product" />}
          </Field>
          {tracked ? (
            <p className="rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">This product is tracked by batch or serial number. <Link href="/app/m/inventory/new?kind=transfer" className="font-medium text-primary hover:underline">Use the full transfer form</Link> to choose which ones move.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Quantity" required error={errors.quantity ?? errors["lines.0.quantity"]}><Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d.]/g, ""))} placeholder={item?.unit ?? "0"} /></Field>
              <Field label="Date" error={errors.date}><Input type="date" value={date} max={todayInIndia()} onChange={(e) => setDate(e.target.value)} /></Field>
            </div>
          )}
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !!tracked} onClick={save}>{busy ? "Transferring…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function TransfersPage() {
  const { can } = useAuth()
  const [open, setOpen] = React.useState(false)
  const [version, setVersion] = React.useState(0)
  if (!can("inventory.stock.view")) return <PageHeader title="Transfers" description="You don't have access to stock. Ask your admin." />
  const moved = (r: StockEntry) => r.lines.reduce((n, l) => n + (l.baseQuantity ?? l.quantity ?? 0), 0)
  const columns: Column<StockEntry>[] = [
    { key: "product", header: "Product", hideable: false, csv: (r) => r.lines.map((l) => l.name).join("; "), cell: (r) => <span className="font-medium">{r.lines[0]?.name ?? "—"}{r.lines.length > 1 && <span className="ml-1 text-xs font-normal text-muted-foreground">+{r.lines.length - 1} more</span>}</span> },
    { key: "from", header: "From Warehouse", csv: (r) => r.location, cell: (r) => <Badge variant="outline">{r.location}</Badge> },
    { key: "to", header: "To Warehouse", csv: (r) => r.toLocation ?? "", cell: (r) => <Badge variant="outline">{r.toLocation}</Badge> },
    { key: "qty", header: "Quantity", sort: moved, csv: moved, cell: (r) => <span className="font-medium tabular-nums">{qty(moved(r))}</span> },
    { key: "date", header: "Date", sort: (r) => r.createdAt, csv: (r) => r.entryDate.slice(0, 10), cell: (r) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />{formatDate(r.entryDate)}{r.status === "in_transit" && <Badge variant="outline" className="ml-1">On the way</Badge>}</span> },
    { key: "actions", header: "Actions", hideable: false, cell: (r) => <Link href={`/app/m/inventory/entries/${r.id}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} title="View" aria-label="View transfer" onClick={(e) => e.stopPropagation()}><Eye /></Link> },
  ]
  const create = can("inventory.transfer.create") ? <Button onClick={() => setOpen(true)}><Plus /> Create transfer</Button> : undefined
  return (
    <>
      <DataList<StockEntry>
        id="transfers"
        path="/stock/entries"
        params={{ kind: "transfer", v: String(version) }}
        header={{ title: "Manage Transfers", description: "Stock moved between warehouses.", primary: create }}
        columns={columns}
        searchPlaceholder="Search note or reference"
        rowHref={(r) => `/app/m/inventory/entries/${r.id}`}
        exportName="transfers"
        emptyState={<EmptyState icon={ArrowLeftRight} title="No transfers yet" description="Move stock from one warehouse to another." action={create} />}
      />
      {open && <TransferDialog onClose={() => setOpen(false)} onDone={() => { setOpen(false); setVersion((v) => v + 1) }} />}
    </>
  )
}
