"use client"

import * as React from "react"
import { Check, Trash2 } from "lucide-react"
import { ACTIVITY_META } from "@/components/crm/dialogs"
import type { Activity } from "@/lib/crm"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

// The timeline of notes, calls and meetings, and the task list, on lead and deal pages.

export function Timeline({ items, onDelete }: { items: Activity[]; onDelete?: (a: Activity) => void }) {
  if (!items.length) return <p className="px-2 py-8 text-center text-sm text-muted-foreground">Nothing logged yet. Log a call or a note after every conversation.</p>
  return (
    <ol className="relative grid gap-4 before:absolute before:top-2 before:bottom-2 before:left-[17px] before:w-px before:bg-border">
      {items.map((a) => {
        const meta = ACTIVITY_META[a.type] ?? ACTIVITY_META.note
        const Icon = meta.icon
        return (
          <li key={a.id} className="relative flex gap-3">
            <span className="z-10 grid size-9 shrink-0 place-items-center rounded-full border bg-card text-primary"><Icon className="size-4" aria-hidden /></span>
            <div className="min-w-0 flex-1 rounded-2xl border bg-card px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium">{a.title ?? meta.label}</p>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">{formatDateTime(a.createdAt)}{onDelete && !/^(Moved to|Deal |Converted|Marked lost|Reopened)/.test(a.title ?? "") ? <button type="button" className="rounded p-1 hover:bg-muted hover:text-destructive" aria-label="Delete" onClick={() => onDelete(a)}><Trash2 className="size-3.5" /></button> : null}</span>
              </div>
              {a.body && <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{a.body}</p>}
              <p className="mt-1.5 text-xs text-muted-foreground">{meta.label}{a.createdByName ? ` · ${a.createdByName}` : ""}{a.dueAt ? ` · due ${formatDateTime(a.dueAt)}` : ""}{a.completedAt ? " · done" : ""}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function TaskList({ items, onToggle, emptyHint }: { items: Activity[]; onToggle: (a: Activity) => void; emptyHint: string }) {
  const [now] = React.useState(() => Date.now())
  const tasks = items.filter((a) => a.type === "task" || a.type === "follow_up").sort((a, b) => Number(!!a.completedAt) - Number(!!b.completedAt) || (a.dueAt ?? "").localeCompare(b.dueAt ?? ""))
  if (!tasks.length) return <p className="px-2 py-8 text-center text-sm text-muted-foreground">{emptyHint}</p>
  return (
    <ul className="divide-y rounded-2xl border bg-card">
      {tasks.map((t) => {
        const late = !t.completedAt && t.dueAt && new Date(t.dueAt).getTime() < now
        return (
          <li key={t.id} className="flex items-start gap-3 px-4 py-3">
            <button type="button" onClick={() => onToggle(t)} aria-label={t.completedAt ? `Mark ${t.title} not done` : `Mark ${t.title} done`} className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border", t.completedAt ? "border-emerald-500 bg-emerald-500 text-white" : "hover:border-primary")}>{t.completedAt && <Check className="size-3.5" />}</button>
            <div className="min-w-0 flex-1">
              <p className={cn("font-medium", t.completedAt && "text-muted-foreground line-through")}>{t.title}</p>
              {t.body && <p className="text-sm text-muted-foreground">{t.body}</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">{t.type === "follow_up" ? "Follow-up" : "Task"}{t.assigneeName ? ` · ${t.assigneeName}` : ""}</p>
            </div>
            {t.dueAt && <span className={cn("shrink-0 text-xs", late ? "font-semibold text-destructive" : "text-muted-foreground")}>{late ? "Late · " : ""}{formatDateTime(t.dueAt)}</span>}
          </li>
        )
      })}
    </ul>
  )
}

