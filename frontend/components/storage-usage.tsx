"use client"

import Link from "next/link"
import { formatSize } from "@/lib/files"
import { cn } from "@/lib/utils"

/** Uploaded files against the plan (backend files/usage.ts) */
export interface StorageUsage {
  usedBytes: number
  files: number
  limitBytes: number | null
  percent: number | null
}

/** "2.3 GB of 5 GB", a bar that turns amber at 80% and red when full, and the next step */
export function StorageBar({ usage, manageHref, className }: { usage: StorageUsage; manageHref?: string | null; className?: string }) {
  const pct = usage.percent ?? 0
  const tone = pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-primary"
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>File storage</span>
        <span className="text-muted-foreground tabular-nums">
          {formatSize(usage.usedBytes)} of {usage.limitBytes == null ? "unlimited" : formatSize(usage.limitBytes)}
          {usage.percent != null && ` · ${usage.percent}%`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="File storage used" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${usage.limitBytes == null ? 0 : Math.max(pct, usage.usedBytes ? 1 : 0)}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {usage.files} file{usage.files === 1 ? "" : "s"}
          {pct >= 100 ? " · Full: new uploads are stopped" : pct >= 80 ? " · Nearly full" : ""}
        </span>
        {manageHref && <Link href={manageHref} className="font-medium text-primary hover:underline">Manage files</Link>}
      </div>
    </div>
  )
}
