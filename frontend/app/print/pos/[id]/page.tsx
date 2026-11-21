"use client"

import * as React from "react"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SalesDocView } from "@/components/sales-doc-view"
import { PageError } from "@/components/page-states"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { TENDER_LABEL, type Paper } from "@/lib/pos"
import type { SalesDoc } from "@/lib/sales"

// A counter bill on the thermal printer (80 mm or 58 mm), or A4 when the counter prints on paper.
// Opened from the counter with ?auto=1: it prints as soon as it is ready and closes after.

interface PosReceipt {
  doc: SalesDoc
  pos: { counter: string; shift: string; cashier: string | null; paper: Paper; note: string | null } | null
  payments: { method: string; amountPaise: number; reference: string | null }[]
}

const time = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "")

function Thermal({ r, width }: { r: PosReceipt; width: "80mm" | "58mm" }) {
  const { doc, pos } = r
  const s = doc.seller
  const title = s?.unregistered || !s?.gstin ? "INVOICE" : s?.billOfSupply ? "BILL OF SUPPLY" : "TAX INVOICE"
  const addr = s?.address as Record<string, string> | null | undefined
  const qty = doc.lines.reduce((a, l) => a + Number(l.quantity), 0)
  const saved = doc.lines.reduce((a, l) => a + (l.discountPaise ?? 0), 0)
  const paid = r.payments.reduce((a, p) => a + p.amountPaise, 0)
  const row = (a: React.ReactNode, b: React.ReactNode, strong = false) => <p className={`flex justify-between gap-2 ${strong ? "text-[13px] font-bold" : ""}`}><span>{a}</span><span className="tabular-nums">{b}</span></p>
  return (
    <div className="mx-auto bg-white p-2 font-mono text-[11px] leading-snug text-black" style={{ width }}>
      <p className="text-center text-sm font-bold">{s?.legalName || s?.name}</p>
      {addr && <p className="text-center">{[addr.line1, addr.city, addr.pincode].filter(Boolean).join(", ")}</p>}
      {s?.phone && <p className="text-center">Ph {s.phone}</p>}
      {s?.gstin && <p className="text-center">GSTIN {s.gstin}</p>}
      <p className="my-1 border-y border-dashed border-black py-1 text-center font-bold">{title}</p>
      {row("Bill", doc.number)}
      {row("Date", time(doc.issuedAt ?? doc.issueDate))}
      {pos && row("Counter", `${pos.counter}${pos.cashier ? ` · ${pos.cashier}` : ""}`)}
      {doc.buyer.name !== "Walk-in customer" && <p>Customer: {doc.buyer.name}{doc.buyer.phone ? ` (${doc.buyer.phone})` : ""}</p>}
      {doc.buyer.gstin && <p>GSTIN: {doc.buyer.gstin}</p>}
      <div className="my-1 border-t border-dashed border-black pt-1">
        {doc.lines.map((l, i) => (
          <div key={i} className="mb-0.5">
            <p>{l.description}</p>
            <p className="flex justify-between"><span>{Number(l.quantity)} × {formatPaise(Math.round((l.totalPaise ?? 0) / Math.max(Number(l.quantity), 0.001)))}</span><span className="tabular-nums">{formatPaise(l.totalPaise ?? 0)}</span></p>
            {l.serials && l.serials.length > 0 && <p className="text-[10px]">S/N {l.serials.join(", ")}</p>}
          </div>
        ))}
      </div>
      <div className="border-t border-dashed border-black pt-1">
        {row(`Items ${doc.lines.length} · Qty ${Number(qty.toFixed(3))}`, "")}
        {!s?.billOfSupply && !s?.unregistered && s?.gstin && (
          <>
            {row("Taxable", formatPaise(doc.taxablePaise))}
            {doc.igstPaise ? row("IGST", formatPaise(doc.igstPaise)) : <>{row("CGST", formatPaise(doc.cgstPaise))}{row("SGST", formatPaise(doc.sgstPaise))}</>}
          </>
        )}
        {!!doc.roundOffPaise && row("Round off", formatPaise(doc.roundOffPaise))}
        {row("TOTAL", formatPaise(doc.totalPaise), true)}
        {r.payments.map((p, i) => <React.Fragment key={i}>{row(`Paid ${TENDER_LABEL[p.method] ?? p.method}${p.reference ? ` (${p.reference})` : ""}`, formatPaise(p.amountPaise))}</React.Fragment>)}
        {doc.totalPaise - paid > 0 && row("Balance due", formatPaise(doc.totalPaise - paid), true)}
        {saved > 0 && <p className="mt-1 text-center">You saved {formatPaise(saved)}</p>}
      </div>
      {!s?.billOfSupply && s?.gstin && doc.lines.some((l) => l.gstRateBp) && (
        <div className="mt-1 border-t border-dashed border-black pt-1 text-[10px]">
          {[...new Set(doc.lines.map((l) => l.gstRateBp))].sort((a, b) => a - b).map((bp) => {
            const ls = doc.lines.filter((l) => l.gstRateBp === bp)
            const tax = ls.reduce((a, l) => a + (l.cgstPaise ?? 0) + (l.sgstPaise ?? 0) + (l.igstPaise ?? 0), 0)
            return <p key={bp} className="flex justify-between"><span>GST {bp / 100}% on {formatPaise(ls.reduce((a, l) => a + (l.taxablePaise ?? 0), 0))}</span><span>{formatPaise(tax)}</span></p>
          })}
        </div>
      )}
      <p className="mt-2 text-center">{pos?.note || "Thank you! Visit again."}</p>
      {pos && <p className="text-center text-[9px]">{pos.shift}</p>}
    </div>
  )
}

export default function PosReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { status } = useAuth()
  const [r, setR] = React.useState<PosReceipt | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [paper, setPaper] = React.useState<Paper>("80mm")
  React.useEffect(() => {
    if (status !== "authenticated") return
    api.get<PosReceipt>(`/pos/receipts/${id}`).then((d) => { setR(d); setPaper(d.pos?.paper ?? d.doc.seller?.paper ?? "80mm") }).catch((e) => setError(e.message))
  }, [status, id])
  React.useEffect(() => {
    if (!r || new URLSearchParams(window.location.search).get("auto") !== "1") return
    const t = setTimeout(() => {
      window.print()
      // The browser returns here once the print dialog is done
      if (window.opener) window.close()
    }, 300)
    return () => clearTimeout(t)
  }, [r])

  if (status === "anonymous") return <p className="p-8 text-sm">Please sign in to print this bill.</p>
  if (error) return <PageError error={new Error(error)} />
  if (!r) return <p className="p-8 text-sm text-neutral-500">Preparing receipt…</p>
  return (
    <div className="light-scope min-h-svh bg-neutral-100 print:bg-white">
      <style>{`@media print { @page { size: ${paper === "a4" ? "A4" : `${paper} auto`}; margin: ${paper === "a4" ? "12mm" : "2mm"}; } }`}</style>
      <div className="sticky top-0 flex flex-wrap items-center justify-center gap-2 border-b bg-white p-3 print:hidden">
        <div className="inline-flex rounded-full bg-neutral-100 p-1 text-sm text-neutral-900" role="radiogroup" aria-label="Paper size">
          {(["80mm", "58mm", "a4"] as const).map((f) => <button key={f} role="radio" aria-checked={paper === f} onClick={() => setPaper(f)} className={`rounded-full px-3 py-1 ${paper === f ? "bg-white font-medium shadow-sm" : ""}`}>{f === "a4" ? "A4" : f}</button>)}
        </div>
        <Button onClick={() => window.print()}><Printer /> Print</Button>
      </div>
      <div className="mx-auto max-w-[210mm] py-6 print:max-w-none print:py-0">
        {paper === "a4" ? <SalesDocView doc={r.doc} className="shadow-sm print:shadow-none" /> : <Thermal r={r} width={paper} />}
      </div>
    </div>
  )
}
