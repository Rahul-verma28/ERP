"use client"

import * as React from "react"
import { Award, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageError } from "@/components/page-states"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import type { HrAction } from "@/lib/hr"

// An award certificate to print or save as PDF and hand over.
export default function AwardCertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { status, me } = useAuth()
  const [a, setA] = React.useState<HrAction | null>(null)
  const [error, setError] = React.useState<Error | null>(null)

  React.useEffect(() => {
    if (status !== "authenticated") return
    api.get<HrAction>(`/hr/actions/${id}`).then(setA).catch(setError)
  }, [status, id])

  if (status === "anonymous") return <p className="p-8 text-sm">Please sign in to see this certificate.</p>
  if (error) return <PageError error={error} />
  if (!a) return <p className="p-8 text-sm text-neutral-500">Preparing certificate…</p>
  if (a.kind !== "award") return <p className="p-8 text-sm">This record is not an award.</p>
  const business = me?.tenant?.name ?? ""

  return (
    <div className="min-h-svh bg-neutral-100 print:bg-white">
      <div className="sticky top-0 flex justify-center border-b bg-white p-3 print:hidden">
        <Button onClick={() => window.print()}><Printer /> Print or save as PDF</Button>
      </div>
      <style>{"@page { size: A4 landscape; margin: 10mm }"}</style>
      <div className="mx-auto max-w-[297mm] p-6 print:max-w-none print:p-0">
        <article className="relative bg-white p-3 text-neutral-900 shadow-sm print:shadow-none">
          <div className="border-[6px] border-double border-amber-600 p-10 text-center sm:p-14">
            <Award className="mx-auto size-14 text-amber-600" strokeWidth={1.5} />
            <p className="mt-3 text-sm font-semibold tracking-[0.35em] text-amber-700 uppercase">{business}</p>
            <h1 className="mt-4 font-serif text-4xl font-bold tracking-wide sm:text-5xl">Certificate of Achievement</h1>
            <p className="mt-8 text-sm tracking-widest text-neutral-500 uppercase">This certificate is proudly presented to</p>
            <p className="mx-auto mt-3 w-fit border-b-2 border-neutral-300 px-10 pb-2 font-serif text-4xl font-semibold italic">{a.employee}</p>
            <p className="mt-2 text-sm text-neutral-500">{[a.employeeCode, a.employeeSub].filter(Boolean).join(" · ")}</p>
            <p className="mt-8 text-lg">for <strong className="text-amber-700">{a.typeName ?? "outstanding work"}</strong></p>
            {a.description && <p className="mx-auto mt-3 max-w-2xl text-base text-neutral-700">{a.description}</p>}
            <div className="mt-16 grid grid-cols-2 gap-16 px-6 text-sm sm:px-20">
              <div><p className="border-t border-neutral-400 pt-2 font-semibold">{formatDate(a.onDate)}</p><p className="text-neutral-500">Date</p></div>
              <div><p className="border-t border-neutral-400 pt-2 font-semibold">{a.createdByName ?? " "}</p><p className="text-neutral-500">For {business}</p></div>
            </div>
          </div>
        </article>
      </div>
    </div>
  )
}
