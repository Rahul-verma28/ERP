"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, MoneyInput, Spinner, StatusBadge } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { qty } from "@/lib/inventory"
import { INVOICE_STEPS, KIND_LABEL, KIND_PATH, KIND_PLURAL, RETURN_STEPS, invoiceStatus, returnStatus, type PurchaseDoc } from "@/lib/purchase"
import { todayInIndia } from "@contracts/validation"

// A purchase document with what happened since: received or billed quantities, documents made
// from it, payments. The next step is one button away: receive, bill, return, pay.

const METHODS = [["bank", "Bank transfer"], ["upi", "UPI"], ["cheque", "Cheque"], ["cash", "Cash"], ["card", "Card"], ["other", "Other"]] as const

function PayDialog({ doc, open, onOpenChange, onDone }: { doc: PurchaseDoc; open: boolean; onOpenChange: (o: boolean) => void; onDone: (d: PurchaseDoc) => void }) {
  const [amount, setAmount] = React.useState<number | null>(doc.balancePaise)
  const [method, setMethod] = React.useState("bank")
  const [reference, setReference] = React.useState("")
  const [paidOn, setPaidOn] = React.useState(todayInIndia())
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function pay() {
    setBusy(true)
    setError(null)
    try {
      const d = await api.post<PurchaseDoc>(`/purchases/${doc.id}/payments`, { amountPaise: amount ?? 0, method, reference: reference.trim() || null, paidOn })
      toast.success("Payment recorded")
      onDone(d)
      onOpenChange(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Pay {doc.supplier.name}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount" hint={`Balance ${formatPaise(doc.balancePaise)}`}><MoneyInput value={amount} onChange={setAmount} aria-label="Amount" /></Field>
          <Field label="Paid on"><Input type="date" value={paidOn} max={todayInIndia()} onChange={(e) => setPaidOn(e.target.value)} /></Field>
          <Field label="Paid by">
            <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Paid by">
              {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </NativeSelect>
          </Field>
          <Field label="UTR / cheque no."><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} /></Field>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !amount} onClick={pay}>{busy ? "Saving…" : "Record payment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function PurchaseDocPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = useAuth()
  const res = useApi<PurchaseDoc>(`/purchases/${id}`)
  const doc = res.data
  const setDoc = res.setData
  const [paying, setPaying] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const router = useRouter()
  if (res.error) return <PageHeader title="Not found" description={errorMessage(res.error)} />
  if (!doc) return <div className="grid place-items-center py-24"><Spinner /></div>

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

  return (
    <>
      <Link href={KIND_PATH[doc.kind]} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {KIND_PLURAL[doc.kind]}</Link>
      <PageHeader
        title={`${KIND_LABEL[doc.kind]} ${doc.number}`}
        description={`${doc.supplier.name}${doc.supplier.gstin ? ` · ${doc.supplier.gstin}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {isReturn && draft && can("inventory.supplier_bill.approve") && <Button onClick={() => act(() => api.post(`/purchases/${doc.id}/approve`, { version: doc.version }), "Return approved")}>Approve return</Button>}
            {isReturn && doc.status === "approved" && can("inventory.supplier_bill.create") && <Button onClick={() => act(() => api.post(`/purchases/${doc.id}/complete`, { version: doc.version }), "Return completed. Stock has gone out.")}>Complete return</Button>}
            {isReturn && draft && can("inventory.supplier_bill.create") && (
              <>
                <Link href={`/app/m/purchase/new?kind=purchase_return&edit=${doc.id}`} className={buttonVariants({ variant: "outline" })}>Edit</Link>
                <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>Delete</Button>
              </>
            )}
            {isBill && draft && can("inventory.supplier_bill.create") && (
              <>
                <Button onClick={() => act(() => api.post(`/purchases/${doc.id}/post`, { version: doc.version }), "Invoice posted. Stock is in.")}>Post invoice</Button>
                <Link href={`/app/m/purchase/new?kind=purchase_bill&edit=${doc.id}`} className={buttonVariants({ variant: "outline" })}>Edit</Link>
                <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>Delete</Button>
              </>
            )}
            {live && isOrder && left && doc.status !== "closed" && can("inventory.receipt.create") && <Link href={`/app/m/purchase/new?kind=goods_receipt&from=${doc.id}`} className={buttonVariants()}>Receive goods</Link>}
            {live && isOrder && left && doc.status !== "closed" && can("inventory.supplier_bill.create") && <Link href={`/app/m/purchase/new?kind=purchase_bill&from=${doc.id}`} className={buttonVariants({ variant: "outline" })}>Bill directly</Link>}
            {live && doc.kind === "goods_receipt" && left && can("inventory.supplier_bill.create") && <Link href={`/app/m/purchase/new?kind=purchase_bill&from=${doc.id}`} className={buttonVariants()}>Make bill</Link>}
            {live && isBill && doc.balancePaise > 0 && can("inventory.supplier_bill.create") && <Button onClick={() => setPaying(true)}>Pay</Button>}
            {live && isBill && left && can("inventory.supplier_bill.create") && <Link href={`/app/m/purchase/new?kind=purchase_return&from=${doc.id}`} className={buttonVariants({ variant: "outline" })}>Return goods</Link>}
            {isOrder && doc.status === "open" && can("inventory.purchase_order.edit") && <Link href={`/app/m/purchase/new?kind=purchase_order&edit=${doc.id}`} className={buttonVariants({ variant: "outline" })}>Edit</Link>}
            {isOrder && doc.status === "part_received" && can("inventory.purchase_order.edit") && <Button variant="outline" onClick={() => act(() => api.post(`/purchases/${doc.id}/close`), "Order closed")}>Close order</Button>}
            {live && can(cancelPerm) && <Button variant="outline" className="text-destructive" onClick={() => setCancelling(true)}>Cancel</Button>}
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="grid gap-4">
            {steps && doc.status !== "cancelled" && (
              <ol className="flex flex-wrap items-center gap-1.5 text-xs font-medium" aria-label="Status">
                {steps.map(([key, text], i) => {
                  const at = steps.findIndex(([k]) => k === doc.status)
                  return (
                    <li key={key} className="flex items-center gap-1.5">
                      {i > 0 && <span className="h-px w-5 bg-border" />}
                      <span aria-current={i === at ? "step" : undefined} className={i === at ? "rounded-full bg-primary px-2.5 py-1 text-primary-foreground" : i < at ? "rounded-full bg-primary/15 px-2.5 py-1 text-primary" : "rounded-full bg-muted px-2.5 py-1 text-muted-foreground"}>{text}</span>
                    </li>
                  )
                })}
              </ol>
            )}
            {draft && <p className="rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">{isReturn ? "This is a draft. Stock and the invoice balance change only when the return is completed." : "This is a draft. Stock and what you owe change only when you post it."}</p>}
            {isReturn && doc.status === "approved" && <p className="rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">Approved. Press Complete return once the goods have actually gone back to the supplier.</p>}
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <span className="flex items-center gap-2"><StatusBadge status={doc.status} label={label(doc.kind, doc.status)} />{doc.overdue && <StatusBadge status="overdue" />}</span>
              {doc.returnReason && <span><span className="text-muted-foreground">Reason </span>{doc.returnReason}</span>}
              <span><span className="text-muted-foreground">Date </span>{formatDate(doc.issueDate)}</span>
              {doc.supplierRef && <span><span className="text-muted-foreground">{isBill ? "Supplier bill " : "Challan "}</span>{doc.supplierRef}{doc.supplierDate && ` · ${formatDate(doc.supplierDate)}`}</span>}
              {doc.dueDate && <span><span className="text-muted-foreground">{isOrder ? "Expected " : "Due "}</span>{formatDate(doc.dueDate)}</span>}
              {doc.location && <span><span className="text-muted-foreground">Godown </span>{doc.location.name}</span>}
              {doc.sourceNumber && doc.sourceId && <span><span className="text-muted-foreground">From </span><Link className="font-mono text-primary hover:underline" href={`/app/m/purchase/${doc.sourceId}`}>{doc.sourceNumber}</Link></span>}
              {doc.reverseCharge && <span className="font-medium">Reverse charge</span>}
            </div>
            {doc.status === "cancelled" && doc.cancelReason && <p className="rounded-2xl bg-muted px-3 py-2 text-sm">Cancelled: {doc.cancelReason}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-2 pr-3">Item</th><th className="py-2 pr-3 text-right">Qty</th>{doneLabel && <th className="py-2 pr-3 text-right">{doneLabel}</th>}<th className="py-2 pr-3 text-right">Price</th><th className="py-2 pr-3 text-right">GST</th><th className="py-2 text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {doc.lines.map((l) => (
                    <tr key={l.id} className="border-t align-top">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{l.description}</span>
                        <span className="block text-xs text-muted-foreground">
                          {[l.hsnSac && `HSN ${l.hsnSac}`, l.batchNo && `Batch ${l.batchNo}`, l.expiryDate && `Exp ${formatDate(l.expiryDate)}`, l.serials.length ? `S/N ${l.serials.join(", ")}` : null, l.landedPaise ? `+ ${formatPaise(l.landedPaise)} landed cost` : null].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{qty(l.quantity)} {l.unit}</td>
                      {doneLabel && <td className="py-2 pr-3 text-right tabular-nums">{qty(l.doneQuantity)}</td>}
                      <td className="py-2 pr-3 text-right tabular-nums">{formatPaise(l.unitPricePaise)}{l.discountPaise ? <span className="block text-xs text-muted-foreground">− {formatPaise(l.discountPaise)}</span> : null}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{l.gstRateBp / 100}%</td>
                      <td className="py-2 text-right tabular-nums">{formatPaise(l.taxablePaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ml-auto grid w-full max-w-xs gap-1 text-sm">
              <p className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="tabular-nums">{formatPaise(doc.taxablePaise - doc.chargesPaise)}</span></p>
              {doc.chargesPaise > 0 && <p className="flex justify-between"><span className="text-muted-foreground">Freight and charges</span><span className="tabular-nums">{formatPaise(doc.chargesPaise)}</span></p>}
              {doc.igstPaise > 0 && <p className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="tabular-nums">{formatPaise(doc.igstPaise)}</span></p>}
              {doc.cgstPaise > 0 && <p className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="tabular-nums">{formatPaise(doc.cgstPaise)}</span></p>}
              {doc.sgstPaise > 0 && <p className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="tabular-nums">{formatPaise(doc.sgstPaise)}</span></p>}
              {doc.reverseCharge && tax > 0 && <p className="text-xs text-muted-foreground">GST of {formatPaise(tax)} is paid by you under reverse charge.</p>}
              {doc.roundOffPaise !== 0 && <p className="flex justify-between"><span className="text-muted-foreground">Round off</span><span className="tabular-nums">{formatPaise(doc.roundOffPaise)}</span></p>}
              <p className="flex justify-between border-t pt-1 text-base font-semibold"><span>Total</span><span className="tabular-nums">{formatPaise(doc.totalPaise)}</span></p>
              {isBill && live && (
                <>
                  {doc.returnedPaise > 0 && <p className="flex justify-between"><span className="text-muted-foreground">Returned</span><span className="tabular-nums">− {formatPaise(doc.returnedPaise)}</span></p>}
                  {doc.paidPaise > 0 && <p className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="tabular-nums">− {formatPaise(doc.paidPaise)}</span></p>}
                  <p className="flex justify-between font-semibold"><span>{doc.balancePaise < 0 ? "Supplier owes you" : "To pay"}</span><span className="tabular-nums">{formatPaise(Math.abs(doc.balancePaise))}</span></p>
                </>
              )}
            </div>
            {doc.notes && <p className="text-sm text-muted-foreground">{doc.notes}</p>}
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          {!!doc.children?.length && (
            <Card><CardContent className="grid gap-2 text-sm">
              <p className="font-medium">Made from this</p>
              {doc.children.map((c) => (
                <Link key={c.id} href={`/app/m/purchase/${c.id}`} className="flex items-center justify-between gap-2 hover:underline">
                  <span><span className="font-mono">{c.number}</span><span className="block text-xs text-muted-foreground">{KIND_LABEL[c.kind]} · {formatDate(c.issueDate)}</span></span>
                  <StatusBadge status={c.status} label={label(c.kind, c.status)} />
                </Link>
              ))}
            </CardContent></Card>
          )}
          {isBill && !!doc.payments?.length && (
            <Card><CardContent className="grid gap-2 text-sm">
              <p className="font-medium">Payments</p>
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
            </CardContent></Card>
          )}
          <Card><CardContent className="text-sm">
            <Link href={`/app/m/purchase/suppliers/${doc.contactId}`} className="text-primary hover:underline">{doc.supplier.name}: ledger and all bills</Link>
          </CardContent></Card>
        </div>
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
      {isBill && <PayDialog key={doc.balancePaise} doc={doc} open={paying} onOpenChange={setPaying} onDone={setDoc} />}
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
    </>
  )
}
