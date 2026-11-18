// Customer Service: types and labels shared by the tickets, ticket, knowledge base, setup and report pages.
import { useSharedApi } from "@/lib/use-api"

export type TicketStatus = "new" | "open" | "pending" | "on_hold" | "resolved" | "closed"
export type TicketPriority = "low" | "medium" | "high" | "urgent"
export type Channel = "phone" | "whatsapp" | "email" | "walk_in" | "web" | "other"
export interface Category { key: string; label: string; color: string }

export interface TicketRow {
  id: string
  number: string
  subject: string
  status: TicketStatus
  priority: TicketPriority
  category: string
  channel: Channel
  assigneeId: string | null
  assignee: { id: string; name: string } | null
  contactId: string | null
  customer: string
  phone: string | null
  labels: string[]
  firstResponseDue: string | null
  resolveDue: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  rating: number | null
  serial: string | null
  invoiceId: string | null
  invoiceNumber: string | null
  itemName: string | null
  messages: number
  overdue: boolean
  responseLate: boolean
  awaitingUs: boolean
  firstMin: number | null
  resolveMin: number | null
  createdAt: string
  updatedAt: string
  version: number
}

export interface Message { id: string; kind: "reply" | "note" | "customer" | "event"; body: string | null; by: string; authorId: string | null; meta: Record<string, unknown> | null; createdAt: string }

export interface Ticket {
  id: string
  number: string
  subject: string
  description: string | null
  status: TicketStatus
  priority: TicketPriority
  category: string
  channel: Channel
  assigneeId: string | null
  assignee: { id: string; name: string } | null
  contactId: string | null
  labels: string[]
  invoiceId: string | null
  itemId: string | null
  serial: string | null
  firstResponseDue: string | null
  resolveDue: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  reopened: number
  rating: number | null
  feedback: string | null
  publicToken: string
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  version: number
  messages: Message[]
  customer: { id: string | null; type: string; name: string | null; person: string | null; phone: string | null; email: string | null; gstin: string | null }
  otherTickets: { id: string; number: string; subject: string; status: TicketStatus; createdAt: string }[]
  invoice: { id: string; kind: string; number: string | null; issueDate: string; totalPaise: number; status: string } | null
  item: { id: string; name: string; sku: string | null; type: string } | null
  recentInvoices: { id: string; number: string | null; issueDate: string; totalPaise: number }[]
  warranty: { soldOn: string; endsOn: string; months: number; inWarranty: boolean; invoice: { id: string; number: string | null } | null; fromSerial: boolean } | null
}

export interface Article { id: string; title: string; body: string; category: string | null; tags: string[]; kind: "article" | "reply"; published: boolean; uses: number; createdByName: string | null; createdAt: string; updatedAt: string; version: number }

export interface SupportSettings {
  formEnabled: boolean
  slug: string | null
  title: string
  intro: string | null
  categories: Category[]
  sla: Record<TicketPriority, { respondH: number; resolveH: number }>
  warrantyMonths: number
  autoAssign: "none" | "round_robin"
  askRating: boolean
  autoCloseDays: number
}

export const STATUS: Record<TicketStatus, { label: string; color: string }> = {
  new: { label: "New", color: "blue" },
  open: { label: "Open", color: "violet" },
  pending: { label: "Waiting on customer", color: "amber" },
  on_hold: { label: "On hold", color: "slate" },
  resolved: { label: "Resolved", color: "emerald" },
  closed: { label: "Closed", color: "slate" },
}
export const PRIORITY: Record<TicketPriority, { label: string; color: string }> = {
  low: { label: "Low", color: "slate" },
  medium: { label: "Medium", color: "blue" },
  high: { label: "High", color: "amber" },
  urgent: { label: "Urgent", color: "rose" },
}
export const CHANNEL: Record<Channel, string> = { phone: "Phone", whatsapp: "WhatsApp", email: "Email", walk_in: "Walk-in", web: "Online form", other: "Other" }
export const OPEN_STATUSES: TicketStatus[] = ["new", "open", "pending", "on_hold"]

/** 95 → "1h 35m"; 3000 → "2d 2h" */
export function duration(min: number | null | undefined) {
  if (min === null || min === undefined) return "—"
  if (min < 60) return `${min}m`
  if (min < 1440) return `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}`
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  return `${d}d${h ? ` ${h}h` : ""}`
}

/** "Due in 3h" / "4h late" for an SLA time; null once met or the ticket is done */
export function slaText(due: string | null, doneAt: string | null, now: number) {
  if (!due || doneAt) return null
  const diff = Math.round((new Date(due).getTime() - now) / 60_000)
  return diff >= 0 ? { text: `in ${duration(diff)}`, late: false, soon: diff < 60 } : { text: `${duration(-diff)} late`, late: true, soon: false }
}

export const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}?text=${encodeURIComponent(text)}`

export function useSupportSettings() {
  return useSharedApi<SupportSettings>("/support/settings")
}
export function useAgents() {
  return useSharedApi<{ data: { id: string; name: string; role: string }[]; me: string }>("/support/agents")
}
export const categoryOf = (cats: Category[] | undefined, key: string) => cats?.find((c) => c.key === key) ?? { key, label: key, color: "slate" }
