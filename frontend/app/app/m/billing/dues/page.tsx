"use client"

import * as React from "react"
import { toast } from "sonner"
import { Mail, MessageCircle, MessageSquare, Wallet } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/common"
import { DataList, HeaderLink, type Column } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"

// Who owes money, with reminders sent by hand on WhatsApp, SMS or email: no provider needed.
// Each message carries the amount, the bills, their share links and the UPI ID.

interface DueRow {
  id: string
  name: string
  phone: string | null
  email: string | null
  lastRemindedAt: string | null
  lastReminderVia: string | null
  duePaise: number
  overduePaise: number
  heldPaise: number
  bills: number
  oldestDate: string
  oldestDays: number
  openBills: { id: string; number: string | null; kind: string; duePaise: number; shareToken: string | null }[]
}

type Via = "whatsapp" | "sms" | "email"
const VIA_LABEL: Record<Via, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email" }

/** wa.me needs the country code; Indian mobiles are stored as 10 digits */
const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, "")
  return d.length === 10 ? `91${d}` : d
}

function reminderText(row: DueRow, business: string, upiId: string | null, origin: string) {
  const links = row.openBills.filter((b) => b.shareToken).slice(0, 3).map((b) => `${b.number}: ${origin}/d/${b.shareToken}`)
  return [
    `Hello ${row.name}, this is a reminder from ${business}.`,
    `${formatPaise(row.duePaise)} is due on ${row.bills} bill${row.bills === 1 ? "" : "s"}, the oldest from ${formatDate(row.oldestDate)}.`,
    ...(links.length ? [`View and pay: ${links.join(" · ")}`] : []),
    ...(upiId ? [`Pay by UPI to ${upiId}.`] : []),
    "Please ignore this if you have already paid. Thank you.",
  ].join("\n")
}

export default function DuesPage() {
  const { can, me } = useAuth()
  const workspace = useApi<{ preferences: { payments: { upiId: string } } }>(can("tenant.settings.view") ? "/tenant/workspace" : null)
  const [sent, setSent] = React.useState<Record<string, { at: string; via: Via }>>({})
  const business = me?.tenant?.name ?? ""
  const upiId = workspace.data?.preferences.payments.upiId || null
  const origin = typeof window === "undefined" ? "" : window.location.origin

  if (!can("billing.invoice.view")) return <PageHeader title="Dues" description="You don't have access to dues. Ask your admin." />

  const note = (row: DueRow, via: Via) => {
    // Opening WhatsApp or the SMS app is the reminder; this only records it
    setSent((s) => ({ ...s, [row.id]: { at: new Date().toISOString(), via } }))
    api.post(`/contacts/${row.id}/reminded`, { via }).catch((e) => toast.error(errorMessage(e)))
  }
  const href = (row: DueRow, via: Via) => {
    const text = encodeURIComponent(reminderText(row, business, upiId, origin))
    if (via === "whatsapp") return `https://wa.me/${waNumber(row.phone ?? "")}?text=${text}`
    if (via === "sms") return `sms:${(row.phone ?? "").replace(/\D/g, "")}?body=${text}`
    return `mailto:${row.email}?subject=${encodeURIComponent(`Payment reminder from ${business}`)}&body=${text}`
  }
  const action = (row: DueRow, via: Via, Icon: typeof Mail, enabled: boolean) =>
    enabled ? (
      <a href={href(row, via)} target={via === "whatsapp" ? "_blank" : undefined} rel="noreferrer" onClick={(e) => { e.stopPropagation(); note(row, via) }} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`${VIA_LABEL[via]} reminder to ${row.name}`}>
        <Icon /> {VIA_LABEL[via]}
      </a>
    ) : (
      <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-40")} title={via === "email" ? "No email on this customer" : "No mobile number on this customer"} aria-disabled>
        <Icon /> {VIA_LABEL[via]}
      </span>
    )

  const columns: Column<DueRow>[] = [
    { key: "name", header: "Customer", hideable: false, cell: (r) => <span className="font-semibold">{r.name}{r.phone && <span className="block text-xs font-normal text-muted-foreground">{r.phone}</span>}</span>, csv: (r) => r.name, sort: (r) => r.name },
    { key: "due", header: "Due", align: "right", cell: (r) => <span className="font-medium tabular-nums">{formatPaise(r.duePaise)}{r.heldPaise > 0 && <span className="block text-xs font-normal text-muted-foreground">after {formatPaise(r.heldPaise)} advance</span>}</span>, csv: (r) => r.duePaise / 100, sort: (r) => r.duePaise },
    { key: "overdue", header: "Overdue", align: "right", cell: (r) => (r.overduePaise > 0 ? <span className="tabular-nums text-destructive">{formatPaise(r.overduePaise)}</span> : "—"), csv: (r) => r.overduePaise / 100, sort: (r) => r.overduePaise },
    { key: "bills", header: "Bills", align: "right", cell: (r) => r.bills, csv: (r) => r.bills, sort: (r) => r.bills },
    { key: "oldest", header: "Oldest bill", cell: (r) => <span>{formatDate(r.oldestDate)}<span className="block text-xs text-muted-foreground">{r.oldestDays} day{r.oldestDays === 1 ? "" : "s"} ago</span></span>, csv: (r) => r.oldestDate.slice(0, 10), sort: (r) => r.oldestDays },
    {
      key: "reminded", header: "Last reminder",
      cell: (r) => {
        const last = sent[r.id] ?? (r.lastRemindedAt ? { at: r.lastRemindedAt, via: r.lastReminderVia as Via } : null)
        return last ? <span>{formatDate(last.at)}<span className="block text-xs text-muted-foreground">{VIA_LABEL[last.via] ?? last.via}</span></span> : <span className="text-muted-foreground">Never</span>
      },
      csv: (r) => r.lastRemindedAt?.slice(0, 10) ?? "",
    },
    {
      key: "send", header: "Send reminder", hideable: false,
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          {action(r, "whatsapp", MessageCircle, !!r.phone)}
          {action(r, "sms", MessageSquare, !!r.phone)}
          {action(r, "email", Mail, !!r.email)}
        </div>
      ),
    },
  ]

  return (
    <DataList<DueRow>
      id="dues"
      path="/dues"
      header={{
        breadcrumb: "Billing › Dues",
        title: "Dues",
        description: "Customers who owe money after advances and credit. Reminders open WhatsApp, SMS or email with the message ready.",
        actions: <HeaderLink href="/app/m/billing">Invoices</HeaderLink>,
      }}
      columns={columns}
      searchPlaceholder="Search customer or mobile"
      presets={[{ key: "all", label: "All", params: {} }, { key: "overdue", label: "Overdue", params: { overdue: "true" } }]}
      rowHref={(r) => `/app/m/crm/${r.id}?tab=ledger`}
      exportName="dues"
      emptyState={<EmptyState icon={Wallet} title="Nobody owes you money" description="Customers with unpaid bills show here, with a one-click reminder." />}
    />
  )
}
