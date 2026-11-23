"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { AlarmClock, CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, IndianRupee, Plus, UserX } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { Spinner } from "@/components/common"
import { NativeSelect } from "@/components/form"
import { SummaryCards } from "@/components/summary-cards"
import { MonthCalendar } from "@/components/hr/month-calendar"
import { TimeGrid, type GridColumn } from "@/components/bookings/time-grid"
import { AppointmentDialog, AppointmentView } from "@/components/bookings/forms"
import { todayInIndia } from "@contracts/validation"
import { useAuth } from "@/lib/auth"
import { useApi, useSharedApi } from "@/lib/use-api"
import { formatPaise } from "@/lib/format"
import { STATUS, dayOf, type Appointment, type StaffRow } from "@/lib/bookings"
import { cn } from "@/lib/utils"
import { NoAccessPage } from "@/components/page-states"

// The calendar: a day with a column per person, a week of hours, or a month. Click empty space to
// book; click an appointment to confirm, check in, finish, remind or invoice it.

type Mode = "day" | "week" | "month"
const DAY = 86_400_000
const addDays = (s: string, n: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10)
const mondayOf = (s: string) => addDays(s, -((new Date(`${s}T00:00:00Z`).getUTCDay() + 6) % 7))
const label = (s: string, o: Intl.DateTimeFormatOptions) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-IN", { ...o, timeZone: "UTC" })
const istIso = (date: string, minutes: number) => new Date(new Date(`${date}T00:00:00+05:30`).getTime() + minutes * 60_000).toISOString()

function CalendarPage() {
  const { can, term } = useAuth()
  const params = useSearchParams()
  const today = todayInIndia()
  const [mode, setMode] = React.useState<Mode>((params.get("mode") as Mode) || "day")
  const [date, setDate] = React.useState(params.get("date") ?? today)
  const [staffId, setStaffId] = React.useState("")
  const [creating, setCreating] = React.useState<{ startAt?: string; staffId?: string } | null>(null)
  const [viewing, setViewing] = React.useState<Appointment | null>(null)
  const [version, setVersion] = React.useState(0)
  const staff = useSharedApi<{ data: StaffRow[] }>("/staff")
  const from = mode === "day" ? date : mode === "week" ? mondayOf(date) : `${date.slice(0, 7)}-01`
  const to = mode === "day" ? addDays(date, 1) : mode === "week" ? addDays(mondayOf(date), 7) : addDays(`${date.slice(0, 7)}-01`, 32)
  const res = useApi<{ data: Appointment[]; counts: Record<string, number>; sums: Record<string, number> }>(can("bookings.appointment.view") ? `/appointments?from=${istIso(from, 0)}&to=${istIso(to, 0)}&limit=1000${staffId ? `&staffId=${staffId}` : ""}&v=${version}` : null)
  const summary = useApi<{ counts: Record<string, number>; sums: Record<string, number> }>(can("bookings.appointment.view") ? `/appointments?view=today&limit=1&v=${version}` : null)
  if (!can("bookings.appointment.view")) return <NoAccessPage title="Calendar" permission="bookings.appointment.view" />
  const reload = () => setVersion((v) => v + 1)
  const items = res.data?.data ?? []
  const people = (staff.data?.data ?? []).filter((p) => !staffId || p.id === staffId)
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  const step = (n: number) => setDate(mode === "day" ? addDays(date, n) : mode === "week" ? addDays(date, 7 * n) : `${new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7)}-01`)
  const title = mode === "day" ? label(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : mode === "week" ? `${label(mondayOf(date), { day: "numeric", month: "short" })} – ${label(addDays(mondayOf(date), 6), { day: "numeric", month: "short", year: "numeric" })}` : label(date, { month: "long", year: "numeric" })

  const dayColumns: GridColumn[] = [
    ...people.map((p) => ({ key: p.id, label: p.name, sub: p.hours.filter((h) => h.weekday === weekday).map((h) => `${h.start}–${h.end}`).join(", ") || "Day off", date, staffId: p.id, today: date === today, off: !p.hours.some((h) => h.weekday === weekday) || p.offNow })),
    ...(items.some((a) => !a.staffId && dayOf(a.startAt) === date) ? [{ key: "none", label: "Not assigned", date, today: date === today }] : []),
  ]
  const weekColumns: GridColumn[] = Array.from({ length: 7 }, (_, i) => { const d = addDays(mondayOf(date), i); return { key: d, label: label(d, { weekday: "short", day: "numeric" }), sub: `${items.filter((a) => dayOf(a.startAt) === d && a.status !== "cancelled").length} booked`, date: d, staffId: staffId || undefined, today: d === today } })
  const c = summary.data?.counts ?? {}
  const s = summary.data?.sums ?? {}
  const add = can("bookings.appointment.create") || can("bookings.event.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setCreating({ staffId: staffId || undefined })}><Plus /> New {term("entity.appointment.singular", "appointment").toLowerCase()}</Button> : undefined

  return (
    <div className="grid gap-4">
      <PageHeader title="Calendar" description="Everyone's day at a glance. Click empty space to book; click a booking to confirm, finish or invoice it."
        actions={<div className="flex flex-wrap items-center gap-2"><Link href="/app/m/bookings/list" className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-xl")}>List</Link>{add}</div>} />
      <SummaryCards items={[
        { label: "Today", value: c.today ?? 0, hint: `${s.todayRemaining ?? 0} still to come`, color: "blue", icon: CalendarDays, href: "/app/m/bookings/list?view=today" },
        { label: "To confirm", value: c.unconfirmed ?? 0, hint: "Booked, not yet confirmed", color: "amber", icon: AlarmClock, href: "/app/m/bookings/list?view=unconfirmed" },
        { label: "This month", value: s.monthBooked ?? 0, hint: `${s.online ?? 0} booked online`, color: "violet", icon: CalendarCheck },
        { label: "Earned this month", value: formatPaise(s.monthRevenuePaise ?? 0), hint: `${formatPaise(s.uninvoicedPaise ?? 0)} not invoiced yet`, color: "emerald", icon: IndianRupee, href: "/app/m/bookings/list?view=uninvoiced" },
        { label: "No-shows", value: `${s.noShowPct ?? 0}%`, hint: `${c.no_show ?? 0} this period`, color: "rose", icon: UserX },
      ]} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Back" onClick={() => step(-1)}><ChevronLeft /></Button>
          <Button variant="outline" onClick={() => setDate(today)}>Today</Button>
          <Button variant="outline" size="icon" aria-label="Next" onClick={() => step(1)}><ChevronRight /></Button>
        </div>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h2>
        <div className="w-44"><NativeSelect value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Staff"><option value="">Everyone</option>{(staff.data?.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></div>
        <div className="flex rounded-xl border bg-card p-1" role="radiogroup" aria-label="View">
          {(["day", "week", "month"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn("rounded-[10px] px-3 py-1 text-sm font-medium text-muted-foreground capitalize", mode === m && "bg-primary text-primary-foreground")}>{m}</button>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(["scheduled", "confirmed", "completed", "no_show", "cancelled"] as const).map((k) => <span key={k} className="flex items-center gap-1.5"><span className={cn("size-2.5 rounded-sm border-2", { scheduled: "border-dashed border-amber-500", confirmed: "border-blue-500 bg-blue-500", completed: "border-emerald-500 bg-emerald-500", no_show: "border-rose-500 bg-rose-500", cancelled: "border-slate-400 bg-slate-300" }[k])} />{STATUS[k].label}</span>)}
        <span>· Colours follow the service</span>
      </div>
      {!res.data || !staff.data ? <div className="grid place-items-center py-24"><Spinner /></div> : mode === "month" ? (
        <div className="ui-surface p-4">
          <MonthCalendar month={date.slice(0, 7)} onMonth={(m) => setDate(`${m}-01`)} onPick={(id) => setViewing(items.find((a) => a.id === id) ?? null)} onDay={(d) => { setDate(d); setMode("day") }}
            items={items.filter((a) => a.status !== "cancelled").map((a) => ({ id: a.id, title: `${new Date(a.startAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })} ${a.customerName ?? a.title}`, from: dayOf(a.startAt), to: dayOf(a.startAt), color: a.color, striped: a.status === "scheduled", sub: a.staff?.name }))} />
        </div>
      ) : (
        <TimeGrid
          columns={mode === "day" ? dayColumns : weekColumns}
          items={items}
          columnOf={(a) => (mode === "day" ? a.staffId ?? "none" : dayOf(a.startAt))}
          onSlot={can("bookings.appointment.create") || can("bookings.event.create") ? (col, minutes) => setCreating({ startAt: istIso(col.date, minutes), staffId: col.staffId }) : undefined}
          onPick={setViewing}
        />
      )}
      {creating && <AppointmentDialog defaults={creating} onClose={() => setCreating(null)} onSaved={() => { setCreating(null); reload() }} />}
      {viewing && <AppointmentView appt={viewing} onClose={() => setViewing(null)} onChanged={() => { setViewing(null); reload() }} />}
    </div>
  )
}

export default function Page() {
  return <React.Suspense><CalendarPage /></React.Suspense>
}
