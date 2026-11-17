"use client"

import * as React from "react"
import { ExternalLink, type LucideIcon } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Avatar } from "@/components/page-parts"
import { cn } from "@/lib/utils"

// One "View" dialog for every record: a title with its status, then a grid of small
// cards — one per field — so everything about the record is on one screen.

export interface ViewField {
  label: string
  value: React.ReactNode
  icon?: LucideIcon
  /** Spans both columns, for long text */
  full?: boolean
  /** Shows an avatar with the name and a second line */
  person?: { name: string; sub?: string | null }
  /** A link: shown as "Open" */
  href?: string | null
  tone?: "danger" | "success"
}

export function RecordView({ title, icon: Icon, status, fields, footer, onClose, wide }: { title: string; icon?: LucideIcon; status?: React.ReactNode; fields: (ViewField | false | null | undefined)[]; footer?: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const list = fields.filter(Boolean) as ViewField[]
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto", wide ? "sm:max-w-3xl" : "sm:max-w-2xl")}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            {Icon && <span className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-4" /></span>}
            <span className="mr-auto">{title}</span>
            {status}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((f, i) => (
            <div key={`${f.label}${i}`} className={cn("rounded-xl border bg-muted/20 px-3.5 py-3", f.full && "sm:col-span-2", f.tone === "danger" && "border-rose-200 bg-rose-50/60 dark:border-rose-500/25 dark:bg-rose-500/5", f.tone === "success" && "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/5")}>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{f.icon && <f.icon className="size-3.5" />}{f.label}</p>
              {f.person ? (
                <span className="flex items-center gap-2.5"><Avatar name={f.person.name} className="size-8" /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{f.person.name}</span>{f.person.sub && <span className="block truncate text-xs text-muted-foreground">{f.person.sub}</span>}</span></span>
              ) : f.href ? (
                <a href={f.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><ExternalLink className="size-3.5" /> Open</a>
              ) : (
                <div className={cn("text-sm font-medium break-words", f.full && "font-normal whitespace-pre-line")}>{f.value === null || f.value === undefined || f.value === "" ? <span className="text-muted-foreground">—</span> : f.value}</div>
              )}
            </div>
          ))}
        </div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t pt-4">{footer}</div>}
      </DialogContent>
    </Dialog>
  )
}

/** A small "Open" link for a document column, or a dash */
export function DocLink({ href, label = "Open" }: { href: string | null | undefined; label?: string }) {
  if (!href) return <span className="text-muted-foreground">—</span>
  return <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><ExternalLink className="size-3.5" /> {label}</a>
}

/** Name with avatar and a muted second line, for table cells */
export function PersonCell({ name, sub }: { name: string | null | undefined; sub?: string | null }) {
  if (!name) return <span className="text-muted-foreground">—</span>
  return <span className="flex items-center gap-2.5"><Avatar name={name} className="size-8" /><span className="min-w-0"><span className="block truncate font-medium">{name}</span>{sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}</span></span>
}
