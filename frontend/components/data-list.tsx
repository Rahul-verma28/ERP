"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Columns3, Download, LayoutGrid, List, ListFilter, MoreHorizontal } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { SearchSelect } from "@/components/search-select"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SearchInput } from "@/components/common"
import { ErrorState, NoResults, TableSkeleton } from "@/components/page-states"
import { api, ApiError } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { downloadCsv } from "@/lib/csv"
import { formatNumber } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { useDebounced } from "@/lib/use-list"
import { cn } from "@/lib/utils"

// The one table of the product: search, icons for table or cards and columns, a Filters panel,
// CSV export under the menu, numbered pages with rows per page, cards on phones, and distinct
// first-use, no-results, loading and error states.

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

interface Page<T> {
  data: T[]
  nextCursor: string | null
  total?: number
}

const PAGE_SIZES = [10, 20, 50, 100] as const
const DEFAULT_PAGE_SIZE = 20
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
  /** Buttons left of the main action */
  actions?: React.ReactNode
  /** The main action (e.g. + New invoice) */
  primary?: React.ReactNode
  /** Less common actions, under the three-dot menu */
  more?: { label: string; href: string }[]
}

export interface ListQuery {
  params: Record<string, string>
  limit: number
  cursor?: string
}
export type ListLoader<T> = (query: ListQuery) => Promise<Page<T>>

/** For short lists the API returns whole: search and pages happen in the browser. */
export function localList<T>(get: () => Promise<T[]>, match: (row: T, q: string) => boolean): ListLoader<T> {
  return async ({ params, limit, cursor }) => {
    const q = (params.q ?? "").toLowerCase()
    const all = (await get()).filter((r) => !q || match(r, q))
    const start = Number(cursor ?? 0)
    return { data: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null, total: all.length }
  }
}

/** 1 2 3 … 9: the first, the last and the ones around where you are */
function pageNumbers(current: number, last: number): (number | "gap")[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i)
  const near = [...new Set([0, current - 1, current, current + 1, last - 1])].filter((n) => n >= 0 && n < last).sort((a, b) => a - b)
  return near.flatMap((n, i) => (i > 0 && n - near[i - 1] > 1 ? (["gap", n] as const) : [n]))
}

const pagerButton = "grid size-9 place-items-center rounded-xl text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"

export function DataList<T extends { id: string }>({
  id,
  path,
  load,
  header,
  columns,
  searchPlaceholder = "Search…",
  filters = [],
  presets = [],
  presetLabel = "Status",
  defaultPreset,
  countsPath,
  rowHref,
  rowClick,
  bulkActions = [],
  exportName,
  emptyState,
  params: baseParams = {},
  defaultFilters,
  noSearch,
  summary,
}: {
  /** Stable id for stored preferences, e.g. "invoices" */
  id: string
  /** The API list to read; or give `load` instead */
  path?: string
  load?: ListLoader<T>
  header: ListHeader
  columns: Column<T>[]
  searchPlaceholder?: string
  filters?: FilterDef[]
  /** Fixed choices, offered as the first filter */
  presets?: ViewPreset[]
  /** Name of that first filter */
  presetLabel?: string
  /** The choice to open on, e.g. from a link; default the first */
  defaultPreset?: string
  /** Endpoint returning { [countKey]: number } shown next to the preset choices */
  countsPath?: string
  rowHref?: (row: T) => string
  /** Instead of rowHref: what opening a row does, e.g. an edit dialog */
  rowClick?: (row: T) => void
  bulkActions?: BulkAction<T>[]
  /** File name stem for CSV export; omit to hide Export */
  exportName?: string
  /** Shown when there is no data at all (no search, no filters) */
  emptyState: React.ReactNode
  params?: Record<string, string | undefined>
  /** Filters already on when the list opens, e.g. this month */
  defaultFilters?: Record<string, string>
  /** The list cannot be searched */
  noSearch?: boolean
  /** A figure from the response, shown beside the search box */
  summary?: (response: Record<string, unknown>) => React.ReactNode
}) {
  const router = useRouter()
  const { me } = useAuth()
  const counts = useApi<Record<string, number>>(countsPath ?? null)
  const storeKey = me ? `ahead:list:${id}:${me.user.id}` : null
  const [prefs, setPrefs] = useStored<{ hidden: string[]; pageSize: number; view?: "table" | "cards" }>(storeKey && `${storeKey}:prefs`, {
    hidden: columns.filter((c) => c.defaultHidden).map((c) => c.key),
    pageSize: DEFAULT_PAGE_SIZE,
  })

  const [search, setSearch] = React.useState("")
  const q = useDebounced(search.trim())
  const firstPreset = presets[0]?.key ?? ""
  const [preset, setPreset] = React.useState(defaultPreset ?? firstPreset)
  const [filterValues, setFilterValues] = React.useState<Record<string, string>>(defaultFilters ?? {})
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<{ preset: string; values: Record<string, string> }>({ preset: defaultPreset ?? firstPreset, values: defaultFilters ?? {} })
  const [sort, setSort] = React.useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [state, setState] = React.useState<{ key: string | null; rows: T[]; next: string | null; total: number | null; error: unknown; raw: Record<string, unknown> }>({ key: null, rows: [], next: null, total: null, error: null, raw: {} })
  const [reloadTick, setReloadTick] = React.useState(0)
  const [selectingAll, setSelectingAll] = React.useState(false)

  const presetParams = presets.find((p) => p.key === preset)?.params ?? {}
  const params: Record<string, string> = {}
  const fromFilters = Object.fromEntries(Object.entries(filterValues).flatMap(([k, v]) => Object.entries(filters.find((f) => f.key === k)?.toParams?.(v) ?? { [k]: v })))
  for (const [k, v] of Object.entries({ ...baseParams, ...presetParams, ...fromFilters, q })) if (v) params[k] = v
  const paramsJson = JSON.stringify(params)
  const pageSize = (PAGE_SIZES as readonly number[]).includes(prefs.pageSize) ? prefs.pageSize : DEFAULT_PAGE_SIZE
  const paramsKey = paramsJson + pageSize

  // Cursor pages (cursors[i] loads page i) and the selection belong to one set of
  // filters: new filters start again at page 1 with nothing selected
  const [paging, setPaging] = React.useState<{ key: string; cursors: (string | undefined)[]; index: number }>({ key: paramsKey, cursors: [undefined], index: 0 })
  const page = paging.key === paramsKey ? paging : { key: paramsKey, cursors: [undefined], index: 0 }
  const pageIndex = page.index
  const [selection, setSelection] = React.useState<{ key: string; rows: Map<string, T> }>({ key: paramsKey, rows: new Map() })
  const selected = selection.key === paramsKey ? selection.rows : new Map<string, T>()
  const setSelected = (fn: (s: Map<string, T>) => Map<string, T>) => setSelection({ key: paramsKey, rows: fn(selected) })

  const loadRef = React.useRef(load)
  React.useEffect(() => {
    loadRef.current = load
  })
  const fetchPage = React.useCallback(
    (cursor: string | undefined, limit: number, withTotal = false): Promise<Page<T>> => {
      const current = JSON.parse(paramsJson) as Record<string, string>
      if (loadRef.current) return loadRef.current({ params: current, limit, cursor })
      const search = new URLSearchParams({ ...current, limit: String(limit), ...(cursor ? { cursor } : {}), ...(withTotal ? { withTotal: "1" } : {}) })
      return api.get<Page<T>>(`${path}?${search}`)
    },
    [paramsJson, path]
  )

  const cursor = page.cursors[pageIndex]
  const loadKey = `${paramsKey}|${pageIndex}|${cursor ?? ""}|${reloadTick}`
  React.useEffect(() => {
    let cancelled = false
    fetchPage(cursor, pageSize, true)
      .then((p) => !cancelled && setState({ key: loadKey, rows: p.data, next: p.nextCursor, total: p.total ?? null, error: null, raw: p as unknown as Record<string, unknown> }))
      .catch((error) => !cancelled && setState((s) => ({ ...s, key: loadKey, error })))
    return () => {
      cancelled = true
    }
  }, [fetchPage, cursor, pageSize, loadKey])

  const loading = state.key !== loadKey
  const activeFilters = Object.keys(filterValues).length + (preset !== firstPreset ? 1 : 0)
  const hasFilters = !!q || activeFilters > 0
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
  const lastPage = total !== null ? Math.max(1, Math.ceil(total / pageSize)) : Math.max(page.cursors.length, pageIndex + 1 + (state.next ? 1 : 0))
  const selectable = bulkActions.length > 0

  const presetName = presets.find((p) => p.key === preset)?.label
  const filterLabels = [
    ...(q ? [`Search “${q}”`] : []),
    ...(preset !== firstPreset && presetName ? [`${presetLabel}: ${presetName}`] : []),
    ...Object.entries(filterValues).map(([k, v]) => {
      const f = filters.find((x) => x.key === k)
      return `${f?.label ?? k}: ${f?.options.find((o) => o.value === v)?.label ?? v}`
    }),
  ]

  const clearAll = () => {
    setSearch("")
    setFilterValues({})
    setPreset(firstPreset)
    setDraft({ preset: firstPreset, values: {} })
  }
  const applyFilters = () => {
    setPreset(draft.preset)
    setFilterValues(Object.fromEntries(Object.entries(draft.values).filter(([, v]) => v)))
  }

  /** Later pages are known only by walking there, so a jump reads the pages between */
  const goTo = async (target: number) => {
    const cursors = [...page.cursors]
    if (state.next && cursors.length === pageIndex + 1) cursors.push(state.next)
    try {
      while (cursors.length <= target) {
        const p = await fetchPage(cursors[cursors.length - 1], pageSize)
        if (!p.nextCursor) break
        cursors.push(p.nextCursor)
      }
      setPaging({ key: paramsKey, cursors, index: Math.min(target, cursors.length - 1) })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't open that page")
    }
  }
  const clickable = !!rowHref || !!rowClick
  const open = (row: T, e?: React.MouseEvent | React.KeyboardEvent) => {
    if (rowClick) return rowClick(row)
    if (!rowHref) return
    const href = rowHref(row)
    if (e && (e.ctrlKey || e.metaKey)) window.open(href, "_blank", "noopener")
    else router.push(href)
  }
  const onRowKey = (e: React.KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.key === "Enter" && e.target === e.currentTarget) open(row, e)
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

  const cardsView = prefs.view === "cards"
  const hasPanel = presets.length > 1 || filters.length > 0
  const hideable = columns.filter((c) => c.hideable !== false)
  const viewButton = (on: boolean) => cn("grid size-8 place-items-center rounded-[10px] text-muted-foreground transition-colors [&_svg]:size-4", on && "bg-primary text-primary-foreground")

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {header.breadcrumb && <p className="text-xs text-muted-foreground">{header.breadcrumb}</p>}
          <h1 className="text-[26px] leading-tight font-bold tracking-tight">{header.title}</h1>
          {header.description && <p className="mt-0.5 text-sm text-muted-foreground">{header.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {header.actions}
          {header.primary}
          {(exportName || header.more?.length) && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" title="More actions" />}>
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {header.more?.map((m) => <DropdownMenuItem key={m.href} onClick={() => router.push(m.href)}>{m.label}</DropdownMenuItem>)}
                {exportName && (
                  <DropdownMenuItem onClick={() => void exportFiltered()}>
                    <Download className="size-4" /> Export CSV
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="ui-surface ui-rise min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-4">
          {!noSearch && <SearchInput value={search} onChange={setSearch} placeholder={searchPlaceholder} className="w-full sm:w-80" />}
          {summary?.(state.raw)}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="hidden rounded-xl border p-0.5 md:flex" role="radiogroup" aria-label="Show as">
              <button type="button" role="radio" aria-checked={!cardsView} aria-label="Table" title="Table" onClick={() => setPrefs({ ...prefs, view: "table" })} className={viewButton(!cardsView)}><List /></button>
              <button type="button" role="radio" aria-checked={cardsView} aria-label="Cards" title="Cards" onClick={() => setPrefs({ ...prefs, view: "cards" })} className={viewButton(cardsView)}><LayoutGrid /></button>
            </div>
            {hideable.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Columns" title="Columns" />}>
                  <Columns3 />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                    {hideable.map((c) => (
                      <DropdownMenuCheckboxItem key={c.key} checked={!prefs.hidden.includes(c.key)} onCheckedChange={(on) => setPrefs({ ...prefs, hidden: on ? prefs.hidden.filter((k) => k !== c.key) : [...prefs.hidden, c.key] })}>
                        {c.header}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {hasPanel && (
              <Button variant="outline" aria-expanded={panelOpen} onClick={() => { setDraft({ preset, values: filterValues }); setPanelOpen(!panelOpen) }}>
                <ListFilter /> Filters
                {activeFilters > 0 && <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground tabular-nums">{activeFilters}</span>}
                <ChevronDown className={cn("transition-transform", panelOpen && "rotate-180")} />
              </Button>
            )}
          </div>
        </div>

        {panelOpen && (
          <div className="flex flex-wrap items-end gap-3 border-t bg-muted/30 p-4">
            {presets.length > 1 && (
              <label className="grid w-full gap-1.5 text-sm font-medium sm:w-56">
                {presetLabel}
                <SearchSelect
                  value={draft.preset}
                  onChange={(v) => setDraft({ ...draft, preset: v })}
                  aria-label={presetLabel}
                  options={presets.map((p) => {
                    const n = p.countKey && counts.data ? counts.data[p.countKey] : undefined
                    return { value: p.key, label: n === undefined ? p.label : `${p.label} (${formatNumber(n)})` }
                  })}
                />
              </label>
            )}
            {filters.map((f) => (
              <label key={f.key} className="grid w-full gap-1.5 text-sm font-medium sm:w-56">
                {f.label}
                <SearchSelect value={draft.values[f.key] ?? ""} onChange={(v) => setDraft({ ...draft, values: { ...draft.values, [f.key]: v } })} aria-label={f.label} options={[{ value: "", label: "All" }, ...f.options]} placeholder="All" />
              </label>
            ))}
            <div className="flex gap-2">
              <Button onClick={applyFilters}>Apply</Button>
              <Button variant="outline" onClick={clearAll}>Clear</Button>
            </div>
          </div>
        )}

        {selectable && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 bg-foreground px-4 py-2.5 text-background">
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

        <div className="min-w-0">
          {loading && state.key === null ? (
            <div className="p-4"><TableSkeleton columns={Math.min(visibleColumns.length, 6)} /></div>
          ) : state.error ? (
            <ErrorState error={state.error} onRetry={() => setReloadTick((t) => t + 1)} />
          ) : rows.length === 0 && !loading ? (
            hasFilters ? <NoResults filters={filterLabels} onClear={clearAll} /> : emptyState
          ) : (
            <div className={cn("transition-opacity", loading && "pointer-events-none opacity-60")}>
              <div className={cn("overflow-x-auto border-t", cardsView ? "hidden" : "hidden md:block")}>
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                      {selectable && (
                        <TableHead className="w-10 pl-5">
                          <Checkbox checked={pageAllSelected} onCheckedChange={(on) => togglePage(!!on)} aria-label="Select all rows on this page" />
                        </TableHead>
                      )}
                      {visibleColumns.map((c, i) => (
                        <TableHead key={c.key} className={cn("h-11 text-[13px] font-semibold text-foreground", i === 0 && !selectable && "pl-5", i === visibleColumns.length - 1 && "pr-5", c.align === "right" && "text-right", c.className)}>
                          {c.sort ? (
                            <button className={cn("inline-flex items-center gap-1.5 hover:text-primary", c.align === "right" && "flex-row-reverse")} onClick={() => setSort(sort?.key === c.key ? (sort.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })} aria-label={`Sort by ${c.header}`}>
                              {c.header}
                              {sort?.key === c.key ? sort.dir === 1 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" /> : <ArrowUpDown className="size-3.5 text-muted-foreground" />}
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
                      <TableRow key={r.id} tabIndex={clickable ? 0 : undefined} data-state={selected.has(r.id) ? "selected" : undefined} className={cn(clickable && "cursor-pointer focus-visible:bg-muted focus-visible:outline-none")} onClick={(e) => open(r, e)} onKeyDown={(e) => onRowKey(e, r)}>
                        {selectable && (
                          <TableCell className="py-3.5 pl-5" onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={selected.has(r.id)} onCheckedChange={(on) => toggleRow(r, !!on)} aria-label="Select row" />
                          </TableCell>
                        )}
                        {visibleColumns.map((c, i) => (
                          <TableCell key={c.key} className={cn("py-3.5", i === 0 && !selectable && "pl-5", i === visibleColumns.length - 1 && "pr-5", c.align === "right" && "text-right tabular-nums", c.className)}>
                            {c.cell(r)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Cards: chosen on any screen, always on phones */}
              <ul className={cn("grid gap-3 border-t p-4 sm:grid-cols-2", cardsView ? "lg:grid-cols-3 xl:grid-cols-4" : "md:hidden")}>
                {rows.map((r) => (
                  <li key={r.id} className="ui-lift flex gap-3 rounded-2xl border p-4">
                    {selectable && <Checkbox checked={selected.has(r.id)} onCheckedChange={(on) => toggleRow(r, !!on)} aria-label="Select row" className="mt-1" />}
                    <div role="button" tabIndex={0} className="grid min-w-0 flex-1 cursor-pointer grid-cols-1 gap-1 text-left" onClick={(e) => open(r, e)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(r, e) }}>
                      <span className="font-medium">{visibleColumns[0]?.cell(r)}</span>
                      {visibleColumns.slice(1).map((c) => (
                        <span key={c.key} className="flex justify-between gap-3 text-sm">
                          <span className="shrink-0 text-muted-foreground">{c.header}</span>
                          <span className="min-w-0 truncate text-right">{c.cell(r)}</span>
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {!state.error && (rows.length > 0 || pageIndex > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              Rows per page
              <SearchSelect value={String(pageSize)} onChange={(v) => setPrefs({ ...prefs, pageSize: Number(v) })} aria-label="Rows per page" options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))} className="h-9 w-20" />
            </span>
            <nav className="flex flex-wrap items-center gap-1" aria-label="Pages">
              <span className="mr-3 tabular-nums">{formatNumber(from)}–{formatNumber(to)}{total !== null && ` of ${formatNumber(total)}`}</span>
              <button type="button" className={pagerButton} disabled={pageIndex === 0 || loading} onClick={() => void goTo(0)} aria-label="First page" title="First page"><ChevronsLeft /></button>
              <button type="button" className={pagerButton} disabled={pageIndex === 0 || loading} onClick={() => void goTo(pageIndex - 1)} aria-label="Previous page" title="Previous page"><ChevronLeft /></button>
              {pageNumbers(pageIndex, lastPage).map((n, i) =>
                n === "gap" ? (
                  <span key={`gap-${i}`} className="grid size-9 place-items-center" aria-hidden>…</span>
                ) : (
                  <button key={n} type="button" className={cn(pagerButton, n === pageIndex && "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary")} aria-current={n === pageIndex ? "page" : undefined} disabled={loading} onClick={() => void goTo(n)}>{n + 1}</button>
                )
              )}
              <button type="button" className={pagerButton} disabled={!state.next || loading} onClick={() => void goTo(pageIndex + 1)} aria-label="Next page" title="Next page"><ChevronRight /></button>
              <button type="button" className={pagerButton} disabled={!state.next || loading || total === null} onClick={() => void goTo(lastPage - 1)} aria-label="Last page" title="Last page"><ChevronsRight /></button>
            </nav>
          </div>
        )}
      </div>
    </div>
  )
}

/** Link-styled header action (Import, New …) that keeps the button look. */
export function HeaderLink({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <Link href={href} className={cn("inline-flex h-10 items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold [&_svg]:size-4", primary ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "border-transparent bg-card shadow-[var(--shadow-card)] hover:bg-muted")}>
      {children}
    </Link>
  )
}
