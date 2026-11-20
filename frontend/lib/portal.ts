// Customer portal: its own sign-in (kept per business in this browser) and requests that never
// carry a staff login. Types for what the portal pages show.
import { ApiError } from "@/lib/api"

export interface PortalInfo {
  business: { name: string; phone: string | null; email: string | null; city: string | null; logoUrl: string | null }
  title: string
  intro: string | null
  parts: { bills: boolean; quotes: boolean; statement: boolean; requests: boolean; bookings: boolean }
}
export interface Account { id: string; name: string; person: string | null; gstin: string | null }
export interface PortalSession { token: string; accounts: Account[]; accountId: string }

export interface Home {
  customer: { id: string; name: string; person: string | null; phone: string | null; email: string | null; gstin: string | null; address: Record<string, string> | null }
  dues: { duePaise: number; overduePaise: number; openBills: number; nextDue: string | null; creditPaise: number }
  lastPayment: { amountPaise: number; paidOn: string; method: string } | null
  year: { boughtPaise: number; bills: number }
  waiting: { quotes: number; requests: number }
  bookings: { id: string; title: string; startAt: string; status: string; service: string | null }[]
}
export interface Doc { id: string; kind: "invoice" | "credit_note" | "debit_note" | "quotation"; number: string | null; status: string; issueDate: string; dueDate: string | null; totalPaise: number; paidPaise: number; shareToken: string | null; duePaise: number; overdue: boolean }
export interface Request { number: string; subject: string; status: string; createdAt: string; resolvedAt: string | null; publicToken: string; rating: number | null }
export interface Booking { id: string; title: string; startAt: string; endAt: string; status: string; pricePaise: number | null; cancelReason: string | null; service: string | null; staff: string | null }

const key = (slug: string) => `portal:${slug}`
export function loadSession(slug: string): PortalSession | null {
  try { return JSON.parse(localStorage.getItem(key(slug)) ?? "null") as PortalSession | null } catch { return null }
}
export function saveSession(slug: string, s: PortalSession | null) {
  try { if (s) localStorage.setItem(key(slug), JSON.stringify(s)); else localStorage.removeItem(key(slug)) } catch { /* private mode: sign in each visit */ }
}

/** A portal request: the customer's own token and chosen account, never the staff token */
export async function portalApi<T>(slug: string, path: string, opts: { session?: PortalSession | null; method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/v1/public/portal/${slug}${path}`, {
      method: opts.method ?? "GET",
      credentials: "omit",
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.session ? { "x-portal-token": opts.session.token, "x-portal-account": opts.session.accountId } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the server. Check your connection and try again.")
  }
  const text = await res.text()
  const json = text ? (JSON.parse(text) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }) : undefined
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "INTERNAL", json?.error?.message ?? "Something went wrong.", json?.error?.details)
  return json as T
}

export const DOC_KIND: Record<Doc["kind"], string> = { invoice: "Bill", credit_note: "Credit note", debit_note: "Debit note", quotation: "Quotation" }
export const DOC_STATUS: Record<string, { label: string; tone: string }> = {
  issued: { label: "To pay", tone: "bg-amber-100 text-amber-800" }, partially_paid: { label: "Part paid", tone: "bg-amber-100 text-amber-800" }, paid: { label: "Paid", tone: "bg-emerald-100 text-emerald-800" },
  sent: { label: "Waiting for you", tone: "bg-blue-100 text-blue-800" }, accepted: { label: "Accepted", tone: "bg-emerald-100 text-emerald-800" }, declined: { label: "Declined", tone: "bg-neutral-200 text-neutral-700" },
  converted: { label: "Billed", tone: "bg-emerald-100 text-emerald-800" }, expired: { label: "Expired", tone: "bg-neutral-200 text-neutral-700" },
}
export const REQ_STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: "Received", tone: "bg-blue-100 text-blue-800" }, open: { label: "Being worked on", tone: "bg-violet-100 text-violet-800" }, pending: { label: "Waiting for you", tone: "bg-amber-100 text-amber-800" },
  on_hold: { label: "On hold", tone: "bg-neutral-200 text-neutral-700" }, resolved: { label: "Resolved", tone: "bg-emerald-100 text-emerald-800" }, closed: { label: "Closed", tone: "bg-neutral-200 text-neutral-700" },
}
