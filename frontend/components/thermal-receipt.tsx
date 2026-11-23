import { formatDate, formatPaise } from "@/lib/format"
import type { ViewDoc } from "@/components/sales-doc-view"
import { cn } from "@/lib/utils"

// 80 mm / 58 mm thermal receipt: the print page and the Settings › Documents preview.

export function ThermalReceipt({ doc, width, className }: { doc: ViewDoc; width: "80mm" | "58mm"; className?: string }) {
  const s = doc.seller
  return (
    <div className={cn("mx-auto bg-white p-2 font-mono text-[11px] leading-tight text-black", className)} style={{ width }}>
      <p className="text-center text-sm font-bold">{s?.legalName || s?.name}</p>
      {s?.address && <p className="text-center">{[s.address.line1, s.address.city, s.address.pincode].filter(Boolean).join(", ")}</p>}
      {s?.phone && <p className="text-center">Ph {s.phone}</p>}
      {s?.gstin && <p className="text-center">GSTIN {s.gstin}</p>}
      <p className="my-1 border-y border-dashed border-black py-1 text-center">{doc.kind === "invoice" ? (doc.seller?.unregistered || (doc.seller && !doc.seller.gstin) ? "INVOICE" : doc.seller?.billOfSupply ? "BILL OF SUPPLY" : "TAX INVOICE") : doc.kind === "credit_note" ? "CREDIT NOTE" : doc.kind === "debit_note" ? "DEBIT NOTE" : doc.kind === "sales_order" ? "SALES ORDER" : doc.kind === "delivery_challan" ? "DELIVERY CHALLAN" : doc.noteType === "proforma" ? "PROFORMA INVOICE" : "QUOTATION"} {doc.number}<br />{formatDate(doc.issueDate)}</p>
      <p>To: {doc.buyer.name}</p>
      {doc.sourceNumber && <p>Against: {doc.sourceNumber}</p>}
      <table className="my-1 w-full">
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i} className="align-top">
              <td>{l.description}<br />{Number(l.quantity)} × {formatPaise(l.unitPricePaise)}{Number(l.freeQuantity) > 0 && ` + ${Number(l.freeQuantity)} free`}</td>
              <td className="text-right">{formatPaise(l.taxablePaise ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-dashed border-black pt-1">
        {!doc.seller?.billOfSupply && !doc.seller?.unregistered && <p className="flex justify-between"><span>Taxable</span><span>{formatPaise(doc.taxablePaise)}</span></p>}
        {doc.seller?.billOfSupply || doc.seller?.unregistered ? null : doc.igstPaise ? <p className="flex justify-between"><span>IGST</span><span>{formatPaise(doc.igstPaise)}</span></p> : (
          <>
            <p className="flex justify-between"><span>CGST</span><span>{formatPaise(doc.cgstPaise)}</span></p>
            <p className="flex justify-between"><span>SGST</span><span>{formatPaise(doc.sgstPaise)}</span></p>
          </>
        )}
        {!!doc.roundOffPaise && <p className="flex justify-between"><span>Round off</span><span>{formatPaise(doc.roundOffPaise)}</span></p>}
        <p className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{formatPaise(doc.totalPaise)}</span></p>
        {doc.kind === "invoice" && doc.paidPaise > 0 && <p className="flex justify-between"><span>Paid</span><span>{formatPaise(doc.paidPaise)}</span></p>}
      </div>
      {doc.terms && <p className="mt-2 border-t border-dashed border-black pt-1 whitespace-pre-wrap">{doc.terms}</p>}
      <p className="mt-2 text-center">Thank you!</p>
    </div>
  )
}
