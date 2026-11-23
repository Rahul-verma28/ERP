"use client"

import * as React from "react"
import Link from "next/link"
import { CalendarDays, Download, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { PageError, PageLoading, NoAccessPage } from "@/components/page-states"
import { Avatar } from "@/components/page-parts"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { downloadCsv } from "@/lib/csv"
import { formatDate } from "@/lib/format"
import { tone } from "@/lib/tones"
import { cn } from "@/lib/utils"

// Leave balances as one card per employee: each leave type with total, used, waiting and available.

interface Bal { year: { from: string; to: string }; types: { id: string; name: string; code: string; color: string; paid: boolean; daysPerYear: number }[]; data: Row[] }
interface Row { id: string; code: string; name: string; leave: { typeId: string; allowed: number; used: number; pending: number; left: number | null }[] }

export default function LeaveBalancesPage() {
  const { can } = useAuth()
  const { data, error, reload } = useApi<Bal>(can("hr.leave.view") ? "/hr/leave-balances" : null)
  const [q, setQ] = React.useState("")
  if (!can("hr.leave.view")) return <NoAccessPage title="Leave balance" permission="hr.leave.view" />
  const rows = (data?.data ?? []).filter((r) => !q || `${r.name} ${r.code}`.toLowerCase().includes(q.toLowerCase()))
  const exportCsv = () => data && downloadCsv("leave-balances.csv", [["ID", "Employee", ...data.types.flatMap((t) => [`${t.code} total`, `${t.code} used`, `${t.code} left`])], ...rows.map((r) => [r.code, r.name, ...data.types.flatMap((t) => { const l = r.leave.find((x) => x.typeId === t.id); return [l?.allowed ?? 0, l?.used ?? 0, l?.left ?? ""] })])])
  return (
    <>
      <HrTabs tabs={TABS.leave} active="balances" />
      <div className="grid gap-4">
        <PageHeader title="Leave balance" description={data ? `Allowed, used and available leave for each employee, leave year ${formatDate(data.year.from)} – ${formatDate(data.year.to)}.` : "Allowed, used and available leave for each employee."} />
        <div className="ui-surface flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="relative w-full max-w-sm"><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee name or code" className="pl-9" aria-label="Search" /></div>
          <Button variant="outline" onClick={exportCsv} disabled={!data}><Download /> CSV</Button>
        </div>
        {error ? <PageError error={error} onRetry={() => void reload()} /> : !data ? <PageLoading /> : rows.length === 0 ? <section className="ui-surface"><EmptyState icon={CalendarDays} title="No employees here" /></section> : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {rows.map((r) => (
              <section key={r.id} className="ui-surface overflow-hidden">
                <header className="flex items-center gap-3 border-b px-4 py-3"><Avatar name={r.name} /><span className="min-w-0"><Link href={`/app/m/hr/employees/${r.id}?tab=leave`} className="block truncate font-semibold hover:underline">{r.name}</Link><span className="font-mono text-xs text-muted-foreground">{r.code}</span></span></header>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground"><tr className="border-b"><th className="px-4 py-2 text-left font-medium">Leave type</th><th className="px-2 py-2 text-right font-medium">Total</th><th className="px-2 py-2 text-right font-medium">Used</th><th className="px-4 py-2 text-right font-medium">Available</th></tr></thead>
                  <tbody className="divide-y">
                    {data.types.map((t) => {
                      const l = r.leave.find((x) => x.typeId === t.id)
                      return (
                        <tr key={t.id}>
                          <td className="px-4 py-2"><span className="flex items-center gap-2"><span className={cn("size-2 rounded-full", tone(t.color).dot)} />{t.name}{l?.pending ? <span className="text-xs text-amber-700 dark:text-amber-300">({l.pending} waiting)</span> : null}</span></td>
                          <td className="px-2 py-2 text-right tabular-nums">{t.daysPerYear || "∞"}</td>
                          <td className={cn("px-2 py-2 text-right tabular-nums", l?.used ? "text-rose-600 dark:text-rose-300" : "text-muted-foreground")}>{l?.used ?? 0}</td>
                          <td className={cn("px-4 py-2 text-right font-semibold tabular-nums", l?.left === 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300")}>{l?.left ?? "∞"}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
