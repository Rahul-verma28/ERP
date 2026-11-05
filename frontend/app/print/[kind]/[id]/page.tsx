"use client"

import * as React from "react"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SalesDocView } from "@/components/sales-doc-view"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import type { SalesDoc } from "@/lib/sales"

// Browser printing (HW-02): A4 invoice, or 80 mm / 58 mm thermal receipt.

type Format = "a4" | "80mm" | "58mm"

function Receipt({ doc, width }: { doc: SalesDoc; width: "80mm" | "58mm" }) {
  const s = doc.seller
  return (
    <div className="mx-auto bg-white p-2 font-mono text-[11px] leading-tight text-black" style={{ width }}>
      <p className="text-center text-sm font-bold">{s?.legalName || s?.name}</p>
      {s?.gstin && <p className="text-center">GSTIN {s.gstin}</p>}
      <p className="my-1 border-y border-dashed border-black py-1 text-center">{doc.kind === "invoice" ? "TAX INVOICE" : doc.kind === "credit_note" ? "CREDIT NOTE" : doc.kind === "sales_order" ? "SALES ORDER" : "QUOTATION"} {doc.number}<br />{formatDate(doc.issueDate)}</p>
      <p>To: {doc.buyer.name}</p>
      {doc.sourceNumber && <p>Against: {doc.sourceNumber}</p>}
      <table className="my-1 w-full">
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i} className="align-top">
              <td>{l.description}<br />{Number(l.quantity)} × {formatPaise(l.unitPricePaise)}</td>
              <td className="text-right">{formatPaise(l.taxablePaise ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-dashed border-black pt-1">
        <p className="flex justify-between"><span>Taxable</span><span>{formatPaise(doc.taxablePaise)}</span></p>
        {doc.igstPaise ? <p className="flex justify-between"><span>IGST</span><span>{formatPaise(doc.igstPaise)}</span></p> : (
          <>
            <p className="flex justify-between"><span>CGST</span><span>{formatPaise(doc.cgstPaise)}</span></p>
            <p className="flex justify-between"><span>SGST</span><span>{formatPaise(doc.sgstPaise)}</span></p>
          </>
        )}
        {!!doc.roundOffPaise && <p className="flex justify-between"><span>Round off</span><span>{formatPaise(doc.roundOffPaise)}</span></p>}
        <p className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{formatPaise(doc.totalPaise)}</span></p>
        {doc.kind === "invoice" && doc.paidPaise > 0 && <p className="flex justify-between"><span>Paid</span><span>{formatPaise(doc.paidPaise)}</span></p>}
      </div>
      <p className="mt-2 text-center">Thank you!</p>
    </div>
  )
}

export default function PrintPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = React.use(params)
  const { status } = useAuth()
  const [doc, setDoc] = React.useState<SalesDoc | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [format, setFormat] = React.useState<Format>("a4")

  React.useEffect(() => {
    if (status !== "authenticated") return
    api
      .get<SalesDoc>(`/${kind === "quotation" ? "quotations" : kind === "credit_note" ? "credit-notes" : kind === "sales_order" ? "sales-orders" : "invoices"}/${id}`)
      .then((d) => {
        setDoc(d)
        // Paper size from Settings › Documents › Print (frozen on the invoice)
        if (d.seller?.paper) setFormat(d.seller.paper)
      })
      .catch((e) => setError(e.message))
  }, [status, kind, id])

  if (status === "anonymous") return <p className="p-8 text-sm">Please sign in to print this document.</p>
  if (error) return <p className="p-8 text-sm">{error}</p>
  if (!doc) return <p className="p-8 text-sm text-neutral-500">Preparing document…</p>

  return (
    <div className="min-h-svh bg-neutral-100 print:bg-white">
      <style>{`@media print { @page { size: ${format === "a4" ? "A4" : `${format} auto`}; margin: ${format === "a4" ? "12mm" : "2mm"}; } }`}</style>
      <div className="sticky top-0 flex flex-wrap items-center justify-center gap-2 border-b bg-white p-3 print:hidden">
        <div className="inline-flex rounded-full bg-neutral-100 p-1 text-sm text-neutral-900" role="radiogroup" aria-label="Paper size">
          {(["a4", "80mm", "58mm"] as const).map((f) => (
            <button key={f} role="radio" aria-checked={format === f} onClick={() => setFormat(f)} className={`rounded-full px-3 py-1 ${format === f ? "bg-white font-medium shadow-sm" : ""}`}>
              {f === "a4" ? "A4" : `${f} receipt`}
            </button>
          ))}
        </div>
        <Button onClick={() => window.print()}><Printer /> Print or save as PDF</Button>
      </div>
      <div className="mx-auto max-w-[210mm] py-6 print:max-w-none print:py-0">
        {format === "a4" ? <SalesDocView doc={doc} className="shadow-sm print:shadow-none" /> : <Receipt doc={doc} width={format} />}
      </div>
    </div>
  )
}
