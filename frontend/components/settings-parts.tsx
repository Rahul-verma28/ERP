"use client"

import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Shared pieces of the Settings pages: a section card with an icon header, and a setting row
// (what it is and what it does on the left, the control on the right).

export function SectionHead({ icon: Icon, title, description, right }: { icon: LucideIcon; title: string; description?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-[15px] font-bold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

export function SettingsCard({ id, icon, title, description, right, children, className }: { id?: string; icon: LucideIcon; title: string; description?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-20 ui-surface px-[18px] py-4 text-[13px]", className)}>
      <SectionHead icon={icon} title={title} description={description} right={right} />
      {children}
    </section>
  )
}

/** One setting: label and what it does, then its control; an error shows under the text */
export function SettingRow({ title, description, error, children, htmlFor }: { title: string; description?: React.ReactNode; error?: string | null; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-56 flex-1">
        <label htmlFor={htmlFor} className="block text-sm font-medium">
          {title}
        </label>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** A small set of choices shown as joined buttons */
export function Segmented<T extends string>({ value, onChange, options, disabled, label }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; disabled?: boolean; label: string }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border bg-muted/50 p-0.5" role="radiogroup" aria-label={label}>
      {options.map(([k, l]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          disabled={disabled}
          onClick={() => onChange(k)}
          className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-default", value === k ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
