"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Ban, CalendarClock, Check, CheckCheck, FileText, LogIn, MessageCircle, Pencil, Phone, RotateCcw, Trash2, UserX } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { MoneyInput, Spinner } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { SearchSelect } from "@/components/search-select"
import { ContactPicker, type ContactOption } from "@/components/pickers"
import { RecordView } from "@/components/record-view"
import { Pill } from "@/components/page-parts"
import { FormSection, DOT } from "@/components/tasks/forms"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi, useSharedApi } from "@/lib/use-api"
import { formatDate, formatDateTime, formatPaise } from "@/lib/format"
import { usePeople } from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { RESOURCE_KIND, SOURCE, STATUS, WEEKDAYS, isOpen, reminderLink, timeOf, type Appointment, type Resource, type Service, type Slot, type StaffRow } from "@/lib/bookings"
import { useChanged } from "@/lib/use-dirty"
import { FileChip, FileField } from "@/components/file-field"

// Every Bookings form, and the one window that shows an appointment with all it can do.

const useErrors = () => {
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const fail = (err: unknown) => { if (err instanceof ApiError) setErrors(err.fields); setError(errorMessage(err)) }
  return { errors, setErrors, error, setError, fail }
}
const toLocal = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16)
const fromLocal = (v: string) => new Date(`${v}:00+05:30`).toISOString()
export const COLORS = ["blue", "emerald", "violet", "amber", "rose", "cyan", "slate"] as const

// ---------------------------------------------------------------- appointment

export function AppointmentDialog({ appt, defaults, onClose, onSaved }: {
  appt?: Appointment | null
  defaults?: { startAt?: string; staffId?: string; kind?: "appointment" | "event"; contact?: ContactOption | null }
  onClose: () => void
  onSaved: () => void
}) {
  const { can, term } = useAuth()
  const edit = !!appt
  const services = useSharedApi<{ data: Service[] }>("/booking-services")
  const rooms = useSharedApi<{ data: Resource[] }>("/booking-resources")
  const { people } = usePeople()
  const [kind, setKind] = React.useState<"appointment" | "event">(appt?.kind ?? defaults?.kind ?? (can("bookings.appointment.create") ? "appointment" : "event"))
  const [contact, setContact] = React.useState<ContactOption | null>(appt?.contact ? { id: appt.contact.id, name: appt.contact.name, phone: appt.contact.phone } : defaults?.contact ?? null)
  const [guest, setGuest] = React.useState(!!appt?.guestName)
  const start = appt?.startAt ?? defaults?.startAt ?? new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000).toISOString()
  const [f, setF] = React.useState({
    title: appt?.kind === "event" ? appt.title : "", guestName: appt?.guestName ?? "", guestPhone: appt?.guestPhone ?? "", itemId: appt?.itemId ?? "",
    staffId: appt?.staffId ?? defaults?.staffId ?? "", resourceId: appt?.resourceId ?? "", start: toLocal(start), minutes: String(appt?.durationMin ?? 30),
    source: appt?.source ?? "walk_in", pricePaise: appt?.pricePaise ?? null as number | null, status: appt?.status === "confirmed" ? "confirmed" : "scheduled", notes: appt?.notes ?? "", attachmentUrl: appt?.attachmentUrl ?? "", outsideHours: false,
  })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const { errors, setErrors, error, setError, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  const service = services.data?.data.find((s) => s.id === f.itemId)
  const allowed = service?.staffIds.length ? people.filter((p) => service.staffIds.includes(p.id)) : people
  const day = f.start.slice(0, 10)
  const slots = useApi<{ slots: Slot[] }>(kind === "appointment" && f.itemId && day ? `/booking-slots?date=${day}&itemId=${f.itemId}${f.staffId ? `&staffId=${f.staffId}` : ""}` : null)
  const pickService = (id: string) => {
    const s = services.data?.data.find((x) => x.id === id)
    setF((x) => ({ ...x, itemId: id, minutes: s ? String(s.durationMin) : x.minutes, pricePaise: s && !edit ? s.pricePaise : x.pricePaise, staffId: s?.staffIds.length && x.staffId && !s.staffIds.includes(x.staffId) ? "" : x.staffId }))
    setErrors({})
  }
  const roomOptions = (rooms.data?.data ?? []).filter((r) => r.isActive && (!service?.resourceKind || r.kind === service.resourceKind))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (kind === "appointment") {
      if (!guest && !contact) x.contactId = "Choose the customer"
      if (guest && f.guestName.trim().length < 2) x.guestName = "Enter the name"
      if (guest && f.guestPhone && !/^[6-9]\d{9}$/.test(f.guestPhone)) x.guestPhone = "10-digit mobile number"
      if (!f.itemId) x.itemId = "Choose the service"
      if (service?.resourceKind && !f.resourceId && roomOptions.length) x.resourceId = `This service needs a ${RESOURCE_KIND[service.resourceKind].toLowerCase()}`
    } else if (f.title.trim().length < 2) x.title = "Name the event"
    if (!f.start) x.start = "Choose when"
    const mins = Number(f.minutes)
    if (!(mins >= 5 && mins <= 960)) x.minutes = "5 minutes to 16 hours"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const startAt = fromLocal(f.start)
      const body = {
        kind, title: kind === "event" ? f.title.trim() : undefined, contactId: kind === "appointment" && !guest ? contact?.id ?? null : null,
        guestName: kind === "appointment" && guest ? f.guestName.trim() : null, guestPhone: kind === "appointment" && guest ? f.guestPhone || null : null,
        itemId: kind === "appointment" ? f.itemId : null, staffId: f.staffId || null, resourceId: f.resourceId || null, startAt,
        endAt: new Date(new Date(startAt).getTime() + mins * 60_000).toISOString(), source: f.source, pricePaise: kind === "appointment" ? f.pricePaise : null,
        notes: f.notes.trim() || null, attachmentUrl: f.attachmentUrl || null, outsideHours: f.outsideHours, ...(edit ? { version: appt!.version } : { status: f.status }),
      }
      if (edit) await api.patch(`/appointments/${appt!.id}`, Object.fromEntries(Object.entries(body).filter(([k]) => k !== "kind")))
      else await api.post("/appointments", body)
      toast.success(edit ? "Appointment saved" : kind === "appointment" ? "Booked" : "Event added")
      onSaved()
    } catch (err) {
      fail(err)
      if (err instanceof ApiError && err.fields.startAt) setErrors((y) => ({ ...y, start: err.fields.startAt }))
      setBusy(false)
    }
  }
  const outside = errors.start === "Outside working hours"
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{edit ? "Change appointment" : kind === "appointment" ? `New ${term("entity.appointment.singular", "appointment").toLowerCase()}` : "New event"}</DialogTitle><DialogDescription>Nobody and no room is ever booked twice. Free times show once the service is chosen.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          {!edit && can("bookings.appointment.create") && can("bookings.event.create") && (
            <div className="inline-flex w-fit rounded-full bg-muted p-1 text-sm" role="radiogroup" aria-label="Type">
              {(["appointment", "event"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn("rounded-full px-3 py-1", kind === k && "bg-background font-medium shadow-sm")}>{k === "appointment" ? "Customer appointment" : "Meeting or block"}</button>)}
            </div>
          )}
          {kind === "appointment" ? (
            <FormSection title="Customer and service">
              <div className="flex items-center justify-between gap-3 sm:col-span-2"><span className="text-sm font-medium">{guest ? "New person (not yet a customer)" : "Customer"}</span><label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={guest} onCheckedChange={setGuest} aria-label="New person" /> Not a customer yet</label></div>
              {guest ? <>
                <Field label="Name" required error={errors.guestName}><Input value={f.guestName} maxLength={120} onChange={(e) => set("guestName", e.target.value)} /></Field>
                <Field label="Mobile" error={errors.guestPhone} hint="For the reminder"><Input inputMode="numeric" maxLength={10} value={f.guestPhone} onChange={(e) => set("guestPhone", e.target.value.replace(/\D/g, ""))} /></Field>
              </> : <Field label="Customer" required error={errors.contactId} className="sm:col-span-2"><ContactPicker value={contact} onChange={(c) => { setContact(c); setErrors((y) => ({ ...y, contactId: "" })) }} /></Field>}
              <Field label="Service" required error={errors.itemId} className="sm:col-span-2" hint={service ? `${service.durationMin} min${service.bufferMin ? ` + ${service.bufferMin} min gap` : ""} · ${formatPaise(service.pricePaise)}` : undefined}>
                <SearchSelect value={f.itemId} onChange={pickService} options={(services.data?.data ?? []).filter((s) => s.isActive || s.id === f.itemId).map((s) => ({ value: s.id, label: `${s.name} · ${s.durationMin} min · ${formatPaise(s.pricePaise)}`, keywords: s.category ?? "" }))} placeholder="Choose a service" searchPlaceholder="Search services" aria-label="Service" />
              </Field>
              <Field label="Price" hint="Change for this visit only"><MoneyInput value={f.pricePaise} onChange={(v) => set("pricePaise", v)} aria-label="Price" /></Field>
              <Field label="Came through"><NativeSelect value={f.source} onChange={(e) => set("source", e.target.value as Appointment["source"])}>{Object.entries(SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
            </FormSection>
          ) : (
            <FormSection title="Event">
              <Field label="Title" required error={errors.title} className="sm:col-span-2"><Input value={f.title} maxLength={200} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Team meeting, Lunch break, Supplier visit" /></Field>
            </FormSection>
          )}
          <FormSection title="When and who">
            <Field label={kind === "appointment" ? "Staff" : "Whose calendar"} error={errors.staffId}>
              <SearchSelect value={f.staffId} onChange={(v) => set("staffId", v)} options={[{ value: "", label: kind === "appointment" ? "Anyone free" : "Mine" }, ...allowed.map((p) => ({ value: p.id, label: p.name }))]} placeholder="Anyone free" aria-label="Staff" />
            </Field>
            {kind === "appointment" && roomOptions.length > 0 && <Field label={service?.resourceKind ? RESOURCE_KIND[service.resourceKind] : "Room or resource"} required={!!service?.resourceKind} error={errors.resourceId}><NativeSelect value={f.resourceId} onChange={(e) => set("resourceId", e.target.value)}><option value="">{service?.resourceKind ? "Choose one" : "None"}</option>{roomOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</NativeSelect></Field>}
            <Field label="Starts" required error={errors.start}><Input type="datetime-local" step={300} value={f.start} onChange={(e) => set("start", e.target.value)} /></Field>
            <Field label="Minutes" required error={errors.minutes}><Input inputMode="numeric" value={f.minutes} onChange={(e) => set("minutes", e.target.value.replace(/\D/g, "").slice(0, 3))} /></Field>
            {kind === "appointment" && f.itemId && (
              <div className="grid gap-2 sm:col-span-2">
                <p className="text-xs font-medium text-muted-foreground">Free on {formatDate(day)}{f.staffId ? ` with ${people.find((p) => p.id === f.staffId)?.name ?? ""}` : ""}</p>
                {!slots.data ? <Spinner /> : slots.data.slots.length ? (
                  <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                    {slots.data.slots.map((s) => { const on = f.start === toLocal(s.startAt); return <button key={s.startAt} type="button" onClick={() => { set("start", toLocal(s.startAt)); if (!f.staffId && s.staff.length === 1) set("staffId", s.staff[0].id) }} title={s.staff.map((x) => x.name).join(", ")} className={cn("rounded-lg border px-2.5 py-1 text-xs font-medium tabular-nums", on ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary hover:text-primary")}>{s.time}</button> })}
                  </div>
                ) : <p className="text-xs text-muted-foreground">No free time that day. Try another day or person.</p>}
              </div>
            )}
            {outside && <label className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm sm:col-span-2 dark:bg-amber-500/10"><span>Book outside working hours anyway</span><Switch checked={f.outsideHours} onCheckedChange={(v) => set("outsideHours", v)} aria-label="Outside working hours" /></label>}
            {!edit && kind === "appointment" && <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm sm:col-span-2"><span><span className="font-medium">Already confirmed with the customer</span><span className="block text-xs text-muted-foreground">Otherwise it shows as booked until you confirm</span></span><Switch checked={f.status === "confirmed"} onCheckedChange={(v) => set("status", v ? "confirmed" : "scheduled")} aria-label="Confirmed" /></label>}
            <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything the staff should know" /></Field>
            <Field label="File" className="sm:col-span-2" hint="Optional: a report, prescription or reference photo"><FileField value={f.attachmentUrl} onChange={(v) => set("attachmentUrl", v ?? "")} prompt="Upload a file" /></Field>
          </FormSection>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!appt && unchanged)}>{busy ? "Saving…" : edit ? "Save" : kind === "appointment" ? "Book" : "Add event"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Cancel needs a reason */
export function CancelDialog({ appt, onClose, onSaved }: { appt: Appointment; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 3) return setError("Say why it is cancelled")
    setBusy(true)
    try { await api.post(`/appointments/${appt.id}/status`, { action: "cancel", reason: reason.trim() }); toast.success("Cancelled"); onSaved() } catch (err) { setError(errorMessage(err)); setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Cancel this appointment?</DialogTitle><DialogDescription>{appt.title} · {formatDateTime(appt.startAt)}. The time becomes free again.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <div className="flex flex-wrap gap-1.5">{["Customer asked", "Customer not well", "Staff not available", "Booked by mistake"].map((r) => <button key={r} type="button" onClick={() => { setReason(r); setError(null) }} className={cn("rounded-full border px-2.5 py-1 text-xs", reason === r ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary")}>{r}</button>)}</div>
          <Field label="Reason" required error={error}><Textarea rows={2} maxLength={300} value={reason} onChange={(e) => { setReason(e.target.value); setError(null) }} /></Field>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Keep it</Button><Button type="submit" variant="destructive" disabled={busy}>{busy ? "Cancelling…" : "Cancel appointment"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** One appointment with everything it can do: confirm, check in, complete, no-show, remind, invoice,
 *  change, cancel, open again */
export function AppointmentView({ appt: a, onClose, onChanged }: { appt: Appointment; onClose: () => void; onChanged: () => void }) {
  const { can, me } = useAuth()
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const canEdit = can("bookings.appointment.edit")
  const [now] = React.useState(() => Date.now())
  const started = new Date(a.startAt).getTime() <= now + 15 * 60_000
  async function act(action: string, done: string) {
    setBusy(true)
    try { await api.post(`/appointments/${a.id}/status`, { action }); toast.success(done); onChanged() } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  async function invoice() {
    setBusy(true)
    try { const inv = await api.post<{ id: string }>(`/appointments/${a.id}/invoice`); toast.success("Draft invoice made"); router.push(`/app/m/billing/${inv.id}`) } catch (e) { toast.error(errorMessage(e)); setBusy(false) }
  }
  async function remove() {
    try { await api.delete(`/appointments/${a.id}`); toast.success("Removed"); onChanged() } catch (e) { toast.error(errorMessage(e)) }
  }
  const wa = a.kind === "appointment" ? reminderLink(a, me?.tenant?.name ?? "our shop") : null
  if (editing) return <AppointmentDialog appt={a} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged() }} />
  if (cancelling) return <CancelDialog appt={a} onClose={() => setCancelling(false)} onSaved={() => { setCancelling(false); onChanged() }} />
  const btn = buttonVariants({ variant: "outline" })
  return (
    <RecordView
      title={a.title}
      icon={CalendarClock}
      onClose={onClose}
      status={<Pill color={STATUS[a.status].color} dot>{STATUS[a.status].label}</Pill>}
      fields={[
        { label: "When", value: `${formatDate(a.startAt)} · ${timeOf(a.startAt)}–${timeOf(a.endAt)} (${a.durationMin} min)` },
        a.kind === "appointment" && { label: "Customer", person: { name: a.customerName ?? "—", sub: a.customerPhone ?? (a.guestName ? "New person" : null) }, value: a.customerName },
        a.kind === "appointment" && { label: "Service", value: a.item ? `${a.item.name} · ${formatPaise(a.amountPaise)}` : null },
        { label: a.kind === "appointment" ? "Staff" : "Calendar of", value: a.staff?.name ?? "Anyone" },
        !!a.resource && { label: RESOURCE_KIND[a.resource.kind as keyof typeof RESOURCE_KIND] ?? "Room", value: a.resource!.name },
        a.kind === "appointment" && { label: "Came through", value: SOURCE[a.source] },
        a.kind === "appointment" && { label: "Confirmed", value: a.confirmedAt ? formatDateTime(a.confirmedAt) : "Not yet", tone: a.confirmedAt ? "success" : undefined },
        !!a.checkedInAt && { label: "Arrived", value: formatDateTime(a.checkedInAt!) },
        a.kind === "appointment" && { label: "Reminder", value: a.remindedAt ? `Sent ${formatDateTime(a.remindedAt)}` : "Not sent" },
        !!a.invoice && { label: "Invoice", value: <Link href={`/app/m/billing/${a.invoice!.id}`} className="font-medium text-primary hover:underline">{a.invoice!.number ?? "Draft"}</Link> },
        !!a.cancelReason && { label: "Why cancelled", value: a.cancelReason, tone: "danger", full: true },
        !!a.notes && { label: "Notes", value: a.notes, full: true },
        !!a.attachmentUrl && { label: "File", value: <FileChip value={a.attachmentUrl} />, full: true },
      ]}
      footer={<>
        {a.customerPhone && <a href={`tel:${a.customerPhone}`} className={buttonVariants({ variant: "outline", size: "icon" })} title="Call" aria-label="Call"><Phone /></a>}
        {wa && isOpen(a.status) && <a href={wa} target="_blank" rel="noreferrer" className={cn(btn, "text-emerald-700 dark:text-emerald-300")} onClick={() => void api.post(`/appointments/${a.id}/reminded`).then(onChanged).catch(() => {})}><MessageCircle /> Remind</a>}
        {canEdit && isOpen(a.status) && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Change</Button>}
        {canEdit && a.status === "scheduled" && <Button variant="outline" disabled={busy} onClick={() => void act("confirm", "Confirmed")}><Check /> Confirm</Button>}
        {canEdit && isOpen(a.status) && a.kind === "appointment" && started && !a.checkedInAt && <Button variant="outline" disabled={busy} onClick={() => void act("check_in", "Checked in")}><LogIn /> Arrived</Button>}
        {canEdit && isOpen(a.status) && a.kind === "appointment" && started && <Button variant="outline" disabled={busy} className="text-rose-700 dark:text-rose-300" onClick={() => void act("no_show", "Marked no-show")}><UserX /> No-show</Button>}
        {canEdit && isOpen(a.status) && started && <Button disabled={busy} onClick={() => void act("complete", "Completed")}><CheckCheck /> Complete</Button>}
        {a.status === "completed" && !a.invoiceId && a.itemId && can("billing.invoice.create") && <Button disabled={busy} onClick={() => void invoice()}><FileText /> Make invoice</Button>}
        {canEdit && isOpen(a.status) && <Button variant="outline" className="text-destructive" onClick={() => setCancelling(true)}><Ban /> Cancel</Button>}
        {canEdit && ["cancelled", "no_show"].includes(a.status) && <Button variant="outline" disabled={busy} onClick={() => void act("reopen", "Booked again")}><RotateCcw /> Book again</Button>}
        {can("bookings.appointment.delete") && (a.kind === "event" || a.status === "cancelled") && !a.invoiceId && <Button variant="ghost" className="text-destructive" onClick={() => void remove()}><Trash2 /> Remove</Button>}
      </>}
    />
  )
}

// ---------------------------------------------------------------- service settings

export function ServiceDialog({ service: s, onClose, onSaved }: { service: Service; onClose: () => void; onSaved: () => void }) {
  const { people } = usePeople()
  const [f, setF] = React.useState({ durationMin: String(s.durationMin), bufferMin: String(s.bufferMin), pricePaise: s.pricePaise as number | null, color: s.color, staffIds: s.staffIds, resourceKind: s.resourceKind ?? "", online: s.online, isActive: s.isActive, notes: s.notes ?? "" })
  const { errors, setErrors, error, setError, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    const d = Number(f.durationMin)
    if (!(d >= 5 && d <= 960)) x.durationMin = "5 minutes to 16 hours"
    if (!(Number(f.bufferMin) >= 0 && Number(f.bufferMin) <= 240)) x.bufferMin = "0 to 240 minutes"
    if (f.pricePaise == null) x.pricePaise = "Enter the price (0 if free)"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      await api.put(`/booking-services/${s.id}`, { durationMin: d, bufferMin: Number(f.bufferMin), pricePaise: f.pricePaise, color: f.color, staffIds: f.staffIds, resourceKind: f.resourceKind || null, online: f.online, isActive: f.isActive, notes: f.notes.trim() || null })
      toast.success(`${s.name} saved`)
      onSaved()
    } catch (err) { fail(err); setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{s.name}</DialogTitle><DialogDescription>How this service is booked. The price and length are saved on the item too.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <FormSection title="Time and price">
            <Field label="Takes (minutes)" required error={errors.durationMin}><Input inputMode="numeric" value={f.durationMin} onChange={(e) => set("durationMin", e.target.value.replace(/\D/g, "").slice(0, 3))} /></Field>
            <Field label="Gap after (minutes)" error={errors.bufferMin} hint="Cleaning or getting ready"><Input inputMode="numeric" value={f.bufferMin} onChange={(e) => set("bufferMin", e.target.value.replace(/\D/g, "").slice(0, 3))} /></Field>
            <Field label="Price" required error={errors.pricePaise}><MoneyInput value={f.pricePaise} onChange={(v) => set("pricePaise", v)} aria-label="Price" /></Field>
            <Field label="Colour on the calendar"><div className="flex gap-1.5 pt-1">{COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => set("color", c)} className={cn("size-7 rounded-full border-2", DOT[c], f.color === c ? "border-foreground" : "border-transparent")} />)}</div></Field>
          </FormSection>
          <FormSection title="Who and where">
            <Field label="Done by" className="sm:col-span-2" hint={f.staffIds.length ? undefined : "Nobody chosen: anyone can do it"}>
              <div className="flex flex-wrap gap-1.5 rounded-xl border p-2">{people.map((p) => { const on = f.staffIds.includes(p.id); return <button key={p.id} type="button" onClick={() => set("staffIds", on ? f.staffIds.filter((x) => x !== p.id) : [...f.staffIds, p.id])} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary")}>{on && <Check className="size-3" />}{p.name}</button> })}</div>
            </Field>
            <Field label="Needs" className="sm:col-span-2"><NativeSelect value={f.resourceKind} onChange={(e) => set("resourceKind", e.target.value)}><option value="">No room or chair</option>{Object.entries(RESOURCE_KIND).map(([k, l]) => <option key={k} value={k}>A free {l.toLowerCase()}</option>)}</NativeSelect></Field>
          </FormSection>
          <FormSection title="Booking">
            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm"><span className="font-medium">Customers can book it online</span><Switch checked={f.online} onCheckedChange={(v) => set("online", v)} aria-label="Online" /></label>
            <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm"><span className="font-medium">Open for booking</span><Switch checked={f.isActive} onCheckedChange={(v) => set("isActive", v)} aria-label="Open for booking" /></label>
            <Field label="Note for staff" className="sm:col-span-2"><Textarea rows={2} maxLength={1000} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional, e.g. Ask about allergies first" /></Field>
          </FormSection>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save service"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- rooms and resources

export function ResourceDialog({ resource: r, onClose, onSaved }: { resource?: Resource | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ name: r?.name ?? "", kind: r?.kind ?? "room", capacity: String(r?.capacity ?? 1), color: r?.color ?? "slate", notes: r?.notes ?? "", isActive: r?.isActive ?? true })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const { errors, setErrors, error, setError, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.name.trim().length < 2) x.name = "Name it, e.g. Room 1"
    if (!(Number(f.capacity) >= 1)) x.capacity = "At least 1"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const body = { ...f, name: f.name.trim(), capacity: Number(f.capacity), notes: f.notes.trim() || null }
      if (r) await api.put(`/booking-resources/${r.id}`, { ...body, version: r.version }); else await api.post("/booking-resources", body)
      toast.success(r ? "Saved" : `${body.name} added`)
      onSaved()
    } catch (err) { fail(err); setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{r ? `Edit ${r.name}` : "New room or resource"}</DialogTitle><DialogDescription>A room, chair or machine is never booked twice at once.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Name" required error={errors.name} className="sm:col-span-2"><Input value={f.name} maxLength={60} autoFocus onChange={(e) => set("name", e.target.value)} placeholder="e.g. Room 1, Chair 2, Laser machine" /></Field>
          <Field label="Kind"><NativeSelect value={f.kind} onChange={(e) => set("kind", e.target.value as Resource["kind"])}>{Object.entries(RESOURCE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
          <Field label="People at once" error={errors.capacity}><Input inputMode="numeric" value={f.capacity} onChange={(e) => set("capacity", e.target.value.replace(/\D/g, "").slice(0, 3))} /></Field>
          <Field label="Colour" className="sm:col-span-2"><div className="flex gap-1.5 pt-1">{COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => set("color", c)} className={cn("size-7 rounded-full border-2", DOT[c], f.color === c ? "border-foreground" : "border-transparent")} />)}</div></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} maxLength={500} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm sm:col-span-2"><span className="font-medium">Open for booking</span><Switch checked={f.isActive} onCheckedChange={(v) => set("isActive", v)} aria-label="Open for booking" /></label>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!r && unchanged)}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- staff hours and time off

export function HoursDialog({ person, onClose, onSaved }: { person: StaffRow; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = React.useState(person.hours.map((h, i) => ({ ...h, key: i })))
  const { error, setError, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  const day = (d: number) => rows.filter((r) => r.weekday === d)
  const add = (d: number) => setRows((x) => [...x, { weekday: d, start: "10:00", end: "19:00", key: Math.random() }])
  const copyMon = () => setRows((x) => { const mon = x.filter((r) => r.weekday === 1); return [...x.filter((r) => r.weekday === 0 || r.weekday === 1), ...[2, 3, 4, 5, 6].flatMap((d) => mon.map((m) => ({ ...m, weekday: d, key: Math.random() })))] })
  async function save() {
    if (rows.some((r) => r.end <= r.start)) return setError("Each stretch must end after it starts")
    setBusy(true)
    try { await api.put(`/staff/${person.id}/hours`, { hours: rows.map(({ weekday, start, end }) => ({ weekday, start, end })) }); toast.success(`${person.name}'s hours saved`); onSaved() } catch (err) { fail(err); setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{person.name}: working hours</DialogTitle><DialogDescription>Appointments and online booking use these. Add a second stretch for a split shift; leave a day empty for a day off.</DialogDescription></DialogHeader>
        <div className="grid gap-2">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <div key={d} className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-start gap-2 rounded-xl border px-3 py-2">
              <span className="pt-1.5 text-sm font-medium">{WEEKDAYS[d].slice(0, 3)}</span>
              <div className="grid gap-1.5">
                {day(d).length ? day(d).map((r) => (
                  <div key={r.key} className="flex items-center gap-1.5">
                    <Input type="time" className="h-8 w-28" value={r.start} onChange={(e) => setRows((x) => x.map((y) => (y.key === r.key ? { ...y, start: e.target.value } : y)))} aria-label="From" />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input type="time" className="h-8 w-28" value={r.end} onChange={(e) => setRows((x) => x.map((y) => (y.key === r.key ? { ...y, end: e.target.value } : y)))} aria-label="To" />
                    <button type="button" className="text-muted-foreground hover:text-destructive" aria-label="Remove" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}><Trash2 className="size-4" /></button>
                  </div>
                )) : <span className="pt-1.5 text-sm text-muted-foreground">Day off</span>}
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => add(d)}>+ Add</Button>
            </div>
          ))}
        </div>
        <FormError message={error} />
        <DialogFooter><Button type="button" variant="ghost" onClick={copyMon}>Copy Monday to all weekdays</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save hours"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TimeOffDialog({ personId, onClose, onSaved }: { personId?: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ userId: personId ?? "", fromDate: todayInIndia(), toDate: todayInIndia(), fullDay: true, fromTime: "14:00", toTime: "18:00", reason: "" })
  const { people } = usePeople()
  const { errors, setErrors, error, setError, fail } = useErrors()
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.userId) x.userId = "Choose the person"
    if (f.toDate < f.fromDate) x.toDate = "Can't end before it starts"
    if (!f.fullDay && f.fromDate === f.toDate && f.toTime <= f.fromTime) x.toTime = "Must be after the start"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try { await api.post("/staff-time-off", { userId: f.userId, fromDate: f.fromDate, toDate: f.toDate, fromTime: f.fullDay ? null : f.fromTime, toTime: f.fullDay ? null : f.toTime, reason: f.reason.trim() || null }); toast.success("Time off added"); onSaved() } catch (err) { fail(err); setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Time off</DialogTitle><DialogDescription>Nobody can be booked with this person then, online or at the counter.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          {!personId && <Field label="Who" required error={errors.userId} className="sm:col-span-2"><SearchSelect value={f.userId} onChange={(v) => set("userId", v)} options={people.map((p) => ({ value: p.id, label: p.name }))} placeholder="Choose a person" aria-label="Who" /></Field>}
          <Field label="From" required error={errors.fromDate}><Input type="date" value={f.fromDate} onChange={(e) => set("fromDate", e.target.value)} /></Field>
          <Field label="To" required error={errors.toDate}><Input type="date" min={f.fromDate} value={f.toDate} onChange={(e) => set("toDate", e.target.value)} /></Field>
          <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm sm:col-span-2"><span className="font-medium">Whole days</span><Switch checked={f.fullDay} onCheckedChange={(v) => set("fullDay", v)} aria-label="Whole days" /></label>
          {!f.fullDay && <>
            <Field label="From time"><Input type="time" value={f.fromTime} onChange={(e) => set("fromTime", e.target.value)} /></Field>
            <Field label="To time" error={errors.toTime}><Input type="time" value={f.toTime} onChange={(e) => set("toTime", e.target.value)} /></Field>
          </>}
          <Field label="Reason" className="sm:col-span-2"><Input value={f.reason} maxLength={200} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. Leave, Training, Doctor visit" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add time off"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
