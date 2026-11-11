"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, BookOpen, FilePlus2, MoreHorizontal, Pencil } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
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

type Dialog = "edit" | "opening" | "opening-payment" | "delete" | null

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
  const back = <Link href="/app/m/sales/customers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Customers</Link>

  if (contact.error) return <PageHeader title="Not found" description={errorMessage(contact.error)} />
  if (!c || c.type !== "customer") {
    // Same shape as the page below, so the ledger keeps its place (and its data) when the header arrives
    return (
      <>
        {back}
        <div className="mb-6 grid place-items-center py-6"><Spinner /></div>
        {null}
        <div className="grid gap-5">
          <div className="min-w-0">{ledger}</div>
        </div>
      </>
    )
  }

  const name = c.companyName || c.name
  const balance = c.balancePaise ?? 0
  const overdue = c.overduePaise ?? 0
  const limit = c.creditLimitPaise ?? null
  const used = limit ? Math.round((Math.max(0, balance) / limit) * 100) : null
  const openingLocked = !!opening && opening.paidPaise > 0
  const refresh = () => { setVersion((v) => v + 1); void contact.reload() }
  const message = encodeURIComponent(`Statement from ${me?.tenant?.name}: ${balance < 0 ? `${formatPaise(-balance)} is in your favour` : `${formatPaise(balance)} is due`}. Thank you.`)
  const priceList = c.priceListId ? priceLists.data?.data.find((p) => p.id === c.priceListId)?.name : null

  const card = (label: string, value: React.ReactNode, tone?: string) => (
    <Card><CardContent><p className={cn("text-xs text-muted-foreground", tone)}>{label}</p><p className={cn("text-xl font-semibold tabular-nums", tone)}>{value}</p></CardContent></Card>
  )

  return (
    <>
      {back}
      <PageHeader
        title={name}
        description={[c.companyName ? c.name : null, c.gstin, c.stateCode ? stateName(c.stateCode) : null, c.phone].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!c.isActive && <Badge variant="outline">Inactive</Badge>}
            {c.isActive && can("billing.invoice.create") && <Link href={`/app/m/billing/new?contact=${c.id}`} className={buttonVariants()}><FilePlus2 /> New invoice</Link>}
            {c.isActive && can("sales.quotation.create") && <Link href={`/app/m/sales/new?contact=${c.id}`} className={buttonVariants({ variant: "outline" })}>New quotation</Link>}
            {can("billing.payment.create") && <Link href={`/app/m/billing/payments?new=1&contact=${c.id}`} className={buttonVariants({ variant: "outline" })}>Receive payment</Link>}
            {can("crm.contact.edit") && <Button variant="outline" onClick={() => setDialog("edit")}><Pencil /> Edit</Button>}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}><MoreHorizontal /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {dues && <DropdownMenuItem onClick={() => window.open(`/print/statement/${c.id}`, "_blank", "noopener")}>Print statement</DropdownMenuItem>}
                {dues && c.phone && <DropdownMenuItem onClick={() => window.open(`https://wa.me/${c.phone!.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}?text=${message}`, "_blank", "noopener")}>Send statement on WhatsApp</DropdownMenuItem>}
                {!openingLocked && can("billing.invoice.approve") && <DropdownMenuItem onClick={() => setDialog("opening")}>{opening ? "Edit opening balance" : "Add opening balance"}</DropdownMenuItem>}
                {opening && opening.paidPaise < opening.totalPaise && can("billing.payment.create") && <DropdownMenuItem onClick={() => setDialog("opening-payment")}>Payment on opening balance</DropdownMenuItem>}
                {can("crm.activity.view") && <DropdownMenuItem onClick={() => router.push(`/app/m/crm/${c.id}`)}>Notes and follow-ups</DropdownMenuItem>}
                {can("crm.contact.delete") && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>Delete customer</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {dues && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {card(balance < 0 ? "Their advance with you" : "They owe you", formatPaise(Math.abs(balance)), balance < 0 ? "text-emerald-700 dark:text-emerald-300" : undefined)}
          {card("Overdue", overdue ? formatPaise(overdue) : "—", overdue ? "text-destructive" : undefined)}
          {card("Credit limit", limit ? <>{formatPaise(limit)} <span className={cn("text-sm font-normal", (used ?? 0) > 100 ? "text-destructive" : "text-muted-foreground")}>· {(used ?? 0) > 100 ? "over the limit" : `${used}% used`}</span></> : "No limit")}
          {card("Payment terms", termsLabel(c.paymentDays))}
        </div>
      )}

      <div className="grid gap-5">
        <div className="min-w-0">
          {ledger}
        </div>

        <div className="grid content-start gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-2.5 text-sm">
                {[
                  ["Contact person", c.companyName ? c.name : null],
                  ["Phone", c.phone],
                  ["Email", c.email],
                  ["GSTIN", c.gstin ?? "Not registered"],
                  ["Place of supply", c.stateCode ? stateName(c.stateCode) : null],
                  ["Billing address", [c.address?.line1, c.address?.line2, c.address?.city, c.address?.pincode].filter(Boolean).join(", ")],
                  ["Delivery address", c.shippingAddress ? [c.shippingAddress.name, c.shippingAddress.line1, c.shippingAddress.line2, c.shippingAddress.city, c.shippingAddress.pincode, c.shippingAddress.stateCode ? stateName(c.shippingAddress.stateCode) : null].filter(Boolean).join(", ") : "Same as billing"],
                  ["Price list", priceList ?? (c.priceListId ? "…" : "Standard prices")],
                  ["Owner", c.owner?.name],
                  ["Added", formatDate(c.createdAt)],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k as string} className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="text-right break-words">{v}</dd>
                    </div>
                  ))}
              </dl>
              {c.notes && <p className="mt-4 rounded-2xl bg-muted p-3 text-sm whitespace-pre-wrap">{c.notes}</p>}
            </CardContent>
          </Card>
          {can("billing.payment.view") && <AdvancesCard contactId={c.id} />}
        </div>
      </div>

      {dialog === "edit" && <ContactDialog kind="customer" contact={c} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh() }} />}
      {dialog === "opening" && <OpeningDialog contactId={c.id} current={opening} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh() }} />}
      {dialog === "opening-payment" && opening && <OpeningPaymentDialog opening={opening} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh() }} />}
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        destructive
        title={`Delete ${name}?`}
        description="If this customer has invoices or payments, they are kept and the customer is marked inactive instead."
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/contacts/${c.id}`)
            toast.success("Customer removed")
            router.replace("/app/m/sales/customers")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
