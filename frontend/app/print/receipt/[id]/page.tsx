"use client"

import * as React from "react"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KIND_LABEL, methodLabel, type Receipt } from "@/components/receive-payment"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { amountInWords } from "@/lib/money"
import { PageError } from "@/components/page-states"

// Payment receipt for printing, saving as PDF, or opening from the WhatsApp link.
export default function ReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { status, me } = useAuth()
  const [r, setR] = React.useState<Receipt | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (status !== "authenticated") return
    api.get<Receipt>(`/payments/${id}`).then(setR).catch((e) => setError(e.message))
  }, [status, id])

  if (status === "anonymous") return <p className="p-8 text-sm">Please sign in to see this receipt.</p>
  if (error) return <PageError error={new Error(error)} />
  if (!r) return <p className="p-8 text-sm text-neutral-500">Preparing receipt…</p>

  return (
    <div className="min-h-svh bg-neutral-100 print:bg-white">
      <div className="sticky top-0 flex justify-center border-b bg-white p-3 print:hidden">
        <Button onClick={() => window.print()}><Printer /> Print or save as PDF</Button>
      </div>
      <div className="mx-auto max-w-[210mm] py-6 print:max-w-none print:py-0">
        <article className="bg-white p-6 text-sm text-neutral-900 shadow-sm sm:p-10 print:shadow-none">
          <header className="flex flex-wrap items-start justify-between gap-6 border-b border-neutral-200 pb-6">
            <div>
              <p className="text-lg font-semibold">{me?.tenant?.name}</p>
              {me?.tenant?.gstin && <p className="text-neutral-600">GSTIN: <span className="font-mono">{me.tenant.gstin}</span></p>}
            </div>
            <div className="text-right">
              <p className="text-xl font-semibold tracking-tight uppercase">Payment receipt</p>
              <p className="font-mono text-neutral-600">{r.number}</p>
              <p className="text-neutral-600">{formatDate(r.paidOn)}</p>
            </div>
          </header>
          {r.reversed && <p className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-700">This receipt was reversed on {formatDate(r.reversal!.paidOn)} ({r.reversal?.number}).</p>}
          <section className="grid gap-4 border-b border-neutral-200 py-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Received from</p>
              <p className="mt-1 font-medium">{r.customer ?? "Customer"}</p>
              {r.customerPhone && <p className="text-neutral-600">{r.customerPhone}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Amount received</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatPaise(r.amountPaise)}</p>
              <p className="text-neutral-600">{amountInWords(r.amountPaise)}</p>
              <p className="text-neutral-600">By {methodLabel(r.method)}{r.reference ? ` · Ref ${r.reference}` : ""}</p>
            </div>
          </section>
          <table className="mt-4 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-300 text-xs text-neutral-500">
                <th className="py-2 pr-2 font-medium">Against</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.appliedTo.map((a) => (
                <tr key={a.id} className="border-b border-neutral-100">
                  <td className="py-2 pr-2">{KIND_LABEL[a.kind] ?? "Bill"} <span className="ml-1 font-mono text-xs text-neutral-600">{a.number}</span></td>
                  <td className="py-2 text-right tabular-nums">{formatPaise(a.amountPaise)}</td>
                </tr>
              ))}
              {r.unusedPaise > 0 && (
                <tr className="border-b border-neutral-100">
                  <td className="py-2 pr-2">Advance, for later bills</td>
                  <td className="py-2 text-right tabular-nums">{formatPaise(r.unusedPaise)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {r.notes && <p className="mt-4 text-neutral-600">Note: {r.notes}</p>}
          <footer className="mt-16 flex justify-between text-xs text-neutral-500">
            <p>This is a computer-made receipt.</p>
            <p className="border-t border-neutral-400 pt-1">For {me?.tenant?.name}</p>
          </footer>
        </article>
      </div>
    </div>
  )
}
