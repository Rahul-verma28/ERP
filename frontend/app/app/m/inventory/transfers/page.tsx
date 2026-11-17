"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeftRight, ArrowRight, CalendarDays, CheckCheck, Eye, PackageCheck, Plus, Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { DataList, type Column } from "@/components/data-list"
import { Pill } from "@/components/page-parts"
import { StockDialog } from "@/components/stock-dialogs"
import { SummaryCards } from "@/components/summary-cards"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { qty, type StockEntry } from "@/lib/inventory"

// Moving stock from one warehouse to another. One request brings the rows, the tab counts and the cards.

const STATUS: Record<string, { label: string; color: string }> = { posted: { label: "Moved", color: "emerald" }, in_transit: { label: "On the way", color: "amber" }, received: { label: "Received", color: "blue" } }

export default function TransfersPage() {
  const { can } = useAuth()
  const [open, setOpen] = React.useState(false)
  const [version, setVersion] = React.useState(0)
  if (!can("inventory.stock.view")) return <PageHeader title="Transfers" description="You don't have access to stock. Ask your admin." />
  const moved = (r: StockEntry) => r.units ?? r.lines.reduce((n, l) => n + (l.baseQuantity ?? l.quantity ?? 0), 0)
  const receive = async (r: StockEntry) => {
    try {
      await api.post(`/stock/entries/${r.id}/receive`)
      toast.success(`Received at ${r.toLocation}`)
      setVersion((v) => v + 1)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const columns: Column<StockEntry>[] = [
    {
      key: "product", header: "Products", hideable: false, csv: (r) => r.lines.map((l) => `${l.name} ×${l.baseQuantity ?? l.quantity ?? 0}`).join("; "),
      cell: (r) => (
        <span className="grid gap-0.5 text-[13px]">
          {r.lines.slice(0, 3).map((l, i) => <span key={i} className="flex justify-between gap-4"><span className="max-w-56 truncate font-medium">{l.name}</span><span className="text-muted-foreground tabular-nums">×{qty(l.baseQuantity ?? l.quantity ?? 0)}{l.unit ? ` ${l.unit}` : ""}</span></span>)}
          {r.lines.length > 3 && <span className="text-xs text-muted-foreground">+{r.lines.length - 3} more</span>}
        </span>
      ),
    },
    {
      key: "route", header: "From → To", csv: (r) => `${r.location} > ${r.toLocation ?? ""}`,
      cell: (r) => <span className="flex flex-wrap items-center gap-1.5"><Badge variant="outline" className="whitespace-nowrap">{r.location}</Badge><ArrowRight className="size-3.5 text-muted-foreground" aria-hidden /><Badge variant="outline" className="whitespace-nowrap border-primary/30 text-primary">{r.toLocation}</Badge></span>,
    },
    { key: "qty", header: "Quantity", align: "right", sort: moved, csv: moved, cell: (r) => <span className="font-medium tabular-nums">{qty(moved(r))}<span className="block text-[11px] font-normal text-muted-foreground">{r.lineCount ?? r.lines.length} item{(r.lineCount ?? r.lines.length) === 1 ? "" : "s"}</span></span> },
    { key: "date", header: "Date", sort: (r) => r.createdAt, csv: (r) => r.entryDate.slice(0, 10), cell: (r) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />{formatDate(r.entryDate)}</span> },
    { key: "reference", header: "Reference / note", csv: (r) => [r.reference, r.note].filter(Boolean).join(" "), cell: (r) => <span className="block max-w-56 truncate text-muted-foreground" title={[r.reference, r.note].filter(Boolean).join(" · ")}>{[r.reference, r.note].filter(Boolean).join(" · ") || "—"}</span> },
    { key: "status", header: "Status", csv: (r) => STATUS[r.status]?.label ?? r.status, cell: (r) => <span className="grid gap-0.5"><Pill color={STATUS[r.status]?.color ?? "slate"} dot>{STATUS[r.status]?.label ?? r.status}</Pill>{r.receivedAt && <span className="text-[11px] text-muted-foreground">{formatDate(r.receivedAt)}</span>}</span> },
    { key: "createdBy", header: "Moved by", defaultHidden: true, csv: (r) => r.createdByName ?? "", cell: (r) => r.createdByName ?? "—" },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {r.status === "in_transit" && can("inventory.transfer.create") && <Button variant="ghost" size="icon-sm" className="text-emerald-700 dark:text-emerald-300" title={`Receive at ${r.toLocation}`} aria-label="Receive transfer" onClick={() => void receive(r)}><CheckCheck /></Button>}
          <Link href={`/app/m/inventory/entries/${r.id}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} title="View" aria-label="View transfer"><Eye /></Link>
        </span>
      ),
    },
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
        searchPlaceholder="Search item, warehouse, note or reference"
        presets={[
          { key: "all", label: "All", params: {}, countKey: "all" },
          { key: "in_transit", label: "On the way", params: { status: "in_transit" }, countKey: "in_transit" },
          { key: "received", label: "Received", params: { status: "received" }, countKey: "received" },
          { key: "posted", label: "Moved at once", params: { status: "posted" }, countKey: "posted" },
        ]}
        tabs
        top={(res) => {
          const c = (res.counts ?? {}) as Record<string, number>
          const s = (res.sums ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Transfers", value: c.all ?? 0, hint: "All time", color: "blue", icon: ArrowLeftRight },
            { label: "This month", value: s.month ?? 0, hint: "Transfers this month", color: "violet", icon: CalendarDays },
            { label: "On the way", value: c.in_transit ?? 0, hint: "Sent, not yet received", color: "amber", icon: Truck },
            { label: "Units moved", value: qty(s.units ?? 0), hint: `${(c.received ?? 0) + (c.posted ?? 0)} transfers done`, color: "emerald", icon: PackageCheck },
          ]} />
        }}
        rowHref={(r) => `/app/m/inventory/entries/${r.id}`}
        exportName="transfers"
        emptyState={<EmptyState icon={ArrowLeftRight} title="No transfers yet" description="Move stock from one warehouse to another." action={create} />}
      />
      {open && <StockDialog kind="move" item={null} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setVersion((v) => v + 1) }} />}
    </>
  )
}
