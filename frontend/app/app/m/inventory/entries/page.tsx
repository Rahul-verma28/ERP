"use client"

import { ClipboardList } from "lucide-react"
import { EmptyState } from "@/components/common"
import { DataList, HeaderLink, type Column } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { ENTRY_LABEL, REASONS, type StockEntry } from "@/lib/inventory"

// Every entry made by hand: opening stock, stock in, adjustments and counts. Transfers have their own page.

export default function StockEntriesPage() {
  const { can } = useAuth()
  if (!can("inventory.stock.view")) return <PageHeader title="Stock entries" description="You don't have access to stock. Ask your admin." />
  const showValue = can("inventory.valuation.view") || can("inventory.receipt.create")
  const columns: Column<StockEntry>[] = [
    { key: "date", header: "Date", hideable: false, cell: (r) => formatDate(r.entryDate), csv: (r) => r.entryDate.slice(0, 10), sort: (r) => r.createdAt },
    { key: "kind", header: "Entry", cell: (r) => <span className="font-medium">{ENTRY_LABEL[r.kind]}{r.status === "in_transit" && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">On the way</span>}{r.reason && <span className="block text-xs font-normal text-muted-foreground">{REASONS.find((x) => x.value === r.reason)?.label ?? r.reason}</span>}</span>, csv: (r) => ENTRY_LABEL[r.kind] },
    { key: "where", header: "Warehouse", cell: (r) => (r.toLocation ? `${r.location} → ${r.toLocation}` : r.location), csv: (r) => (r.toLocation ? `${r.location} > ${r.toLocation}` : r.location) },
    { key: "party", header: "Supplier / note", cell: (r) => <span className="text-muted-foreground">{[r.party, r.reference, r.note].filter(Boolean).join(" · ") || "—"}</span>, csv: (r) => [r.party, r.reference, r.note].filter(Boolean).join(" ") },
    { key: "lines", header: "Items", align: "right", cell: (r) => r.lineCount ?? r.lines.length, csv: (r) => r.lineCount ?? r.lines.length },
    ...(showValue ? [{ key: "value", header: "Value", align: "right" as const, cell: (r: StockEntry) => <span className="tabular-nums">{formatPaise(r.valuePaise)}</span>, csv: (r: StockEntry) => r.valuePaise / 100 }] : []),
  ]
  return (
    <DataList<StockEntry>
      id="stock-entries"
      path="/stock/entries"
      params={{ notKind: "transfer" }}
      header={{ title: "Stock Entries", description: "Stock added or corrected by hand.", primary: can("inventory.stock_adjustment.create") ? <HeaderLink href="/app/m/inventory/new?kind=adjustment" primary>Adjust stock</HeaderLink> : undefined }}
      columns={columns}
      searchPlaceholder="Search supplier, bill no. or note"
      presetLabel="Type"
      presets={[
        { key: "all", label: "All", params: {} },
        { key: "stock_in", label: "Stock in", params: { kind: "stock_in" } },
        { key: "adjustment", label: "Adjustments", params: { kind: "adjustment" } },
        { key: "count", label: "Counts", params: { kind: "count" } },
        { key: "opening", label: "Opening", params: { kind: "opening" } },
      ]}
      rowHref={(r) => `/app/m/inventory/entries/${r.id}`}
      exportName="stock-entries"
      emptyState={<EmptyState icon={ClipboardList} title="No entries yet" description="Opening stock, stock in, adjustments and counts show here." />}
    />
  )
}
