"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { formatPaise } from "@/lib/format"
import { isError, type Change } from "@/lib/dashboard"
import { cn } from "@/lib/utils"

// Building blocks for dashboard widgets (wireframes 5.1–5.8).

export const money = (paise: number) => formatPaise(paise, true)

export const pill = "inline-flex h-5 items-center rounded-full px-[7px] text-[11px] font-semibold whitespace-nowrap"
export const tones = {
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  amber: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  blue: "bg-accent text-accent-foreground",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  grey: "bg-muted text-foreground/80",
}

/** ▲ 12% / ▼ 4% — `goodWhenDown` for expenses, no-shows, cancellations */
export function Delta({ change, goodWhenDown, unit = "%", absolute }: { change: Change | null | undefined; goodWhenDown?: boolean; unit?: string; absolute?: (n: number) => string }) {
  if (!change) return null
  const value = absolute ? change.delta : change.pct
  if (value === null || value === 0) return <span className="text-xs font-semibold text-muted-foreground">{change.delta === 0 ? "No change" : "New"}</span>
  const up = change.delta > 0
  const good = goodWhenDown ? !up : up
  return (
    <span className={cn("text-xs font-semibold", good ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
      {up ? "▲" : "▼"} {absolute ? absolute(Math.abs(change.delta)) : `${Math.abs(value)}${unit}`}
    </span>
  )
}

export function Kpi({ label, value, change, note, href, goodWhenDown, tone, absolute }: { label: string; value: React.ReactNode; change?: Change | null; note?: React.ReactNode; href?: string; goodWhenDown?: boolean; tone?: "red"; absolute?: (n: number) => string }) {
  const body = (
    <>
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-[27px] leading-tight font-bold tabular-nums"><CountUp value={value} /></div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {change !== undefined && <Delta change={change} goodWhenDown={goodWhenDown} absolute={absolute} />}
        {note && <span className={cn("text-xs", tone === "red" ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground")}>{note}</span>}
      </div>
    </>
  )
  const cls = "ui-surface ui-rise block p-[18px]"
  return href ? (
    <Link href={href} className={cn(cls, "ui-lift")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="kpi-row grid grid-cols-2 gap-3.5 lg:grid-cols-4">{children}</div>
}

/** A widget card: title, optional right side, and its own loading / error / empty states. */
export function Widget({
  title,
  right,
  data,
  slow,
  onRetry,
  empty,
  children,
  className,
}: {
  title: string
  right?: React.ReactNode
  data: unknown
  slow?: boolean
  onRetry?: () => void
  /** Shown instead of the content when there's nothing yet */
  empty?: React.ReactNode | false
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("ui-surface ui-rise ui-lift flex h-full min-w-0 flex-col gap-3 p-[18px]", className)} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {data !== undefined && !isError(data) && right}
      </div>
      {data === undefined ? (
        <div className="grid gap-2" aria-busy="true">
          <div className="h-4 w-2/3 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded-md bg-muted" />
          <div className="h-16 animate-pulse rounded-md bg-muted" />
          {slow && <p className="text-xs text-muted-foreground">Still loading…</p>}
        </div>
      ) : isError(data) ? (
        <div className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-xs dark:border-red-900 dark:bg-red-950/20">
          Couldn&apos;t load {title}.{" "}
          {onRetry && (
            <button type="button" className="font-semibold text-primary hover:underline" onClick={onRetry}>
              Retry
            </button>
          )}{" "}
          <span className="text-muted-foreground">— the other widgets keep working.</span>
        </div>
      ) : empty ? (
        <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">{empty}</div>
      ) : (
        children
      )}
    </section>
  )
}

export function WidgetLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs font-semibold text-primary hover:underline">
      {children}
    </Link>
  )
}

/** Labelled horizontal bar with the value on the right */
export function Meter({ label, value, pct, color, href }: { label: React.ReactNode; value: React.ReactNode; pct: number; color?: string; href?: string }) {
  const inner = (
    <>
      <div className="mb-1 flex justify-between gap-2 text-xs">
        <span className="truncate">{label}</span>
        <strong className="shrink-0 tabular-nums">{value}</strong>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <i className="block h-full rounded-full" style={{ width: `${Math.max(pct > 0 ? 2 : 0, Math.min(100, pct))}%`, background: color ?? "var(--primary)" }} />
      </div>
    </>
  )
  return href ? (
    <Link href={href} className="block rounded-md hover:opacity-80">
      {inner}
    </Link>
  ) : (
    <div>{inner}</div>
  )
}

/** Shades of the brand colour for stacked meters (keeps lightness apart, not only hue) */
export const SHADES = ["var(--primary)", "color-mix(in oklab, var(--primary) 70%, white)", "color-mix(in oklab, var(--primary) 50%, white)", "color-mix(in oklab, var(--primary) 32%, white)", "var(--input)"]
export const WARN = ["var(--primary)", "#C27C0E", "#C2410C", "#B42318"]

/** Vertical bars; `pair` draws two bars per slot (e.g. invoiced vs collected). */
export function Bars({ rows, height = 140, pair, labels }: { rows: { label: string; a: number; b?: number; title?: string }[]; height?: number; pair?: boolean; labels?: [string, string] }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.a, r.b ?? 0)))
  const every = rows.length > 16 ? Math.ceil(rows.length / 10) : 1
  return (
    <div>
      {labels && (
        <div className="mb-1 flex gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <i className="inline-block size-2.5 rounded-sm" style={{ background: "var(--primary)" }} /> {labels[0]}
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block size-2.5 rounded-sm" style={{ background: SHADES[2] }} /> {labels[1]}
          </span>
        </div>
      )}
      <div className="flex items-end gap-1.5" style={{ height }} role="img" aria-label={rows.map((r) => `${r.label}: ${r.title ?? r.a}`).join(", ")}>
        {rows.map((r, i) => (
          <div key={`${r.label}-${i}`} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={r.title}>
            <div className="flex w-full items-end gap-[2px]" style={{ height: height - 18 }}>
              <div className="flex-1 rounded-full" style={{ height: `${(r.a / max) * 100}%`, minHeight: r.a ? 6 : 0, background: "var(--primary)" }} />
              {pair && <div className="flex-1 rounded-full" style={{ height: `${((r.b ?? 0) / max) * 100}%`, minHeight: r.b ? 6 : 0, background: SHADES[2] }} />}
            </div>
            <span className="h-3 text-[10px] leading-3 text-muted-foreground">{i % every === 0 || i === rows.length - 1 ? r.label : ""}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Numbers climb to their value when a tab opens. Text that is not a number shows as it is. */
function CountUp({ value }: { value: React.ReactNode }) {
  const match = typeof value === "string" ? /^([^\d]*)([\d,]+)(.*)$/.exec(value) : null
  const target = match ? Number(match[2].replace(/,/g, "")) : null
  const [shown, setShown] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (target === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 700)
      setShown(t === 1 ? null : Math.round(target * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])
  if (!match || shown === null) return <>{value}</>
  return <>{match[1]}{shown.toLocaleString("en-IN")}{match[3]}</>
}

function smoothPath(p: [number, number][]) {
  let d = `M${p[0][0]},${p[0][1]}`
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[Math.max(0, i - 1)], b = p[i], c = p[i + 1], e = p[Math.min(p.length - 1, i + 2)]
    d += ` C${(b[0] + (c[0] - a[0]) / 6).toFixed(1)},${Math.min(H0, b[1] + (c[1] - a[1]) / 6).toFixed(1)} ${(c[0] - (e[0] - b[0]) / 6).toFixed(1)},${Math.min(H0, c[1] - (e[1] - b[1]) / 6).toFixed(1)} ${c[0]},${c[1]}`
  }
  return d
}
const H0 = 262

/** Smooth area for `a`, dashed line for `b`, with a hover readout. One point falls back to bars. */
export function AreaChart({ rows, labels, format }: { rows: { label: string; a: number; b?: number; title?: string }[]; labels?: [string, string]; format: (n: number) => string }) {
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, "")
  const [hover, setHover] = React.useState<number | null>(null)
  if (rows.length < 2) return <Bars rows={rows} height={150} pair={!!labels} labels={labels} />
  const X0 = 76, X1 = 804, TOP = 14
  const max = Math.max(1, ...rows.map((r) => Math.max(r.a, r.b ?? 0))) * 1.08
  const x = (i: number) => Math.round(X0 + (i * (X1 - X0)) / (rows.length - 1))
  const y = (v: number) => Math.round(H0 - (v / max) * (H0 - TOP))
  const line = smoothPath(rows.map((r, i) => [x(i), y(r.a)]))
  const every = Math.ceil(rows.length / 9)
  const slot = (X1 - X0) / (rows.length - 1)
  const hit = hover === null ? null : rows[hover]
  return (
    <div className="relative">
      <svg viewBox="0 0 820 300" role="img" aria-label={rows.map((r) => `${r.label}: ${r.title ?? format(r.a)}`).join(", ")} className="block h-auto w-full" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--primary)" stopOpacity=".22" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((n) => {
          const v = (max * n) / 3
          return (
            <g key={n}>
              <line x1={X0 - 8} x2={X1 + 6} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeOpacity=".6" />
              <text x={X0 - 14} y={y(v) + 4} textAnchor="end" fontSize="13" fill="var(--muted-foreground)">{format(v)}</text>
            </g>
          )
        })}
        <path d={`${line} L${X1},${H0} L${X0},${H0} Z`} fill={`url(#${id})`} />
        {labels && <path d={smoothPath(rows.map((r, i) => [x(i), y(r.b ?? 0)]))} fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeDasharray="6 6" />}
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2.5" />
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={H0} stroke="var(--muted-foreground)" strokeOpacity=".6" />
            <circle cx={x(hover)} cy={y(rows[hover].a)} r="6" fill="var(--primary)" stroke="var(--card)" strokeWidth="2" />
          </>
        )}
        {rows.map((r, i) => (
          <g key={`${r.label}-${i}`}>
            {(i % every === 0 || i === rows.length - 1) && <text x={x(i)} y="288" textAnchor="middle" fontSize="13" fill="var(--muted-foreground)">{r.label}</text>}
            <rect x={x(i) - slot / 2} y="0" width={slot} height="280" fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
      </svg>
      {hit && (
        <div className="pointer-events-none absolute top-2 -translate-x-1/2 rounded-xl bg-popover px-3 py-2 text-xs whitespace-nowrap shadow-lg" style={{ left: `${Math.min(84, Math.max(16, (x(hover!) / 820) * 100))}%` }}>
          <div className="font-semibold">{hit.label}</div>
          <div>{labels?.[0] ?? "Amount"}: {format(hit.a)}</div>
          {labels && <div className="text-muted-foreground">{labels[1]}: {format(hit.b ?? 0)}</div>}
        </div>
      )}
      {labels && (
        <div className="mt-1 flex justify-end gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><i className="inline-block h-[3px] w-5 bg-primary" /> {labels[0]}</span>
          <span className="flex items-center gap-1.5"><i className="inline-block w-5 border-t-2 border-dashed border-muted-foreground" /> {labels[1]}</span>
        </div>
      )}
    </div>
  )
}

const DONUT = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]

/** Share of a whole. More than five parts: the smallest fold into Other, so no colour is reused. */
export function Donut({ rows }: { rows: { label: string; value: React.ReactNode; n: number }[] }) {
  const sorted = rows.filter((r) => r.n > 0)
  const all = sorted.reduce((a, r) => a + r.n, 0)
  const rest = sorted.slice(4).reduce((a, r) => a + r.n, 0)
  const parts = sorted.length > 5 ? [...sorted.slice(0, 4), { label: "Other", value: `${Math.round((rest / all) * 100)}%`, n: rest }] : sorted
  const C = 2 * Math.PI * 66
  const offsets = parts.reduce<number[]>((acc, r, i) => [...acc, (acc[i] ?? 0) + (r.n / all) * C], [0])
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width="150" height="150" viewBox="0 0 170 170" role="img" aria-label={parts.map((r) => `${r.label}: ${Math.round((r.n / all) * 100)}%`).join(", ")} className="mx-auto shrink-0">
        {parts.map((r, i) => {
          const len = (r.n / all) * C
          return (
            <circle key={r.label} cx="85" cy="85" r="66" fill="none" stroke={DONUT[i]} strokeWidth="26" strokeDasharray={`${Math.max(0.5, len - 2).toFixed(2)} ${(C - len + 2).toFixed(2)}`} strokeDashoffset={(-offsets[i]).toFixed(2)} transform="rotate(-90 85 85)">
              <title>{`${r.label}: ${Math.round((r.n / all) * 100)}%`}</title>
            </circle>
          )
        })}
      </svg>
      <div className="grid min-w-[130px] flex-1 gap-2">
        {parts.map((r, i) => (
          <div key={r.label} className="flex items-center gap-2 text-[13px]">
            <i className="size-2.5 shrink-0 rounded-full" style={{ background: DONUT[i] }} />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MiniTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  )
}
export const th = "border-b px-2 py-1.5 text-left font-semibold text-muted-foreground"
export const td = "border-b border-border/60 px-2 py-[7px]"

export function ActionButton({ onClick, children, busy }: { onClick: () => void | Promise<void>; children: React.ReactNode; busy?: boolean }) {
  const [running, setRunning] = React.useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={running || busy}
      onClick={async () => {
        setRunning(true)
        try {
          await onClick()
        } finally {
          setRunning(false)
        }
      }}
    >
      {running ? "…" : children}
    </Button>
  )
}
