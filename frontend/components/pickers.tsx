"use client"

import * as React from "react"
import { Check, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/form"
import { api } from "@/lib/api"
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
  /** Set when Inventory tracks the item: in stock, all godowns */
  stockQty?: number
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

export function ContactPicker({ value, onChange, id, allowCreate = true }: { value: ContactOption | null; onChange: (c: ContactOption | null) => void; id?: string; allowCreate?: boolean }) {
  return (
    <Combobox<ContactOption>
      id={id}
      path="/contacts"
      label="Customer"
      placeholder="Search customers by name, phone or email"
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
                    const c = await api.post<ContactOption>("/contacts", { name: query.trim(), allowDuplicate: true })
                    onChange(c)
                    close()
                  }}
                >
                  + Add “{query.trim()}” as a new customer
                </button>
              )
          : undefined
      }
    />
  )
}

export function ItemPicker({ onPick, id, allowCreate = false, defaultGstRateBp = 1800, placeholder = "Search products & services, or type to add a custom line" }: { onPick: (i: ItemOption) => void; id?: string; allowCreate?: boolean; defaultGstRateBp?: number; placeholder?: string }) {
  return (
    <Combobox<ItemOption>
      id={id}
      path="/items"
      label="Add item"
      placeholder={placeholder}
      value={null}
      onChange={(v) => v && onPick(v)}
      render={(i) => ({ title: i.name, subtitle: `${formatPaise(i.pricePaise)} · GST ${i.gstRateBp / 100}%${i.hsnSac ? ` · ${i.hsnSac}` : ""}${i.stockQty !== undefined ? ` · ${i.stockQty} ${i.unit} in stock` : ""}` })}
      footer={
        allowCreate
          ? (query, close) =>
              query.trim().length >= 2 && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  className="mt-1 w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
                  onClick={async () => {
                    onPick(await api.post<ItemOption>("/items", { name: query.trim(), type: "product", unit: "pcs", pricePaise: 0, gstRateBp: defaultGstRateBp }))
                    close()
                  }}
                >
                  + Add &ldquo;{query.trim()}&rdquo; as a new item
                </button>
              )
          : undefined
      }
    />
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
