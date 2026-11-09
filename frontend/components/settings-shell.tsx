"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"

// Settings home (wireframe X1): grouped side menu, search across every setting, deep links
// (/app/settings/payments#upi-id) that scroll to and highlight the setting, and a dot on
// pages that need attention. On a phone the menu is its own list page.

export interface SettingsItem {
  key: string
  label: string
  href: string
  permission: string
  later?: boolean
}

export const SETTINGS_GROUPS: { label: string; items: SettingsItem[] }[] = [
  {
    label: "Business",
    items: [
      { key: "organization", label: "Organization", href: "/app/settings", permission: "tenant.settings.view" },
      { key: "branding", label: "Branding", href: "/app/settings/branding", permission: "tenant.settings.view" },
      { key: "documents", label: "Documents", href: "/app/settings/documents", permission: "tenant.settings.view" },
      { key: "taxes", label: "Taxes", href: "/app/settings/taxes", permission: "tenant.settings.view" },
      { key: "payments", label: "Payments", href: "/app/settings/payments", permission: "tenant.settings.view" },
      { key: "branches", label: "Branches", href: "/app/settings/branches", permission: "tenant.branch.view" },
    ],
  },
  {
    label: "People",
    items: [
      { key: "team", label: "Users", href: "/app/settings/team", permission: "tenant.member.view" },
      { key: "roles", label: "Roles", href: "/app/settings/roles", permission: "tenant.role.view" },
      { key: "security", label: "Security", href: "/app/settings/security", permission: "tenant.settings.view" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { key: "notifications", label: "Notifications", href: "/app/settings/notifications", permission: "tenant.settings.view" },
      { key: "inventory", label: "Inventory", href: "/app/settings/inventory", permission: "tenant.settings.view" },
      { key: "customization", label: "Customization", href: "/app/settings/customization", permission: "tenant.config.view" },
      { key: "data", label: "Data", href: "/app/settings/data", permission: "tenant.settings.view" },
      { key: "audit", label: "Audit log", href: "/app/settings/audit", permission: "tenant.audit.view" },
      { key: "subscription", label: "Subscription", href: "/app/billing", permission: "tenant.billing.view" },
      { key: "integrations", label: "Integrations", href: "#", permission: "tenant.settings.view", later: true },
    ],
  },
]

const PAGES = new Map(SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i])))

/** Every setting a person might search for, with the page and the anchor that holds it. */
const SEARCH_INDEX: { label: string; page: string; anchor?: string; section?: string; keywords?: string }[] = [
  { label: "Business name", page: "organization", anchor: "business-profile", keywords: "company" },
  { label: "Legal name", page: "organization", anchor: "business-profile" },
  { label: "Business type", page: "organization", anchor: "business-profile", keywords: "proprietor partnership llp company" },
  { label: "GSTIN", page: "organization", anchor: "business-profile", keywords: "gst number" },
  { label: "PAN", page: "organization", anchor: "business-profile" },
  { label: "Address", page: "organization", anchor: "business-profile", keywords: "pin city state" },
  { label: "Financial year", page: "organization", anchor: "formats", keywords: "fy april" },
  { label: "Time zone", page: "organization", anchor: "formats" },
  { label: "Date format", page: "organization", anchor: "formats" },
  { label: "Number format", page: "organization", anchor: "formats", keywords: "lakh crore" },
  { label: "Week starts on", page: "organization", anchor: "formats", keywords: "monday sunday" },
  { label: "Logo", page: "branding", anchor: "logo" },
  { label: "Brand colour", page: "branding", anchor: "colour", keywords: "color theme" },
  { label: "Theme, font and density", page: "branding", anchor: "look", keywords: "dark light compact" },
  { label: "Invoice number series", page: "documents", anchor: "series", keywords: "prefix next number" },
  { label: "Quotation numbers", page: "documents", anchor: "series" },
  { label: "Receipt numbers", page: "documents", anchor: "series" },
  { label: "Invoice template", page: "documents", anchor: "template", keywords: "classic modern compact" },
  { label: "Paper size", page: "documents", anchor: "print", section: "Documents › Print", keywords: "a4 80mm 58mm thermal" },
  { label: "Print UPI QR on invoices", page: "documents", anchor: "print", section: "Documents › Print", keywords: "upi qr" },
  { label: "HSN summary on invoices", page: "documents", anchor: "print", section: "Documents › Print" },
  { label: "Terms on invoices and quotations", page: "documents", anchor: "terms", keywords: "conditions" },
  { label: "Composition scheme", page: "taxes", anchor: "gst" },
  { label: "Prices include tax", page: "taxes", anchor: "gst", keywords: "inclusive exclusive" },
  { label: "Default GST rate", page: "taxes", anchor: "gst" },
  { label: "HSN digits", page: "taxes", anchor: "gst", keywords: "4 6" },
  { label: "Reverse charge", page: "taxes", anchor: "gst", keywords: "rcm" },
  { label: "Bank account", page: "payments", anchor: "bank", keywords: "ifsc account number" },
  { label: "UPI ID", page: "payments", anchor: "upi-id", keywords: "upi vpa" },
  { label: "Invite people", page: "team", keywords: "users staff members" },
  { label: "Custom roles", page: "roles", keywords: "permissions clone" },
  { label: "Two-step verification policy", page: "security", anchor: "two-step", keywords: "mfa 2fa otp authenticator" },
  { label: "Password rules", page: "security", anchor: "passwords", keywords: "length expiry" },
  { label: "Sign out after inactivity", page: "security", anchor: "sessions", keywords: "idle timeout session" },
  { label: "Allowed networks (IP)", page: "security", anchor: "networks", keywords: "ip allowlist office" },
  { label: "Active sessions", page: "security", anchor: "active-sessions", keywords: "devices sign out" },
  { label: "Sign-in history", page: "security", anchor: "sign-ins", keywords: "login history failed" },
  { label: "Messages to customers", page: "notifications", keywords: "email sms whatsapp template" },
  { label: "Alerts to your team", page: "notifications", keywords: "in-app" },
  { label: "Quiet hours", page: "notifications", keywords: "night daily limit" },
  { label: "Custom fields", page: "customization" },
  { label: "Terminology", page: "customization", keywords: "rename labels" },
  { label: "Import data", page: "data", anchor: "import", keywords: "csv upload customers products" },
  { label: "Export data", page: "data", anchor: "export", keywords: "download backup excel csv" },
  { label: "Sample data", page: "data", anchor: "sample" },
  { label: "Close business", page: "data", anchor: "close", keywords: "delete account" },
  { label: "Plan and billing", page: "subscription", keywords: "upgrade invoice" },
]

function useSettingsSearch(query: string, allowed: (key: string) => boolean) {
  return React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return SEARCH_INDEX.filter((s) => allowed(s.page) && `${s.label} ${s.keywords ?? ""} ${PAGES.get(s.page)?.label}`.toLowerCase().includes(q))
      .slice(0, 8)
      .map((s) => {
        const page = PAGES.get(s.page)!
        return { ...s, href: `${page.href}${s.anchor ? `#${s.anchor}` : ""}`, where: s.section ?? page.label }
      })
  }, [query, allowed])
}

/** Pages with something to fix carry a dot (Taxes without a state, admins without two-step). */
function useAttention() {
  const { me, can } = useAuth()
  const { data } = useApi<{ adminsWithoutMfa: number }>(can("tenant.settings.view") ? "/tenant/security" : null)
  return {
    taxes: !me?.tenant?.billingStateCode,
    security: (data?.adminsWithoutMfa ?? 0) > 0,
  } as Record<string, boolean>
}

function isActive(pathname: string, item: SettingsItem) {
  return item.href === "/app/settings" ? pathname === "/app/settings" : pathname.startsWith(item.href)
}

export function SettingsMenu({ variant = "side" }: { variant?: "side" | "list" }) {
  const pathname = usePathname()
  const router = useRouter()
  const { can } = useAuth()
  const [query, setQuery] = React.useState("")
  const attention = useAttention()
  const allowed = React.useCallback((key: string) => {
    const p = PAGES.get(key)
    return !!p && !p.later && can(p.permission)
  }, [can])
  const results = useSettingsSearch(query, allowed)
  const q = query.trim().toLowerCase()
  const pageMatches = new Set(results.map((r) => r.page))

  const open = (href: string) => {
    setQuery("")
    router.push(href)
  }

  return (
    <nav aria-label="Settings" className={cn("flex flex-col gap-0.5", variant === "side" && "w-[260px] shrink-0 border-r bg-card px-3 py-3.5")}>
      {variant === "list" && <h1 className="mb-3 text-[22px] font-bold">Settings</h1>}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search settings"
          placeholder="Search settings"
          className="h-9 pl-8 text-[13px]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) open(results[0].href)
            if (e.key === "Escape") setQuery("")
          }}
        />
      </div>
      {q && (
        <div className="my-2 rounded-[10px] border bg-muted/40 p-1.5 text-xs" role="listbox" aria-label="Matching settings">
          {results.length ? (
            results.map((r, i) => (
              <button
                key={r.label}
                type="button"
                role="option"
                aria-selected={i === 0}
                onClick={() => open(r.href)}
                className={cn("block w-full rounded-md p-1.5 text-left hover:bg-accent", i === 0 && "bg-accent")}
              >
                <strong className="block text-foreground">{r.label}</strong>
                <span className="text-muted-foreground">{r.where}</span>
              </button>
            ))
          ) : (
            <p className="p-1.5 text-muted-foreground">No setting matches “{query.trim()}”.</p>
          )}
        </div>
      )}
      {SETTINGS_GROUPS.map((g) => {
        const items = g.items.filter((i) => (i.later || can(i.permission)) && (!q || pageMatches.has(i.key) || i.label.toLowerCase().includes(q)))
        if (!items.length) return null
        return (
          <React.Fragment key={g.label}>
            <p className="px-2.5 pt-3 pb-1 text-[11px] font-bold tracking-[.06em] text-muted-foreground uppercase">{g.label}</p>
            {items.map((i) =>
              i.later ? (
                <span key={i.key} className="flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] text-muted-foreground/70" aria-disabled>
                  {i.label} · Later
                </span>
              ) : (
                <Link
                  key={i.key}
                  href={i.href}
                  aria-current={isActive(pathname, i) ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] text-foreground/80 hover:bg-muted",
                    variant === "list" && "border-b py-3 text-sm",
                    variant === "side" && isActive(pathname, i) && "bg-accent font-bold text-accent-foreground"
                  )}
                >
                  {i.label}
                  {attention[i.key] && <span className="ml-auto size-[7px] rounded-full bg-orange-700" title="Needs attention" aria-label="Needs attention" />}
                  {variant === "list" && <ChevronRight className={cn("size-4 text-muted-foreground", !attention[i.key] && "ml-auto")} />}
                </Link>
              )
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}

/** Scroll to and briefly highlight the setting named in the URL hash. */
function useHashHighlight() {
  const pathname = usePathname()
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      const id = decodeURIComponent(window.location.hash.slice(1))
      if (!id) return
      // The page's data may still be loading: try for a few seconds
      let tries = 0
      const find = () => {
        const el = document.getElementById(id)
        if (!el) {
          if (tries++ < 20) timer = setTimeout(find, 200)
          return
        }
        el.scrollIntoView({ behavior: "smooth", block: "center" })
        el.classList.add("setting-highlight")
        timer = setTimeout(() => el.classList.remove("setting-highlight"), 2400)
      }
      find()
    }
    run()
    window.addEventListener("hashchange", run)
    return () => {
      window.removeEventListener("hashchange", run)
      if (timer) clearTimeout(timer)
    }
  }, [pathname])
}

/** Pages from before Phase 2 that don't draw their own title */
const TITLED: Record<string, [string, string]> = {
  "/app/settings/inventory": ["Inventory", "How stock behaves in this business, and whether you use purchase orders."],
  "/app/settings/customization": ["Customization", "Your industry's words and extra fields on records."],
}

/** Wide pages (X4–X6) use the full width with a "Settings ›" breadcrumb instead of the side menu */
const WIDE = ["/app/settings/roles", "/app/settings/notifications", "/app/settings/data"]

export function SettingsFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  useHashHighlight()
  const home = pathname === "/app/settings"
  const wide = WIDE.some((w) => pathname.startsWith(w))
  const titled = TITLED[pathname]
  if (titled) {
    children = (
      <SettingsPage title={titled[0]} description={titled[1]}>
        {children}
      </SettingsPage>
    )
  }
  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] flex-1">
      {!wide && (
        <div className="hidden lg:flex">
          <SettingsMenu />
        </div>
      )}
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-8">
        {!home && !wide && (
          <Link href="/app/settings" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden">
            <ChevronLeft className="size-4" /> All settings
          </Link>
        )}
        {children}
      </div>
    </div>
  )
}

/** Page title block used by every settings page. */
export function SettingsPage({ title, description, crumb, actions, children, className }: { title: string; description?: React.ReactNode; crumb?: boolean; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex w-full flex-col gap-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {crumb && (
            <p className="text-xs text-muted-foreground">
              <Link href="/app/settings" className="hover:text-foreground hover:underline">
                Settings
              </Link>{" "}
              › {title}
            </p>
          )}
          <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
