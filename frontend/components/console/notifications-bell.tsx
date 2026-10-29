"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Bell } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useApi } from "@/lib/use-api"
import { atBase, useConsoleBase } from "@/lib/console-base"
import type { ConsoleHome } from "@/lib/console"

// The bell shows the same "needs attention" list as Overview (the API caches it for 30 s).

export function NotificationsBell() {
  const router = useRouter()
  const base = useConsoleBase()
  const { data } = useApi<ConsoleHome>("/console/home")
  const items = data?.todo ?? []
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative grid size-9 place-items-center rounded-lg hover:bg-muted" aria-label={items.length ? `${items.length} things need attention` : "Notifications"}>
        <Bell className="size-[18px]" />
        {items.length > 0 && <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">{items.length}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-foreground">Needs attention</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!items.length ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          items.map((t, i) => (
            <DropdownMenuItem key={`${t.kind}-${i}`} onClick={() => router.push(atBase(base, t.href))} className="flex-col items-start gap-0.5">
              <span className="text-[13px] font-medium">{t.title}</span>
              <span className="text-xs text-muted-foreground">{t.detail}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
