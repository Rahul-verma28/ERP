"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { Archive, ArchiveRestore, ArrowLeftRight, Boxes, ClipboardList, Pencil, Phone, Plus, Star, Warehouse } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/common"
import { DataList, type Column } from "@/components/data-list"
import { ActionMenu, BackLink, DetailHeader, DetailList, Pill, Section, StatGrid, Tabs } from "@/components/page-parts"
import { StockDialog } from "@/components/stock-dialogs"
import { WarehouseFormDialog } from "@/components/warehouse-form"
import { stateName } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { ENTRY_LABEL, qty, type StockEntry, type StockLocation, type StockRow } from "@/lib/inventory"
import { cn } from "@/lib/utils"
import { PageError, PageLoading } from "@/components/page-states"

// One warehouse: where it is, what is in it, and every entry that moved stock in or out by hand.

type Tab = "stock" | "entries" | "details"

export default function WarehousePage() {
  const { id } = useParams<{ id: string }>()
  const { can } = useAuth()
  const list = useApi<{ data: StockLocation[] }>("/stock-locations")
  const [tab, setTab] = React.useState<Tab>("stock")
  const [editing, setEditing] = React.useState(false)
  const [stock, setStock] = React.useState<{ kind: "add" | "adjust" | "move"; row: StockRow | null } | null>(null)
  const [version, setVersion] = React.useState(0)
  const showValue = can("inventory.valuation.view") || can("inventory.receipt.create")

  if (list.error) return <PageError error={list.error} />
  if (!list.data) return <PageLoading />
  const w = list.data.data.find((x) => x.id === id)
  if (!w) return <EmptyState icon={Warehouse} title="Warehouse not found" description="It may have been removed." />

  async function act(patch: Record<string, unknown>, done: string) {
    try {
      await api.patch(`/stock-locations/${w!.id}`, patch)
      toast.success(done)
      await list.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const address = [w.address, w.city, w.zipCode, w.stateCode ? stateName(w.stateCode) : null].filter(Boolean).join(", ")
  const columns: Column<StockRow>[] = [
    { key: "name", header: "Item", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span><Link href={`/app/m/catalog/${r.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{r.name}</Link>{r.sku && <span className="block text-xs text-muted-foreground">{r.sku}</span>}</span> },
    { key: "qty", header: "Here", align: "right", sort: (r) => r.quantity, csv: (r) => r.quantity, cell: (r) => <span className={cn("font-semibold tabular-nums", r.quantity < 0 && "text-destructive")}>{qty(r.quantity)} {r.unit}</span> },
    { key: "available", header: "Available", align: "right", csv: (r) => r.available, cell: (r) => <span className="tabular-nums">{qty(r.available)}{r.low && <Pill color="amber" className="ml-2">Low</Pill>}</span> },
    ...(showValue ? [{ key: "value", header: "Value", align: "right" as const, sort: (r: StockRow) => r.valuePaise, csv: (r: StockRow) => r.valuePaise / 100, cell: (r: StockRow) => <span className="tabular-nums">{formatPaise(r.valuePaise)}</span> }] : []),
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {can("inventory.receipt.create") && w.isActive && <Button variant="ghost" size="icon-sm" title="Add stock" aria-label={`Add stock to ${r.name}`} onClick={() => setStock({ kind: "add", row: r })}><Plus /></Button>}
          <ActionMenu label={`More actions for ${r.name}`} items={[
            { label: "Stock history", icon: ClipboardList, href: `/app/m/catalog/${r.id}?tab=stock` },
            can("inventory.stock_adjustment.create") && { label: "Adjust stock", icon: Boxes, onClick: () => setStock({ kind: "adjust", row: r }) },
            can("inventory.transfer.create") && { label: "Move to another warehouse", icon: ArrowLeftRight, onClick: () => setStock({ kind: "move", row: r }) },
          ]} />
        </span>
      ),
    },
  ]
  const entryColumns: Column<StockEntry>[] = [
    { key: "date", header: "Date", hideable: false, cell: (r) => formatDate(r.entryDate), csv: (r) => r.entryDate.slice(0, 10) },
    { key: "kind", header: "Entry", cell: (r) => <span className="font-medium">{ENTRY_LABEL[r.kind]}{r.status === "in_transit" && <Pill color="amber" className="ml-2">On the way</Pill>}</span>, csv: (r) => ENTRY_LABEL[r.kind] },
    { key: "where", header: "Warehouse", cell: (r) => (r.toLocation ? `${r.location} → ${r.toLocation}` : r.location), csv: (r) => r.location },
    { key: "party", header: "Supplier / note", cell: (r) => <span className="text-muted-foreground">{[r.party, r.reference, r.note].filter(Boolean).join(" · ") || "—"}</span> },
    { key: "lines", header: "Items", align: "right", cell: (r) => r.lineCount ?? r.lines.length },
    ...(showValue ? [{ key: "value", header: "Value", align: "right" as const, cell: (r: StockEntry) => <span className="tabular-nums">{formatPaise(r.valuePaise)}</span> }] : []),
  ]
  const target = stock?.row ? { id: stock.row.id, name: stock.row.name, unit: stock.row.unit, sku: stock.row.sku, tracking: stock.row.tracking, costPaise: stock.row.averagePaise || null, warehouses: stock.row.warehouses } : null

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/inventory/warehouses">Warehouses</BackLink>
      <DetailHeader
        title={w.name}
        icon={Warehouse}
        pills={<>{w.isDefault && <Pill color="blue">Default</Pill>}<Pill color={w.isActive ? "emerald" : "slate"} dot>{w.isActive ? "Active" : "Closed"}</Pill></>}
        subtitle={address || "No address yet"}
        extra={!w.stateCode && <span className="text-xs font-medium text-destructive">Add the state: e-way bills need it</span>}
        actions={<>
          {can("inventory.receipt.create") && w.isActive && <Button variant="outline" onClick={() => setStock({ kind: "add", row: null })}><Plus /> Add stock</Button>}
          {can("inventory.warehouse.edit") && <Button onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
          <ActionMenu items={[
            can("inventory.transfer.create") && w.isActive && { label: "New transfer", icon: ArrowLeftRight, href: "/app/m/inventory/new?kind=transfer" },
            can("inventory.warehouse.edit") && w.isActive && !w.isDefault && { label: "Make default", icon: Star, onClick: () => void act({ isDefault: true }, `${w.name} is the default`) },
            can("inventory.warehouse.edit") && !w.isDefault && (w.isActive ? { label: "Close warehouse", icon: Archive, onClick: () => void act({ isActive: false }, `${w.name} closed`) } : { label: "Reopen", icon: ArchiveRestore, onClick: () => void act({ isActive: true }, `${w.name} reopened`) }),
          ]} />
        </>}
      />
      <StatGrid items={[
        { label: "Items in stock", value: w.itemsInStock },
        showValue && { label: "Stock value", value: formatPaise(w.valuePaise) },
        { label: "In-charge", value: w.contactPerson || "—", hint: w.phone ?? undefined },
        { label: "State", value: w.stateCode ? stateName(w.stateCode) : "Not set", accent: w.stateCode ? undefined : "text-destructive" },
      ]} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: "stock", label: "Stock here", count: w.itemsInStock }, { key: "entries", label: "Entries" }, { key: "details", label: "Details" }]} />
      {tab === "stock" && (
        <DataList<StockRow>
          id="warehouse-stock"
          path="/stock"
          params={{ locationId: w.id, v: String(version) }}
          header={{ title: `Stock in ${w.name}`, description: "Quantities here only. Open an item for its full history." }}
          columns={columns}
          searchPlaceholder="Search item or SKU"
          presetLabel="Show"
          presets={[{ key: "all", label: "All", params: {} }, { key: "low", label: "Low stock", params: { low: "true" } }]}
          rowHref={(r) => `/app/m/catalog/${r.id}?tab=stock`}
          exportName={`stock-${w.name.toLowerCase().replace(/\W+/g, "-")}`}
          emptyState={<EmptyState icon={Boxes} title="Nothing here yet" description="Stock comes in with purchases, Add stock, or a transfer from another warehouse." />}
        />
      )}
      {tab === "entries" && (
        <DataList<StockEntry>
          id="warehouse-entries"
          path="/stock/entries"
          params={{ locationId: w.id }}
          header={{ title: "Entries", description: "Stock added, corrected, counted or moved by hand, in or out of this warehouse." }}
          columns={entryColumns}
          searchPlaceholder="Search supplier, bill no. or note"
          rowHref={(r) => `/app/m/inventory/entries/${r.id}`}
          exportName="warehouse-entries"
          emptyState={<EmptyState icon={ClipboardList} title="No entries yet" />}
        />
      )}
      {tab === "details" && (
        <Section title="Details" action={can("inventory.warehouse.edit") && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}>
          <DetailList items={[["Name", w.name], ["In-charge", w.contactPerson], ["Address", w.address], ["City", w.city], ["PIN code", w.zipCode], ["State", w.stateCode ? stateName(w.stateCode) : null], ["Phone", w.phone ? <a href={`tel:${w.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="size-3.5" />{w.phone}</a> : null], ["Email", w.email]]} />
        </Section>
      )}
      {editing && <WarehouseFormDialog warehouse={w} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await list.reload() }} />}
      {stock && <StockDialog kind={stock.kind} item={target} locationId={w.id} onClose={() => setStock(null)} onDone={() => { setStock(null); setVersion((v) => v + 1); void list.reload() }} />}
    </div>
  )
}
