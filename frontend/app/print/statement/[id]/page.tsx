"use client"

import * as React from "react"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ledgerBalance, ledgerDocument, type Ledger } from "@/components/customer-ledger"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { PageError } from "@/components/page-states"

// Customer statement for printing or saving as PDF.
export default function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { id } = React.use(params)
  const { from, to } = React.use(searchParams)
  const { status, me } = useAuth()
  const [data, setData] = React.useState<Ledger | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (status !== "authenticated") return
    const query = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()
    api.get<Ledger>(`/customers/${id}/ledger${query ? `?${query}` : ""}`).then(setData).catch((e) => setError(e.message))
  }, [status, id, from, to])

  if (status === "anonymous") return <p className="p-8 text-sm">Please sign in to print this statement.</p>
  if (error) return <PageError error={new Error(error)} />
  if (!data) return <p className="p-8 text-sm text-neutral-500">Preparing statement…</p>

  const debit = data.rows.reduce((s, r) => s + r.debitPaise, 0)
  const credit = data.rows.reduce((s, r) => s + r.creditPaise, 0)

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
              <p className="text-xl font-semibold tracking-tight uppercase">Statement of account</p>
              <p className="text-neutral-600">{data.from ? `${formatDate(data.from)} to ${formatDate(data.to ?? new Date())}` : "All time"}</p>
            </div>
          </header>
          <section className="border-b border-neutral-200 py-5">
            <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Customer</p>
            <p className="mt-1 font-medium">{data.contact.name}</p>
            {data.contact.gstin && <p className="text-neutral-600">GSTIN: <span className="font-mono">{data.contact.gstin}</span></p>}
            {data.contact.phone && <p className="text-neutral-600">{data.contact.phone}</p>}
          </section>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-300 text-xs text-neutral-500">
                <th className="py-2 pr-2 font-medium">Date</th>
                <th className="py-2 pr-2 font-medium">Document</th>
                <th className="py-2 pr-2 text-right font-medium">Debit</th>
                <th className="py-2 pr-2 text-right font-medium">Credit</th>
                <th className="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.broughtForwardPaise !== 0 && (
                <tr className="border-b border-neutral-100 text-neutral-600">
                  <td className="py-2 pr-2">{data.from ? formatDate(data.from) : ""}</td>
                  <td className="py-2 pr-2" colSpan={3}>Brought forward</td>
                  <td className="py-2 text-right tabular-nums">{ledgerBalance(data.broughtForwardPaise)}</td>
                </tr>
              )}
              {data.rows.map((r) => {
                const doc = ledgerDocument(r)
                return (
                  <tr key={r.id} className="border-b border-neutral-100 align-top">
                    <td className="py-2 pr-2 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="py-2 pr-2">{doc.label}{doc.number && <span className="ml-2 font-mono text-xs text-neutral-500">{doc.number}</span>}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.debitPaise ? formatPaise(r.debitPaise) : ""}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{r.creditPaise ? formatPaise(r.creditPaise) : ""}</td>
                    <td className="py-2 text-right tabular-nums">{ledgerBalance(r.balancePaise)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <dl className="mt-5 ml-auto grid w-full max-w-xs gap-1">
            <div className="flex justify-between"><dt className="text-neutral-500">Total debit</dt><dd className="tabular-nums">{formatPaise(debit)}</dd></div>
            <div className="flex justify-between"><dt className="text-neutral-500">Total credit</dt><dd className="tabular-nums">{formatPaise(credit)}</dd></div>
            <div className="flex justify-between border-t border-neutral-300 pt-2 text-base font-semibold"><dt>{data.closingPaise < 0 ? "In your favour" : "Balance due"}</dt><dd className="tabular-nums">{ledgerBalance(data.closingPaise)}</dd></div>
          </dl>
          <p className="mt-8 text-center text-[11px] text-neutral-400">This is a computer-generated statement.</p>
        </article>
      </div>
    </div>
  )
}
