"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CalendarCheck, CheckCheck, ChevronLeft, ChevronRight, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { PageError, PageLoading } from "@/components/page-states"
import { Avatar, Pill, StatGrid } from "@/components/page-parts"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate } from "@/lib/format"
import { DAY_NAMES } from "@/lib/hr"
import { cn } from "@/lib/utils"

// Daily attendance: everyone working that day on one screen. Tap P / A / H / WO, add in and out
// times if you keep them, and save. Days left unmarked are paid as worked.

type Mark = "present" | "absent" | "half_day" | "week_off"
interface DayRow { id: string; employeeId: string; code: string; name: string; department: string | null; shift: string | null; status: string | null; attendance: { status: string; clockIn: string | null; clockOut: string | null; lateMinutes: number; workedMinutes: number; source: string; notes: string | null } | null }
interface Day { date: string; working: boolean; holiday: string | null; weekOff: boolean; data: DayRow[]; counts: { total: number; present: number; half_day: number; absent: number; leave: number; unmarked: number; late: number } }
interface Edit { status: Mark | null; clockIn: string; clockOut: string; notes: string }

const shift = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const BUTTONS: [Mark, string, string][] = [["present", "P", "Present"], ["absent", "A", "Absent"], ["half_day", "H", "Half day"], ["week_off", "WO", "Weekly off"]]
const ON: Record<Mark, string> = { present: "bg-emerald-600 text-white border-emerald-600", absent: "bg-rose-600 text-white border-rose-600", half_day: "bg-amber-500 text-white border-amber-500", week_off: "bg-slate-500 text-white border-slate-500" }

export default function AttendancePage() {
  const { can } = useAuth()
  const today = todayInIndia()
  const [date, setDate] = React.useState(today)
  const { data, error, reload } = useApi<Day>(can("hr.attendance.view") ? `/hr/attendance/day?date=${date}` : null)
  const [edits, setEdits] = React.useState<Record<string, Edit>>({})
  const [q, setQ] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  // A new day starts with no unsaved marks
  const go = (d: string) => { setDate(d); setEdits({}) }
  if (!can("hr.attendance.view")) return <PageHeader title="Attendance" description="You don't have access to attendance. Ask your admin." />
  const edit = can("hr.attendance.edit")
  const changed = Object.keys(edits).length

  const current = (r: DayRow): Edit => edits[r.id] ?? { status: (r.attendance && r.attendance.source !== "leave" ? r.attendance.status : null) as Mark | null, clockIn: r.attendance?.clockIn ?? "", clockOut: r.attendance?.clockOut ?? "", notes: r.attendance?.notes ?? "" }
  const change = (r: DayRow, patch: Partial<Edit>) => setEdits((x) => ({ ...x, [r.id]: { ...current(r), ...patch } }))
  const markRest = () => {
    if (!data) return
    const next = { ...edits }
    for (const r of data.data) if (!r.status && !next[r.id] && r.attendance?.source !== "leave") next[r.id] = { status: "present", clockIn: "", clockOut: "", notes: "" }
    setEdits(next)
  }

  async function save() {
    const rows = Object.entries(edits).filter(([, e]) => e.status).map(([employeeId, e]) => ({ employeeId, status: e.status!, clockIn: e.clockIn || null, clockOut: e.clockOut || null, notes: e.notes.trim() || null }))
    if (!rows.length) return toast.error("Mark at least one person")
    const bad = rows.find((r) => r.clockIn && r.clockOut && r.clockIn === r.clockOut)
    if (bad) return toast.error("Clock-out must be different from clock-in")
    setBusy(true)
    try {
      const r = await api.post<{ saved: number }>("/hr/attendance", { date, rows })
      toast.success(`Attendance saved for ${r.saved} ${r.saved === 1 ? "person" : "people"}`)
      setEdits({})
      await reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const rows = (data?.data ?? []).filter((r) => !q || `${r.name} ${r.code} ${r.department ?? ""}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <HrTabs tabs={TABS.attendance} active="day" />
      <div className="grid gap-4">
        <PageHeader
          title="Attendance"
          description="Tap a letter for each person, then save. Days left unmarked are paid as worked."
          actions={<div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => go(shift(date, -1))}><ChevronLeft /></Button>
            <Input type="date" aria-label="Date" className="w-40" value={date} max={today} onChange={(e) => e.target.value && go(e.target.value)} />
            <Button variant="outline" size="icon" aria-label="Next day" disabled={date >= today} onClick={() => go(shift(date, 1))}><ChevronRight /></Button>
          </div>}
        />
        {error ? <PageError error={error} onRetry={() => void reload()} /> : !data ? <PageLoading /> : <>
          <StatGrid items={[
            { label: `${DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()]}, ${formatDate(date)}`, value: data.holiday ? data.holiday : data.weekOff ? "Weekly off" : `${data.counts.total} working`, hint: data.holiday ? "Holiday" : undefined },
            { label: "Present", value: data.counts.present + data.counts.half_day, hint: data.counts.half_day ? `${data.counts.half_day} half day` : data.counts.late ? `${data.counts.late} late` : undefined, accent: "text-emerald-700 dark:text-emerald-300" },
            { label: "Absent", value: data.counts.absent, accent: data.counts.absent ? "text-destructive" : undefined },
            { label: "On leave · not marked", value: `${data.counts.leave} · ${data.counts.unmarked}` },
          ]} />
          <section className="ui-surface overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div className="relative w-full max-w-xs"><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID or department" className="pl-9" aria-label="Search" /></div>
              {edit && <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={markRest} disabled={!data.counts.unmarked}><CheckCheck /> Everyone else present</Button>
                <Button onClick={() => void save()} disabled={busy || !changed}>{busy ? "Saving…" : changed ? `Save ${changed} change${changed === 1 ? "" : "s"}` : "Saved"}</Button>
              </div>}
            </div>
            {data.data.length === 0 ? <EmptyState icon={CalendarCheck} title="Nobody working on this day" description="Add employees first, with their joining date." action={<Link href="/app/m/hr/employees/new" className="text-sm text-primary hover:underline">Add employee</Link>} /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-4 py-2.5 text-left font-medium">Employee</th><th className="px-4 py-2.5 text-left font-medium">Mark</th><th className="px-4 py-2.5 text-left font-medium">In</th><th className="px-4 py-2.5 text-left font-medium">Out</th><th className="px-4 py-2.5 text-left font-medium">Note</th></tr></thead>
                  <tbody className="divide-y">
                    {rows.map((r) => {
                      const e = current(r)
                      const onLeave = r.attendance?.source === "leave"
                      const timed = e.status === "present" || e.status === "half_day"
                      return (
                        <tr key={r.id} className={cn(edits[r.id] && "bg-primary/5")}>
                          <td className="px-4 py-2.5"><span className="flex items-center gap-2.5"><Avatar name={r.name} className="size-8" /><span className="min-w-0"><Link href={`/app/m/hr/employees/${r.id}`} className="block truncate font-medium hover:underline">{r.name}</Link><span className="block truncate text-xs text-muted-foreground">{[r.code, r.shift].filter(Boolean).join(" · ")}</span></span></span></td>
                          <td className="px-4 py-2.5">
                            {onLeave ? <Pill color="violet">{r.attendance?.notes ?? "On leave"}</Pill> : (
                              <span className="inline-flex gap-1" role="radiogroup" aria-label={`Attendance of ${r.name}`}>
                                {BUTTONS.map(([k, short, label]) => <button key={k} type="button" role="radio" aria-checked={e.status === k} title={label} disabled={!edit} onClick={() => change(r, { status: e.status === k ? null : k })} className={cn("h-8 min-w-9 rounded-lg border px-2 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60", e.status === k && ON[k])}>{short}</button>)}
                                {(r.attendance?.lateMinutes ?? 0) > 0 && !edits[r.id] && <Pill color="orange" className="ml-1">Late {r.attendance!.lateMinutes}m</Pill>}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5"><Input type="time" className="h-8 w-28" value={e.clockIn} disabled={!edit || onLeave || !timed} onChange={(x) => change(r, { clockIn: x.target.value, status: e.status ?? "present" })} aria-label={`In time of ${r.name}`} /></td>
                          <td className="px-4 py-2.5"><Input type="time" className="h-8 w-28" value={e.clockOut} disabled={!edit || onLeave || !timed} onChange={(x) => change(r, { clockOut: x.target.value, status: e.status ?? "present" })} aria-label={`Out time of ${r.name}`} /></td>
                          <td className="px-4 py-2.5"><Input className="h-8" value={e.notes} maxLength={300} disabled={!edit || onLeave} onChange={(x) => change(r, { notes: x.target.value })} placeholder={e.status === "absent" ? "e.g. Informed, unwell" : "Optional"} aria-label={`Note for ${r.name}`} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="flex flex-wrap gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">{BUTTONS.map(([k, s, l]) => <span key={k}><strong>{s}</strong> {l}</span>)}<span>· Leave is marked by approving it in Leave.</span></p>
          </section>
        </>}
      </div>
    </>
  )
}
