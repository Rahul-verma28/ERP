"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Bell, CalendarClock, CircleDollarSign, Inbox, KeyRound, Percent, Rocket, type LucideIcon } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useApi } from "@/lib/use-api"
import { useAuth } from "@/lib/auth"
import { atBase, useConsoleBase } from "@/lib/console-base"
import type { ConsoleHome } from "@/lib/console"
import { cn } from "@/lib/utils"

// The bell: what needs attention now (the Overview list, plus new applications for Admins).
// It refreshes every minute and when you come back to the tab; the count shows only what you
// haven't seen yet (remembered in this browser), and opening the bell marks the list as seen.

type Item = { key: string; kind: string; title: string; detail: string; href: string }
const ICON: Record<string, LucideIcon> = { signin: KeyRound, discount: Percent, followup: CalendarClock, unpaid: CircleDollarSign, trial: CalendarClock, setup: Rocket, applications: Inbox }
const REFRESH_MS = 60_000

function readSeen(key: string) {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(key) ?? "[]") as string[])
  } catch {
    return new Set<string>()
  }
}

export function NotificationsBell() {
  const router = useRouter()
  const base = useConsoleBase()
  const { me, canConsole } = useAuth()
  const home = useApi<ConsoleHome>("/console/home")
  const canApps = canConsole("platform.partner.create") && me?.console?.audience === "team"
  const apps = useApi<{ counts: { new: number } }>(canApps ? "/console/applications?status=new" : null)
  const storeKey = `console:seen:${me?.user.id ?? "me"}`
  const [seen, setSeen] = React.useState<Set<string>>(new Set())
  const [loaded, setLoaded] = React.useState(false)
  if (!loaded && typeof window !== "undefined" && me) {
    setLoaded(true)
    setSeen(readSeen(storeKey))
  }

  const { reload: reloadHome } = home
  const { reload: reloadApps } = apps
  const refresh = React.useCallback(() => {
    void reloadHome().catch(() => undefined)
    if (canApps) void reloadApps().catch(() => undefined)
  }, [reloadHome, reloadApps, canApps])
  React.useEffect(() => {
    const t = setInterval(refresh, REFRESH_MS)
    const onFocus = () => document.visibilityState === "visible" && refresh()
    document.addEventListener("visibilitychange", onFocus)
    return () => {
      clearInterval(t)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [refresh])

  const newApps = apps.data?.counts.new ?? 0
  const items: Item[] = [
    ...(newApps ? [{ key: `applications:${newApps}`, kind: "applications", title: `${newApps} new application${newApps === 1 ? "" : "s"}`, detail: "People who want to be a vendor or partner", href: "/console/applications" }] : []),
    ...(home.data?.todo ?? []).map((t) => ({ key: `${t.kind}:${t.href}:${t.detail}`, kind: t.kind, title: t.title, detail: t.detail, href: t.href })),
  ]
  const unseen = items.filter((i) => !seen.has(i.key)).length

  function markSeen() {
    const next = new Set(items.map((i) => i.key))
    setSeen(next)
    try {
      localStorage.setItem(storeKey, JSON.stringify([...next]))
    } catch {
      /* private window */
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => (open ? refresh() : markSeen())}>
      <DropdownMenuTrigger className="relative grid size-9 place-items-center rounded-lg hover:bg-muted" aria-label={unseen ? `${unseen} new notifications` : "Notifications"}>
        <Bell className="size-[18px]" />
        {unseen > 0 && <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">{unseen}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 max-w-[92vw]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between text-foreground">
            Needs attention
            {items.length > 0 && <span className="text-xs font-normal text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</span>}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {!items.length ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((t) => {
              const Icon = ICON[t.kind] ?? Bell
              const fresh = !seen.has(t.key)
              return (
                <DropdownMenuItem key={t.key} onClick={() => router.push(atBase(base, t.href))} className="items-start gap-3 py-2.5">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><Icon className="size-3.5" /></span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className={cn("truncate text-[13px]", fresh ? "font-semibold" : "font-medium")}>{t.title}</span>
                    <span className="text-xs text-muted-foreground">{t.detail}</span>
                  </span>
                  {fresh && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="New" />}
                </DropdownMenuItem>
              )
            })}
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push(base)} className="justify-center text-[13px] text-muted-foreground">Open Overview</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
