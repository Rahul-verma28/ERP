"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { todayInIndia } from "@contracts/validation"
import { tone } from "@/lib/tones"
import { cn } from "@/lib/utils"

// A month grid with bars for events, holidays and leave. Items carry their own colour.

export interface CalItem { id: string; title: string; from: string; to?: string | null; color: string; sub?: string | null; striped?: boolean }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const iso = (d: Date) => d.toISOString().slice(0, 10)

export function MonthCalendar({ items, month, onMonth, onPick, onDay, legend }: { items: CalItem[]; month: string; onMonth: (m: string) => void; onPick?: (id: string) => void; onDay?: (date: string) => void; legend?: React.ReactNode }) {
  const today = todayInIndia()
  const first = new Date(`${month}-01T00:00:00Z`)
  const start = new Date(first)
  start.setUTCDate(1 - first.getUTCDay())
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); return iso(d) })
  const weeks = cells[35].slice(0, 7) === month ? 6 : 5
  const go = (n: number) => { const d = new Date(first); d.setUTCMonth(d.getUTCMonth() + n); onMonth(iso(d).slice(0, 7)) }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => go(-1)}><ChevronLeft /></Button>
        <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => go(1)}><ChevronRight /></Button>
        <Button variant="ghost" size="sm" onClick={() => onMonth(today.slice(0, 7))}>Today</Button>
        <h3 className="mx-auto text-lg font-semibold">{MONTHS[first.getUTCMonth()]} {first.getUTCFullYear()}</h3>
        {legend}
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <div className="grid min-w-[640px] grid-cols-7">
          {WEEK.map((w) => <div key={w} className="border-b bg-muted/40 px-2 py-2 text-center text-xs font-semibold text-muted-foreground">{w}</div>)}
          {cells.slice(0, weeks * 7).map((d, i) => {
            const here = items.filter((x) => x.from.slice(0, 10) <= d && (x.to ?? x.from).slice(0, 10) >= d)
            const out = d.slice(0, 7) !== month
            return (
              <div key={d} onClick={() => onDay?.(d)} className={cn("min-h-24 border-b p-1.5", i % 7 !== 6 && "border-r", out && "bg-muted/20", d === today && "bg-primary/5", onDay && "cursor-pointer hover:bg-muted/40")}>
                <p className={cn("mb-1 text-right text-xs", out ? "text-muted-foreground/50" : "text-muted-foreground", d === today && "font-bold text-primary")}>{Number(d.slice(8))}</p>
                <div className="grid gap-0.5">
                  {here.slice(0, 3).map((x) => (
                    <button key={x.id} type="button" title={[x.title, x.sub].filter(Boolean).join(" · ")} onClick={(e) => { e.stopPropagation(); onPick?.(x.id) }}
                      className={cn("truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium text-white", tone(x.color).dot, x.striped && "opacity-60")}>
                      {x.title}
                    </button>
                  ))}
                  {here.length > 3 && <span className="px-1 text-[11px] text-muted-foreground">+{here.length - 3} more</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
