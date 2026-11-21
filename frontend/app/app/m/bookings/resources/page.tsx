"use client"

import * as React from "react"
import { toast } from "sonner"
import { Archive, ArchiveRestore, CalendarCheck, Clock, DoorOpen, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, countBy, localList, type Column } from "@/components/data-list"
import { ActionMenu, Pill } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { ResourceDialog } from "@/components/bookings/forms"
import { DOT } from "@/components/tasks/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { RESOURCE_KIND, type Resource } from "@/lib/bookings"
import { cn } from "@/lib/utils"

// Rooms & Resources: rooms, chairs and machines an appointment uses. None is booked twice at once;
// a service can ask for a free one of a kind.

export default function ResourcesPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Resource | "new" | null>(null)
  const [removing, setRemoving] = React.useState<Resource | null>(null)
  if (!can("bookings.appointment.view")) return <PageHeader title="Rooms & Resources" description="You don't have access to bookings. Ask your admin." />
  const reload = () => setVersion((v) => v + 1)
  const canEdit = can("bookings.resource.edit")
  async function toggle(r: Resource) {
    try { await api.put(`/booking-resources/${r.id}`, { name: r.name, kind: r.kind, capacity: r.capacity, color: r.color, notes: r.notes, isActive: !r.isActive, version: r.version }); toast.success(r.isActive ? `${r.name} is inactive` : `${r.name} is active again`); reload() } catch (e) { toast.error(errorMessage(e)) }
  }

  const columns: Column<Resource>[] = [
    { key: "name", header: "Name", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span className="flex items-center gap-2.5"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted"><span className={cn("size-3 rounded-full", DOT[r.color] ?? DOT.slate)} /></span><span className="min-w-0"><span className="block font-medium">{r.name}</span>{r.notes && <span className="block max-w-56 truncate text-xs text-muted-foreground">{r.notes}</span>}</span></span> },
    { key: "kind", header: "Kind", csv: (r) => RESOURCE_KIND[r.kind], cell: (r) => <Pill color="slate">{RESOURCE_KIND[r.kind]}</Pill> },
    { key: "capacity", header: "People at once", align: "right", csv: (r) => r.capacity, cell: (r) => <span className="tabular-nums">{r.capacity}</span> },
    { key: "now", header: "Right now", csv: (r) => r.inUseBy ?? "Free", cell: (r) => (!r.isActive ? <Pill color="slate">Inactive</Pill> : r.inUseBy ? <span className="text-sm"><Pill color="amber" dot>In use</Pill><span className="block max-w-48 truncate text-[11px] text-muted-foreground">{r.inUseBy}</span></span> : <Pill color="emerald" dot>Free</Pill>) },
    { key: "upcoming", header: "Booked ahead", align: "right", sort: (r) => r.upcoming, csv: (r) => r.upcoming, cell: (r) => <span className="tabular-nums">{r.upcoming}</span> },
    { key: "used", header: "Used (30 days)", align: "right", sort: (r) => r.used30Min, csv: (r) => r.used30, cell: (r) => <span className="tabular-nums">{r.used30}<span className="block text-[11px] text-muted-foreground">{Math.round(r.used30Min / 60)} hours</span></span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {canEdit && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil /></Button>}
          <ActionMenu label={`More for ${r.name}`} items={[
            canEdit && (r.isActive ? { label: "Make inactive", icon: Archive, onClick: () => void toggle(r) } : { label: "Make active", icon: ArchiveRestore, onClick: () => void toggle(r) }),
            "-",
            can("bookings.resource.delete") && !r.used30 && !r.upcoming && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setRemoving(r) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("bookings.resource.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> New room or resource</Button> : undefined
  return (
    <>
      <DataList<Resource>
        id="booking-resources"
        load={localList(async () => (await api.get<{ data: Resource[] }>("/booking-resources")).data, (r, q) => `${r.name} ${r.kind} ${r.notes ?? ""}`.toLowerCase().includes(q), {
          filter: (r, p) => (p.show ? (p.show === "closed" ? !r.isActive : r.isActive && r.kind === p.show) : true),
          counts: (rows) => countBy(rows, (r) => (r.isActive ? r.kind : "closed")),
          meta: (rows) => ({ sums: { inUse: rows.filter((r) => r.inUseBy).length, upcoming: rows.reduce((a, r) => a + r.upcoming, 0), hours: Math.round(rows.reduce((a, r) => a + r.used30Min, 0) / 60) } }),
        })}
        params={{ v: String(version) }}
        header={{ title: "Rooms & Resources", description: "Rooms, chairs and machines. Never booked twice at once; a service can ask for a free one.", primary: add }}
        columns={columns}
        searchPlaceholder="Search rooms and resources"
        presets={[{ key: "all", label: "All", params: {}, countKey: "all" }, { key: "room", label: "Rooms", params: { show: "room" }, countKey: "room" }, { key: "chair", label: "Chairs", params: { show: "chair" }, countKey: "chair" }, { key: "equipment", label: "Equipment", params: { show: "equipment" }, countKey: "equipment" }, { key: "closed", label: "Inactive", params: { show: "closed" }, countKey: "closed" }]}
        presetLabel="Show"
        tabs
        top={(res) => {
          const c = (res.counts ?? {}) as Record<string, number>
          const s = (res.sums ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Rooms & resources", value: (c.all ?? 0) - (c.closed ?? 0), hint: `${c.closed ?? 0} inactive`, color: "blue", icon: DoorOpen },
            { label: "In use now", value: s.inUse ?? 0, hint: "An appointment is on", color: "amber", icon: Clock },
            { label: "Booked ahead", value: s.upcoming ?? 0, hint: "Appointments to come", color: "violet", icon: CalendarCheck },
            { label: "Used (30 days)", value: `${s.hours ?? 0} h`, hint: "All together", color: "emerald", icon: Clock },
          ]} />
        }}
        rowClick={canEdit ? (r) => setEditing(r) : undefined}
        exportName="rooms-resources"
        emptyState={<EmptyState icon={DoorOpen} title="No rooms or resources" description="Add treatment rooms, salon chairs or machines so two bookings never need the same one." action={add} />}
      />
      {editing && <ResourceDialog resource={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive title={`Delete ${removing?.name}?`} description="It has never been used, so nothing else changes." confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/booking-resources/${removing!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
