"use client"

import * as React from "react"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageError } from "@/components/page-states"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { amountInWords } from "@/lib/money"
import { monthLabel, type Payslip } from "@/lib/hr"

// A payslip to print, save as PDF or hand over.
export default function PayslipPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { status, me } = useAuth()
  const [p, setP] = React.useState<Payslip | null>(null)
  const [error, setError] = React.useState<Error | null>(null)

  React.useEffect(() => {
    if (status !== "authenticated") return
    api.get<Payslip>(`/hr/payslips/${id}`).then(setP).catch(setError)
  }, [status, id])

  if (status === "anonymous") return <p className="p-8 text-sm">Please sign in to see this payslip.</p>
  if (error) return <PageError error={error} />
  if (!p) return <p className="p-8 text-sm text-neutral-500">Preparing payslip…</p>
  const s = p.snapshot
  const month = p.run?.month ?? ""
  const rows = Math.max(p.earnings.length, p.deductions.length)

  return (
    <div className="min-h-svh bg-neutral-100 print:bg-white">
      <div className="sticky top-0 flex justify-center border-b bg-white p-3 print:hidden">
        <Button onClick={() => window.print()}><Printer /> Print or save as PDF</Button>
      </div>
      <div className="mx-auto max-w-[210mm] py-6 print:max-w-none print:py-0">
        <article className="bg-white p-6 text-sm text-neutral-900 shadow-sm sm:p-10 print:shadow-none">
          <header className="flex flex-wrap items-start justify-between gap-6 border-b border-neutral-200 pb-5">
            <div>
              <p className="text-lg font-semibold">{p.company?.name ?? me?.tenant?.name}</p>
              {me?.tenant?.gstin && <p className="text-neutral-600">GSTIN: <span className="font-mono">{me.tenant.gstin}</span></p>}
            </div>
            <div className="text-right">
              <p className="text-xl font-semibold tracking-tight uppercase">Payslip</p>
              <p className="text-neutral-600">{month && monthLabel(month)}</p>
              <p className="font-mono text-xs text-neutral-500">{p.number}</p>
            </div>
          </header>
          {p.run?.status === "draft" && <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">Draft: this payroll is not processed yet, the numbers may change.</p>}

          <section className="grid gap-x-8 gap-y-1.5 border-b border-neutral-200 py-5 sm:grid-cols-2">
            {([
              ["Employee", s?.name], ["Employee ID", s?.code], ["Designation", s?.designation], ["Department", s?.department],
              ["Date of joining", s?.joinedOn ? formatDate(s.joinedOn) : null], ["PAN", s?.pan], ["UAN", s?.uan], ["ESI number", s?.esiNo],
              ["Bank", s?.bank?.bankName], ["Account", s?.bank?.accountNo ? `•••• ${s.bank.accountNo.slice(-4)}` : null],
              ["Days in month", p.daysInMonth], ["Days paid", `${p.payableDays}${p.lopDays ? ` (loss of pay ${p.lopDays})` : ""}`],
            ] as [string, React.ReactNode][]).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
              <p key={k} className="flex justify-between gap-3"><span className="text-neutral-500">{k}</span><span className="text-right font-medium">{v}</span></p>
            ))}
          </section>

          <table className="mt-5 w-full border border-neutral-200 text-sm">
            <thead className="bg-neutral-50 text-xs text-neutral-600 uppercase">
              <tr><th className="border-b px-3 py-2 text-left font-semibold">Earnings</th><th className="border-b px-3 py-2 text-right font-semibold">Amount</th><th className="border-b border-l px-3 py-2 text-left font-semibold">Deductions</th><th className="border-b px-3 py-2 text-right font-semibold">Amount</th></tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, i) => {
                const e = p.earnings[i]
                const d = p.deductions[i]
                return (
                  <tr key={i}>
                    <td className="px-3 py-1.5">{e?.name ?? ""}</td><td className="px-3 py-1.5 text-right tabular-nums">{e ? formatPaise(e.amountPaise) : ""}</td>
                    <td className="border-l px-3 py-1.5">{d?.name ?? ""}</td><td className="px-3 py-1.5 text-right tabular-nums">{d ? formatPaise(d.amountPaise) : ""}</td>
                  </tr>
                )
              })}
              <tr className="border-t bg-neutral-50 font-semibold"><td className="px-3 py-2">Gross earnings</td><td className="px-3 py-2 text-right tabular-nums">{formatPaise(p.grossPaise)}</td><td className="border-l px-3 py-2">Total deductions</td><td className="px-3 py-2 text-right tabular-nums">{formatPaise(p.deductionsPaise)}</td></tr>
            </tbody>
          </table>

          <section className="mt-5 flex flex-wrap items-end justify-between gap-4 rounded border border-neutral-300 bg-neutral-50 p-4">
            <div><p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Net pay</p><p className="text-2xl font-bold tabular-nums">{formatPaise(p.netPaise)}</p><p className="text-neutral-600">{amountInWords(p.netPaise)}</p></div>
            <p className="text-right text-neutral-600">{p.status === "paid" && p.paidOn ? `Paid on ${formatDate(p.paidOn)}` : p.run?.payDate ? `Pay date ${formatDate(p.run.payDate)}` : ""}</p>
          </section>
          {p.employer.length > 0 && <p className="mt-3 text-xs text-neutral-500">Paid by the employer on top of this: {p.employer.map((x) => `${x.name} ${formatPaise(x.amountPaise)}`).join(", ")}.</p>}
          <p className="mt-10 text-center text-xs text-neutral-400">This is a computer-made payslip and does not need a signature.</p>
        </article>
      </div>
    </div>
  )
}
