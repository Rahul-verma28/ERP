"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { CalendarDays, Check, CheckCheck, Eye, Pencil, Plus, Printer, Send, ShoppingCart, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog, EmptyState, StatusBadge } from "@/components/common"
import { DataList, HeaderLink, periodFilter, type Column, type ViewPreset } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise, initials } from "@/lib/format"
import { KIND_PLURAL, invoiceStatus, returnStatus, type PurchaseDoc, type PurchaseKind } from "@/lib/purchase"
import { cn } from "@/lib/utils"

// One list for invoices, returns, orders and goods receipts. What each row can do depends on its status.

const VIEW: Record<PurchaseKind, string> = {
  purchase_order: "inventory.purchase_order.view",
  goods_receipt: "inventory.receipt.view",
  purchase_bill: "inventory.supplier_bill.view",
  purchase_return: "inventory.supplier_bill.view",
}
const CREATE: Record<PurchaseKind, string> = {
  purchase_order: "inventory.purchase_order.create",
  goods_receipt: "inventory.receipt.create",
  purchase_bill: "inventory.supplier_bill.create",
  purchase_return: "inventory.supplier_bill.create",
}
const PRESETS: Record<PurchaseKind, ViewPreset[]> = {
  purchase_order: [
    { key: "all", label: "All", params: {} },
    { key: "pending", label: "To receive", params: { status: "pending" } },
    { key: "received", label: "Received", params: { status: "received" } },
    { key: "closed", label: "Closed", params: { status: "closed" } },
  ],
  goods_receipt: [
    { key: "all", label: "All", params: {} },
    { key: "received", label: "Not billed", params: { status: "received" } },
    { key: "billed", label: "Billed", params: { status: "billed" } },
  ],
  purchase_bill: [
    { key: "all", label: "All", params: {} },
    { key: "draft", label: "Draft", params: { status: "draft" } },
    { key: "unpaid", label: "Posted", params: { status: "unpaid" } },
    { key: "part_paid", label: "Partial", params: { status: "part_paid" } },
    { key: "overdue", label: "Overdue", params: { status: "overdue" } },
    { key: "paid", label: "Paid", params: { status: "paid" } },
  ],
  purchase_return: [
    { key: "all", label: "All", params: {} },
    { key: "draft", label: "Draft", params: { status: "draft" } },
    { key: "approved", label: "Approved", params: { status: "approved" } },
    { key: "issued", label: "Completed", params: { status: "issued" } },
  ],
}
const NEW_LABEL: Record<PurchaseKind, string> = { purchase_order: "New order", goods_receipt: "Receive goods", purchase_bill: "Create invoice", purchase_return: "Create return" }
const EMPTY_TEXT: Record<PurchaseKind, string> = {
  purchase_bill: "Enter each supplier invoice here. When you post it, stock comes in and you see what you owe.",
  purchase_order: "Send suppliers an order, then receive the goods against it.",
  goods_receipt: "Record goods as they arrive, before the invoice comes.",
  purchase_return: "Choose the invoice, then what goes back.",
}

const iconLink = buttonVariants({ variant: "ghost", size: "icon-sm" })
const dated = (iso: string) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />{formatDate(iso)}</span>

function List({ kind }: { kind: PurchaseKind }) {
  const { can, me } = useAuth()
  const params = useSearchParams()
  const [version, setVersion] = React.useState(0)
  const [deleting, setDeleting] = React.useState<PurchaseDoc | null>(null)
  if (!can(VIEW[kind])) return <PageHeader title={KIND_PLURAL[kind]} description="You don't have access to this. Ask your admin." />
  const bill = kind === "purchase_bill"
  const isReturn = kind === "purchase_return"
  const statusLabel = (s: string) => (bill ? invoiceStatus(s) : isReturn ? returnStatus(s) : undefined)
  const canWrite = can("inventory.supplier_bill.create")
  const act = async (path: string, r: PurchaseDoc, done: string) => {
    try {
      await api.post(`/purchases/${r.id}/${path}`, { version: r.version })
      toast.success(done)
      setVersion((v) => v + 1)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const columns: Column<PurchaseDoc>[] = [
    { key: "number", header: bill ? "Invoice Number" : isReturn ? "Return Number" : "Number", hideable: false, sort: (r) => r.number, csv: (r) => r.number, cell: (r) => <span className="inline-flex rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.number}</span> },
    {
      key: "supplier", header: "Supplier", sort: (r) => r.supplier.name, csv: (r) => r.supplier.name,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(r.supplier.name)}</span>
          <span className="min-w-0"><span className="block font-medium">{r.supplier.name}</span>{r.supplier.gstin && <span className="block font-mono text-xs text-muted-foreground">{r.supplier.gstin}</span>}</span>
        </span>
      ),
    },
    ...(isReturn ? [{ key: "warehouse", header: "Warehouse", csv: (r: PurchaseDoc) => r.location?.name ?? "", cell: (r: PurchaseDoc) => (r.location ? <Badge variant="outline">{r.location.name}</Badge> : "—") }] : []),
    { key: "date", header: bill ? "Invoice Date" : isReturn ? "Return Date" : "Date", sort: (r) => r.issueDate, csv: (r) => r.issueDate.slice(0, 10), cell: (r) => dated(r.issueDate) },
    ...(kind !== "purchase_return" && kind !== "purchase_order" ? [{ key: "ref", header: bill ? "Supplier Invoice" : "Challan no.", defaultHidden: bill, csv: (r: PurchaseDoc) => r.supplierRef ?? "", cell: (r: PurchaseDoc) => r.supplierRef ?? "—" }] : []),
    ...(kind === "purchase_order" ? [{ key: "due", header: "Expected", csv: (r: PurchaseDoc) => r.dueDate?.slice(0, 10) ?? "", cell: (r: PurchaseDoc) => (r.dueDate ? dated(r.dueDate) : "—") }] : []),
    ...(bill ? [{ key: "due", header: "Due Date", sort: (r: PurchaseDoc) => r.dueDate ?? "", csv: (r: PurchaseDoc) => r.dueDate?.slice(0, 10) ?? "", cell: (r: PurchaseDoc) => (r.dueDate ? <span className={r.overdue ? "text-destructive" : ""}>{dated(r.dueDate)}{r.overdue && <span className="block text-xs">Overdue</span>}</span> : "—") }] : []),
    ...(bill ? [
      { key: "subtotal", header: "Subtotal", sort: (r: PurchaseDoc) => r.taxablePaise, csv: (r: PurchaseDoc) => r.taxablePaise / 100, cell: (r: PurchaseDoc) => <span className="tabular-nums">{formatPaise(r.taxablePaise)}</span> },
      { key: "tax", header: "Tax", csv: (r: PurchaseDoc) => (r.cgstPaise + r.sgstPaise + r.igstPaise) / 100, cell: (r: PurchaseDoc) => <span className="tabular-nums">{formatPaise(r.cgstPaise + r.sgstPaise + r.igstPaise)}</span> },
    ] : []),
    { key: "total", header: bill ? "Total Amount" : "Total", sort: (r) => r.totalPaise, csv: (r) => r.totalPaise / 100, cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.totalPaise)}</span> },
    ...(bill ? [{ key: "balance", header: "Balance", sort: (r: PurchaseDoc) => r.balancePaise, csv: (r: PurchaseDoc) => r.balancePaise / 100, cell: (r: PurchaseDoc) => <span className={cn("font-medium tabular-nums", r.status === "paid" ? "text-emerald-700 dark:text-emerald-300" : "text-orange-600 dark:text-orange-300")}>{formatPaise(r.status === "draft" ? r.totalPaise : r.balancePaise)}</span> }] : []),
    ...(isReturn ? [{ key: "items", header: "Items", csv: (r: PurchaseDoc) => r.lines.map((l) => `${l.description} x${Number(l.quantity)}`).join("; "), cell: (r: PurchaseDoc) => <span className="grid gap-0.5 text-[13px]">{r.lines.map((l, i) => <span key={i} className="flex justify-between gap-4"><span>{l.description}</span><span className="text-muted-foreground tabular-nums">×{Number(l.quantity)}</span></span>)}</span> }] : []),
    { key: "status", header: "Status", csv: (r) => statusLabel(r.status) ?? r.status, cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status} label={statusLabel(r.status)} />{r.reverseCharge && <span className="text-xs text-muted-foreground">RCM</span>}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {isReturn && r.status === "draft" && can("inventory.supplier_bill.approve") && <Button variant="ghost" size="icon-sm" title="Approve" aria-label={`Approve ${r.number}`} onClick={() => act("approve", r, "Return approved")}><Check /></Button>}
          {isReturn && r.status === "approved" && canWrite && <Button variant="ghost" size="icon-sm" title="Complete" aria-label={`Complete ${r.number}`} onClick={() => act("complete", r, "Return completed. Stock has gone out.")}><CheckCheck /></Button>}
          <Link href={`/app/m/purchase/${r.id}`} className={iconLink} title="View" aria-label={`View ${r.number}`}><Eye /></Link>
          <a href={`/print/purchase/${r.id}`} target="_blank" rel="noreferrer" className={iconLink} title="Print or PDF" aria-label={`Print ${r.number}`}><Printer /></a>
          {bill && r.status === "draft" && canWrite && <Button variant="ghost" size="icon-sm" title="Post" aria-label={`Post ${r.number}`} onClick={() => act("post", r, "Invoice posted. Stock is in.")}><Send /></Button>}
          {(bill || isReturn) && r.status === "draft" && canWrite && <Link href={`/app/m/purchase/new?kind=${kind}&edit=${r.id}`} className={iconLink} title="Edit" aria-label={`Edit ${r.number}`}><Pencil /></Link>}
          {(bill || isReturn) && r.status === "draft" && canWrite && <Button variant="ghost" size="icon-sm" className="text-destructive" title="Delete" aria-label={`Delete ${r.number}`} onClick={() => setDeleting(r)}><Trash2 /></Button>}
        </span>
      ),
    },
  ]
  // Businesses that order first reach these from here, so the menu stays short
  const more = me?.tenant?.purchaseOrders
    ? [
        ...(can(VIEW.purchase_order) && kind !== "purchase_order" ? [{ label: "Purchase Orders", href: "/app/m/purchase/orders" }] : []),
        ...(can(VIEW.goods_receipt) && kind !== "goods_receipt" ? [{ label: "Goods Receipts", href: "/app/m/purchase/grn" }] : []),
        ...(can(VIEW.purchase_order) ? [{ label: "Low Stock", href: "/app/m/purchase/reorder" }] : []),
        ...(kind !== "purchase_bill" ? [{ label: "Purchase Invoices", href: "/app/m/purchase" }] : []),
      ]
    : undefined
  const create = can(CREATE[kind]) ? <HeaderLink href={`/app/m/purchase/new?kind=${kind}`} primary><Plus /> {NEW_LABEL[kind]}</HeaderLink> : undefined
  return (
    <>
      <DataList<PurchaseDoc>
        id={`purchase-${kind}`}
        path="/purchases"
        params={{ kind, v: String(version) }}
        header={{ title: `Manage ${KIND_PLURAL[kind]}`, primary: create, more }}
        columns={columns}
        searchPlaceholder="Search number, supplier or bill no."
        presets={PRESETS[kind]}
        defaultPreset={params.get("status") ?? undefined}
        filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4)]}
        rowHref={(r) => `/app/m/purchase/${r.id}`}
        exportName={kind.replace("_", "-")}
        emptyState={<EmptyState icon={ShoppingCart} title={`No ${KIND_PLURAL[kind].toLowerCase()} yet`} description={EMPTY_TEXT[kind]} action={create} />}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete draft ${deleting?.number ?? ""}?`}
        description="This draft is removed for good. Nothing else changes."
        confirmLabel="Delete draft"
        destructive
        onConfirm={async () => {
          try { await api.delete(`/purchases/${deleting!.id}`); toast.success("Draft deleted"); setDeleting(null); setVersion((v) => v + 1) } catch (e) { toast.error(errorMessage(e)); throw e }
        }}
      />
    </>
  )
}

export function PurchaseList({ kind }: { kind: PurchaseKind }) {
  return (
    <React.Suspense>
      <List kind={kind} />
    </React.Suspense>
  )
}
