"use client"

import { Check, ChevronRight, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export interface Step {
  key: string
  label: string
  icon: LucideIcon
}

/** Steps across the top of a long form. `open` says which steps can be jumped to. */
export function Stepper({ steps, at, open, onPick }: { steps: Step[]; at: number; open: (index: number) => boolean; onPick: (index: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-5">
      {steps.map((s, i) => {
        const done = i < at
        const Icon = done ? Check : s.icon
        return (
          <li key={s.key} className="flex flex-1 items-center gap-3">
            <button type="button" disabled={!open(i)} onClick={() => onPick(i)} aria-current={i === at ? "step" : undefined} className="flex min-w-0 items-center gap-2.5 text-left disabled:cursor-default">
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border text-muted-foreground", (done || i === at) && "border-primary bg-primary/10 text-primary")}>
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] tracking-wide text-muted-foreground uppercase">Step {i + 1}</span>
                <span className={cn("block truncate text-sm font-semibold text-muted-foreground", (done || i === at) && "text-primary")}>{s.label}</span>
              </span>
            </button>
            {i < steps.length - 1 && <ChevronRight className="ml-auto hidden size-5 shrink-0 text-muted-foreground lg:block" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}
