"use client"

import * as React from "react"
import { toast } from "sonner"
import { Archive, ArchiveRestore, MapPin, Pencil, Phone, Plus, Star, Warehouse } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { DataList, localList } from "@/components/data-list"
import { WarehouseFormDialog } from "@/components/warehouse-form"
import { stateName } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import type { StockLocation } from "@/lib/inventory"

export default function WarehousesPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const reload = () => setVersion((v) => v + 1)
  const [editing, setEditing] = React.useState<StockLocation | "new" | null>(null)
  if (!can("inventory.stock.view")) return <PageHeader title="Warehouses" description="You don't have access to stock. Ask your admin." />
  const act = async (g: StockLocation, patch: Record<string, unknown>, done: string) => {
    try {
      await api.patch(`/stock-locations/${g.id}`, patch)
      toast.success(done)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <>
      <DataList<StockLocation>
        id="warehouses"
        load={localList(async () => (await api.get<{ data: StockLocation[] }>("/stock-locations")).data, (w, q) => `${w.name} ${w.city ?? ""} ${w.address ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Manage Warehouses", description: "Where you keep stock. Sales take stock from the default warehouse.", primary: can("inventory.warehouse.create") ? <Button onClick={() => setEditing("new")}><Plus /> Create warehouse</Button> : undefined }}
        columns={[
          {
            key: "name", header: "Name", hideable: false, sort: (g) => g.name,
            cell: (g) => (
              <span className="flex items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Warehouse className="size-4" aria-hidden /></span>
                <span className="min-w-0"><span className="block font-medium">{g.name}{g.isDefault && <Badge variant="outline" className="ml-2">Default</Badge>}</span>{g.email && <span className="block text-xs text-muted-foreground">{g.email}</span>}</span>
              </span>
            ),
          },
          { key: "address", header: "Address", cell: (g) => (g.address ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5 text-muted-foreground" aria-hidden />{g.address}</span> : "—") },
          { key: "city", header: "City", sort: (g) => g.city ?? "", cell: (g) => g.city ?? "—" },
          { key: "state", header: "State", cell: (g) => (g.stateCode ? stateName(g.stateCode) : <span className="text-destructive">Add the state</span>) },
          { key: "person", header: "In-charge", defaultHidden: true, cell: (g) => g.contactPerson ?? "—" },
          { key: "zip", header: "PIN code", cell: (g) => (g.zipCode ? <Badge variant="outline">{g.zipCode}</Badge> : "—") },
          { key: "phone", header: "Phone", cell: (g) => (g.phone ? <span className="inline-flex items-center gap-1.5 tabular-nums"><Phone className="size-3.5 text-muted-foreground" aria-hidden />{g.phone}</span> : "—") },
          { key: "items", header: "Items in stock", align: "right", defaultHidden: true, sort: (g) => g.itemsInStock, cell: (g) => g.itemsInStock },
          { key: "value", header: "Value", align: "right", defaultHidden: true, sort: (g) => g.valuePaise, cell: (g) => formatPaise(g.valuePaise) },
          { key: "status", header: "Status", cell: (g) => <Badge variant={g.isActive ? "secondary" : "outline"}>{g.isActive ? "Active" : "Closed"}</Badge> },
          ...(can("inventory.warehouse.edit") ? [{
            key: "actions", header: "Actions", hideable: false,
            cell: (g: StockLocation) => (
              <span className="flex gap-0.5">
                <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)}><Pencil /></Button>
                {g.isActive && !g.isDefault && <Button variant="ghost" size="icon-sm" title="Make default" aria-label={`Make ${g.name} default`} onClick={() => act(g, { isDefault: true }, `${g.name} is the default`)}><Star /></Button>}
                {!g.isDefault && <Button variant="ghost" size="icon-sm" title={g.isActive ? "Close" : "Reopen"} aria-label={`${g.isActive ? "Close" : "Reopen"} ${g.name}`} onClick={() => act(g, { isActive: !g.isActive }, g.isActive ? `${g.name} closed` : `${g.name} reopened`)}>{g.isActive ? <Archive /> : <ArchiveRestore />}</Button>}
              </span>
            ),
          }] : []),
        ]}
        searchPlaceholder="Search warehouses"
        emptyState={<EmptyState icon={Warehouse} title="No warehouses yet" />}
      />
      {editing && <WarehouseFormDialog warehouse={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}
