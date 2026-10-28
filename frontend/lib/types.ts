import type { SetupState, WorkspacePreferences } from "@contracts/workspace"
import type { PersonalPreferences } from "@contracts/account"

export type ModuleKey =
  | "crm"
  | "catalog"
  | "sales"
  | "billing"
  | "inventory"
  | "hr"
  | "tasks"
  | "finance"
  | "bookings"
  | "support"
  | "reports"
  | "ai"
  | "automation"

export type TenantStatus = "incomplete" | "trialing" | "active" | "past_due" | "free" | "closed" | "purged"
export type Scope = "own" | "team" | "branch" | "all"

export interface ModuleEntitlement {
  status: "active" | "read_only" | "inactive"
  tier: "basic" | "full"
}

export interface PlanLimits {
  users: number
  branches: number
  contacts: number | null
  items: number | null
  invoicesPerMonth: number | null
  storageMb: number
  aiCredits: number
}

/** design v2: AHEAD team members work in the Console, clients in the ERP */
export type Workspace = "tenant" | "console"

export interface ConsoleAccess {
  memberId: string
  role: { key: string; name: string }
  /** platform.* permission keys with their scope (all / team / own) */
  permissions: Record<string, Scope>
  /** Which Console panel this person sees */
  audience: "team" | "vendor" | "partner"
  partner: { id: string; name: string; status: "active" | "paused"; discountPercent: number } | null
}

export interface Me {
  workspace: Workspace
  /** null unless the user is on the AHEAD team */
  console: ConsoleAccess | null
  /** Platform-wide banner set from the Console */
  announcement: { text: string; tone: "info" | "warning" } | null
  user: { id: string; name: string; email: string; mobile: string; emailVerified: boolean; mobileVerified: boolean; preferences: PersonalPreferences }
  /** Two-step verification required by a business (or the Console) and its grace period */
  security: { mfaEnabled: boolean; mfaRequired: boolean; requiredBy: string[]; deadline: string | null; mustSetUpMfa: boolean }
  memberships: { tenantId: string; name: string; status: TenantStatus; logoUrl: string | null; roleName: string }[]
  tenant: null | {
    id: string
    name: string
    legalName: string | null
    industryKey: string
    status: TenantStatus
    logoUrl: string | null
    gstin: string | null
    billingStateCode: string | null
    timezone: string
    fyStartMonth: number
    billingOwner: "self" | "partner"
    configApplied: boolean
    needsSeatChoice: boolean
    isOwner: boolean
    onboarding: { dashboard?: string[]; recommendedModules?: ModuleKey[]; setup?: SetupState }
    createdAt: string
    branding: WorkspacePreferences["branding"]
    /** Modules the owner chose at signup, in order */
    preferredModules: ModuleKey[]
  }
  role?: { id: string; key: string; name: string; roleType: string }
  subscription?: { status: TenantStatus; planKey: string; trialEndsAt: string | null; daysLeft: number | null; currentPeriodEnd: string | null }
  limits?: PlanLimits
  modules?: Record<ModuleKey, ModuleEntitlement>
  permissions?: Record<string, Scope>
  fieldAccess?: Record<string, "hidden" | "read" | "write">
  terms?: Record<string, string>
}

export interface Role {
  id: string
  key: string
  name: string
  description: string | null
  roleType: string
  requiredModules: string[]
  isSystem: boolean
  isPredefined: boolean
  memberCount: number
}

export interface Branch {
  id: string
  name: string
  code: string
  stateCode: string | null
  gstin: string | null
  isDefault: boolean
  address: Record<string, string> | null
}
