"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Building2, CalendarCheck, CalendarDays, Cake, Clock, IndianRupee, Layers, LogIn, LogOut, Megaphone, PartyPopper, Plus, TrendingDown, TrendingUp, UserCheck, UserPlus, Users, UserX } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { PageError, PageLoading } from "@/components/page-states"
import { Avatar, Pill, Section } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { MonthCalendar } from "@/components/hr/month-calendar"
import { RecordView } from "@/components/record-view"
import { todayInIndia } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { LEAVE_STATUS, monthLabel, RUN_STATUS } from "@/lib/hr"
import { cn } from "@/lib/utils"

// HR home: who is in today, who is away, what waits for approval, and what is coming up.
// Someone with a linked employee record also gets their own clock-in card here.

interface Dash {
  today: string
  employees: { total: number; fullTime: number; partTime: number; contract: number; intern: number; onNotice: number; joinedThisMonth: number }
  attendance: { total: number; present: number; half_day: number; absent: number; leave: number; unmarked: number; late: number; working: boolean; holiday: string | null; missing: { id: string; name: string; code: string; sub?: string | null }[] }
  pendingLeaves: { id: string; employee: string; leaveType: string; fromDate: string; toDate: string; days: number }[]
  pendingLeaveCount: number
  onLeave: { id: string; employee: string; leaveType: string; toDate: string }[]
  holidays: { id: string; name: string; fromDate: string; toDate: string; kind: string }[]
  posts: { id: string; kind: string; title: string; startsOn: string | null; priority: string; category: string | null }[]
  approvals: Record<string, number>
  payroll: { id: string; status: string; netPaise: number; paidPaise: number; employees: number } | null
  departments: { id: string; name: string; employees: number }[]
  birthdays: { id: string; name: string; date: string }[]
  anniversaries: { id: string; name: string; date: string; years: number }[]
  counts: { branches: number; departments: number; absentYesterday: number; promotionsYear: number; exitsMonth: number }
  calendar: { id: string; kind: "event" | "holiday"; title: string; from: string; to: string | null; time: string | null; place: string | null; pending: boolean; category: string | null }[]
  recentLeaves: { id: string; employee: string; leaveType: string; color: string; fromDate: string; toDate: string; days: number; status: "pending" | "approved" | "rejected" | "cancelled"; createdAt: string }[]
}
interface Me { employee: { id: string; name: string; code: string } | null; shift?: { name: string; startsAt: string; endsAt: string } | null; today: { clockIn: string | null; clockOut: string | null; status: string; workedMinutes: number } | null }

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`

function MyDay() {
  const { data, reload } = useApi<Me>("/hr/me")
  const [busy, setBusy] = React.useState(false)
  if (!data?.employee) return null
  const t = data.today
  async function clock(action: "in" | "out") {
    setBusy(true)
    try {
      await api.post("/hr/me/clock", { action })
      toast.success(action === "in" ? "Clocked in. Have a good day!" : "Clocked out")
      await reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="ui-surface flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary"><Clock className="size-5" /></span>
        <div>
          <p className="font-semibold">My day · {data.employee.name}</p>
          <p className="text-sm text-muted-foreground">
            {data.shift ? `${data.shift.name} shift ${data.shift.startsAt}–${data.shift.endsAt} · ` : ""}
            {t?.status === "leave" ? "On leave today" : t?.clockOut ? `Worked ${hm(t.workedMinutes)} (${t.clockIn}–${t.clockOut})` : t?.clockIn ? `In since ${t.clockIn}` : "Not clocked in yet"}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Link href="/app/m/hr/leave" className={buttonVariants({ variant: "outline" })}><CalendarDays /> Apply leave</Link>
        {!t?.clockIn && t?.status !== "leave" && <Button disabled={busy} onClick={() => void clock("in")}><LogIn /> Clock in</Button>}
        {t?.clockIn && !t.clockOut && <Button variant="outline" disabled={busy} onClick={() => void clock("out")}><LogOut /> Clock out</Button>}
      </div>
    </section>
  )
}

export default function HrDashboardPage() {
  const { can } = useAuth()
  const [calMonth, setCalMonth] = React.useState(() => todayInIndia().slice(0, 7))
  const [picked, setPicked] = React.useState<Dash["calendar"][number] | null>(null)
  const { data, error, reload } = useApi<Dash>(can("hr.employee.view") ? "/hr/dashboard" : null)
  if (!can("hr.employee.view")) return <PageHeader title="HR" description="You don't have access to HR. Ask your admin." />
  if (error) return <PageError error={error} onRetry={() => void reload()} />
  if (!data) return <PageLoading />
  const a = data.attendance
  const rate = a.total ? Math.round(((a.present + a.half_day) / a.total) * 100) : 0
  const pendingCareer = Object.values(data.approvals).reduce((s, n) => s + n, 0)
  const quick: [string, string, React.ElementType, string][] = [
    ["Add employee", "/app/m/hr/employees/new", UserPlus, "hr.employee.create"],
    ["Mark attendance", "/app/m/hr/attendance", CalendarCheck, "hr.attendance.edit"],
    ["Apply leave", "/app/m/hr/leave?apply=1", CalendarDays, "hr.leave.create"],
    ["Run payroll", "/app/m/hr/payroll?run=1", IndianRupee, "hr.payroll.create"],
    ["Announce", "/app/m/hr/workplace/announcement?add=1", Megaphone, "hr.workplace.create"],
  ]

  return (
    <div className="grid gap-5">
      <PageHeader title="HR" description={`${formatDate(data.today)} · your people, attendance, leave and payroll in one place.`} actions={can("hr.employee.create") ? <Link href="/app/m/hr/employees/new" className={buttonVariants()}><Plus /> Add employee</Link> : undefined} />
      <MyDay />

      <section className="ui-surface grid gap-4 overflow-hidden p-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid content-center gap-2">
          <p className="text-sm text-muted-foreground">{a.holiday ? `Today is a holiday: ${a.holiday}` : !a.working ? "Today is a weekly off" : "Attendance today"}</p>
          <p className="text-4xl font-bold tabular-nums">{rate}%<span className="ml-2 text-base font-medium text-muted-foreground">present</span></p>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            <span className="bg-emerald-500" style={{ width: `${a.total ? (a.present / a.total) * 100 : 0}%` }} />
            <span className="bg-amber-500" style={{ width: `${a.total ? (a.half_day / a.total) * 100 : 0}%` }} />
            <span className="bg-violet-500" style={{ width: `${a.total ? (a.leave / a.total) * 100 : 0}%` }} />
            <span className="bg-rose-500" style={{ width: `${a.total ? (a.absent / a.total) * 100 : 0}%` }} />
          </div>
          <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground"><span>● {a.present} present</span><span>● {a.half_day} half day</span><span>● {a.leave} on leave</span><span>● {a.absent} absent</span>{a.late > 0 && <span>{a.late} late</span>}<span>{a.unmarked} not marked</span></p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          {quick.filter(([, , , p]) => can(p)).map(([label, href, Icon]) => (
            <Link key={label} href={href} className="flex flex-col items-start gap-2 rounded-2xl border p-3 text-sm font-medium transition-colors hover:bg-muted/50">
              <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span>{label}
            </Link>
          ))}
        </div>
      </section>

      <SummaryCards className="xl:grid-cols-4" items={[
        { label: "Total employees", value: data.employees.total, hint: `${data.employees.fullTime} full time · ${data.employees.joinedThisMonth} joined this month`, color: "blue", icon: Users, href: "/app/m/hr/employees" },
        { label: "Present today", value: a.present + a.half_day, hint: a.total ? `${rate}% attendance · ${a.late} late` : "No one to mark", color: "emerald", icon: UserCheck, href: "/app/m/hr/attendance" },
        { label: "Absent today", value: a.absent, hint: a.absent === data.counts.absentYesterday ? "Same as yesterday" : `${a.absent > data.counts.absentYesterday ? "+" : "−"}${Math.abs(a.absent - data.counts.absentYesterday)} from yesterday`, color: "rose", icon: UserX, href: "/app/m/hr/attendance" },
        { label: "On leave", value: a.leave || data.onLeave.length, hint: `${data.pendingLeaveCount} waiting for approval`, color: "amber", icon: CalendarDays, href: "/app/m/hr/leave" },
        { label: "Branches", value: data.counts.branches, hint: "Places you work from", color: "slate", icon: Building2, href: "/app/m/hr/setup?tab=branches" },
        { label: "Departments", value: data.counts.departments, hint: `${data.departments.filter((d) => d.employees).length} with people`, color: "violet", icon: Layers, href: "/app/m/hr/setup?tab=departments" },
        { label: "Promotions", value: data.counts.promotionsYear, hint: `This year · ${pendingCareer} approvals waiting`, color: "emerald", icon: TrendingUp, href: "/app/m/hr/career/promotion" },
        { label: "Leaving", value: data.counts.exitsMonth, hint: `This month · ${data.employees.onNotice} on notice`, color: "rose", icon: TrendingDown, href: "/app/m/hr/career/resignation" },
      ]} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Section title="Events & holidays" description="Company events and holidays. Click one to see it." action={<Link href="/app/m/hr/workplace/event?view=calendar" className={buttonVariants({ variant: "ghost", size: "sm" })}>All events</Link>}>
          <MonthCalendar month={calMonth} onMonth={setCalMonth} onPick={(id) => setPicked(data.calendar.find((c) => c.id === id) ?? null)}
            legend={<span className="flex gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-blue-500" />Event</span><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-rose-500" />Holiday</span></span>}
            items={data.calendar.map((c) => ({ id: c.id, title: `${c.time ? `${c.time} ` : ""}${c.title}`, from: c.from, to: c.to, color: c.kind === "holiday" ? "rose" : "blue", striped: c.pending, sub: c.place }))} />
        </Section>
        <div className="grid content-start gap-5">
          <Section title="Recent leave applications" action={<Link href="/app/m/hr/leave" className={buttonVariants({ variant: "ghost", size: "sm" })}>View all</Link>} flush>
            {data.recentLeaves.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No leave yet.</p> : (
              <ul className="divide-y">{data.recentLeaves.map((l) => (
                <li key={l.id}><Link href="/app/m/hr/leave" className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-muted/40"><Avatar name={l.employee} className="size-8" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.employee}</span><span className="block truncate text-xs text-muted-foreground">{l.leaveType} · {formatDate(l.fromDate)}{l.toDate !== l.fromDate ? ` – ${formatDate(l.toDate)}` : ""}</span></span><span className="grid justify-items-end gap-0.5"><Pill color={LEAVE_STATUS[l.status].color}>{LEAVE_STATUS[l.status].label}</Pill><span className="text-[11px] text-muted-foreground">{l.days} day{l.days === 1 ? "" : "s"}</span></span></Link></li>
              ))}</ul>
            )}
          </Section>
          <Section title={`Payroll · ${monthLabel(data.today.slice(0, 7))}`} action={<Link href={data.payroll ? `/app/m/hr/payroll/${data.payroll.id}` : "/app/m/hr/payroll"} className={buttonVariants({ variant: "ghost", size: "sm" })}>Open</Link>}>
            {data.payroll ? (
              <div className="grid gap-2">
                <p className="text-2xl font-bold tabular-nums">{formatPaise(data.payroll.netPaise)}</p>
                <p className="text-sm text-muted-foreground">{RUN_STATUS[data.payroll.status]?.label} · {data.payroll.employees} employees · {formatPaise(data.payroll.paidPaise)} paid</p>
                <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${data.payroll.netPaise ? Math.min(100, (data.payroll.paidPaise / data.payroll.netPaise) * 100) : 0}%` }} /></span>
              </div>
            ) : <p className="text-sm text-muted-foreground">Not run yet for this month.</p>}
          </Section>
        </div>
      </div>
      {picked && (
        <RecordView title={picked.title} icon={picked.kind === "holiday" ? PartyPopper : CalendarDays} onClose={() => setPicked(null)}
          status={picked.kind === "holiday" ? <Pill color="rose">Holiday</Pill> : <Pill color={picked.pending ? "amber" : "emerald"} dot>{picked.pending ? "Pending" : "Approved"}</Pill>}
          fields={[
            { label: picked.kind === "holiday" ? "Holiday type" : "Category", value: picked.category },
            { label: "Date", value: `${formatDate(picked.from)}${picked.to && picked.to !== picked.from ? ` – ${formatDate(picked.to)}` : ""}` },
            picked.kind === "event" && { label: "Time", value: picked.time ?? "All day" },
            picked.kind === "event" && { label: "Where", value: picked.place },
          ]}
          footer={<Link href={picked.kind === "holiday" ? "/app/m/hr/leave/holidays" : "/app/m/hr/workplace/event"} className={buttonVariants({ variant: "outline" })}>Open {picked.kind === "holiday" ? "holidays" : "events"}</Link>}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Leave requests" description="Waiting for approval" action={<Link href="/app/m/hr/leave" className={buttonVariants({ variant: "ghost", size: "sm" })}>See all</Link>} flush>
          {data.pendingLeaves.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nothing waiting.</p> : (
            <ul className="divide-y">{data.pendingLeaves.map((l) => (
              <li key={l.id}><Link href="/app/m/hr/leave" className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-muted/40"><Avatar name={l.employee} className="size-8" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.employee}</span><span className="text-xs text-muted-foreground">{l.leaveType} · {formatDate(l.fromDate)}{l.toDate !== l.fromDate ? ` – ${formatDate(l.toDate)}` : ""}</span></span><Pill color="amber">{l.days} d</Pill></Link></li>
            ))}</ul>
          )}
        </Section>
        <Section title="Away today" flush>
          {data.onLeave.length === 0 && a.missing.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Everyone is in.</p> : (
            <ul className="divide-y">
              {data.onLeave.map((l) => <li key={l.id} className="flex items-center gap-3 px-5 py-3 text-sm"><Avatar name={l.employee} className="size-8" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.employee}</span><span className="text-xs text-muted-foreground">{l.leaveType} till {formatDate(l.toDate)}</span></span><Pill color="violet">Leave</Pill></li>)}
              {a.missing.map((m) => <li key={m.id}><Link href="/app/m/hr/attendance" className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-muted/40"><Avatar name={m.name} className="size-8" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{m.name}</span><span className="block truncate text-xs text-muted-foreground">{m.sub ?? m.code}</span></span><Pill color="rose">Not clocked in</Pill></Link></li>)}
            </ul>
          )}
        </Section>
        <Section title="Coming up" flush>
          {data.holidays.length + data.birthdays.length + data.anniversaries.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nothing in the next 60 days.</p> : (
            <ul className="divide-y">
              {data.holidays.map((h) => <li key={h.id} className="flex items-center gap-3 px-5 py-3 text-sm"><span className="grid size-8 place-items-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"><PartyPopper className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate font-medium">{h.name}</span><span className="text-xs text-muted-foreground">Holiday · {formatDate(h.fromDate)}</span></span></li>)}
              {data.birthdays.map((b) => <li key={`b-${b.id}`} className="flex items-center gap-3 px-5 py-3 text-sm"><span className="grid size-8 place-items-center rounded-lg bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300"><Cake className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate font-medium">{b.name}</span><span className="text-xs text-muted-foreground">Birthday · {formatDate(b.date)}</span></span></li>)}
              {data.anniversaries.map((b) => <li key={`a-${b.id}`} className="flex items-center gap-3 px-5 py-3 text-sm"><span className="grid size-8 place-items-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><Users className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate font-medium">{b.name}</span><span className="text-xs text-muted-foreground">{b.years} year{b.years === 1 ? "" : "s"} with you · {formatDate(b.date)}</span></span></li>)}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Departments" description="Current employees in each" action={<Link href="/app/m/hr/setup" className={buttonVariants({ variant: "ghost", size: "sm" })}>Manage</Link>}>
          {data.departments.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No departments yet. Add them in HR setup or while adding an employee.</p> : (
            <ul className="grid gap-3">{data.departments.map((d) => {
              const max = Math.max(1, ...data.departments.map((x) => x.employees))
              return <li key={d.id} className="grid gap-1 text-sm"><span className="flex justify-between"><Link href={`/app/m/hr/employees?departmentId=${d.id}`} className="font-medium hover:underline">{d.name}</Link><span className="tabular-nums text-muted-foreground">{d.employees}</span></span><span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${(d.employees / max) * 100}%` }} /></span></li>
            })}</ul>
          )}
        </Section>
        <Section title="Notice board" action={<Link href="/app/m/hr/workplace/announcement" className={buttonVariants({ variant: "ghost", size: "sm" })}>See all</Link>} flush>
          {data.posts.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No announcements or events.</p> : (
            <ul className="divide-y">{data.posts.map((p) => (
              <li key={p.id}><Link href={`/app/m/hr/workplace/${p.kind}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-muted/40"><span className={cn("grid size-8 place-items-center rounded-lg", p.kind === "event" ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300")}>{p.kind === "event" ? <CalendarDays className="size-4" /> : <Megaphone className="size-4" />}</span><span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.title}</span><span className="text-xs text-muted-foreground">{[p.category, p.startsOn && formatDate(p.startsOn)].filter(Boolean).join(" · ")}</span></span>{p.priority === "high" && <Pill color="rose">Important</Pill>}</Link></li>
            ))}</ul>
          )}
        </Section>
      </div>
    </div>
  )
}
