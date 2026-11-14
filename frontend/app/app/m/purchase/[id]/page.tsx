"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { Ban, Building2, Check, FileText, IndianRupee, MapPin, Package, Pencil, Printer, Trash2, Undo2 } from "lucide-react"
import { todayInIndia } from "@contracts/validation"
import { ActionMenu, BackLink, DetailHeader, Pill, StatGrid, Steps, type Step } from "@/components/page-parts"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, StatusBadge } from "@/components/common"
import { PaySupplierDialog } from "@/components/pay-supplier"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { qty } from "@/lib/inventory"
import { INVOICE_STEPS, KIND_LABEL, KIND_PATH, KIND_PLURAL, RETURN_STEPS, invoiceStatus, returnStatus, type PurchaseDoc } from "@/lib/purchase"
import { PageLoading } from "@/components/page-states"

// A purchase document with what happened since: received or billed quantities, documents made
// from it, payments. The next step is one button away: receive, bill, return, pay.

const where = (a?: Record<string, string> | null) => (a ? [a.line1, a.line2, a.city, a.pincode ?? a.pin].filter(Boolean).join(", ") : "")

export default function PurchaseDocPage() {
  const { id } = useParams<{ id: string }>()
  const { can, me } = useAuth()
  const res = useApi<PurchaseDoc>(`/purchases/${id}`)
  const doc = res.data
  const setDoc = res.setData
  const [paying, setPaying] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const router = useRouter()
  if (res.error) return <PageHeader title="Not found" description={errorMessage(res.error)} />
  if (!doc) return <PageLoading />

  const draft = doc.status === "draft"
  const live = doc.status !== "cancelled" && !draft
  const left = doc.lines.some((l) => l.quantity - l.doneQuantity > 0)
  const isOrder = doc.kind === "purchase_order"
  const isBill = doc.kind === "purchase_bill"
  const isReturn = doc.kind === "purchase_return"
  const steps = isBill ? INVOICE_STEPS : isReturn ? RETURN_STEPS : null
  const label = (kind: string, status: string) => (kind === "purchase_bill" ? invoiceStatus(status) : kind === "purchase_return" ? returnStatus(status) : undefined)
  const doneLabel = isOrder ? "Received" : doc.kind === "goods_receipt" ? "Billed" : isBill ? "Returned" : null
  const act = async (fn: () => Promise<PurchaseDoc>, msg: string) => {
    try { setDoc(await fn()); toast.success(msg) } catch (e) { toast.error(errorMessage(e)) }
  }
  const cancelPerm = { purchase_order: "inventory.purchase_order.delete", goods_receipt: "inventory.receipt.create", purchase_bill: "inventory.supplier_bill.approve", purchase_return: "inventory.supplier_bill.approve" }[doc.kind]
  const tax = doc.cgstPaise + doc.sgstPaise + doc.igstPaise
  const cardTitle = "flex items-center gap-2.5 border-b px-5 py-4 font-semibold"

  const today = todayInIndia()
  const late = isBill && live && doc.balancePaise > 0 && !!doc.dueDate && doc.dueDate.slice(0, 10) < today
  const statusText = label(doc.kind, doc.status) ?? doc.status.replace(/_/g, " ")
  const statusColor = doc.status === "cancelled" ? "slate" : draft ? "slate" : ["paid", "issued", "closed", "received"].includes(doc.status) ? "emerald" : ["part_paid", "part_received", "approved"].includes(doc.status) ? "amber" : late ? "rose" : "blue"
  const stepList: Step[] | null = steps
    ? steps.map(([key, text], i) => { const at = steps.findIndex(([k]) => k === doc.status); return { key, label: text, state: at < 0 ? "todo" : i < at ? "done" : i === at ? "current" : "todo", color: key === "paid" || key === "issued" ? "emerald" : key === "part_paid" || key === "approved" ? "amber" : key === "draft" ? "slate" : "blue" } })
    : null
  const editHref = (isBill || isReturn) && draft ? `/app/m/purchase/new?kind=${doc.kind}&edit=${doc.id}` : isOrder && doc.status === "open" ? `/app/m/purchase/new?kind=purchase_order&edit=${doc.id}` : null
  const canEdit = editHref && can(isOrder ? "inventory.purchase_order.edit" : "inventory.supplier_bill.create")
  const post = () => act(() => api.post(`/purchases/${doc.id}/post`, { version: doc.version }), "Invoice posted. Stock is in.")
  const approve = () => act(() => api.post(`/purchases/${doc.id}/approve`, { version: doc.version }), "Return approved")
  const complete = () => act(() => api.post(`/purchases/${doc.id}/complete`, { version: doc.version }), "Return completed. Stock has gone out.")

  const primary =
    isBill && draft && can("inventory.supplier_bill.create") ? <Button onClick={post}>Post invoice</Button>
    : isBill && live && doc.balancePaise > 0 && can("inventory.supplier_bill.create") ? <Button onClick={() => setPaying(true)}><IndianRupee /> Pay supplier</Button>
    : isReturn && draft && can("inventory.supplier_bill.approve") ? <Button onClick={approve}>Approve return</Button>
    : isReturn && doc.status === "approved" && can("inventory.supplier_bill.create") ? <Button onClick={complete}>Complete return</Button>
    : live && isOrder && left && doc.status !== "closed" && can("inventory.receipt.create") ? <Link href={`/app/m/purchase/new?kind=goods_receipt&from=${doc.id}`} className={buttonVariants()}>Receive goods</Link>
    : live && doc.kind === "goods_receipt" && left && can("inventory.supplier_bill.create") ? <Link href={`/app/m/purchase/new?kind=purchase_bill&from=${doc.id}`} className={buttonVariants()}>Make invoice</Link>
    : null

  return (
    <div className="grid gap-5">
      <BackLink href={KIND_PATH[doc.kind]}>{KIND_PLURAL[doc.kind]}</BackLink>
      <DetailHeader
        title={`${KIND_LABEL[doc.kind]} ${doc.number}`}
        icon={isReturn ? Undo2 : FileText}
        pills={<><Pill color={statusColor} dot strike={doc.status === "cancelled"}>{statusText}</Pill>{late && <Pill color="rose">Overdue</Pill>}</>}
        subtitle={<><Link href={`/app/m/purchase/suppliers/${doc.contactId}`} className="font-medium text-foreground hover:underline">{doc.supplier.name}</Link>{doc.supplierRef ? ` · their no. ${doc.supplierRef}` : ""} · {formatDate(doc.supplierDate ?? doc.issueDate)}{doc.location ? ` · ${doc.location.name}` : ""}</>}
        actions={<>
          <a href={`/print/purchase/${doc.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><Printer /> Print</a>
          {canEdit && <Link href={editHref!} className={buttonVariants({ variant: "outline" })}><Pencil /> Edit</Link>}
          {primary}
          <ActionMenu items={[
            live && isOrder && left && doc.status !== "closed" && can("inventory.supplier_bill.create") && { label: "Invoice directly", icon: FileText, href: `/app/m/purchase/new?kind=purchase_bill&from=${doc.id}` },
            live && isBill && left && can("inventory.supplier_bill.create") && { label: "Return goods", icon: Undo2, href: `/app/m/purchase/new?kind=purchase_return&from=${doc.id}` },
            isOrder && doc.status === "part_received" && can("inventory.purchase_order.edit") && { label: "Close order", icon: Check, onClick: () => void act(() => api.post(`/purchases/${doc.id}/close`), "Order closed") },
            { label: "Open supplier", icon: Building2, href: `/app/m/purchase/suppliers/${doc.contactId}` },
            "-",
            draft && can("inventory.supplier_bill.create") && { label: "Delete draft", icon: Trash2, destructive: true, onClick: () => setDeleting(true) },
            live && can(cancelPerm) && { label: `Cancel ${KIND_LABEL[doc.kind].toLowerCase()}`, icon: Ban, destructive: true, onClick: () => setCancelling(true) },
          ]} />
        </>}
      />
      {stepList && <Steps steps={stepList} label="Status" end={doc.status === "cancelled" ? <span className="flex h-11 items-center justify-center rounded-xl bg-muted px-3 font-semibold text-muted-foreground line-through">Cancelled</span> : undefined} />}
      <StatGrid items={isBill ? [
        { label: "Total", value: formatPaise(doc.totalPaise), hint: `${doc.lines.length} item${doc.lines.length === 1 ? "" : "s"}` },
        { label: "Paid", value: formatPaise(doc.paidPaise), accent: doc.paidPaise ? "text-emerald-700 dark:text-emerald-300" : undefined, hint: doc.returnedPaise ? `${formatPaise(doc.returnedPaise)} returned` : undefined },
        { label: "You owe", value: draft || doc.status === "cancelled" ? "—" : formatPaise(Math.max(0, doc.balancePaise)), accent: late ? "text-destructive" : doc.balancePaise > 0 && live ? "text-orange-600 dark:text-orange-300" : undefined },
        { label: "Due date", value: doc.dueDate ? formatDate(doc.dueDate) : "—", accent: late ? "text-destructive" : undefined, hint: late ? "Overdue" : undefined },
      ] : [
        { label: "Total", value: formatPaise(doc.totalPaise), hint: `${doc.lines.length} item${doc.lines.length === 1 ? "" : "s"}` },
        { label: "GST", value: formatPaise(tax) },
        { label: "Date", value: formatDate(doc.issueDate) },
        { label: "Warehouse", value: doc.location?.name ?? "—" },
      ]} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5">
          {draft && <p className="rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">{isReturn ? "This is a draft. Stock and the invoice balance change only when the return is completed." : "This is a draft. Stock and what you owe change only when you post it."}</p>}
          {isReturn && doc.status === "approved" && <p className="rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">Approved. Press Complete return once the goods have actually gone back to the supplier.</p>}
          {doc.status === "cancelled" && doc.cancelReason && <p className="rounded-2xl bg-muted px-3 py-2 text-sm">Cancelled: {doc.cancelReason}</p>}

          <section className="ui-surface overflow-hidden">
            <h2 className={cardTitle}><MapPin className="size-4 text-primary" aria-hidden /> Billing &amp; Addresses</h2>
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <div className="grid content-start gap-0.5 text-sm">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{isReturn ? "Returned to" : "Billed from"}</p>
                <Link href={`/app/m/purchase/suppliers/${doc.contactId}`} className="font-semibold hover:underline">{doc.supplier.name}</Link>
                {doc.supplier.gstin && <span className="font-mono text-xs">GSTIN {doc.supplier.gstin}</span>}
                {where(doc.supplier.address) && <span className="text-muted-foreground">{where(doc.supplier.address)}</span>}
                {doc.supplier.phone && <span className="text-muted-foreground">{doc.supplier.phone}</span>}
              </div>
              <div className="grid content-start gap-0.5 text-sm">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{isReturn ? "From" : "Billed to"}</p>
                <span className="font-semibold">{me?.tenant?.legalName || me?.tenant?.name}</span>
                {me?.tenant?.gstin && <span className="font-mono text-xs">GSTIN {me.tenant.gstin}</span>}
                {doc.location && <span className="text-muted-foreground">Warehouse: {doc.location.name}</span>}
              </div>
            </div>
          </section>

          <section className="ui-surface overflow-hidden">
            <h2 className={cardTitle}><Package className="size-4 text-primary" aria-hidden /> Items</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/50 text-left text-[13px]">
                  <tr><th className="py-3 pr-3 pl-5 font-semibold">Product</th><th className="px-3 text-right font-semibold">Qty</th>{doneLabel && <th className="px-3 text-right font-semibold">{doneLabel}</th>}<th className="px-3 text-right font-semibold">Unit price</th><th className="px-3 text-right font-semibold">Discount</th><th className="px-3 text-right font-semibold">GST</th><th className="pr-5 text-right font-semibold">Total</th></tr>
                </thead>
                <tbody>
                  {doc.lines.map((l) => (
                    <tr key={l.id} className="border-t align-top">
                      <td className="py-3 pr-3 pl-5">
                        <span className="font-medium">{l.description}</span>
                        <span className="block text-xs text-muted-foreground">{[l.hsnSac && `HSN ${l.hsnSac}`, l.batchNo && `Batch ${l.batchNo}`, l.expiryDate && `Exp ${formatDate(l.expiryDate)}`, l.serials.length ? `S/N ${l.serials.join(", ")}` : null, l.landedPaise ? `+ ${formatPaise(l.landedPaise)} landed cost` : null].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{qty(l.quantity)} {l.unit}</td>
                      {doneLabel && <td className="px-3 py-3 text-right tabular-nums">{qty(l.doneQuantity)}</td>}
                      <td className="px-3 py-3 text-right tabular-nums">{formatPaise(l.unitPricePaise)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{l.discountPaise ? formatPaise(l.discountPaise) : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{l.gstRateBp / 100}%</td>
                      <td className="py-3 pr-5 text-right font-medium tabular-nums">{formatPaise(l.taxablePaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {doc.notes && <p className="border-t px-5 py-4 text-sm text-muted-foreground">{doc.notes}</p>}
          </section>
        </div>

        <aside className="grid gap-5 xl:sticky xl:top-20">
          <section className="ui-surface grid gap-2 p-5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Summary</h2>
              <span className="flex gap-1"><StatusBadge status={doc.status} label={label(doc.kind, doc.status)} />{doc.overdue && <StatusBadge status="overdue" />}</span>
            </div>
            <p className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="tabular-nums">{formatPaise(doc.taxablePaise - doc.chargesPaise)}</span></p>
            {doc.chargesPaise > 0 && <p className="flex justify-between"><span className="text-muted-foreground">Freight and charges</span><span className="tabular-nums">{formatPaise(doc.chargesPaise)}</span></p>}
            {doc.igstPaise > 0 && <p className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="tabular-nums">{formatPaise(doc.igstPaise)}</span></p>}
            {doc.cgstPaise > 0 && <p className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="tabular-nums">{formatPaise(doc.cgstPaise)}</span></p>}
            {doc.sgstPaise > 0 && <p className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="tabular-nums">{formatPaise(doc.sgstPaise)}</span></p>}
            {doc.reverseCharge && tax > 0 && <p className="text-xs text-muted-foreground">GST of {formatPaise(tax)} is paid by you under reverse charge.</p>}
            {doc.roundOffPaise !== 0 && <p className="flex justify-between"><span className="text-muted-foreground">Round off</span><span className="tabular-nums">{formatPaise(doc.roundOffPaise)}</span></p>}
            <p className="flex justify-between border-t pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{formatPaise(doc.totalPaise)}</span></p>
            {isBill && live && (
              <>
                {doc.returnedPaise > 0 && <p className="flex justify-between"><span className="text-muted-foreground">Returned</span><span className="tabular-nums">− {formatPaise(doc.returnedPaise)}</span></p>}
                {doc.paidPaise > 0 && <p className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="tabular-nums">− {formatPaise(doc.paidPaise)}</span></p>}
                <p className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 font-semibold"><span>{doc.balancePaise < 0 ? "Supplier owes you" : "Balance due"}</span><span className="text-lg text-primary tabular-nums">{formatPaise(Math.abs(doc.balancePaise))}</span></p>
              </>
            )}
          </section>

          <section className="ui-surface grid gap-1.5 p-5 text-sm">
            <h2 className="mb-1 font-semibold">Details</h2>
            <p className="flex justify-between gap-3"><span className="text-muted-foreground">Date</span><span>{formatDate(doc.issueDate)}</span></p>
            {doc.supplierRef && <p className="flex justify-between gap-3"><span className="text-muted-foreground">{isBill ? "Supplier invoice" : "Challan"}</span><span>{doc.supplierRef}</span></p>}
            {doc.dueDate && <p className="flex justify-between gap-3"><span className="text-muted-foreground">{isOrder ? "Expected" : "Due date"}</span><span className={doc.overdue ? "text-destructive" : ""}>{formatDate(doc.dueDate)}</span></p>}
            {doc.location && <p className="flex justify-between gap-3"><span className="text-muted-foreground">Warehouse</span><span>{doc.location.name}</span></p>}
            {doc.returnReason && <p className="flex justify-between gap-3"><span className="text-muted-foreground">Reason</span><span>{doc.returnReason}</span></p>}
            {doc.sourceNumber && doc.sourceId && <p className="flex justify-between gap-3"><span className="text-muted-foreground">Made from</span><Link className="font-mono text-primary hover:underline" href={`/app/m/purchase/${doc.sourceId}`}>{doc.sourceNumber}</Link></p>}
            {doc.reverseCharge && <p className="font-medium">Reverse charge</p>}
          </section>

          {!!doc.children?.length && (
            <section className="ui-surface grid gap-2 p-5 text-sm">
              <h2 className="font-semibold">Made from this</h2>
              {doc.children.map((c) => (
                <Link key={c.id} href={`/app/m/purchase/${c.id}`} className="flex items-center justify-between gap-2 hover:underline">
                  <span><span className="font-mono">{c.number}</span><span className="block text-xs text-muted-foreground">{KIND_LABEL[c.kind]} · {formatDate(c.issueDate)}</span></span>
                  <StatusBadge status={c.status} label={label(c.kind, c.status)} />
                </Link>
              ))}
            </section>
          )}
          {isBill && !!doc.payments?.length && (
            <section className="ui-surface grid gap-2 p-5 text-sm">
              <h2 className="font-semibold">Payments</h2>
              {doc.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2">
                  <span className={p.reversed || p.reversesId ? "text-muted-foreground" : ""}>
                    <span className="font-mono">{p.number}</span>
                    <span className="block text-xs text-muted-foreground">{formatDate(p.paidOn)} · {p.method.toUpperCase()}{p.reference ? ` · ${p.reference}` : ""}{p.reversed ? " · reversed" : ""}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{formatPaise(p.amountPaise)}</span>
                    {!p.reversesId && !p.reversed && can("inventory.supplier_bill.approve") && <button className="text-xs text-destructive hover:underline" onClick={() => act(() => api.post(`/supplier-payments/${p.id}/reverse`), "Payment reversed")}>Reverse</button>}
                  </span>
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete draft ${doc.number}?`}
        description="This draft is removed for good. Nothing else changes."
        confirmLabel="Delete draft"
        destructive
        onConfirm={async () => {
          try { await api.delete(`/purchases/${doc.id}`); toast.success("Draft deleted"); router.push(KIND_PATH[doc.kind]) } catch (e) { toast.error(errorMessage(e)); throw e }
        }}
      />
      {isBill && paying && <PaySupplierDialog initial={{ id: doc.contactId, name: doc.supplier.name, phone: doc.supplier.phone, gstin: doc.supplier.gstin }} bill={{ id: doc.id, duePaise: doc.balancePaise }} onClose={() => setPaying(false)} onSaved={async () => { setPaying(false); setDoc(await api.get<PurchaseDoc>(`/purchases/${doc.id}`)) }} />}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${doc.number}?`}
        description={doc.kind === "purchase_order" ? "The order stays on record as cancelled." : doc.status === "approved" ? "Nothing has moved yet. It stays on record as cancelled." : "Any stock it moved is moved back. It stays on record as cancelled."}
        confirmLabel="Cancel it"
        destructive
        reasonLabel="Why?"
        onConfirm={async (reason) => {
          try { setDoc(await api.post<PurchaseDoc>(`/purchases/${doc.id}/cancel`, { reason })); toast.success("Cancelled") } catch (e) { toast.error(errorMessage(e)); throw e }
        }}
      />
    </div>
  )
}
