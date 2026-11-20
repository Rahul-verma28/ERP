"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CalendarDays, CalendarOff, Clock, Pencil, Percent, Plane, Plus, Trash2, Users } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, countBy, localList, type Column } from "@/components/data-list"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { HoursDialog, TimeOffDialog } from "@/components/bookings/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDateTime } from "@/lib/format"
import { WEEKDAYS, type StaffRow } from "@/lib/bookings"
import { cn } from "@/lib/utils"

// Staff & Hours: each person's working week, time off, and how booked they are this week.
// Appointments and the online booking page only offer times inside these hours.

export default function StaffPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [hours, setHours] = React.useState<StaffRow | null>(null)
  const [off, setOff] = React.useState<{ personId?: string } | null>(null)
  const [removing, setRemoving] = React.useState<{ id: string; who: string } | null>(null)
  if (!can("bookings.appointment.view")) return <PageHeader title="Staff & Hours" description="You don't have access to bookings. Ask your admin." />
  const reload = () => setVersion((v) => v + 1)
  const canEdit = can("bookings.resource.edit")

  const columns: Column<StaffRow>[] = [
    { key: "name", header: "Person", hideable: false, sort: (p) => p.name, csv: (p) => p.name, cell: (p) => <span className="flex items-center gap-2.5"><Avatar name={p.name} className="size-9 text-xs" /><span className="min-w-0"><span className="block font-medium">{p.name}{p.offNow && <Pill color="rose" className="ml-1.5">Off now</Pill>}</span><span className="block text-xs text-muted-foreground">{p.role}</span></span></span> },
    {
      key: "week", header: "Working week", csv: (p) => p.hours.map((h) => `${WEEKDAYS[h.weekday].slice(0, 3)} ${h.start}-${h.end}`).join("; "),
      cell: (p) => (
        <span className="grid gap-1">
          <span className="flex gap-1">{[1, 2, 3, 4, 5, 6, 0].map((d) => { const on = p.hours.some((h) => h.weekday === d); return <span key={d} title={p.hours.filter((h) => h.weekday === d).map((h) => `${h.start}–${h.end}`).join(", ") || "Off"} className={cn("grid size-7 place-items-center rounded-lg text-[11px] font-medium", on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground line-through")}>{WEEKDAYS[d][0]}</span> })}</span>
          <span className="text-[11px] text-muted-foreground">{p.usesDefault ? "Usual hours (10–7, Mon–Sat) — set their own" : `${p.weekHours} hours a week`}</span>
        </span>
      ),
    },
    { key: "booked", header: "Booked this week", align: "right", sort: (p) => p.bookedPct, csv: (p) => p.bookedThisWeek, cell: (p) => <span className="grid min-w-28 justify-items-end gap-1"><span className="text-sm tabular-nums">{p.bookedThisWeek} · {p.bookedPct}%</span><span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", p.bookedPct > 85 ? "bg-rose-500" : p.bookedPct > 60 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, p.bookedPct)}%` }} /></span></span> },
    { key: "off", header: "Time off ahead", csv: (p) => p.timeOff.map((o) => `${o.fromAt} ${o.reason ?? ""}`).join("; "), cell: (p) => { const ahead = p.timeOff.filter((o) => new Date(o.toAt) > new Date()); return ahead.length ? <span className="grid gap-1">{ahead.slice(0, 2).map((o) => <span key={o.id} className="flex items-center gap-1.5 text-xs"><Plane className="size-3 text-muted-foreground" />{formatDateTime(o.fromAt)}{o.reason ? ` · ${o.reason}` : ""}{canEdit && <button type="button" className="text-muted-foreground hover:text-destructive" aria-label="Remove time off" onClick={(e) => { e.stopPropagation(); setRemoving({ id: o.id, who: p.name }) }}><Trash2 className="size-3" /></button>}</span>)}{ahead.length > 2 && <span className="text-[11px] text-muted-foreground">+{ahead.length - 2} more</span>}</span> : <span className="text-muted-foreground">—</span> } },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (p) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {canEdit && <Button variant="ghost" size="icon-sm" title="Working hours" aria-label={`Hours of ${p.name}`} onClick={() => setHours(p)}><Pencil /></Button>}
          <ActionMenu label={`More for ${p.name}`} items={[
            canEdit && { label: "Add time off", icon: CalendarOff, onClick: () => setOff({ personId: p.id }) },
            { label: "Their day on the calendar", icon: CalendarDays, href: "/app/m/bookings" },
          ]} />
        </span>
      ),
    },
  ]
  return (
    <>
      <DataList<StaffRow>
        id="booking-staff"
        load={localList(async () => (await api.get<{ data: StaffRow[] }>("/staff")).data, (p, q) => `${p.name} ${p.role} ${p.email}`.toLowerCase().includes(q), {
          filter: (p, prm) => (prm.show === "off" ? p.offNow || p.timeOff.some((o) => new Date(o.toAt) > new Date()) : prm.show === "default" ? p.usesDefault : true),
          counts: (rows) => countBy(rows, (p) => [...(p.offNow || p.timeOff.some((o) => new Date(o.toAt) > new Date()) ? ["off"] : []), ...(p.usesDefault ? ["default"] : [])]),
          meta: (rows) => ({ sums: { booked: rows.reduce((a, p) => a + p.bookedThisWeek, 0), busy: rows.length ? Math.round(rows.reduce((a, p) => a + p.bookedPct, 0) / rows.length) : 0, hours: rows.reduce((a, p) => a + p.weekHours, 0), offNow: rows.filter((p) => p.offNow).length } }),
        })}
        params={{ v: String(version) }}
        header={{ title: "Staff & Hours", description: "Each person's working week and time off. Bookings only go inside these hours.", primary: canEdit ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setOff({})}><Plus /> Add time off</Button> : undefined, more: [{ label: "Team and roles", href: "/app/users" }] }}
        columns={columns}
        searchPlaceholder="Search people"
        presets={[{ key: "all", label: "Everyone", params: {}, countKey: "all" }, { key: "off", label: "Time off", params: { show: "off" }, countKey: "off" }, { key: "default", label: "Usual hours", params: { show: "default" }, countKey: "default" }]}
        presetLabel="Show"
        tabs
        top={(res) => {
          const c = (res.counts ?? {}) as Record<string, number>
          const s = (res.sums ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "People", value: c.all ?? 0, hint: `${c.default ?? 0} on usual hours`, color: "blue", icon: Users },
            { label: "Working hours", value: `${s.hours ?? 0} h`, hint: "A week, everyone together", color: "violet", icon: Clock },
            { label: "Booked this week", value: s.booked ?? 0, hint: "Appointments", color: "amber", icon: CalendarDays },
            { label: "How full", value: `${s.busy ?? 0}%`, hint: "Of working hours, this week", color: "emerald", icon: Percent },
            { label: "Off now", value: s.offNow ?? 0, hint: `${c.off ?? 0} with time off ahead`, color: "rose", icon: CalendarOff },
          ]} />
        }}
        rowClick={canEdit ? (p) => setHours(p) : undefined}
        exportName="staff-hours"
        emptyState={<EmptyState icon={Users} title="No staff" description="Invite the people who take bookings in Users, then set their hours here." action={<Link href="/app/users" className={buttonVariants()}>Open Users</Link>} />}
      />
      {hours && <HoursDialog person={hours} onClose={() => setHours(null)} onSaved={() => { setHours(null); reload() }} />}
      {off && <TimeOffDialog personId={off.personId} onClose={() => setOff(null)} onSaved={() => { setOff(null); reload() }} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title={`Remove ${removing?.who}'s time off?`} description="They can be booked again for that time." confirmLabel="Remove"
        onConfirm={async () => { try { await api.delete(`/staff-time-off/${removing!.id}`); toast.success("Time off removed"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
