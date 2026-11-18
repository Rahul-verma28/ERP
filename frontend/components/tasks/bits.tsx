"use client"

import { ListChecks } from "lucide-react"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Task } from "@/lib/tasks"
import { DOT } from "@/components/tasks/forms"

// Small pieces shared by the task list, board, project page and task page.

/** Due date, red with "Late · N days" when past */
export function DueText({ t }: { t: Pick<Task, "dueAt" | "status" | "overdue" | "overdueDays"> }) {
  if (!t.dueAt) return <span className="text-muted-foreground">No date</span>
  return <span className={cn("whitespace-nowrap", t.overdue && "text-destructive")}>{formatDateTime(t.dueAt)}{t.overdue && <span className="block text-xs font-medium">Late · {t.overdueDays} day{t.overdueDays === 1 ? "" : "s"}</span>}</span>
}

/** Checklist steps and subtasks done, as a short bar */
export function Progress({ t }: { t: Task }) {
  const total = (t.checklistTotal ?? 0) + (t.subtaskCount ?? 0)
  const done = (t.checklistDone ?? 0) + (t.subtaskDone ?? 0)
  if (!total) return null
  return <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><ListChecks className="size-3" />{done}/{total}<span className="h-1 w-10 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((done / total) * 100)}%` }} /></span></span>
}

export function ProjectDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("size-2 shrink-0 rounded-full", DOT[color] ?? DOT.blue, className)} />
}
