"use client"

import * as React from "react"
import { api, ApiError } from "@/lib/api"

// Table state for Console lists (search, sort, numbered pages). Two sources:
//  - useServerTable: the API pages, sorts and searches (long lists: businesses, orders, payments,
//    invoices, audit). Sends ?page=&limit=&sort=…; expects { data, total }.
//  - useClientTable: the list is small and already loaded (team, roles, partners, plans…).

export type SortDir = "asc" | "desc"
export interface SortState { key: string; dir: SortDir }

export interface TableState<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
  setPage: (p: number) => void
  setPageSize: (n: number) => void
  sort: SortState | null
  setSort: (s: SortState | null) => void
  search: string
  setSearch: (v: string) => void
  searchField: string
  setSearchField: (v: string) => void
  loading: boolean
  error: ApiError | null
  reload: () => void
}

export const PAGE_SIZES = [10, 20, 50, 100]

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** `sortParam` turns the column sort into the API's sort value (or undefined when it can't sort that way). */
export function useServerTable<T>(
  path: string,
  params: Record<string, string | undefined>,
  opts: { pageSize?: number; sortParam?: (s: SortState | null) => string | undefined; searchParam?: string; extra?: (body: Record<string, unknown>) => void } = {},
): TableState<T> & { extra: Record<string, unknown> } {
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSizeState] = React.useState(opts.pageSize ?? 20)
  const [sort, setSortState] = React.useState<SortState | null>(null)
  const [search, setSearchState] = React.useState("")
  const [searchField, setSearchField] = React.useState("all")
  const q = useDebounced(search)
  const [tick, setTick] = React.useState(0)
  const [state, setState] = React.useState<{ key: string | null; rows: T[]; total: number; extra: Record<string, unknown>; error: ApiError | null }>({ key: null, rows: [], total: 0, extra: {}, error: null })

  const sortValue = opts.sortParam?.(sort)
  const query = new URLSearchParams(
    Object.entries({ ...params, [opts.searchParam ?? "search"]: q || undefined, sort: sortValue, page: String(page), limit: String(pageSize) }).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
  ).toString()
  const key = `${path}?${query}`
  // Filters changed: back to page 1
  const filterKey = JSON.stringify(params) + q + sortValue + pageSize
  const [lastFilter, setLastFilter] = React.useState(filterKey)
  if (filterKey !== lastFilter) {
    setLastFilter(filterKey)
    if (page !== 1) setPage(1)
  }

  React.useEffect(() => {
    let cancelled = false
    api
      .get<{ data: T[]; total: number | null } & Record<string, unknown>>(key)
      .then(({ data, total, ...extra }) => !cancelled && setState({ key, rows: data, total: total ?? data.length, extra, error: null }))
      .catch((e) => !cancelled && setState((s) => ({ ...s, key, error: e instanceof ApiError ? e : null })))
    return () => {
      cancelled = true
    }
  }, [key, tick])

  return {
    rows: state.rows,
    total: state.total,
    extra: state.extra,
    page,
    pageSize,
    setPage,
    setPageSize: (n) => (setPageSizeState(n), setPage(1)),
    sort,
    setSort: setSortState,
    search,
    setSearch: setSearchState,
    searchField,
    setSearchField,
    loading: state.key !== key,
    error: state.error,
    reload: () => setTick((t) => t + 1),
  }
}

/** `fields`: how to read each searchable/sortable column as text or a number. */
export function useClientTable<T>(all: T[] | null | undefined, fields: Record<string, (row: T) => string | number | null | undefined>, opts: { pageSize?: number; initialSort?: SortState } = {}): TableState<T> {
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(opts.pageSize ?? 20)
  const [sort, setSort] = React.useState<SortState | null>(opts.initialSort ?? null)
  const [search, setSearchState] = React.useState("")
  const [searchField, setSearchFieldState] = React.useState("all")

  const filtered = React.useMemo(() => {
    const rows = all ?? []
    const needle = search.trim().toLowerCase()
    const hit = needle
      ? rows.filter((r) => (searchField === "all" ? Object.values(fields) : [fields[searchField]]).some((f) => f && String(f(r) ?? "").toLowerCase().includes(needle)))
      : rows
    if (!sort || !fields[sort.key]) return hit
    const read = fields[sort.key]
    return [...hit].sort((a, b) => {
      const x = read(a) ?? ""
      const y = read(b) ?? ""
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true, sensitivity: "base" })
      return sort.dir === "asc" ? c : -c
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fields` is a fresh object each render; its readers depend only on row data
  }, [all, search, searchField, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages)
  return {
    rows: filtered.slice((current - 1) * pageSize, current * pageSize),
    total: filtered.length,
    page: current,
    pageSize,
    setPage,
    setPageSize: (n) => (setPageSize(n), setPage(1)),
    sort,
    setSort,
    search,
    setSearch: (v) => (setSearchState(v), setPage(1)),
    searchField,
    setSearchField: (v) => (setSearchFieldState(v), setPage(1)),
    loading: all === undefined || all === null,
    error: null,
    reload: () => undefined,
  }
}
