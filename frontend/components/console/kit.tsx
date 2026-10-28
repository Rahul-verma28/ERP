"use client"

import * as React from "react"
import Link from "next/link"
import { AlertCircle, ArrowLeft, ArrowRight, Check, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPaise } from "@/lib/format"
import type { ApiError } from "@/lib/api"
import type { TenantStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

// The Console's building blocks — one look for the AHEAD team, vendors and partners.
// Plain words, one obvious action per screen, generous spacing.

export const money = (paise: number) => formatPaise(paise, true)

// ── Page ──

export function Page({ title, subtitle, back, actions, children }: { title: React.ReactNode; subtitle?: React.ReactNode; back?: { href: string; label: string }; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {back && (
            <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3.5" /> {back.label}
            </Link>
          )}
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  )
}

// ── Panel (a card with a title) ──

export function Panel({ title, description, action, children, className, padded = true }: { title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cn("min-w-0 rounded-2xl border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4 pb-1">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cn(padded ? "px-5 pt-3 pb-5" : "pb-1")}>{children}</div>
    </section>
  )
}

export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
      {children} <ArrowRight className="size-3.5" />
    </Link>
  )
}

// ── Numbers ──

export function Stat({ label, value, hint, href, icon: Icon, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; icon?: LucideIcon; tone?: "warn" }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        {Icon && (
          <span className="grid size-8 place-items-center rounded-xl bg-accent text-accent-foreground">
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <div className="mt-2 text-[28px] leading-none font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className={cn("mt-2 text-[13px]", tone === "warn" ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{hint}</div>}
    </>
  )
  const cls = "block min-w-0 rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
  return href ? (
    <Link href={href} className={cn(cls, "transition hover:border-primary/40 hover:shadow-sm")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
}

// ── Status chips ──

const TONE = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-600/15 dark:bg-emerald-950/60 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/60 dark:text-amber-300",
  red: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-950/60 dark:text-red-300",
  blue: "bg-accent text-accent-foreground ring-primary/15",
  grey: "bg-muted text-foreground/75 ring-foreground/10",
} as const
const DOT = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500", blue: "bg-primary", grey: "bg-muted-foreground/60" } as const
export type Tone = keyof typeof TONE

export function Chip({ tone = "grey", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", TONE[tone], className)}>
      <span className={cn("size-1.5 rounded-full", DOT[tone])} />
      {children}
    </span>
  )
}

/** Client status in plain words: what it means for the client today */
export const CLIENT_STATUS: Record<TenantStatus, { label: string; tone: Tone }> = {
  incomplete: { label: "Waiting for payment", tone: "amber" },
  trialing: { label: "Free trial", tone: "blue" },
  active: { label: "Paying", tone: "green" },
  past_due: { label: "Payment overdue", tone: "red" },
  free: { label: "Free plan", tone: "grey" },
  closed: { label: "Closed", tone: "grey" },
  purged: { label: "Deleted", tone: "grey" },
}

export function ClientStatus({ status, suffix, partnerBilled }: { status: TenantStatus; suffix?: string; partnerBilled?: boolean }) {
  // A partner's client doesn't pay AHEAD itself: it is simply live
  const s = partnerBilled && status === "active" ? { label: "Live", tone: "green" as Tone } : CLIENT_STATUS[status]
  return (
    <Chip tone={s.tone}>
      {s.label}
      {suffix ? ` · ${suffix}` : ""}
    </Chip>
  )
}

// ── States ──

export function Empty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-2xl bg-accent text-accent-foreground">
        <Icon className="size-5" />
      </span>
      <p className="mt-1 text-[15px] font-semibold">{title}</p>
      {text && <p className="max-w-sm text-sm text-muted-foreground">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Loading({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  )
}

export function Failed({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/60 px-4 py-3 text-sm dark:border-red-900 dark:bg-red-950/30">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
      <div className="flex-1">
        <p className="font-medium">Couldn&apos;t load this</p>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

// ── Lists ──

/** A row with an icon, a title, a line of detail and one action on the right */
export function Row({ icon: Icon, tone = "blue", title, detail, right, href }: { icon?: LucideIcon; tone?: Tone; title: React.ReactNode; detail?: React.ReactNode; right?: React.ReactNode; href?: string }) {
  const inner = (
    <>
      {Icon && (
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset", TONE[tone])}>
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {detail && <span className="block truncate text-[13px] text-muted-foreground">{detail}</span>}
      </span>
      {right && <span className="shrink-0">{right}</span>}
    </>
  )
  const cls = "flex min-w-0 items-center gap-3 rounded-xl px-2 py-2.5"
  return href ? (
    <Link href={href} className={cn(cls, "hover:bg-muted/70")}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  )
}

/** Label / value pairs, read-only */
export function Facts({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-8 gap-y-4 sm:grid-cols-2", className)}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{i.label}</dt>
          <dd className="mt-1 text-sm break-words">{i.value === null || i.value === undefined || i.value === "" ? <span className="text-muted-foreground">—</span> : i.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ── Wizard steps ──

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Steps">
      {steps.map((s, i) => {
        const done = i < current
        const on = i === current
        return (
          <li key={s} className="flex items-center gap-2" aria-current={on ? "step" : undefined}>
            <span className={cn("grid size-7 place-items-center rounded-full text-xs font-semibold", done ? "bg-primary text-primary-foreground" : on ? "bg-accent text-accent-foreground ring-2 ring-primary" : "bg-muted text-muted-foreground")}>
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn("text-sm", on ? "font-semibold" : "text-muted-foreground")}>{s}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-border sm:w-10" />}
          </li>
        )
      })}
    </ol>
  )
}

// ── Small helpers ──

export function daysFrom(iso: string | null | undefined) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

/** "today", "in 3 days", "2 days ago" */
export function relDays(iso: string | null | undefined) {
  const d = daysFrom(iso)
  if (d === null) return "—"
  if (d === 0) return "today"
  if (d === 1) return "tomorrow"
  if (d === -1) return "yesterday"
  return d > 0 ? `in ${d} days` : `${-d} days ago`
}

/** "8 min ago", "3 h ago", "4 d ago" */
export function ago(iso: string | null | undefined) {
  if (!iso) return "Never"
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 2) return "Just now"
  if (min < 60) return `${min} min ago`
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`
  return `${Math.round(min / 1440)} d ago`
}

export const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
}

/** Default due time for a new follow-up: tomorrow 11 am, as a datetime-local value */
export const tomorrowAt11 = () => `${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T11:00`

export const industryLabel = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
