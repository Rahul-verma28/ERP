"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { SETTINGS_GROUPS } from "@/components/settings-shell"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { MODULE_NAV } from "@/lib/nav"
import { cn } from "@/lib/utils"

// Ctrl + K (wireframe 5.8-D): records, then actions and pages. Keyboard first: ↑ ↓ Enter, Esc.
// Results follow the person's permissions and field access (the API decides).

interface Hit {
  group: "Records" | "Actions and pages"
  title: string
  detail?: string
  href: string
}

const ACTIONS = [
  { title: "New invoice", href: "/app/m/billing/new", permission: "billing.invoice.create" },
  { title: "New quotation", href: "/app/m/sales/new", permission: "sales.quotation.create" },
  { title: "Book appointment", href: "/app/m/bookings", permission: "bookings.appointment.create" },
  { title: "Add customer", href: "/app/m/crm", permission: "crm.contact.create" },
  { title: "Add expense", href: "/app/m/finance", permission: "finance.expense.create" },
  { title: "New task", href: "/app/m/tasks", permission: "tasks.task.create" },
]

export function CommandPalette() {
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-9 w-64 items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-[13px] text-muted-foreground hover:border-primary/40 md:flex"
        aria-label="Search everything (Ctrl + K)"
      >
        <Search className="size-4" /> Search…
        <kbd className="ml-auto rounded border bg-muted px-1.5 font-mono text-[10px]">Ctrl K</kbd>
      </button>
      <button type="button" onClick={() => setOpen(true)} className="grid size-9 place-items-center rounded-lg hover:bg-muted md:hidden" aria-label="Search">
        <Search className="size-4" />
      </button>
      {open && <Palette onClose={() => setOpen(false)} />}
    </>
  )
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { can, canView, term } = useAuth()
  const [q, setQ] = React.useState("")
  const [records, setRecords] = React.useState<Hit[]>([])
  const [contact, setContact] = React.useState<{ id: string; name: string } | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const query = q.trim()

  React.useEffect(() => {
    if (query.length < 2) return
    let live = true
    const t = setTimeout(() => {
      setLoading(true)
      api
        .get<{ records: { title: string; detail: string; href: string }[]; contactForActions: { id: string; name: string } | null }>(`/search?q=${encodeURIComponent(query)}`)
        .then((r) => {
          if (!live) return
          setRecords(r.records.map((x) => ({ group: "Records", ...x })))
          setContact(r.contactForActions)
        })
        .catch(() => live && setRecords([]))
        .finally(() => live && setLoading(false))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])

  const lower = query.toLowerCase()
  const pages: Hit[] = [
    ...MODULE_NAV.filter((m) => canView(m.key)).map((m) => ({ group: "Actions and pages" as const, title: m.termKey ? term(m.termKey, m.label) : m.label, detail: "Module", href: `/app/m/${m.key}` })),
    ...SETTINGS_GROUPS.flatMap((g) => g.items.filter((i) => !i.later && can(i.permission)).map((i) => ({ group: "Actions and pages" as const, title: `Settings › ${i.label}`, href: i.href }))),
    { group: "Actions and pages", title: "My account", href: "/app/account" },
    { group: "Actions and pages", title: "Security & two-step verification", href: "/app/account#security" },
  ]
  const actions: Hit[] = [
    ...(contact && query.length >= 2 ? [{ group: "Actions and pages" as const, title: `New invoice for ${contact.name}`, href: `/app/m/billing/new?contact=${contact.id}` }] : []),
    ...ACTIONS.filter((a) => can(a.permission)).map((a) => ({ group: "Actions and pages" as const, title: a.title, href: a.href })),
  ]
  const matching = (h: Hit) => !lower || h.title.toLowerCase().includes(lower)
  const hits: Hit[] = [...(query.length >= 2 ? records : []), ...actions.filter(matching).slice(0, 4), ...pages.filter(matching).slice(0, lower ? 6 : 4)]
  const safeActive = Math.min(active, Math.max(0, hits.length - 1))

  const go = (h: Hit) => {
    onClose()
    router.push(h.href)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[12vh] translate-y-0 gap-0 p-0 sm:max-w-2xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Search everything</DialogTitle>
        <DialogDescription className="sr-only">Customers, invoices, quotations, appointments, items, actions and pages</DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, hits.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === "Enter" && hits[safeActive]) {
                e.preventDefault()
                go(hits[safeActive])
              }
            }}
            placeholder="Search customers, invoices, appointments, pages…"
            aria-label="Search"
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            aria-activedescendant={hits[safeActive] ? `hit-${safeActive}` : undefined}
            className="h-12 flex-1 bg-transparent text-sm outline-none"
          />
          {loading && <span className="text-xs text-muted-foreground">Searching…</span>}
        </div>
        <ul id="palette-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
          {query.length >= 2 && !loading && !records.length && <li className="px-2.5 py-2 text-xs text-muted-foreground">No records match “{query}”.</li>}
          {hits.map((h, i) => (
            <React.Fragment key={`${h.group}-${h.href}-${h.title}`}>
              {(i === 0 || hits[i - 1].group !== h.group) && <li className="px-2.5 pt-2 pb-1 text-xs font-semibold text-muted-foreground">{h.group}</li>}
              <li
                id={`hit-${i}`}
                role="option"
                aria-selected={i === safeActive}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={cn("cursor-pointer rounded-lg px-2.5 py-[7px] text-[13px]", i === safeActive && "bg-accent")}
              >
                <strong className="font-semibold">{h.title}</strong>
                {h.detail && <span className="text-muted-foreground"> · {h.detail}</span>}
              </li>
            </React.Fragment>
          ))}
        </ul>
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">↑ ↓ to move · Enter to open · Esc to close · results follow your permissions</p>
      </DialogContent>
    </Dialog>
  )
}
