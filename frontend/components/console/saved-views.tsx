"use client"

import * as React from "react"
import { toast } from "sonner"
import { Bookmark, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"
import type { SavedView } from "@/lib/console"
import { cn } from "@/lib/utils"

// Saved views on the Businesses list (blueprint Phase G): name the filters you use often and
// open them with one click. Each person has their own.

type Filters = SavedView["filters"]
const clean = (f: Filters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b))) as Filters
const same = (a: Filters, b: Filters) => JSON.stringify(clean(a)) === JSON.stringify(clean(b))

export function SavedViews({ current, onApply }: { current: Filters; onApply: (f: Filters) => void }) {
  const { data, setData } = useApi<{ data: SavedView[] }>("/console/views")
  const [naming, setNaming] = React.useState(false)
  const [name, setName] = React.useState("")
  const views = data?.data ?? []
  const active = views.find((v) => same(v.filters, current))
  const hasFilters = Object.keys(clean(current)).length > 0

  async function save(next: SavedView[], message: string) {
    try {
      setData(await api.put<{ data: SavedView[] }>("/console/views", { views: next }))
      toast.success(message)
      return true
    } catch (e) {
      toast.error(errorMessage(e))
      return false
    }
  }
  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    if (await save([...views, { id: `v${Date.now().toString(36)}`, name: name.trim(), filters: clean(current) }], "View saved")) {
      setNaming(false)
      setName("")
    }
  }

  if (!data) return null
  const chip = (on: boolean) => cn("inline-flex h-7 items-center rounded-full border text-[13px] transition-colors", on ? "border-primary bg-accent font-medium text-accent-foreground" : "bg-card hover:border-primary/40")
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Saved views">
      <Bookmark className="size-4 text-muted-foreground" aria-hidden />
      <button type="button" onClick={() => onApply({})} className={cn(chip(!hasFilters), "px-3")}>All businesses</button>
      {views.map((v) => (
        <span key={v.id} className={chip(active?.id === v.id)}>
          <button type="button" onClick={() => onApply(v.filters)} className="h-full pr-1 pl-3">{v.name}</button>
          <button type="button" onClick={() => save(views.filter((x) => x.id !== v.id), "View removed")} className="mr-0.5 grid size-6 place-items-center rounded-full text-muted-foreground opacity-60 hover:opacity-100 focus-visible:opacity-100" aria-label={`Remove view ${v.name}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      {naming ? (
        <form onSubmit={add} className="flex items-center gap-1.5">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name this view" className="h-7 w-44 text-[13px]" aria-label="View name" />
          <Button type="submit" size="sm" className="h-7" disabled={!name.trim()}>Save</Button>
          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setNaming(false)}>Cancel</Button>
        </form>
      ) : (
        hasFilters &&
        !active &&
        views.length < 12 && (
          <Button type="button" size="sm" variant="ghost" className="h-7 text-[13px]" onClick={() => setNaming(true)}>
            <Plus /> Save this view
          </Button>
        )
      )}
    </div>
  )
}
