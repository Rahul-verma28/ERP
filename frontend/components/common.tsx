"use client"

import * as React from "react"
import { Loader2, Search, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { paiseToRupees, rupeesToPaise } from "@/lib/money"

export function SearchInput({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} />
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-2xl bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </span>
      <p className="mt-1 font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null
  return (
    <div className="flex justify-center p-3">
      <Button variant="outline" size="sm" onClick={onClick} disabled={loading}>
        {loading ? "Loading…" : "Load more"}
      </Button>
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted-foreground", className)} aria-label="Loading" />
}

/** Rupee amount input that reports integer paise to the parent. */
export function MoneyInput({
  value,
  onChange,
  id,
  className,
  ...props
}: { value: number | null; onChange: (paise: number | null) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const [text, setText] = React.useState(paiseToRupees(value))
  const [focused, setFocused] = React.useState(false)
  const shown = focused ? text : paiseToRupees(value)
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
      <Input
        id={id}
        inputMode="decimal"
        value={shown}
        className="pl-7 text-right tabular-nums"
        onFocus={() => {
          setText(paiseToRupees(value))
          setFocused(true)
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value)
          onChange(rupeesToPaise(e.target.value))
        }}
        {...props}
      />
    </div>
  )
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  accepted: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  declined: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  converted: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100",
  issued: "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100",
  partially_paid: "bg-orange-100 text-orange-950 dark:bg-orange-950 dark:text-orange-100",
  paid: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  cancelled: "bg-red-100 text-red-900 line-through dark:bg-red-950 dark:text-red-100",
  overdue: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  done: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  scheduled: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  completed: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  no_show: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  new: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  contacted: "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100",
  qualified: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  lost: "bg-muted text-muted-foreground",
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  high: "bg-orange-100 text-orange-950 dark:bg-orange-950 dark:text-orange-100",
  urgent: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  open: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  part_received: "bg-orange-100 text-orange-950 dark:bg-orange-950 dark:text-orange-100",
  received: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  billed: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100",
  closed: "bg-muted text-muted-foreground",
  approved: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  unpaid: "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100",
  part_paid: "bg-orange-100 text-orange-950 dark:bg-orange-950 dark:text-orange-100",
}

const STATUS_LABEL: Record<string, string> = { partially_paid: "Partly paid", in_progress: "In progress", no_show: "No-show", todo: "To do", part_received: "Part received", part_paid: "Part paid" }

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge variant="outline" className={cn("border-transparent capitalize", STATUS_STYLE[status])}>
      {label ?? STATUS_LABEL[status] ?? status.replace(/_/g, " ")}
    </Badge>
  )
}

/** Confirmation dialog with optional reason field. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  reasonLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  reasonLabel?: string
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {reasonLabel && <Input aria-label={reasonLabel} placeholder={reasonLabel} value={reason} onChange={(e) => setReason(e.target.value)} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy || (!!reasonLabel && reason.trim().length < 3)}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm(reason.trim())
                onOpenChange(false)
                setReason("")
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? "Please wait…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
