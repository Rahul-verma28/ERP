"use client"

import * as React from "react"
import { Plus } from "lucide-react"
import { tone, type Stage } from "@/lib/crm"
import { formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"

// A board of stage columns. Cards are dragged to another column to move them; the move is shown
// at once and undone if the server refuses it. Works for leads and deals alike.

export function Board<T extends { id: string; stageId: string | null }>({ stages, items, value, onMove, onAdd, card, empty, canMove }: {
  stages: Stage[]
  items: T[]
  /** Amount shown under each column's name */
  value?: (item: T) => number
  onMove: (item: T, stageId: string) => Promise<void>
  onAdd?: (stageId: string) => void
  card: (item: T) => React.ReactNode
  empty?: string
  canMove: boolean
}) {
  const [moved, setMoved] = React.useState<Record<string, string>>({})
  const [over, setOver] = React.useState<string | null>(null)
  const dragging = React.useRef<T | null>(null)
  const stageOf = (i: T) => moved[i.id] ?? i.stageId

  async function drop(stageId: string) {
    const item = dragging.current
    dragging.current = null
    setOver(null)
    if (!item || stageOf(item) === stageId) return
    setMoved((m) => ({ ...m, [item.id]: stageId }))
    try {
      await onMove(item, stageId)
    } catch {
      setMoved((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== item.id)))
    }
  }

  return (
    <div className="-mx-1 overflow-x-auto pb-3">
      <div className="flex min-w-max gap-3 px-1">
        {stages.map((s) => {
          const here = items.filter((i) => stageOf(i) === s.id)
          const sum = value ? here.reduce((t, i) => t + value(i), 0) : 0
          return (
            <section
              key={s.id}
              aria-label={s.name}
              onDragOver={(e) => { if (canMove) { e.preventDefault(); setOver(s.id) } }}
              onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); void drop(s.id) }}
              className={cn("flex w-[290px] shrink-0 flex-col rounded-[20px] border bg-muted/30 transition-colors", over === s.id && "border-primary bg-primary/5")}
            >
              <header className="flex items-start justify-between gap-2 px-3.5 pt-3 pb-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold"><span className={cn("size-2 rounded-full", tone(s.color).dot)} /><span className="truncate">{s.name}</span><span className="rounded-full bg-background px-1.5 text-xs font-medium text-muted-foreground tabular-nums">{here.length}</span></p>
                  {value && <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{formatPaise(sum)}{s.probability != null && ` · ${s.probability}%`}</p>}
                </div>
                {onAdd && <button type="button" onClick={() => onAdd(s.id)} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground" aria-label={`Add to ${s.name}`} title={`Add to ${s.name}`}><Plus className="size-4" /></button>}
              </header>
              <div className={cn("mx-2 mb-2 h-1 rounded-full", tone(s.color).bar)} />
              <div className="grid max-h-[calc(100svh-300px)] min-h-24 content-start gap-2 overflow-y-auto px-2 pb-2">
                {here.map((i) => (
                  <div
                    key={i.id}
                    draggable={canMove}
                    onDragStart={(e) => { dragging.current = i; e.dataTransfer.effectAllowed = "move" }}
                    onDragEnd={() => setOver(null)}
                    className={cn(canMove && "cursor-grab active:cursor-grabbing")}
                  >
                    {card(i)}
                  </div>
                ))}
                {!here.length && <p className="rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{empty ?? "Drop here"}</p>}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
