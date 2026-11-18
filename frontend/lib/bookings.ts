// Calendar & Bookings: types and labels shared by the calendar, list, services, staff, rooms and
// online booking pages.

export type ApptStatus = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show"
export type Source = "walk_in" | "phone" | "whatsapp" | "online"

export interface Appointment {
  id: string
  kind: "appointment" | "event"
  title: string
  contactId: string | null
  guestName: string | null
  guestPhone: string | null
  itemId: string | null
  staffId: string | null
  resourceId: string | null
  startAt: string
  endAt: string
  status: ApptStatus
  source: Source
  pricePaise: number | null
  notes: string | null
  cancelReason: string | null
  confirmedAt: string | null
  checkedInAt: string | null
  remindedAt: string | null
  invoiceId: string | null
  createdAt: string
  version: number
  /** From the list */
  durationMin: number
  contact: { id: string; name: string; phone: string | null; type: string } | null
  customerName: string | null
  customerPhone: string | null
  item: { id: string; name: string; pricePaise: number | null } | null
  staff: { id: string; name: string } | null
  resource: { id: string; name: string; kind: string } | null
  invoice: { id: string; number: string | null; status: string } | null
  color: string
  amountPaise: number
  createdByName: string | null
}

export interface Service {
  id: string
  name: string
  sku: string | null
  category: string | null
  pricePaise: number
  gstRateBp: number
  configured: boolean
  durationMin: number
  bufferMin: number
  color: string
  staffIds: string[]
  staff: { id: string; name: string }[]
  resourceKind: "room" | "chair" | "equipment" | null
  online: boolean
  isActive: boolean
  notes: string | null
  booked30: number
  revenue30Paise: number
  upcoming: number
  version: number
}

export interface Resource { id: string; name: string; kind: "room" | "chair" | "equipment"; capacity: number; color: string; notes: string | null; isActive: boolean; upcoming: number; used30: number; used30Min: number; inUseBy: string | null; version: number }

export interface StaffRow {
  id: string
  name: string
  email: string
  role: string
  usesDefault: boolean
  hours: { weekday: number; start: string; end: string }[]
  weekHours: number
  bookedThisWeek: number
  bookedPct: number
  timeOff: { id: string; fromAt: string; toAt: string; reason: string | null }[]
  offNow: boolean
}

export interface Slot { time: string; startAt: string; staff: { id: string; name: string }[] }

export const STATUS: Record<ApptStatus, { label: string; color: string }> = {
  scheduled: { label: "Booked", color: "amber" },
  confirmed: { label: "Confirmed", color: "blue" },
  completed: { label: "Completed", color: "emerald" },
  cancelled: { label: "Cancelled", color: "slate" },
  no_show: { label: "No-show", color: "rose" },
}
export const SOURCE: Record<Source, string> = { walk_in: "Walk-in", phone: "Phone", whatsapp: "WhatsApp", online: "Online" }
export const RESOURCE_KIND = { room: "Room", chair: "Chair", equipment: "Equipment" } as const
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** A status that still needs something done (on the calendar these are bright) */
export const isOpen = (s: ApptStatus) => s === "scheduled" || s === "confirmed"
/** India time of an ISO moment, "10:30 am" */
export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
/** India date of an ISO moment, YYYY-MM-DD */
export const dayOf = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10)
/** WhatsApp link with a reminder in the customer's words */
export function reminderLink(a: Appointment, business: string) {
  const phone = (a.customerPhone ?? "").replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")
  if (!phone) return null
  const when = `${new Date(a.startAt).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} at ${timeOf(a.startAt)}`
  const text = `Hello ${a.customerName ?? ""}, a reminder of your ${a.item?.name ?? "appointment"} at ${business} on ${when}${a.staff ? ` with ${a.staff.name}` : ""}. Reply here to change it.`
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}
