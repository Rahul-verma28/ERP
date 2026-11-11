"use client"

import { ContactDialog } from "@/components/contact-dialog"

import * as React from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { Check, Package, Plus, ScanLine, Search, Wrench, X } from "lucide-react"
import { Spinner } from "@/components/common"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/form"
import { api, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"
import { useDebounced } from "@/lib/use-list"
import { formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"

export interface ContactOption {
  id: string
  name: string
  companyName?: string | null
  phone?: string | null
  gstin?: string | null
  stateCode?: string | null
  /** Customers: invoices fall due this many days after their date */
  paymentDays?: number | null
  address?: Record<string, string> | null
  shippingAddress?: { name?: string | null; line1?: string; city?: string; pincode?: string; stateCode?: string } | null
}

export interface ItemOption {
  id: string
  name: string
  type: "product" | "service"
  unit: string
  pricePaise: number
  gstRateBp: number
  hsnSac: string | null
  durationMin?: number | null
  costPricePaise?: number | null
  /** Set when Inventory tracks the item: in stock, all warehouses */
  stockQty?: number
  trackStock?: boolean
  /** Stock per warehouse, for tracked items */
  warehouses?: { id: string; name: string; quantity: number }[]
  sku?: string | null
  barcode?: string | null
  tracking?: string
}

/** Accessible search-as-you-type combobox over an API list endpoint. */
function Combobox<T extends { id: string }>({
  path,
  value,
  onChange,
  render,
  label,
  placeholder,
  id,
  footer,
}: {
  path: string
  value: T | null
  onChange: (v: T | null) => void
  render: (v: T) => { title: string; subtitle?: string }
  label: string
  placeholder: string
  id?: string
  footer?: (query: string, close: () => void) => React.ReactNode
}) {
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const [results, setResults] = React.useState<T[]>([])
  const q = useDebounced(query, 250)
  const listId = React.useId()

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    api
      .get<{ data: T[] }>(`${path}${path.includes("?") ? "&" : "?"}limit=8${q ? `&q=${encodeURIComponent(q)}` : ""}`)
      .then((r) => !cancelled && setResults(r.data))
      .catch(() => !cancelled && setResults([]))
    return () => {
      cancelled = true
    }
  }, [q, open, path])

  if (value) {
    const r = render(value)
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-3xl bg-input/50 px-3 text-sm">
        <span className="min-w-0 truncate">
          <span className="font-medium">{r.title}</span>
          {r.subtitle && <span className="text-muted-foreground"> · {r.subtitle}</span>}
        </span>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange(null)} aria-label={`Clear ${label}`}>
          <X className="size-4" />
        </button>
      </div>
    )
  }

  const choose = (v: T) => {
    onChange(v)
    setQuery("")
    setOpen(false)
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={label}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, results.length - 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === "Enter" && open && results[active]) {
            e.preventDefault()
            choose(results[active])
          } else if (e.key === "Escape") setOpen(false)
        }}
      />
      {open && (
        <div id={listId} role="listbox" className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-2xl border bg-popover p-1 shadow-lg">
          {results.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No matches</p>}
          {results.map((r, i) => {
            const v = render(r)
            return (
              <button
                type="button"
                key={r.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r)}
                className={cn("flex w-full flex-col items-start rounded-xl px-3 py-1.5 text-left text-sm", i === active && "bg-muted")}
              >
                <span className="font-medium">{v.title}</span>
                {v.subtitle && <span className="text-xs text-muted-foreground">{v.subtitle}</span>}
              </button>
            )
          })}
          {footer?.(query, () => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** Choose a customer; "+ Add" opens the full customer form with the typed name, so nobody is added half-filled. */
export function ContactPicker({ value, onChange, id, allowCreate = true }: { value: ContactOption | null; onChange: (c: ContactOption | null) => void; id?: string; allowCreate?: boolean }) {
  const [adding, setAdding] = React.useState<string | null>(null)
  return (
    <>
      <Combobox<ContactOption>
        id={id}
        path="/contacts"
        label="Customer"
        placeholder="Search customers by name, phone or GSTIN"
        value={value}
        onChange={onChange}
        render={(c) => ({ title: c.companyName || c.name, subtitle: [c.companyName ? c.name : null, c.phone, c.gstin].filter(Boolean).join(" · ") || undefined })}
        footer={
          allowCreate
            ? (query, close) => (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  className="mt-1 w-full rounded-xl border-t px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
                  onClick={() => { setAdding(query.trim()); close() }}
                >
                  {query.trim() ? `+ Add “${query.trim()}” as a new customer` : "+ Add a new customer"}
                </button>
              )
            : undefined
        }
      />
      {adding !== null && <ContactDialog kind="customer" initialName={adding} onClose={() => setAdding(null)} onSaved={(c) => { setAdding(null); onChange(c as ContactOption) }} />}
    </>
  )
}

export function SupplierPicker({ value, onChange, id, allowCreate = true }: { value: ContactOption | null; onChange: (c: ContactOption | null) => void; id?: string; allowCreate?: boolean }) {
  return (
    <Combobox<ContactOption>
      id={id}
      path="/suppliers"
      label="Supplier"
      placeholder="Search suppliers by name, phone or GSTIN"
      value={value}
      onChange={onChange}
      render={(c) => ({ title: c.companyName || c.name, subtitle: [c.companyName ? c.name : null, c.phone, c.gstin].filter(Boolean).join(" · ") || undefined })}
      footer={
        allowCreate
          ? (query, close) =>
              query.trim().length >= 2 && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  className="mt-1 w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
                  onClick={async () => {
                    onChange(await api.post<ContactOption>("/suppliers", { name: query.trim() }))
                    close()
                  }}
                >
                  + Add &ldquo;{query.trim()}&rdquo; as a new supplier
                </button>
              )
          : undefined
      }
    />
  )
}

/**
 * Search, scan or browse items to add to a bill. The list floats above the page (never cut off by the
 * card it sits in), scrolls, and shows price, GST, HSN and stock so the right item is picked first time.
 * A barcode scanner types the code and presses Enter: an exact barcode or SKU match is added at once.
 */
export function ItemPicker({ onPick, id, allowCreate = false, defaultGstRateBp = 1800, placeholder = "Search item, SKU or HSN, or scan", locationId, price = "sale" }: {
  onPick: (i: ItemOption) => void
  id?: string
  allowCreate?: boolean
  defaultGstRateBp?: number
  placeholder?: string
  /** Show stock in this warehouse (all warehouses when empty) */
  locationId?: string | null
  /** Which price to show: selling (sales) or buying (purchase, stock) */
  price?: "sale" | "cost"
}) {
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const [results, setResults] = React.useState<ItemOption[] | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [inDialog, setInDialog] = React.useState(false)
  const [box, setBox] = React.useState<{ left: number; top: number; width: number; up: boolean; height: number } | null>(null)
  const wrap = React.useRef<HTMLDivElement>(null)
  const list = React.useRef<HTMLDivElement>(null)
  const q = useDebounced(query.trim(), 200)
  const listId = React.useId()

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    api
      .get<{ data: ItemOption[] }>(`/items?limit=20${q ? `&q=${encodeURIComponent(q)}` : ""}`)
      .then((r) => !cancelled && setResults(r.data))
      .catch(() => !cancelled && setResults([]))
    return () => { cancelled = true }
  }, [q, open])

  // Keep the floating list under (or above, near the bottom) the box while the page scrolls
  React.useLayoutEffect(() => {
    if (!open) return
    const dialog = !!wrap.current?.closest("[role=dialog]")
    setInDialog(dialog)
    if (dialog) return
    const place = () => {
      const r = wrap.current?.getBoundingClientRect()
      if (!r) return
      const up = window.innerHeight - r.bottom < 300 && r.top > 360
      const width = Math.min(Math.max(r.width, 600), window.innerWidth - 16)
      setBox({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: up ? r.top - 6 : r.bottom + 6, width, up, height: window.innerHeight })
    }
    place()
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place) }
  }, [open])

  React.useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  const rows = results ?? []
  const choose = (v: ItemOption) => {
    onPick(v)
    setQuery("")
    setActive(0)
    // The box stays open so the next item can be typed or scanned straight away
  }
  async function addNew() {
    setAdding(true)
    try {
      choose(await api.post<ItemOption>("/items", { name: query.trim(), type: "product", unit: "pcs", pricePaise: 0, gstRateBp: defaultGstRateBp }))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setAdding(false)
    }
  }
  const stockOf = (i: ItemOption) => {
    if (!i.trackStock) return null
    if (locationId) return i.warehouses?.find((w) => w.id === locationId)?.quantity ?? 0
    return i.stockQty ?? 0
  }
  const cols = "sm:grid-cols-[2.25rem_minmax(0,1fr)_6.5rem_3.5rem_7rem]"

  const panel = open && (
    <div
      ref={list}
      id={listId}
      role="listbox"
      aria-label="Items"
      style={box && !inDialog ? { position: "fixed", left: box.left, width: box.width, ...(box.up ? { bottom: box.height - box.top } : { top: box.top }) } : undefined}
      className={cn("z-[60] overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl", inDialog && "absolute top-full right-0 left-0 mt-1.5")}
    >
      <div className={cn("hidden gap-3 border-b px-4 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase sm:grid", cols)}>
        <span className="col-span-2">Item</span><span className="text-right">{price === "cost" ? "Buy price" : "Price"}</span><span className="text-right">GST</span><span className="text-right">{locationId ? "Here" : "In stock"}</span>
      </div>
      <div className="max-h-[min(22rem,50vh)] overflow-y-auto p-1.5">
        {results === null ? (
          <div className="grid place-items-center py-8"><Spinner /></div>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{q ? <>No item matches &ldquo;{q}&rdquo;</> : "No items yet. Add your products and services in Items."}</p>
        ) : (
          rows.map((it, i) => {
            const stock = stockOf(it)
            const amount = price === "cost" ? it.costPricePaise : it.pricePaise
            const meta = [it.sku, it.hsnSac && `HSN ${it.hsnSac}`, it.unit].filter(Boolean).join(" · ")
            return (
              <button
                type="button"
                key={it.id}
                role="option"
                data-index={i}
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(it)}
                className={cn("grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm", cols, i === active && "bg-muted")}
              >
                <span className={cn("grid size-9 place-items-center rounded-xl", it.type === "service" ? "bg-violet-500/10 text-violet-600 dark:text-violet-300" : "bg-primary/10 text-primary")}>
                  {it.type === "service" ? <Wrench className="size-4" aria-hidden /> : <Package className="size-4" aria-hidden />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{it.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{meta}</span>
                </span>
                <span className="text-right font-medium tabular-nums">{amount ? formatPaise(amount) : "—"}</span>
                <span className="hidden text-right text-muted-foreground tabular-nums sm:block">{it.gstRateBp / 100}%</span>
                <span className="hidden text-right sm:block">
                  {stock === null ? (
                    <span className="text-xs text-muted-foreground">{it.type === "service" ? "Service" : "Not tracked"}</span>
                  ) : (
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", stock > 0 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300")}>{stock > 0 ? `${stock} ${it.unit}` : "Out of stock"}</span>
                  )}
                </span>
              </button>
            )
          })
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2">
        {allowCreate && q.length >= 2 ? (
          <button type="button" disabled={adding} onMouseDown={(e) => e.preventDefault()} onClick={() => void addNew()} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-primary hover:bg-primary/10">
            <Plus className="size-4" /> {adding ? "Adding…" : <>Add &ldquo;{q}&rdquo; as a new item</>}
          </button>
        ) : <span />}
        <span className="hidden text-[11px] text-muted-foreground sm:block">↑ ↓ to move · Enter to add · Esc to close</span>
      </div>
    </div>
  )

  return (
    <div ref={wrap} className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Add item"
        className="h-11 pr-28 pl-10"
        placeholder={placeholder}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, rows.length - 1)) }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === "Enter") {
            e.preventDefault()
            const code = query.trim().toLowerCase()
            const exact = code ? rows.find((r) => r.barcode?.toLowerCase() === code || r.sku?.toLowerCase() === code) : undefined
            if (exact) choose(exact)
            else if (open && rows[active]) choose(rows[active])
          } else if (e.key === "Escape") setOpen(false)
        }}
      />
      <span className="pointer-events-none absolute top-1/2 right-3.5 hidden -translate-y-1/2 items-center gap-1 text-[11px] text-muted-foreground sm:flex"><ScanLine className="size-3.5" aria-hidden /> Scan ready</span>
      {panel && (inDialog ? panel : box ? createPortal(panel, document.body) : null)}
    </div>
  )
}

export interface DirectoryUser {
  id: string
  name: string
  roleKey: string
  roleName: string
}

export function useDirectory() {
  return useApi<{ data: DirectoryUser[] }>("/directory/users").data?.data ?? []
}

export function UserSelect({ value, onChange, id, emptyLabel = "Unassigned", filter }: { value: string | null; onChange: (v: string | null) => void; id?: string; emptyLabel?: string; filter?: (u: DirectoryUser) => boolean }) {
  const users = useDirectory().filter(filter ?? (() => true))
  return (
    <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} — {u.roleName}
        </option>
      ))}
    </NativeSelect>
  )
}

export function CheckLabel({ checked, children }: { checked: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {checked && <Check className="size-3.5" />}
      {children}
    </span>
  )
}
