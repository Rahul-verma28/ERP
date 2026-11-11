"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeftRight, CalendarDays, Eye, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { DataList, type Column } from "@/components/data-list"
import { StockDialog } from "@/components/stock-dialogs"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { qty, type StockEntry } from "@/lib/inventory"

// Moving stock from one warehouse to another.

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
      {open && <StockDialog kind="move" item={null} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setVersion((v) => v + 1) }} />}
    </>
  )
}
