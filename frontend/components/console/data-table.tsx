"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronsUpDown, Copy, MoreVertical, Search, SlidersHorizontal, type LucideIcon } from "lucide-react"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Failed, Loading } from "@/components/console/kit"
import { PAGE_SIZES, type TableState } from "@/lib/use-table"
import { cn } from "@/lib/utils"

// The Console's one table (wide lists with search, filters, sortable columns, a "View" menu to
// pick columns, a ⋮ actions menu per row and numbered pages). The table scrolls sideways inside
// its card; the page never grows wider than the window.

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  /** Header click sorts by this column */
  sortable?: boolean
  align?: "left" | "right" | "center"
  /** Hidden until switched on in View */
  hidden?: boolean
  /** Can't be hidden (the name column) */
  always?: boolean
  className?: string
}

export interface RowAction {
  label: string
  icon?: LucideIcon
  onClick?: () => void
  href?: string
  danger?: boolean
  hidden?: boolean
  disabled?: boolean
  separator?: boolean
}

function loadHidden(id: string, columns: Column<unknown>[]) {
  try {
    const raw = localStorage.getItem(`table:${id}:hidden`)
    if (raw) return new Set<string>(JSON.parse(raw) as string[])
  } catch {
    /* private window */
  }
  return new Set(columns.filter((c) => c.hidden).map((c) => c.key))
}

export function DataTable<T extends { id: string }>({
  id,
  table,
  columns,
  searchFields,
  searchPlaceholder = "Search…",
  filters,
  summary,
  toolbar,
  actions,
  onRowClick,
  selectable,
  selected,
  onSelectedChange,
  empty = "Nothing here yet.",
  label,
  noSearch,
}: {
  /** Saves which columns are shown, per table */
  id: string
  table: TableState<T>
  columns: Column<T>[]
  /** Search one column or all (client tables); omit for server search across everything */
  searchFields?: { key: string; label: string }[]
  searchPlaceholder?: string
  filters?: React.ReactNode
  /** Right of the search, e.g. "11 Active · 9 Inactive" */
  summary?: React.ReactNode
  toolbar?: React.ReactNode
  actions?: (row: T) => RowAction[]
  onRowClick?: (row: T) => void
  selectable?: boolean
  selected?: Set<string>
  onSelectedChange?: (s: Set<string>) => void
  empty?: React.ReactNode
  label: string
  /** The list has no search (the API can't search it) */
  noSearch?: boolean
}) {
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set(columns.filter((c) => c.hidden).map((c) => c.key)))
  const [loaded, setLoaded] = React.useState(false)
  if (!loaded && typeof window !== "undefined") {
    setLoaded(true)
    setHidden(loadHidden(id, columns as Column<unknown>[]))
  }
  const toggleColumn = (key: string) =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        localStorage.setItem(`table:${id}:hidden`, JSON.stringify([...next]))
      } catch {
        /* private window */
      }
      return next
    })
  const shown = columns.filter((c) => c.always || !hidden.has(c.key))
  const sel = selected ?? new Set<string>()
  const allOnPage = table.rows.length > 0 && table.rows.every((r) => sel.has(r.id))
  const someOnPage = table.rows.some((r) => sel.has(r.id))
  const togglePage = () => {
    const next = new Set(sel)
    for (const r of table.rows) {
      if (allOnPage) next.delete(r.id)
      else next.add(r.id)
    }
    onSelectedChange?.(next)
  }
  const toggleRow = (rid: string) => {
    const next = new Set(sel)
    if (next.has(rid)) next.delete(rid)
    else next.add(rid)
    onSelectedChange?.(next)
  }
  const sortBy = (key: string) => {
    const s = table.sort
    table.setSort(!s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null)
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]" aria-label={label}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-3 sm:px-4">
        {!noSearch && (
        <div className="flex h-9 min-w-0 flex-1 basis-72 items-center rounded-lg border bg-background focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20 sm:max-w-md">
          {searchFields?.length ? (
            <select value={table.searchField} onChange={(e) => table.setSearchField(e.target.value)} aria-label="Search in" className="h-full shrink-0 rounded-l-lg border-r bg-transparent pr-1 pl-2.5 text-[13px] font-medium outline-none">
              <option value="all">All columns</option>
              {searchFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          ) : (
            <Search className="ml-3 size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <input
            type="search"
            value={table.search}
            onChange={(e) => table.setSearch(e.target.value)}
            placeholder={searchFields?.length && table.searchField !== "all" ? `Search by ${searchFields.find((f) => f.key === table.searchField)?.label.toLowerCase()}…` : searchPlaceholder}
            aria-label={`Search ${label}`}
            className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        )}
        {filters}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {summary && <div className="flex items-center gap-3 text-[13px] whitespace-nowrap">{summary}</div>}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-background px-3 text-[13px] font-medium hover:bg-muted">
              <SlidersHorizontal className="size-4" /> View
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Columns to show</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columns.filter((c) => !c.always && c.header).map((c) => (
                  <DropdownMenuCheckboxItem key={c.key} checked={!hidden.has(c.key)} onCheckedChange={() => toggleColumn(c.key)} closeOnClick={false}>
                    {c.header}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {toolbar}
        </div>
      </div>

      {/* Table: scrolls sideways inside the card */}
      {table.error ? (
        <div className="p-5"><Failed error={table.error} onRetry={table.reload} /></div>
      ) : (
        <div className="relative max-h-[70vh] overflow-auto">
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
              <tr className="text-left text-xs whitespace-nowrap text-muted-foreground">
                {selectable && (
                  <th className="w-10 border-b py-2.5 pr-0 pl-4">
                    <input type="checkbox" checked={allOnPage} ref={(el) => { if (el) el.indeterminate = someOnPage && !allOnPage }} onChange={togglePage} aria-label="Select all on this page" className="size-4 accent-[var(--primary)]" />
                  </th>
                )}
                {shown.map((c) => (
                  <th key={c.key} scope="col" className={cn("border-b px-3 py-2.5 font-medium first:pl-4", c.align === "right" && "text-right", c.align === "center" && "text-center")} aria-sort={table.sort?.key === c.key ? (table.sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                    {c.sortable ? (
                      <button type="button" onClick={() => sortBy(c.key)} className={cn("inline-flex items-center gap-1 rounded hover:text-foreground", table.sort?.key === c.key && "text-foreground")}>
                        {c.header}
                        {table.sort?.key === c.key ? table.sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-50" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                ))}
                {actions && <th className="sticky right-0 w-12 border-b bg-muted/80 py-2.5 pr-3 backdrop-blur"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {table.loading && !table.rows.length ? (
                <tr><td colSpan={shown.length + 2} className="p-5"><Loading rows={6} /></td></tr>
              ) : !table.rows.length ? (
                <tr><td colSpan={shown.length + 2} className="px-5 py-12 text-center text-sm text-muted-foreground">{table.search ? "Nothing matches your search." : empty}</td></tr>
              ) : (
                table.rows.map((row) => {
                  const rowActions = actions?.(row).filter((a) => !a.hidden) ?? []
                  return (
                    <tr key={row.id} onClick={onRowClick ? () => onRowClick(row) : undefined} className={cn("group align-middle", onRowClick && "cursor-pointer", sel.has(row.id) ? "bg-accent/40" : "hover:bg-muted/40", table.loading && "opacity-60")}>
                      {selectable && (
                        <td className="border-b py-3 pr-0 pl-4" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={sel.has(row.id)} onChange={() => toggleRow(row.id)} aria-label="Select row" className="size-4 accent-[var(--primary)]" />
                        </td>
                      )}
                      {shown.map((c) => (
                        <td key={c.key} className={cn("border-b px-3 py-3 whitespace-nowrap first:pl-4", c.align === "right" && "text-right tabular-nums", c.align === "center" && "text-center", c.className)}>{c.cell(row)}</td>
                      ))}
                      {actions && (
                        <td className="sticky right-0 border-b bg-card py-2 pr-3 group-hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                          {rowActions.length > 0 && <RowMenu actions={rowActions} />}
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <Pager table={table} />
    </section>
  )
}

function RowMenu({ actions }: { actions: RowAction[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-popup-open:bg-muted" aria-label="Actions">
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {actions.map((a, i) => (
          <React.Fragment key={a.label}>
            {a.separator && i > 0 && <DropdownMenuSeparator />}
            {a.href ? (
              <DropdownMenuItem render={<Link href={a.href} />} disabled={a.disabled} variant={a.danger ? "destructive" : "default"}>
                {a.icon && <a.icon className="size-4" />} {a.label}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={a.onClick} disabled={a.disabled} variant={a.danger ? "destructive" : "default"}>
                {a.icon && <a.icon className="size-4" />} {a.label}
              </DropdownMenuItem>
            )}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Pager<T>({ table }: { table: TableState<T> }) {
  const pages = Math.max(1, Math.ceil(table.total / table.pageSize))
  const from = table.total ? (table.page - 1) * table.pageSize + 1 : 0
  const to = Math.min(table.total, table.page * table.pageSize)
  // 1 … 4 5 [6] 7 8 … 20
  const nums: (number | "gap")[] = []
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - table.page) <= 2) nums.push(p)
    else if (nums[nums.length - 1] !== "gap") nums.push("gap")
  }
  const go = (p: number) => table.setPage(Math.min(pages, Math.max(1, p)))
  const icon = "grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-[13px]">
      <label className="flex items-center gap-2 text-muted-foreground">
        Rows per page
        <select value={table.pageSize} onChange={(e) => table.setPageSize(Number(e.target.value))} className="h-8 rounded-md border bg-background px-2 text-foreground">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-2 text-muted-foreground tabular-nums">{from}–{to} of {table.total.toLocaleString("en-IN")}</span>
        <button type="button" className={icon} onClick={() => go(1)} disabled={table.page <= 1} aria-label="First page"><ChevronsLeft className="size-4" /></button>
        <button type="button" className={icon} onClick={() => go(table.page - 1)} disabled={table.page <= 1} aria-label="Previous page"><ChevronLeft className="size-4" /></button>
        {nums.map((n, i) =>
          n === "gap" ? (
            <span key={`g${i}`} className="px-1 text-muted-foreground">…</span>
          ) : (
            <button key={n} type="button" onClick={() => go(n)} aria-current={n === table.page ? "page" : undefined} className={cn("h-8 min-w-8 rounded-md px-2 tabular-nums", n === table.page ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-muted")}>
              {n}
            </button>
          ),
        )}
        <button type="button" className={icon} onClick={() => go(table.page + 1)} disabled={table.page >= pages} aria-label="Next page"><ChevronRight className="size-4" /></button>
        <button type="button" className={icon} onClick={() => go(pages)} disabled={table.page >= pages} aria-label="Last page"><ChevronsRight className="size-4" /></button>
      </div>
    </div>
  )
}

/** A short, copyable ID: the last 6 characters of the UUID (click copies the full ID). */
export function IdCell({ id, href }: { id: string; href?: string }) {
  const short = `#${id.replace(/-/g, "").slice(-6).toUpperCase()}`
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(id)
      toast.success("ID copied")
    } catch {
      toast.error("Couldn't copy the ID")
    }
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[12.5px]">
      {href ? <Link href={href} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">{short}</Link> : <span className="text-muted-foreground">{short}</span>}
      <button type="button" onClick={copy} title={`Copy full ID ${id}`} aria-label="Copy full ID" className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100">
        <Copy className="size-3" />
      </button>
    </span>
  )
}

/** Small "filter" select styled like the toolbar. */
export function FilterSelect({ value, onChange, label, options, className }: { value: string; onChange: (v: string) => void; label: string; options: [string, string][]; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={cn("h-9 rounded-lg border bg-background px-2.5 text-[13px]", value ? "border-primary/60 font-medium text-foreground" : "text-muted-foreground", className)}>
      {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  )
}

/** "● 11 Active" style counts for the toolbar summary. */
export function Count({ tone, n, label }: { tone: "green" | "red" | "amber" | "blue" | "grey"; n: number; label: string }) {
  const dot = { green: "bg-emerald-500", red: "bg-red-500", amber: "bg-amber-500", blue: "bg-primary", grey: "bg-muted-foreground/50" }[tone]
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-full", dot)} /> <span className="tabular-nums">{n}</span> {label}
    </span>
  )
}
