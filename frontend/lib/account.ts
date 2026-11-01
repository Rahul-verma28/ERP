import type { PersonalPreferences, SecurityPolicy } from "@contracts/account"

// Shapes returned by /api/v1/account (My account).

export interface AccountOverview {
  profile: { id: string; name: string; email: string; mobile: string; emailVerified: boolean; mobileVerified: boolean }
  preferences: PersonalPreferences
  security: {
    mfaEnabled: boolean
    mfaEnabledAt: string | null
    backupCodesLeft: number
    requiredBy: { tenantId: string | null; name: string; deadline: string | null }[]
    deadline: string | null
    mustSetUp: boolean
    passwordChangedAt: string | null
    passwordPolicy: SecurityPolicy["password"]
    passwordPolicyText: string
    passwordPolicySetBy: string | null
    passwordPolicyWhere: string | null
  }
  businesses: { tenantId: string; name: string; status: string; logoUrl: string | null; roleKey: string; roleName: string; isOwner: boolean; joinedAt: string | null }[]
  currentFamilyId: string | null
  lastTenantId: string | null
  trustedDevices: number
}

export interface SessionRow {
  familyId: string
  userId: string
  userName: string
  device: string
  ip: string | null
  workspace: string
  tenantId: string | null
  lastActiveAt: string
  signedInAt: string
  current: boolean
  trusted?: boolean
}

/** "+91 98765 43210" */
export const formatMobile = (m: string) => m.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2")

/** "12 min ago", "2 h ago", "3 days ago" */
export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return "Now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86_400)
  return `${d} day${d === 1 ? "" : "s"} ago`
}
