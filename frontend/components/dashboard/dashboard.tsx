"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronDown, GripVertical, Plus } from "lucide-react"
import { addDays, daysBetween, type DashboardLayout, type DashboardPrefs, type DashboardTab, type RangePreset } from "@contracts/dashboard"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, NativeSelect } from "@/components/form"
import { ErrorState } from "@/components/page-states"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { queryFor, splitWidgetKey, usePrefsSaver, useTabData, type DashboardConfig, type Query } from "@/lib/dashboard"
import { cn } from "@/lib/utils"
import { TAB_WIDGETS, type WidgetCtx } from "./tabs"
import { FinishSetupCard } from "./finish-setup"
import { HandoverCard } from "./handover-card"

// Dashboard v2 (wireframes 5.1–5.8): one range for every tab, a tab per module the person
// can see, per-person widget layout.

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
]

const NEW_ITEMS = [
  { label: "Invoice", href: "/app/m/billing/new", permission: "billing.invoice.create" },
  { label: "Quotation", href: "/app/m/sales/new", permission: "sales.quotation.create" },
  { label: "Customer", href: "/app/m/crm", permission: "crm.contact.create" },
  { label: "Appointment", href: "/app/m/bookings", permission: "bookings.appointment.create" },
  { label: "Expense", href: "/app/m/finance", permission: "finance.expense.create" },
  { label: "Task", href: "/app/m/tasks", permission: "tasks.task.create" },
]

function greeting() {
  const h = new Date(Date.now() + 330 * 60_000).getUTCHours()
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
}

export function Dashboard() {
  const { data, error, reload } = useApi<DashboardConfig>("/dashboard/config")
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-10 rounded-xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[86px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    )
  }
  if (!data.tabs.length) {
    return <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Your role has no dashboard. Use the menu to open your work.</p>
  }
  return <DashboardView config={data} />
}

function DashboardView({ config }: { config: DashboardConfig }) {
  const { me, can, term } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const save = usePrefsSaver()
  const [prefs, setPrefs] = React.useState<DashboardPrefs>(config.prefs)
  const [customizing, setCustomizing] = React.useState(false)
  const [customRange, setCustomRange] = React.useState(false)

  const update = (patch: Partial<DashboardPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }))
    save(patch)
  }

  const tabs = config.tabs.filter((t) => t.key === "overview" || !prefs.hiddenTabs.includes(t.key))
  const fromUrl = params.get("tab") as DashboardTab | null
  const active = (tabs.find((t) => t.key === fromUrl) ?? tabs.find((t) => t.key === prefs.lastTab) ?? tabs.find((t) => t.key === config.defaultTab) ?? tabs[0]).key
  const activeTab = config.tabs.find((t) => t.key === active)!

  const weekStart = "monday"
  const q: Query = queryFor(prefs, config.today, weekStart)
  const branch = config.branches.find((b) => b.id === prefs.branchId)

  const openTab = (key: DashboardTab) => {
    update({ lastTab: key })
    const sp = new URLSearchParams(params)
    sp.set("tab", key)
    router.replace(`${pathname}?${sp}`, { scroll: false })
  }

  const firstName = me?.user.name.split(" ")[0] ?? ""
  const isMyDay = active === "myday"
  const sub = `${new Date(`${config.today}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · ${isMyDay ? "your work only" : (me?.tenant?.name ?? "")}`

  return (
    <div className="flex flex-col gap-3">
      <HandoverCard />
      <FinishSetupCard />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-input" role="radiogroup" aria-label="Date range">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={prefs.range === p.key}
                onClick={() => (p.key === "custom" ? setCustomRange(true) : update({ range: p.key }))}
                className={cn("border-r border-input px-[11px] py-[7px] text-xs font-semibold last:border-r-0", prefs.range === p.key ? "bg-accent text-accent-foreground" : "bg-card hover:bg-muted")}
              >
                {p.key === "custom" && prefs.range === "custom" ? `${formatDate(q.from)} – ${formatDate(q.to)}` : p.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" className="size-4 accent-primary" checked={prefs.compare} onChange={(e) => update({ compare: e.target.checked })} />
            vs previous period
          </label>
          {config.branches.length > 0 && (
            <NativeSelect className="h-8 w-40 text-xs font-semibold" aria-label="Branch" value={prefs.branchId ?? ""} onChange={(e) => update({ branchId: e.target.value || null })}>
              <option value="">All branches</option>
              {config.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          )}
          <NewMenu can={can} />
        </div>
      </div>

      <div className="flex items-center gap-5 overflow-x-auto overflow-y-hidden border-b [scrollbar-width:none]" role="tablist" aria-label="Dashboard">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => openTab(t.key)}
            className={cn("-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-0.5 py-[9px] text-[13px] font-semibold text-muted-foreground hover:text-foreground", active === t.key && "border-primary text-foreground")}
          >
            {t.label}
            {t.readOnly && <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-foreground/80">Read-only</span>}
          </button>
        ))}
        <button type="button" onClick={() => setCustomizing(true)} className="ml-auto shrink-0 py-[9px] text-xs font-semibold text-primary hover:underline">
          Customize
        </button>
      </div>

      {activeTab.readOnly && (
        <div className="rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {activeTab.label} is read-only on your current plan, so new entries can&apos;t be added. Figures already recorded stay visible.{" "}
          {can("tenant.billing.view") ? (
            <Link href="/app/billing" className="font-semibold text-primary underline">
              Upgrade
            </Link>
          ) : (
            <em>Ask your owner to upgrade.</em>
          )}
        </div>
      )}

      {prefs.compare && <p className="-mt-1 text-[11px] text-muted-foreground">{compareNote(q)}</p>}
      {branch && <p className="-mt-1 text-[11px] text-muted-foreground">Showing {branch.name} only</p>}

      <TabBody key={active} tab={active} q={q} layout={prefs.layouts[active]} ctxBase={{ can, term, go: (href) => router.push(href) }} />

      <CustomizeDialog
        open={customizing}
        onClose={() => setCustomizing(false)}
        tab={active}
        tabLabel={activeTab.label}
        config={config}
        layout={prefs.layouts[active]}
        hiddenTabs={prefs.hiddenTabs}
        onSave={(layout, hide) => {
          const layouts = { ...prefs.layouts, [active]: layout }
          const hiddenTabs = hide === undefined ? prefs.hiddenTabs : hide ? [...new Set([...prefs.hiddenTabs, active])] : prefs.hiddenTabs.filter((x) => x !== active)
          update({ layouts, hiddenTabs })
        }}
      />
      <CustomRangeDialog
        open={customRange}
        today={config.today}
        initial={q}
        onClose={() => setCustomRange(false)}
        onApply={(from, to) => {
          update({ range: "custom", from, to })
          setCustomRange(false)
        }}
      />
    </div>
  )
}

function compareNote(q: Query) {
  const n = daysBetween(q.from, q.to)
  const prevTo = addDays(q.from, -1)
  const prevFrom = addDays(q.from, -n)
  return `Changes compare with ${formatDate(prevFrom)} – ${formatDate(prevTo)} (the same number of days just before).`
}

function NewMenu({ can }: { can: (p: string) => boolean }) {
  const items = NEW_ITEMS.filter((i) => can(i.permission))
  const router = useRouter()
  if (!items.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90">
        <Plus className="size-3.5" /> New <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {items.map((i) => (
          <DropdownMenuItem key={i.label} onClick={() => router.push(i.href)}>
            {i.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A tab's widgets in the person's order; widgets added from other tabs load that tab's data. */
function TabBody({ tab, q, layout, ctxBase }: { tab: DashboardTab; q: Query; layout?: DashboardLayout; ctxBase: Pick<WidgetCtx, "can" | "term" | "go"> }) {
  const own = useTabData(tab, q)
  const defs = TAB_WIDGETS[tab]
  const keys = orderedKeys(tab, layout)
  if (own.error) return <ErrorState error={own.error} onRetry={own.reload} />
  const ctx: WidgetCtx = { ...ctxBase, q, reload: own.reload, slow: own.slow }
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[repeat(30,minmax(0,1fr))]">
      {keys.map((k) => {
        const [from, w] = splitWidgetKey(k, tab)
        if (from !== tab) return <CrossWidget key={k} tab={from} widget={w} q={q} ctxBase={ctxBase} />
        const def = defs[w]
        if (!def) return null
        return (
          <div key={k} className="min-w-0 lg:[grid-column:span_var(--span)/span_var(--span)]" style={{ "--span": def.span } as React.CSSProperties}>
            {def.render(own.data ? own.data[w] : undefined, ctx)}
          </div>
        )
      })}
    </div>
  )
}

function CrossWidget({ tab, widget, q, ctxBase }: { tab: DashboardTab; widget: string; q: Query; ctxBase: Pick<WidgetCtx, "can" | "term" | "go"> }) {
  const d = useTabData(tab, q)
  const def = TAB_WIDGETS[tab]?.[widget]
  if (!def) return null
  const span = def.span === 30 ? 30 : 15
  return (
    <div className="min-w-0 lg:[grid-column:span_var(--span)/span_var(--span)]" style={{ "--span": span } as React.CSSProperties}>
      {def.render(d.error ? { error: d.error.message } : d.data ? d.data[widget] : undefined, { ...ctxBase, q, reload: d.reload, slow: d.slow })}
    </div>
  )
}

function orderedKeys(tab: DashboardTab, layout?: DashboardLayout) {
  const own = Object.keys(TAB_WIDGETS[tab])
  const order = layout?.order ?? []
  const keys = [...order.filter((k) => own.includes(k) || k.includes(".")), ...own.filter((k) => !order.includes(k))]
  return keys.filter((k) => !(layout?.hidden ?? []).includes(k))
}

function CustomizeDialog({
  open,
  onClose,
  tab,
  tabLabel,
  config,
  layout,
  hiddenTabs,
  onSave,
}: {
  open: boolean
  onClose: () => void
  tab: DashboardTab
  tabLabel: string
  config: DashboardConfig
  layout?: DashboardLayout
  hiddenTabs: DashboardTab[]
  onSave: (layout: DashboardLayout, hideTab?: boolean) => void
}) {
  const labelOf = (k: string) => {
    const [t, w] = splitWidgetKey(k, tab)
    const label = config.widgets[t]?.find((x) => x.key === w)?.label ?? w
    return t === tab ? label : label
  }
  const fromOf = (k: string) => (k.includes(".") ? config.tabs.find((t) => t.key === k.split(".")[0])?.label : null)
  const initial = React.useMemo(() => {
    const own = config.widgets[tab].map((w) => w.key)
    const order = layout?.order ?? []
    return { order: [...order.filter((k) => own.includes(k) || k.includes(".")), ...own.filter((k) => !order.includes(k))], hidden: layout?.hidden ?? [] }
  }, [config.widgets, tab, layout])
  const [order, setOrder] = React.useState(initial.order)
  const [hidden, setHidden] = React.useState<string[]>(initial.hidden)
  const [hideTab, setHideTab] = React.useState(hiddenTabs.includes(tab))
  const [drag, setDrag] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setOrder(initial.order)
      setHidden(initial.hidden)
      setHideTab(hiddenTabs.includes(tab))
    })
    return () => clearTimeout(t)
  }, [open, initial, hiddenTabs, tab])

  // Widgets of the person's other tabs that can be added here (not KPI rows)
  const addable = config.tabs
    .filter((t) => t.key !== tab)
    .flatMap((t) => config.widgets[t.key].filter((w) => w.key !== "kpis").map((w) => ({ key: `${t.key}.${w.key}`, label: w.label, from: t.label })))
    .filter((w) => !order.includes(w.key))
    .slice(0, 8)

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    setOrder(next)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tabLabel} widgets</DialogTitle>
          <DialogDescription>Drag or use the arrows to reorder. Untick to hide. Only for you.</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1.5">
          {order.map((k, i) => (
            <li
              key={k}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => {
                e.preventDefault()
                if (drag === null || drag === i) return
                const next = [...order]
                const [it] = next.splice(drag, 1)
                next.splice(i, 0, it)
                setOrder(next)
                setDrag(i)
              }}
              onDragEnd={() => setDrag(null)}
              className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[13px]", drag === i && "border-primary bg-accent/40")}
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {labelOf(k)}
                {fromOf(k) && <span className="text-xs text-muted-foreground"> · from {fromOf(k)}</span>}
              </span>
              <button type="button" className="rounded px-1 text-muted-foreground hover:bg-muted disabled:opacity-30" aria-label={`Move ${labelOf(k)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="rounded px-1 text-muted-foreground hover:bg-muted disabled:opacity-30" aria-label={`Move ${labelOf(k)} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              {k.includes(".") ? (
                <button type="button" className="text-xs text-destructive hover:underline" onClick={() => setOrder(order.filter((x) => x !== k))}>
                  Remove
                </button>
              ) : (
                <input type="checkbox" className="size-4 accent-primary" aria-label={`Show ${labelOf(k)}`} checked={!hidden.includes(k)} onChange={(e) => setHidden(e.target.checked ? hidden.filter((x) => x !== k) : [...hidden, k])} />
              )}
            </li>
          ))}
        </ul>
        {addable.length > 0 && (
          <div className="grid gap-1.5">
            <p className="border-t pt-2 text-xs font-semibold text-muted-foreground">Add a widget</p>
            {addable.map((w) => (
              <button key={w.key} type="button" onClick={() => setOrder([...order, w.key])} className="flex items-center gap-2 rounded-lg border border-dashed border-input px-2.5 py-2 text-left text-[13px] text-foreground/80 hover:border-primary/50">
                + {w.label}
                <span className="ml-auto text-xs text-muted-foreground">from {w.from}</span>
              </button>
            ))}
          </div>
        )}
        {tab !== "overview" && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" className="size-4 accent-primary" checked={hideTab} onChange={(e) => setHideTab(e.target.checked)} />
            Hide the {tabLabel} tab for me
          </label>
        )}
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => (setOrder(config.widgets[tab].map((w) => w.key)), setHidden([]), setHideTab(false))}>
            Reset to role default
          </Button>
          <Button
            onClick={() => {
              onSave({ order, hidden }, tab === "overview" ? undefined : hideTab)
              onClose()
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CustomRangeDialog({ open, today, initial, onClose, onApply }: { open: boolean; today: string; initial: Query; onClose: () => void; onApply: (from: string, to: string) => void }) {
  const [from, setFrom] = React.useState(initial.from)
  const [to, setTo] = React.useState(initial.to)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setFrom(initial.from)
      setTo(initial.to)
      setError(null)
    })
    return () => clearTimeout(t)
  }, [open, initial.from, initial.to])
  const apply = () => {
    if (!from || !to) return setError("Choose both dates")
    if (from > to) return setError("The start date is after the end date")
    if (to > today) return setError("The end date can't be in the future")
    if (daysBetween(from, to) > 731) return setError("Choose up to 2 years")
    onApply(from, to)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Custom range</DialogTitle>
          <DialogDescription>Every tab uses this range.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" error={error}>
            <Input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["Last 7 days", addDays(today, -6)],
            ["Last 30 days", addDays(today, -29)],
            ["Last 90 days", addDays(today, -89)],
            ["This FY", fyStart(today)],
          ].map(([label, f]) => (
            <button key={label} type="button" className="rounded-md border px-2 py-1 text-xs hover:bg-muted" onClick={() => (setFrom(f), setTo(today))}>
              {label}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const fyStart = (today: string) => {
  const y = Number(today.slice(0, 4))
  return Number(today.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01`
}
