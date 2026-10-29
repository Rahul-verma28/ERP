"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useNav } from "@/components/console/console-nav"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useConsoleBase } from "@/lib/console-base"
import type { ClientRow } from "@/lib/console"
import { cn } from "@/lib/utils"

// Console Ctrl + K: businesses first, then actions and pages. Results follow the person's
// scope: the API only returns businesses they may see.

interface Hit {
  group: "Businesses" | "Actions" | "Pages"
  title: string
  detail?: string
  href: string
}

export function ConsolePalette() {
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
        className="hidden h-9 w-full max-w-sm min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-3 text-left text-[13px] whitespace-nowrap text-muted-foreground hover:border-primary/40 md:flex"
        aria-label="Search the Console (Ctrl + K)"
      >
        <Search className="size-4 shrink-0" /> <span className="truncate">Search businesses and pages…</span>
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
  const { canConsole, me } = useAuth()
  const base = useConsoleBase()
  const { groups, settings } = useNav()
  const [q, setQ] = React.useState("")
  const [records, setRecords] = React.useState<Hit[]>([])
  const [loading, setLoading] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const query = q.trim()

  React.useEffect(() => {
    if (query.length < 2) return
    let live = true
    const t = setTimeout(() => {
      setLoading(true)
      api
        .get<{ data: ClientRow[] }>(`/console/tenants?limit=6&partners=include&search=${encodeURIComponent(query)}`)
        .then((r) => live && setRecords(r.data.map((c) => ({ group: "Businesses", title: c.name, detail: [c.owner?.name, c.plan].filter(Boolean).join(" · "), href: `${base}/clients/${c.id}` }))))
        .catch(() => live && setRecords([]))
        .finally(() => live && setLoading(false))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query, base])

  const lower = query.toLowerCase()
  const team = me?.console?.audience === "team"
  const actions: Hit[] = [
    ...(canConsole("platform.tenant.create") ? [{ group: "Actions" as const, title: "Onboard a business", href: `${base}/clients/new` }] : []),
    ...(team && canConsole("platform.partner.create") ? [{ group: "Actions" as const, title: "Add a partner", href: "/console/partners" }] : []),
    ...(canConsole("platform.member.create") ? [{ group: "Actions" as const, title: "Add a person", href: `${base}/team` }] : []),
  ]
  const pages: Hit[] = [
    ...groups.flatMap((g) => g.items.map((i) => ({ group: "Pages" as const, title: i.label, detail: g.label, href: i.href }))),
    ...(settings ? [{ group: "Pages" as const, title: settings.label, href: settings.href }] : []),
    { group: "Pages", title: "My account", href: `${base}/account` },
    { group: "Pages", title: "Password & two-step", href: `${base}/account/security` },
  ]
  const matching = (h: Hit) => !lower || h.title.toLowerCase().includes(lower)
  const hits: Hit[] = [...(query.length >= 2 ? records : []), ...actions.filter(matching), ...pages.filter(matching).slice(0, lower ? 8 : 6)]
  const safeActive = Math.min(active, Math.max(0, hits.length - 1))

  const go = (h: Hit) => {
    onClose()
    router.push(h.href)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[12vh] translate-y-0 gap-0 p-0 sm:max-w-2xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Search the Console</DialogTitle>
        <DialogDescription className="sr-only">Businesses, actions and pages</DialogDescription>
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
            placeholder="Business name, owner, mobile, GSTIN or a page…"
            aria-label="Search"
            role="combobox"
            aria-expanded
            aria-controls="console-palette-results"
            aria-activedescendant={hits[safeActive] ? `chit-${safeActive}` : undefined}
            className="h-12 flex-1 bg-transparent text-sm outline-none"
          />
          {loading && <span className="text-xs text-muted-foreground">Searching…</span>}
        </div>
        <ul id="console-palette-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
          {query.length >= 2 && !loading && !records.length && <li className="px-2.5 py-2 text-xs text-muted-foreground">No businesses match “{query}”.</li>}
          {hits.map((h, i) => (
            <React.Fragment key={`${h.group}-${h.href}-${h.title}`}>
              {(i === 0 || hits[i - 1].group !== h.group) && <li className="px-2.5 pt-2 pb-1 text-xs font-semibold text-muted-foreground">{h.group}</li>}
              <li
                id={`chit-${i}`}
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
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">↑ ↓ to move · Enter to open · Esc to close · only businesses you can see</p>
      </DialogContent>
    </Dialog>
  )
}
