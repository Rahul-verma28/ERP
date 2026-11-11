"use client"

import * as React from "react"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { qty } from "@/lib/inventory"
import { KIND_LABEL, invoiceStatus, returnStatus, type PurchaseDoc } from "@/lib/purchase"
import { stateName } from "@contracts/validation"

// A purchase invoice, return, order or receipt on A4: print it, or save it as PDF from the print dialog.

const place = (a?: Record<string, string> | null) => (a ? [a.line1, a.line2, a.city, a.state ? stateName(a.state) ?? a.state : null, a.pincode ?? a.pin].filter(Boolean).join(", ") : "")

export default function PurchasePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { status, me } = useAuth()
  const [doc, setDoc] = React.useState<PurchaseDoc | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (status !== "authenticated") return
    api.get<PurchaseDoc>(`/purchases/${id}`).then(setDoc).catch((e) => setError(e.message))
  }, [status, id])

  if (status === "anonymous") return <p className="p-8 text-sm">Please sign in to print this document.</p>
  if (error) return <p className="p-8 text-sm">{error}</p>
  if (!doc || !me?.tenant) return <p className="p-8 text-sm text-neutral-500">Preparing document…</p>

  const t = me.tenant
  const tax = doc.cgstPaise + doc.sgstPaise + doc.igstPaise
  const state = doc.kind === "purchase_bill" ? invoiceStatus(doc.status) : doc.kind === "purchase_return" ? returnStatus(doc.status) : doc.status
  const row = "flex justify-between py-0.5"
  return (
    <div className="min-h-svh bg-neutral-100 text-neutral-900 print:bg-white">
      <style>{"@media print { @page { size: A4; margin: 12mm; } }"}</style>
      <div className="sticky top-0 flex justify-center border-b bg-white p-3 print:hidden">
        <Button onClick={() => window.print()}><Printer /> Print or save as PDF</Button>
      </div>
      <article className="mx-auto my-6 max-w-[210mm] bg-white p-10 text-[13px] shadow-sm print:my-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b border-neutral-300 pb-5">
          <div>
            <p className="text-lg font-bold">{t.legalName || t.name}</p>
            {t.gstin && <p>GSTIN {t.gstin}</p>}
          </div>
          <div className="text-right">
            <p className="text-xl font-bold uppercase">{KIND_LABEL[doc.kind]}</p>
            <p className="font-mono">{doc.number}</p>
            <p className="text-neutral-600">{state}</p>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-6 border-b border-neutral-300 py-5">
          <div>
            <p className="text-[11px] font-semibold text-neutral-500 uppercase">{doc.kind === "purchase_return" ? "Returned to" : "Billed from"}</p>
            <p className="font-semibold">{doc.supplier.name}</p>
            {doc.supplier.gstin && <p>GSTIN {doc.supplier.gstin}</p>}
            {place(doc.supplier.address) && <p className="text-neutral-700">{place(doc.supplier.address)}</p>}
            {doc.supplier.phone && <p>{doc.supplier.phone}</p>}
          </div>
          <div className="grid content-start gap-0.5 text-right">
            <p><span className="text-neutral-500">Date </span>{formatDate(doc.issueDate)}</p>
            {doc.supplierRef && <p><span className="text-neutral-500">Supplier invoice </span>{doc.supplierRef}</p>}
            {doc.dueDate && <p><span className="text-neutral-500">{doc.kind === "purchase_order" ? "Expected " : "Due "}</span>{formatDate(doc.dueDate)}</p>}
            {doc.location && <p><span className="text-neutral-500">Warehouse </span>{doc.location.name}</p>}
            {doc.sourceNumber && <p><span className="text-neutral-500">Against </span>{doc.sourceNumber}</p>}
            {doc.returnReason && <p><span className="text-neutral-500">Reason </span>{doc.returnReason}</p>}
            {doc.reverseCharge && <p className="font-semibold">Reverse charge</p>}
          </div>
        </section>
        <table className="mt-4 w-full">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-[11px] text-neutral-500 uppercase">
              <th className="py-2 pr-2">#</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">HSN</th><th className="py-2 pr-2 text-right">Qty</th><th className="py-2 pr-2 text-right">Rate</th><th className="py-2 pr-2 text-right">GST</th><th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={l.id} className="border-b border-neutral-200 align-top">
                <td className="py-2 pr-2">{i + 1}</td>
                <td className="py-2 pr-2">{l.description}{l.batchNo && <span className="block text-[11px] text-neutral-500">Batch {l.batchNo}{l.expiryDate ? ` · Exp ${formatDate(l.expiryDate)}` : ""}</span>}{l.serials.length > 0 && <span className="block text-[11px] text-neutral-500">S/N {l.serials.join(", ")}</span>}</td>
                <td className="py-2 pr-2">{l.hsnSac ?? ""}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{qty(l.quantity)} {l.unit}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatPaise(l.unitPricePaise)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{l.gstRateBp / 100}%</td>
                <td className="py-2 text-right tabular-nums">{formatPaise(l.taxablePaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="mt-4 ml-auto w-72 tabular-nums">
          <p className={row}><span>Taxable value</span><span>{formatPaise(doc.taxablePaise)}</span></p>
          {doc.igstPaise > 0 && <p className={row}><span>IGST</span><span>{formatPaise(doc.igstPaise)}</span></p>}
          {doc.cgstPaise > 0 && <p className={row}><span>CGST</span><span>{formatPaise(doc.cgstPaise)}</span></p>}
          {doc.sgstPaise > 0 && <p className={row}><span>SGST</span><span>{formatPaise(doc.sgstPaise)}</span></p>}
          {doc.reverseCharge && tax > 0 && <p className="text-[11px] text-neutral-500">GST of {formatPaise(tax)} payable by us under reverse charge.</p>}
          {doc.roundOffPaise !== 0 && <p className={row}><span>Round off</span><span>{formatPaise(doc.roundOffPaise)}</span></p>}
          <p className={`${row} border-t border-neutral-300 pt-1 text-base font-bold`}><span>Total</span><span>{formatPaise(doc.totalPaise)}</span></p>
          {doc.kind === "purchase_bill" && doc.status !== "draft" && (
            <>
              {doc.paidPaise > 0 && <p className={row}><span>Paid</span><span>{formatPaise(doc.paidPaise)}</span></p>}
              {doc.returnedPaise > 0 && <p className={row}><span>Returned</span><span>{formatPaise(doc.returnedPaise)}</span></p>}
              <p className={`${row} font-semibold`}><span>Balance due</span><span>{formatPaise(Math.max(0, doc.balancePaise))}</span></p>
            </>
          )}
        </section>
        {doc.notes && <p className="mt-6 border-t border-neutral-200 pt-3 text-neutral-700">{doc.notes}</p>}
      </article>
    </div>
  )
}
