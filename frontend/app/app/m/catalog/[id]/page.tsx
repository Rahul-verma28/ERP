"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Archive, ArchiveRestore, ArrowLeftRight, Copy, Package, Pencil, Plus, SlidersHorizontal, Trash2, Wrench } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog, EmptyState, Spinner } from "@/components/common"
import { ActionMenu, BackLink, DetailHeader, DetailList, Pill, Section, StatGrid, Tabs } from "@/components/page-parts"
import { StockDialog } from "@/components/stock-dialogs"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { type Category, type Item } from "@/lib/catalog"
import { formatDate, formatPaise } from "@/lib/format"
import { qty } from "@/lib/inventory"
import { cn } from "@/lib/utils"
import { PageError, PageLoading } from "@/components/page-states"

// One item: what it is and costs, where its stock is and how it moved, and where it was sold and
// bought. Stock actions are one click away.

interface Ledger {
  quantity: number
  valuePaise: number
  averagePaise: number
  byLocation: { locationId: string; location: string; quantity: number; valuePaise: number }[]
  rows: { id: string; date: string; kind: string; label: string; location: string; quantity: number; ratePaise: number; balance: number; sourceType: string; sourceId: string; reversal: boolean; document: { number: string | null; kind: string; party: string | null } | null }[]
}
interface Line { id: string; quantity: number; ratePaise: number; document: { id: string; kind: string; number: string | null; date: string; party: string | null } }
interface History { sold: Line[]; bought: Line[]; totals: { sold: { quantity: number; valuePaise: number }; bought: { quantity: number; valuePaise: number } } }

type Tab = "overview" | "stock" | "sales" | "purchases"
const LEDGER_HREF: Record<string, string> = { invoice: "/app/m/billing/", delivery_challan: "/app/m/sales/challans/", credit_note: "/app/m/billing/credit-notes/", stock_entry: "/app/m/inventory/entries/", purchase: "/app/m/purchase/" }
const SALE_HREF = (d: Line["document"]) => (d.kind === "credit_note" ? `/app/m/billing/credit-notes/${d.id}` : `/app/m/billing/${d.id}`)

function LineTable({ rows, unit, href, empty, partyLabel }: { rows: Line[]; unit: string; href: (d: Line["document"]) => string; empty: string; partyLabel: string }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Document</th><th className="px-3 py-2 font-medium">{partyLabel}</th><th className="px-3 py-2 text-right font-medium">Qty</th><th className="px-5 py-2 text-right font-medium">Rate</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const back = r.document.kind === "credit_note" || r.document.kind === "purchase_return"
            return (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="px-5 py-2 whitespace-nowrap">{formatDate(r.document.date)}</td>
                <td className="px-3 py-2"><Link href={href(r.document)} className="font-mono text-xs text-primary hover:underline">{r.document.number ?? "—"}</Link>{back && <Pill color="rose" className="ml-2">Return</Pill>}</td>
                <td className="px-3 py-2">{r.document.party ?? "—"}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", back && "text-destructive")}>{back ? "−" : ""}{qty(r.quantity)} {unit}</td>
                <td className="px-5 py-2 text-right tabular-nums">{formatPaise(r.ratePaise)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ItemPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const params = useSearchParams()
  const { can, me } = useAuth()
  const { data: item, error, reload } = useApi<Item>(`/items/${id}`)
  const categories = useApi<{ data: Category[] }>("/item-categories")
  const showStock = can("inventory.stock.view")
  const product = item?.type === "product"
  const ledger = useApi<Ledger>(showStock && product && item?.trackStock ? `/stock/items/${id}` : null)
  const history = useApi<History>(`/items/${id}/history`)
  const [tab, setTab] = React.useState<Tab>((params.get("tab") as Tab) || "overview")
  const [stock, setStock] = React.useState<"add" | "adjust" | "move" | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const showCost = !!me?.fieldAccess?.["item.cost_price"] && me.fieldAccess["item.cost_price"] !== "hidden"
  const showValue = can("inventory.valuation.view") || can("inventory.receipt.create")

  if (error) return <PageError error={error} />
  if (!item) return <PageLoading />

  const category = categories.data?.data.find((c) => c.id === item.categoryId)?.name
  const margin = item.costPricePaise && item.pricePaise ? Math.round(((item.pricePaise - item.costPricePaise) / item.pricePaise) * 100) : null
  const withGst = Math.round(item.pricePaise * (1 + item.gstRateBp / 10_000))
  const inStock = item.stockQty ?? 0
  const low = item.trackStock && item.reorderLevel != null && inStock <= item.reorderLevel
  const reload2 = () => { void reload(); void ledger.reload(); void history.reload() }

  async function setActive(active: boolean) {
    try {
      await api.patch(`/items/${item!.id}`, { isActive: active, version: item!.version })
      toast.success(active ? "Item restored" : "Item archived")
      void reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const stockTarget = { id: item.id, name: item.name, unit: item.unit, sku: item.sku, tracking: item.tracking, costPaise: item.costPricePaise ?? null, warehouses: item.warehouses }
  const canStock = product && item.isActive && showStock
  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/catalog">Items</BackLink>
      <DetailHeader
        title={item.name}
        imageUrl={item.imageUrl}
        icon={product ? Package : Wrench}
        pills={<>
          <Pill color={product ? "blue" : "violet"}>{product ? "Product" : "Service"}</Pill>
          {!item.isActive && <Pill color="slate">Archived</Pill>}
          {item.tracking && item.tracking !== "none" && <Pill color="cyan">{item.tracking === "batch" ? "Batch tracked" : "Serial tracked"}</Pill>}
          {low && <Pill color="amber" dot>Low stock</Pill>}
        </>}
        subtitle={[item.sku && `SKU ${item.sku}`, item.hsnSac && `${product ? "HSN" : "SAC"} ${item.hsnSac}`, item.unit, `GST ${item.gstRateBp / 100}%`, category].filter(Boolean).join(" · ")}
        actions={<>
          {canStock && can("inventory.receipt.create") && <Button variant="outline" onClick={() => setStock("add")}><Plus /> Add stock</Button>}
          {can("catalog.item.edit") && <Link href={`/app/m/catalog/new?edit=${item.id}`} className={buttonVariants()}><Pencil /> Edit</Link>}
          <ActionMenu items={[
            canStock && can("inventory.stock_adjustment.create") && { label: "Adjust stock", icon: SlidersHorizontal, onClick: () => setStock("adjust") },
            canStock && can("inventory.transfer.create") && { label: "Move to another warehouse", icon: ArrowLeftRight, onClick: () => setStock("move") },
            "-",
            can("catalog.item.create") && { label: "Make a copy", icon: Copy, href: `/app/m/catalog/new?copy=${item.id}` },
            can("catalog.item.edit") && (item.isActive ? { label: "Archive", icon: Archive, onClick: () => void setActive(false) } : { label: "Restore", icon: ArchiveRestore, onClick: () => void setActive(true) }),
            "-",
            can("catalog.item.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(true) },
          ]} />
        </>}
      />

      <StatGrid items={[
        { label: "Sale price", value: formatPaise(item.pricePaise), hint: `${formatPaise(withGst)} with GST`, accent: "text-emerald-700 dark:text-emerald-300" },
        showCost && { label: "Purchase price", value: item.costPricePaise != null ? formatPaise(item.costPricePaise) : "Not set", hint: margin != null ? `${margin}% margin` : "Set it to see the margin", accent: margin != null && margin < 0 ? "text-destructive" : undefined },
        product && item.trackStock && showStock ? { label: "In stock", value: `${qty(inStock)} ${item.unit}`, hint: item.reservedQty ? `${qty(item.reservedQty)} held for orders` : item.reorderLevel != null ? `Low at ${qty(item.reorderLevel)}` : "No low-stock level", accent: inStock < 0 ? "text-destructive" : low ? "text-amber-700 dark:text-amber-300" : undefined } : product ? { label: "Stock", value: "Not tracked", hint: "Turn on stock tracking in Edit" } : null,
        { label: "Sold, all time", value: history.data ? `${qty(history.data.totals.sold.quantity)} ${item.unit}` : "…", hint: history.data ? formatPaise(history.data.totals.sold.valuePaise) : undefined },
      ]} />

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "overview", label: "Overview" },
        { key: "stock", label: "Stock", count: ledger.data?.rows.length, hidden: !(product && item.trackStock && showStock) },
        { key: "sales", label: "Sales", count: history.data?.sold.length },
        { key: "purchases", label: "Purchases", count: history.data?.bought.length, hidden: !product },
      ]} />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Details" action={can("catalog.item.edit") && <Link href={`/app/m/catalog/new?edit=${item.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}><Pencil /> Edit</Link>}>
            <DetailList items={[
              ["Type", product ? "Product" : "Service"], ["Category", category],
              ["SKU", item.sku], ["Barcode", item.barcode],
              [product ? "HSN code" : "SAC code", item.hsnSac], ["GST rate", `${item.gstRateBp / 100}%`],
              ["Unit", item.unit], item.altUnit ? ["Second unit", `1 ${item.altUnit} = ${item.altFactor} ${item.unit}`] : null,
              !product ? ["Duration", item.durationMin ? `${item.durationMin} min` : null] : null,
              product ? ["Stock tracking", item.trackStock ? (item.tracking === "batch" ? "By batch and expiry" : item.tracking === "serial" ? "By serial number" : "By quantity") : "Off"] : null,
              product && item.trackStock ? ["Low-stock level", item.reorderLevel != null ? `${qty(item.reorderLevel)} ${item.unit}` : null] : null,
            ]} />
            {item.description && <p className="mt-4 rounded-2xl bg-muted/60 p-3 text-sm whitespace-pre-wrap">{item.description}</p>}
          </Section>
          <Section title="Prices">
            <DetailList items={[
              ["Sale price", formatPaise(item.pricePaise)], ["With GST", formatPaise(withGst)],
              showCost && ["Purchase price", item.costPricePaise != null ? formatPaise(item.costPricePaise) : null], showCost && ["Margin", margin != null ? `${margin}% · ${formatPaise(item.pricePaise - (item.costPricePaise ?? 0))} a ${item.unit}` : null],
              history.data && ["Sold, all time", `${qty(history.data.totals.sold.quantity)} ${item.unit} · ${formatPaise(history.data.totals.sold.valuePaise)}`],
              history.data && product && ["Bought, all time", `${qty(history.data.totals.bought.quantity)} ${item.unit} · ${formatPaise(history.data.totals.bought.valuePaise)}`],
            ]} />
            <p className="mt-4 text-xs text-muted-foreground">Customer-specific rates live in <Link href="/app/m/catalog/price-lists" className="underline">Price lists</Link>.</p>
          </Section>
        </div>
      )}

      {tab === "stock" && (
        <div className="grid gap-5">
          {ledger.data && (
            <>
              <StatGrid items={[
                { label: "In stock", value: `${qty(ledger.data.quantity)} ${item.unit}`, accent: ledger.data.quantity < 0 ? "text-destructive" : undefined },
                showValue && { label: "Stock value", value: formatPaise(ledger.data.valuePaise) },
                showValue && { label: "Average cost", value: ledger.data.quantity > 0 ? formatPaise(ledger.data.averagePaise) : "—" },
              ]} />
              <Section title="By warehouse" flush>
                {ledger.data.byLocation.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No stock anywhere.</p> : (
                  <ul className="divide-y">
                    {ledger.data.byLocation.map((b) => (
                      <li key={b.locationId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                        <Link href={`/app/m/inventory/warehouses/${b.locationId}`} className="font-medium hover:underline">{b.location}</Link>
                        <span className="flex items-center gap-4 tabular-nums"><span className={cn("font-semibold", b.quantity < 0 && "text-destructive")}>{qty(b.quantity)} {item.unit}</span>{showValue && <span className="text-muted-foreground">{formatPaise(b.valuePaise)}</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title="Stock ledger" description="Every move in date order, with the balance after it" flush>
                {ledger.data.rows.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No movement yet.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">What</th><th className="px-3 py-2 font-medium">Warehouse</th><th className="px-3 py-2 text-right font-medium">In</th><th className="px-3 py-2 text-right font-medium">Out</th>{showValue && <th className="px-3 py-2 text-right font-medium">Rate</th>}<th className="px-5 py-2 text-right font-medium">Balance</th></tr></thead>
                      <tbody>
                        {ledger.data.rows.map((r) => (
                          <tr key={r.id} className="border-b border-border/60 last:border-0">
                            <td className="px-5 py-2 whitespace-nowrap">{formatDate(r.date)}</td>
                            <td className="px-3 py-2"><Link href={`${LEDGER_HREF[r.sourceType] ?? "#"}${r.sourceId}`} className="hover:underline">{r.label}{r.document?.number && <span className="ml-1 font-mono text-xs text-primary">{r.document.number}</span>}</Link>{r.reversal && <Pill className="ml-2">Undone</Pill>}{r.document?.party && <span className="block text-xs text-muted-foreground">{r.document.party}</span>}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.location}</td>
                            <td className="px-3 py-2 text-right text-emerald-700 tabular-nums dark:text-emerald-300">{r.quantity > 0 ? qty(r.quantity) : ""}</td>
                            <td className="px-3 py-2 text-right text-rose-700 tabular-nums dark:text-rose-300">{r.quantity < 0 ? qty(-r.quantity) : ""}</td>
                            {showValue && <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{formatPaise(r.ratePaise)}</td>}
                            <td className={cn("px-5 py-2 text-right font-semibold tabular-nums", r.balance < 0 && "text-destructive")}>{qty(r.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </>
          )}
          {!ledger.data && (ledger.error ? <PageError error={ledger.error} onRetry={() => void ledger.reload()} /> : <div className="grid place-items-center py-16"><Spinner /></div>)}
        </div>
      )}

      {tab === "sales" && (
        <Section title="Sold lately" description="The last 20 invoices and returns with this item" flush>
          {history.error && !history.data ? <PageError error={history.error} onRetry={() => void history.reload()} /> : history.data ? <LineTable rows={history.data.sold} unit={item.unit} href={SALE_HREF} partyLabel="Customer" empty="Not sold yet." /> : <div className="grid place-items-center py-10"><Spinner /></div>}
        </Section>
      )}
      {tab === "purchases" && (
        <Section title="Bought lately" description="The last 20 supplier invoices and returns with this item" flush>
          {history.error && !history.data ? <PageError error={history.error} onRetry={() => void history.reload()} /> : history.data ? <LineTable rows={history.data.bought} unit={item.unit} href={(d) => `/app/m/purchase/${d.id}`} partyLabel="Supplier" empty="Not bought yet." /> : <div className="grid place-items-center py-10"><Spinner /></div>}
        </Section>
      )}

      {!product && tab === "overview" && !history.data?.sold.length && <EmptyState icon={Wrench} title="Not billed yet" description="Add this service to an invoice and it shows here." />}
      {stock && <StockDialog kind={stock} item={stockTarget} onClose={() => setStock(null)} onDone={() => { setStock(null); reload2() }} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        destructive
        title={`Delete ${item.name}?`}
        description="If it is on any bill or stock record it is archived instead, so your history stays correct."
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/items/${item.id}`)
            toast.success("Item removed")
            router.push("/app/m/catalog")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </div>
  )
}

export default function Page() {
  return <React.Suspense><ItemPage /></React.Suspense>
}
