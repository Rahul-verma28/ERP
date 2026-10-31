"use client"

import { BRAND_COLORS, FONTS } from "@contracts/workspace"
import { Field, NativeSelect } from "@/components/form"
import { Chip } from "@/components/console/kit"
import type { Branding } from "@/lib/console"
import { cn } from "@/lib/utils"

// Theme studio (blueprint Phase E): the colour, font, appearance and density picker with a
// live preview and a readability check, used for AHEAD's default and for single businesses.

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast of white text on the colour (buttons use white text). */
export function whiteContrast(hex: string) {
  return /^#[0-9a-f]{6}$/i.test(hex) ? 1.05 / (luminance(hex) + 0.05) : 1
}

export function ContrastChip({ color }: { color: string }) {
  const ratio = whiteContrast(color)
  const label = `${ratio.toFixed(1)} : 1`
  if (ratio >= 4.5) return <Chip tone="green">Easy to read · {label}</Chip>
  if (ratio >= 3) return <Chip tone="amber">OK for buttons · {label}</Chip>
  return <Chip tone="red">Too light for white text · {label}</Chip>
}

export function ColorPicker({ value, onChange, id }: { value: string; onChange: (hex: string) => void; id: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {BRAND_COLORS.map((c) => (
        <button key={c.hex} type="button" title={c.name} aria-label={c.name} aria-pressed={value.toLowerCase() === c.hex.toLowerCase()} onClick={() => onChange(c.hex)} className={cn("size-8 rounded-full ring-offset-2 ring-offset-card", value.toLowerCase() === c.hex.toLowerCase() && "ring-2 ring-foreground")} style={{ background: c.hex }} />
      ))}
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-8 w-10 cursor-pointer rounded-md border bg-card p-0.5" aria-label="Custom colour" />
      <code className="text-xs text-muted-foreground">{value.toUpperCase()}</code>
    </div>
  )
}

export function BrandFields({ value, onChange, idPrefix }: { value: Branding; onChange: (b: Branding) => void; idPrefix: string }) {
  return (
    <div className="grid content-start gap-5">
      <Field label="Brand colour">
        <div className="grid gap-2">
          <ColorPicker id={`${idPrefix}-color`} value={value.brandColor} onChange={(brandColor) => onChange({ ...value, brandColor })} />
          <div><ContrastChip color={value.brandColor} /></div>
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Font">
          <NativeSelect value={value.font} onChange={(e) => onChange({ ...value, font: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Appearance">
          <NativeSelect value={value.theme} onChange={(e) => onChange({ ...value, theme: e.target.value as Branding["theme"] })}>
            <option value="system">Follow the device</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </NativeSelect>
        </Field>
        <Field label="Density">
          <NativeSelect value={value.density} onChange={(e) => onChange({ ...value, density: e.target.value as Branding["density"] })}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </NativeSelect>
        </Field>
      </div>
    </div>
  )
}

/** A small ERP screen in the chosen look. */
export function BrandPreview({ value, name }: { value: Branding; name: string }) {
  const family = FONTS.find((f) => f.key === value.font)?.family ?? "Inter"
  const dark = value.theme === "dark"
  return (
    <div className={cn("overflow-hidden rounded-xl border", dark ? "border-zinc-700 bg-zinc-900 text-zinc-100" : "bg-white text-zinc-900")} style={{ fontFamily: family }} aria-label="Preview">
      <div className={cn("flex items-center gap-2 border-b px-3 py-2.5 text-sm font-semibold", dark ? "border-zinc-700 bg-zinc-800" : "bg-zinc-50")}>
        <span className="grid size-6 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: value.brandColor }}>{name.slice(0, 1).toUpperCase()}</span>
        <span className="truncate">{name}</span>
      </div>
      <div className="flex">
        <div className={cn("hidden w-24 shrink-0 border-r text-xs sm:grid content-start", dark ? "border-zinc-700" : "", value.density === "compact" ? "gap-0.5 p-1.5" : "gap-1 p-2")}>
          {["Dashboard", "Sales", "Stock"].map((m, i) => (
            <span key={m} className="rounded-md px-2 py-1" style={i === 0 ? { background: `${value.brandColor}1F`, color: value.brandColor, fontWeight: 600 } : undefined}>{m}</span>
          ))}
        </div>
        <div className={cn("grid min-w-0 flex-1 gap-2", value.density === "compact" ? "p-2" : "p-4")}>
          <div className={cn("rounded-lg border p-3", dark ? "border-zinc-700 bg-zinc-800" : "")}>
            <div className="text-[11px] tracking-wide uppercase opacity-60">Today</div>
            <div className="text-lg font-semibold tabular-nums">₹48,250</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: value.brandColor }}>New invoice</span>
            <span className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: value.brandColor, color: value.brandColor }}>Add customer</span>
          </div>
        </div>
      </div>
    </div>
  )
}
