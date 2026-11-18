"use client"

import { AlarmClock } from "lucide-react"
import { slaText, type TicketRow } from "@/lib/support"
import { cn } from "@/lib/utils"

/** The SLA clock that matters now: the first reply until it is made, then the fix */
export function SlaCell({ t, now }: { t: Pick<TicketRow, "status" | "firstResponseDue" | "firstResponseAt" | "resolveDue" | "resolvedAt">; now: number }) {
  if (t.status === "resolved" || t.status === "closed") return <span className="text-xs text-muted-foreground">Done</span>
  const first = slaText(t.firstResponseDue, t.firstResponseAt, now)
  const fix = slaText(t.resolveDue, t.resolvedAt, now)
  const s = first ?? fix
  if (!s) return <span className="text-muted-foreground">—</span>
  return <span className={cn("inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap", s.late ? "text-destructive" : s.soon ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}><AlarmClock className="size-3.5" />{first ? "Reply" : "Fix"} {s.text}</span>
}
