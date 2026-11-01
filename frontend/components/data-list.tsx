"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns3, Download, Plus, Rows3, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { SearchSelect } from "@/components/search-select"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SearchInput } from "@/components/common"
import { Field } from "@/components/form"
import { ErrorState, NoResults, TableSkeleton } from "@/components/page-states"
import { api, ApiError } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { downloadCsv } from "@/lib/csv"
import { formatNumber } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { useDebounced } from "@/lib/use-list"
import { cn } from "@/lib/utils"

// Phase 0 list page (wireframe 0.2): header with Import / Export / New, preset tabs with
// counts + personal saved views, search, filter chips, Columns and Density, selection with
// a bulk bar ("Select all N matching"), CSV export of everything filtered, cursor pages
// with "Showing 1–25 of N", keyboard and Ctrl+click, cards on phones, and distinct
// first-use / no-results / loading / error states.

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  /** Value for CSV export; columns without it are left out of the file */
  csv?: (row: T) => string | number | null | undefined
  /** Enables header sorting (sorts the rows on the current page) */
  sort?: (row: T) => string | number
  align?: "right"
  className?: string
  /** false = always shown (e.g. the number column) */
  hideable?: boolean
  defaultHidden?: boolean
}

export interface FilterDef {
  key: string
  label: string
  options: { value: string; label: string }[]
  /** Turn the chosen option into API params; default sends `{ [key]: value }` */
  toParams?: (value: string) => Record<string, string>
}

export interface ViewPreset {
  key: string
  label: string
  params: Record<string, string>
  /** Key in the counts response shown next to the label ("All · 64") */
  countKey?: string
}

export interface BulkAction<T> {
  label: string
  run: (rows: T[]) => void | Promise<void>
}

interface SavedView {
  id: string
  name: string
  search: string
  filters: Record<string, string>
  preset: string
}

interface Page<T> {
  data: T[]
  nextCursor: string | null
  total?: number
}

const PAGE_SIZES = [25, 50, 100]
const SELECT_ALL_MAX = 5000

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/** "Date" filter for lists whose API takes `from` / `to` (YYYY-MM-DD, India time). */
export function periodFilter(fyStartMonth = 4, label = "Date"): FilterDef {
  return {
    key: "period",
    label,
    options: [
      { value: "today", label: "Today" },
      { value: "this_month", label: "This month" },
      { value: "last_month", label: "Last month" },
      { value: "last_30", label: "Last 30 days" },
      { value: "this_fy", label: "This financial year" },
    ],
    toParams: (v) => {
      const now = new Date(Date.now() + 330 * 60_000)
      const y = now.getUTCFullYear()
      const m = now.getUTCMonth()
      const utc = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd))
      switch (v) {
        case "today":
          return { from: isoDay(now), to: isoDay(now) }
        case "this_month":
          return { from: isoDay(utc(y, m, 1)), to: isoDay(utc(y, m + 1, 0)) }
        case "last_month":
          return { from: isoDay(utc(y, m - 1, 1)), to: isoDay(utc(y, m, 0)) }
        case "last_30":
          return { from: isoDay(utc(y, m, now.getUTCDate() - 29)), to: isoDay(now) }
        default: {
          const startYear = m + 1 >= fyStartMonth ? y : y - 1
          return { from: isoDay(utc(startYear, fyStartMonth - 1, 1)), to: isoDay(utc(startYear + 1, fyStartMonth - 1, 0)) }
        }
      }
    },
  }
}

/** Per-user list preferences in this browser; never required for the page to work. */
function useStored<T>(key: string | null, fallback: T) {
  const [state, setState] = React.useState<{ key: string | null; value: T }>({ key: null, value: fallback })
  let value = state.value
  if (state.key !== key) {
    // Key changed (e.g. the signed-in user loaded): read once, React re-renders with it
    value = fallback
    if (key && typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(key)
        const parsed = raw ? (JSON.parse(raw) as T) : null
        if (parsed) value = Array.isArray(fallback) ? parsed : { ...fallback, ...parsed }
      } catch {
        // private window or blocked storage: keep the default
      }
    }
    setState({ key, value })
  }
  const update = React.useCallback(
    (next: T) => {
      setState({ key, value: next })
      if (!key) return
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // ignore
      }
    },
    [key]
  )
  return [value, update] as const
}

export interface ListHeader {
  /** e.g. "Sales › Invoices" */
  breadcrumb?: string
  title: string
  description?: string
  /** Buttons left of Export (e.g. Import) */
  actions?: React.ReactNode
  /** The main action, right of Export (e.g. + New invoice) */
  primary?: React.ReactNode
}

export function DataList<T extends { id: string }>({
  id,
  path,
  header,
  columns,
  searchPlaceholder = "Search…",
  filters = [],
  presets = [],
  countsPath,
  rowHref,
  bulkActions = [],
  exportName,
  emptyState,
  params: baseParams = {},
}: {
  /** Stable id for stored preferences, e.g. "invoices" */
  id: string
  path: string
  header: ListHeader
  columns: Column<T>[]
  searchPlaceholder?: string
  filters?: FilterDef[]
  presets?: ViewPreset[]
  /** Endpoint returning { [countKey]: number } for the preset tabs */
  countsPath?: string
  rowHref?: (row: T) => string
  bulkActions?: BulkAction<T>[]
  /** File name stem for CSV export; omit to hide Export */
  exportName?: string
  /** Shown when there is no data at all (no search, no filters) */
  emptyState: React.ReactNode
  params?: Record<string, string | undefined>
}) {
  const router = useRouter()
  const { me } = useAuth()
  const counts = useApi<Record<string, number>>(countsPath ?? null)
  const storeKey = me ? `ahead:list:${id}:${me.user.id}` : null
  const [prefs, setPrefs] = useStored<{ hidden: string[]; dense: boolean; pageSize: number }>(storeKey && `${storeKey}:prefs`, {
    hidden: columns.filter((c) => c.defaultHidden).map((c) => c.key),
    dense: false,
    pageSize: 25,
  })
  const [views, setViews] = useStored<SavedView[]>(storeKey && `${storeKey}:views`, [])

  const [search, setSearch] = React.useState("")
  const q = useDebounced(search.trim())
  const [preset, setPreset] = React.useState(presets[0]?.key ?? "")
  const [filterValues, setFilterValues] = React.useState<Record<string, string>>({})
  const [activeView, setActiveView] = React.useState<string | null>(null)
  const [sort, setSort] = React.useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [state, setState] = React.useState<{ key: string | null; rows: T[]; next: string | null; total: number | null; error: unknown }>({ key: null, rows: [], next: null, total: null, error: null })
  const [saveOpen, setSaveOpen] = React.useState(false)
  const [reloadTick, setReloadTick] = React.useState(0)
  const [selectingAll, setSelectingAll] = React.useState(false)

  const presetParams = presets.find((p) => p.key === preset)?.params ?? {}
  const params: Record<string, string> = {}
  const fromFilters = Object.fromEntries(Object.entries(filterValues).flatMap(([k, v]) => Object.entries(filters.find((f) => f.key === k)?.toParams?.(v) ?? { [k]: v })))
  for (const [k, v] of Object.entries({ ...baseParams, ...presetParams, ...fromFilters, q })) if (v) params[k] = v
  const paramsJson = JSON.stringify(params)
  const paramsKey = paramsJson + prefs.pageSize

  // Cursor pages (cursors[i] loads page i) and the selection belong to one set of
  // filters: new filters start again at page 1 with nothing selected
  const [paging, setPaging] = React.useState<{ key: string; cursors: (string | undefined)[]; index: number }>({ key: paramsKey, cursors: [undefined], index: 0 })
  const page = paging.key === paramsKey ? paging : { key: paramsKey, cursors: [undefined], index: 0 }
  const pageIndex = page.index
  const [selection, setSelection] = React.useState<{ key: string; rows: Map<string, T> }>({ key: paramsKey, rows: new Map() })
  const selected = selection.key === paramsKey ? selection.rows : new Map<string, T>()
  const setSelected = (fn: (s: Map<string, T>) => Map<string, T>) => setSelection({ key: paramsKey, rows: fn(selected) })
  const setPageIndex = (index: number) => setPaging({ ...page, index })

  const fetchPage = React.useCallback(
    (cursor: string | undefined, limit: number, withTotal = false) => {
      const search = new URLSearchParams({ ...(JSON.parse(paramsJson) as Record<string, string>), limit: String(limit), ...(cursor ? { cursor } : {}), ...(withTotal ? { withTotal: "1" } : {}) })
      return api.get<Page<T>>(`${path}?${search}`)
    },
    [paramsJson, path]
  )

  const cursor = page.cursors[pageIndex]
  const pageSize = prefs.pageSize
  const loadKey = `${paramsKey}|${pageIndex}|${cursor ?? ""}|${reloadTick}`
  React.useEffect(() => {
    let cancelled = false
    fetchPage(cursor, pageSize, true)
      .then((p) => !cancelled && setState({ key: loadKey, rows: p.data, next: p.nextCursor, total: p.total ?? null, error: null }))
      .catch((error) => !cancelled && setState((s) => ({ ...s, key: loadKey, error })))
    return () => {
      cancelled = true
    }
  }, [fetchPage, cursor, pageSize, loadKey])

  const loading = state.key !== loadKey
  const hasFilters = !!q || Object.keys(filterValues).length > 0
  const visibleColumns = columns.filter((c) => c.hideable === false || !prefs.hidden.includes(c.key))
  const sortCol = sort ? columns.find((c) => c.key === sort.key) : undefined
  const rows =
    sort && sortCol?.sort
      ? [...state.rows].sort((a, b) => {
          const x = sortCol.sort!(a)
          const y = sortCol.sort!(b)
          return x > y ? sort.dir : x < y ? -sort.dir : 0
        })
      : state.rows
  const total = state.total
  const from = pageIndex * pageSize + 1
  const to = pageIndex * pageSize + rows.length

  const filterLabels = [
    ...(q ? [`Search “${q}”`] : []),
    ...Object.entries(filterValues).map(([k, v]) => {
      const f = filters.find((x) => x.key === k)
      return `${f?.label ?? k}: ${f?.options.find((o) => o.value === v)?.label ?? v}`
    }),
  ]

  const clearAll = () => {
    setSearch("")
    setFilterValues({})
    setActiveView(null)
  }
  const goNext = () => {
    if (!state.next) return
    setPaging({ key: paramsKey, cursors: [...page.cursors.slice(0, pageIndex + 1), state.next], index: pageIndex + 1 })
  }
  const open = (row: T, e?: React.MouseEvent | React.KeyboardEvent) => {
    if (!rowHref) return
    const href = rowHref(row)
    if (e && (e.ctrlKey || e.metaKey)) window.open(href, "_blank", "noopener")
    else router.push(href)
  }
  const onRowKey = (e: React.KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.key === "Enter") open(row, e)
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const next = (e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLElement | null
      next?.focus()
    }
  }

  const pageAllSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleRow = (row: T, on: boolean) =>
    setSelected((s) => {
      const m = new Map(s)
      if (on) m.set(row.id, row)
      else m.delete(row.id)
      return m
    })
  const togglePage = (on: boolean) =>
    setSelected((s) => {
      const m = new Map(s)
      for (const r of rows) {
        if (on) m.set(r.id, r)
        else m.delete(r.id)
      }
      return m
    })

  /** Every row matching the current filters (export, "Select all N matching"). */
  const fetchAll = async () => {
    const all: T[] = []
    let next: string | undefined
    do {
      const p = await fetchPage(next, 100)
      all.push(...p.data)
      next = p.nextCursor ?? undefined
    } while (next && all.length < SELECT_ALL_MAX)
    return { all, capped: !!next }
  }
  const selectAllMatching = async () => {
    setSelectingAll(true)
    try {
      const { all, capped } = await fetchAll()
      setSelected(() => new Map(all.map((r) => [r.id, r])))
      if (capped) toast.message(`Selected the first ${formatNumber(SELECT_ALL_MAX)}`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't select all rows")
    } finally {
      setSelectingAll(false)
    }
  }

  const csvColumns = visibleColumns.filter((c) => c.csv)
  const writeCsv = (data: T[]) =>
    downloadCsv(`${exportName}-${new Date().toISOString().slice(0, 10)}.csv`, [csvColumns.map((c) => c.header), ...data.map((r) => csvColumns.map((c) => c.csv!(r) ?? ""))])
  const exportFiltered = async () => {
    try {
      const { all, capped } = await fetchAll()
      writeCsv(all)
      toast.success(`Exported ${formatNumber(all.length)} rows${capped ? ` (first ${formatNumber(SELECT_ALL_MAX)})` : ""}`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Export failed")
    }
  }

  const applyView = (v: SavedView) => {
    setSearch(v.search)
    setFilterValues(v.filters)
    if (v.preset) setPreset(v.preset)
    setActiveView(v.id)
  }
  const tabClass = (on: boolean) => cn("shrink-0 border-b-2 border-transparent px-1 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground", on && "border-primary text-foreground")

  return (
    <div className="grid gap-3.5">
      {/* Header: title left, Import · Export · New right */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {header.breadcrumb && <p className="text-xs text-muted-foreground">{header.breadcrumb}</p>}
          <h1 className="text-[22px] font-bold tracking-tight">{header.title}</h1>
          {header.description && <p className="mt-0.5 text-sm text-muted-foreground">{header.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {header.actions}
          {exportName && (
            <Button variant="outline" onClick={() => void exportFiltered()}>
              <Download /> Export
            </Button>
          )}
          {header.primary}
        </div>
      </div>

      {/* Preset tabs with counts, saved views, + Save view */}
      {(presets.length > 0 || views.length > 0) && (
        <div className="flex gap-5 overflow-x-auto border-b" role="tablist" aria-label="Views">
          {presets.map((p) => {
            const n = p.countKey && counts.data ? (counts.data[p.countKey] ?? 0) : undefined
            return (
              <button
                key={p.key}
                role="tab"
                aria-selected={preset === p.key && !activeView}
                onClick={() => {
                  setPreset(p.key)
                  setActiveView(null)
                }}
                className={tabClass(preset === p.key && !activeView)}
              >
                {p.label}
                {n !== undefined && <span className="tabular-nums"> · {formatNumber(n)}</span>}
              </button>
            )
          })}
          {views.map((v) => (
            <span key={v.id} className={cn("flex shrink-0 items-center gap-1", tabClass(activeView === v.id))}>
              <button role="tab" aria-selected={activeView === v.id} onClick={() => applyView(v)}>
                My view: {v.name}
              </button>
              <button aria-label={`Delete view ${v.name}`} className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setViews(views.filter((x) => x.id !== v.id))}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          <button className={tabClass(false)} onClick={() => setSaveOpen(true)}>
            + Save view
          </button>
        </div>
      )}

      {/* Search · chips · + Filter · Clear all ………… Columns · Density */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder={searchPlaceholder} className="w-full sm:w-80" />
        {Object.entries(filterValues).map(([k, v]) => {
          const f = filters.find((x) => x.key === k)
          return (
            <span key={k} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-primary/25 bg-accent pr-1 pl-2.5 text-xs font-semibold text-accent-foreground">
              {f?.label}: {f?.options.find((o) => o.value === v)?.label ?? v}
              <button
                aria-label={`Remove ${f?.label} filter`}
                className="rounded-full p-0.5 hover:bg-background"
                onClick={() => {
                  const { [k]: _removed, ...rest } = filterValues
                  void _removed
                  setFilterValues(rest)
                  setActiveView(null)
                }}
              >
                <X className="size-3" />
              </button>
            </span>
          )
        })}
        {filters.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-7 border-dashed" />}>
              <Plus /> Filter
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {filters.map((f) => (
                <DropdownMenuSub key={f.key}>
                  <DropdownMenuSubTrigger>{f.label}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={filterValues[f.key] ?? ""}
                      onValueChange={(val) => {
                        setFilterValues({ ...filterValues, [f.key]: String(val) })
                        setActiveView(null)
                      }}
                    >
                      {f.options.map((o) => (
                        <DropdownMenuRadioItem key={o.value} value={o.value}>
                          {o.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {hasFilters && (
          <button className="text-xs font-semibold text-primary hover:underline" onClick={clearAll}>
            Clear all
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Columns3 /> Columns
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                {columns
                  .filter((c) => c.hideable !== false)
                  .map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.key}
                      checked={!prefs.hidden.includes(c.key)}
                      onCheckedChange={(on) => setPrefs({ ...prefs, hidden: on ? prefs.hidden.filter((k) => k !== c.key) : [...prefs.hidden, c.key] })}
                    >
                      {c.header}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Rows3 /> Density
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuRadioGroup value={prefs.dense ? "compact" : "comfortable"} onValueChange={(v) => setPrefs({ ...prefs, dense: v === "compact" })}>
                <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-foreground px-3.5 py-2.5 text-background">
          <span className="text-sm font-semibold">{formatNumber(selected.size)} selected</span>
          {total !== null && selected.size < total && (
            <button className="text-xs text-background/75 hover:text-background hover:underline" onClick={() => void selectAllMatching()} disabled={selectingAll}>
              {selectingAll ? "Selecting…" : `Select all ${formatNumber(total)} matching`}
            </button>
          )}
          <button className="text-xs text-background/75 hover:text-background hover:underline" onClick={() => setSelected(() => new Map())}>
            Clear
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            {bulkActions.map((a) => (
              <Button key={a.label} size="sm" variant="outline" className="text-foreground" onClick={() => a.run([...selected.values()])}>
                {a.label}
              </Button>
            ))}
            {exportName && (
              <Button size="sm" variant="outline" className="text-foreground" onClick={() => writeCsv([...selected.values()])}>
                Export
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        {loading && state.key === null ? (
          <TableSkeleton columns={Math.min(visibleColumns.length, 6)} />
        ) : state.error ? (
          <ErrorState error={state.error} onRetry={() => setReloadTick((t) => t + 1)} />
        ) : rows.length === 0 && !loading ? (
          hasFilters ? <NoResults filters={filterLabels} onClear={clearAll} /> : emptyState
        ) : (
          <div className={cn("transition-opacity", loading && "pointer-events-none opacity-60")}>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader className="bg-background">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10 pl-4">
                      <Checkbox checked={pageAllSelected} onCheckedChange={(on) => togglePage(!!on)} aria-label="Select all rows on this page" />
                    </TableHead>
                    {visibleColumns.map((c) => (
                      <TableHead key={c.key} className={cn("text-xs font-semibold text-muted-foreground", c.align === "right" && "text-right", c.className)}>
                        {c.sort ? (
                          <button
                            className={cn("inline-flex items-center gap-1 hover:text-foreground", c.align === "right" && "flex-row-reverse")}
                            onClick={() => setSort(sort?.key === c.key ? (sort.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })}
                            aria-label={`Sort by ${c.header}`}
                          >
                            {c.header}
                            {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                          </button>
                        ) : (
                          c.header
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.id}
                      tabIndex={rowHref ? 0 : undefined}
                      data-state={selected.has(r.id) ? "selected" : undefined}
                      className={cn(rowHref && "cursor-pointer focus-visible:bg-muted focus-visible:outline-none")}
                      onClick={(e) => open(r, e)}
                      onKeyDown={(e) => onRowKey(e, r)}
                    >
                      <TableCell className={cn("pl-4", prefs.dense ? "py-1.5" : "py-3")} onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.has(r.id)} onCheckedChange={(on) => toggleRow(r, !!on)} aria-label="Select row" />
                      </TableCell>
                      {visibleColumns.map((c) => (
                        <TableCell key={c.key} className={cn(c.align === "right" && "text-right tabular-nums", prefs.dense ? "py-1.5" : "py-3", c.className)}>
                          {c.cell(r)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* Cards on phones */}
            <ul className="divide-y md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="flex gap-3 p-4">
                  <Checkbox checked={selected.has(r.id)} onCheckedChange={(on) => toggleRow(r, !!on)} aria-label="Select row" className="mt-1" />
                  <button className="grid min-w-0 flex-1 gap-1 text-left" onClick={(e) => open(r, e)}>
                    <span className="font-medium">{visibleColumns[0]?.cell(r)}</span>
                    {visibleColumns.slice(1).map((c) => (
                      <span key={c.key} className="flex justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">{c.header}</span>
                        <span className="min-w-0 truncate text-right">{c.cell(r)}</span>
                      </span>
                    ))}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {!state.error && (rows.length > 0 || pageIndex > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="flex flex-wrap items-center gap-1">
            Showing {formatNumber(from)}–{formatNumber(to)}
            {total !== null && <> of {formatNumber(total)}</>}
            <span aria-hidden> · </span>
            <span className="inline-flex items-center gap-1">
              Rows per page
              <SearchSelect value={String(prefs.pageSize)} onChange={(v) => setPrefs({ ...prefs, pageSize: Number(v) })} aria-label="Rows per page" options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))} className="h-7 w-auto gap-1 border-0 bg-transparent px-1 font-medium" />
            </span>
          </span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={pageIndex === 0 || loading} onClick={() => setPageIndex(pageIndex - 1)}>
              <ArrowLeft /> Previous
            </Button>
            <Button variant="outline" disabled={!state.next || loading} onClick={goNext}>
              Next <ArrowRight />
            </Button>
          </div>
        </div>
      )}

      <SaveViewDialog
        key={saveOpen ? "open" : "closed"}
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        taken={views.map((v) => v.name.toLowerCase())}
        onSave={(name) => {
          const v: SavedView = { id: `${Date.now()}`, name, search: search.trim(), filters: filterValues, preset }
          setViews([...views, v])
          setActiveView(v.id)
          setSaveOpen(false)
          toast.success(`View “${name}” saved`)
        }}
      />
    </div>
  )
}

/** Link-styled header action (Import, New …) that keeps the button look. */
export function HeaderLink({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <Link href={href} className={cn("inline-flex h-10 items-center gap-1.5 rounded-lg border px-4 text-sm font-semibold [&_svg]:size-4", primary ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "border-input bg-card hover:bg-muted")}>
      {children}
    </Link>
  )
}

function SaveViewDialog({ open, onClose, onSave, taken }: { open: boolean; onClose: () => void; onSave: (name: string) => void; taken: string[] }) {
  const [name, setName] = React.useState("")
  const [touched, setTouched] = React.useState(false)
  const trimmed = name.trim()
  const error = trimmed.length < 2 ? "Use at least 2 characters" : trimmed.length > 30 ? "Keep it under 30 characters" : taken.includes(trimmed.toLowerCase()) ? "You already have a view with this name" : null
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setTouched(true)
            if (!error) onSave(trimmed)
          }}
        >
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>Keeps the current tab, search and filters as a tab of its own. Only you see it, on this device.</DialogDescription>
          </DialogHeader>
          <Field label="View name" required error={touched ? error : null}>
            <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} autoFocus placeholder="e.g. This month" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save view</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
