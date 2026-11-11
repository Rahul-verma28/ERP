"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Ban, CalendarDays, Copy, Eye, FileMinus, FileOutput, FileText, IndianRupee, Pencil, Plus, Printer, Send, Trash2, Truck, Undo2 } from "lucide-react"
import { UseAdvanceDialog, type AdvanceList } from "@/components/advances"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState, Spinner } from "@/components/common"
import { DataList, HeaderLink, periodFilter, type Column, type ViewPreset } from "@/components/data-list"
import { todayInIndia } from "@contracts/validation"
import { FormError } from "@/components/form"
import { SalesDocEditor } from "@/components/sales-doc-editor"
import { ReceiveDialog } from "@/components/receive-payment"
import { SalesDocView } from "@/components/sales-doc-view"
import { EInvoiceButton, EInvoiceDialog, EwayBillButton, EwayBillDialog, useEInvoicing } from "@/components/gst-files"
import type { ContactOption } from "@/components/pickers"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHODS } from "@/lib/money"
import { cn } from "@/lib/utils"
import { docApi, docLabel, docPath, type DocKind, type SalesDoc } from "@/lib/sales"

type Kind = DocKind
const perm = (kind: Kind) => ({ invoice: "billing.invoice", quotation: "sales.quotation", sales_order: "sales.order", delivery_challan: "sales.delivery" })[kind]
const LIST_NAME = { invoice: "Sales Invoices", quotation: "Quotations", sales_order: "Sales Orders", delivery_challan: "Delivery Challans" }

interface Row {
  id: string
  status: string
  number: string | null
  buyer: { name: string; phone?: string | null; gstin?: string | null }
  issueDate: string
  dueDate: string | null
  taxablePaise?: number
  cgstPaise?: number
  sgstPaise?: number
  igstPaise?: number
  totalPaise: number
  paidPaise: number
  branchId: string | null
  noteType?: string | null
  sourceNumber?: string | null
  location?: { id: string; name: string } | null
}

const DATE_HEADER: Record<Kind, string> = { invoice: "Invoice date", quotation: "Quotation date", sales_order: "Order date", delivery_challan: "Challan date" }
const DUE_HEADER: Record<Kind, string> = { invoice: "Due date", quotation: "Valid until", sales_order: "Deliver by", delivery_challan: "Deliver by" }
const LIST_HINT: Record<Kind, string> = {
  invoice: "GST bills to customers. Posting one takes stock out of its warehouse and adds to what the customer owes.",
  quotation: "Rates sent to customers. Nothing moves until a quotation becomes an invoice.",
  sales_order: "What customers ordered, invoiced in one go or in parts.",
  delivery_challan: "Goods sent before the bill. Make the invoice from the challan.",
}
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("")
const dated = (iso: string) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />{formatDate(iso)}</span>

const STATUS_FILTERS: Record<Kind, { value: string; label: string }[]> = {
  invoice: [
    { value: "", label: "All" },
    { value: "unpaid", label: "Unpaid" },
    { value: "draft", label: "Drafts" },
    { value: "paid", label: "Paid" },
    { value: "cancelled", label: "Cancelled" },
  ],
  quotation: [
    { value: "", label: "All" },
    { value: "draft", label: "Draft" },
    { value: "sent", label: "Sent" },
    { value: "accepted", label: "Accepted" },
    { value: "converted", label: "Converted" },
    { value: "declined", label: "Declined" },
  ],
  sales_order: [
    { value: "", label: "All" },
    { value: "open", label: "Open" },
    { value: "part_invoiced", label: "Part invoiced" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ],
  delivery_challan: [
    { value: "", label: "All" },
    { value: "issued", label: "Not billed" },
    { value: "converted", label: "Invoiced" },
    { value: "cancelled", label: "Cancelled" },
  ],
}

const PILL: Record<string, string> = {
  red: "bg-[#FDECEA] text-[#B42318] dark:bg-red-950 dark:text-red-200",
  amber: "bg-[#FFF3D6] text-[#8A5A00] dark:bg-amber-950 dark:text-amber-200",
  gray: "bg-muted text-foreground/80",
  green: "bg-[#E6F4EC] text-[#1F7A4D] dark:bg-emerald-950 dark:text-emerald-200",
  blue: "bg-accent text-accent-foreground",
}

/** List status as drawn in the wireframe: Overdue 6d (red), Partial (amber), Unpaid (grey) … */
function listStatus(kind: Kind, r: Row, today: string): { label: string; tone: keyof typeof PILL } {
  if (kind === "invoice") {
    const open = r.status === "issued" || r.status === "partially_paid"
    if (open && r.dueDate && r.dueDate.slice(0, 10) < today) {
      const days = Math.round((Date.parse(today) - Date.parse(r.dueDate.slice(0, 10))) / 86_400_000)
      return { label: `Overdue ${days}d`, tone: "red" }
    }
    if (r.status === "partially_paid") return { label: "Partial", tone: "amber" }
    if (r.status === "issued") return { label: "Unpaid", tone: "gray" }
    if (r.status === "paid") return { label: "Paid", tone: "green" }
    if (r.status === "cancelled") return { label: "Cancelled", tone: "gray" }
    return { label: "Draft", tone: "gray" }
  }
  if (kind === "delivery_challan") {
    const c: Record<string, { label: string; tone: keyof typeof PILL }> = { issued: { label: "Not billed", tone: "blue" }, converted: { label: "Invoiced", tone: "green" }, cancelled: { label: "Cancelled", tone: "gray" } }
    return c[r.status] ?? { label: r.status, tone: "gray" }
  }
  const tone: Record<string, keyof typeof PILL> = { draft: "gray", sent: "blue", accepted: "green", converted: "green", declined: "red", open: "blue", part_invoiced: "amber", completed: "green" }
  const words = r.status.replace(/_/g, " ")
  return { label: words.charAt(0).toUpperCase() + words.slice(1), tone: tone[r.status] ?? "gray" }
}

export function SalesDocList({ kind }: { kind: Kind }) {
  const { can, me } = useAuth()
  const router = useRouter()
  const today = todayInIndia()
  const label = docLabel(kind)
  const canCreate = can(`${perm(kind)}.create`)
  const canEdit = can(`${perm(kind)}.edit`)
  const [version, setVersion] = React.useState(0)
  const [deleting, setDeleting] = React.useState<Row | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const branches = useApi<{ data: { id: string; name: string }[] }>(can("tenant.branch.view") ? "/branches" : null)
  const warehouses = useApi<{ data: { id: string; name: string; isActive: boolean }[] }>(kind !== "quotation" ? "/stock-locations" : null)
  const branchName = (id: string | null | undefined) => branches.data?.data.find((b) => b.id === id)?.name ?? "—"
  const newButton = canCreate && (
    <HeaderLink href={`/app/m/${docPath(kind)}/new`} primary>
      <Plus /> New {label.toLowerCase()}
    </HeaderLink>
  )
  const status = (r: Row) => listStatus(kind, r, today)
  const eInvoicing = useEInvoicing()
  const [bulk, setBulk] = React.useState<null | { type: "eway" | "einvoice"; ids: string[] }>(null)
  const issuedOnly = (rows: Row[]) => rows.filter((r) => !["draft", "cancelled"].includes(r.status)).map((r) => r.id)
  const openBulk = (type: "eway" | "einvoice") => (rows: Row[]) => {
    const ids = issuedOnly(rows)
    if (ids.length) setBulk({ type, ids })
    else toast.error("Choose posted bills")
  }
  const bulkActions =
    (kind === "invoice" || kind === "delivery_challan") && me?.tenant?.gstin
      ? [{ label: "E-way bill JSON", run: openBulk("eway") }, ...(kind === "invoice" && eInvoicing ? [{ label: "E-invoice JSON", run: openBulk("einvoice") }] : [])]
      : []
  const due = (r: Row) => (r.status === "draft" || r.status === "cancelled" ? 0 : Math.max(0, r.totalPaise - r.paidPaise))
  const tax = (r: Row) => (r.cgstPaise ?? 0) + (r.sgstPaise ?? 0) + (r.igstPaise ?? 0)
  const editable = (r: Row) => (kind === "invoice" ? r.status === "draft" : kind === "sales_order" ? r.status === "open" : kind === "delivery_challan" ? r.status === "issued" : ["draft", "sent"].includes(r.status))
  const open = (r: Row) => kind === "invoice" && ["issued", "partially_paid"].includes(r.status)
  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })

  async function act(r: Row, path: string, done: string, then?: (d: SalesDoc) => void) {
    setBusy(r.id)
    try {
      const d = await api.post<SalesDoc>(path)
      toast.success(done)
      if (then) then(d)
      else setVersion((v) => v + 1)
    } catch (e) {
      // A bill over the credit limit is posted from its own page, where it can be approved
      if (e instanceof ApiError && e.details?.creditLimit) router.push(`/app/m/${docPath(kind)}/${r.id}`)
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<Row>[] = [
    {
      key: "number", header: `${label} no.`, hideable: false, sort: (r) => r.number ?? "", csv: (r) => r.number ?? "Draft",
      cell: (r) => (
        <span className="inline-flex flex-col gap-0.5">
          <span className={cn("inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium", r.number ? "text-primary" : "text-muted-foreground")}>{r.number ?? "Draft"}</span>
          {r.noteType === "proforma" && <span className="text-xs text-muted-foreground">Proforma</span>}
          {r.sourceNumber && <span className="text-xs text-muted-foreground">from {r.sourceNumber}</span>}
        </span>
      ),
    },
    {
      key: "customer", header: "Customer", sort: (r) => r.buyer?.name?.toLowerCase() ?? "", csv: (r) => r.buyer?.name,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(r.buyer?.name ?? "?")}</span>
          <span className="min-w-0"><span className="block font-medium">{r.buyer?.name ?? "—"}</span>{(r.buyer?.phone || r.buyer?.gstin) && <span className="block text-xs text-muted-foreground">{r.buyer.gstin ?? r.buyer.phone}</span>}</span>
        </span>
      ),
    },
    { key: "date", header: DATE_HEADER[kind], sort: (r) => r.issueDate, csv: (r) => r.issueDate.slice(0, 10), cell: (r) => dated(r.issueDate) },
    ...(kind !== "delivery_challan"
      ? [{
          key: "due", header: DUE_HEADER[kind], sort: (r: Row) => r.dueDate ?? "", csv: (r: Row) => r.dueDate?.slice(0, 10) ?? "",
          cell: (r: Row) => {
            if (!r.dueDate) return <span className="text-muted-foreground">—</span>
            const late = r.dueDate.slice(0, 10) < today && (open(r) || (kind === "quotation" && ["draft", "sent"].includes(r.status)))
            return <span className={late ? "text-destructive" : ""}>{dated(r.dueDate)}{late && <span className="block text-xs">{kind === "quotation" ? "Expired" : "Overdue"}</span>}</span>
          },
        }]
      : []),
    ...(kind !== "quotation" ? [{ key: "warehouse", header: "Warehouse", defaultHidden: (warehouses.data?.data.length ?? 0) < 2, csv: (r: Row) => r.location?.name ?? "", cell: (r: Row) => (r.location ? <Badge variant="outline">{r.location.name}</Badge> : "—") }] : []),
    { key: "branch", header: "Branch", defaultHidden: true, cell: (r) => branchName(r.branchId), csv: (r) => branchName(r.branchId) },
    { key: "subtotal", header: "Subtotal", align: "right", defaultHidden: true, sort: (r) => r.taxablePaise ?? 0, csv: (r) => ((r.taxablePaise ?? 0) / 100).toFixed(2), cell: (r) => <span className="tabular-nums">{formatPaise(r.taxablePaise ?? 0)}</span> },
    { key: "tax", header: "Tax", align: "right", defaultHidden: true, csv: (r) => (tax(r) / 100).toFixed(2), cell: (r) => <span className="tabular-nums">{formatPaise(tax(r))}</span> },
    { key: "amount", header: "Total", align: "right", sort: (r) => r.totalPaise, csv: (r) => (r.totalPaise / 100).toFixed(2), cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.totalPaise)}</span> },
    ...(kind === "invoice"
      ? [{ key: "balance", header: "Balance", align: "right" as const, sort: (r: Row) => due(r), csv: (r: Row) => (due(r) / 100).toFixed(2), cell: (r: Row) => <span className={cn("font-medium tabular-nums", r.status === "paid" ? "text-emerald-700 dark:text-emerald-300" : due(r) > 0 && "text-orange-600 dark:text-orange-300")}>{r.status === "draft" ? "—" : formatPaise(due(r))}</span> }]
      : []),
    {
      key: "status", header: "Status", csv: (r) => status(r).label,
      cell: (r) => {
        const s = status(r)
        return <span className={cn("inline-flex h-[22px] items-center rounded-full px-2 text-xs font-semibold whitespace-nowrap", PILL[s.tone], r.status === "cancelled" && "line-through")}>{s.label}</span>
      },
    },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Link href={`/app/m/${docPath(kind)}/${r.id}`} className={icon} title="View" aria-label={`View ${r.number ?? "draft"}`}><Eye /></Link>
          {r.status !== "draft" && <a href={`/print/${kind}/${r.id}`} target="_blank" rel="noreferrer" className={icon} title="Print or PDF" aria-label={`Print ${r.number}`}><Printer /></a>}
          {kind === "invoice" && r.status === "draft" && canCreate && <Button variant="ghost" size="icon-sm" disabled={busy === r.id} title="Post" aria-label={`Post draft for ${r.buyer?.name}`} onClick={() => act(r, `/invoices/${r.id}/issue`, "Invoice posted")}><Send /></Button>}
          {open(r) && can("billing.payment.create") && <Link href={`/app/m/billing/${r.id}?pay=1`} className={icon} title="Receive payment" aria-label={`Receive payment on ${r.number}`}><IndianRupee /></Link>}
          {kind === "invoice" && ["issued", "partially_paid", "paid"].includes(r.status) && can("billing.credit_note.create") && <Link href={`/app/m/billing/${r.id}/credit-note`} className={icon} title="Sales return or credit note" aria-label={`Sales return on ${r.number}`}><Undo2 /></Link>}
          {kind === "quotation" && ["draft", "sent", "accepted"].includes(r.status) && can("billing.invoice.create") && <Button variant="ghost" size="icon-sm" disabled={busy === r.id} title="Convert to invoice" aria-label={`Convert ${r.number} to invoice`} onClick={() => act(r, `/quotations/${r.id}/convert`, "Draft invoice made from the quotation", (d) => router.push(`/app/m/billing/${d.id}`))}><FileOutput /></Button>}
          {kind === "delivery_challan" && r.status === "issued" && can("billing.invoice.create") && <Button variant="ghost" size="icon-sm" disabled={busy === r.id} title="Make invoice" aria-label={`Make invoice from ${r.number}`} onClick={() => act(r, `/delivery-challans/${r.id}/invoice`, "Draft invoice made from the challan", (d) => router.push(`/app/m/billing/${d.id}`))}><FileOutput /></Button>}
          {kind === "sales_order" && ["open", "part_invoiced"].includes(r.status) && can("billing.invoice.create") && <Link href={`/app/m/sales/orders/${r.id}`} className={icon} title="Make invoice" aria-label={`Make invoice from ${r.number}`}><FileOutput /></Link>}
          {editable(r) && canEdit && <Link href={`/app/m/${docPath(kind)}/${r.id}/edit`} className={icon} title="Edit" aria-label={`Edit ${r.number ?? "draft"}`}><Pencil /></Link>}
          {r.status === "draft" && canEdit && <Button variant="ghost" size="icon-sm" className="text-destructive" title="Delete draft" aria-label={`Delete draft for ${r.buyer?.name}`} onClick={() => setDeleting(r)}><Trash2 /></Button>}
        </span>
      ),
    },
  ]

  const presets: ViewPreset[] =
    kind === "invoice"
      ? [
          { key: "all", label: "All", params: {}, countKey: "all" },
          { key: "overdue", label: "Overdue", params: { overdue: "true" }, countKey: "overdue" },
          { key: "unpaid", label: "Unpaid", params: { unpaid: "true" }, countKey: "unpaid" },
          { key: "partial", label: "Partly paid", params: { status: "partially_paid" }, countKey: "partially_paid" },
          { key: "draft", label: "Draft", params: { status: "draft" }, countKey: "draft" },
          { key: "paid", label: "Paid", params: { status: "paid" }, countKey: "paid" },
          { key: "cancelled", label: "Cancelled", params: { status: "cancelled" }, countKey: "cancelled" },
        ]
      : STATUS_FILTERS[kind].map((f) => ({ key: f.value || "all", label: f.label, params: (f.value ? { status: f.value } : {}) as Record<string, string>, countKey: f.value || "all" }))
  const places = (warehouses.data?.data ?? []).filter((w) => w.isActive)
  const slug = { invoice: "invoices", quotation: "quotations", sales_order: "sales-orders", delivery_challan: "delivery-challans" }[kind]

  return (
    <>
      <DataList<Row>
        id={slug}
        path={docApi(kind)}
        params={{ v: String(version) }}
        countsPath={`${docApi(kind)}/counts`}
        header={{
          title: LIST_NAME[kind],
          description: LIST_HINT[kind],
          actions: kind === "invoice" && canCreate && can("billing.payment.create") ? <HeaderLink href="/app/m/billing/new?cash=1">Cash bill</HeaderLink> : undefined,
          primary: newButton,
          // Pages kept off the fixed Sales menu, for businesses that use them
          more: [
            ...(kind !== "sales_order" && can("sales.order.view") ? [{ label: "Sales Orders", href: "/app/m/sales/orders" }] : []),
            ...(kind !== "delivery_challan" && can("sales.delivery.view") ? [{ label: "Delivery Challans", href: "/app/m/sales/challans" }] : []),
            ...(kind === "invoice" && can("billing.invoice.view") ? [{ label: "Debit Notes", href: "/app/m/billing/debit-notes" }] : []),
            ...(kind !== "invoice" && can("billing.invoice.view") ? [{ label: "Sales Invoices", href: "/app/m/billing" }] : []),
          ],
        }}
        columns={columns}
        searchPlaceholder="Search number, customer, mobile or GSTIN"
        presets={presets}
        filters={[
          periodFilter(me?.tenant?.fyStartMonth ?? 4),
          ...(kind !== "quotation" && places.length > 1 ? [{ key: "locationId", label: "Warehouse", options: places.map((w) => ({ value: w.id, label: w.name })) }] : []),
        ]}
        rowHref={(r) => `/app/m/${docPath(kind)}/${r.id}`}
        bulkActions={bulkActions}
        exportName={slug}
        emptyState={
          <EmptyState
            icon={FileText}
            title={`No ${label.toLowerCase()}s yet`}
            description={{ invoice: "Make a GST invoice in under a minute. Posting it takes the stock out and adds it to what the customer owes.", quotation: "Send a customer your rates, then turn the quotation into an invoice when they agree.", sales_order: "Write down what the customer ordered, then invoice it in one go or in parts.", delivery_challan: "Send goods with a challan, then make the invoice from it." }[kind]}
            action={newButton}
          />
        }
      />
      {bulk?.type === "eway" && <EwayBillDialog ids={bulk.ids} label={`${bulk.ids.length}-bills`} hasChallan={kind === "delivery_challan"} onClose={() => setBulk(null)} />}
      {bulk?.type === "einvoice" && <EInvoiceDialog ids={bulk.ids} label={`${bulk.ids.length}-bills`} onClose={() => setBulk(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title="Delete this draft?"
        description={`The draft for ${deleting?.buyer?.name ?? "this customer"} is removed. Nothing was posted, so stock and dues don't change.`}
        confirmLabel="Delete draft"
        onConfirm={async () => {
          try {
            await api.delete(`${docApi(kind)}/${deleting!.id}`)
            toast.success("Draft deleted")
            setVersion((v) => v + 1)
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}

function NewDoc({ kind }: { kind: Kind }) {
  const params = useSearchParams()
  const contactId = params.get("contact")
  const cash = kind === "invoice" && params.get("cash") === "1"
  const contact = useApi<ContactOption>(contactId ? `/contacts/${contactId}` : null)
  if (contactId && contact.loading) return <div className="grid place-items-center py-24"><Spinner /></div>
  return (
    <>
      <Link href={`/app/m/${docPath(kind)}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {LIST_NAME[kind]}</Link>
      <PageHeader title={cash ? "New cash bill" : `New ${docLabel(kind).toLowerCase()}`} />
      <SalesDocEditor kind={kind} initialContact={contact.data} cash={cash} />
    </>
  )
}

export function SalesDocNew({ kind }: { kind: Kind }) {
  return (
    <React.Suspense>
      <NewDoc kind={kind} />
    </React.Suspense>
  )
}

export function SalesDocEdit({ kind, id }: { kind: Kind; id: string }) {
  const { data, error } = useApi<SalesDoc>(`${docApi(kind)}/${id}`)
  if (error) return <p className="text-sm text-muted-foreground">{error.message}</p>
  if (!data) return <div className="grid place-items-center py-24"><Spinner /></div>
  return (
    <>
      <Link href={`/app/m/${docPath(kind)}/${id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back</Link>
      <PageHeader title={`Edit ${data.number ?? `draft ${docLabel(kind).toLowerCase()}`}`} />
      <SalesDocEditor kind={kind} doc={data} />
    </>
  )
}

function OrderInvoiceDialog({ order, target, onClose, onSaved }: { order: SalesDoc; target: "invoice" | "challan"; onClose: () => void; onSaved: (d: SalesDoc) => void }) {
  const { data: lines, error: loadError } = useApi<{ id: string; description: string; unit: string; quantityLeft: number }[]>(`/sales-orders/${order.id}/open-lines`)
  const [typed, setTyped] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const qty = (l: { id: string; quantityLeft: number }) => (typed[l.id] ?? String(l.quantityLeft))
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const chosen = (lines ?? []).filter((l) => Number(qty(l)) > 0)
    if (!chosen.length) return setError("Enter a quantity on at least one line.")
    setBusy(true)
    setError(null)
    try {
      const inv = await api.post<SalesDoc>(`/sales-orders/${order.id}/${target}`, { lines: chosen.map((l) => ({ sourceLineId: l.id, quantity: Number(qty(l)) })) })
      toast.success(target === "invoice" ? "Draft invoice created" : "Delivery challan created")
      onSaved(inv)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target === "invoice" ? "Create invoice" : "Create delivery challan"}</DialogTitle>
          <DialogDescription>Choose how much of {order.number} to {target === "invoice" ? "bill" : "send"} now. You can do the rest later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          {loadError && <FormError message={loadError.message} />}
          {!lines && !loadError && <div className="grid place-items-center py-6"><Spinner /></div>}
          {lines?.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                {l.description}
                <span className="block text-xs text-muted-foreground">{l.quantityLeft} {l.unit} left</span>
              </span>
              <Input className="w-24 text-right" inputMode="decimal" aria-label={`Quantity for ${l.description}`} disabled={l.quantityLeft <= 0} value={qty(l)} onChange={(e) => setTyped({ ...typed, [l.id]: e.target.value.replace(/[^\d.]/g, "") })} />
            </div>
          ))}
          <FormError message={error} />
          <DialogFooter><Button type="submit" disabled={busy || !lines}>{busy ? "Saving…" : target === "invoice" ? "Create draft invoice" : "Create challan"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SalesDocDetail({ kind, id }: { kind: Kind; id: string }) {
  const router = useRouter()
  const { can, me } = useAuth()
  const { data: doc, setData, reload, error } = useApi<SalesDoc>(`${docApi(kind)}/${id}`)
  const advances = useApi<AdvanceList>(kind === "invoice" && doc?.contactId && can("billing.payment.view") ? `/advances?contactId=${doc.contactId}` : null)
  const creditNotes = useApi<{ data: { id: string; number: string; status: string; issueDate: string; totalPaise: number }[] }>(kind === "invoice" && can("billing.credit_note.view") ? `/credit-notes?sourceId=${id}&limit=50` : null)
  const orderInvoices = useApi<{ data: { id: string; number: string | null; status: string; totalPaise: number }[] }>((kind === "sales_order" || kind === "delivery_challan") && can("billing.invoice.view") ? `/invoices?sourceId=${id}&limit=50` : null)
  const challans = useApi<{ data: { id: string; number: string | null; status: string; totalPaise: number }[] }>(kind === "sales_order" && can("sales.delivery.view") ? `/delivery-challans?sourceId=${id}&limit=50` : null)
  const debitNotes = useApi<{ data: { id: string; number: string; status: string; issueDate: string; totalPaise: number }[] }>(kind === "invoice" && can("billing.credit_note.view") ? `/debit-notes?sourceId=${id}&limit=50` : null)
  const [invoicingOrder, setInvoicingOrder] = React.useState<null | "invoice" | "challan">(null)
  const [overLimit, setOverLimit] = React.useState<string | null>(null)
  const search = useSearchParams()
  const [paying, setPaying] = React.useState(kind === "invoice" && search.get("pay") === "1")
  const [usingAdvance, setUsingAdvance] = React.useState(false)
  const [reversing, setReversing] = React.useState<NonNullable<SalesDoc["payments"]>[number] | null>(null)
  const [cancelling, setCancelling] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  if (error) return <p className="text-sm text-muted-foreground">{error.message}</p>
  if (!doc) return <div className="grid place-items-center py-24"><Spinner /></div>

  const p = perm(kind)
  const editable = kind === "invoice" ? doc.status === "draft" : kind === "sales_order" ? doc.status === "open" : kind === "delivery_challan" ? doc.status === "issued" : ["draft", "sent"].includes(doc.status)
  const shareUrl = doc.shareToken ? `${window.location.origin}/d/${doc.shareToken}` : null
  const balance = doc.totalPaise - doc.paidPaise
  const spendable = (advances.data?.balancePaise ?? 0) + (advances.data?.creditPaise ?? 0)

  const act = async (fn: () => Promise<SalesDoc | void>, success: string) => {
    setBusy(true)
    try {
      const d = await fn()
      if (d) setData(d)
      else await reload()
      toast.success(success)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const whatsappText = encodeURIComponent(`${docLabel(kind)} ${doc.number} from ${me?.tenant?.name}: ${formatPaise(doc.totalPaise)}. View: ${shareUrl}`)

  return (
    <>
      <Link href={`/app/m/${docPath(kind)}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {LIST_NAME[kind]}</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {doc.number ?? `Draft ${docLabel(kind).toLowerCase()}`}
            {(() => {
              // The same words and colours as the list
              const s = listStatus(kind, doc as unknown as Row, todayInIndia())
              return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", PILL[s.tone])}>{s.label}</span>
            })()}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {doc.buyer.name} · {formatPaise(doc.totalPaise)}{doc.location ? ` · ${doc.location.name}` : ""}
            {kind === "invoice" && doc.paidPaise > 0 && balance > 0 && ` · ${formatPaise(balance)} due`}
            {doc.cancelReason && ` · Cancelled: ${doc.cancelReason}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && can(`${p}.edit`) && <Link href={`/app/m/${docPath(kind)}/${id}/edit`} className={buttonVariants({ variant: "outline" })}><Pencil /> Edit</Link>}
          {kind === "invoice" && doc.status === "draft" && can("billing.invoice.create") && (
            <Button disabled={busy} onClick={async () => {
              setBusy(true)
              try {
                setData(await api.post<SalesDoc>(`/invoices/${id}/issue`))
                toast.success("Invoice posted")
              } catch (e) {
                if (e instanceof ApiError && e.details?.creditLimit && can("billing.invoice.approve")) setOverLimit(e.message)
                else toast.error(errorMessage(e))
              } finally {
                setBusy(false)
              }
            }}><Send /> Post invoice</Button>
          )}
          {kind === "invoice" && ["issued", "partially_paid"].includes(doc.status) && can("billing.payment.create") && (
            <Button onClick={() => setPaying(true)}><IndianRupee /> Receive payment</Button>
          )}
          {kind === "invoice" && ["issued", "partially_paid"].includes(doc.status) && can("billing.payment.create") && spendable > 0 && (
            <Button variant="outline" onClick={() => setUsingAdvance(true)}>Use advance or credit ({formatPaise(spendable)})</Button>
          )}
          {kind === "invoice" && ["issued", "partially_paid", "paid"].includes(doc.status) && can("billing.credit_note.create") && (
            <Link href={`/app/m/billing/${id}/credit-note`} className={buttonVariants({ variant: "outline" })}><FileMinus /> Return or credit note</Link>
          )}
          {kind === "quotation" && doc.status === "draft" && can("sales.quotation.edit") && (
            <Button variant="outline" disabled={busy} onClick={() => act(() => api.post<SalesDoc>(`/quotations/${id}/status`, { status: "sent" }), "Marked as sent")}><Send /> Mark sent</Button>
          )}
          {kind === "quotation" && doc.status === "sent" && can("sales.quotation.edit") && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => act(() => api.post<SalesDoc>(`/quotations/${id}/status`, { status: "accepted" }), "Marked accepted")}>Accepted</Button>
              <Button variant="ghost" disabled={busy} onClick={() => act(() => api.post<SalesDoc>(`/quotations/${id}/status`, { status: "declined" }), "Marked declined")}>Declined</Button>
            </>
          )}
          {kind === "quotation" && ["draft", "sent", "accepted"].includes(doc.status) && can("billing.invoice.create") && (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const inv = await api.post<SalesDoc>(`/quotations/${id}/convert`)
                  toast.success("Draft invoice created")
                  router.push(`/app/m/billing/${inv.id}`)
                } catch (e) {
                  toast.error(errorMessage(e))
                  setBusy(false)
                }
              }}
            >
              <FileText /> Convert to invoice
            </Button>
          )}
          {kind === "quotation" && ["draft", "sent", "accepted"].includes(doc.status) && can("sales.order.create") && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const order = await api.post<SalesDoc>(`/quotations/${id}/convert-order`)
                  toast.success("Sales order created")
                  router.push(`/app/m/sales/orders/${order.id}`)
                } catch (e) {
                  toast.error(errorMessage(e))
                  setBusy(false)
                }
              }}
            >
              Make sales order
            </Button>
          )}
          {kind === "sales_order" && ["open", "part_invoiced"].includes(doc.status) && can("billing.invoice.create") && (
            <Button onClick={() => setInvoicingOrder("invoice")}><FileText /> Create invoice</Button>
          )}
          {kind === "sales_order" && ["open", "part_invoiced"].includes(doc.status) && can("sales.delivery.create") && (
            <Button variant="outline" onClick={() => setInvoicingOrder("challan")}><Truck /> Create challan</Button>
          )}
          {kind === "delivery_challan" && doc.status === "issued" && can("billing.invoice.create") && (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const inv = await api.post<SalesDoc>(`/delivery-challans/${id}/invoice`)
                  toast.success("Draft invoice created")
                  router.push(`/app/m/billing/${inv.id}`)
                } catch (e) {
                  toast.error(errorMessage(e))
                  setBusy(false)
                }
              }}
            >
              <FileText /> Create invoice
            </Button>
          )}
          {kind === "delivery_challan" && doc.status === "issued" && can("sales.delivery.edit") && (
            <Button variant="ghost" onClick={() => setCancelling(true)}><Ban /> Cancel</Button>
          )}
          {(kind === "invoice" || kind === "delivery_challan") && <EwayBillButton doc={doc} onSaved={(d) => setData({ ...doc, ...(d as Partial<SalesDoc>) })} />}
          {kind === "invoice" && <EInvoiceButton doc={doc} onSaved={(d) => setData({ ...doc, ...(d as Partial<SalesDoc>) })} />}
          {doc.status !== "draft" && <a href={`/print/${kind}/${id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><Printer /> Print / PDF</a>}
          {kind === "invoice" && ["issued", "partially_paid"].includes(doc.status) && doc.paidPaise === 0 && can("billing.invoice.approve") && (
            <Button variant="ghost" onClick={() => setCancelling(true)}><Ban /> Cancel</Button>
          )}
          {kind === "sales_order" && doc.status === "open" && can("sales.order.edit") && (
            <Button variant="ghost" onClick={() => setCancelling(true)}><Ban /> Cancel</Button>
          )}
          {doc.status === "draft" && can(`${p}.edit`) && <Button variant="ghost" size="icon" onClick={() => setDeleting(true)} aria-label="Delete draft"><Trash2 /></Button>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <div className="overflow-hidden rounded-4xl border shadow-sm">
          <SalesDocView doc={doc} fallbackSeller={{ name: me?.tenant?.name ?? "", gstin: me?.tenant?.gstin, stateCode: me?.tenant?.billingStateCode }} />
        </div>
        <div className="grid content-start gap-4">
          {shareUrl && (
            <Card>
              <CardHeader><CardTitle className="text-base">Share</CardTitle></CardHeader>
              <CardContent className="grid gap-2">
                <div className="flex gap-2">
                  <Input readOnly value={shareUrl} aria-label="Share link" className="text-xs" />
                  <Button variant="outline" size="icon" aria-label="Copy link" onClick={() => navigator.clipboard.writeText(shareUrl).then(() => toast.success("Link copied"))}><Copy /></Button>
                </div>
                <a className={buttonVariants({ variant: "outline", size: "sm" })} target="_blank" rel="noreferrer" href={`https://wa.me/${(doc.buyer.phone ?? "").replace(/\D/g, "")}?text=${whatsappText}`}>Send on WhatsApp</a>
                {doc.buyer.email && <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`mailto:${doc.buyer.email}?subject=${encodeURIComponent(`${docLabel(kind)} ${doc.number}`)}&body=${whatsappText}`}>Send by email</a>}
              </CardContent>
            </Card>
          )}
          {kind === "invoice" && ((doc.payments?.length ?? 0) > 0 || (doc.adjustments?.length ?? 0) > 0) && (
            <Card>
              <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm">
                  {doc.payments?.map((pm) => {
                    const reversed = doc.payments!.some((o) => o.reversesId === pm.id)
                    return (
                      <li key={pm.id} className="flex justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-mono text-xs">{pm.number}</span>
                          {reversed && <Badge variant="outline" className="ml-2">Reversed</Badge>}
                          <span className="block text-xs text-muted-foreground">{formatDate(pm.paidOn)} · {pm.reversesId ? "Reversal" : PAYMENT_METHODS.find((m) => m.value === pm.method)?.label}{pm.reference ? ` · ${pm.reference}` : ""}</span>
                        </span>
                        <span className="flex items-start gap-1">
                          <span className="font-medium tabular-nums">{formatPaise(pm.amountPaise)}</span>
                          {!pm.reversesId && <a href={`/print/receipt/${pm.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "icon-xs" })} title="Print receipt" aria-label={`Print receipt ${pm.number}`}><Printer /></a>}
                          {!pm.reversesId && !reversed && can("billing.payment.approve") && (
                            <Button variant="ghost" size="icon-xs" aria-label={`Reverse ${pm.number}`} onClick={() => setReversing(pm)}><Undo2 /></Button>
                          )}
                        </span>
                      </li>
                    )
                  })}
                  {doc.adjustments?.filter((a) => !a.reversesId).map((a) => {
                    const removed = doc.adjustments!.some((o) => o.reversesId === a.id)
                    const source = a.payment?.number ?? a.creditNote?.number
                    // A credit note made for this invoice leaves by cancelling the credit note
                    const ownNote = a.creditNote?.sourceId === doc.id
                    return (
                      <li key={a.id} className="flex justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-mono text-xs">{source}</span>
                          {removed && <Badge variant="outline" className="ml-2">Removed</Badge>}
                          <span className="block text-xs text-muted-foreground">{formatDate(a.createdAt)} · {a.creditNote ? "Credit note" : "From advance"}</span>
                        </span>
                        <span className="flex items-start gap-1">
                          <span className="font-medium tabular-nums">{formatPaise(a.amountPaise)}</span>
                          {!removed && !ownNote && can("billing.payment.approve") && (
                            <Button variant="ghost" size="icon-xs" aria-label={`Remove ${source} from this invoice`} disabled={busy} onClick={() => act(async () => { const d = await api.post<SalesDoc>(`/advance-adjustments/${a.id}/reverse`); void advances.reload(); return d }, "Removed from this invoice")}><Undo2 /></Button>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
          {(creditNotes.data?.data.length ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Credit notes</CardTitle></CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm">
                  {creditNotes.data!.data.map((n) => (
                    <li key={n.id}>
                      <Link href={`/app/m/billing/credit-notes/${n.id}`} className="flex justify-between gap-2 hover:underline">
                        <span className="min-w-0">
                          <span className="font-mono text-xs">{n.number}</span>
                          <span className="block text-xs text-muted-foreground">{formatDate(n.issueDate)}{n.status === "cancelled" ? " · Cancelled" : ""}</span>
                        </span>
                        <span className="font-medium tabular-nums">{formatPaise(n.totalPaise)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {(challans.data?.data.length ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Delivery challans</CardTitle></CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm">
                  {challans.data!.data.map((n) => (
                    <li key={n.id}>
                      <Link href={`/app/m/sales/challans/${n.id}`} className="flex justify-between gap-2 hover:underline">
                        <span className="min-w-0">
                          <span className="font-mono text-xs">{n.number}</span>
                          <span className="block text-xs text-muted-foreground">{n.status === "converted" ? "Invoiced" : n.status === "issued" ? "Not billed" : "Cancelled"}</span>
                        </span>
                        <span className="font-medium tabular-nums">{formatPaise(n.totalPaise)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {(debitNotes.data?.data.length ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Debit notes</CardTitle></CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm">
                  {debitNotes.data!.data.map((n) => (
                    <li key={n.id}>
                      <Link href={`/app/m/billing/debit-notes/${n.id}`} className="flex justify-between gap-2 hover:underline">
                        <span className="min-w-0">
                          <span className="font-mono text-xs">{n.number}</span>
                          <span className="block text-xs text-muted-foreground">{formatDate(n.issueDate)}{n.status === "cancelled" ? " · Cancelled" : ""}</span>
                        </span>
                        <span className="font-medium tabular-nums">{formatPaise(n.totalPaise)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {doc.sourceType === "delivery_challan" && doc.sourceId && (
            <Link href={`/app/m/sales/challans/${doc.sourceId}`} className="text-sm text-muted-foreground hover:text-foreground">Created from a delivery challan →</Link>
          )}
          {(orderInvoices.data?.data.length ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Invoices</CardTitle></CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm">
                  {orderInvoices.data!.data.map((n) => (
                    <li key={n.id}>
                      <Link href={`/app/m/billing/${n.id}`} className="flex justify-between gap-2 hover:underline">
                        <span className="min-w-0">
                          <span className="font-mono text-xs">{n.number ?? "Draft"}</span>
                          <span className="block text-xs text-muted-foreground capitalize">{n.status.replace(/_/g, " ")}</span>
                        </span>
                        <span className="font-medium tabular-nums">{formatPaise(n.totalPaise)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {doc.sourceType === "sales_order" && doc.sourceId && (
            <Link href={`/app/m/sales/orders/${doc.sourceId}`} className="text-sm text-muted-foreground hover:text-foreground">Created from a sales order →</Link>
          )}
          {doc.sourceType === "quotation" && doc.sourceId && (
            <Link href={`/app/m/sales/${doc.sourceId}`} className="text-sm text-muted-foreground hover:text-foreground">Created from a quotation →</Link>
          )}
        </div>
      </div>

      {invoicingOrder && <OrderInvoiceDialog order={doc} target={invoicingOrder} onClose={() => setInvoicingOrder(null)} onSaved={(d) => router.push(invoicingOrder === "invoice" ? `/app/m/billing/${d.id}` : `/app/m/sales/challans/${d.id}`)} />}
      <ConfirmDialog
        open={!!overLimit}
        onOpenChange={(o) => !o && setOverLimit(null)}
        title="Over the credit limit"
        description={overLimit ?? ""}
        confirmLabel="Post anyway"
        onConfirm={() => act(() => api.post<SalesDoc>(`/invoices/${id}/issue-over-limit`), "Invoice posted")}
      />
      {paying && (
        <ReceiveDialog
          initial={doc.contactId ? { id: doc.contactId, name: doc.buyer.name, phone: doc.buyer.phone ?? null, gstin: doc.buyer.gstin ?? null } : null}
          bill={{ id: doc.id, number: doc.number, duePaise: doc.totalPaise - doc.paidPaise, contactId: doc.contactId ?? null }}
          onClose={() => setPaying(false)}
          onSaved={async () => { setPaying(false); setData(await api.get<SalesDoc>(`/invoices/${doc.id}`)) }}
        />
      )}
      {usingAdvance && <UseAdvanceDialog doc={doc} list={advances.data!} onClose={() => setUsingAdvance(false)} onSaved={(d) => { setUsingAdvance(false); setData(d); void advances.reload() }} />}
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        destructive
        title={`Reverse ${reversing?.number}?`}
        description={`An opposite entry of ${formatPaise(reversing?.amountPaise ?? 0)} is added and the balance goes back up. The original stays on record.`}
        confirmLabel="Reverse payment"
        onConfirm={() => act(async () => (await api.post<{ invoice: SalesDoc }>(`/payments/${reversing!.id}/reverse`)).invoice, "Payment reversed")}
      />
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        destructive
        title={`Cancel ${doc.number}?`}
        description={`The number stays used and the ${docLabel(kind).toLowerCase()} is kept for your records, marked cancelled.${doc.ewayBillNo ? ` Also cancel e-way bill ${doc.ewayBillNo} on the portal, within 24 hours of making it.` : ""}${doc.irn ? " Also cancel the IRN on the e-invoice portal, within 24 hours of making it." : ""}`}
        reasonLabel="Reason for cancelling"
        confirmLabel={`Cancel ${docLabel(kind).toLowerCase()}`}
        onConfirm={(reason) => act(() => api.post<SalesDoc>(`${docApi(kind)}/${id}/cancel`, { reason }), `${docLabel(kind)} cancelled`)}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        destructive
        title="Delete this draft?"
        confirmLabel="Delete"
        onConfirm={async () => {
          await api.delete(`${docApi(kind)}/${id}`)
          toast.success("Draft deleted")
          router.replace(`/app/m/${docPath(kind)}`)
        }}
      />
    </>
  )
}
