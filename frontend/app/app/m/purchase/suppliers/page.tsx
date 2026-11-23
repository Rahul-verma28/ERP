"use client"

import { ActionMenu, Pill } from "@/components/page-parts"
import * as React from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { AlarmClock, BookOpen, CalendarDays, Eye, FilePlus2, FileText, IndianRupee, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Receipt, Truck, Users } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/common"
import { DataList, type Column, type ViewPreset } from "@/components/data-list"
import { SupplierDialog } from "@/components/supplier-dialog"
import { SummaryCards } from "@/components/summary-cards"
import { RecordView } from "@/components/record-view"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise, initials } from "@/lib/format"
import { stateName } from "@contracts/validation"
import type { Supplier } from "@/lib/purchase"
import { cn } from "@/lib/utils"
import { NoAccessPage } from "@/components/page-states"

// Everyone you buy from: what you bought, paid and still owe each of them, in one request.

const PRESETS: ViewPreset[] = [
  { key: "active", label: "Active", params: {}, countKey: "active" },
  { key: "dues", label: "You owe", params: { owing: "dues" }, countKey: "dues" },
  { key: "overdue", label: "Overdue", params: { active: "all", owing: "overdue" }, countKey: "overdue" },
  { key: "inactive", label: "Inactive", params: { active: "false" }, countKey: "inactive" },
  { key: "all", label: "All", params: { active: "all" }, countKey: "all" },
]
const place = (s: Supplier) => [s.address?.city, s.stateCode ? stateName(s.stateCode) : null].filter(Boolean).join(", ")
const whatsapp = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}`

export default function SuppliersPage() {
  const { can } = useAuth()
  const router = useRouter()
  const [adding, setAdding] = React.useState(false)
  const [editing, setEditing] = React.useState<Supplier | null>(null)
  const [viewing, setViewing] = React.useState<Supplier | null>(null)
  const [version, setVersion] = React.useState(0)
  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })
  if (!can("inventory.supplier.view")) return <NoAccessPage title="Suppliers" permission="inventory.supplier.view" />
  const canBill = can("inventory.supplier_bill.create")
  const owe = (p: number) => (p < 0 ? <span className="text-emerald-700 dark:text-emerald-300">{formatPaise(-p)}<span className="block text-[11px]">they owe you</span></span> : p ? formatPaise(p) : <span className="text-muted-foreground">—</span>)

  const columns: Column<Supplier>[] = [
    {
      key: "name", header: "Supplier", hideable: false, sort: (r) => (r.companyName || r.name).toLowerCase(), csv: (r) => r.companyName || r.name,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(r.companyName || r.name)}</span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-semibold">{r.companyName || r.name}{!r.isActive && <Pill>Inactive</Pill>}</span>
            <span className="block truncate text-xs text-muted-foreground">{r.email ?? (r.companyName ? r.name : "—")}</span>
          </span>
        </span>
      ),
    },
    { key: "contact", header: "Contact", csv: (r) => r.phone ?? "", cell: (r) => <span className="text-sm">{r.companyName && <span className="block font-medium">{r.name}</span>}<span className="text-muted-foreground">{r.phone ?? "—"}</span></span> },
    { key: "gstin", header: "GSTIN", csv: (r) => r.gstin ?? "", cell: (r) => (r.gstin ? <span className="rounded-md bg-violet-50 px-1.5 py-0.5 font-mono text-xs text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">{r.gstin}</span> : <span className="text-xs text-muted-foreground">Not registered</span>) },
    { key: "place", header: "Place", csv: place, cell: (r) => place(r) || "—" },
    { key: "bills", header: "Invoices", align: "right", sort: (r) => r.billCount ?? 0, csv: (r) => r.billCount ?? 0, cell: (r) => <span className="tabular-nums">{r.billCount || "—"}</span> },
    { key: "billed", header: "Total bought", align: "right", sort: (r) => r.billedPaise ?? 0, csv: (r) => (r.billedPaise ?? 0) / 100, cell: (r) => <span className="tabular-nums">{r.billedPaise ? formatPaise(r.billedPaise) : "—"}</span> },
    { key: "paid", header: "Paid", align: "right", defaultHidden: true, sort: (r) => r.paidPaise ?? 0, csv: (r) => (r.paidPaise ?? 0) / 100, cell: (r) => <span className="tabular-nums text-emerald-700 dark:text-emerald-300">{r.paidPaise ? formatPaise(r.paidPaise) : "—"}</span> },
    { key: "balance", header: "You owe", align: "right", sort: (r) => r.balancePaise, csv: (r) => r.balancePaise / 100, cell: (r) => <span className={cn("font-semibold tabular-nums", r.balancePaise > 0 && "text-orange-600 dark:text-orange-300")}>{owe(r.balancePaise)}</span> },
    { key: "overdue", header: "Overdue", align: "right", sort: (r) => r.overduePaise ?? 0, csv: (r) => (r.overduePaise ?? 0) / 100, cell: (r) => (r.overduePaise ? <span className="tabular-nums text-destructive">{formatPaise(r.overduePaise)}<span className="block text-[11px]">{r.overdueCount} invoice{r.overdueCount === 1 ? "" : "s"}</span></span> : <span className="text-muted-foreground">—</span>) },
    { key: "last", header: "Last purchase", sort: (r) => r.lastBillOn ?? "", csv: (r) => r.lastBillOn?.slice(0, 10) ?? "", cell: (r) => (r.lastBillOn ? formatDate(r.lastBillOn) : <span className="text-muted-foreground">Never</span>) },
    { key: "days", header: "Pay within", align: "right", defaultHidden: true, cell: (r) => (r.paymentDays == null ? "—" : `${r.paymentDays} days`), csv: (r) => r.paymentDays ?? "" },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={icon} title="View" aria-label={`View ${r.name}`} onClick={() => setViewing(r)}><Eye /></button>
          <Link href={`/app/m/purchase/suppliers/${r.id}`} className={icon} title="Statement" aria-label={`Statement of ${r.name}`}><BookOpen /></Link>
          {canBill && <Link href={`/app/m/purchase/new?kind=purchase_bill&supplier=${r.id}`} className={icon} title="New invoice" aria-label={`New invoice from ${r.name}`}><FilePlus2 /></Link>}
          {canBill && r.balancePaise > 0 && <Link href={`/app/m/purchase/payments?new=1&supplier=${r.id}`} className={cn(icon, "text-emerald-700 dark:text-emerald-300")} title="Pay supplier" aria-label={`Pay ${r.name}`}><IndianRupee /></Link>}
          <ActionMenu label={`More actions for ${r.name}`} items={[
            can("inventory.supplier.edit") && { label: "Edit", icon: Pencil, onClick: () => setEditing(r) },
            r.phone && { label: "WhatsApp", icon: MessageCircle, onClick: () => window.open(whatsapp(r.phone!), "_blank", "noopener") },
            r.phone && { label: "Call", icon: Phone, href: `tel:${r.phone}` },
          ]} />
        </span>
      ),
    },
  ]
  const v = viewing
  return (
    <>
      <DataList<Supplier>
        id="suppliers"
        path="/suppliers"
        params={{ v: String(version) }}
        header={{
          title: "Manage Suppliers",
          description: "Everyone you buy from: what you bought, paid and still owe each of them.",
          primary: can("inventory.supplier.create") ? <Button onClick={() => setAdding(true)}><Plus /> New supplier</Button> : undefined,
        }}
        columns={columns}
        searchPlaceholder="Search name, phone, email or GSTIN"
        presets={PRESETS}
        tabs
        top={(res) => {
          const c = (res.counts ?? {}) as Record<string, number>
          const s = (res.sums ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Suppliers", value: c.active ?? 0, hint: `${c.inactive ?? 0} inactive`, color: "blue", icon: Users },
            { label: "Bought this month", value: formatPaise(s.month ?? 0), hint: "Posted invoices", color: "violet", icon: CalendarDays },
            { label: "Total bought", value: formatPaise(s.billed ?? 0), hint: "All posted invoices", color: "slate", icon: Receipt },
            { label: "You owe", value: formatPaise(s.balance ?? 0), hint: `To ${c.dues ?? 0} suppliers`, color: "amber", icon: IndianRupee },
            { label: "Overdue", value: formatPaise(s.overdue ?? 0), hint: `${c.overdue ?? 0} suppliers past due`, color: "rose", icon: AlarmClock },
          ]} />
        }}
        rowHref={(r) => `/app/m/purchase/suppliers/${r.id}`}
        exportName="suppliers"
        emptyState={<EmptyState icon={Truck} title="No suppliers yet" description="Add the people you buy from. Their bills, payments and what you owe show here." action={can("inventory.supplier.create") ? <Button onClick={() => setAdding(true)}>New supplier</Button> : undefined} />}
      />
      {v && (
        <RecordView
          title={v.companyName || v.name}
          icon={Truck}
          onClose={() => setViewing(null)}
          status={<><Pill color={v.gstin ? "blue" : "slate"}>{v.gstin ? "GST registered" : "Not registered"}</Pill>{!v.isActive && <Pill>Inactive</Pill>}</>}
          fields={[
            { label: "Contact person", person: { name: v.name, sub: v.phone } , value: v.name },
            { label: "Email", icon: Mail, value: v.email },
            { label: "GSTIN", value: v.gstin ? <span className="font-mono">{v.gstin}</span> : "Not registered" },
            { label: "State", icon: MapPin, value: v.stateCode ? stateName(v.stateCode) : null },
            { label: "Pay within", value: v.paymentDays != null ? `${v.paymentDays} days` : "Not set" },
            { label: "Last purchase", icon: CalendarDays, value: v.lastBillOn ? formatDate(v.lastBillOn) : "Never" },
            { label: "Invoices", icon: FileText, value: `${v.billCount ?? 0} · ${formatPaise(v.billedPaise ?? 0)}` },
            { label: "Paid", value: formatPaise(v.paidPaise ?? 0), tone: "success" },
            { label: "You owe", value: owe(v.balancePaise), tone: v.balancePaise > 0 ? "danger" : undefined },
            { label: "Overdue", value: v.overduePaise ? `${formatPaise(v.overduePaise)} on ${v.overdueCount} invoice${v.overdueCount === 1 ? "" : "s"}` : "Nothing overdue", tone: v.overduePaise ? "danger" : undefined },
            { label: "Address", icon: MapPin, full: true, value: [v.address?.line1, v.address?.line2, v.address?.city, v.address?.pincode].filter(Boolean).join(", ") },
            !!v.notes && { label: "Notes", full: true, value: v.notes },
          ]}
          footer={<>
            {can("inventory.supplier.edit") && <Button variant="outline" onClick={() => { setEditing(v); setViewing(null) }}><Pencil /> Edit</Button>}
            {canBill && v.balancePaise > 0 && <Link href={`/app/m/purchase/payments?new=1&supplier=${v.id}`} className={buttonVariants({ variant: "outline" })}><IndianRupee /> Pay supplier</Link>}
            <Link href={`/app/m/purchase/suppliers/${v.id}`} className={buttonVariants()}><BookOpen /> Open statement</Link>
          </>}
        />
      )}
      <SupplierDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} supplier={editing ?? undefined} onSaved={() => { setEditing(null); setVersion((n) => n + 1) }} />
      <SupplierDialog open={adding} onOpenChange={setAdding} onSaved={(s) => router.push(`/app/m/purchase/suppliers/${s.id}`)} />
    </>
  )
}
