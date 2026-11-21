"use client"

import * as React from "react"
import { toast } from "sonner"
import { Archive, ArchiveRestore, Eye, IndianRupee, ListChecks, Pencil, Plus, Tags, Trash2, Users } from "lucide-react"
import Link from "next/link"
import { SummaryCards } from "@/components/summary-cards"
import { ActionMenu, Pill } from "@/components/page-parts"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { PriceListDialog, type PriceList } from "@/components/catalog/price-list-dialog"
import { DataList, remoteList } from "@/components/data-list"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"

// Rates for a group of customers: a discount on everything, and exact prices for some items.

export default function PriceListsPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const reload = () => setVersion((v) => v + 1)
  const [editing, setEditing] = React.useState<PriceList | "new" | null>(null)
  const [removing, setRemoving] = React.useState<PriceList | null>(null)

  if (!can("catalog.price_list.view")) return <PageHeader title="Price lists" description="You don't have access to price lists. Ask your admin." />

  async function toggle(l: PriceList) {
    try {
      await api.patch(`/price-lists/${l.id}`, { isActive: l.isActive === false })
      toast.success(l.isActive === false ? `${l.name} is active again` : `${l.name} is inactive`)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const add = can("catalog.price_list.create") && <Button onClick={() => setEditing("new")}><Plus /> New price list</Button>
  return (
    <>
      <DataList<PriceList>
        id="price-lists"
        load={remoteList(async (p) => {
          const res = await api.get<{ data: PriceList[]; sums: Record<string, number> }>("/price-lists")
          const counts = { all: res.data.length, active: res.data.filter((l) => l.isActive !== false).length, inactive: res.data.filter((l) => l.isActive === false).length }
          return { ...res, counts, data: res.data.filter((l) => (p.show === "active" ? l.isActive !== false : p.show === "inactive" ? l.isActive === false : true)) }
        }, (l, q) => `${l.name} ${(l.customers ?? []).join(" ")}`.toLowerCase().includes(q))}
        presetLabel="Show"
        presets={[{ key: "active", label: "Active", params: { show: "active" }, countKey: "active" }, { key: "inactive", label: "Inactive", params: { show: "inactive" }, countKey: "inactive" }, { key: "all", label: "All", params: {}, countKey: "all" }]}
        top={(res) => {
          const s = (res.sums ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Price lists", value: s.lists ?? 0, hint: "Wholesale, retail and others", color: "blue", icon: Tags },
            { label: "Customers on a list", value: s.customers ?? 0, hint: "Their new bills use the list", color: "violet", icon: Users },
            { label: "Exact prices", value: s.prices ?? 0, hint: "Items with their own rate", color: "amber", icon: ListChecks },
            { label: "Sold on lists", value: formatPaise(s.sold30 ?? 0), hint: "Last 30 days, to these customers", color: "emerald", icon: IndianRupee },
          ]} />
        }}
        params={{ v: String(version) }}
        header={{ title: "Price lists", description: "Wholesale, retail or any other rates. Choose a list on the customer, and their new bills use it.", primary: add || undefined }}
        columns={[
          { key: "name", header: "Name", hideable: false, sort: (l) => l.name, cell: (l) => <span className="flex items-center gap-2.5"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Tags className="size-4" /></span><span className="font-medium">{l.name}</span>{l.discountBp > 0 && <Pill color="emerald">{l.discountBp / 100}% off</Pill>}</span> },
          { key: "discount", header: "Discount", align: "right", sort: (l) => l.discountBp, cell: (l) => `${l.discountBp / 100}%` },
          { key: "items", header: "Exact prices", align: "right", sort: (l) => l.itemCount, cell: (l) => l.itemCount },
          { key: "customers", header: "Customers", sort: (l) => l.customerCount, cell: (l) => <span className="text-sm"><span className="font-medium tabular-nums">{l.customerCount}</span>{!!l.customers?.length && <span className="block max-w-72 truncate text-xs text-muted-foreground" title={l.customers.join(", ")}>{l.customers.join(", ")}{l.customerCount > l.customers.length ? ` +${l.customerCount - l.customers.length}` : ""}</span>}</span> },
          { key: "status", header: "Status", csv: (l) => (l.isActive === false ? "Inactive" : "Active"), cell: (l) => <Pill color={l.isActive === false ? "slate" : "emerald"} dot>{l.isActive === false ? "Inactive" : "Active"}</Pill> },
          { key: "sold", header: "Sold (30 days)", align: "right", sort: (l) => l.sold30Paise ?? 0, cell: (l) => <span className="tabular-nums">{l.sold30Paise ? formatPaise(l.sold30Paise) : "—"}</span> },
          ...([{ key: "actions", header: "Actions", hideable: false, cell: (l: PriceList) => <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}><Link href={`/app/m/catalog/price-lists/${l.id}`} title="View" aria-label={`View ${l.name}`} className="grid size-8 place-items-center rounded-md hover:bg-muted"><Eye className="size-4" /></Link>{can("catalog.price_list.edit") && <Button variant="ghost" size="icon-sm" title="Edit prices" aria-label={`Edit ${l.name}`} onClick={() => setEditing(l)}><Pencil /></Button>}<ActionMenu label={`More actions for ${l.name}`} items={[can("catalog.price_list.edit") && (l.isActive === false ? { label: "Make active", icon: ArchiveRestore, onClick: () => void toggle(l) } : { label: "Make inactive", icon: Archive, onClick: () => void toggle(l) }), "-", can("catalog.price_list.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setRemoving(l) }]} /></span> }]),
        ]}
        searchPlaceholder="Search price lists"
        rowHref={(l) => `/app/m/catalog/price-lists/${l.id}`}
        emptyState={<EmptyState icon={Tags} title="No price lists yet" description="Make one for wholesale customers, then choose it on those customers." action={add || undefined} />}
      />
      {editing && <PriceListDialog list={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        title={`Delete ${removing?.name}?`}
        description={`${removing?.customerCount ?? 0} customers go back to standard prices. Bills already made don't change. To keep their prices but stop using the list for others, make it inactive instead.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/price-lists/${removing!.id}`)
            toast.success("Price list deleted")
            reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
