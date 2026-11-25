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

/** Why the plan holds back a permission */
export type LockReason = "not_in_plan" | "paid_feature" | "view_only"

export interface Me {
  user: { id: string; name: string; email: string; mobile: string; emailVerified: boolean; mobileVerified: boolean; preferences: PersonalPreferences; /** Signed link to the profile photo */ avatarUrl?: string | null }
  /** Two-step verification required by a business and its grace period */
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
    configApplied: boolean
    isOwner: boolean
    onboarding: { dashboard?: string[]; recommendedModules?: ModuleKey[]; setup?: SetupState }
    createdAt: string
    branding: WorkspacePreferences["branding"]
    purchaseOrders: boolean
    /** Set while the business is closed */
    closedAt?: string | null
    /** What new records start with (Settings › Module settings); older servers may not send it */
    defaults?: {
      sales: WorkspacePreferences["sales"]
      purchase: WorkspacePreferences["purchase"]
      items: WorkspacePreferences["items"]
      tasks: WorkspacePreferences["tasks"]
      gstRateBp: number
      pricesIncludeTax: boolean
      roundOff: boolean
      composition: boolean
    }
    /** Modules the owner chose at signup, in order */
    preferredModules: ModuleKey[]
  }
  role?: { id: string; key: string; name: string; roleType: string }
  subscription?: { status: TenantStatus; planKey: string; trialEndsAt: string | null; daysLeft: number | null; currentPeriodEnd: string | null }
  limits?: PlanLimits
  modules?: Record<ModuleKey, ModuleEntitlement>
  permissions?: Record<string, Scope>
  /** What the role may do but the plan holds back, and why */
  locked?: Record<string, LockReason>
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
  permissionCount: number
}

export interface Branch {
  id: string
  name: string
  code: string
  stateCode: string | null
  gstin: string | null
  isDefault: boolean
  isActive?: boolean
  address: Record<string, string> | null
}
