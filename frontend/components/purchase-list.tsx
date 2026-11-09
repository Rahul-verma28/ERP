"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { ShoppingCart } from "lucide-react"
import { EmptyState, StatusBadge } from "@/components/common"
import { DataList, HeaderLink, periodFilter, type Column, type ViewPreset } from "@/components/data-list"
import { PageHeader } from "@/components/app-shell"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { KIND_PLURAL, invoiceStatus, returnStatus, type PurchaseDoc, type PurchaseKind } from "@/lib/purchase"

// One list for orders, goods receipts, bills and returns. Each kind has its own presets.

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

function List({ kind }: { kind: PurchaseKind }) {
  const { can, me } = useAuth()
  const params = useSearchParams()
  if (!can(VIEW[kind])) return <PageHeader title={KIND_PLURAL[kind]} description="You don't have access to this. Ask your admin." />
  const bill = kind === "purchase_bill"
  const isReturn = kind === "purchase_return"
  const statusLabel = (s: string) => (bill ? invoiceStatus(s) : isReturn ? returnStatus(s) : undefined)
  const columns: Column<PurchaseDoc>[] = [
    { key: "number", header: "Number", hideable: false, cell: (r) => <span className="font-mono font-medium">{r.number}</span>, csv: (r) => r.number, sort: (r) => r.number },
    { key: "date", header: "Date", cell: (r) => formatDate(r.issueDate), csv: (r) => r.issueDate.slice(0, 10), sort: (r) => r.issueDate },
    { key: "supplier", header: "Supplier", cell: (r) => <span className="font-medium">{r.supplier.name}{r.supplier.gstin && <span className="block font-mono text-xs font-normal text-muted-foreground">{r.supplier.gstin}</span>}</span>, csv: (r) => r.supplier.name, sort: (r) => r.supplier.name },
    ...(kind !== "purchase_order" && kind !== "purchase_return" ? [{ key: "ref", header: kind === "goods_receipt" ? "Challan no." : "Supplier bill", cell: (r: PurchaseDoc) => (r.supplierRef ? <span>{r.supplierRef}{r.supplierDate && <span className="block text-xs text-muted-foreground">{formatDate(r.supplierDate)}</span>}</span> : "—"), csv: (r: PurchaseDoc) => r.supplierRef ?? "" }] : []),
    ...(isReturn ? [
      { key: "godown", header: "Godown", cell: (r: PurchaseDoc) => r.location?.name ?? "—", csv: (r: PurchaseDoc) => r.location?.name ?? "" },
      { key: "items", header: "Items", cell: (r: PurchaseDoc) => <span className="text-xs">{r.lines.map((l) => `${l.description} ×${Number(l.quantity)}`).join(", ")}</span>, csv: (r: PurchaseDoc) => r.lines.map((l) => `${l.description} x${Number(l.quantity)}`).join("; ") },
    ] : []),
    ...(kind !== "purchase_order" ? [{ key: "from", header: isReturn ? "Invoice" : "From", defaultHidden: kind === "purchase_bill", cell: (r: PurchaseDoc) => <span className="font-mono text-xs">{r.sourceNumber ?? "—"}</span>, csv: (r: PurchaseDoc) => r.sourceNumber ?? "" }] : []),
    ...(kind === "purchase_order" ? [{ key: "due", header: "Expected", cell: (r: PurchaseDoc) => (r.dueDate ? formatDate(r.dueDate) : "—"), csv: (r: PurchaseDoc) => r.dueDate?.slice(0, 10) ?? "" }] : []),
    ...(bill ? [{ key: "due", header: "Due date", cell: (r: PurchaseDoc) => (r.dueDate ? <span className={r.overdue ? "font-medium text-destructive" : ""}>{formatDate(r.dueDate)}{r.overdue && <span className="block text-xs">Overdue</span>}</span> : "—"), csv: (r: PurchaseDoc) => r.dueDate?.slice(0, 10) ?? "" }] : []),
    { key: "status", header: "Status", cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status} label={statusLabel(r.status)} />{r.reverseCharge && <span className="text-xs text-muted-foreground">RCM</span>}</span>, csv: (r) => statusLabel(r.status) ?? r.status },
    ...(bill ? [
      { key: "subtotal", header: "Subtotal", align: "right" as const, cell: (r: PurchaseDoc) => <span className="tabular-nums">{formatPaise(r.taxablePaise)}</span>, csv: (r: PurchaseDoc) => r.taxablePaise / 100, sort: (r: PurchaseDoc) => r.taxablePaise },
      { key: "tax", header: "Tax", align: "right" as const, cell: (r: PurchaseDoc) => <span className="tabular-nums">{formatPaise(r.cgstPaise + r.sgstPaise + r.igstPaise)}</span>, csv: (r: PurchaseDoc) => (r.cgstPaise + r.sgstPaise + r.igstPaise) / 100 },
    ] : []),
    { key: "total", header: "Total", align: "right", cell: (r) => <span className="tabular-nums">{formatPaise(r.totalPaise)}</span>, csv: (r) => r.totalPaise / 100, sort: (r) => r.totalPaise },
    ...(bill ? [{ key: "balance", header: "Balance", align: "right" as const, cell: (r: PurchaseDoc) => <span className="font-medium tabular-nums">{r.balancePaise > 0 ? formatPaise(r.balancePaise) : "—"}</span>, csv: (r: PurchaseDoc) => r.balancePaise / 100, sort: (r: PurchaseDoc) => r.balancePaise }] : []),
  ]
  const newHref = `/app/m/purchase/new?kind=${kind}`
  return (
    <DataList<PurchaseDoc>
      id={`purchase-${kind}`}
      path="/purchases"
      params={{ kind }}
      header={{
        breadcrumb: `Purchase › ${KIND_PLURAL[kind]}`,
        title: KIND_PLURAL[kind],
        description: kind === "purchase_return" ? "Goods sent back to a supplier. Make one from the invoice." : undefined,
        primary: can(CREATE[kind]) ? <HeaderLink href={newHref} primary>{kind === "purchase_order" ? "New order" : kind === "goods_receipt" ? "Receive goods" : isReturn ? "Create return" : "Create invoice"}</HeaderLink> : undefined,
      }}
      columns={columns}
      searchPlaceholder="Search number, supplier or bill no."
      presets={PRESETS[kind]}
      defaultPreset={params.get("status") ?? undefined}
      filters={[periodFilter(me?.tenant?.fyStartMonth ?? 4)]}
      rowHref={(r) => `/app/m/purchase/${r.id}`}
      exportName={kind.replace("_", "-")}
      emptyState={
        <EmptyState
          icon={ShoppingCart}
          title={`No ${KIND_PLURAL[kind].toLowerCase()} yet`}
          description={kind === "purchase_bill" ? "Enter each supplier invoice here. When you post it, stock comes in and you see what you owe." : kind === "purchase_order" ? "Send suppliers an order, then receive the goods against it." : kind === "goods_receipt" ? "Record goods as they arrive, before the bill comes." : "Choose the invoice, then what goes back."}
          action={can(CREATE[kind]) ? <HeaderLink href={newHref} primary>{kind === "purchase_order" ? "New order" : kind === "goods_receipt" ? "Receive goods" : isReturn ? "Create return" : "Create invoice"}</HeaderLink> : undefined}
        />
      }
    />
  )
}

export function PurchaseList({ kind }: { kind: PurchaseKind }) {
  return (
    <React.Suspense>
      <List kind={kind} />
    </React.Suspense>
  )
}
