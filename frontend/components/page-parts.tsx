"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Check, ChevronRight, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { tone } from "@/lib/tones"
import { cn } from "@/lib/utils"

// The building blocks of every record page and list row in the ERP, taken from the CRM design:
// back link, header with pills and actions, stat cards, a status stepper, tabs, sections,
// a details grid and the ⋮ action menu. Use these instead of one-off markup.

export function Pill({ color = "slate", dot, strike, className, children, title }: { color?: string; dot?: boolean; strike?: boolean; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-[22px] w-fit items-center gap-1.5 rounded-full px-2 text-xs font-semibold whitespace-nowrap", tone(color).pill, strike && "line-through", className)}>
      {dot && <span className={cn("size-1.5 rounded-full", tone(color).dot)} />}
      {children}
    </span>
  )
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {children}</Link>
}

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?"

/** Title row of a record page: picture or initials, name, pills, a line under it, and the actions */
export function DetailHeader({ title, pills, subtitle, extra, actions, icon: Icon, imageUrl, initials }: {
  title: React.ReactNode
  pills?: React.ReactNode
  subtitle?: React.ReactNode
  /** Labels or anything else under the subtitle */
  extra?: React.ReactNode
  actions?: React.ReactNode
  icon?: React.ElementType
  imageUrl?: string | null
  /** Shows initials of this name when there is no picture or icon */
  initials?: string
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {(imageUrl || Icon || initials) && (
          <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-primary/10 text-lg font-bold text-primary">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {imageUrl ? <img src={imageUrl} alt="" className="size-full object-cover" /> : Icon ? <Icon className="size-6" aria-hidden /> : initialsOf(initials!)}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">{title} {pills}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          {extra && <div className="mt-1">{extra}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export interface Stat { label: string; value: React.ReactNode; hint?: React.ReactNode; accent?: string; href?: string }

export function StatGrid({ items, className }: { items: (Stat | false | null | undefined)[]; className?: string }) {
  const list = items.filter(Boolean) as Stat[]
  return (
    <div className={cn("grid grid-cols-2 gap-3", list.length >= 4 ? "lg:grid-cols-4" : list.length === 3 ? "lg:grid-cols-3" : "", className)}>
      {list.map((s) => {
        const body = (<><p className="text-xs text-muted-foreground">{s.label}</p><p className={cn("text-lg font-semibold tabular-nums", s.accent)}>{s.value}</p>{s.hint && <p className="text-xs text-muted-foreground">{s.hint}</p>}</>)
        return s.href ? <Link key={s.label} href={s.href} className="ui-surface grid gap-1 p-4 transition-shadow hover:shadow-md">{body}</Link> : <div key={s.label} className="ui-surface grid gap-1 p-4">{body}</div>
      })}
    </div>
  )
}

export interface Step { key: string; label: string; sub?: string; state: "done" | "current" | "todo"; color?: string }

/** A row of steps (stages, or Draft → Posted → Paid). Clickable when `onStep` is given. */
export function Steps({ steps, onStep, end, label = "Progress" }: { steps: Step[]; onStep?: (key: string) => void; end?: React.ReactNode; label?: string }) {
  return (
    <ol className="flex w-full overflow-x-auto rounded-2xl border bg-card p-1 text-sm" aria-label={label}>
      {steps.map((s) => (
        <li key={s.key} className="min-w-28 flex-1">
          <button
            type="button"
            disabled={!onStep || s.state === "current"}
            onClick={() => onStep?.(s.key)}
            className={cn("flex h-11 w-full flex-col items-center justify-center rounded-xl px-3 leading-tight font-medium whitespace-nowrap transition-colors disabled:cursor-default",
              s.state === "current" ? cn(tone(s.color ?? "blue").pill, "font-semibold") : s.state === "done" ? "text-foreground" : "text-muted-foreground",
              onStep && s.state !== "current" && "hover:bg-muted")}
          >
            <span className="flex items-center gap-1.5">
              {s.state === "done" ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <span className={cn("size-2 rounded-full", s.state === "current" ? tone(s.color ?? "blue").dot : "bg-muted-foreground/30")} />}
              {s.label}
            </span>
            {s.sub && <span className="text-[10px] font-normal opacity-70">{s.sub}</span>}
          </button>
        </li>
      ))}
      {end && <li className="min-w-28 flex-1">{end}</li>}
    </ol>
  )
}

export interface TabDef<K extends string> { key: K; label: string; count?: number | null; hidden?: boolean }

export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: TabDef<K>[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="flex flex-wrap gap-1 overflow-x-auto border-b" role="tablist">
      {tabs.filter((t) => !t.hidden).map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap", value === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {t.label}{t.count ? <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{t.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** A card with a title row */
export function Section({ title, description, action, children, className, flush }: { title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn("ui-surface overflow-hidden", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b px-5 py-3.5">
          <div>{title && <h2 className="font-semibold">{title}</h2>}{description && <p className="text-xs text-muted-foreground">{description}</p>}</div>
          {action}
        </div>
      )}
      <div className={flush ? undefined : "p-5"}>{children}</div>
    </section>
  )
}

/** Label / value pairs in a grid */
export function DetailList({ items, cols = 2 }: { items: ([React.ReactNode, React.ReactNode] | false | null | undefined)[]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-3 text-sm", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-3")}>
      {(items.filter(Boolean) as [React.ReactNode, React.ReactNode][]).map(([k, v], i) => (
        <div key={i} className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium break-words">{v === null || v === undefined || v === "" ? "—" : v}</dd></div>
      ))}
    </dl>
  )
}

export type MenuItem =
  | { label: string; icon?: React.ElementType; onClick?: () => void; href?: string; destructive?: boolean; disabled?: boolean; hint?: string; sub?: MenuItem[] }
  | "-"
  | false
  | ""
  | 0
  | null
  | undefined

/** The ⋮ menu on rows, cards and record pages. Separators collapse when the items around them are hidden. */
export function ActionMenu({ items, label = "More actions", align = "end", trigger }: { items: MenuItem[]; label?: string; align?: "start" | "end"; trigger?: React.ReactElement }) {
  const router = useRouter()
  const shown = items.filter(Boolean) as Exclude<MenuItem, false | null | undefined | "" | 0>[]
  // Drop separators at the ends and doubled ones
  const clean = shown.filter((m, i) => m !== "-" || (i > 0 && i < shown.length - 1 && shown[i - 1] !== "-"))
  if (!clean.some((m) => m !== "-")) return null
  const render = (m: Exclude<MenuItem, false | null | undefined | "" | 0>, i: number): React.ReactNode => {
    if (m === "-") return <DropdownMenuSeparator key={`s${i}`} />
    const Icon = m.icon
    if (m.sub?.length) {
      return (
        <DropdownMenuSub key={m.label}>
          <DropdownMenuSubTrigger disabled={m.disabled}>{Icon && <Icon />} {m.label}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>{(m.sub.filter(Boolean) as Exclude<MenuItem, false | null | undefined | "" | 0>[]).map(render)}</DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }
    return (
      <DropdownMenuItem key={m.label} disabled={m.disabled} variant={m.destructive ? "destructive" : "default"} onClick={() => (m.href ? router.push(m.href) : m.onClick?.())}>
        {Icon && <Icon />} {m.label}{m.hint && <span className="ml-auto text-xs text-muted-foreground">{m.hint}</span>}
      </DropdownMenuItem>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger ?? <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={(e) => e.stopPropagation()} />}>{!trigger && <MoreHorizontal />}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56" onClick={(e) => e.stopPropagation()}>{clean.map(render)}</DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Initials in a circle, for people and companies in lists */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return <span className={cn("grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary", className)}>{initialsOf(name)}</span>
}

/** "→" link to a related record inside text */
export function RecordLink({ href, children, mono }: { href: string; children: React.ReactNode; mono?: boolean }) {
  return <Link href={href} onClick={(e) => e.stopPropagation()} className={cn("inline-flex items-center gap-0.5 text-primary hover:underline", mono && "font-mono text-xs")}>{children}<ChevronRight className="size-3 opacity-60" aria-hidden /></Link>
}
