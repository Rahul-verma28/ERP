"use client"

import * as React from "react"
import { IndianRupee, Printer } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { formatPaise } from "@/lib/format"
import { SalesDocView, type ViewDoc } from "@/components/sales-doc-view"
import { api } from "@/lib/api"

// Public share link for an issued invoice or a sent quotation (BIL-01 "share link").
export default function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = React.use(params)
  const [doc, setDoc] = React.useState<ViewDoc | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    api.get<ViewDoc>(`/public/documents/${token}`).then(setDoc).catch((e) => setError(e.message))
  }, [token])

  if (error) return <div className="grid min-h-svh place-items-center bg-neutral-100 p-6 text-sm text-neutral-700">This link is no longer available.</div>
  if (!doc) return <div className="grid min-h-svh place-items-center bg-neutral-100 p-6 text-sm text-neutral-500">Loading…</div>

  // Opens the customer's UPI app with the amount filled in; the business still records the payment
  const due = doc.kind === "invoice" && doc.status !== "cancelled" ? doc.totalPaise - doc.paidPaise : 0
  const upi = doc.seller?.upiId && due > 0
    ? `upi://pay?${new URLSearchParams({ pa: doc.seller.upiId, pn: (doc.seller.legalName || doc.seller.name).slice(0, 50), cu: "INR", am: (due / 100).toFixed(2), ...(doc.number ? { tn: doc.number.slice(0, 50) } : {}) })}`
    : null

  return (
    <div className="min-h-svh bg-neutral-100 px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap justify-end gap-2 print:hidden">
        {upi && <a href={upi} className={buttonVariants()}><IndianRupee /> Pay {formatPaise(due)} by UPI</a>}
        <Button variant={upi ? "outline" : "default"} onClick={() => window.print()}><Printer /> Download PDF</Button>
      </div>
      <div className="mx-auto max-w-[210mm] overflow-hidden rounded-3xl shadow-sm print:rounded-none print:shadow-none">
        <SalesDocView doc={doc} />
      </div>
    </div>
  )
}
