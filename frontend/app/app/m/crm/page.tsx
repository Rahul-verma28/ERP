"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Upload, UserPlus, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { EmptyState, StatusBadge } from "@/components/common"
import { DataList, type Column } from "@/components/data-list"
import { ImportDialog } from "@/components/contact-import"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { ContactDialog, type Contact } from "@/components/contact-dialog"

// Leads: people who may buy. Customers live under Sales.

export default function LeadsPage() {
  const router = useRouter()
  const { can, term } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [dialog, setDialog] = React.useState<"new" | "import" | null>(null)
  const leads = term("entity.lead.plural", "Leads")
  const noun = term("entity.lead.singular", "lead").toLowerCase()
  if (!can("crm.lead.view")) return <PageHeader title={leads} description="You don't have access to leads. Ask your admin." />
  const createPerm = can("crm.lead.create")
  const add = createPerm ? <Button onClick={() => setDialog("new")}><UserPlus /> Add {noun}</Button> : undefined
  const columns: Column<Contact>[] = [
    { key: "name", header: "Name", hideable: false, sort: (c) => c.name, csv: (c) => c.name, cell: (c) => <span><span className="font-medium">{c.name}</span>{c.companyName && <span className="block text-xs text-muted-foreground">{c.companyName}</span>}</span> },
    { key: "phone", header: "Phone", csv: (c) => c.phone ?? "", cell: (c) => <span className="tabular-nums">{c.phone ?? "—"}</span> },
    { key: "email", header: "Email", csv: (c) => c.email ?? "", cell: (c) => c.email ?? "—" },
    { key: "source", header: "Source", csv: (c) => c.leadSource ?? "", cell: (c) => c.leadSource ?? "—" },
    { key: "status", header: "Status", csv: (c) => c.leadStatus ?? "", cell: (c) => (c.leadStatus ? <StatusBadge status={c.leadStatus} /> : "—") },
    { key: "added", header: "Added", sort: (c) => c.createdAt, csv: (c) => c.createdAt.slice(0, 10), cell: (c) => <span className="text-sm text-muted-foreground">{formatDate(c.createdAt)}</span> },
  ]
  return (
    <>
      <DataList<Contact>
        id="crm-leads"
        path="/leads"
        params={{ v: String(version) }}
        header={{ title: leads, description: "People who may buy. Convert one to a customer when they do.", primary: add, actions: createPerm ? <Button variant="outline" onClick={() => setDialog("import")}><Upload /> Import</Button> : undefined }}
        columns={columns}
        searchPlaceholder="Search name, phone, email"
        filters={[{ key: "status", label: "Lead status", options: ["new", "contacted", "qualified", "lost", "converted"].map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) })) }]}
        rowHref={(c) => `/app/m/crm/${c.id}`}
        exportName="leads"
        emptyState={<EmptyState icon={Users} title={`No ${leads.toLowerCase()} yet`} description="Add one, or import your existing list from a spreadsheet." action={add} />}
      />
      {dialog === "new" && <ContactDialog kind="lead" onClose={() => setDialog(null)} onSaved={(c) => router.push(`/app/m/crm/${c.id}`)} />}
      {dialog === "import" && <ImportDialog kind="lead" onClose={() => setDialog(null)} onDone={() => setVersion((v) => v + 1)} />}
    </>
  )
}
