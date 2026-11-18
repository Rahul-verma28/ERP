"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { api } from "@/lib/api"
import { formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { FilterDef, ListLoader } from "@/components/data-list"
import { todayInIndia } from "@contracts/validation"

// Pieces every report page shares: a loader for reports the API returns whole (searched and paged
// here, the full response kept for totals and cards), the tab bar kept in the address, money cells
// and the period and month filters.

/** A report the API returns whole: searched and paged here; the response (sums, all rows) stays for the cards */
export function wholeReport<T>(url: (params: Record<string, string>) => string, match: (row: T, q: string) => boolean, key: "data" | "rows" = "data"): ListLoader<T> {
  return async ({ params, limit, cursor }) => {
    const r = await api.get<Record<string, unknown>>(url(params))
    const q = (params.q ?? "").toLowerCase()
    const all = ((r[key] as T[]) ?? []).filter((row) => !q || match(row, q))
    const start = Number(cursor ?? 0)
    return { ...r, all, data: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, total: all.length }
  }
}

export const monthStart = () => `${todayInIndia().slice(0, 8)}01`
/** from/to for the API from the period filter, this month when none is chosen */
export const range = (p: Record<string, string>) => `from=${p.from ?? monthStart()}&to=${p.to ?? todayInIndia()}`

/** The last 12 months, newest first, as a filter that sends `month` */
export function monthFilter(label = "Month"): FilterDef {
  const t = todayInIndia()
  const options = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1 - i, 1))
    return { value: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }) }
  })
  return { key: "month", label, options }
}
export const thisMonth = () => todayInIndia().slice(0, 7)
/** Last month, for payroll (this month's run is usually not made yet) */
export const lastMonth = () => { const t = todayInIndia(); const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 2, 1)); return d.toISOString().slice(0, 7) }

export const Money = ({ p, strong, tone }: { p: number; strong?: boolean; tone?: "loss" | "gain" | "auto" }) => (
  <span className={cn("tabular-nums", strong && "font-semibold", tone === "loss" || (tone === "auto" && p < 0) ? "text-destructive" : tone === "gain" ? "text-emerald-600 dark:text-emerald-400" : "", !p && !tone && "text-muted-foreground")}>{p ? formatPaise(p) : "—"}</span>
)
export const hours = (min: number) => (min ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : "—")
export const qtyText = (q: number) => (q ? Number(q.toFixed(3)).toLocaleString("en-IN") : "—")
export const ist = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })

/** Report tabs kept in the address (?tab=), so a link or reload opens the same one */
export function useReportTab<K extends string>(tabs: readonly (readonly [K, string])[], fallback?: K) {
  const router = useRouter()
  const params = useSearchParams()
  const tab = (tabs.find(([k]) => k === params.get("tab"))?.[0] ?? fallback ?? tabs[0][0]) as K
  const set = (k: K) => {
    const q = new URLSearchParams(params.toString())
    q.set("tab", k)
    router.replace(`?${q.toString()}`, { scroll: false })
  }
  return [tab, set] as const
}

export function ReportTabs<K extends string>({ tabs, value, onChange }: { tabs: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border p-1 text-sm print:hidden" role="tablist" aria-label="Reports">
      {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", value === k && "bg-primary text-primary-foreground")}>{l}</button>)}
    </div>
  )
}
