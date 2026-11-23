"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { AlarmClock, Ban, CalendarCheck, CalendarDays, Check, CheckCheck, Eye, FileText, IndianRupee, MessageCircle, Pencil, Plus, UserX } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/common"
import { DataList, type Column, type ViewPreset } from "@/components/data-list"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { AppointmentDialog, AppointmentView, CancelDialog } from "@/components/bookings/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi } from "@/lib/use-api"
import { formatDate, formatDateTime, formatPaise } from "@/lib/format"
import { SOURCE, STATUS, isOpen, reminderLink, timeOf, type Appointment, type Service, type StaffRow } from "@/lib/bookings"
import { cn } from "@/lib/utils"
import { NoAccessPage } from "@/components/page-states"

// Appointments as a list: what is ahead, today, to confirm, done, not yet invoiced, cancelled and
// no-shows, each a tab with its count. Every step of the day from the row.

const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })

function ListPage() {
  const { can, me, term } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const staff = useSharedApi<{ data: StaffRow[] }>("/staff")
  const services = useSharedApi<{ data: Service[] }>("/booking-services")
  const [version, setVersion] = React.useState(0)
  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState<Appointment | null>(null)
  const [viewing, setViewing] = React.useState<Appointment | null>(null)
  const [cancelling, setCancelling] = React.useState<Appointment | null>(null)
  if (!can("bookings.appointment.view")) return <NoAccessPage title="Appointments" permission="bookings.appointment.view" />
  const reload = () => setVersion((v) => v + 1)
  const canEdit = can("bookings.appointment.edit")
  const started = (a: Appointment) => new Date(a.startAt).getTime() <= Date.now() + 15 * 60_000
  async function act(a: Appointment, action: string, done: string) {
    try { await api.post(`/appointments/${a.id}/status`, { action }); toast.success(done); reload() } catch (e) { toast.error(errorMessage(e)) }
  }
  async function invoice(a: Appointment) {
    try { const inv = await api.post<{ id: string }>(`/appointments/${a.id}/invoice`); toast.success("Draft invoice made"); router.push(`/app/m/billing/${inv.id}`) } catch (e) { toast.error(errorMessage(e)) }
  }

  const columns: Column<Appointment>[] = [
    { key: "when", header: "When", hideable: false, sort: (a) => a.startAt, csv: (a) => a.startAt, cell: (a) => <span className="grid gap-0.5 whitespace-nowrap"><span className="font-medium">{formatDate(a.startAt)}</span><span className="text-xs text-muted-foreground">{timeOf(a.startAt)}–{timeOf(a.endAt)} · {a.durationMin} min</span></span> },
    {
      key: "customer", header: "Customer", sort: (a) => a.customerName ?? "", csv: (a) => a.customerName ?? a.title,
      cell: (a) => a.kind === "event" ? <span className="text-sm"><span className="font-medium">{a.title}</span><span className="block text-xs text-muted-foreground">Meeting or block</span></span> : (
        <span className="flex items-center gap-2.5"><Avatar name={a.customerName ?? "?"} className="size-8 text-[10px]" /><span className="min-w-0">{a.contact ? <Link href={`/app/m/sales/customers/${a.contact.id}`} onClick={(e) => e.stopPropagation()} className="block font-medium hover:underline">{a.customerName}</Link> : <span className="block font-medium">{a.customerName}<Pill color="violet" className="ml-1.5">New</Pill></span>}<span className="block text-xs text-muted-foreground">{a.customerPhone ?? "No phone"}</span></span></span>
      ),
    },
    { key: "service", header: "Service", csv: (a) => a.item?.name ?? "", cell: (a) => (a.item ? <span className="text-sm">{a.item.name}<span className="block text-xs text-muted-foreground tabular-nums">{formatPaise(a.amountPaise)}</span></span> : <span className="text-muted-foreground">—</span>) },
    { key: "staff", header: "Staff", csv: (a) => a.staff?.name ?? "", cell: (a) => (a.staff ? <span className="flex items-center gap-2"><Avatar name={a.staff.name} className="size-7 text-[10px]" /><span className="text-sm">{a.staff.name}</span></span> : <span className="text-muted-foreground">Anyone</span>) },
    { key: "room", header: "Room", defaultHidden: true, csv: (a) => a.resource?.name ?? "", cell: (a) => a.resource?.name ?? "—" },
    { key: "source", header: "Came through", defaultHidden: true, csv: (a) => SOURCE[a.source], cell: (a) => <Pill color={a.source === "online" ? "violet" : "slate"}>{SOURCE[a.source]}</Pill> },
    {
      key: "status", header: "Status", csv: (a) => STATUS[a.status].label,
      cell: (a) => <span className="grid gap-0.5"><Pill color={STATUS[a.status].color} dot>{STATUS[a.status].label}</Pill>{a.checkedInAt && isOpen(a.status) && <span className="text-[11px] text-emerald-700 dark:text-emerald-300">Arrived {timeOf(a.checkedInAt)}</span>}{a.remindedAt && isOpen(a.status) && <span className="text-[11px] text-muted-foreground">Reminded</span>}{a.cancelReason && <span className="max-w-40 truncate text-[11px] text-muted-foreground">{a.cancelReason}</span>}</span>,
    },
    { key: "invoice", header: "Invoice", csv: (a) => a.invoice?.number ?? "", cell: (a) => (a.invoice ? <Link href={`/app/m/billing/${a.invoice.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-primary hover:underline">{a.invoice.number ?? "Draft"}</Link> : a.status === "completed" && a.itemId ? <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Not invoiced</span> : <span className="text-muted-foreground">—</span>) },
    { key: "made", header: "Booked by", defaultHidden: true, csv: (a) => a.createdByName ?? "", cell: (a) => <span className="text-sm">{a.source === "online" ? "Online" : a.createdByName ?? "—"}<span className="block text-[11px] text-muted-foreground">{formatDateTime(a.createdAt)}</span></span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (a) => {
        const wa = a.kind === "appointment" && isOpen(a.status) ? reminderLink(a, me?.tenant?.name ?? "our shop") : null
        return (
          <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {canEdit && a.status === "scheduled" && <Button variant="ghost" size="icon-sm" className="text-blue-700 dark:text-blue-300" title="Confirm" aria-label={`Confirm ${a.title}`} onClick={() => void act(a, "confirm", "Confirmed")}><Check /></Button>}
            {canEdit && isOpen(a.status) && started(a) && <Button variant="ghost" size="icon-sm" className="text-emerald-700 dark:text-emerald-300" title="Complete" aria-label={`Complete ${a.title}`} onClick={() => void act(a, "complete", "Completed")}><CheckCheck /></Button>}
            {a.status === "completed" && !a.invoiceId && a.itemId && can("billing.invoice.create") && <Button variant="ghost" size="icon-sm" className="text-emerald-700 dark:text-emerald-300" title="Make invoice" aria-label={`Invoice ${a.title}`} onClick={() => void invoice(a)}><FileText /></Button>}
            {wa && <a href={wa} target="_blank" rel="noreferrer" className={cn(icon, "text-emerald-700 dark:text-emerald-300")} title="Remind on WhatsApp" aria-label="Remind on WhatsApp" onClick={() => void api.post(`/appointments/${a.id}/reminded`).then(reload).catch(() => {})}><MessageCircle /></a>}
            <Button variant="ghost" size="icon-sm" title="View" aria-label={`View ${a.title}`} onClick={() => setViewing(a)}><Eye /></Button>
            <ActionMenu label={`More actions for ${a.title}`} items={[
              canEdit && isOpen(a.status) && { label: "Change time or staff", icon: Pencil, onClick: () => setEditing(a) },
              canEdit && isOpen(a.status) && a.kind === "appointment" && started(a) && { label: "Mark no-show", icon: UserX, onClick: () => void act(a, "no_show", "Marked no-show") },
              canEdit && ["cancelled", "no_show"].includes(a.status) && { label: "Book again", icon: CalendarCheck, onClick: () => void act(a, "reopen", "Booked again") },
              { label: "Open in calendar", icon: CalendarDays, href: `/app/m/bookings?date=${new Date(new Date(a.startAt).getTime() + 330 * 60_000).toISOString().slice(0, 10)}` },
              "-",
              canEdit && isOpen(a.status) && { label: "Cancel", icon: Ban, destructive: true, onClick: () => setCancelling(a) },
            ]} />
          </span>
        )
      },
    },
  ]
  const presets: ViewPreset[] = [
    { key: "upcoming", label: "Upcoming", params: { view: "upcoming" }, countKey: "upcoming" },
    { key: "today", label: "Today", params: { view: "today" }, countKey: "today" },
    { key: "unconfirmed", label: "To confirm", params: { view: "unconfirmed" }, countKey: "unconfirmed" },
    { key: "completed", label: "Completed", params: { view: "completed" }, countKey: "completed" },
    { key: "uninvoiced", label: "Not invoiced", params: { view: "uninvoiced" }, countKey: "uninvoiced" },
    { key: "no_show", label: "No-shows", params: { view: "no_show" }, countKey: "no_show" },
    { key: "cancelled", label: "Cancelled", params: { view: "cancelled" }, countKey: "cancelled" },
    { key: "events", label: "Meetings", params: { view: "events" }, countKey: "events" },
  ]
  const add = can("bookings.appointment.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setCreating(true)}><Plus /> New {term("entity.appointment.singular", "appointment").toLowerCase()}</Button> : undefined

  return (
    <>
      <DataList<Appointment>
        id="appointments"
        path="/appointments"
        params={{ v: String(version) }}
        header={{ title: "Appointments", description: "Every booking with its customer, service, staff and status. Confirm, finish, remind and invoice from the row.", primary: add, more: [{ label: "Calendar", href: "/app/m/bookings" }, { label: "Services", href: "/app/m/bookings/services" }] }}
        columns={columns}
        searchPlaceholder="Search customer, mobile, service or staff"
        presets={presets}
        presetLabel="Show"
        defaultPreset={params.get("view") ?? undefined}
        tabs
        top={(res) => {
          const c = (res.counts ?? {}) as Record<string, number>
          const s = (res.sums ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Upcoming", value: c.upcoming ?? 0, hint: `${formatPaise(s.upcomingValuePaise ?? 0)} booked ahead`, color: "blue", icon: CalendarDays },
            { label: "To confirm", value: c.unconfirmed ?? 0, hint: "Call or WhatsApp them", color: "amber", icon: AlarmClock },
            { label: "Earned this month", value: formatPaise(s.monthRevenuePaise ?? 0), hint: `${s.monthBooked ?? 0} booked · ${s.online ?? 0} online`, color: "emerald", icon: IndianRupee },
            { label: "Not invoiced", value: formatPaise(s.uninvoicedPaise ?? 0), hint: `${c.uninvoiced ?? 0} completed without a bill`, color: "violet", icon: FileText },
            { label: "No-shows", value: `${s.noShowPct ?? 0}%`, hint: `${c.no_show ?? 0} in the last 4 months`, color: "rose", icon: UserX },
          ]} />
        }}
        filters={[
          { key: "staffId", label: "Staff", options: (staff.data?.data ?? []).map((p) => ({ value: p.id, label: p.name })) },
          { key: "itemId", label: "Service", options: (services.data?.data ?? []).map((s) => ({ value: s.id, label: s.name })) },
        ]}
        rowClick={(a) => setViewing(a)}
        exportName="appointments"
        emptyState={<EmptyState icon={CalendarCheck} title="Nothing here" description="Book from here or the calendar. Customers can also book themselves from your online booking page." action={add} />}
      />
      {creating && <AppointmentDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
      {editing && <AppointmentDialog appt={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {viewing && <AppointmentView appt={viewing} onClose={() => setViewing(null)} onChanged={() => { setViewing(null); reload() }} />}
      {cancelling && <CancelDialog appt={cancelling} onClose={() => setCancelling(null)} onSaved={() => { setCancelling(null); reload() }} />}
    </>
  )
}

export default function Page() {
  return <React.Suspense><ListPage /></React.Suspense>
}
