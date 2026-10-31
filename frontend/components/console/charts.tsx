"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"

// Small charts for Analytics (blueprint Phase F), drawn as SVG like the Overview's growth
// chart: one or two series of bars per month, and horizontal bars for shares.

export interface BarSeries {
  label: string
  values: number[]
  /** Tailwind fill class, e.g. "fill-primary" */
  fill: string
  /** Legend swatch class, e.g. "bg-primary" */
  swatch: string
}

export function MonthBars({ labels, series, format = (v) => String(v), title }: { labels: string[]; series: BarSeries[]; format?: (v: number) => string; title: string }) {
  const W = 600
  const H = 170
  const PAD = { l: 8, r: 8, t: 18, b: 22 }
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const slot = (W - PAD.l - PAD.r) / labels.length
  const gap = Math.min(10, slot * 0.25)
  const bw = Math.max(4, (slot - gap) / series.length)
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max)
  const showValues = labels.length * series.length <= 16
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full" role="img" aria-label={`${title}: ${labels.map((l, i) => `${l} ${series.map((s) => format(s.values[i])).join(" / ")}`).join(", ")}`}>
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={1} />
        {labels.map((label, i) => (
          <g key={label + i}>
            {series.map((s, j) => {
              const v = s.values[i] ?? 0
              const x = PAD.l + i * slot + gap / 2 + j * bw
              return (
                <g key={s.label}>
                  <rect x={x} y={y(v)} width={Math.max(1, bw - 2)} height={Math.max(v ? 2 : 0, y(0) - y(v))} rx={3} className={s.fill}>
                    <title>{`${label} · ${s.label}: ${format(v)}`}</title>
                  </rect>
                  {showValues && v > 0 && <text x={x + (bw - 2) / 2} y={y(v) - 4} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">{format(v)}</text>}
                </g>
              )
            })}
            <text x={PAD.l + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{label}</text>
          </g>
        ))}
      </svg>
      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-sm", s.swatch)} /> {s.label}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Horizontal share bars; each row can open the list behind it. */
export function ShareBars({ rows, format = (v) => String(v), empty = "Nothing yet." }: { rows: { key: string; label: string; value: number; percent?: number; href?: string }[]; format?: (v: number) => string; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (!rows.length || rows.every((r) => !r.value)) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="grid gap-3">
      {rows.map((r) => {
        const head = (
          <div className="flex justify-between gap-2 text-[13px]">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{format(r.value)}{r.percent !== undefined ? ` · ${r.percent}%` : ""}</span>
          </div>
        )
        return (
          <div key={r.key} className="grid gap-1">
            {r.href ? <Link href={r.href} className="hover:underline">{head}</Link> : head}
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${((r.percent ?? (r.value / max) * 100))}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
