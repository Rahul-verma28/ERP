"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar } from "@/components/page-parts"
import { useApi } from "@/lib/use-api"
import { todayInIndia } from "@contracts/validation"
import { tone } from "@/lib/tones"
import { cn } from "@/lib/utils"
import { DAY_NAMES } from "@/lib/hr"

// Who is away this week: one row per employee, one column per day, with their leave on it.
// Approved leave is solid, a waiting request is striped. One request loads the whole week.

interface Week {
  start: string; end: string; today: string; onLeave: number
  days: { date: string; weekday: number; working: boolean; holiday: string | null }[]
  employees: { id: string; name: string; code: string; designation: string | null; leaves: { id: string; from: string; to: string; status: string; halfDay: boolean; days: number; type: string; code: string; color: string }[] }[]
}

const monday = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) }
const shift = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const label = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`

export function LeaveWeek({ version, onOpen }: { version: number; onOpen?: (leaveId: string) => void }) {
  const [start, setStart] = React.useState(() => monday(todayInIndia()))
  const [onlyAway, setOnlyAway] = React.useState(false)
  const { data } = useApi<Week>(`/hr/leave-week?start=${start}&v=${version}`)
  const rows = (data?.employees ?? []).filter((e) => !onlyAway || e.leaves.length)
  return (
    <section className="ui-surface overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous week" onClick={() => setStart(shift(start, -7))}><ChevronLeft /></Button>
          <Button variant="outline" size="icon-sm" aria-label="Next week" onClick={() => setStart(shift(start, 7))}><ChevronRight /></Button>
        </div>
        <h2 className="font-semibold">{label(start)} – {label(shift(start, 6))} {start.slice(0, 4)}</h2>
        <Button variant="ghost" size="sm" onClick={() => setStart(monday(todayInIndia()))}>This week</Button>
        <span className="text-sm text-muted-foreground">{data ? `${data.employees.filter((e) => e.leaves.length).length} away this week` : ""}</span>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={onlyAway} onChange={(e) => setOnlyAway(e.target.checked)} /> Only people on leave</label>
      </header>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b">
              <th className="sticky left-0 z-10 w-56 bg-card px-4 py-2 text-left text-xs font-medium text-muted-foreground">Employee</th>
              {(data?.days ?? Array.from({ length: 7 }, (_, i) => ({ date: shift(start, i), weekday: (i + 1) % 7, working: true, holiday: null }))).map((d) => (
                <th key={d.date} className={cn("border-l px-2 py-2 text-center font-medium", d.date === data?.today && "bg-primary/10 text-primary", !d.working && "text-muted-foreground/70")}>
                  <span className="block text-base leading-tight">{Number(d.date.slice(8))}</span>
                  <span className="block text-[11px] font-normal">{DAY_NAMES[d.weekday]}</span>
                  {d.holiday && <span className="mt-0.5 block truncate rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200" title={d.holiday}>{d.holiday}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {!data ? <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading the week…</td></tr> : rows.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Nobody is on leave this week.</td></tr> : rows.map((e) => (
              <tr key={e.id}>
                <td className="sticky left-0 z-[1] bg-card px-4 py-2"><span className="flex items-center gap-2.5"><Avatar name={e.name} className="size-7" /><span className="min-w-0"><span className="block truncate font-medium">{e.name}</span><span className="block truncate text-xs text-muted-foreground">{e.designation ?? e.code}</span></span></span></td>
                {data.days.map((d) => {
                  const l = e.leaves.find((x) => x.from <= d.date && x.to >= d.date)
                  return (
                    <td key={d.date} className={cn("h-12 border-l px-1 py-1 align-middle", d.date === data.today && "bg-primary/5", (!d.working || d.holiday) && "bg-muted/40")}>
                      {l && (
                        <button type="button" onClick={() => onOpen?.(l.id)} title={`${l.type} · ${l.status === "approved" ? "approved" : "waiting"}${l.halfDay ? " · half day" : ""}`}
                          className={cn("flex h-8 w-full items-center justify-center rounded-lg px-1 text-[11px] font-semibold text-white", tone(l.color).dot, l.status !== "approved" && "opacity-60 [background-image:repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,.35)_4px,rgba(255,255,255,.35)_8px)]")}>
                          <span className="truncate">{l.code || l.type}{l.halfDay ? " ½" : ""}</span>
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="flex flex-wrap gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-emerald-500" /> Approved</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-emerald-500 opacity-60 [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,.4)_3px,rgba(255,255,255,.4)_6px)]" /> Waiting for approval</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded bg-muted" /> Weekly off or holiday</span>
      </footer>
    </section>
  )
}
