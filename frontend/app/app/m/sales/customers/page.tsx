"use client"

import { ActionMenu } from "@/components/page-parts"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Eye, FilePlus2, FileText, IndianRupee, MessageCircle, MessageSquare, Pencil, Printer, Upload, UserPlus, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/common"
import { DataList, type Column } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { ContactDialog, termsLabel, type Contact } from "@/components/contact-dialog"
import { ImportDialog } from "@/components/contact-import"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { stateName } from "@contracts/validation"
import { cn } from "@/lib/utils"

// Everyone you sell to, with what each of them owes you.

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("")

export default function CustomersPage() {
  const { can, term } = useAuth()
  const router = useRouter()
  const [dialog, setDialog] = React.useState<"new" | "import" | null>(null)
  const [editing, setEditing] = React.useState<Contact | null>(null)
  const [version, setVersion] = React.useState(0)
  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })
  const plural = term("entity.contact.plural", "Customers")
  const noun = term("entity.contact.singular", "customer").toLowerCase()
  if (!can("crm.contact.view")) return <PageHeader title={plural} description="You don't have access to customers. Ask your admin." />
  const dues = can("billing.dues.view")
  const canCreate = can("crm.contact.create")

  const columns: Column<Contact>[] = [
    {
      key: "name", header: "Customer", hideable: false, sort: (r) => r.companyName || r.name, csv: (r) => r.companyName || r.name,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(r.companyName || r.name)}</span>
          <span className="min-w-0">
            <span className="block font-semibold">{r.companyName || r.name}{!r.isActive && <Badge variant="outline" className="ml-2">Inactive</Badge>}</span>
            {r.companyName && <span className="block text-xs text-muted-foreground">{r.name}</span>}
          </span>
        </span>
      ),
    },
    { key: "phone", header: "Phone", csv: (r) => r.phone ?? "", cell: (r) => <span className="tabular-nums">{r.phone ?? "—"}</span> },
    { key: "email", header: "Email", defaultHidden: true, csv: (r) => r.email ?? "", cell: (r) => r.email ?? "—" },
    { key: "gstin", header: "GSTIN", csv: (r) => r.gstin ?? "", cell: (r) => (r.gstin ? <span className="font-mono text-xs">{r.gstin}</span> : <span className="text-muted-foreground">Not registered</span>) },
    { key: "city", header: "City", csv: (r) => r.address?.city ?? "", cell: (r) => r.address?.city || <span className="text-muted-foreground">—</span> },
    { key: "state", header: "State", defaultHidden: true, csv: (r) => (r.stateCode ? stateName(r.stateCode) ?? "" : ""), cell: (r) => (r.stateCode ? stateName(r.stateCode) : "—") },
    { key: "days", header: "Payment terms", defaultHidden: true, csv: (r) => termsLabel(r.paymentDays), cell: (r) => termsLabel(r.paymentDays) },
    ...(dues
      ? [
          {
            key: "balance", header: "They owe", align: "right" as const, sort: (r: Contact) => r.balancePaise ?? 0, csv: (r: Contact) => (r.balancePaise ?? 0) / 100,
            cell: (r: Contact) => {
              const b = r.balancePaise ?? 0
              return (
                <span className={cn("tabular-nums", b < 0 ? "text-emerald-700 dark:text-emerald-300" : b > 0 && "font-medium")}>
                  {b ? formatPaise(Math.abs(b)) : "—"}
                  {b < 0 && <span className="block text-xs">advance with you</span>}
                  {(r.overduePaise ?? 0) > 0 && <span className="block text-xs text-destructive">{formatPaise(r.overduePaise!)} overdue</span>}
                </span>
              )
            },
          },
        ]
      : []),
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Link href={`/app/m/sales/customers/${r.id}`} className={icon} title="View" aria-label={`View ${r.name}`}><Eye /></Link>
          {can("billing.invoice.create") && r.isActive && <Link href={`/app/m/billing/new?contact=${r.id}`} className={icon} title="New invoice" aria-label={`New invoice for ${r.name}`}><FilePlus2 /></Link>}
          {can("billing.payment.create") && <Link href={`/app/m/billing/payments?new=1&contact=${r.id}`} className={icon} title="Receive payment" aria-label={`Receive payment from ${r.name}`}><IndianRupee /></Link>}
          <ActionMenu label={`More actions for ${r.name}`} items={[
            can("crm.contact.edit") && { label: "Edit", icon: Pencil, onClick: () => setEditing(r) },
            r.isActive && can("sales.quotation.create") && { label: "New quotation", icon: FileText, href: `/app/m/sales/new?contact=${r.id}` },
            can("crm.activity.view") && { label: "Notes, calls and tasks", icon: MessageSquare, href: `/app/m/crm/${r.id}` },
            r.phone && { label: "WhatsApp", icon: MessageCircle, onClick: () => window.open(`https://wa.me/${r.phone!.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}`, "_blank", "noopener") },
            can("billing.dues.view") && { label: "Print statement", icon: Printer, onClick: () => window.open(`/print/statement/${r.id}`, "_blank", "noopener") },
          ]} />
        </span>
      ),
    },
  ]

  return (
    <>
      <DataList<Contact>
        id="customers"
        path="/contacts"
        params={{ v: String(version) }}
        header={{
          title: plural,
          description: dues ? "Everyone you sell to, and what each of them owes you." : "Everyone you sell to.",
          actions: canCreate ? <Button variant="outline" onClick={() => setDialog("import")}><Upload /> Import</Button> : undefined,
          primary: canCreate ? <Button onClick={() => setDialog("new")}><UserPlus /> New {noun}</Button> : undefined,
          more: can("crm.lead.view") ? [{ label: "Leads (CRM)", href: "/app/m/crm" }] : undefined,
        }}
        columns={columns}
        searchPlaceholder="Search name, phone or email"
        presetLabel="Show"
        presets={[
          { key: "active", label: "Active", params: {} },
          ...(dues ? [{ key: "owes", label: "Owe you money", params: { dues: "owes" } }, { key: "overdue", label: "Overdue", params: { dues: "overdue" } }] : []),
          { key: "inactive", label: "Inactive", params: { active: "false" } },
        ]}
        rowHref={(r) => `/app/m/sales/customers/${r.id}`}
        exportName="customers"
        emptyState={
          <EmptyState
            icon={Users}
            title={`No ${plural.toLowerCase()} yet`}
            description="Add the people you sell to, or import your list from Excel. Their invoices, payments and dues show here."
            action={canCreate ? <Button onClick={() => setDialog("new")}>New {noun}</Button> : undefined}
          />
        }
      />
      {editing && <ContactDialog kind="customer" contact={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setVersion((v) => v + 1) }} />}
      {dialog === "new" && <ContactDialog kind="customer" onClose={() => setDialog(null)} onSaved={(c) => router.push(`/app/m/sales/customers/${c.id}`)} />}
      {dialog === "import" && <ImportDialog kind="customer" onClose={() => setDialog(null)} onDone={() => setVersion((v) => v + 1)} />}
    </>
  )
}
