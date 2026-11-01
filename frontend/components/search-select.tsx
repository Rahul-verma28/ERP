"use client"

import * as React from "react"
import { Popover } from "@base-ui/react/popover"
import { Check, ChevronDown, Search } from "lucide-react"
import { GST_STATES } from "@contracts/validation"
import { INDUSTRIES, industryByKey } from "@contracts/workspace"
import { cn } from "@/lib/utils"

// The one dropdown used across the product. Long lists get a search box; State and Industry
// are ready-made below so every form shows the same list, A to Z.

export interface SelectOption {
  value: string
  label: string
  /** Extra words the search also looks at */
  keywords?: string
  disabled?: boolean
}

export interface SearchSelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  /** Default: lists of 8 or more */
  searchable?: boolean
  /** A to Z, with an empty choice first and anything starting "Other" last */
  sort?: boolean
  onBlur?: () => void
  disabled?: boolean
  id?: string
  name?: string
  className?: string
  "aria-label"?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
  "aria-required"?: boolean
}

const rank = (o: SelectOption) => (!o.value ? 0 : /^other\b/i.test(o.label) ? 2 : 1)
const sorted = (options: SelectOption[]) => [...options].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))

export function SearchSelect({ value, onChange, options, placeholder = "Choose…", searchPlaceholder = "Search…", searchable, sort, onBlur, disabled, className, ...trigger }: SearchSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const all = React.useMemo(() => (sort ? sorted(options) : options), [options, sort])
  const showSearch = searchable ?? all.length >= 8
  const q = query.trim().toLowerCase()
  const shown = q ? all.filter((o) => `${o.label} ${o.keywords ?? ""}`.toLowerCase().includes(q)) : all
  const selected = all.find((o) => o.value === value)

  const change = (next: boolean) => {
    setOpen(next)
    setQuery("")
    setActive(Math.max(0, all.findIndex((o) => o.value === value)))
    if (!next) onBlur?.()
  }
  const pick = (o?: SelectOption) => {
    if (!o || o.disabled) return
    onChange(o.value)
    change(false)
  }
  const move = (step: number) => {
    const next = Math.min(shown.length - 1, Math.max(0, active + step))
    setActive(next)
    listRef.current?.children[next]?.scrollIntoView({ block: "nearest" })
  }

  return (
    <Popover.Root open={open} onOpenChange={change}>
      <Popover.Trigger
        type="button"
        disabled={disabled}
        data-slot="search-select"
        aria-haspopup="listbox"
        {...trigger}
        className={cn(
          "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm text-foreground transition-[color,box-shadow,border-color] outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:bg-destructive/[0.03] data-popup-open:border-primary data-popup-open:ring-3 data-popup-open:ring-primary/20",
          className
        )}
      >
        <span className={cn("min-w-0 truncate", !value && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start" className="z-[60]" collisionPadding={8}>
          <Popover.Popup
            initialFocus={() => inputRef.current ?? true}
            className="w-max max-w-[min(24rem,90vw)] min-w-(--anchor-width) overflow-hidden rounded-lg border bg-popover text-sm text-popover-foreground shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
            onKeyDown={(e) => {
              if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return
              e.preventDefault()
              if (e.key === "Enter") pick(shown[active])
              else move(e.key === "ArrowDown" ? 1 : -1)
            }}
          >
            {showSearch && (
              <div className="relative border-b">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setActive(0)
                  }}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="h-10 w-full bg-transparent pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            )}
            <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto p-1">
              {shown.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  disabled={o.disabled}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o)}
                  className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left disabled:opacity-50", i === active && "bg-muted", o.value === value && "font-medium text-primary")}
                >
                  <span className="min-w-0">{o.label}</span>
                  {o.value === value && <Check className="size-4 shrink-0" aria-hidden />}
                </button>
              ))}
              {!shown.length && <p className="px-2.5 py-3 text-center text-muted-foreground">Nothing matches “{query.trim()}”</p>}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

type ListSelectProps = Omit<SearchSelectProps, "options" | "sort" | "searchable"> & { value: string | null | undefined; /** Label for an empty choice, e.g. "Any state" */ emptyLabel?: string }

const STATE_OPTIONS: SelectOption[] = GST_STATES.map(([value, label]) => ({ value, label }))
const INDUSTRY_OPTIONS: SelectOption[] = INDUSTRIES.map((i) => ({ value: i.key, label: i.name, keywords: `${i.keywords ?? ""} ${i.sub.join(" ")}` }))
const withEmpty = (options: SelectOption[], emptyLabel?: string) => (emptyLabel ? [{ value: "", label: emptyLabel }, ...options] : options)

export function StateSelect({ value, emptyLabel, placeholder = "Choose a state", searchPlaceholder = "Search states…", ...props }: ListSelectProps) {
  return <SearchSelect {...props} value={value ?? ""} options={withEmpty(STATE_OPTIONS, emptyLabel)} placeholder={placeholder} searchPlaceholder={searchPlaceholder} sort searchable />
}

export function IndustrySelect({ value, emptyLabel, placeholder = "Choose an industry", searchPlaceholder = "Search, e.g. salon, kirana, clinic…", ...props }: ListSelectProps) {
  return <SearchSelect {...props} value={industryByKey(value)?.key ?? ""} options={withEmpty(INDUSTRY_OPTIONS, emptyLabel)} placeholder={placeholder} searchPlaceholder={searchPlaceholder} sort searchable />
}
