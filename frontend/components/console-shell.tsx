"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Building2, CreditCard, Handshake, Home, LogOut, Menu, ReceiptText, Settings2, ShieldCheck, Target, UserRound, Users, X, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAuth } from "@/lib/auth"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"

// The Console: one app, three panels. The AHEAD team runs everything; a vendor sees and adds
// its own clients; a partner looks after its clients and its monthly bill. Each person sees
// only their own menu.

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  show: boolean
}

function useNav(): NavItem[] {
  const { me, canConsole } = useAuth()
  const audience = me?.console?.audience ?? "team"
  if (audience === "partner") {
    return [
      { href: "/console", label: "Home", icon: Home, show: true },
      { href: "/console/clients", label: "Clients", icon: Building2, show: canConsole("platform.tenant.view") },
      { href: "/console/billing", label: "Billing", icon: ReceiptText, show: canConsole("platform.partner.view") },
      { href: "/console/team", label: "Team", icon: Users, show: canConsole("platform.member.view") },
    ]
  }
  if (audience === "vendor") {
    return [
      { href: "/console", label: "Home", icon: Home, show: true },
      { href: "/console/clients", label: "My clients", icon: Building2, show: canConsole("platform.tenant.view") },
      { href: "/console/payments", label: "Payments", icon: CreditCard, show: canConsole("platform.payment.view") },
    ]
  }
  return [
    { href: "/console", label: "Home", icon: Home, show: true },
    { href: "/console/clients", label: "Clients", icon: Building2, show: canConsole("platform.tenant.view") },
    { href: "/console/leads", label: "Leads", icon: Target, show: canConsole("platform.prospect.view") },
    { href: "/console/payments", label: "Payments", icon: CreditCard, show: canConsole("platform.payment.view") },
    { href: "/console/partners", label: "Partners", icon: Handshake, show: canConsole("platform.partner.view") },
    { href: "/console/settings", label: "Settings", icon: Settings2, show: canConsole("platform.plan.view") || canConsole("platform.setting.view") || canConsole("platform.member.view") },
  ]
}

function Brand() {
  const { me } = useAuth()
  const partner = me?.console?.partner
  return (
    <Link href="/console" className="flex items-center gap-3 px-2 py-1">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        {partner ? <span className="text-xs font-bold">{initials(partner.name)}</span> : <ShieldCheck className="size-4.5" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold">{partner ? partner.name : "AHEAD Console"}</span>
        <span className="block truncate text-xs text-muted-foreground">{partner ? "Partner panel" : me?.console?.audience === "vendor" ? "Vendor panel" : me?.console?.role.name}</span>
      </span>
    </Link>
  )
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const items = useNav().filter((i) => i.show)
  const active = (href: string) => (href === "/console" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`))
  return (
    <nav className="flex flex-col gap-1" aria-label="Console">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          aria-current={active(item.href) ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-foreground/70 transition-colors hover:bg-muted hover:text-foreground",
            active(item.href) && "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          <item.icon className="size-[18px]" /> {item.label}
        </Link>
      ))}
    </nav>
  )
}

function AccountMenu() {
  const { me, signOut } = useAuth()
  const router = useRouter()
  if (!me) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted" aria-label="Account menu">
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">{initials(me.user.name)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{me.user.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{me.user.email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate text-sm font-medium text-foreground">{me.user.name}</span>
            <span className="block truncate text-xs font-normal">{me.console?.role.name}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/console/account")}>
          <UserRound className="size-4" /> My account
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/console/account/security")}>
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
    <div className="flex h-full flex-col gap-6 p-4">
      <Brand />
      <Nav onNavigate={onNavigate} />
      <div className="mt-auto border-t pt-3">
        <AccountMenu />
      </div>
    </div>
  )
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const { me } = useAuth()
  return (
    <div className="flex min-h-svh bg-background">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 border-r bg-card lg:block print:hidden">
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur lg:hidden print:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </Button>
          <span className="flex-1 truncate text-sm font-semibold">{me?.console?.partner?.name ?? "AHEAD Console"}</span>
        </header>
        <main className="w-full flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  )
}
