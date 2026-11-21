"use client"

import * as React from "react"
import Link from "next/link"
import { CalendarCheck, Clock, Globe, IndianRupee, Pencil, Plus, Scissors } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { EmptyState } from "@/components/common"
import { DataList, countBy, localList, type Column } from "@/components/data-list"
import { Avatar, Pill } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { ServiceDialog } from "@/components/bookings/forms"
import { DOT } from "@/components/tasks/forms"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { RESOURCE_KIND, type Service } from "@/lib/bookings"
import { cn } from "@/lib/utils"

// Services that can be booked: how long each takes, the gap after, who can do it, the room it needs,
// whether customers can book it online, and how busy it is. Services themselves are items.

export default function ServicesPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Service | null>(null)
  if (!can("bookings.appointment.view")) return <PageHeader title="Services" description="You don't have access to bookings. Ask your admin." />
  const canEdit = can("bookings.resource.edit")

  const columns: Column<Service>[] = [
    { key: "name", header: "Service", hideable: false, sort: (s) => s.name, csv: (s) => s.name, cell: (s) => <span className="flex items-center gap-2.5"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted"><span className={cn("size-3 rounded-full", DOT[s.color] ?? DOT.blue)} /></span><span className="min-w-0"><span className="block font-medium">{s.name}{!s.configured && <Pill color="amber" className="ml-1.5">Set up</Pill>}</span><span className="block text-xs text-muted-foreground">{[s.category, s.sku].filter(Boolean).join(" · ") || "Service"}</span></span></span> },
    { key: "time", header: "Takes", sort: (s) => s.durationMin, csv: (s) => s.durationMin, cell: (s) => <span className="text-sm">{s.durationMin} min{!!s.bufferMin && <span className="block text-[11px] text-muted-foreground">+ {s.bufferMin} min gap</span>}</span> },
    { key: "price", header: "Price", align: "right", sort: (s) => s.pricePaise, csv: (s) => s.pricePaise / 100, cell: (s) => <span className="font-medium tabular-nums">{formatPaise(s.pricePaise)}<span className="block text-[11px] font-normal text-muted-foreground">+{s.gstRateBp / 100}% GST</span></span> },
    { key: "staff", header: "Done by", csv: (s) => s.staff.map((p) => p.name).join(", "), cell: (s) => (s.staff.length ? <span className="flex -space-x-1.5" title={s.staff.map((p) => p.name).join(", ")}>{s.staff.slice(0, 5).map((p) => <Avatar key={p.id} name={p.name} className="size-7 border-2 border-background text-[10px]" />)}</span> : <span className="text-sm text-muted-foreground">Anyone</span>) },
    { key: "needs", header: "Needs", csv: (s) => (s.resourceKind ? RESOURCE_KIND[s.resourceKind] : ""), cell: (s) => (s.resourceKind ? <Pill color="slate">A {RESOURCE_KIND[s.resourceKind].toLowerCase()}</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "booked", header: "Booked (30 days)", align: "right", sort: (s) => s.booked30, csv: (s) => s.booked30, cell: (s) => <span className="tabular-nums">{s.booked30}<span className="block text-[11px] text-muted-foreground">{s.upcoming} ahead</span></span> },
    { key: "revenue", header: "Earned (30 days)", align: "right", sort: (s) => s.revenue30Paise, csv: (s) => s.revenue30Paise / 100, cell: (s) => <span className="tabular-nums">{s.revenue30Paise ? formatPaise(s.revenue30Paise) : "—"}</span> },
    { key: "online", header: "Online", csv: (s) => (s.online ? "Yes" : "No"), cell: (s) => (!s.isActive ? <Pill color="slate">Inactive</Pill> : s.online ? <Pill color="violet">Online</Pill> : <Pill color="slate">Counter only</Pill>) },
    { key: "actions", header: "Actions", hideable: false, cell: (s) => (canEdit ? <Button variant="ghost" size="icon-sm" title="Set up" aria-label={`Set up ${s.name}`} onClick={(e) => { e.stopPropagation(); setEditing(s) }}><Pencil /></Button> : null) },
  ]
  return (
    <>
      <DataList<Service>
        id="booking-services"
        load={localList(async () => (await api.get<{ data: Service[] }>("/booking-services")).data, (s, q) => `${s.name} ${s.category ?? ""} ${s.sku ?? ""}`.toLowerCase().includes(q), {
          filter: (s, p) => (p.show === "online" ? s.online && s.isActive : p.show === "counter" ? !s.online && s.isActive : p.show === "setup" ? !s.configured : p.show === "closed" ? !s.isActive : true),
          counts: (rows) => ({ ...countBy(rows, (s) => [s.isActive ? (s.online ? "online" : "counter") : "closed", ...(!s.configured ? ["setup"] : [])]) }),
          meta: (rows) => ({ sums: { booked: rows.reduce((a, s) => a + s.booked30, 0), revenue: rows.reduce((a, s) => a + s.revenue30Paise, 0), upcoming: rows.reduce((a, s) => a + s.upcoming, 0) } }),
        })}
        params={{ v: String(version) }}
        header={{ title: "Services", description: "What customers book. Set how long each takes, who does it and whether it can be booked online.", primary: can("catalog.item.create") ? <Link href="/app/m/catalog/new?type=service" className={buttonVariants({ className: "h-10 rounded-xl px-4 font-semibold" })}><Plus /> New service</Link> : undefined, more: [{ label: "Online booking", href: "/app/m/bookings/online" }] }}
        columns={columns}
        searchPlaceholder="Search service or category"
        presets={[{ key: "all", label: "All", params: {}, countKey: "all" }, { key: "online", label: "Online", params: { show: "online" }, countKey: "online" }, { key: "counter", label: "Counter only", params: { show: "counter" }, countKey: "counter" }, { key: "setup", label: "Needs set-up", params: { show: "setup" }, countKey: "setup" }, { key: "closed", label: "Inactive", params: { show: "closed" }, countKey: "closed" }]}
        presetLabel="Show"
        tabs
        top={(res) => {
          const c = (res.counts ?? {}) as Record<string, number>
          const s = (res.sums ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Services", value: c.all ?? 0, hint: `${c.setup ?? 0} still to set up`, color: "blue", icon: Scissors },
            { label: "Bookable online", value: c.online ?? 0, hint: "Shown on your booking page", color: "violet", icon: Globe },
            { label: "Booked (30 days)", value: s.booked ?? 0, hint: `${s.upcoming ?? 0} ahead`, color: "amber", icon: CalendarCheck },
            { label: "Earned (30 days)", value: formatPaise(s.revenue ?? 0), hint: "Completed appointments", color: "emerald", icon: IndianRupee },
          ]} />
        }}
        rowClick={canEdit ? (s) => setEditing(s) : undefined}
        exportName="booking-services"
        emptyState={<EmptyState icon={Clock} title="No services yet" description="Add a service item (a haircut, a consultation, a repair visit), then set how it is booked." action={can("catalog.item.create") ? <Link href="/app/m/catalog/new?type=service" className={buttonVariants()}>New service</Link> : undefined} />}
      />
      {editing && <ServiceDialog service={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setVersion((v) => v + 1) }} />}
    </>
  )
}
