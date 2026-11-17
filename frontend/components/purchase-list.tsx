"use client"

import { ActionMenu } from "@/components/page-parts"
import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { AlarmClock, Building2, CalendarDays, Check, CheckCheck, CircleDashed, Eye, FileText, IndianRupee, PackageCheck, Pencil, Plus, Printer, Send, ShoppingCart, Trash2, Undo2, Wallet } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog, EmptyState, StatusBadge } from "@/components/common"
import { DataList, HeaderLink, periodFilter, type Column, type ViewPreset } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { SummaryCards, type SummaryCard } from "@/components/summary-cards"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise, initials } from "@/lib/format"
import { KIND_PLURAL, invoiceStatus, returnStatus, type PurchaseDoc, type PurchaseKind } from "@/lib/purchase"
import { cn } from "@/lib/utils"

// One list for invoices, returns, orders and goods receipts. One request brings the rows, the
// counts on the tabs and the totals on the cards. What each row can do depends on its status.

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
const tab = (key: string, label: string, params: Record<string, string> = {}): ViewPreset => ({ key, label, params, countKey: key })
const PRESETS: Record<PurchaseKind, ViewPreset[]> = {
  purchase_order: [tab("all", "All"), tab("pending", "To receive", { status: "pending" }), tab("received", "Received", { status: "received" }), tab("closed", "Closed", { status: "closed" }), tab("cancelled", "Cancelled", { status: "cancelled" })],
  goods_receipt: [tab("all", "All"), tab("received", "Not billed", { status: "received" }), tab("billed", "Billed", { status: "billed" }), tab("cancelled", "Cancelled", { status: "cancelled" })],
  purchase_bill: [tab("all", "All"), tab("draft", "Draft", { status: "draft" }), tab("unpaid", "Posted", { status: "unpaid" }), tab("part_paid", "Partial", { status: "part_paid" }), tab("overdue", "Overdue", { status: "overdue" }), tab("paid", "Paid", { status: "paid" }), tab("cancelled", "Cancelled", { status: "cancelled" })],
  purchase_return: [tab("all", "All"), tab("draft", "Draft", { status: "draft" }), tab("approved", "Approved", { status: "approved" }), tab("issued", "Completed", { status: "issued" }), tab("cancelled", "Cancelled", { status: "cancelled" })],
}
const NEW_LABEL: Record<PurchaseKind, string> = { purchase_order: "New order", goods_receipt: "Receive goods", purchase_bill: "Create invoice", purchase_return: "Create return" }
const EMPTY_TEXT: Record<PurchaseKind, string> = {
  purchase_bill: "Enter each supplier invoice here. When you post it, stock comes in and you see what you owe.",
  purchase_order: "Send suppliers an order, then receive the goods against it.",
  goods_receipt: "Record goods as they arrive, before the invoice comes.",
  purchase_return: "Choose the invoice, then what goes back.",
}

type Totals = { counts?: Record<string, number>; sums?: Record<string, number> }

/** The cards over each list, from the same response as the rows */
function cards(kind: PurchaseKind, r: Totals): SummaryCard[] {
  const c = r.counts ?? {}
  const s = r.sums ?? {}
  const n = (k: string) => c[k] ?? 0
  const m = (k: string) => formatPaise(s[k] ?? 0)
  if (kind === "purchase_bill") return [
    { label: "Total billed", value: m("all"), hint: `${n("all") - n("draft") - n("cancelled")} posted invoices`, color: "blue", icon: FileText },
    { label: "This month", value: m("month"), hint: "Posted this month", color: "violet", icon: CalendarDays },
    { label: "Paid", value: m("paid"), hint: `${n("paid")} fully paid`, color: "emerald", icon: Wallet },
    { label: "To pay", value: m("balance"), hint: `${n("unpaid") + n("part_paid")} invoices open`, color: "amber", icon: IndianRupee },
    { label: "Overdue", value: m("overdue"), hint: `${n("overdue")} past due date`, color: "rose", icon: AlarmClock },
  ]
  if (kind === "purchase_return") return [
    { label: "All returns", value: n("all"), hint: `${m("all")} completed and approved`, color: "blue", icon: Undo2 },
    { label: "Draft", value: n("draft"), hint: m("draft"), color: "slate", icon: CircleDashed },
    { label: "Approved", value: n("approved"), hint: `${m("approved")} · waiting to go out`, color: "amber", icon: Check },
    { label: "Completed", value: n("issued"), hint: `${m("issued")} gone back`, color: "emerald", icon: CheckCheck },
  ]
  if (kind === "purchase_order") return [
    { label: "All orders", value: n("all"), hint: m("all"), color: "blue", icon: ShoppingCart },
    { label: "To receive", value: n("pending"), hint: `${m("open")} open`, color: "amber", icon: AlarmClock },
    { label: "Received", value: n("received"), hint: m("received"), color: "emerald", icon: PackageCheck },
    { label: "Closed", value: n("closed"), hint: m("closed"), color: "slate", icon: CheckCheck },
  ]
  return [
    { label: "All receipts", value: n("all"), hint: m("all"), color: "blue", icon: PackageCheck },
    { label: "Not billed", value: n("received"), hint: `${m("received")} waiting for the invoice`, color: "amber", icon: AlarmClock },
    { label: "Billed", value: n("billed"), hint: m("billed"), color: "emerald", icon: FileText },
    { label: "Cancelled", value: n("cancelled"), color: "slate", icon: CircleDashed },
  ]
}

const iconLink = buttonVariants({ variant: "ghost", size: "icon-sm" })
const dated = (iso: string) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />{formatDate(iso)}</span>
const money = (p: number, cls?: string) => <span className={cn("tabular-nums", cls)}>{formatPaise(p)}</span>
const itemsText = (r: PurchaseDoc) => r.lines.map((l) => `${l.description} ×${Number(l.quantity)}`).join("; ")

function List({ kind }: { kind: PurchaseKind }) {
  const { can, me } = useAuth()
  const params = useSearchParams()
  const [version, setVersion] = React.useState(0)
  const [deleting, setDeleting] = React.useState<PurchaseDoc | null>(null)
  if (!can(VIEW[kind])) return <PageHeader title={KIND_PLURAL[kind]} description="You don't have access to this. Ask your admin." />
  const bill = kind === "purchase_bill"
  const isReturn = kind === "purchase_return"
  const order = kind === "purchase_order"
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
  const col = (on: boolean, c: Column<PurchaseDoc>) => (on ? [c] : [])

  const columns: Column<PurchaseDoc>[] = [
    {
      key: "number", header: bill ? "Invoice Number" : isReturn ? "Return Number" : order ? "Order Number" : "Receipt Number", hideable: false, sort: (r) => r.number, csv: (r) => r.number,
      cell: (r) => (
        <span className="grid justify-items-start gap-1">
          <span className="inline-flex rounded-lg border px-2 py-0.5 font-mono text-xs font-medium text-primary">{r.number}</span>
          {bill && r.supplierRef && <span className="text-[11px] text-muted-foreground">Their no. {r.supplierRef}</span>}
          {!bill && r.sourceNumber && <span className="text-[11px] text-muted-foreground">{isReturn ? "Against" : "From"} {r.sourceNumber}</span>}
        </span>
      ),
    },
    {
      key: "supplier", header: "Supplier", sort: (r) => r.supplier.name, csv: (r) => r.supplier.name,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(r.supplier.name)}</span>
          <span className="min-w-0"><span className="block font-medium">{r.supplier.name}</span><span className="block truncate text-xs text-muted-foreground">{r.supplier.email || r.supplier.gstin || r.supplier.phone || "—"}</span></span>
        </span>
      ),
    },
    ...col(bill, { key: "gstin", header: "GSTIN", defaultHidden: true, csv: (r) => r.supplier.gstin ?? "", cell: (r) => (r.supplier.gstin ? <span className="font-mono text-xs">{r.supplier.gstin}</span> : <span className="text-muted-foreground">Not registered</span>) }),
    { key: "warehouse", header: "Warehouse", defaultHidden: order, csv: (r) => r.location?.name ?? "", cell: (r) => (r.location ? <Badge variant="outline" className="whitespace-nowrap">{r.location.name}</Badge> : <span className="text-muted-foreground">—</span>) },
    { key: "date", header: bill ? "Invoice Date" : isReturn ? "Return Date" : "Date", sort: (r) => r.issueDate, csv: (r) => r.issueDate.slice(0, 10), cell: (r) => dated(r.supplierDate ?? r.issueDate) },
    ...col(order, { key: "due", header: "Expected", csv: (r) => r.dueDate?.slice(0, 10) ?? "", cell: (r) => (r.dueDate ? dated(r.dueDate) : "—") }),
    ...col(bill, {
      key: "due", header: "Due Date", sort: (r) => r.dueDate ?? "", csv: (r) => r.dueDate?.slice(0, 10) ?? "",
      cell: (r) => (r.dueDate ? <span className={r.overdue ? "text-destructive" : ""}>{dated(r.dueDate)}{r.overdue && <span className="block text-xs font-medium">Overdue · {r.overdueDays} day{r.overdueDays === 1 ? "" : "s"}</span>}</span> : "—"),
    }),
    ...col(!bill && !isReturn && !order, { key: "ref", header: "Challan no.", csv: (r) => r.supplierRef ?? "", cell: (r) => r.supplierRef ?? "—" }),
    ...col(isReturn, { key: "reason", header: "Reason", csv: (r) => r.returnReason ?? "", cell: (r) => (r.returnReason ? <Badge variant="outline">{r.returnReason}</Badge> : "—") }),
    {
      key: "items", header: "Items", defaultHidden: bill, csv: itemsText,
      cell: (r) => isReturn || r.lines.length <= 2
        ? <span className="grid gap-0.5 text-[13px]">{r.lines.map((l, i) => <span key={i} className="flex justify-between gap-4"><span className="max-w-56 truncate">{l.description}</span><span className="text-muted-foreground tabular-nums">×{Number(l.quantity)}</span></span>)}</span>
        : <span title={itemsText(r)} className="text-[13px]">{r.lines[0]?.description} <span className="text-muted-foreground">+{r.lines.length - 1} more</span></span>,
    },
    ...col(bill, { key: "subtotal", header: "Subtotal", align: "right", sort: (r) => r.taxablePaise, csv: (r) => r.taxablePaise / 100, cell: (r) => money(r.taxablePaise) }),
    ...col(bill, { key: "tax", header: "Tax", align: "right", csv: (r) => (r.taxPaise ?? 0) / 100, cell: (r) => <span className="tabular-nums">{formatPaise(r.taxPaise ?? 0)}{r.reverseCharge && <span className="block text-[11px] text-muted-foreground">RCM</span>}</span> }),
    { key: "total", header: bill ? "Total Amount" : "Total", align: "right", sort: (r) => r.totalPaise, csv: (r) => r.totalPaise / 100, cell: (r) => money(r.totalPaise, "font-semibold") },
    ...col(bill, { key: "paid", header: "Paid", align: "right", defaultHidden: true, sort: (r) => r.paidPaise, csv: (r) => r.paidPaise / 100, cell: (r) => money(r.paidPaise, "text-emerald-700 dark:text-emerald-300") }),
    ...col(bill, {
      key: "balance", header: "Balance", align: "right", sort: (r) => r.balancePaise, csv: (r) => r.balancePaise / 100,
      cell: (r) => {
        const owed = r.status === "draft" ? r.totalPaise : r.balancePaise
        const pct = r.totalPaise ? Math.min(100, Math.round(((r.paidPaise + r.returnedPaise) / r.totalPaise) * 100)) : 0
        return (
          <span className="grid min-w-24 justify-items-end gap-1">
            <span className={cn("font-medium tabular-nums", owed <= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-orange-600 dark:text-orange-300")}>{formatPaise(owed)}</span>
            {r.status !== "draft" && r.status !== "cancelled" && <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" title={`${pct}% paid`}><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></span>}
          </span>
        )
      },
    }),
    ...col(bill, { key: "lastPaid", header: "Last paid", defaultHidden: true, csv: (r) => r.lastPaidOn?.slice(0, 10) ?? "", cell: (r) => (r.lastPaidOn ? <span className="text-sm">{formatDate(r.lastPaidOn)}<span className="block text-[11px] text-muted-foreground">{r.paymentCount} payment{r.paymentCount === 1 ? "" : "s"}</span></span> : <span className="text-muted-foreground">Not yet</span>) }),
    { key: "status", header: "Status", csv: (r) => statusLabel(r.status) ?? r.status, cell: (r) => <StatusBadge status={r.status} label={statusLabel(r.status)} /> },
    { key: "createdBy", header: "Created by", defaultHidden: true, csv: (r) => r.createdByName ?? "", cell: (r) => <span className="text-sm">{r.createdByName ?? "—"}<span className="block text-[11px] text-muted-foreground">{formatDate(r.createdAt)}</span></span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {isReturn && r.status === "draft" && can("inventory.supplier_bill.approve") && <Button variant="ghost" size="icon-sm" className="text-emerald-700 dark:text-emerald-300" title="Approve" aria-label={`Approve ${r.number}`} onClick={() => act("approve", r, "Return approved")}><Check /></Button>}
          {isReturn && r.status === "approved" && canWrite && <Button variant="ghost" size="icon-sm" className="text-emerald-700 dark:text-emerald-300" title="Complete" aria-label={`Complete ${r.number}`} onClick={() => act("complete", r, "Return completed. Stock has gone out.")}><CheckCheck /></Button>}
          {bill && r.status === "draft" && canWrite && <Button variant="ghost" size="icon-sm" className="text-blue-700 dark:text-blue-300" title="Post" aria-label={`Post ${r.number}`} onClick={() => act("post", r, "Invoice posted. Stock is in.")}><Send /></Button>}
          {bill && ["unpaid", "part_paid"].includes(r.status) && canWrite && <Link href={`/app/m/purchase/payments?new=1&supplier=${r.contactId}`} className={cn(iconLink, "text-emerald-700 dark:text-emerald-300")} title="Pay supplier" aria-label={`Pay ${r.number}`}><IndianRupee /></Link>}
          <Link href={`/app/m/purchase/${r.id}`} className={iconLink} title="View" aria-label={`View ${r.number}`}><Eye /></Link>
          <a href={`/print/purchase/${r.id}`} target="_blank" rel="noreferrer" className={iconLink} title="Print or PDF" aria-label={`Print ${r.number}`}><Printer /></a>
          {(bill || isReturn) && r.status === "draft" && canWrite && <Link href={`/app/m/purchase/new?kind=${kind}&edit=${r.id}`} className={iconLink} title="Edit" aria-label={`Edit ${r.number}`}><Pencil /></Link>}
          <ActionMenu label={`More actions for ${r.number}`} items={[
            bill && ["unpaid", "part_paid", "paid"].includes(r.status) && canWrite && { label: "Return goods", icon: Undo2, href: `/app/m/purchase/new?kind=purchase_return&from=${r.id}` },
            { label: "Open supplier", icon: Building2, href: `/app/m/purchase/suppliers/${r.contactId}` },
            "-",
            (bill || isReturn) && r.status === "draft" && canWrite && { label: "Delete draft", icon: Trash2, destructive: true, onClick: () => setDeleting(r) },
          ]} />
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
        searchPlaceholder={bill ? "Search invoice no., their no., supplier or GSTIN" : "Search number, supplier or invoice no."}
        presets={PRESETS[kind]}
        tabs
        top={(r) => <SummaryCards items={cards(kind, r as Totals)} />}
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
