"use client"

import { Building2, ClipboardCheck, CreditCard, Handshake, KeyRound, LayoutDashboard, Link2, ReceiptText, Settings2, ShieldCheck, Tags, Users, type LucideIcon } from "lucide-react"
import { useAuth } from "@/lib/auth"

// The Console menu per role (blueprint Phase A). Groups and items appear only when the role
// allows them and the page exists; the server checks the same permissions on every request.

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  show: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export function useNav(): { groups: NavGroup[]; settings: NavItem | null } {
  const { me, canConsole } = useAuth()
  const audience = me?.console?.audience ?? "team"
  const clean = (groups: NavGroup[]) => groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show) })).filter((g) => g.items.length)

  if (audience === "partner") {
    return {
      groups: clean([
        {
          label: "Workspace",
          items: [
            { href: "/partner", label: "Overview", icon: LayoutDashboard, show: true },
            { href: "/partner/clients", label: "Businesses", icon: Building2, show: canConsole("platform.tenant.view") },
            { href: "/partner/onboarding", label: "Onboarding", icon: ClipboardCheck, show: canConsole("platform.tenant.create") },
            { href: "/partner/billing", label: "Monthly bill", icon: ReceiptText, show: canConsole("platform.partner.view") },
          ],
        },
        { label: "People", items: [{ href: "/partner/team", label: "Team", icon: Users, show: canConsole("platform.member.view") }] },
      ]),
      settings: null,
    }
  }
  // Vendors and salespeople get the same small menu
  if (audience === "vendor" || me?.console?.role.key === "console_sales") {
    return {
      groups: clean([
        {
          label: "Workspace",
          items: [
            { href: "/console", label: "Overview", icon: LayoutDashboard, show: true },
            { href: "/console/clients", label: "My businesses", icon: Building2, show: canConsole("platform.tenant.view") },
            { href: "/console/onboarding", label: "Onboarding", icon: ClipboardCheck, show: canConsole("platform.tenant.create") },
            { href: "/console/referral", label: "My link & code", icon: Link2, show: true },
          ],
        },
      ]),
      settings: null,
    }
  }
  return {
    groups: clean([
      {
        label: "Workspace",
        items: [
          { href: "/console", label: "Overview", icon: LayoutDashboard, show: true },
          { href: "/console/clients", label: "Businesses", icon: Building2, show: canConsole("platform.tenant.view") },
          { href: "/console/onboarding", label: "Onboarding", icon: ClipboardCheck, show: canConsole("platform.tenant.create") },
          { href: "/console/payments", label: "Billing", icon: CreditCard, show: canConsole("platform.payment.view") },
          { href: "/console/partners", label: "Partners", icon: Handshake, show: canConsole("platform.partner.view") },
        ],
      },
      { label: "Product", items: [{ href: "/console/settings/plans", label: "Plans & pricing", icon: Tags, show: canConsole("platform.plan.edit") }] },
      {
        label: "People & access",
        items: [
          { href: "/console/team", label: "Team", icon: Users, show: canConsole("platform.member.view") },
          { href: "/console/roles", label: "Roles & permissions", icon: KeyRound, show: canConsole("platform.member.view") },
          { href: "/console/security", label: "Security & audit", icon: ShieldCheck, show: canConsole("platform.audit.view") },
        ],
      },
    ]),
    settings: canConsole("platform.setting.edit") ? { href: "/console/settings/rules", label: "Console settings", icon: Settings2, show: true } : null,
  }
}
