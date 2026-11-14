"use client"

import * as React from "react"
import Link from "next/link"
import { AlertCircle, Lock, SearchX, ShieldAlert } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"

// Phase 0 page states: no results, loading, error, no access, module locked, read-only.
// "First use" stays EmptyState in components/common.tsx.

function StateFrame({ icon, tone = "muted", title, children, action }: { icon: React.ReactNode; tone?: "muted" | "error" | "brand"; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className={cn("grid size-11 place-items-center rounded-2xl", tone === "error" ? "bg-destructive/10 text-destructive" : tone === "brand" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{icon}</span>
      <p className="mt-1 font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

/** Filters/search matched nothing — different from "nothing here yet". */
export function NoResults({ filters, onClear }: { filters?: string[]; onClear?: () => void }) {
  return (
    <StateFrame icon={<SearchX className="size-5" />} title="Nothing matches" action={onClear && <Button variant="outline" onClick={onClear}>Clear filters</Button>}>
      {filters?.length ? <>Filters: {filters.join(" · ")}</> : "Try a different search."}
    </StateFrame>
  )
}

/** Error with Retry and the request reference users can quote to support. */
export function ErrorState({ error, onRetry, title = "Couldn't load this" }: { error: unknown; onRetry?: () => void; title?: string }) {
  if (error instanceof ApiError && error.status === 403) return <NoAccess />
  const message = error instanceof Error ? error.message : "Something went wrong."
  const ref = error instanceof ApiError ? error.requestId : undefined
  return (
    <StateFrame icon={<AlertCircle className="size-5" />} tone="error" title={title} action={onRetry && <Button onClick={onRetry}>Retry</Button>}>
      <p>{message}</p>
      {ref && (
        <p className="mt-1 text-xs">
          Reference for support: <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">{ref.slice(-12).toUpperCase()}</code>
        </p>
      )}
    </StateFrame>
  )
}

export function NoAccess({ what = "this page" }: { what?: string }) {
  return (
    <StateFrame icon={<ShieldAlert className="size-5" />} title="You don't have access">
      Your role can&apos;t open {what}. Ask your admin to change your role.
    </StateFrame>
  )
}

/** Module not in the plan: what it does + upgrade (owner) or ask (staff). */
export function ModuleLocked({ name, description, canUpgrade }: { name: string; description: string; canUpgrade: boolean }) {
  return (
    <StateFrame
      icon={<Lock className="size-5" />}
      tone="brand"
      title={`${name} isn't in your plan`}
      action={canUpgrade ? <Link href="/app/billing" className={buttonVariants()}>See plans</Link> : undefined}
    >
      {description}
      {!canUpgrade && <p className="mt-1">Ask your business owner to add it.</p>}
    </StateFrame>
  )
}

/** Banner on modules that became read-only after the trial. */
export function ReadOnlyBanner({ name, canUpgrade }: { name: string; canUpgrade: boolean }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
      <span>
        <strong>{name} is read-only.</strong> Your data is safe — upgrade to add or change records.
      </span>
      {canUpgrade && (
        <Link href="/app/billing" className={buttonVariants({ size: "sm" })}>
          Upgrade
        </Link>
      )}
    </div>
  )
}

/** Skeleton rows in the shape of a table; says "Still loading…" after 10 s. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  const [slow, setSlow] = React.useState(false)
  React.useEffect(() => {
    const t = setTimeout(() => setSlow(true), 10_000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="grid gap-3 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-4 rounded-full", c === 0 ? "w-3/4" : "w-1/2")} />
          ))}
        </div>
      ))}
      {slow && <p className="pt-2 text-center text-xs text-muted-foreground">Still loading…</p>}
    </div>
  )
}

/**
 * A whole page that could not load: the same card everywhere, with Retry. Retry calls `onRetry`
 * when the page can reload its data, otherwise it reloads the page.
 */
export function PageError({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const offline = error instanceof ApiError && error.status === 0
  return (
    <div className="ui-surface mx-auto my-6 max-w-xl">
      <ErrorState error={error} title={title ?? (offline ? "You seem to be offline" : "Couldn't load this page")} onRetry={onRetry ?? (() => window.location.reload())} />
    </div>
  )
}

/** A page waiting for its data: a spinner, then a note if the server is slow */
export function PageLoading({ label = "Loading" }: { label?: string }) {
  const [slow, setSlow] = React.useState(false)
  React.useEffect(() => {
    const t = setTimeout(() => setSlow(true), 10_000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="grid place-items-center gap-3 py-24" aria-busy="true" aria-label={label}>
      <span className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      {slow && <p className="text-center text-sm text-muted-foreground">Still loading… <button type="button" className="font-medium text-primary underline" onClick={() => window.location.reload()}>Refresh</button></p>}
    </div>
  )
}
