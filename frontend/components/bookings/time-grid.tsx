"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { dayOf, isOpen, timeOf, type Appointment } from "@/lib/bookings"

// A day or week grid of hours. Columns are days (week) or people (day). Appointments sit at their
// time; clicking empty space offers a new one at that time and in that column.

const ROW = 48 // px per hour
const TINT: Record<string, string> = {
  blue: "border-blue-400 bg-blue-50 text-blue-950 dark:bg-blue-500/15 dark:text-blue-100",
  emerald: "border-emerald-400 bg-emerald-50 text-emerald-950 dark:bg-emerald-500/15 dark:text-emerald-100",
  violet: "border-violet-400 bg-violet-50 text-violet-950 dark:bg-violet-500/15 dark:text-violet-100",
  amber: "border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-500/15 dark:text-amber-100",
  rose: "border-rose-400 bg-rose-50 text-rose-950 dark:bg-rose-500/15 dark:text-rose-100",
  cyan: "border-cyan-400 bg-cyan-50 text-cyan-950 dark:bg-cyan-500/15 dark:text-cyan-100",
  slate: "border-slate-400 bg-slate-50 text-slate-900 dark:bg-slate-500/15 dark:text-slate-100",
}

export interface GridColumn { key: string; label: string; sub?: string; date: string; staffId?: string; today?: boolean; off?: boolean }

const minutesOf = (iso: string) => { const d = new Date(new Date(iso).getTime() + 330 * 60_000); return d.getUTCHours() * 60 + d.getUTCMinutes() }

export function TimeGrid({ columns, items, startHour = 8, endHour = 21, columnOf, onSlot, onPick }: {
  columns: GridColumn[]
  items: Appointment[]
  startHour?: number
  endHour?: number
  /** Which column an appointment belongs to */
  columnOf: (a: Appointment) => string
  onSlot?: (col: GridColumn, minutes: number) => void
  onPick: (a: Appointment) => void
}) {
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const nowMin = minutesOf(new Date().toISOString())
  return (
    <div className="ui-surface overflow-x-auto">
      <div className="grid min-w-[720px]" style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(120px, 1fr))` }}>
        <div className="sticky top-0 z-10 border-b bg-card" />
        {columns.map((c) => (
          <div key={c.key} className={cn("sticky top-0 z-10 border-b border-l bg-card px-2 py-2 text-center", c.today && "bg-primary/5")}>
            <p className={cn("truncate text-sm font-semibold", c.today && "text-primary")}>{c.label}</p>
            {c.sub && <p className="truncate text-[11px] text-muted-foreground">{c.sub}</p>}
          </div>
        ))}
        <div className="relative">
          {hours.map((h) => <div key={h} className="border-b pr-2 text-right text-[11px] text-muted-foreground" style={{ height: ROW }}>{h % 12 || 12}{h < 12 ? " am" : " pm"}</div>)}
        </div>
        {columns.map((c) => {
          const here = items.filter((a) => columnOf(a) === c.key && dayOf(a.startAt) === c.date)
          return (
            <div key={c.key} className={cn("relative border-l", c.off && "bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(148,163,184,0.12)_6px,rgba(148,163,184,0.12)_12px)]")}>
              {hours.map((h) => (
                <div key={h} className="grid border-b" style={{ height: ROW }}>
                  {[0, 30].map((m) => (
                    <button key={m} type="button" disabled={!onSlot} aria-label={`New at ${h}:${m || "00"}`} onClick={() => onSlot?.(c, h * 60 + m)} className={cn("h-full w-full", onSlot && "hover:bg-primary/5", m === 30 && "border-t border-dashed border-border/60")} />
                  ))}
                </div>
              ))}
              {c.today && nowMin >= startHour * 60 && nowMin <= endHour * 60 && <span className="pointer-events-none absolute right-0 left-0 z-[5] border-t-2 border-rose-500" style={{ top: ((nowMin - startHour * 60) / 60) * ROW }} />}
              {here.map((a) => {
                const s = Math.max(minutesOf(a.startAt), startHour * 60)
                const e = Math.min(dayOf(a.endAt) === c.date ? minutesOf(a.endAt) : 1440, endHour * 60)
                if (e <= startHour * 60 || s >= endHour * 60) return null
                const top = ((s - startHour * 60) / 60) * ROW
                const height = Math.max(((e - s) / 60) * ROW - 2, 20)
                return (
                  <button key={a.id} type="button" onClick={() => onPick(a)} title={`${timeOf(a.startAt)} ${a.title}`}
                    className={cn("absolute right-1 left-1 z-[6] overflow-hidden rounded-lg border-l-4 px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm", TINT[a.color] ?? TINT.blue, !isOpen(a.status) && "opacity-60", a.status === "cancelled" && "line-through", a.status === "scheduled" && "border-dashed")}
                    style={{ top, height }}>
                    <span className="block font-semibold">{timeOf(a.startAt)} {a.customerName ?? a.title}</span>
                    {height > 32 && <span className="block truncate opacity-80">{a.item?.name ?? a.title}{a.resource ? ` · ${a.resource.name}` : ""}</span>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
