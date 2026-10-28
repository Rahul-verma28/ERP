import type { PlanLimits, Scope, TenantStatus } from "@/lib/types"

// Shapes returned by the Console API (/console/*), design v2.

export interface ClientRow {
  id: string
  name: string
  industryKey: string
  status: TenantStatus
  source: "direct" | "vendor" | "sales" | "partner"
  isInternal: boolean
  createdAt: string
  plan: string | null
  trialEndsAt: string | null
  renewsAt: string | null
  owner: { id: string; name: string; email: string } | null
  acquiredBy: string | null
  activeUsers: number
  mrrPaise: number | null
  health: Health | null
  next: { title: string; dueAt: string } | null
  partner: string | null
}

export type AcquiredByType = "self" | "vendor" | "sales_user" | "partner_user"
export type AcquisitionMethod = "signup" | "referral_link" | "referral_code" | "manual"

export interface ClientDetail {
  id: string
  name: string
  legalName: string | null
  industryKey: string
  gstin: string | null
  billingStateCode: string | null
  status: TenantStatus
  source: ClientRow["source"]
  onboardingType: "trial" | "direct_paid"
  isInternal: boolean
  createdAt: string
  owner: { name: string; email: string; mobile: string; emailVerified: boolean; lastLoginAt: string | null } | null
  subscription: {
    status: TenantStatus
    cycle: "monthly" | "yearly"
    plan: { key: string; name: string; limits: PlanLimits } | null
    trialEndsAt: string | null
    currentPeriodEnd: string | null
    graceEndsAt: string | null
    cancelAtPeriodEnd: boolean
  } | null
  modules: { key: string; status: "active" | "read_only" | "inactive"; tier: string }[]
  usage: { activeUsers: number; branches: number; thisMonth: Record<string, number> }
  acquisition: {
    byType: AcquiredByType
    by: { id: string; name: string; email: string } | null
    method: AcquisitionMethod
    referralCode: string | null
    couponCode: string | null
    lockedAt: string
    changeReason: string | null
    changedBy: string | null
  } | null
  orders: { id: string; status: OrderStatus; cycle: string; totalPaise: number; createdAt: string; paidAt: string | null; expiresAt: string; invoice: { id: string; number: string } | null }[]
  extensions: { id: string; kind: "trial" | "grace"; days: number; reason: string; newEndAt: string; createdAt: string; grantedBy: string | null }[]
  partner: { id: string; name: string } | null
  billedBy: "self" | "partner"
  history: { id: string; action: string; at: string; actor: string | null }[]
}

export interface Catalog {
  plans: { key: string; name: string; tagline: string | null; limits: PlanLimits; isPublic: boolean; fullModules: string[]; subscribers: number }[]
  modules: { key: string; name: string; freeTier: boolean; dependsOn: string[] }[]
  prices: { id: string; itemType: "plan" | "addon_module" | "extra_user"; itemRef: string; cycle: "monthly" | "yearly"; amountPaise: number; activeFrom: string }[]
  coupons: { code: string; type: "percent" | "flat"; value: number; appliesTo: string; validFrom: string | null; validTo: string | null; maxRedemptions: number | null; redeemed: number; active: boolean }[]
}

export interface ConsoleMember {
  id: string
  status: "invited" | "active" | "deactivated"
  joinedAt: string
  user: { id: string; name: string; email: string; mobile: string; lastLoginAt: string | null }
  role: { key: string; name: string }
  reportsTo: { userId: string; name: string | null } | null
}

export interface ConsoleRole {
  id: string
  key: string
  name: string
  description: string | null
  members: number
  permissions: Record<string, Scope>
}

export interface SettingRow {
  key: string
  description: string
  default: unknown
  value: unknown
  overridden: boolean
  version: number
}

export const STATUS_LABEL: Record<TenantStatus, string> = {
  incomplete: "Awaiting payment",
  trialing: "On trial",
  active: "Paying",
  past_due: "Payment failed",
  free: "Free plan",
  closed: "Closed",
  purged: "Deleted",
}

export const SOURCE_LABEL: Record<ClientRow["source"], string> = { direct: "Self-signup", vendor: "Vendor", sales: "Sales team", partner: "Partner" }

export const ACQUIRER_LABEL: Record<AcquiredByType, string> = { self: "Self-signup", vendor: "Vendor", sales_user: "Sales team", partner_user: "Partner" }

export const METHOD_LABEL: Record<AcquisitionMethod, string> = { signup: "Signed up", referral_link: "Referral link", referral_code: "Referral code", manual: "Added by hand" }

// ── Step 4: paid onboarding, orders, AHEAD invoices ──

export type OrderStatus = "pending_approval" | "awaiting_payment" | "paid" | "cancelled"

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_approval: "Needs approval",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  cancelled: "Cancelled",
}

export interface OrderItem {
  itemType: "plan" | "addon_module" | "extra_user"
  itemRef: string
  description: string
  quantity: number
  unitPaise: number
  amountPaise: number
  discountPaise: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  totalPaise: number
}

export interface Quote {
  plan: { key: string; name: string }
  cycle: "monthly" | "yearly"
  items: OrderItem[]
  listPaise: number
  salesDiscountPaise: number
  couponCode: string | null
  couponDiscountPaise: number
  discountPaise: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  totalPaise: number
  gstRateBp: number
  intraState: boolean
  discountLimitPercent: number
  needsApproval: boolean
}

export interface BillTo {
  name: string
  gstin: string | null
  stateCode: string
  address: string | null
}

export interface OrderRow {
  id: string
  tenantId: string
  kind: "fresh" | "renewal"
  paymentLinkUrl: string | null
  status: OrderStatus
  cycle: "monthly" | "yearly"
  totalPaise: number
  discountBp: number
  createdAt: string
  expiresAt: string
  paidAt: string | null
  clientName: string | null
  createdByName: string | null
  invoice: { id: string; number: string } | null
}

export interface OrderDetail extends Omit<OrderRow, "clientName" | "invoice"> {
  createdBy: string
  items: OrderItem[]
  listPaise: number
  couponCode: string | null
  discountPaise: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  billTo: BillTo
  approvedAt: string | null
  approvedByName: string | null
  cancelledReason: string | null
  client: { name: string; status: TenantStatus } | null
  payments: { id: string; method: string; amountPaise: number; reference: string | null; receivedAt: string; recordedBy: string | null }[]
  invoice: PlatformInvoice | null
}

export interface CreditNote {
  id: string
  number: string
  reason: string
  totalPaise: number
  issuedAt: string
}

export interface PlatformInvoice {
  id: string
  number: string
  fy: string
  tenantId: string
  orderId: string
  seller: { legalName: string; gstin: string; stateCode: string; address: string; sac: string; gstRateBp: number }
  billTo: BillTo
  lines: { description: string; sac: string; quantity: number; unitPaise: number; discountPaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number }[]
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  totalPaise: number
  issuedAt: string
  /** Present on GET /console/invoices/:id */
  creditNote?: CreditNote | null
}

// ── Product v3 Phase 4: home, revenue, Client 360, sales, history, security ──

export type HealthFlag = "good" | "no_invoice" | "limit" | "errors" | "quiet"
export interface Health { flag: HealthFlag; label: string }

export interface ClientSummary {
  health: Health
  mrr: number | null
  users: { active: number; max: number | null; activeThisWeek: number }
  setup: { done: number; total: number; missing: string[] }
  next: { id: string; title: string; dueAt: string; owner: string | null } | null
}

export interface AccountHealth {
  setup: { key: string; label: string; state: "done" | "skipped" | null }[]
  setupCompleted: boolean
  records: { customers: number; invoices: number; appointments: number; items: number; quotations: number; expenses: number }
  limits: Record<"users" | "invoicesThisMonth" | "contacts" | "items", { used: number; max: number | null }>
  modules: { key: string; status: "active" | "read_only" | "inactive"; tier: string }[]
  lastSignIn: string | null
  twoStep: { admins: number; adminsOn: number }
  errors: { failedJobs: number; importBadRows: number }
}

export interface ClientUser { id: string; name: string; role: string; roleKey: string; status: string; twoStep: boolean; lastSignIn: string | null }

export type TimelineKind = "plan" | "payment" | "note" | "followup" | "reminder" | "account"
export interface TimelineEvent { id: string; at: string; kind: TimelineKind; text: string; who: string | null }

export interface ConsoleNote { id: string; body: string; privateToTeam: boolean; author: string | null; mine: boolean; createdAt: string }

export const STAGES = ["new", "contacted", "demo", "trial", "won", "lost"] as const
export type Stage = (typeof STAGES)[number]
export const STAGE_LABEL: Record<Stage, string> = { new: "New", contacted: "Contacted", demo: "Demo done", trial: "Trial", won: "Won", lost: "Lost" }

export interface Prospect {
  id: string
  name: string
  businessName: string
  industryKey: string | null
  city: string | null
  mobile: string | null
  email: string | null
  source: string | null
  stage: Stage
  lostReason: string | null
  ownerUserId: string
  owner: string | null
  tenantId: string | null
  tenant: { id: string; status: TenantStatus; subscription: { trialEndsAt: string | null } | null } | null
  next: { id: string; title: string; dueAt: string } | null
  updatedAt: string
}

export interface Followup {
  id: string
  title: string
  dueAt: string
  overdue: boolean
  auto: boolean
  owner: string | null
  about: { kind: "prospect" | "client"; id: string; name: string } | null
}

// ── Home (one shape for the AHEAD team, vendors and partners) ──

export type Audience = "team" | "vendor" | "partner"

export interface HomeStat { key: string; label: string; value: number; money?: boolean; hint?: string; href?: string }
export interface HomeTodo { kind: "discount" | "unpaid" | "trial" | "followup" | "setup" | "signin"; title: string; detail: string; href: string; action: string }

export interface ConsoleHome {
  audience: Audience
  stats: HomeStat[]
  todo: HomeTodo[]
  income: { month: string; label: string; paise: number }[] | null
  recent: { id: string; name: string; status: TenantStatus; industryKey: string; createdAt: string }[]
  referral: Referral | null
}

export interface Referral { code: string; link: string }

// ── Partners ──

export interface PartnerRow {
  id: string
  name: string
  contactName: string
  email: string
  mobile: string
  discountPercent: number
  status: "active" | "paused"
  clients: number
  liveClients: number
  people: number
  createdAt: string
}

export interface PartnerBill {
  discountPercent: number
  lines: { tenantId: string; name: string; plan: string; listPaise: number; chargePaise: number }[]
  subtotalPaise: number
  gstPaise: number
  totalPaise: number
  gstRatePercent: number
}

export interface PartnerDetail extends Omit<PartnerRow, "clients" | "liveClients" | "people"> {
  gstin: string | null
  stateCode: string | null
  people: { id: string; status: string; user: { name: string; email: string; lastLoginAt: string | null }; role: { name: string } }[]
  bill: PartnerBill
}
