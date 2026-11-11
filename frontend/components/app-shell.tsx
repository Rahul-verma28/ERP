"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"
import { Bell, Check, ChevronDown, ChevronsUpDown, CreditCard, Lock, LogOut, Menu, Search, Settings, ShieldCheck, UserRound, X, type LucideIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { DASHBOARD_NAV, MODULE_NAV, MODULE_SUBS, NAV_SECTIONS, PURCHASE_NAV, SALES_NAV, USER_NAV, type NavEntry, type SubNav } from "@/lib/nav"
import { ReadOnlyBanner } from "@/components/page-states"
import { CommandPalette } from "@/components/command-palette"
import { SidePanel } from "@/components/side-panel"
import { ThemeSwitch } from "@/components/workspace-branding"
import type { ModuleKey } from "@/lib/types"
import { formatDateTime, initials } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useApi } from "@/lib/use-api"

export function NavLink({ href, active, children, onClick }: { href: string; active: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
      )}
    >
      {children}
    </Link>
  )
}

/** A module with sub-modules: opens in place, and shows where you are */
function NavGroup({ id, label, icon: Icon, subs, open, onToggle, activeHref, onNavigate }: { id: string; label: string; icon: LucideIcon; subs: SubNav[]; open: boolean; onToggle: (id: string) => void; activeHref: string | null; onNavigate?: () => void }) {
  const inside = subs.some((s) => s.href === activeHref)
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className={cn("flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground", inside && "bg-sidebar-accent font-medium text-sidebar-accent-foreground")}
      >
        <Icon className="size-4" />
        <span className="flex-1 truncate">{label}</span>
        <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="ui-rise grid gap-px py-1 pl-8">
          {subs.map((s) => (
            <Link key={s.href} href={s.href} onClick={onNavigate} aria-current={s.href === activeHref ? "page" : undefined} className={cn("rounded-lg px-2.5 py-1.5 text-[13.5px] text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground", s.href === activeHref && "bg-sidebar-accent font-semibold text-sidebar-accent-foreground")}>
              {s.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { me, canView, can, term } = useAuth()
  const [query, setQuery] = React.useState("")
  const q = query.trim().toLowerCase()
  const isAdmin = can("tenant.billing.view") || can("tenant.member.view")
  const allowed = (subs: SubNav[]) => subs.filter((s) => !s.permission || can(s.permission))
  const purchase = me?.modules?.inventory?.status === "inactive" ? [] : allowed(PURCHASE_NAV.subs)
  const users = allowed(USER_NAV.subs)
  // Each Sales page belongs to the module its permission names (crm, sales or billing)
  const sales = allowed(SALES_NAV.subs).filter((s) => me?.modules?.[s.permission!.split(".")[0] as ModuleKey]?.status !== "inactive")
  const moduleSubs = (key: ModuleKey) => (me?.modules?.[key]?.status === "inactive" ? [] : allowed(MODULE_SUBS[key] ?? []))

  // The group holding this page is open until someone toggles another one
  const groups: [string, SubNav[]][] = [["users", users], ["salesgroup", sales], ["purchase", purchase], ...MODULE_NAV.map((m) => [m.key, moduleSubs(m.key)] as [string, SubNav[]])]
  const matches = groups.flatMap(([id, subs]) => subs.filter((s) => pathname === s.href || pathname.startsWith(`${s.href}/`)).map((s) => ({ id, href: s.href })))
  const current = matches.sort((a, b) => b.href.length - a.href.length)[0] ?? null
  const [toggled, setToggled] = React.useState<{ page: string | null; id: string | null } | null>(null)
  const page = current?.id ?? null
  const openId = toggled && toggled.page === page ? toggled.id : page
  const toggle = (id: string) => setToggled({ page, id: openId === id ? null : id })
  /** Searching opens every matching module and keeps only the pages that match */
  const matchGroup = (label: string, subs: SubNav[]) => (!q || label.toLowerCase().includes(q) ? subs : subs.filter((s) => s.label.toLowerCase().includes(q)))
  const hit = (label: string) => !q || label.toLowerCase().includes(q)
  const group = (id: string, label: string, icon: LucideIcon, subs: SubNav[]) => {
    const shown = matchGroup(label, subs)
    if (!shown.length) return null
    return <NavGroup key={id} id={id} label={label} icon={icon} subs={shown} open={!!q || openId === id} onToggle={toggle} activeHref={current?.href ?? null} onNavigate={onNavigate} />
  }

  const entry = (e: NavEntry): React.ReactNode => {
    if (e === "dashboard")
      return hit(DASHBOARD_NAV.label) ? (
        <NavLink key={e} href="/app" active={pathname === "/app"} onClick={onNavigate}>
          <DASHBOARD_NAV.icon className="size-4" /> {DASHBOARD_NAV.label}
        </NavLink>
      ) : null
    if (e === "salesgroup") return group("salesgroup", SALES_NAV.label, SALES_NAV.icon, sales)
    if (e === "purchase") return group("purchase", PURCHASE_NAV.label, PURCHASE_NAV.icon, purchase)
    if (e === "users") return group("users", USER_NAV.label, USER_NAV.icon, users)
    if (e === "plan")
      return can("tenant.billing.view") && hit("Plan & billing") ? (
        <NavLink key={e} href="/app/billing" active={pathname.startsWith("/app/billing")} onClick={onNavigate}>
          <CreditCard className="size-4" /> Plan & billing
        </NavLink>
      ) : null
    if (e === "settings")
      return can("tenant.settings.view") && hit("Settings") ? (
        <NavLink key={e} href="/app/settings" active={pathname === "/app/settings" || (pathname.startsWith("/app/settings") && !users.some((u) => pathname.startsWith(u.href)))} onClick={onNavigate}>
          <Settings className="size-4" /> Settings
        </NavLink>
      ) : null
    const m = MODULE_NAV.find((x) => x.key === e)
    if (!m) return null
    const ent = me?.modules?.[m.key]
    // Locked modules are shown to admins as an upgrade prompt; hidden for everyone else
    if (!canView(m.key) && !(isAdmin && ent?.status === "inactive")) return null
    const label = m.termKey ? term(m.termKey, m.label) : m.label
    const subs = moduleSubs(m.key)
    if (subs.length > 0) return group(m.key, label, m.icon, subs)
    if (!hit(label)) return null
    return (
      <NavLink key={m.key} href={`/app/m/${m.key}`} active={pathname.startsWith(`/app/m/${m.key}`)} onClick={onNavigate}>
        <m.icon className="size-4" />
        <span className="flex-1 truncate">{label}</span>
        {ent?.status === "inactive" && <Lock className="size-3.5 text-muted-foreground" aria-label="Not in your plan" />}
        {ent?.status === "read_only" && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Read-only</Badge>}
      </NavLink>
    )
  }

  const sections = NAV_SECTIONS.map((s) => ({ label: s.label, items: s.entries.map(entry).filter(Boolean) })).filter((s) => s.items.length > 0)

  return (
    <>
      <div className="relative px-3 pt-2">
        <Search className="pointer-events-none absolute top-1/2 left-6 mt-1 size-4 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search menu…" aria-label="Search menu" className="h-9 w-full rounded-xl border border-sidebar-border bg-transparent pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
      </div>
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pt-1" aria-label="Main">
        {sections.map((s) => (
          <div key={s.label} className="grid gap-0.5 pt-3">
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-[.06em] text-sidebar-foreground/55 uppercase">{s.label}</p>
            {s.items}
          </div>
        ))}
        {!sections.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches.</p>}
      </nav>
    </>
  )
}

/** design v2: one menu to move between the AHEAD Console and the user's businesses */
export function WorkspaceSwitcher() {
  const { me, switchTenant, switchToConsole } = useAuth()
  const router = useRouter()
  if (!me) return null
  const inConsole = me.workspace === "console"
  if (!inConsole && !me.tenant) return null
  const title = inConsole ? "AHEAD Console" : me.tenant!.name
  const subtitle = inConsole ? me.console?.role.name : me.role?.name
  const go = async (fn: () => Promise<void>, href: string) => {
    try {
      await fn()
      router.push(href)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-w-0 items-center gap-2 rounded-2xl px-2 py-1.5 text-left hover:bg-muted">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-xs font-bold text-primary-foreground">
          {inConsole ? <ShieldCheck className="size-4" /> : initials(title)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {me.console && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>AHEAD team</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => !inConsole && go(switchToConsole, "/console")}>
                <ShieldCheck className="size-4" />
                <span className="flex-1 truncate">AHEAD Console</span>
                {inConsole && <Check className="size-4" />}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {me.memberships.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {me.memberships.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Your businesses</DropdownMenuLabel>
            {me.memberships.map((m) => {
              const current = !inConsole && m.tenantId === me.tenant?.id
              return (
                <DropdownMenuItem key={m.tenantId} onClick={() => !current && go(() => switchTenant(m.tenantId), "/app")}>
                  <span className="flex-1 truncate">{m.name}</span>
                  {current && <Check className="size-4" />}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface NotificationList {
  data: { id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }[]
  unread: number
}

function Notifications() {
  const router = useRouter()
  const { data, reload } = useApi<NotificationList>("/notifications")
  // Check for new ones every minute and when you come back to the tab
  React.useEffect(() => {
    const refresh = () => document.visibilityState === "visible" && void reload().catch(() => undefined)
    const t = setInterval(refresh, 60_000)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      clearInterval(t)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [reload])
  const [panel, setPanel] = React.useState(false)
  const open = async (n: NotificationList["data"][number]) => {
    setPanel(false)
    if (!n.readAt) await api.post("/notifications/read", { id: n.id }).then(reload).catch(() => undefined)
    if (n.link) router.push(n.link)
  }
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPanel(true)
          void reload()
        }}
        className={buttonVariants({ variant: "ghost", size: "icon", className: "relative" })}
        aria-label={data?.unread ? `${data.unread} unread notifications` : "Notifications"}
      >
        <Bell className="size-4" />
        {!!data?.unread && <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">{data.unread > 9 ? "9+" : data.unread}</span>}
      </button>
      <SidePanel
        open={panel}
        onOpenChange={setPanel}
        title="Notifications"
        action={!!data?.unread && <Button variant="ghost" size="sm" onClick={() => api.post("/notifications/read").then(reload)}>Mark all read</Button>}
      >
        {!data?.data.length ? (
          <p className="px-5 py-12 text-center text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          <ul className="divide-y">
            {data.data.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => void open(n)} className="grid w-full gap-0.5 px-5 py-3.5 text-left transition-colors hover:bg-muted/60">
                  <span className={cn("flex items-center gap-2 text-[13.5px]", !n.readAt && "font-semibold")}>
                    {!n.readAt && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                    {n.title}
                  </span>
                  {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
                  <span className="text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SidePanel>
    </>
  )
}

export function UserMenu() {
  const { me, signOut } = useAuth()
  const router = useRouter()
  if (!me) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full" aria-label="Account menu">
        <Avatar>
          <AvatarFallback>{initials(me.user.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate text-sm font-medium text-foreground">{me.user.name}</span>
            <span className="block truncate text-xs font-normal">{me.user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/app/account")}>
          <UserRound className="size-4" /> My account
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await signOut()
            router.replace("/login")
          }}
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Banners() {
  const { me, can } = useAuth()
  const [sent, setSent] = React.useState(false)
  if (!me?.tenant) return null
  const sub = me.subscription
  return (
    <div className="grid gap-px">
      {me.announcement && (
        <div className={cn("px-4 py-2 text-center text-sm", me.announcement.tone === "warning" ? "bg-amber-500 text-amber-950" : "bg-foreground text-background")} role="status">
          {me.announcement.text}
        </div>
      )}
      {sub?.status === "trialing" && sub.daysLeft !== null && sub.daysLeft <= 7 && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-2 text-center text-sm text-primary-foreground">
          <span>
            {sub.daysLeft === 0 ? "Your trial ends today." : `${sub.daysLeft} day${sub.daysLeft === 1 ? "" : "s"} left in your free trial.`} Your data stays safe either way.
          </span>
          {can("tenant.billing.view") && (
            <Link href="/app/billing" className="font-semibold underline underline-offset-4">
              See plans
            </Link>
          )}
        </div>
      )}
      {sub?.status === "incomplete" && (
        <div className="bg-primary px-4 py-2 text-center text-sm text-primary-foreground">
          Your workspace is ready. Modules open as soon as your payment to AHEAD is received — set up your team and settings meanwhile.
        </div>
      )}
      {sub?.status === "past_due" && (
        <div className="bg-destructive px-4 py-2 text-center text-sm text-white">
          Your last payment failed. Update your payment method to keep paid modules active.
        </div>
      )}
      {sub?.status === "free" && Object.values(me.modules ?? {}).some((m) => m.status === "read_only") && (
        <div className="bg-muted px-4 py-2 text-center text-sm">
          You&apos;re on the Free plan. Paid-module data is read-only and can be exported anytime.{" "}
          {can("tenant.billing.view") && (
            <Link href="/app/billing" className="font-medium underline underline-offset-4">
              Upgrade to restore it
            </Link>
          )}
        </div>
      )}
      {me.security.mfaRequired && !me.security.mfaEnabled && me.security.deadline && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100" role="status">
          <span>
            {me.security.requiredBy[0]} requires two-step verification. Set it up within <strong>{daysUntil(me.security.deadline)}</strong> to keep access.
          </span>
          <Link href="/app/account/two-step" className="font-semibold underline underline-offset-4">
            Set up now
          </Link>
        </div>
      )}
      {!me.user.emailVerified && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          <span>Please verify {me.user.email}. Verification is needed before your first payment.</span>
          <button
            className="font-semibold underline underline-offset-4 disabled:no-underline disabled:opacity-70"
            disabled={sent}
            onClick={() =>
              api
                .post("/auth/email/resend")
                .then(() => {
                  setSent(true)
                  toast.success("Verification email sent.")
                })
                .catch((e) => toast.error(errorMessage(e)))
            }
          >
            {sent ? "Email sent" : "Resend link"}
          </button>
        </div>
      )}
    </div>
  )
}

const daysUntil = (iso: string) => {
  const d = Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
  return d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"}`
}

/** Settings and My account draw their own side menu edge to edge (wireframes X1, A1). */
const FULL_BLEED = /^\/app\/(settings|account)(\/|$)/

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const fullBleed = FULL_BLEED.test(usePathname())
  return (
    <div className="flex min-h-svh flex-col">
      <Banners />
      <div className="flex flex-1">
        <aside className="sticky top-0 hidden h-svh w-[272px] shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
          <div className="flex h-full flex-col overflow-hidden">
            <div className="p-3 pb-1">
              <WorkspaceSwitcher />
            </div>
            <Sidebar />
          </div>
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar shadow-xl">
              <div className="flex items-center justify-between border-b p-3">
                <WorkspaceSwitcher />
                <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                  <X className="size-4" />
                </Button>
              </div>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-card px-4">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Menu className="size-4" />
            </Button>
            <CommandPalette />
            <div className="flex-1" />
            <ThemeSwitch />
            <Notifications />
            <UserMenu />
          </header>
          <main className={cn("w-full flex-1", fullBleed ? "flex min-w-0 flex-col" : "px-4 py-5 sm:px-6")}>
            <ReadOnlyNotice />
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

const MODULE_PATH = new RegExp("^/app/m/([a-z]+)")

/** Banner on a module that became read-only after the trial (wireframe 0.4). */
function ReadOnlyNotice() {
  const pathname = usePathname()
  const { me, can } = useAuth()
  const key = MODULE_PATH.exec(pathname)?.[1] as ModuleKey | undefined
  if (!key || me?.modules?.[key]?.status !== "read_only") return null
  const nav = MODULE_NAV.find((m) => m.key === key)
  return <ReadOnlyBanner name={nav?.label ?? "This module"} canUpgrade={can("tenant.billing.view")} />
}
