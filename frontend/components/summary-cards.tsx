"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// A row of tinted summary cards over a list: a number, what it is, and its share of the total.

const TINT: Record<string, string> = {
  blue: "from-blue-50 to-blue-100/60 border-blue-200 text-blue-700 dark:from-blue-500/10 dark:to-blue-500/5 dark:border-blue-500/25 dark:text-blue-300",
  emerald: "from-emerald-50 to-emerald-100/60 border-emerald-200 text-emerald-700 dark:from-emerald-500/10 dark:to-emerald-500/5 dark:border-emerald-500/25 dark:text-emerald-300",
  violet: "from-violet-50 to-violet-100/60 border-violet-200 text-violet-700 dark:from-violet-500/10 dark:to-violet-500/5 dark:border-violet-500/25 dark:text-violet-300",
  rose: "from-rose-50 to-rose-100/60 border-rose-200 text-rose-700 dark:from-rose-500/10 dark:to-rose-500/5 dark:border-rose-500/25 dark:text-rose-300",
  amber: "from-amber-50 to-amber-100/60 border-amber-200 text-amber-700 dark:from-amber-500/10 dark:to-amber-500/5 dark:border-amber-500/25 dark:text-amber-300",
  slate: "from-slate-50 to-slate-100/60 border-slate-200 text-slate-700 dark:from-slate-500/10 dark:to-slate-500/5 dark:border-slate-500/25 dark:text-slate-300",
}

export interface SummaryCard { label: string; value: number | string; hint?: string; color: keyof typeof TINT | string; icon: LucideIcon; href?: string }

export function SummaryCards({ items, className }: { items: SummaryCard[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5", items.length === 4 && "xl:grid-cols-4", className)}>
      {items.map((c) => {
        const body = (
          <>
            <div className="flex items-start justify-between gap-2"><p className="text-xs font-medium">{c.label}</p><c.icon className="size-5 opacity-80" aria-hidden /></div>
            <p className="text-2xl font-bold tabular-nums text-foreground">{c.value}</p>
            {c.hint && <p className="text-[11px] opacity-80">{c.hint}</p>}
          </>
        )
        const cls = cn("grid gap-1 rounded-2xl border bg-gradient-to-br p-4 transition-shadow", TINT[c.color] ?? TINT.slate, c.href && "hover:shadow-md")
        return c.href ? <Link key={c.label} href={c.href} className={cls}>{body}</Link> : <div key={c.label} className={cls}>{body}</div>
      })}
    </div>
  )
}

/** "40% of total" */
export const share = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}% of total` : "—")
