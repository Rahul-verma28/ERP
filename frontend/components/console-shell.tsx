"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Building2, LogOut, Menu, ShieldCheck, UserRound, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ConsolePalette } from "@/components/console/console-palette"
import { useNav, type NavItem } from "@/components/console/console-nav"
import { NotificationsBell } from "@/components/console/notifications-bell"
import { HelpPanel } from "@/components/console/help-panel"
import { useAuth } from "@/lib/auth"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useConsoleBase } from "@/lib/console-base"

// Console shell (blueprint Phase A): grouped sidebar, sticky top bar with Ctrl+K search,
// notifications and the account menu. Each person only sees the groups and pages their
// role allows, and only pages that exist are listed.

/** The nav item a path belongs to: the longest matching href wins (Plans is under Settings in the URL). */
function useActive() {
  const pathname = usePathname()
  const { groups, settings } = useNav()
  const all = [...groups.flatMap((g) => g.items), ...(settings ? [settings] : [])]
  const match = all.filter((i) => pathname === i.href || (i.href.split("/").length > 2 && pathname.startsWith(`${i.href}/`))).sort((a, b) => b.href.length - a.href.length)[0]
  return match?.href ?? null
}

function Brand() {
  const { me } = useAuth()
  const base = useConsoleBase()
  const partner = me?.console?.partner
  return (
    <Link href={base} className="flex items-center gap-3 px-2 py-1">
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--console-brand)] text-white shadow-sm">
        {partner ? <span className="text-xs font-bold">{initials(partner.name)}</span> : <span className="text-sm font-bold">A</span>}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold">{partner ? partner.name : "AHEAD"}</span>
        <span className="block truncate text-xs text-muted-foreground">{partner ? "Partner portal" : "Console"} · {me?.console?.role.name}</span>
      </span>
    </Link>
  )
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-foreground/75 transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <item.icon className="size-[17px]" /> {item.label}
    </Link>
  )
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { groups, settings } = useNav()
  const active = useActive()
  return (
    <>
      <nav className="flex flex-col gap-5" aria-label="Console">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-0.5">
            <div className="px-3 pb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{g.label}</div>
            {g.items.map((item) => (
              <NavLink key={item.href} item={item} active={active === item.href} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>
      {settings && (
        <div className="mt-auto border-t pt-3">
          <NavLink item={settings} active={active === settings.href} onNavigate={onNavigate} />
        </div>
      )}
    </>
  )
}

function AccountMenu() {
  const { me, signOut } = useAuth()
  const router = useRouter()
  const base = useConsoleBase()
  if (!me) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-offset-2" aria-label="Account menu">
        <Avatar className="size-9">
          <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">{initials(me.user.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate text-sm font-medium text-foreground">{me.user.name}</span>
            <span className="block truncate text-xs font-normal">
              {me.user.email} · {me.console?.role.name}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push(`${base}/account`)}>
          <UserRound className="size-4" /> My account
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push(`${base}/account/security`)}>
          <ShieldCheck className="size-4" /> Password &amp; two-step
        </DropdownMenuItem>
        {me.memberships.length > 0 && (
          <DropdownMenuItem onClick={() => router.push("/app")}>
            <Building2 className="size-4" /> Open my business
          </DropdownMenuItem>
        )}
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

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <Brand />
      <Nav onNavigate={onNavigate} />
    </div>
  )
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  // The partner portal is a separate place with its own colour (globals.css [data-portal="partner"])
  const portal = useConsoleBase() === "/partner" ? "partner" : "console"
  return (
    <div className="flex min-h-svh bg-background" data-portal={portal}>
      <aside className={cn("sticky top-0 hidden h-svh w-64 shrink-0 border-r lg:block print:hidden", portal === "partner" ? "bg-accent/50" : "bg-card")}>
        <SidebarBody />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-card shadow-xl">
            <Button variant="ghost" size="icon" className="absolute top-4 right-3" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-4" />
            </Button>
            <SidebarBody onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card/90 px-4 backdrop-blur sm:px-6 print:hidden">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </Button>
          <ConsolePalette />
          <div className="flex-1" />
          <HelpPanel />
          <NotificationsBell />
          <AccountMenu />
        </header>
        <main className="w-full flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  )
}
