"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { setDateFormat } from "@/lib/format"
import { applyBranding, type BrandLook } from "@/lib/theme"
import { cn } from "@/lib/utils"

// Applies the look to the whole page: in the ERP the business's Settings › Branding, in the
// Console and the partner portal Console › Settings › Appearance. Light, dark or system is
// each person's own choice, made with the switch in the top bar.

export function WorkspaceBranding() {
  const { me } = useAuth()
  const { setTheme } = useTheme()
  const look = me?.tenant?.branding ?? me?.consoleBranding ?? null
  const personal = me?.user.preferences ?? null
  const { brandColor, preset, font, density } = look ?? {}
  // "workspace" is what older accounts have stored: it now means the device's setting
  const theme = personal ? (personal.theme === "workspace" ? "system" : personal.theme) : null

  React.useEffect(() => {
    if (!brandColor) return applyBranding(null)
    applyBranding({ brandColor, preset, font: font ?? "inter", density: density ?? "comfortable" })
    return () => applyBranding(null)
  }, [brandColor, preset, font, density])

  // Only when the saved choice changes. setTheme changes with every switch, so depending on it
  // would put the old choice straight back while a new one is still saving.
  const setThemeRef = React.useRef(setTheme)
  React.useEffect(() => {
    setThemeRef.current = setTheme
  })
  React.useEffect(() => {
    if (theme) setThemeRef.current(theme)
  }, [theme])

  React.useEffect(() => {
    setDateFormat(personal?.dateFormat ?? "d_mmm_yyyy")
  }, [personal?.dateFormat])

  return null
}

/** Shows a look while it is being chosen; the saved one comes back when the chooser closes. */
export function useBrandingPreview(look: BrandLook | null) {
  const { me } = useAuth()
  const saved = React.useRef<BrandLook | null>(null)
  React.useEffect(() => {
    saved.current = me?.tenant?.branding ?? me?.consoleBranding ?? null
  })
  const { brandColor, preset, font, density } = look ?? {}
  React.useEffect(() => {
    if (!brandColor) return
    applyBranding({ brandColor, preset, font: font ?? "inter", density: density ?? "comfortable" })
    return () => applyBranding(saved.current)
  }, [brandColor, preset, font, density])
}

const MODES: { key: "light" | "dark" | "system"; label: string; icon: LucideIcon }[] = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "System", icon: Monitor },
]

/** Top bar: light, dark or the device's setting. Saved for the person, on every device. */
export function ThemeSwitch() {
  const { me, reload } = useAuth()
  const { theme, setTheme } = useTheme()
  const personal = me?.user.preferences
  if (!personal) return null
  // What is on the page right now, so the switch answers at once while it saves
  const current = theme ?? (personal.theme === "workspace" ? "system" : personal.theme)
  const choose = async (mode: "light" | "dark" | "system") => {
    if (mode === current) return
    setTheme(mode)
    try {
      await api.put("/account/preferences", { theme: mode })
      await reload()
    } catch (e) {
      setTheme(current)
      toast.error(errorMessage(e))
    }
  }
  const now = MODES.find((m) => m.key === current) ?? MODES[2]
  const after = MODES[(MODES.indexOf(now) + 1) % MODES.length]
  return (
    <>
      {/* Phones have room for one button, which steps through the three */}
      <button type="button" onClick={() => void choose(after.key)} aria-label={`Theme: ${now.label}. Switch to ${after.label}`} title={`Theme: ${now.label}`} className="grid size-9 place-items-center rounded-lg hover:bg-muted sm:hidden">
        <now.icon className="size-[18px]" />
      </button>
      <div role="radiogroup" aria-label="Theme" className="hidden items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5 sm:flex">
        {MODES.map((m) => (
          <button key={m.key} type="button" role="radio" aria-checked={current === m.key} aria-label={m.label} title={m.label} onClick={() => void choose(m.key)} className={cn("grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground", current === m.key && "bg-card text-foreground shadow-sm")}>
            <m.icon className="size-3.5" />
          </button>
        ))}
      </div>
    </>
  )
}
