"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Home } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { HRM_NAV, MODULE_NAV, MODULE_SUBS, PERFORMANCE_NAV, POS_NAV, PURCHASE_NAV, RECRUITMENT_NAV, SALES_NAV, USER_NAV, type SubNav } from "@/lib/nav"
import { SETTINGS_GROUPS } from "@/components/settings-shell"
import { cn } from "@/lib/utils"

// The trail above every page: Home › Sales › Customers › Deepak Chauhan. It is made from the same
// menu the sidebar shows, so it always matches; a record's page adds its own name (DetailHeader
// does it), and anything else deeper gets a word from the address ("New", "Setup").

interface Crumb {
  label: string
  href?: string
}

const CrumbContext = React.createContext<{ set: (label: string | null) => void } | null>(null)
const LastContext = React.createContext<string | null>(null)

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [last, setLast] = React.useState<string | null>(null)
  const pathname = usePathname()
  // A new page starts without a name until it gives one
  const [seenPath, setSeenPath] = React.useState(pathname)
  if (seenPath !== pathname) {
    setSeenPath(pathname)
    setLast(null)
  }
  const api = React.useMemo(() => ({ set: setLast }), [])
  return (
    <CrumbContext.Provider value={api}>
      <LastContext.Provider value={last}>{children}</LastContext.Provider>
    </CrumbContext.Provider>
  )
}

/** A record's page names itself in the trail ("Deepak Chauhan" instead of "Details") */
export function usePageCrumb(label: string | null | undefined) {
  const ctx = React.useContext(CrumbContext)
  React.useEffect(() => {
    if (!ctx || !label) return
    ctx.set(label)
    return () => ctx.set(null)
  }, [ctx, label])
}

const flat = (subs: SubNav[]): SubNav[] => subs.flatMap((s) => (s.children ? flat(s.children) : [s]))
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WORDS: Record<string, string> = { new: "New", edit: "Edit", setup: "Setup", import: "Import", settings: "Settings", reports: "Reports", account: "My account", "two-step": "Two-step verification" }
const humanize = (seg: string) => WORDS[seg] ?? (UUID.test(seg) ? "Details" : seg.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase()))

export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname()
  const last = React.useContext(LastContext)
  const { term } = useAuth()

  const trail = React.useMemo<Crumb[]>(() => {
    if (pathname === "/app") return []
    // Every menu link with the group it sits under
    const links: { href: string; also: string[]; label: string; group: string }[] = []
    const add = (group: string, subs: SubNav[]) => {
      for (const s of flat(subs)) links.push({ href: s.href.split("?")[0], also: s.also ?? [], label: s.label, group })
    }
    add(SALES_NAV.label, SALES_NAV.subs)
    add(POS_NAV.label, POS_NAV.subs)
    add(PURCHASE_NAV.label, PURCHASE_NAV.subs)
    add(HRM_NAV.label, HRM_NAV.subs)
    add(PERFORMANCE_NAV.label, PERFORMANCE_NAV.subs)
    add(RECRUITMENT_NAV.label, RECRUITMENT_NAV.subs)
    add(USER_NAV.label, USER_NAV.subs)
    for (const m of MODULE_NAV) add(m.termKey ? term(m.termKey, m.label) : m.label, MODULE_SUBS[m.key] ?? [{ label: m.termKey ? term(m.termKey, m.label) : m.label, href: `/app/m/${m.key}` }])
    for (const g of SETTINGS_GROUPS) for (const i of g.items) if (i.href !== "#" && !links.some((l) => l.href === i.href)) links.push({ href: i.href, also: [], label: i.label, group: "Settings" })
    links.push({ href: "/app/billing", also: [], label: "Plan & billing", group: "" })
    links.push({ href: "/app/account", also: [], label: "My account", group: "" })

    const hit = links
      .flatMap((l) => [l.href, ...l.also].filter((p) => pathname === p || pathname.startsWith(`${p}/`)).map((p) => ({ l, len: p.length, path: p })))
      .sort((a, b) => b.len - a.len)[0]
    const out: Crumb[] = []
    if (!hit) {
      // Not in the menu: the address, word by word
      const segs = pathname.replace(/^\/app\/?/, "").split("/").filter(Boolean)
      segs.forEach((s, i) => out.push({ label: humanize(s), href: i < segs.length - 1 ? `/app/${segs.slice(0, i + 1).join("/")}` : undefined }))
      return out
    }
    if (hit.l.group === "Settings") out.push({ label: "Settings", href: "/app/settings" })
    else if (hit.l.group && hit.l.group !== hit.l.label) out.push({ label: hit.l.group })
    const rest = pathname.slice(hit.path.length).split("/").filter(Boolean)
    out.push({ label: hit.l.label, href: rest.length ? hit.l.href : undefined })
    rest.forEach((s, i) => out.push({ label: humanize(s), href: i < rest.length - 1 ? `${hit.path}/${rest.slice(0, i + 1).join("/")}` : undefined }))
    return out
  }, [pathname, term])

  if (!trail.length) return null
  // The record's own name replaces the last word ("Details")
  const shown = last && trail.length ? [...trail.slice(0, -1), { ...trail[trail.length - 1], label: last }] : trail
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-3 flex min-w-0 flex-wrap items-center gap-1 text-[13px] text-muted-foreground", className)}>
      <Link href="/app" className="grid size-6 place-items-center rounded-md hover:bg-muted hover:text-foreground" aria-label="Dashboard">
        <Home className="size-3.5" />
      </Link>
      {shown.map((c, i) => (
        <React.Fragment key={`${c.label}-${i}`}>
          <ChevronRight className="size-3.5 shrink-0 opacity-50" aria-hidden />
          {c.href && i < shown.length - 1 ? (
            <Link href={c.href} className="truncate rounded-md px-1 hover:bg-muted hover:text-foreground">{c.label}</Link>
          ) : (
            <span className={cn("truncate px-1", i === shown.length - 1 && "font-medium text-foreground")} aria-current={i === shown.length - 1 ? "page" : undefined}>{c.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  )
}
