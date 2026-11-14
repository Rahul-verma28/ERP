"use client"

import { PageError } from "@/components/page-states"
import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { BookOpen, FilePlus2, FileText, Handshake, IndianRupee, MessageCircle, MessageSquare, Pencil, Phone, Printer, Trash2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ActionMenu, BackLink, DetailHeader, DetailList, Pill, Section, StatGrid, Tabs } from "@/components/page-parts"
import { DealDialog } from "@/components/crm/dialogs"
import { methodLabel } from "@/components/receive-payment"
import type { Deal } from "@/lib/crm"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState, Spinner } from "@/components/common"
import { DataList, periodFilter } from "@/components/data-list"
import { AdvancesCard } from "@/components/advances"
import { ContactDialog, termsLabel, type Contact } from "@/components/contact-dialog"
import { OpeningDialog, OpeningPaymentDialog, ledgerBalance, ledgerDocument, ledgerHref, type Ledger, type LedgerRow } from "@/components/customer-ledger"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { stateName } from "@contracts/validation"
import { cn } from "@/lib/utils"

// One customer: what they owe, the ledger of invoices, payments and returns, and their details.
// Laid out like a supplier in Purchase, so staff learn it once.

type Dialog = "edit" | "opening" | "opening-payment" | "delete" | "deal" | null
type Tab = "ledger" | "invoices" | "payments" | "deals" | "details"
interface InvoiceRow { id: string; number: string | null; status: string; issueDate: string; dueDate: string | null; totalPaise: number; paidPaise: number }
interface PaymentRow { id: string; number: string; paidOn: string; method: string; amountPaise: number; reversed: boolean; appliedTo: { number: string | null }[] }
const STATUS_LABEL: Record<string, string> = { draft: "Draft", issued: "Unpaid", partially_paid: "Partly paid", paid: "Paid", cancelled: "Cancelled" }
const STATUS_TONE: Record<string, string> = { draft: "slate", issued: "orange", partially_paid: "amber", paid: "emerald", cancelled: "slate" }

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can, me } = useAuth()
  const [dialog, setDialog] = React.useState<Dialog>(null)
  const [version, setVersion] = React.useState(0)
  // The opening balance rides on the ledger response, so the page makes one ledger call, not two
  const [opening, setOpening] = React.useState<Ledger["openingBalance"]>(null)
  const contact = useApi<Contact & { owner: { name: string } | null }>(`/contacts/${id}?view=summary`)
  const dues = can("billing.dues.view")
  const [tab, setTab] = React.useState<Tab>(dues ? "ledger" : "details")
  const priceLists = useApi<{ data: { id: string; name: string }[] }>(can("catalog.price_list.view") ? "/price-lists" : null)
  const c = contact.data

  React.useEffect(() => {
    if (c && c.type !== "customer") router.replace(`/app/m/crm/${c.id}`)
  }, [c, router])

  // Built before the customer arrives, so the ledger loads at the same time as the header
  const ledger = dues ? (
    <DataList<LedgerRow>
      id="customer-ledger"
      params={{ v: String(version) }}
      load={async ({ params, limit: size, cursor }) => {
        const range = new URLSearchParams({ ...(params.from ? { from: params.from } : {}), ...(params.to ? { to: params.to } : {}) }).toString()
        const r = await api.get<Ledger>(`/customers/${id}/ledger?${range}`)
        setOpening(r.openingBalance)
        const q = (params.q ?? "").toLowerCase()
        const all = [...r.rows].reverse().filter((x) => !q || `${x.number ?? ""} ${ledgerDocument(x).label}`.toLowerCase().includes(q))
        const start = Number(cursor ?? 0)
        return { openingPaise: r.broughtForwardPaise, closingPaise: r.closingPaise, data: all.slice(start, start + size), nextCursor: start + size < all.length ? String(start + size) : null, total: all.length }
      }}
      header={{ title: "Ledger", description: "Every invoice, payment and return with this customer, newest first, with the running balance." }}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4, "Period")]}
      summary={(r) => (
        <span className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
          <span>Opening <strong className="text-foreground tabular-nums">{ledgerBalance(Number(r.openingPaise ?? 0))}</strong></span>
          <span>Closing <strong className="text-foreground tabular-nums">{ledgerBalance(Number(r.closingPaise ?? 0))}</strong></span>
        </span>
      )}
      columns={[
        { key: "date", header: "Date", hideable: false, csv: (r) => r.date.slice(0, 10), cell: (r) => formatDate(r.date) },
        { key: "entry", header: "Entry", csv: (r) => `${ledgerDocument(r).label} ${r.number ?? ""}`, cell: (r) => <span>{ledgerDocument(r).label} {r.number && <span className="font-mono text-xs text-muted-foreground">{r.number}</span>}</span> },
        { key: "ref", header: "Reference", defaultHidden: true, csv: (r) => r.reference ?? "", cell: (r) => r.reference ?? "" },
        { key: "debit", header: "Billed", align: "right", csv: (r) => r.debitPaise / 100, cell: (r) => (r.debitPaise ? <span className="tabular-nums">{formatPaise(r.debitPaise)}</span> : "") },
        { key: "credit", header: "Received or returned", align: "right", csv: (r) => r.creditPaise / 100, cell: (r) => (r.creditPaise ? <span className="tabular-nums">{formatPaise(r.creditPaise)}</span> : "") },
        { key: "balance", header: "Balance", align: "right", csv: (r) => r.balancePaise / 100, cell: (r) => <span className="font-medium tabular-nums">{ledgerBalance(r.balancePaise)}</span> },
      ]}
      searchPlaceholder="Search number or entry"
      rowClick={(r) => { const href = ledgerHref(r); if (href) router.push(href) }}
      exportName="customer-ledger"
      emptyState={<EmptyState icon={BookOpen} title="No invoices or payments yet" description="Invoices, payments and returns for this customer show here with the running balance." />}
    />
  ) : (
    <Card><CardContent className="text-sm text-muted-foreground">You can&apos;t see this customer&apos;s dues. Ask your admin for access to dues.</CardContent></Card>
  )
  const back = <BackLink href="/app/m/sales/customers">Customers</BackLink>
  if (contact.error) return <PageHeader title="Not found" description={errorMessage(contact.error)} />

  // The same tree before and after the customer arrives, so the ledger keeps its place and data
  const ready = !!c && c.type === "customer"
  const name = c ? c.companyName || c.name : ""
  const balance = c?.balancePaise ?? 0
  const overdue = c?.overduePaise ?? 0
  const limit = c?.creditLimitPaise ?? null
  const used = limit ? Math.round((Math.max(0, balance) / limit) * 100) : null
  const openingLocked = !!opening && opening.paidPaise > 0
  const refresh = () => { setVersion((v) => v + 1); void contact.reload() }
  const message = encodeURIComponent(`Statement from ${me?.tenant?.name}: ${balance < 0 ? `${formatPaise(-balance)} is in your favour` : `${formatPaise(balance)} is due`}. Thank you.`)
  const priceList = c?.priceListId ? priceLists.data?.data.find((p) => p.id === c.priceListId)?.name : null

  return (
    <div className="grid gap-5">
      {back}
      <div>
        {!ready || !c ? <div className="grid place-items-center py-6"><Spinner /></div> : (
          <DetailHeader
            title={name}
            initials={name}
            pills={<>
              <Pill color={c.gstin ? "blue" : "slate"}>{c.gstin ? "B2B" : "B2C"}</Pill>
              {!c.isActive && <Pill>Inactive</Pill>}
              {used != null && used > 100 && <Pill color="rose" dot>Over credit limit</Pill>}
              {overdue > 0 && <Pill color="amber" dot>Overdue</Pill>}
            </>}
            subtitle={[c.companyName ? c.name : null, c.gstin, c.stateCode ? stateName(c.stateCode) : null, c.phone].filter(Boolean).join(" · ") || undefined}
            actions={<>
              {c.phone && <a href={`tel:${c.phone}`} className={buttonVariants({ variant: "outline", size: "icon" })} title={`Call ${c.phone}`} aria-label="Call"><Phone /></a>}
              {c.phone && <a href={`https://wa.me/${c.phone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}`} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "icon" }), "text-emerald-700 dark:text-emerald-300")} title="WhatsApp" aria-label="WhatsApp"><MessageCircle /></a>}
              {can("billing.payment.create") && <Link href={`/app/m/billing/payments?new=1&contact=${c.id}`} className={buttonVariants({ variant: "outline" })}><IndianRupee /> Receive payment</Link>}
              {c.isActive && can("billing.invoice.create") && <Link href={`/app/m/billing/new?contact=${c.id}`} className={buttonVariants()}><FilePlus2 /> New invoice</Link>}
              <ActionMenu items={[
                can("crm.contact.edit") && { label: "Edit customer", icon: Pencil, onClick: () => setDialog("edit") },
                c.isActive && can("sales.quotation.create") && { label: "New quotation", icon: FileText, href: `/app/m/sales/new?contact=${c.id}` },
                c.isActive && can("crm.deal.create") && { label: "New deal", icon: Handshake, onClick: () => setDialog("deal") },
                can("crm.activity.view") && { label: "Notes, calls and tasks", icon: MessageSquare, href: `/app/m/crm/${c.id}` },
                "-",
                dues && { label: "Print statement", icon: Printer, onClick: () => window.open(`/print/statement/${c.id}`, "_blank", "noopener") },
                dues && c.phone && { label: "Send statement on WhatsApp", icon: MessageCircle, onClick: () => window.open(`https://wa.me/${c.phone!.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}?text=${message}`, "_blank", "noopener") },
                "-",
                !openingLocked && can("billing.invoice.approve") && { label: opening ? "Edit opening balance" : "Add opening balance", icon: BookOpen, onClick: () => setDialog("opening") },
                opening && opening.paidPaise < opening.totalPaise && can("billing.payment.create") && { label: "Payment on opening balance", icon: IndianRupee, onClick: () => setDialog("opening-payment") },
                "-",
                can("crm.contact.delete") && { label: "Delete customer", icon: Trash2, destructive: true, onClick: () => setDialog("delete") },
              ]} />
            </>}
          />
        )}
      </div>
      <div>
        {ready && c && dues && (
          <StatGrid items={[
            { label: balance < 0 ? "Their advance with you" : "They owe you", value: formatPaise(Math.abs(balance)), accent: balance < 0 ? "text-emerald-700 dark:text-emerald-300" : balance > 0 ? "text-orange-600 dark:text-orange-300" : undefined },
            { label: "Overdue", value: overdue ? formatPaise(overdue) : "Nothing late", accent: overdue ? "text-destructive" : undefined },
            { label: "Credit limit", value: limit ? formatPaise(limit) : "No limit", hint: limit ? ((used ?? 0) > 100 ? "Over the limit" : `${used}% used`) : undefined, accent: (used ?? 0) > 100 ? "text-destructive" : undefined },
            { label: "Payment terms", value: termsLabel(c.paymentDays), hint: priceList ? `Price list: ${priceList}` : undefined },
          ]} />
        )}
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "ledger", label: "Ledger", hidden: !dues },
        { key: "invoices", label: "Invoices", hidden: !can("billing.invoice.view") },
        { key: "payments", label: "Payments", hidden: !can("billing.payment.view") },
        { key: "deals", label: "Deals", hidden: !can("crm.deal.view") },
        { key: "details", label: "Details" },
      ]} />
      <div className="min-w-0">
        {tab === "ledger" && ledger}
        {tab === "invoices" && (
          <DataList<InvoiceRow>
            id="customer-invoices"
            path="/invoices"
            params={{ contactId: id }}
            header={{ title: "Invoices", description: "Every invoice to this customer, newest first." }}
            columns={[
              { key: "number", header: "Invoice no.", hideable: false, csv: (r) => r.number ?? "Draft", cell: (r) => <span className="font-mono text-xs font-medium text-primary">{r.number ?? "Draft"}</span> },
              { key: "date", header: "Date", csv: (r) => r.issueDate.slice(0, 10), cell: (r) => formatDate(r.issueDate) },
              { key: "due", header: "Due", csv: (r) => r.dueDate?.slice(0, 10) ?? "", cell: (r) => (r.dueDate ? formatDate(r.dueDate) : "—") },
              { key: "total", header: "Total", align: "right", csv: (r) => r.totalPaise / 100, cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.totalPaise)}</span> },
              { key: "balance", header: "Balance", align: "right", csv: (r) => (r.totalPaise - r.paidPaise) / 100, cell: (r) => <span className="tabular-nums">{r.status === "draft" || r.status === "cancelled" ? "—" : formatPaise(Math.max(0, r.totalPaise - r.paidPaise))}</span> },
              { key: "status", header: "Status", csv: (r) => r.status, cell: (r) => <Pill color={STATUS_TONE[r.status] ?? "slate"} strike={r.status === "cancelled"}>{STATUS_LABEL[r.status] ?? r.status}</Pill> },
            ]}
            searchPlaceholder="Search invoice number"
            rowHref={(r) => `/app/m/billing/${r.id}`}
            exportName="customer-invoices"
            emptyState={<EmptyState icon={FileText} title="No invoices yet" action={can("billing.invoice.create") ? <Link href={`/app/m/billing/new?contact=${id}`} className={buttonVariants()}><FilePlus2 /> New invoice</Link> : undefined} />}
          />
        )}
        {tab === "payments" && (
          <DataList<PaymentRow>
            id="customer-payments"
            path="/payments"
            params={{ contactId: id }}
            header={{ title: "Payments", description: "Money received from this customer, with the bills it went on." }}
            columns={[
              { key: "number", header: "Receipt no.", hideable: false, csv: (r) => r.number, cell: (r) => <span className="font-mono text-xs font-medium text-primary">{r.number}</span> },
              { key: "date", header: "Date", csv: (r) => r.paidOn.slice(0, 10), cell: (r) => formatDate(r.paidOn) },
              { key: "method", header: "Paid by", csv: (r) => methodLabel(r.method), cell: (r) => methodLabel(r.method) },
              { key: "applied", header: "Put on", csv: (r) => r.appliedTo.map((a) => a.number).join(" "), cell: (r) => (r.appliedTo.length ? r.appliedTo.map((a) => a.number).join(", ") : r.reversed ? "—" : "Advance") },
              { key: "amount", header: "Amount", align: "right", csv: (r) => r.amountPaise / 100, cell: (r) => <span className={cn("font-semibold tabular-nums", r.reversed && "text-muted-foreground line-through")}>{formatPaise(r.amountPaise)}</span> },
              { key: "print", header: "", hideable: false, cell: (r) => (!r.reversed ? <a href={`/print/receipt/${r.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "icon-sm" })} title="Print receipt" aria-label={`Print ${r.number}`} onClick={(e) => e.stopPropagation()}><Printer /></a> : null) },
            ]}
            searchPlaceholder="Search receipt or reference"
            exportName="customer-payments"
            emptyState={<EmptyState icon={IndianRupee} title="No payments yet" action={can("billing.payment.create") ? <Link href={`/app/m/billing/payments?new=1&contact=${id}`} className={buttonVariants()}>Receive payment</Link> : undefined} />}
          />
        )}
        {tab === "deals" && <CustomerDeals contactId={id} />}
        {tab === "details" && ready && c && (
          <div className="grid content-start gap-5 lg:grid-cols-2">
            <Section title="Details" action={can("crm.contact.edit") && <Button size="sm" variant="ghost" onClick={() => setDialog("edit")}><Pencil /> Edit</Button>}>
              <DetailList items={[
                ["Contact person", c.companyName ? c.name : null], ["Mobile", c.phone], ["Email", c.email],
                ["GSTIN", c.gstin ?? "Not registered"], ["Place of supply", c.stateCode ? stateName(c.stateCode) : null],
                ["Billing address", [c.address?.line1, c.address?.line2, c.address?.city, c.address?.pincode].filter(Boolean).join(", ")],
                ["Delivery address", c.shippingAddress ? [c.shippingAddress.name, c.shippingAddress.line1, c.shippingAddress.line2, c.shippingAddress.city, c.shippingAddress.pincode, c.shippingAddress.stateCode ? stateName(c.shippingAddress.stateCode) : null].filter(Boolean).join(", ") : "Same as billing"],
                ["Price list", priceList ?? (c.priceListId ? "…" : "Standard prices")], ["Payment terms", termsLabel(c.paymentDays)],
                ["Owner", c.owner?.name], ["Added", formatDate(c.createdAt)],
              ]} />
              {c.notes && <p className="mt-4 rounded-2xl bg-muted/60 p-3 text-sm whitespace-pre-wrap">{c.notes}</p>}
            </Section>
            {can("billing.payment.view") && <AdvancesCard contactId={c.id} />}
          </div>
        )}
      </div>

      {c && dialog === "edit" && <ContactDialog kind="customer" contact={c} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh() }} />}
      {c && dialog === "opening" && <OpeningDialog contactId={c.id} current={opening} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh() }} />}
      {c && dialog === "opening-payment" && opening && <OpeningPaymentDialog opening={opening} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh() }} />}
      {c && dialog === "deal" && <DealDialog initialContact={{ id: c.id, name: c.name, companyName: c.companyName, phone: c.phone }} onClose={() => setDialog(null)} onSaved={(d) => router.push(`/app/m/crm/deals/${d.id}`)} />}
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        destructive
        title={`Delete ${name}?`}
        description="If this customer has invoices, payments or deals, they are kept and the customer is marked inactive instead."
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/contacts/${c!.id}`)
            toast.success("Customer removed")
            router.replace("/app/m/sales/customers")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </div>
  )
}

function CustomerDeals({ contactId }: { contactId: string }) {
  const { data, error, reload } = useApi<{ data: Deal[] }>(`/deals?contactId=${contactId}&limit=100`)
  if (error && !data) return <PageError error={error} onRetry={() => void reload()} />
  if (!data) return <div className="grid place-items-center py-16"><Spinner /></div>
  if (!data.data.length) return <EmptyState icon={Handshake} title="No deals with this customer" description="Start a deal from the ⋮ menu to track a big sale stage by stage." />
  return (
    <Section title="Deals" flush>
      <ul className="divide-y">
        {data.data.map((d) => (
          <li key={d.id}>
            <Link href={`/app/m/crm/deals/${d.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40">
              <span className="min-w-0"><span className="block font-medium">{d.title}</span><span className="text-xs text-muted-foreground">Added {formatDate(d.createdAt)}{d.expectedCloseOn ? ` · closes ${formatDate(d.expectedCloseOn)}` : ""}</span></span>
              <span className="flex items-center gap-3">{d.status === "open" ? <Pill color={d.stage?.color ?? "blue"} dot>{d.stage?.name}</Pill> : <Pill color={d.status === "won" ? "emerald" : "rose"}>{d.status === "won" ? "Won" : "Lost"}</Pill>}<span className="font-semibold tabular-nums">{formatPaise(d.valuePaise)}</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  )
}
