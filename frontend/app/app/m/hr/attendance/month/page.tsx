"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { PageError, PageLoading, NoAccessPage } from "@/components/page-states"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { todayInIndia } from "@contracts/validation"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { downloadCsv } from "@/lib/csv"
import { ATT, DAY_NAMES, monthLabel } from "@/lib/hr"
import { cn } from "@/lib/utils"

// The monthly register (muster roll): one letter per person per day, with totals.

interface Month { month: string; days: string[]; holidays: { name: string; from: string; to: string }[]; workingDays: number[]; data: { id: string; code: string; name: string; cells: string[]; totals: { present: number; absent: number; half_day: number; leave: number; holiday: number; week_off: number; unmarked: number; late: number; workedMinutes: number; overtimeMinutes: number } }[] }

const shiftMonth = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7) }
const CELL: Record<string, string> = {
  present: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  absent: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
  half_day: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  leave: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
  holiday: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200",
  week_off: "bg-muted text-muted-foreground",
  unmarked: "text-muted-foreground",
}

export default function MonthRegisterPage() {
  const { can } = useAuth()
  const [month, setMonth] = React.useState(todayInIndia().slice(0, 7))
  const [q, setQ] = React.useState("")
  const { data, error, reload } = useApi<Month>(can("hr.attendance.view") ? `/hr/attendance/month?month=${month}` : null)
  if (!can("hr.attendance.view")) return <NoAccessPage title="Monthly register" permission="hr.attendance.view" />
  const rows = (data?.data ?? []).filter((r) => !q || `${r.name} ${r.code}`.toLowerCase().includes(q.toLowerCase()))
  const exportCsv = () => data && downloadCsv(`attendance-${month}.csv`, [["ID", "Employee", ...data.days.map((d) => d.slice(8)), "Present", "Half days", "Absent", "Leave", "Holidays", "Weekly offs", "Late"], ...rows.map((r) => [r.code, r.name, ...r.cells.map((c) => ATT[c]?.short ?? ""), r.totals.present, r.totals.half_day, r.totals.absent, r.totals.leave, r.totals.holiday, r.totals.week_off, r.totals.late])])

  return (
    <>
      <HrTabs tabs={TABS.attendance} active="month" />
      <div className="grid gap-4">
        <PageHeader
          title="Monthly register"
          description="The muster roll for the month. Open a person to see their days."
          actions={<div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft /></Button>
            <span className="w-40 text-center text-sm font-semibold">{monthLabel(month)}</span>
            <Button variant="outline" size="icon" aria-label="Next month" disabled={month >= todayInIndia().slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight /></Button>
            <Button variant="outline" onClick={exportCsv} disabled={!data}><Download /> CSV</Button>
          </div>}
        />
        {error ? <PageError error={error} onRetry={() => void reload()} /> : !data ? <PageLoading /> : (
          <section className="ui-surface overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="relative w-full max-w-xs"><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or ID" className="pl-9" aria-label="Search" /></div>
              <p className="flex flex-wrap gap-2 text-xs">{["present", "absent", "half_day", "leave", "holiday", "week_off"].map((k) => <span key={k} className={cn("rounded px-1.5 py-0.5 font-semibold", CELL[k])}>{ATT[k].short} {ATT[k].label}</span>)}<span className="text-muted-foreground">· not marked</span></p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="sticky left-0 z-10 min-w-44 bg-muted px-3 py-2 text-left font-medium">Employee</th>
                    {data.days.map((d) => { const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); return <th key={d} className={cn("min-w-8 px-0.5 py-2 text-center font-medium", !data.workingDays.includes(dow) && "text-muted-foreground/60")}><span className="block">{Number(d.slice(8))}</span><span className="block text-[10px] font-normal">{DAY_NAMES[dow][0]}</span></th> })}
                    <th className="px-2 py-2 text-right font-medium">P</th><th className="px-2 py-2 text-right font-medium">A</th><th className="px-2 py-2 text-right font-medium">L</th><th className="px-2 py-2 text-right font-medium">Late</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="sticky left-0 z-10 bg-card px-3 py-1.5"><Link href={`/app/m/hr/employees/${r.id}?tab=attendance`} className="block truncate font-medium hover:underline">{r.name}</Link><span className="font-mono text-[10px] text-muted-foreground">{r.code}</span></td>
                      {r.cells.map((c, i) => <td key={i} className="px-0.5 py-1 text-center"><span title={`${data.days[i]}: ${ATT[c]?.label ?? ""}`} className={cn("inline-grid h-6 w-7 place-items-center rounded text-[10px] font-semibold", CELL[c])}>{c === "unmarked" ? "·" : ATT[c]?.short}</span></td>)}
                      <td className="px-2 py-1 text-right font-semibold tabular-nums">{r.totals.present + r.totals.half_day / 2}</td>
                      <td className={cn("px-2 py-1 text-right tabular-nums", r.totals.absent && "font-semibold text-destructive")}>{r.totals.absent}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.totals.leave}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.totals.late}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={data.days.length + 5} className="p-8 text-center text-sm text-muted-foreground">Nobody worked here in {monthLabel(month)}.</td></tr>}
                </tbody>
              </table>
            </div>
            {data.holidays.length > 0 && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">Holidays: {data.holidays.map((h) => `${h.name} (${Number(h.from.slice(8))})`).join(", ")}</p>}
          </section>
        )}
      </div>
    </>
  )
}
