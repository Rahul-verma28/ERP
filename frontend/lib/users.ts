// Users: the rows of the Users list and one person's page.

export interface UserRow {
  kind: "member" | "invite"
  id: string
  userId: string | null
  status: "active" | "deactivated" | "invited"
  name: string
  email: string | null
  mobile: string | null
  role: { id: string; key: string; name: string; custom: boolean }
  /** Self-service employee login: takes no paid seat */
  seatFree?: boolean
  branches: { id: string; name: string }[]
  joinedAt: string
  // Members
  lastLoginAt?: string | null
  mfaEnabled?: boolean
  version?: number
  you?: boolean
  owner?: boolean
  devices?: number
  work?: { tasks: number; lateTasks: number; tickets: number; appointments: number; leads: number }
  // Invitations
  expiresAt?: string
  expired?: boolean
  invitedBy?: string | null
}

export interface UserDetail {
  id: string
  userId: string
  status: "active" | "deactivated"
  version: number
  name: string
  email: string | null
  mobile: string | null
  lastLoginAt: string | null
  mfaEnabled: boolean
  joinedAt: string
  deactivatedAt: string | null
  createdAt: string
  you: boolean
  owner: boolean
  role: { id: string; key: string; name: string; description: string | null; custom: boolean; permissions: number }
  allBranches: boolean
  branches: { id: string; name: string }[]
  branchOptions: { id: string; name: string; isDefault: boolean }[]
  employee: { id: string; code: string; name: string; designation: string | null } | null
  access: {
    modules: { key: string; name: string; status: string; resources: { label: string; actions: { action: string; scope: string }[] }[] }[]
    tenant: { label: string; actions: { action: string; scope: string }[] }[]
    scopes: string[]
  }
  work: {
    tasks: { id: string; title: string; dueAt: string | null; priority: string }[]
    tickets: { id: string; number: string; subject: string; priority: string; status: string }[]
    appointments: { id: string; title: string; startAt: string }[]
    counts: { tasks: number; tasksDone30: number; tickets: number; appointments: number; leads: number; invoices30: number; invoiced30Paise: number }
  }
  signIns: { id: string; outcome: string; method: string | null; ip: string | null; userAgent: string | null; createdAt: string }[]
  devices: { id: string; userAgent: string | null; ip: string | null; createdAt: string; expiresAt: string }[]
  did: { id: string; at: string; action: string; entity: string | null; entityId: string | null; after: Record<string, unknown> | null }[]
}

export const SCOPE: Record<string, string> = { all: "Everything", branch: "Their branches", team: "Their team", own: "Only their own" }
export const ACTION: Record<string, string> = { view: "See", create: "Add", edit: "Change", delete: "Delete", export: "Export", approve: "Approve" }

/** "Chrome on Windows" from a user agent */
export function deviceName(ua: string | null | undefined) {
  if (!ua) return "Unknown device"
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser"
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : ""
  return os ? `${browser} on ${os}` : browser
}
