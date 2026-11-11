"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Ban, CalendarDays, Eye, FileMinus, IndianRupee, ListChecks, Plus, Printer, Search, Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState, MoneyInput, Spinner, StatusBadge } from "@/components/common"
import { WarehouseSelect } from "@/components/creatable-select"
import { DataList, periodFilter, type Column, type ViewPreset } from "@/components/data-list"
import { Field, FormError, NativeSelect } from "@/components/form"
import { SalesDocView } from "@/components/sales-doc-view"
import { EInvoiceButton } from "@/components/gst-files"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useDebounced } from "@/lib/use-list"
import { formatDate, formatPaise } from "@/lib/format"
import { PAYMENT_METHODS } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { SalesDoc } from "@/lib/sales"

// Sales returns (credit notes) and debit notes. An issued invoice is never edited: goods come
// back, the value is reduced, or the customer owes more. Each is made against one invoice.

const NOTE_TYPE: Record<string, string> = { return: "Goods returned", amount: "Amount reduced" }
type NoteKind = "return" | "amount" | "debit"

/** The reasons the server accepts, per kind of note (creditNotes.ts NOTE_REASONS) */
const REASONS: Record<NoteKind, { value: string; label: string }[]> = {
  return: [
    { value: "damaged", label: "Damaged or broken" },
    { value: "wrong_item", label: "Wrong item sent" },
    { value: "quality", label: "Quality problem" },
    { value: "excess", label: "Sent more than ordered" },
    { value: "not_needed", label: "Customer no longer needs it" },
    { value: "other", label: "Other" },
  ],
  amount: [
    { value: "rate_difference", label: "Rate was billed too high" },
    { value: "discount", label: "Discount after the sale" },
    { value: "deficiency", label: "Service fell short" },
    { value: "other", label: "Other" },
  ],
  debit: [
    { value: "rate_difference", label: "Rate was billed too low" },
    { value: "short_billed", label: "Billed less than supplied" },
    { value: "other", label: "Other" },
  ],
}
const reasonLabel = (kind: string | null | undefined, reason: string | null | undefined) =>
  (reason && (REASONS[(kind === "return" || kind === "amount" ? kind : "debit") as NoteKind].find((r) => r.value === reason)?.label ?? reason)) || "—"

/** 30 November after the end of the invoice's April–March year (Section 34(2) CGST Act) */
function creditNoteDeadline(invoiceDate: string) {
  const d = new Date(`${invoiceDate.slice(0, 10)}T00:00:00Z`)
  const fyEnd = d.getUTCMonth() >= 3 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()
  return `${fyEnd}-11-30`
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?"
const PILL = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  grey: "bg-muted text-muted-foreground",
  blue: "bg-primary/10 text-primary",
}

interface Row {
  id: string
  status: string
  number: string | null
  buyer: { name: string; phone?: string | null; gstin?: string | null }
  issueDate: string
  totalPaise: number
  paidPaise: number
  cgstPaise?: number
  sgstPaise?: number
  igstPaise?: number
  noteType: string | null
  noteReason?: string | null
  sourceId: string | null
  sourceNumber: string | null
  location?: { id: string; name: string } | null
}

/** Pick the posted invoice a return or debit note is made against. */
function PickInvoiceDialog({ debit, onClose }: { debit: boolean; onClose: () => void }) {
  const router = useRouter()
  const [q, setQ] = React.useState("")
  const query = useDebounced(q.trim())
  const found = useApi<{ data: Row[] }>(`/invoices?limit=20${query ? `&q=${encodeURIComponent(query)}` : ""}`)
  const rows = (found.data?.data ?? []).filter((r) => ["issued", "partially_paid", "paid"].includes(r.status))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{debit ? "New debit note" : "New sales return"}</DialogTitle>
          <DialogDescription>Choose the posted invoice it is against. Only posted invoices can be {debit ? "charged more" : "returned or reduced"}.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input autoFocus className="pl-9" placeholder="Invoice number, customer, mobile or GSTIN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search invoices" />
        </div>
        <div className="-mx-1 max-h-80 overflow-y-auto">
          {found.loading && !found.data ? (
            <div className="grid place-items-center py-10"><Spinner /></div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{query ? "No posted invoice matches." : "No posted invoices yet."}</p>
          ) : (
            <ul className="grid gap-1">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-muted"
                    onClick={() => router.push(`/app/m/billing/${r.id}/credit-note${debit ? "?type=debit" : ""}`)}
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-xs font-medium text-primary">{r.number}</span>
                      <span className="block truncate font-medium">{r.buyer?.name}</span>
                      <span className="block text-xs text-muted-foreground">{formatDate(r.issueDate)}{r.buyer?.gstin ? ` · ${r.buyer.gstin}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums">{formatPaise(r.totalPaise)}</span>
                      <span className="block text-xs text-muted-foreground">{r.status === "paid" ? "Paid" : `Due ${formatPaise(r.totalPaise - r.paidPaise)}`}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CreditNoteList({ kind = "credit_note" }: { kind?: "credit_note" | "debit_note" }) {
  const { me, can } = useAuth()
  const debit = kind === "debit_note"
  const base = debit ? "debit-notes" : "credit-notes"
  const [picking, setPicking] = React.useState(false)
  const [cancelling, setCancelling] = React.useState<Row | null>(null)
  const [version, setVersion] = React.useState(0)
  const warehouses = useApi<{ data: { id: string; name: string; isActive: boolean }[] }>(debit ? null : "/stock-locations")
  const places = (warehouses.data?.data ?? []).filter((w) => w.isActive)
  const left = (r: Row) => (r.status !== "cancelled" ? Math.max(0, r.totalPaise - r.paidPaise) : 0)
  const tax = (r: Row) => (r.cgstPaise ?? 0) + (r.sgstPaise ?? 0) + (r.igstPaise ?? 0)
  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })
  const status = (r: Row): { label: string; tone: keyof typeof PILL } =>
    r.status === "cancelled" ? { label: "Cancelled", tone: "grey" }
    : debit ? (left(r) > 0 ? { label: r.paidPaise > 0 ? "Partly paid" : "Unpaid", tone: "orange" } : { label: "Paid", tone: "green" })
    : left(r) > 0 ? { label: "Credit open", tone: "blue" } : { label: "Settled", tone: "green" }

  const columns: Column<Row>[] = [
    {
      key: "number", header: debit ? "Debit note no." : "Return no.", hideable: false, sort: (r) => r.number ?? "", csv: (r) => r.number,
      cell: (r) => <span className="inline-flex w-fit rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.number}</span>,
    },
    {
      key: "customer", header: "Customer", sort: (r) => r.buyer?.name?.toLowerCase() ?? "", csv: (r) => r.buyer?.name,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(r.buyer?.name ?? "?")}</span>
          <span className="min-w-0"><span className="block font-medium">{r.buyer?.name ?? "—"}</span>{(r.buyer?.gstin || r.buyer?.phone) && <span className="block text-xs text-muted-foreground">{r.buyer.gstin ?? r.buyer.phone}</span>}</span>
        </span>
      ),
    },
    { key: "date", header: "Date", sort: (r) => r.issueDate, csv: (r) => r.issueDate.slice(0, 10), cell: (r) => formatDate(r.issueDate) },
    {
      key: "invoice", header: "Invoice", csv: (r) => r.sourceNumber,
      cell: (r) => (r.sourceId ? <Link href={`/app/m/billing/${r.sourceId}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs hover:text-primary hover:underline">{r.sourceNumber}</Link> : "—"),
    },
    ...(debit ? [] : [{ key: "type", header: "Type", csv: (r: Row) => NOTE_TYPE[r.noteType ?? ""], cell: (r: Row) => <Badge variant="outline">{NOTE_TYPE[r.noteType ?? ""] ?? "—"}</Badge> }]),
    { key: "reason", header: "Reason", csv: (r) => reasonLabel(debit ? "debit" : r.noteType, r.noteReason), cell: (r) => <span className="text-sm">{reasonLabel(debit ? "debit" : r.noteType, r.noteReason)}</span> },
    ...(debit ? [] : [{ key: "warehouse", header: "Warehouse", defaultHidden: places.length < 2, csv: (r: Row) => r.location?.name ?? "", cell: (r: Row) => (r.location ? <Badge variant="outline">{r.location.name}</Badge> : "—") }]),
    { key: "tax", header: "GST", align: "right", defaultHidden: true, csv: (r) => (tax(r) / 100).toFixed(2), cell: (r) => <span className="tabular-nums">{formatPaise(tax(r))}</span> },
    { key: "amount", header: "Amount", align: "right", sort: (r) => r.totalPaise, csv: (r) => (r.totalPaise / 100).toFixed(2), cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.totalPaise)}</span> },
    {
      key: "left", header: debit ? "Due" : "Credit left", align: "right", sort: (r) => left(r), csv: (r) => (left(r) / 100).toFixed(2),
      cell: (r) => <span className={cn("font-medium tabular-nums", left(r) > 0 && "text-orange-600 dark:text-orange-300")}>{formatPaise(left(r))}</span>,
    },
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
          <Link href={`/app/m/billing/${base}/${r.id}`} className={icon} title="View" aria-label={`View ${r.number}`}><Eye /></Link>
          <a href={`/print/${kind}/${r.id}`} target="_blank" rel="noreferrer" className={icon} title="Print or PDF" aria-label={`Print ${r.number}`}><Printer /></a>
          {!debit && left(r) > 0 && can("billing.refund.create") && <Link href={`/app/m/billing/${base}/${r.id}?refund=1`} className={icon} title="Refund customer" aria-label={`Refund on ${r.number}`}><IndianRupee /></Link>}
          {debit && left(r) > 0 && can("billing.payment.create") && <Link href={`/app/m/billing/${base}/${r.id}?pay=1`} className={icon} title="Receive payment" aria-label={`Receive payment on ${r.number}`}><IndianRupee /></Link>}
          {r.status !== "cancelled" && (!debit || r.paidPaise === 0) && can("billing.credit_note.approve") && <Button variant="ghost" size="icon-sm" className="text-destructive" title="Cancel" aria-label={`Cancel ${r.number}`} onClick={() => setCancelling(r)}><Ban /></Button>}
        </span>
      ),
    },
  ]

  const presets: ViewPreset[] = [
    { key: "all", label: "All", params: {}, countKey: "all" },
    ...(debit
      ? [{ key: "issued", label: "Unpaid", params: { status: "issued" }, countKey: "issued" }, { key: "paid", label: "Paid", params: { status: "paid" }, countKey: "paid" }]
      : [{ key: "return", label: "Goods returned", params: { noteType: "return" } }, { key: "amount", label: "Amount reduced", params: { noteType: "amount" } }]),
    { key: "cancelled", label: "Cancelled", params: { status: "cancelled" }, countKey: "cancelled" },
  ]
  const newButton = can("billing.credit_note.create") && (
    <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setPicking(true)}><Plus /> {debit ? "New debit note" : "New sales return"}</Button>
  )

  return (
    <>
      <DataList<Row>
        id={base}
        path={`/${base}`}
        params={{ v: String(version) }}
        countsPath={`/${base}/counts`}
        header={{
          title: debit ? "Debit Notes" : "Sales Returns",
          description: debit ? "The customer owes more than an invoice said: a rate went up or a bill was short." : "Goods a customer sent back, or a bill you reduced. Each is a credit note against one invoice.",
          primary: newButton,
          more: [
            { label: debit ? "Sales Returns" : "Debit Notes", href: debit ? "/app/m/billing/credit-notes" : "/app/m/billing/debit-notes" },
            { label: "Sales Invoices", href: "/app/m/billing" },
          ],
        }}
        columns={columns}
        searchPlaceholder="Search number, customer, mobile or GSTIN"
        presets={presets}
        filters={[
          periodFilter(me?.tenant?.fyStartMonth ?? 4),
          ...(!debit && places.length > 1 ? [{ key: "locationId", label: "Warehouse", options: places.map((w) => ({ value: w.id, label: w.name })) }] : []),
        ]}
        rowHref={(r) => `/app/m/billing/${base}/${r.id}`}
        exportName={debit ? "debit-notes" : "sales-returns"}
        emptyState={debit
          ? <EmptyState icon={FileMinus} title="No debit notes yet" description="When a bill was short or a rate went up, make a debit note against that invoice." action={newButton} />
          : <EmptyState icon={FileMinus} title="No sales returns yet" description="When goods come back or a bill needs reducing, make a return against that invoice. Stock comes back to the warehouse you choose." action={newButton} />}
      />
      {picking && <PickInvoiceDialog debit={debit} onClose={() => setPicking(false)} />}
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        destructive
        title={`Cancel ${cancelling?.number}?`}
        description={debit ? "The number stays used. The customer no longer owes this amount." : "The number stays used. Returned stock goes back out and the invoice owes again what this cleared."}
        reasonLabel="Reason for cancelling"
        confirmLabel={debit ? "Cancel debit note" : "Cancel return"}
        onConfirm={async (reason) => {
          try {
            await api.post(`/${base}/${cancelling!.id}/cancel`, { reason })
            toast.success(debit ? "Debit note cancelled" : "Return cancelled")
            setVersion((v) => v + 1)
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}

interface OpenLine {
  id: string
  description: string
  unit: string
  hsnSac?: string | null
  itemId?: string | null
  quantity: number | string
  taxablePaise: number
  gstRateBp: number
  quantityLeft: number
  taxableLeftPaise: number
  /** Serial numbers sold on this line */
  serials?: string[]
}

/** The same sum the server does (before GST); the server's figure is the one that counts. */
function taxableOf(line: OpenLine, kind: NoteKind, value: number) {
  if (!value) return 0
  if (kind !== "return") return value
  return value === line.quantityLeft ? line.taxableLeftPaise : Math.min(Math.round((line.taxablePaise * value) / Number(line.quantity)), line.taxableLeftPaise)
}
const gstOf = (line: OpenLine, taxable: number) => Math.round((taxable * line.gstRateBp) / 10_000)

export function CreditNoteNew({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const today = todayInIndia()
  const invoice = useApi<SalesDoc>(`/invoices/${invoiceId}`)
  const lines = useApi<OpenLine[]>(`/invoices/${invoiceId}/credit-note-lines`)
  const [kind, setKind] = React.useState<NoteKind>(params.get("type") === "debit" ? "debit" : params.get("type") === "amount" ? "amount" : "return")
  const [issueDate, setIssueDate] = React.useState(today)
  const [reason, setReason] = React.useState("")
  const [locationId, setLocationId] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [quantities, setQuantities] = React.useState<Record<string, string>>({})
  const [amounts, setAmounts] = React.useState<Record<string, number | null>>({})
  const [serialsBack, setSerialsBack] = React.useState<Record<string, string[]>>({})
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const failed = invoice.error ?? lines.error
  if (failed) return <p className="text-sm text-muted-foreground">{failed.message}</p>
  if (!invoice.data || !lines.data) return <div className="grid place-items-center py-24"><Spinner /></div>

  const doc = invoice.data
  const debit = kind === "debit"
  const intra = doc.igstPaise === 0
  const deadline = creditNoteDeadline(doc.issueDate)
  const warehouse = locationId || doc.locationId || ""
  const value = (l: OpenLine) => (kind === "return" ? Number(quantities[l.id] || 0) : amounts[l.id] ?? 0)
  const chosen = lines.data.filter((l) => value(l) > 0)
  const taxable = chosen.reduce((s, l) => s + taxableOf(l, kind, value(l)), 0)
  const gst = chosen.reduce((s, l) => s + gstOf(l, taxableOf(l, kind, value(l))), 0)
  const total = taxable + gst
  const due = Math.max(0, doc.totalPaise - doc.paidPaise)
  const returnable = lines.data.some((l) => l.quantityLeft > 0)
  const clear = (key: string) => {
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e))
    setError(null)
  }

  function switchKind(k: NoteKind) {
    setKind(k)
    setReason("")
    setErrors({})
    setError(null)
  }

  function returnAll() {
    setQuantities(Object.fromEntries(lines.data!.filter((l) => l.quantityLeft > 0).map((l) => [l.id, String(l.quantityLeft)])))
    setSerialsBack(Object.fromEntries(lines.data!.filter((l) => l.serials?.length).map((l) => [l.id, l.serials!.slice(0, l.quantityLeft)])))
    setErrors({})
  }

  function check() {
    const e: Record<string, string> = {}
    if (!issueDate) e.issueDate = "Choose the date"
    else if (issueDate < doc.issueDate.slice(0, 10)) e.issueDate = `Can't be before the invoice date (${formatDate(doc.issueDate)})`
    else if (issueDate > today) e.issueDate = "Can't be in the future"
    else if (!debit && issueDate > deadline) e.issueDate = `GST allows a credit note on this invoice only until ${formatDate(deadline)}`
    if (!reason) e.reason = "Choose the reason"
    if (reason === "other" && !notes.trim()) e.notes = "Write what happened"
    if (kind === "return" && !warehouse) e.locationId = "Choose the warehouse"
    for (const l of lines.data!) {
      const raw = kind === "return" ? quantities[l.id] : amounts[l.id]
      if (raw === undefined || raw === "" || raw === null) continue
      const v = Number(raw)
      const key = `line.${l.id}`
      if (kind === "return") {
        if (v < 0) e[key] = "Can't be less than 0"
        else if (v > l.quantityLeft) e[key] = `Only ${l.quantityLeft} ${l.unit} can be returned`
        else if (v > 0 && l.serials?.length && (serialsBack[l.id]?.length ?? 0) !== v) e[key] = `Tick the ${v} serial number${v === 1 ? "" : "s"} that came back`
      } else if (kind === "amount" && v > l.taxableLeftPaise) e[key] = `Only ${formatPaise(l.taxableLeftPaise)} is left on this line`
    }
    if (!chosen.length) e.lines = kind === "return" ? "Enter the quantity returned on at least one item" : debit ? "Enter the amount to add on at least one item" : "Enter the amount to reduce on at least one item"
    const clean = Object.fromEntries(Object.entries(e).filter(([, v]) => v))
    setErrors(clean)
    return Object.keys(clean).length === 0
  }

  async function issue() {
    setError(null)
    if (!check()) return setError("Fix the marked fields first.")
    setBusy(true)
    const body = {
      issueDate,
      reason,
      notes: notes.trim() || null,
      ...(debit
        ? { lines: chosen.map((l) => ({ sourceLineId: l.id, taxablePaise: value(l) })) }
        : {
            type: kind,
            ...(kind === "return" ? { locationId: warehouse } : {}),
            lines: chosen.map((l) => (kind === "return" ? { sourceLineId: l.id, quantity: value(l), ...(serialsBack[l.id]?.length ? { serials: serialsBack[l.id] } : {}) } : { sourceLineId: l.id, taxablePaise: value(l) })),
          }),
    }
    try {
      const note = await api.post<SalesDoc>(`/invoices/${invoiceId}/${debit ? "debit-notes" : "credit-notes"}`, body)
      toast.success(debit ? "Debit note issued" : kind === "return" ? "Return recorded" : "Credit note issued")
      router.replace(`/app/m/billing/${debit ? "debit" : "credit"}-notes/${note.id}`)
    } catch (err) {
      if (err instanceof ApiError) {
        // Line errors come back as lines.{i}.field, where i counts the lines sent
        const mapped: Record<string, string> = {}
        for (const [k, v] of Object.entries(err.fields)) {
          const m = /^lines\.(\d+)\./.exec(k)
          mapped[m ? `line.${chosen[Number(m[1])]?.id}` : k] = v
        }
        setErrors(mapped)
      }
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const cardTitle = "flex items-center gap-2.5 border-b px-5 py-4 font-semibold"
  const title = debit ? "New debit note" : kind === "return" ? "New sales return" : "New credit note"
  const KINDS: { value: NoteKind; label: string; hint: string }[] = [
    { value: "return", label: "Goods returned", hint: "Stock comes back; the bill goes down" },
    { value: "amount", label: "Reduce the amount", hint: "No goods back; a rate or discount fix" },
    { value: "debit", label: "Charge more", hint: "Debit note: the bill was short" },
  ]

  return (
    <>
      <Link href={`/app/m/billing/${invoiceId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {doc.number}</Link>
      <PageHeader title={title} description={`Against ${doc.number} · ${doc.buyer.name}`} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5">
          <section className="ui-surface overflow-hidden">
            <h2 className={cardTitle}><CalendarDays className="size-4 text-primary" aria-hidden /> {debit ? "Debit note details" : "Return details"}</h2>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <div className="grid gap-1 rounded-2xl bg-muted/50 px-4 py-3 text-sm md:col-span-2">
                <p><span className="text-muted-foreground">Invoice: </span><span className="font-medium">{doc.number}</span> · {formatDate(doc.issueDate)} · {formatPaise(doc.totalPaise)}{due > 0 ? ` · Due ${formatPaise(due)}` : " · Paid"}</p>
                <p><span className="text-muted-foreground">Customer: </span>{doc.buyer.name}<span className="text-muted-foreground"> · GSTIN: </span>{doc.buyer.gstin ?? "Not registered (B2C)"}</p>
              </div>
              <fieldset className="grid gap-2 md:col-span-2">
                <legend className="mb-2 text-sm font-medium">What happened? <span className="text-destructive">*</span></legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {KINDS.map((k) => (
                    <label key={k.value} className={cn("flex cursor-pointer gap-2.5 rounded-2xl border p-3 text-sm transition-colors", kind === k.value ? "border-primary bg-primary/5" : "hover:bg-muted/60", k.value === "return" && !returnable && "pointer-events-none opacity-50")}>
                      <input type="radio" name="note-kind" className="mt-0.5 accent-primary" checked={kind === k.value} disabled={k.value === "return" && !returnable} onChange={() => switchKind(k.value)} />
                      <span><span className="block font-medium">{k.label}</span><span className="block text-xs text-muted-foreground">{k.value === "return" && !returnable ? "Everything on this invoice is already returned" : k.hint}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="Date" required error={errors.issueDate} hint={debit ? undefined : `GST allows it until ${formatDate(deadline)}`}>
                <Input type="date" value={issueDate} min={doc.issueDate.slice(0, 10)} max={today} onChange={(e) => { setIssueDate(e.target.value); clear("issueDate") }} />
              </Field>
              <Field label="Reason" required error={errors.reason}>
                <NativeSelect value={reason} onChange={(e) => { setReason(e.target.value); clear("reason"); clear("notes") }} aria-label="Reason">
                  <option value="">Choose the reason</option>
                  {REASONS[kind].map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </NativeSelect>
              </Field>
              {kind === "return" && (
                <Field label="Warehouse" required error={errors.locationId} hint={doc.location && warehouse === doc.locationId ? `Where the sale left from` : "Goods come back here"}>
                  <WarehouseSelect value={warehouse} onChange={(v) => { setLocationId(v); clear("locationId") }} aria-label="Warehouse" />
                </Field>
              )}
              <Field label={reason === "other" ? "What happened" : "Note"} required={reason === "other"} error={errors.notes} className={kind === "return" ? undefined : "md:col-span-2"}>
                <Input value={notes} maxLength={2000} onChange={(e) => { setNotes(e.target.value); clear("notes") }} placeholder={kind === "return" ? "Box crushed in transit" : debit ? "Freight not billed" : "Agreed 5% off"} />
              </Field>
            </div>
          </section>

          <section className="ui-surface overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
              <h2 className="flex items-center gap-2.5 font-semibold"><ListChecks className="size-4 text-primary" aria-hidden /> Items</h2>
              {kind === "return" && returnable && <Button variant="outline" size="sm" onClick={returnAll}>Return everything</Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">{kind === "return" ? "Sold" : "Billed (before GST)"}</th>
                    {kind !== "debit" && <th className="px-3 py-2 text-right font-medium">{kind === "return" ? "Can return" : "Left to reduce"}</th>}
                    <th className="px-3 py-2 text-right font-medium">{kind === "return" ? "Return qty" : debit ? "Add (before GST)" : "Reduce by (before GST)"}</th>
                    <th className="px-3 py-2 text-right font-medium">GST</th>
                    <th className="px-5 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.data.map((l) => {
                    const err = errors[`line.${l.id}`]
                    const t = taxableOf(l, kind, value(l))
                    const done = kind === "return" ? l.quantityLeft <= 0 : kind === "amount" ? l.taxableLeftPaise <= 0 : false
                    return (
                      <tr key={l.id} className={cn("border-b border-border/60 align-top last:border-0", done && "text-muted-foreground")}>
                        <td className="px-5 py-3">
                          <span className="block font-medium">{l.description}</span>
                          {l.hsnSac && <span className="block text-xs text-muted-foreground">HSN {l.hsnSac}</span>}
                          {done && <span className="block text-xs">{kind === "return" ? "All returned already" : "Nothing left to reduce"}</span>}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{kind === "return" ? `${Number(l.quantity)} ${l.unit}` : formatPaise(l.taxablePaise)}</td>
                        {kind !== "debit" && <td className="px-3 py-3 text-right tabular-nums">{kind === "return" ? `${l.quantityLeft} ${l.unit}` : formatPaise(l.taxableLeftPaise)}</td>}
                        <td className="px-3 py-3">
                          <div className="ml-auto w-36">
                            {kind === "return" ? (
                              <Input type="number" min="0" max={l.quantityLeft} step="any" inputMode="decimal" className="text-right" aria-label={`Return quantity for ${l.description}`} aria-invalid={!!err} disabled={done} value={quantities[l.id] ?? ""} onChange={(e) => { setQuantities({ ...quantities, [l.id]: e.target.value }); clear(`line.${l.id}`); clear("lines") }} />
                            ) : (
                              <MoneyInput value={amounts[l.id] ?? null} disabled={done} aria-label={`${debit ? "Amount to add" : "Amount to reduce"} for ${l.description}`} onChange={(v) => { setAmounts({ ...amounts, [l.id]: v }); clear(`line.${l.id}`); clear("lines") }} />
                            )}
                            {kind === "return" && !!l.serials?.length && Number(quantities[l.id] || 0) > 0 && (
                              <div className="mt-2 flex flex-wrap justify-end gap-1" role="group" aria-label={`Serial numbers returned for ${l.description}`}>
                                {l.serials.map((s) => {
                                  const on = serialsBack[l.id]?.includes(s) ?? false
                                  return (
                                    <button key={s} type="button" aria-pressed={on} className={cn("rounded-lg border px-1.5 py-0.5 font-mono text-[11px]", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}
                                      onClick={() => { const cur = serialsBack[l.id] ?? []; setSerialsBack({ ...serialsBack, [l.id]: on ? cur.filter((x) => x !== s) : [...cur, s] }); clear(`line.${l.id}`) }}>
                                      {s}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                            {err && <p className="mt-1 text-right text-xs text-destructive">{err}</p>}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{l.gstRateBp / 100}%</td>
                        <td className="px-5 py-3 text-right font-medium tabular-nums">{formatPaise(t + gstOf(l, t))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {errors.lines && <p className="border-t px-5 py-3 text-sm text-destructive">{errors.lines}</p>}
          </section>
        </div>

        <aside className="grid gap-5 xl:sticky xl:top-20">
          <section className="ui-surface overflow-hidden">
            <h2 className={cardTitle}>Summary</h2>
            <dl className="grid gap-2 p-5 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Items</dt><dd className="tabular-nums">{chosen.length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Taxable value</dt><dd className="tabular-nums">{formatPaise(taxable)}</dd></div>
              {intra ? (
                <>
                  <div className="flex justify-between"><dt className="text-muted-foreground">CGST</dt><dd className="tabular-nums">{formatPaise(Math.floor(gst / 2))}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">SGST</dt><dd className="tabular-nums">{formatPaise(gst - Math.floor(gst / 2))}</dd></div>
                </>
              ) : (
                <div className="flex justify-between"><dt className="text-muted-foreground">IGST</dt><dd className="tabular-nums">{formatPaise(gst)}</dd></div>
              )}
              <div className="mt-1 flex justify-between border-t pt-3 text-base font-semibold"><dt>{debit ? "Debit note total" : "Credit total"}</dt><dd className="tabular-nums">{formatPaise(total)}</dd></div>
              {debit ? (
                <div className="flex justify-between text-muted-foreground"><dt>Customer will owe more</dt><dd className="tabular-nums">{formatPaise(total)}</dd></div>
              ) : (
                <>
                  <div className="flex justify-between text-muted-foreground"><dt>Invoice due now</dt><dd className="tabular-nums">{formatPaise(due)}</dd></div>
                  <div className="flex justify-between text-muted-foreground"><dt>Invoice due after this</dt><dd className="tabular-nums">{formatPaise(Math.max(0, due - total))}</dd></div>
                  {total > due && <div className="flex justify-between font-medium text-primary"><dt>Stays as customer credit</dt><dd className="tabular-nums">{formatPaise(total - due)}</dd></div>}
                </>
              )}
            </dl>
            <p className="mx-5 mb-4 rounded-2xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              {debit ? "GST follows the invoice line. The customer owes this on top of the invoice." : kind === "return" ? "GST follows the invoice line. Stock comes back to the warehouse you chose." : "GST follows the invoice line. No stock moves."}
            </p>
            <div className="grid gap-2 border-t p-5">
              <FormError message={error} />
              <Button disabled={busy} onClick={issue}>{busy ? "Saving…" : debit ? "Issue debit note" : kind === "return" ? "Save return" : "Issue credit note"}</Button>
              <Link href={`/app/m/billing/${invoiceId}`} className={buttonVariants({ variant: "ghost" })}>Cancel</Link>
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}

function RefundDialog({ note, onClose, onSaved }: { note: SalesDoc; onClose: () => void; onSaved: (d: SalesDoc) => void }) {
  const left = note.totalPaise - note.paidPaise
  const [amount, setAmount] = React.useState<number | null>(left)
  const [method, setMethod] = React.useState("cash")
  const [reference, setReference] = React.useState("")
  const [paidOn, setPaidOn] = React.useState(todayInIndia())
  const [error, setError] = React.useState<string | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!amount) return setErrors({ amountPaise: "Enter an amount" })
    setBusy(true)
    setError(null)
    try {
      const d = await api.post<SalesDoc>(`/credit-notes/${note.id}/refund`, { amountPaise: amount, method, reference: reference || null, paidOn })
      toast.success("Refund recorded")
      onSaved(d)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund customer</DialogTitle>
          <DialogDescription>Left on {note.number}: {formatPaise(left)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" error={errors.amountPaise}><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
            <Field label="Date"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
            <Field label="Method">
              <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Reference" hint="UPI ref, cheque no., etc."><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
          <FormError message={error} />
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record refund"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CreditNoteDetail({ id }: { id: string }) {
  const { can, me } = useAuth()
  const { data: note, setData, error } = useApi<SalesDoc>(`/credit-notes/${id}`)
  // The list's ₹ action opens the refund straight away
  const [refunding, setRefunding] = React.useState(useSearchParams().get("refund") === "1")
  const [cancelling, setCancelling] = React.useState(false)
  const [reversing, setReversing] = React.useState<NonNullable<SalesDoc["payments"]>[number] | null>(null)

  if (error) return <p className="text-sm text-muted-foreground">{error.message}</p>
  if (!note) return <div className="grid place-items-center py-24"><Spinner /></div>

  const live = note.status === "issued"
  const left = live ? note.totalPaise - note.paidPaise : 0

  return (
    <>
      <Link href="/app/m/billing/credit-notes" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Sales Returns</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{note.number} <StatusBadge status={note.status} /></h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {note.buyer.name} · {formatPaise(note.totalPaise)} · {NOTE_TYPE[note.noteType ?? ""]}{note.noteReason ? ` (${reasonLabel(note.noteType, note.noteReason)})` : ""}{note.location ? ` · Back to ${note.location.name}` : ""} · Against <Link href={`/app/m/billing/${note.sourceId}`} className="underline underline-offset-2 hover:text-foreground">{note.sourceNumber}</Link>
            {note.cancelReason && ` · Cancelled: ${note.cancelReason}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {left > 0 && can("billing.refund.create") && <Button onClick={() => setRefunding(true)}><IndianRupee /> Refund customer</Button>}
          <EInvoiceButton doc={note} onSaved={(d) => setData({ ...note, ...(d as Partial<SalesDoc>) })} />
          <a href={`/print/credit_note/${id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><Printer /> Print / PDF</a>
          {live && can("billing.credit_note.approve") && <Button variant="ghost" onClick={() => setCancelling(true)}><Ban /> Cancel</Button>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <div className="overflow-hidden rounded-4xl border shadow-sm">
          <SalesDocView doc={note} fallbackSeller={{ name: me?.tenant?.name ?? "", gstin: me?.tenant?.gstin, stateCode: me?.tenant?.billingStateCode }} />
        </div>
        <div className="grid content-start gap-4">
          {live && (
            <Card>
              <CardHeader><CardTitle className="text-base">Where it went</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-2 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Used or refunded</dt><dd className="tabular-nums">{formatPaise(note.paidPaise)}</dd></div>
                  <div className="flex justify-between font-medium"><dt>Left with customer</dt><dd className="tabular-nums">{formatPaise(left)}</dd></div>
                </dl>
                {left > 0 && <p className="mt-3 text-xs text-muted-foreground">Refund it here, or use it from another invoice of this customer.</p>}
              </CardContent>
            </Card>
          )}
          {(note.payments?.length ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Refunds</CardTitle></CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm">
                  {note.payments!.map((pm) => {
                    const reversed = note.payments!.some((o) => o.reversesId === pm.id)
                    return (
                      <li key={pm.id} className="flex justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-mono text-xs">{pm.number}</span>
                          {reversed && <Badge variant="outline" className="ml-2">Reversed</Badge>}
                          <span className="block text-xs text-muted-foreground">{formatDate(pm.paidOn)} · {pm.reversesId ? "Reversal" : PAYMENT_METHODS.find((m) => m.value === pm.method)?.label}{pm.reference ? ` · ${pm.reference}` : ""}</span>
                        </span>
                        <span className="flex items-start gap-1">
                          <span className="font-medium tabular-nums">{formatPaise(pm.amountPaise)}</span>
                          {!pm.reversesId && !reversed && can("billing.payment.approve") && (
                            <Button variant="ghost" size="icon-xs" aria-label={`Reverse ${pm.number}`} onClick={() => setReversing(pm)}><Undo2 /></Button>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {refunding && <RefundDialog note={note} onClose={() => setRefunding(false)} onSaved={(d) => { setRefunding(false); setData(d) }} />}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        destructive
        title={`Cancel ${note.number}?`}
        description="The number stays used. The invoice owes again what this credit note cleared."
        reasonLabel="Reason for cancelling"
        confirmLabel="Cancel credit note"
        onConfirm={async (reason) => {
          try {
            setData(await api.post<SalesDoc>(`/credit-notes/${id}/cancel`, { reason }))
            toast.success("Credit note cancelled")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        destructive
        title={`Reverse ${reversing?.number}?`}
        description="An opposite entry is added and the credit comes back. The original stays on record."
        confirmLabel="Reverse refund"
        onConfirm={async () => {
          try {
            const { invoice } = await api.post<{ invoice: SalesDoc }>(`/payments/${reversing!.id}/reverse`)
            setData(invoice)
            toast.success("Refund reversed")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}

function DebitPaymentDialog({ note, onClose, onSaved }: { note: SalesDoc; onClose: () => void; onSaved: (d: SalesDoc) => void }) {
  const due = note.totalPaise - note.paidPaise
  const [amount, setAmount] = React.useState<number | null>(due)
  const [method, setMethod] = React.useState("cash")
  const [reference, setReference] = React.useState("")
  const [paidOn, setPaidOn] = React.useState(todayInIndia())
  const [error, setError] = React.useState<string | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!amount) return setErrors({ amountPaise: "Enter an amount" })
    setBusy(true)
    setError(null)
    try {
      const d = await api.post<SalesDoc>(`/debit-notes/${note.id}/payments`, { amountPaise: amount, method, reference: reference || null, paidOn })
      toast.success("Payment recorded")
      onSaved(d)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Due on {note.number}: {formatPaise(due)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" error={errors.amountPaise}><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
            <Field label="Date"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
            <Field label="Method">
              <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Reference" hint="UPI ref, cheque no., etc."><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
          <FormError message={error} />
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record payment"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DebitNoteDetail({ id }: { id: string }) {
  const { can, me } = useAuth()
  const { data: note, setData, error } = useApi<SalesDoc>(`/debit-notes/${id}`)
  const [paying, setPaying] = React.useState(useSearchParams().get("pay") === "1")
  const [cancelling, setCancelling] = React.useState(false)
  const [reversing, setReversing] = React.useState<NonNullable<SalesDoc["payments"]>[number] | null>(null)

  if (error) return <p className="text-sm text-muted-foreground">{error.message}</p>
  if (!note) return <div className="grid place-items-center py-24"><Spinner /></div>

  const due = note.status === "cancelled" ? 0 : note.totalPaise - note.paidPaise
  return (
    <>
      <Link href="/app/m/billing/debit-notes" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Debit notes</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{note.number} <StatusBadge status={note.status} /></h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {note.buyer.name} · {formatPaise(note.totalPaise)}{note.noteReason ? ` · ${reasonLabel("debit", note.noteReason)}` : ""} · Against <Link href={`/app/m/billing/${note.sourceId}`} className="underline underline-offset-2 hover:text-foreground">{note.sourceNumber}</Link>
            {note.cancelReason && ` · Cancelled: ${note.cancelReason}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {due > 0 && can("billing.payment.create") && <Button onClick={() => setPaying(true)}><IndianRupee /> Record payment</Button>}
          <EInvoiceButton doc={note} onSaved={(d) => setData({ ...note, ...(d as Partial<SalesDoc>) })} />
          <a href={`/print/debit_note/${id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><Printer /> Print / PDF</a>
          {note.status !== "cancelled" && note.paidPaise === 0 && can("billing.credit_note.approve") && <Button variant="ghost" onClick={() => setCancelling(true)}><Ban /> Cancel</Button>}
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <div className="overflow-hidden rounded-4xl border shadow-sm">
          <SalesDocView doc={note} fallbackSeller={{ name: me?.tenant?.name ?? "", gstin: me?.tenant?.gstin, stateCode: me?.tenant?.billingStateCode }} />
        </div>
        {(note.payments?.length ?? 0) > 0 && (
          <Card className="content-start">
            <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm">
                {note.payments!.map((pm) => {
                  const reversed = note.payments!.some((o) => o.reversesId === pm.id)
                  return (
                    <li key={pm.id} className="flex justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-mono text-xs">{pm.number}</span>
                        {reversed && <Badge variant="outline" className="ml-2">Reversed</Badge>}
                        <span className="block text-xs text-muted-foreground">{formatDate(pm.paidOn)} · {pm.reversesId ? "Reversal" : PAYMENT_METHODS.find((m) => m.value === pm.method)?.label}</span>
                      </span>
                      <span className="flex items-start gap-1">
                        <span className="font-medium tabular-nums">{formatPaise(pm.amountPaise)}</span>
                        {!pm.reversesId && !reversed && can("billing.payment.approve") && <Button variant="ghost" size="icon-xs" aria-label={`Reverse ${pm.number}`} onClick={() => setReversing(pm)}><Undo2 /></Button>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
      {paying && <DebitPaymentDialog note={note} onClose={() => setPaying(false)} onSaved={(d) => { setPaying(false); setData(d) }} />}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        destructive
        title={`Cancel ${note.number}?`}
        description="The number stays used. The customer no longer owes this amount."
        reasonLabel="Reason for cancelling"
        confirmLabel="Cancel debit note"
        onConfirm={async (reason) => {
          try {
            setData(await api.post<SalesDoc>(`/debit-notes/${id}/cancel`, { reason }))
            toast.success("Debit note cancelled")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        destructive
        title={`Reverse ${reversing?.number}?`}
        description="An opposite entry is added and the amount is due again. The original stays on record."
        confirmLabel="Reverse payment"
        onConfirm={async () => {
          try {
            const { invoice } = await api.post<{ invoice: SalesDoc }>(`/payments/${reversing!.id}/reverse`)
            setData(invoice)
            toast.success("Payment reversed")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
