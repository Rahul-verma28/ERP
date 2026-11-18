"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { IndianRupee, ListChecks, Pencil, Tags, Trash2, TrendingDown, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog, EmptyState, MoneyInput } from "@/components/common"
import { DataList, localList } from "@/components/data-list"
import { PriceListDialog } from "@/components/catalog/price-list-dialog"
import { ActionMenu, BackLink, DetailHeader, Pill, StatGrid, Tabs } from "@/components/page-parts"
import { PageError, PageLoading } from "@/components/page-states"
import { AboutCard, RecordHistory, useTabParam } from "@/components/record-kit"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"

// One price list: the price of every item on it (an exact price, else the list's discount), the
// customers who buy on it, and its history. Exact prices are set right in the table.

interface ItemRow { id: string; name: string; sku: string | null; type: string; unit: string; category: string | null; gstRateBp: number; basePaise: number; exactPaise: number | null; pricePaise: number; costPaise: number | null; offPct: number; marginPct: number | null }
interface CustomerRow { id: string; name: string; person: string | null; phone: string | null; gstin: string | null; sold90Paise: number; lastBillOn: string | null }
interface Detail { id: string; name: string; discountBp: number; createdAt: string; updatedAt: string; items: ItemRow[]; customers: CustomerRow[]; sums: { exact: number; items: number; customers: number; sold90Paise: number; belowCost: number } }

type Tab = "prices" | "customers" | "history"
const TABS: Tab[] = ["prices", "customers", "history"]

/** An exact price typed in the table, saved when the box is left */
function ExactPrice({ listId, row, onSaved }: { listId: string; row: ItemRow; onSaved: () => void }) {
  const [value, setValue] = React.useState<number | null>(row.exactPaise)
  const [busy, setBusy] = React.useState(false)
  async function save() {
    if (value === row.exactPaise) return
    setBusy(true)
    try {
      await api.put(`/price-lists/${listId}/items/${row.id}`, { pricePaise: value })
      toast.success(value === null ? `${row.name} back to the list discount` : `${row.name} set to ${formatPaise(value)}`)
      onSaved()
    } catch (e) {
      toast.error(errorMessage(e))
      setValue(row.exactPaise)
    } finally {
      setBusy(false)
    }
  }
  return <div className="w-32" onClick={(e) => e.stopPropagation()} onBlur={() => void save()}><MoneyInput value={value} onChange={setValue} disabled={busy} aria-label={`Exact price for ${row.name}`} placeholder="List discount" /></div>
}

function PriceListPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can, me } = useAuth()
  const { data, error, reload } = useApi<Detail>(`/price-lists/${id}`)
  const [tab, setTab] = useTabParam<Tab>(TABS, "prices")
  const [editing, setEditing] = React.useState(false)
  const [removing, setRemoving] = React.useState(false)
  if (error) return <PageError error={error} onRetry={() => void reload()} />
  if (!data) return <PageLoading />
  const l = data
  const canEdit = can("catalog.price_list.edit")
  const showCost = !!me?.fieldAccess?.["item.cost_price"] && me.fieldAccess["item.cost_price"] !== "hidden"

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/catalog/price-lists">Price lists</BackLink>
      <DetailHeader
        title={l.name}
        icon={Tags}
        pills={l.discountBp > 0 ? <Pill color="emerald">{l.discountBp / 100}% off everything</Pill> : <Pill>No discount</Pill>}
        subtitle={`${l.sums.exact} exact price${l.sums.exact === 1 ? "" : "s"} · ${l.sums.customers} customer${l.sums.customers === 1 ? "" : "s"} buy on this list`}
        actions={<>
          {canEdit && <Button onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
          <ActionMenu items={[can("catalog.price_list.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setRemoving(true) }]} />
        </>}
      />
      <StatGrid items={[
        { label: "Items priced", value: l.sums.items, hint: `${l.sums.exact} with their own price`, icon: ListChecks, color: "blue" },
        { label: "Customers", value: l.sums.customers, hint: "Their new bills use this list", icon: Users, color: "violet" },
        { label: "Sold, last 90 days", value: formatPaise(l.sums.sold90Paise), hint: "To customers on this list", icon: IndianRupee, color: "emerald" },
        showCost && { label: "Below cost", value: l.sums.belowCost, hint: l.sums.belowCost ? "Items priced under what they cost" : "Every item above cost", icon: TrendingDown, color: l.sums.belowCost ? "rose" : "amber" },
      ]} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "prices", label: "Prices", count: l.sums.items },
        { key: "customers", label: "Customers", count: l.sums.customers },
        { key: "history", label: "History" },
      ]} />

      {tab === "prices" && (
        <DataList<ItemRow>
          key={l.updatedAt + l.sums.exact}
          id="price-list-items"
          load={localList(async () => l.items, (r, q) => `${r.name} ${r.sku ?? ""} ${r.category ?? ""}`.toLowerCase().includes(q), {
            filter: (r, p) => (p.show === "exact" ? r.exactPaise !== null : p.show === "discount" ? r.exactPaise === null : true),
            counts: (rows) => ({ all: rows.length, exact: rows.filter((r) => r.exactPaise !== null).length, discount: rows.filter((r) => r.exactPaise === null).length }),
          })}
          tabs
          presets={[{ key: "all", label: "All items", params: {}, countKey: "all" }, { key: "exact", label: "Own price", params: { show: "exact" }, countKey: "exact" }, { key: "discount", label: "List discount", params: { show: "discount" }, countKey: "discount" }]}
          header={{ title: "Prices on this list", description: canEdit ? "Type a price to give an item its own rate on this list; clear it to go back to the discount." : "What each item costs a customer on this list." }}
          columns={[
            { key: "name", header: "Item", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span><Link href={`/app/m/catalog/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{r.name}</Link><span className="block text-xs text-muted-foreground">{[r.sku, r.category, r.unit].filter(Boolean).join(" · ")}</span></span> },
            { key: "base", header: "Standard", align: "right", sort: (r) => r.basePaise, csv: (r) => r.basePaise / 100, cell: (r) => <span className="tabular-nums text-muted-foreground">{formatPaise(r.basePaise)}</span> },
            { key: "price", header: "On this list", align: "right", sort: (r) => r.pricePaise, csv: (r) => r.pricePaise / 100, cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.pricePaise)}<span className="block text-xs font-normal text-muted-foreground">{r.exactPaise !== null ? "Own price" : "List discount"}</span></span> },
            { key: "off", header: "Off", align: "right", sort: (r) => r.offPct, csv: (r) => r.offPct, cell: (r) => <span className={cn("tabular-nums", r.offPct < 0 && "text-amber-600")}>{r.offPct ? `${r.offPct}%` : "—"}</span> },
            ...(showCost ? [
              { key: "cost", header: "Cost", align: "right" as const, defaultHidden: true, csv: (r: ItemRow) => (r.costPaise ?? 0) / 100, cell: (r: ItemRow) => <span className="tabular-nums text-muted-foreground">{r.costPaise !== null ? formatPaise(r.costPaise) : "—"}</span> },
              { key: "margin", header: "Margin", align: "right" as const, sort: (r: ItemRow) => r.marginPct ?? -999, csv: (r: ItemRow) => r.marginPct ?? "", cell: (r: ItemRow) => r.marginPct === null ? <span className="text-muted-foreground">—</span> : <span className={cn("tabular-nums", r.marginPct < 0 ? "font-medium text-destructive" : r.marginPct < 10 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>{r.marginPct}%</span> },
            ] : []),
            ...(canEdit ? [{ key: "exact", header: "Own price", hideable: false, cell: (r: ItemRow) => <ExactPrice listId={l.id} row={r} onSaved={() => void reload()} /> }] : []),
          ]}
          searchPlaceholder="Search item, SKU or category"
          exportName={`price-list-${l.name.toLowerCase().replace(/\s+/g, "-")}`}
          emptyState={<EmptyState icon={ListChecks} title="No items" />}
        />
      )}

      {tab === "customers" && (
        <DataList<CustomerRow>
          id="price-list-customers"
          load={localList(async () => l.customers, (r, q) => `${r.name} ${r.person ?? ""} ${r.phone ?? ""} ${r.gstin ?? ""}`.toLowerCase().includes(q))}
          header={{ title: "Customers on this list", description: "Choose the price list on a customer to add them here." }}
          columns={[
            { key: "name", header: "Customer", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span><span className="font-medium">{r.name}</span>{r.person && <span className="block text-xs text-muted-foreground">{r.person}</span>}</span> },
            { key: "phone", header: "Mobile", csv: (r) => r.phone ?? "", cell: (r) => r.phone ?? "—" },
            { key: "gstin", header: "GSTIN", defaultHidden: true, csv: (r) => r.gstin ?? "", cell: (r) => <span className="font-mono text-xs">{r.gstin ?? "—"}</span> },
            { key: "last", header: "Last bill", sort: (r) => r.lastBillOn ?? "", csv: (r) => r.lastBillOn?.slice(0, 10) ?? "", cell: (r) => (r.lastBillOn ? formatDate(r.lastBillOn) : "Never") },
            { key: "sold", header: "Bought (90 days)", align: "right", sort: (r) => r.sold90Paise, csv: (r) => r.sold90Paise / 100, cell: (r) => <span className="font-semibold tabular-nums">{r.sold90Paise ? formatPaise(r.sold90Paise) : "—"}</span> },
          ]}
          searchPlaceholder="Search customer, mobile or GSTIN"
          rowHref={(r) => `/app/m/sales/customers/${r.id}`}
          exportName="price-list-customers"
          emptyState={<EmptyState icon={Users} title="No customers on this list" description="Open a customer, edit them and choose this price list." />}
        />
      )}

      {tab === "history" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <RecordHistory kind="price_list" id={l.id} created={{ at: l.createdAt }} />
          <AboutCard id={l.id} createdAt={l.createdAt} updatedAt={l.updatedAt} className="h-fit" />
        </div>
      )}

      {editing && <PriceListDialog list={l} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload() }} />}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        destructive
        title={`Delete ${l.name}?`}
        description={`${l.sums.customers} customers go back to standard prices. Bills already made don't change.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/price-lists/${l.id}`)
            toast.success("Price list deleted")
            router.push("/app/m/catalog/price-lists")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </div>
  )
}

export default function Page() {
  return <React.Suspense><PriceListPage /></React.Suspense>
}
