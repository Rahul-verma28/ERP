"use client"

import Link from "next/link"
import { CalendarDays, ClipboardCheck, ClipboardList, Eye, IndianRupee, SlidersHorizontal } from "lucide-react"
import { SummaryCards } from "@/components/summary-cards"
import { buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/common"
import { DataList, type Column } from "@/components/data-list"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { ENTRY_LABEL, REASONS, type StockEntry } from "@/lib/inventory"
import { NoAccessPage } from "@/components/page-states"

// Every entry made by hand: opening stock, stock in, adjustments and counts. Transfers have their own page.

export default function StockEntriesPage() {
  const { can } = useAuth()
  if (!can("inventory.stock.view")) return <NoAccessPage title="Stock entries" permission="inventory.stock.view" />
  const showValue = can("inventory.valuation.view") || can("inventory.receipt.create")
  const columns: Column<StockEntry>[] = [
    { key: "date", header: "Date", hideable: false, cell: (r) => formatDate(r.entryDate), csv: (r) => r.entryDate.slice(0, 10), sort: (r) => r.createdAt },
    { key: "kind", header: "Entry", cell: (r) => <span className="font-medium">{ENTRY_LABEL[r.kind]}{r.status === "in_transit" && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">On the way</span>}{r.reason && <span className="block text-xs font-normal text-muted-foreground">{REASONS.find((x) => x.value === r.reason)?.label ?? r.reason}</span>}</span>, csv: (r) => ENTRY_LABEL[r.kind] },
    { key: "where", header: "Warehouse", cell: (r) => (r.toLocation ? `${r.location} → ${r.toLocation}` : r.location), csv: (r) => (r.toLocation ? `${r.location} > ${r.toLocation}` : r.location) },
    { key: "party", header: "Supplier / note", cell: (r) => <span className="text-muted-foreground">{[r.party, r.reference, r.note].filter(Boolean).join(" · ") || "—"}</span>, csv: (r) => [r.party, r.reference, r.note].filter(Boolean).join(" ") },
    { key: "lines", header: "Items", csv: (r) => r.lines.map((l) => l.name).join("; "), cell: (r) => <span className="block max-w-64 text-[13px]" title={r.lines.map((l) => l.name).join(", ")}><span className="block truncate">{r.lines[0]?.name ?? "—"}</span>{r.lines.length > 1 && <span className="text-xs text-muted-foreground">+{r.lines.length - 1} more · {r.units ?? 0} units</span>}</span> },
    ...(showValue ? [{ key: "value", header: "Value", align: "right" as const, cell: (r: StockEntry) => <span className="tabular-nums">{formatPaise(r.valuePaise)}</span>, csv: (r: StockEntry) => r.valuePaise / 100 }] : []),
    { key: "createdBy", header: "Entered by", defaultHidden: true, cell: (r) => <span className="text-sm">{r.createdByName ?? "—"}<span className="block text-[11px] text-muted-foreground">{formatDate(r.createdAt)}</span></span>, csv: (r) => r.createdByName ?? "" },
    { key: "actions", header: "Actions", hideable: false, cell: (r) => <Link href={`/app/m/inventory/entries/${r.id}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} title="View" aria-label="View entry" onClick={(e) => e.stopPropagation()}><Eye /></Link> },
  ]
  return (
    <DataList<StockEntry>
      id="stock-entries"
      path="/stock/entries"
      params={{ notKind: "transfer" }}
      header={{ title: "Stock Entries", description: "Every time stock was added, corrected or counted by hand. Do these from the Stock page." }}
      columns={columns}
      searchPlaceholder="Search supplier, bill no. or note"
      presetLabel="Type"
      presets={[
        { key: "all", label: "All", params: {}, countKey: "all" },
        { key: "stock_in", label: "Stock in", params: { kind: "stock_in" }, countKey: "stock_in" },
        { key: "adjustment", label: "Adjustments", params: { kind: "adjustment" }, countKey: "adjustment" },
        { key: "count", label: "Counts", params: { kind: "count" }, countKey: "count" },
        { key: "opening", label: "Opening", params: { kind: "opening" }, countKey: "opening" },
      ]}
      tabs
      top={(res) => {
        const c = (res.counts ?? {}) as Record<string, number>
        const s = (res.sums ?? {}) as Record<string, number>
        return <SummaryCards items={[
          { label: "Entries", value: c.all ?? 0, hint: `${c.opening ?? 0} opening · ${c.stock_in ?? 0} stock in`, color: "blue", icon: ClipboardList },
          { label: "This month", value: s.month ?? 0, hint: showValue ? formatPaise(s.monthValuePaise ?? 0) : "Entries this month", color: "violet", icon: CalendarDays },
          { label: "Adjustments", value: c.adjustment ?? 0, hint: "Damage, loss, found, samples", color: "amber", icon: SlidersHorizontal },
          { label: "Stock counts", value: c.count ?? 0, hint: "Physical counts posted", color: "emerald", icon: ClipboardCheck },
          ...(showValue ? [{ label: "Value entered", value: formatPaise(s.valuePaise ?? 0), hint: "All entries, at cost", color: "slate", icon: IndianRupee }] : []),
        ]} />
      }}
      rowHref={(r) => `/app/m/inventory/entries/${r.id}`}
      exportName="stock-entries"
      emptyState={<EmptyState icon={ClipboardList} title="No entries yet" description="Opening stock, stock in, adjustments and counts show here." />}
    />
  )
}
