"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { BookOpen, FilePlus2, FileText, IndianRupee, MessageCircle, Pencil, Phone, ShoppingCart, Wallet } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { EmptyState, Spinner } from "@/components/common"
import { DataList, periodFilter } from "@/components/data-list"
import { ActionMenu, BackLink, DetailHeader, DetailList, Pill, Section, StatGrid, Tabs } from "@/components/page-parts"
import { SupplierDialog } from "@/components/supplier-dialog"
import { methodLabel, type SupplierPayment } from "@/components/pay-supplier"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { api, errorMessage } from "@/lib/api"
import { formatDate, formatPaise } from "@/lib/format"
import { stateName } from "@contracts/validation"
import { invoiceStatus, type PurchaseDoc, type Supplier } from "@/lib/purchase"
import { cn } from "@/lib/utils"
import { PageLoading, PageError } from "@/components/page-states"

// One supplier: what you owe them, the ledger, their invoices and your payments, and their details.
// Laid out like a customer in Sales, so staff learn it once.

interface LedgerRow { id: string; kind: string; number: string; date: string; details: string; billPaise: number; paidPaise: number; balancePaise: number }
type Tab = "ledger" | "invoices" | "payments" | "details"

const KIND: Record<string, string> = { purchase_bill: "Invoice", purchase_return: "Return", payment: "Payment", payment_reversal: "Payment reversed" }
const STATUS_TONE: Record<string, string> = { draft: "slate", unpaid: "orange", part_paid: "amber", paid: "emerald", cancelled: "slate" }

export default function SupplierPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can, me } = useAuth()
  const [editing, setEditing] = React.useState(false)
  const [tab, setTab] = React.useState<Tab>("ledger")
  const sup = useApi<Supplier>(`/suppliers/${id}`)
  if (sup.error) return <PageHeader title="Not found" description={errorMessage(sup.error)} />
  const s = sup.data
  if (!s) return <PageLoading />
  const fmt = (p: number) => `${formatPaise(Math.abs(p))}${p < 0 ? " (they owe you)" : ""}`
  const name = s.companyName || s.name
  const a = s.address ?? {}
  const wa = s.phone ? `https://wa.me/${s.phone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}` : null

  return (
    <div className="grid gap-5">
      <BackLink href="/app/m/purchase/suppliers">Suppliers</BackLink>
      <DetailHeader
        title={name}
        initials={name}
        pills={<><Pill color={s.gstin ? "blue" : "slate"}>{s.gstin ? "GST registered" : "Not registered"}</Pill>{!s.isActive && <Pill>Inactive</Pill>}</>}
        subtitle={[s.companyName ? s.name : null, s.gstin, s.stateCode ? stateName(s.stateCode) : null, s.phone].filter(Boolean).join(" · ") || undefined}
        actions={<>
          {s.phone && <a href={`tel:${s.phone}`} className={buttonVariants({ variant: "outline", size: "icon" })} title={`Call ${s.phone}`} aria-label="Call"><Phone /></a>}
          {wa && <a href={wa} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "icon" }), "text-emerald-700 dark:text-emerald-300")} title="WhatsApp" aria-label="WhatsApp"><MessageCircle /></a>}
          {can("inventory.supplier_bill.create") && <Link href={`/app/m/purchase/payments?new=1&supplier=${s.id}`} className={buttonVariants({ variant: "outline" })}><IndianRupee /> Pay supplier</Link>}
          {can("inventory.supplier_bill.create") && <Link href={`/app/m/purchase/new?kind=purchase_bill&supplier=${s.id}`} className={buttonVariants()}><FilePlus2 /> New invoice</Link>}
          <ActionMenu items={[
            can("inventory.supplier.edit") && { label: "Edit supplier", icon: Pencil, onClick: () => setEditing(true) },
            me?.tenant?.purchaseOrders && can("inventory.purchase_order.create") && { label: "New purchase order", icon: ShoppingCart, href: `/app/m/purchase/new?kind=purchase_order&supplier=${s.id}` },
          ]} />
        </>}
      />
      <StatGrid items={[
        { label: s.balancePaise < 0 ? "They owe you" : "You owe", value: formatPaise(Math.abs(s.balancePaise)), accent: s.balancePaise > 0 ? "text-orange-600 dark:text-orange-300" : s.balancePaise < 0 ? "text-emerald-700 dark:text-emerald-300" : undefined },
        { label: "Pay within", value: s.paymentDays != null ? `${s.paymentDays} days` : "Not set" },
        { label: "GST", value: s.gstin ? "Charges GST" : "No GST", hint: s.gstin ? "You can claim it back" : "Nothing to claim back" },
        { label: "State", value: s.stateCode ? stateName(s.stateCode) : "Not set" },
      ]} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "ledger", label: "Ledger", hidden: !can("inventory.supplier_bill.view") },
        { key: "invoices", label: "Invoices", hidden: !can("inventory.supplier_bill.view") },
        { key: "payments", label: "Payments", hidden: !can("inventory.supplier_bill.view") },
        { key: "details", label: "Details" },
      ]} />

      {tab === "ledger" && can("inventory.supplier_bill.view") && (
        <DataList<LedgerRow & { docId: string }>
          id="supplier-ledger"
          load={async ({ params, limit, cursor }) => {
            const range = new URLSearchParams({ ...(params.from ? { from: params.from } : {}), ...(params.to ? { to: params.to } : {}) }).toString()
            const r = await api.get<{ openingPaise: number; closingPaise: number; data: LedgerRow[] }>(`/suppliers/${id}/ledger?${range}`)
            const q = (params.q ?? "").toLowerCase()
            const all = r.data.map((x, n) => ({ ...x, docId: x.id, id: `${x.id}-${n}` })).filter((x) => !q || `${x.number} ${x.details}`.toLowerCase().includes(q))
            const start = Number(cursor ?? 0)
            return { ...r, data: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, total: all.length }
          }}
          header={{ title: "Ledger", description: "Every invoice, payment and return with this supplier, and the running balance." }}
          filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
          summary={(r) => <span className="flex flex-wrap gap-x-4 text-sm text-muted-foreground"><span>Opening <strong className="text-foreground tabular-nums">{fmt(Number(r.openingPaise ?? 0))}</strong></span><span>Closing <strong className="text-foreground tabular-nums">{fmt(Number(r.closingPaise ?? 0))}</strong></span></span>}
          columns={[
            { key: "date", header: "Date", hideable: false, csv: (r) => r.date.slice(0, 10), cell: (r) => formatDate(r.date) },
            { key: "entry", header: "Entry", csv: (r) => `${KIND[r.kind] ?? r.kind} ${r.number}`, cell: (r) => <span>{KIND[r.kind] ?? r.kind} <span className="font-mono text-xs text-primary">{r.number}</span></span> },
            { key: "details", header: "Details", csv: (r) => r.details, cell: (r) => <span className="text-muted-foreground">{r.details}</span> },
            { key: "bill", header: "Invoice", align: "right", csv: (r) => r.billPaise / 100, cell: (r) => (r.billPaise ? <span className="tabular-nums">{formatPaise(r.billPaise)}</span> : "") },
            { key: "paid", header: "Paid or returned", align: "right", csv: (r) => r.paidPaise / 100, cell: (r) => (r.paidPaise ? <span className="tabular-nums">{formatPaise(r.paidPaise)}</span> : "") },
            { key: "balance", header: "Balance", align: "right", csv: (r) => r.balancePaise / 100, cell: (r) => <span className="font-medium tabular-nums">{fmt(r.balancePaise)}</span> },
          ]}
          searchPlaceholder="Search number or details"
          // Invoices and returns open; payments are listed under Payments
          rowClick={(r) => { if (r.kind === "purchase_bill" || r.kind === "purchase_return") router.push(`/app/m/purchase/${r.docId}`); else setTab("payments") }}
          exportName="supplier-ledger"
          emptyState={<EmptyState icon={BookOpen} title="No invoices or payments yet" />}
        />
      )}
      {tab === "invoices" && (
        <DataList<PurchaseDoc>
          id="supplier-invoices"
          path="/purchases"
          params={{ kind: "purchase_bill", contactId: s.id }}
          header={{ title: "Invoices", description: "Their invoices to you, newest first." }}
          columns={[
            { key: "number", header: "Our no.", hideable: false, csv: (r) => r.number, cell: (r) => <span className="font-mono text-xs font-medium text-primary">{r.number}</span> },
            { key: "ref", header: "Their no.", csv: (r) => r.supplierRef ?? "", cell: (r) => r.supplierRef ?? "—" },
            { key: "date", header: "Date", csv: (r) => (r.supplierDate ?? r.issueDate).slice(0, 10), cell: (r) => formatDate(r.supplierDate ?? r.issueDate) },
            { key: "due", header: "Due", csv: (r) => r.dueDate?.slice(0, 10) ?? "", cell: (r) => (r.dueDate ? formatDate(r.dueDate) : "—") },
            { key: "total", header: "Total", align: "right", csv: (r) => r.totalPaise / 100, cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.totalPaise)}</span> },
            { key: "balance", header: "You owe", align: "right", csv: (r) => r.balancePaise / 100, cell: (r) => <span className="tabular-nums">{r.status === "draft" || r.status === "cancelled" ? "—" : formatPaise(Math.max(0, r.balancePaise))}</span> },
            { key: "status", header: "Status", csv: (r) => r.status, cell: (r) => <Pill color={STATUS_TONE[r.status] ?? "slate"} strike={r.status === "cancelled"}>{invoiceStatus(r.status)}</Pill> },
          ]}
          searchPlaceholder="Search our or their number"
          rowHref={(r) => `/app/m/purchase/${r.id}`}
          exportName="supplier-invoices"
          emptyState={<EmptyState icon={FileText} title="No invoices yet" action={can("inventory.supplier_bill.create") ? <Link href={`/app/m/purchase/new?kind=purchase_bill&supplier=${s.id}`} className={buttonVariants()}><FilePlus2 /> New invoice</Link> : undefined} />}
        />
      )}
      {tab === "payments" && <SupplierPayments supplierId={s.id} />}
      {tab === "details" && (
        <Section title="Details" action={can("inventory.supplier.edit") && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}>
          <DetailList items={[
            ["Supplier name", s.name], ["Firm name", s.companyName], ["Mobile", s.phone], ["Email", s.email],
            ["GSTIN", s.gstin ?? "Not registered"], ["State", s.stateCode ? stateName(s.stateCode) : null],
            ["Address", [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(", ")], ["Pay within", s.paymentDays != null ? `${s.paymentDays} days` : null],
          ]} />
          {s.notes && <p className="mt-4 rounded-2xl bg-muted/60 p-3 text-sm whitespace-pre-wrap">{s.notes}</p>}
        </Section>
      )}
      <SupplierDialog open={editing} onOpenChange={setEditing} supplier={s} onSaved={(n) => sup.setData(n)} />
    </div>
  )
}

function SupplierPayments({ supplierId }: { supplierId: string }) {
  const { data, error, reload } = useApi<{ data: SupplierPayment[] }>(`/payments-made?contactId=${supplierId}`)
  if (error && !data) return <PageError error={error} onRetry={() => void reload()} />
  if (!data) return <div className="grid place-items-center py-16"><Spinner /></div>
  if (!data.data.length) return <EmptyState icon={Wallet} title="No payments yet" action={<Link href={`/app/m/purchase/payments?new=1&supplier=${supplierId}`} className={buttonVariants()}>Pay supplier</Link>} />
  return (
    <Section title="Payments" description="What you paid this supplier, and which invoices it went on" flush>
      <ul className="divide-y">
        {data.data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
            <span className="min-w-0">
              <span className="font-mono text-xs font-medium text-primary">{p.number}</span>{p.reversed && <Pill className="ml-2">Reversed</Pill>}
              <span className="block text-xs text-muted-foreground">{formatDate(p.paidOn)} · {methodLabel(p.method)}{p.reference ? ` · ${p.reference}` : ""} · {p.appliedTo.map((x) => x.supplierRef ?? x.number).join(", ")}</span>
            </span>
            <span className={cn("font-semibold tabular-nums", p.reversed && "text-muted-foreground line-through")}>{formatPaise(p.amountPaise)}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
