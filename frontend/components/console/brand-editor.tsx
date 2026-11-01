"use client"

import * as React from "react"
import { Check } from "lucide-react"
import { FONTS, THEME_PRESETS, themePreset } from "@contracts/workspace"
import { FONT_VAR } from "@/lib/theme"
import { cn } from "@/lib/utils"

// The look of the product: nine colour themes, the fonts and the spacing, as cards. Used in
// Console › Settings › Appearance, in a business's Settings › Branding and when onboarding one.
// Light, dark or system is not here: that is each person's own switch in the top bar.

export interface BrandValue {
  brandColor: string
  preset: string
  font: string
  density: "comfortable" | "compact"
}

const cardClass = (on: boolean) => cn("relative rounded-xl border bg-card text-left transition hover:border-primary/50 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-primary/30 focus-visible:outline-none", on && "border-primary ring-2 ring-primary/25")

function Tick() {
  return (
    <span className="absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
      <Check className="size-3" aria-hidden />
    </span>
  )
}

/** No card is ticked while a business uses its own brand colour instead of a theme's. */
export function ThemePresetGrid({ value, brandColor, onChange }: { value: string; brandColor: string; onChange: (key: string, primary: string) => void }) {
  const theme = themePreset(value)
  const current = theme.primary.toLowerCase() === brandColor.toLowerCase() ? theme.key : null
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Colour theme">
      {THEME_PRESETS.map((p) => {
        const on = current === p.key
        return (
          <button key={p.key} type="button" role="radio" aria-checked={on} onClick={() => onChange(p.key, p.primary)} className={cn(cardClass(on), "overflow-hidden")}>
            <span className="flex h-20" aria-hidden>
              {p.scale.map((c, i) => <span key={`${c}${i}`} className="flex-1" style={{ background: c }} />)}
            </span>
            <span className="flex items-center gap-2 px-3.5 py-3">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span>
              <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: p.primary }}>Button</span>
            </span>
            {on && <Tick />}
          </button>
        )
      })}
    </div>
  )
}

export function FontGrid({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Font">
      {FONTS.map((f) => {
        const on = value === f.key
        return (
          <button key={f.key} type="button" role="radio" aria-checked={on} onClick={() => onChange(f.key)} className={cn(cardClass(on), "px-3.5 py-3")} style={{ fontFamily: FONT_VAR[f.key] || "var(--font-inter, Inter), sans-serif" }}>
            <span className="block text-2xl leading-tight font-semibold">Aa</span>
            <span className="mt-1 block text-sm font-semibold">{f.label}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">Invoice ₹48,250 · 0123456789</span>
            {on && <Tick />}
          </button>
        )
      })}
    </div>
  )
}

const DENSITY: { key: BrandValue["density"]; label: string; text: string; gap: string }[] = [
  { key: "comfortable", label: "Comfortable", text: "More room, easier to read", gap: "gap-2" },
  { key: "compact", label: "Compact", text: "More on the screen at once", gap: "gap-1" },
]

export function DensityGrid({ value, onChange }: { value: string; onChange: (key: BrandValue["density"]) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Density">
      {DENSITY.map((d) => {
        const on = value === d.key
        return (
          <button key={d.key} type="button" role="radio" aria-checked={on} onClick={() => onChange(d.key)} className={cn(cardClass(on), "flex items-center gap-3 px-3.5 py-3")}>
            <span className={cn("grid w-9 shrink-0", d.gap)} aria-hidden>
              {[0, 1, 2].map((i) => <span key={i} className="h-1 rounded-full bg-muted-foreground/40" />)}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{d.label}</span>
              <span className="block text-xs text-muted-foreground">{d.text}</span>
            </span>
            {on && <Tick />}
          </button>
        )
      })}
    </div>
  )
}

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  )
}

/** All three choices; picking a colour theme also sets the brand colour printed on documents. */
export function BrandFields<T extends BrandValue>({ value, onChange }: { value: T; onChange: (b: T) => void }) {
  return (
    <div className="grid gap-7">
      <Group title="Colour theme" hint="Sets the buttons, menus, cards and page colours, in both light and dark.">
        <ThemePresetGrid value={value.preset} brandColor={value.brandColor} onChange={(preset, brandColor) => onChange({ ...value, preset, brandColor })} />
      </Group>
      <Group title="Font" hint="Used for all text. All of these are free for business use.">
        <FontGrid value={value.font} onChange={(font) => onChange({ ...value, font })} />
      </Group>
      <Group title="Density" hint="How tightly lists and forms are spaced.">
        <DensityGrid value={value.density} onChange={(density) => onChange({ ...value, density })} />
      </Group>
    </div>
  )
}
