"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"
import { Bell, Check, ChevronsUpDown, CreditCard, Lock, LogOut, Menu, Settings, ShieldCheck, UserRound, X } from "lucide-react"
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
import { DASHBOARD_NAV, MODULE_NAV } from "@/lib/nav"
import { ReadOnlyBanner } from "@/components/page-states"
import { CommandPalette } from "@/components/command-palette"
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
        "flex items-center gap-2.5 rounded-2xl px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
        active && "bg-sidebar-accent font-medium text-sidebar-foreground"
      )}
    >
      {children}
    </Link>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { me, canView, can, term } = useAuth()
  // Owner's picks at signup first, then the industry template's order
  const recommended = [...new Set([...(me?.tenant?.preferredModules ?? []), ...(me?.tenant?.onboarding?.recommendedModules ?? [])])]
  const ordered = [...MODULE_NAV].sort((a, b) => {
    const ia = recommended.indexOf(a.key)
    const ib = recommended.indexOf(b.key)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
  const isAdmin = can("tenant.billing.view") || can("tenant.member.view")

  return (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3" aria-label="Main">
      <NavLink href="/app" active={pathname === "/app"} onClick={onNavigate}>
        <DASHBOARD_NAV.icon className="size-4" /> {DASHBOARD_NAV.label}
      </NavLink>
      <p className="mt-4 mb-1 px-3 text-xs font-medium text-muted-foreground">Modules</p>
      {ordered.map((m) => {
        const ent = me?.modules?.[m.key]
        const visible = canView(m.key)
        // Locked modules are shown to admins as an upgrade prompt; hidden for everyone else
        if (!visible && !(isAdmin && ent?.status === "inactive")) return null
        const label = m.termKey ? term(m.termKey, m.label) : m.label
        return (
          <NavLink key={m.key} href={`/app/m/${m.key}`} active={pathname.startsWith(`/app/m/${m.key}`)} onClick={onNavigate}>
            <m.icon className="size-4" />
            <span className="flex-1 truncate">{label}</span>
            {ent?.status === "inactive" && <Lock className="size-3.5 text-muted-foreground" aria-label="Not in your plan" />}
            {ent?.status === "read_only" && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Read-only</Badge>}
          </NavLink>
        )
      })}
      <div className="mt-auto grid gap-1 pt-4">
        {can("tenant.billing.view") && (
          <NavLink href="/app/billing" active={pathname.startsWith("/app/billing")} onClick={onNavigate}>
            <CreditCard className="size-4" /> Plan & billing
          </NavLink>
        )}
        {can("tenant.settings.view") && (
          <NavLink href="/app/settings" active={pathname.startsWith("/app/settings")} onClick={onNavigate}>
            <Settings className="size-4" /> Settings
          </NavLink>
        )}
      </div>
    </nav>
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
  const { data, reload } = useApi<NotificationList>("/notifications")
  return (
    <DropdownMenu onOpenChange={(open) => open && void reload()}>
      <DropdownMenuTrigger className={buttonVariants({ variant: "ghost", size: "icon", className: "relative" })} aria-label="Notifications">
        <Bell className="size-4" />
        {!!data?.unread && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            Notifications
            {!!data?.unread && (
              <button className="text-xs font-normal text-muted-foreground hover:text-foreground" onClick={() => api.post("/notifications/read").then(reload)}>
                Mark all read
              </button>
            )}
          </DropdownMenuLabel>
          {!data?.data.length && <p className="px-2 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>}
          {data?.data.map((n) => (
            <DropdownMenuItem key={n.id} className="flex-col items-start gap-0.5">
              <span className={cn("text-sm", !n.readAt && "font-medium")}>{n.title}</span>
              {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
              <span className="text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
        <DropdownMenuItem onClick={() => router.push("/app/account/security")}>
          <ShieldCheck className="size-4" /> Security
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
        <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
          <div className="border-b p-3">
            <WorkspaceSwitcher />
          </div>
          <Sidebar />
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
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Menu className="size-4" />
            </Button>
            <CommandPalette />
            <div className="flex-1" />
            <Notifications />
            <UserMenu />
          </header>
          <main className={cn("w-full flex-1", fullBleed ? "flex min-w-0 flex-col" : "mx-auto max-w-6xl px-4 py-6 sm:px-6")}>
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
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
