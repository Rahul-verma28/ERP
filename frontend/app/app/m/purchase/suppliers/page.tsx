"use client"

import { ActionMenu } from "@/components/page-parts"
import * as React from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Eye, FilePlus2, IndianRupee, MessageCircle, Pencil, Plus, Truck } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/common"
import { DataList, type Column } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { SupplierDialog } from "@/components/supplier-dialog"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import type { Supplier } from "@/lib/purchase"

// Everyone you buy from, with what you owe each of them.

export default function SuppliersPage() {
  const { can } = useAuth()
  const router = useRouter()
  const [adding, setAdding] = React.useState(false)
  const [editing, setEditing] = React.useState<Supplier | null>(null)
  const [version, setVersion] = React.useState(0)
  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })
  if (!can("inventory.supplier.view")) return <PageHeader title="Suppliers" description="You don't have access to suppliers. Ask your admin." />
  const columns: Column<Supplier>[] = [
    { key: "name", header: "Supplier", hideable: false, cell: (r) => <span className="font-semibold">{r.companyName || r.name}{r.companyName && <span className="block text-xs font-normal text-muted-foreground">{r.name}</span>}{!r.isActive && <Badge variant="outline" className="ml-2">Inactive</Badge>}</span>, csv: (r) => r.companyName || r.name, sort: (r) => r.companyName || r.name },
    { key: "gstin", header: "GSTIN", cell: (r) => (r.gstin ? <span className="font-mono text-xs">{r.gstin}</span> : <span className="text-muted-foreground">Not registered</span>), csv: (r) => r.gstin ?? "" },
    { key: "phone", header: "Phone", cell: (r) => r.phone ?? "—", csv: (r) => r.phone ?? "" },
    { key: "days", header: "Payment days", align: "right", defaultHidden: true, cell: (r) => (r.paymentDays == null ? "—" : r.paymentDays), csv: (r) => r.paymentDays ?? "" },
    { key: "balance", header: "You owe", align: "right", cell: (r) => <span className={r.balancePaise < 0 ? "tabular-nums text-emerald-700 dark:text-emerald-300" : "font-medium tabular-nums"}>{r.balancePaise ? formatPaise(Math.abs(r.balancePaise)) : "—"}{r.balancePaise < 0 && <span className="block text-xs">they owe you</span>}</span>, csv: (r) => r.balancePaise / 100, sort: (r) => r.balancePaise },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Link href={`/app/m/purchase/suppliers/${r.id}`} className={icon} title="View ledger" aria-label={`View ${r.name}`}><Eye /></Link>
          {can("inventory.supplier_bill.create") && <Link href={`/app/m/purchase/new?kind=purchase_bill&supplier=${r.id}`} className={icon} title="New invoice" aria-label={`New invoice from ${r.name}`}><FilePlus2 /></Link>}
          {can("inventory.supplier_bill.create") && <Link href={`/app/m/purchase/payments?new=1&supplier=${r.id}`} className={icon} title="Pay supplier" aria-label={`Pay ${r.name}`}><IndianRupee /></Link>}
          <ActionMenu label={`More actions for ${r.name}`} items={[
            can("inventory.supplier.edit") && { label: "Edit", icon: Pencil, onClick: () => setEditing(r) },
            r.phone && { label: "WhatsApp", icon: MessageCircle, onClick: () => window.open(`https://wa.me/${r.phone!.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}`, "_blank", "noopener") },
          ]} />
        </span>
      ),
    },
  ]
  return (
    <>
      <DataList<Supplier>
        id="suppliers"
        path="/suppliers"
        params={{ v: String(version) }}
        header={{
          title: "Manage Suppliers",
          description: "Everyone you buy from, and what you owe each of them.",
          primary: can("inventory.supplier.create") ? <Button onClick={() => setAdding(true)}><Plus /> New supplier</Button> : undefined,
        }}
        columns={columns}
        searchPlaceholder="Search name, phone or GSTIN"
        presetLabel="Show"
        presets={[{ key: "active", label: "Active", params: {} }, { key: "inactive", label: "Inactive", params: { active: "false" } }]}
        rowHref={(r) => `/app/m/purchase/suppliers/${r.id}`}
        exportName="suppliers"
        emptyState={<EmptyState icon={Truck} title="No suppliers yet" description="Add the people you buy from. Their bills, payments and what you owe show here." action={can("inventory.supplier.create") ? <Button onClick={() => setAdding(true)}>New supplier</Button> : undefined} />}
      />
      <SupplierDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} supplier={editing ?? undefined} onSaved={() => { setEditing(null); setVersion((v) => v + 1) }} />
      <SupplierDialog open={adding} onOpenChange={setAdding} onSaved={(s) => router.push(`/app/m/purchase/suppliers/${s.id}`)} />
    </>
  )
}
