"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Bell, CalendarClock, CircleDollarSign, Inbox, KeyRound, Percent, Rocket, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SidePanel } from "@/components/side-panel"
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
  const [open, setOpen] = React.useState(false)
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

  const change = (next: boolean) => {
    setOpen(next)
    if (next) refresh()
    else markSeen()
  }
  const go = (href: string) => {
    change(false)
    router.push(href)
  }

  return (
    <>
      <button type="button" onClick={() => change(true)} className="relative grid size-9 place-items-center rounded-lg hover:bg-muted" aria-label={unseen ? `${unseen} new notifications` : "Notifications"}>
        <Bell className="size-[18px]" />
        {unseen > 0 && <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">{unseen}</span>}
      </button>
      <SidePanel open={open} onOpenChange={change} eyebrow="Notifications" title={`Needs attention${items.length ? ` · ${items.length}` : ""}`}>
        <div className="flex h-full flex-col">
          {!items.length ? (
            <div className="grid flex-1 place-items-center p-8 text-center text-muted-foreground">
              <div className="grid justify-items-center gap-2">
                <span className="grid size-11 place-items-center rounded-full bg-muted"><Bell className="size-5" /></span>
                You&apos;re all caught up.
              </div>
            </div>
          ) : (
            <ul className="flex-1 divide-y">
              {items.map((t) => {
                const Icon = ICON[t.kind] ?? Bell
                const fresh = !seen.has(t.key)
                return (
                  <li key={t.key}>
                    <button type="button" onClick={() => go(atBase(base, t.href))} className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/60">
                      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-4" /></span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className={cn("text-[13.5px]", fresh ? "font-semibold" : "font-medium")}>{t.title}</span>
                        <span className="text-xs text-muted-foreground">{t.detail}</span>
                      </span>
                      {fresh && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="New" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="border-t p-3">
            <Button type="button" variant="ghost" className="w-full" onClick={() => go(base)}>Open Overview</Button>
          </div>
        </div>
      </SidePanel>
    </>
  )
}
