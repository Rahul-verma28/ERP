import { GST_STATES, formatDate, formatPaise } from "@/lib/format"
import { amountInWords } from "@/lib/money"
import { UpiQr } from "@/components/upi-qr"
import type { Buyer, DocLine, Seller, ShipTo } from "@/lib/sales"
import { cn } from "@/lib/utils"

// Printable GST tax invoice / quotation (BIL-01, HW-02). Used in-app, for printing and on share links.

export interface ViewDoc {
  kind: "invoice" | "quotation" | "credit_note" | "sales_order" | "delivery_challan" | "debit_note"
  noteType?: string | null
  shipTo?: ShipTo | null
  ewayBillNo?: string | null
  ewayBillDate?: string | null
  irn?: string | null
  irnAckNo?: string | null
  irnAckDate?: string | null
  number: string | null
  status: string
  issueDate: string
  dueDate: string | null
  buyer: Buyer
  seller: Seller | null
  placeOfSupply: string | null
  subtotalPaise: number
  discountPaise: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  roundOffPaise?: number
  totalPaise: number
  paidPaise: number
  /** Invoice: the part of paidPaise that came from credit notes */
  creditedPaise?: number
  /** Credit note: the invoice it is against */
  sourceNumber?: string | null
  sourceDate?: string | null
  notes: string | null
  terms: string | null
  lines: DocLine[]
}

const stateName = (code?: string | null) => (code ? `${GST_STATES.find(([c]) => c === code)?.[1] ?? ""} (${code})` : "—")
const addr = (a?: Record<string, string> | null) => (a ? [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", ") : "")

export function SalesDocView({ doc, fallbackSeller, className }: { doc: ViewDoc; fallbackSeller?: Seller; className?: string }) {
  const seller = doc.seller ?? fallbackSeller
  const intra = doc.igstPaise === 0
  // Not registered under GST: a plain invoice with no GST words; composition or exempt-only: bill of supply
  const unregistered = doc.kind === "invoice" && doc.status !== "draft" && !!seller && (seller.unregistered || !seller.gstin)
  const billOfSupply = (!!seller?.billOfSupply && doc.status !== "draft") || unregistered || (["delivery_challan", "quotation", "sales_order"].includes(doc.kind) && doc.cgstPaise + doc.sgstPaise + doc.igstPaise === 0)
  const title = doc.kind === "sales_order" ? "Sales Order" : doc.kind === "delivery_challan" ? "Delivery Challan" : doc.kind === "debit_note" ? "Debit Note" : doc.kind === "credit_note" ? "Credit Note" : doc.kind === "quotation" ? (doc.noteType === "proforma" ? "Proforma Invoice" : "Quotation") : unregistered ? "Invoice" : billOfSupply ? "Bill of Supply" : doc.status === "draft" ? "Draft invoice" : doc.buyer.gstin ? "Tax Invoice" : "Tax Invoice (B2C)"
  const balance = doc.totalPaise - doc.paidPaise
  const credited = doc.creditedPaise ?? 0
  const hsnSummary = Object.values(
    doc.lines.reduce<Record<string, { hsn: string; rate: number; taxable: number; tax: number }>>((acc, l) => {
      const key = `${l.hsnSac ?? "—"}-${l.gstRateBp}`
      acc[key] ??= { hsn: l.hsnSac ?? "—", rate: l.gstRateBp, taxable: 0, tax: 0 }
      acc[key].taxable += l.taxablePaise ?? 0
      acc[key].tax += (l.cgstPaise ?? 0) + (l.sgstPaise ?? 0) + (l.igstPaise ?? 0)
      return acc
    }, {})
  )

  return (
    <article className={cn("bg-white p-6 text-sm text-neutral-900 sm:p-10", className)}>
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-neutral-200 pb-6">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {seller?.logoUrl && <img src={seller.logoUrl} alt="" className="size-14 rounded-lg object-contain" />}
          <div>
            <p className="text-lg font-semibold">{seller?.legalName || seller?.name}</p>
            {seller?.address && <p className="max-w-xs text-neutral-600">{addr(seller.address)}</p>}
            {seller?.gstin && <p className="text-neutral-600">GSTIN: <span className="font-mono">{seller.gstin}</span></p>}
            {seller?.stateCode && <p className="text-neutral-600">State: {stateName(seller.stateCode)}</p>}
            {(seller?.phone || seller?.email) && <p className="text-neutral-600">{[seller.phone, seller.email].filter(Boolean).join(" · ")}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold tracking-tight uppercase">{title}</p>
          <p className="mt-1 font-mono">{doc.number ?? "—"}</p>
          <p className="text-neutral-600">Date: {formatDate(doc.issueDate)}</p>
          {doc.sourceNumber && <p className="text-neutral-600">Against invoice: <span className="font-mono">{doc.sourceNumber}</span>{doc.sourceDate && ` dated ${formatDate(doc.sourceDate)}`}</p>}
          {doc.dueDate && <p className="text-neutral-600">{doc.kind === "invoice" ? "Due" : doc.kind === "sales_order" || doc.kind === "delivery_challan" ? "Deliver by" : "Valid until"}: {formatDate(doc.dueDate)}</p>}
          {doc.ewayBillNo && <p className="text-neutral-600">E-way bill: <span className="font-mono">{doc.ewayBillNo}</span>{doc.ewayBillDate && ` · ${formatDate(doc.ewayBillDate)}`}</p>}
          {doc.status === "cancelled" && <p className="mt-1 font-semibold text-red-600">CANCELLED</p>}
        </div>
        {doc.irn && (
          <div className="w-full rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            <p>IRN: <span className="font-mono break-all">{doc.irn}</span></p>
            <p>Ack no: <span className="font-mono">{doc.irnAckNo}</span>{doc.irnAckDate && ` · Ack date: ${formatDate(doc.irnAckDate)}`}</p>
          </div>
        )}
      </header>

      <section className="grid gap-4 border-b border-neutral-200 py-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Bill to</p>
          <p className="mt-1 font-medium">{doc.buyer.name}</p>
          {doc.buyer.address && <p className="text-neutral-600">{addr(doc.buyer.address)}</p>}
          {doc.buyer.gstin && <p className="text-neutral-600">GSTIN: <span className="font-mono">{doc.buyer.gstin}</span></p>}
          {doc.buyer.phone && <p className="text-neutral-600">{doc.buyer.phone}</p>}
        </div>
        {doc.shipTo && (
          <div>
            <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Ship to</p>
            {doc.shipTo.name && <p className="mt-1 font-medium">{doc.shipTo.name}</p>}
            <p className="text-neutral-600">{[doc.shipTo.line1, doc.shipTo.city, doc.shipTo.pincode].filter(Boolean).join(", ")}</p>
            {doc.shipTo.stateCode && <p className="text-neutral-600">{stateName(doc.shipTo.stateCode)}</p>}
          </div>
        )}
        <div className="sm:text-right">
          <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Place of supply</p>
          <p className="mt-1">{stateName(doc.placeOfSupply)}</p>
        </div>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse py-4 text-left">
          <thead>
            <tr className="border-b border-neutral-300 text-xs text-neutral-500">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Item</th>
              <th className="py-2 pr-2 font-medium">HSN/SAC</th>
              <th className="py-2 pr-2 text-right font-medium">Qty</th>
              <th className="py-2 pr-2 text-right font-medium">Rate</th>
              <th className="py-2 pr-2 text-right font-medium">Disc.</th>
              {!billOfSupply && <th className="py-2 pr-2 text-right font-medium">Taxable</th>}
              {!billOfSupply && <th className="py-2 pr-2 text-right font-medium">GST</th>}
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={l.id ?? i} className="border-b border-neutral-100 align-top">
                <td className="py-2 pr-2 text-neutral-500">{i + 1}</td>
                <td className="py-2 pr-2">
                  {l.description}
                  {l.batches?.length ? <span className="block text-xs text-neutral-500">{l.batches.map((b) => `Batch ${b.number}${b.expiry ? ` · Exp ${b.expiry.slice(5, 7)}/${b.expiry.slice(2, 4)}` : ""}${l.batches!.length > 1 ? ` (${b.quantity})` : ""}`).join(", ")}</span> : null}
                  {l.serials?.length ? <span className="block text-xs text-neutral-500">S/N: {l.serials.join(", ")}</span> : null}
                </td>
                <td className="py-2 pr-2 font-mono text-xs">{l.hsnSac ?? "—"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{Number(l.quantity)} {l.unit}{Number(l.freeQuantity) > 0 && <span className="block text-xs text-neutral-500">+ {Number(l.freeQuantity)} free</span>}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatPaise(l.unitPricePaise)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{l.discountPaise ? formatPaise(l.discountPaise) : "—"}</td>
                {!billOfSupply && <td className="py-2 pr-2 text-right tabular-nums">{formatPaise(l.taxablePaise ?? 0)}</td>}
                {!billOfSupply && <td className="py-2 pr-2 text-right tabular-nums">{l.gstRateBp / 100}%</td>}
                <td className="py-2 text-right font-medium tabular-nums">{formatPaise(l.totalPaise ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="grid gap-6 pt-5 sm:grid-cols-2">
        <div className="grid content-start gap-3">
          {doc.kind !== "quotation" && !billOfSupply && hsnSummary.length > 0 && seller?.showHsnSummary !== false && (
            <table className="w-full text-xs">
              <thead><tr className="text-neutral-500"><th className="text-left font-medium">HSN/SAC</th><th className="text-right font-medium">Rate</th><th className="text-right font-medium">Taxable</th><th className="text-right font-medium">Tax</th></tr></thead>
              <tbody>{hsnSummary.map((h) => <tr key={`${h.hsn}-${h.rate}`}><td className="font-mono">{h.hsn}</td><td className="text-right">{h.rate / 100}%</td><td className="text-right tabular-nums">{formatPaise(h.taxable)}</td><td className="text-right tabular-nums">{formatPaise(h.tax)}</td></tr>)}</tbody>
            </table>
          )}
          <p className="text-xs text-neutral-600"><span className="font-medium text-neutral-900">Amount in words:</span> {amountInWords(doc.totalPaise)}</p>
        </div>
        <dl className="ml-auto grid w-full max-w-xs gap-1">
          {!billOfSupply && <div className="flex justify-between"><dt className="text-neutral-500">Taxable value</dt><dd className="tabular-nums">{formatPaise(doc.taxablePaise)}</dd></div>}
          {billOfSupply ? null : intra ? (
            <>
              <div className="flex justify-between"><dt className="text-neutral-500">CGST</dt><dd className="tabular-nums">{formatPaise(doc.cgstPaise)}</dd></div>
              <div className="flex justify-between"><dt className="text-neutral-500">SGST</dt><dd className="tabular-nums">{formatPaise(doc.sgstPaise)}</dd></div>
            </>
          ) : (
            <div className="flex justify-between"><dt className="text-neutral-500">IGST</dt><dd className="tabular-nums">{formatPaise(doc.igstPaise)}</dd></div>
          )}
          {!!doc.roundOffPaise && <div className="flex justify-between"><dt className="text-neutral-500">Round off</dt><dd className="tabular-nums">{formatPaise(doc.roundOffPaise)}</dd></div>}
          <div className="flex justify-between border-t border-neutral-300 pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatPaise(doc.totalPaise)}</dd></div>
          {doc.kind === "invoice" && doc.paidPaise > 0 && (
            <>
              {doc.paidPaise > credited && <div className="flex justify-between text-neutral-500"><dt>Paid</dt><dd className="tabular-nums">{formatPaise(doc.paidPaise - credited)}</dd></div>}
              {credited > 0 && <div className="flex justify-between text-neutral-500"><dt>Credit notes</dt><dd className="tabular-nums">{formatPaise(credited)}</dd></div>}
              <div className="flex justify-between font-medium"><dt>Balance due</dt><dd className="tabular-nums">{formatPaise(balance)}</dd></div>
            </>
          )}
        </dl>
      </section>

      {doc.kind === "invoice" && (seller?.bank || seller?.upiId) && balance > 0 && (
        <section className="mt-6 flex flex-wrap items-center gap-4 border-t border-neutral-200 pt-5 text-xs text-neutral-700" aria-label="How to pay">
          {seller.showUpiQr && seller.upiId && <UpiQr upiId={seller.upiId} payee={seller.legalName || seller.name} amountPaise={balance} note={doc.number ?? undefined} />}
          <div className="grid gap-1">
            <p className="font-medium text-neutral-900">How to pay</p>
            {seller.upiId && <p>UPI: <span className="font-mono">{seller.upiId}</span></p>}
            {seller.bank && (
              <p>
                Bank transfer: {seller.bank.holder} · A/c <span className="font-mono">{seller.bank.account}</span> · IFSC <span className="font-mono">{seller.bank.ifsc}</span>
              </p>
            )}
          </div>
        </section>
      )}

      {(doc.notes || doc.terms) && (
        <footer className="mt-6 grid gap-4 border-t border-neutral-200 pt-5 text-xs text-neutral-600 sm:grid-cols-2">
          {doc.notes && <div><p className="font-medium text-neutral-900">Notes</p><p className="whitespace-pre-wrap">{doc.notes}</p></div>}
          {doc.terms && <div><p className="font-medium text-neutral-900">Terms</p><p className="whitespace-pre-wrap">{doc.terms}</p></div>}
        </footer>
      )}
      {seller?.composition && billOfSupply && <p className="mt-4 text-xs text-neutral-600">Composition taxable person, not eligible to collect tax on supplies.</p>}
      {doc.kind !== "quotation" && seller && seller.showSignatory !== false && (
        <div className="mt-8 ml-auto w-56 text-center text-xs text-neutral-600">
          <p>For {seller.legalName || seller.name}</p>
          <div className="mt-10 border-t border-neutral-400 pt-1">Authorised signatory</div>
        </div>
      )}
      <p className="mt-8 text-center text-[11px] text-neutral-400">This is a computer-generated document.</p>
    </article>
  )
}
