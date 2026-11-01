import { themePreset, type ThemePreset } from "@contracts/workspace"

// Turns a colour theme (Settings › Appearance) into the page's colour variables, for light and
// dark. The default theme uses the values in globals.css and only sets the brand colour.

export interface BrandLook {
  brandColor: string
  preset?: string
  font: string
  density: string
}

export const FONT_VAR: Record<string, string> = {
  inter: "",
  roboto: "var(--font-roboto)",
  open_sans: "var(--font-open-sans)",
  lato: "var(--font-lato)",
  poppins: "var(--font-poppins)",
  dm_sans: "var(--font-dm-sans)",
  manrope: "var(--font-manrope)",
  plex: "var(--font-plex)",
  source: "var(--font-source)",
  public_sans: "var(--font-public-sans)",
  work_sans: "var(--font-work-sans)",
  nunito_sans: "var(--font-nunito-sans)",
}

/** `amount` of b mixed into a. */
function mix(a: string, b: string, amount: number) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16)
  const out = [1, 3, 5].map((i) => Math.round(channel(a, i) * (1 - amount) + channel(b, i) * amount).toString(16).padStart(2, "0"))
  return `#${out.join("")}`
}

function lightVars({ scale: s, primary }: ThemePreset) {
  const white = "#FFFFFF"
  return {
    "--background": mix(s[5], white, 0.55),
    "--foreground": s[0],
    "--card": white,
    "--card-foreground": s[0],
    "--popover": white,
    "--popover-foreground": s[0],
    "--primary": primary,
    "--primary-foreground": white,
    "--secondary": mix(s[5], white, 0.25),
    "--secondary-foreground": s[0],
    "--muted": mix(s[5], white, 0.25),
    "--muted-foreground": mix(s[0], "#8A8F98", 0.65),
    "--accent": mix(s[5], white, 0.3),
    "--accent-foreground": mix(primary, s[0], 0.4),
    "--border": mix(s[4], white, 0.55),
    "--input": mix(s[4], white, 0.35),
    "--ring": primary,
    "--console-brand": primary,
    "--chart-1": primary,
    "--sidebar": white,
    "--sidebar-foreground": s[0],
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": white,
    "--sidebar-accent": mix(s[5], white, 0.3),
    "--sidebar-accent-foreground": mix(primary, s[0], 0.4),
    "--sidebar-border": mix(s[4], white, 0.55),
    "--sidebar-ring": primary,
  }
}

function darkVars({ scale: s, primaryDark }: ThemePreset) {
  const text = mix(s[5], "#FFFFFF", 0.5)
  return {
    "--background": s[0],
    "--foreground": text,
    "--card": mix(s[0], s[1], 0.45),
    "--card-foreground": text,
    "--popover": mix(s[0], s[1], 0.6),
    "--popover-foreground": text,
    "--primary": primaryDark,
    "--primary-foreground": s[0],
    "--secondary": mix(s[0], s[4], 0.14),
    "--secondary-foreground": text,
    "--muted": mix(s[0], s[4], 0.14),
    "--muted-foreground": mix(s[4], "#FFFFFF", 0.2),
    "--accent": mix(s[0], primaryDark, 0.24),
    "--accent-foreground": text,
    "--border": mix(s[0], s[4], 0.22),
    "--input": mix(s[0], s[4], 0.3),
    "--ring": primaryDark,
    "--console-brand": mix(primaryDark, s[0], 0.35),
    "--chart-1": primaryDark,
    "--sidebar": mix(s[0], s[1], 0.25),
    "--sidebar-foreground": text,
    "--sidebar-primary": primaryDark,
    "--sidebar-primary-foreground": s[0],
    "--sidebar-accent": mix(s[0], primaryDark, 0.24),
    "--sidebar-accent-foreground": text,
    "--sidebar-border": mix(s[0], s[4], 0.22),
    "--sidebar-ring": primaryDark,
  }
}

const block = (selector: string, vars: Record<string, string>) => `${selector}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`

/** A brand colour the owner typed in wins over the theme's own colour. */
function brandVars(color: string) {
  return { "--primary": color, "--primary-foreground": "#FFFFFF", "--ring": color, "--sidebar-primary": color, "--console-brand": color, "--chart-1": color }
}

export function themeCss(look: BrandLook) {
  const preset = themePreset(look.preset)
  const custom = look.brandColor.toLowerCase() !== preset.primary.toLowerCase()
  const rules = preset.key === "default" ? [] : [block("html:root", lightVars(preset)), block("html.dark", darkVars(preset))]
  if (custom) rules.push(block("html:root,html.dark", brandVars(look.brandColor)))
  return rules.join("")
}

const STYLE_ID = "ahead-theme"

/** Puts a look on the page, or back to the plain default with null. */
export function applyBranding(look: BrandLook | null) {
  const root = document.documentElement
  let style = document.getElementById(STYLE_ID)
  if (!look) {
    style?.remove()
    root.style.removeProperty("--font-sans")
    delete root.dataset.density
    return
  }
  if (!style) {
    style = document.createElement("style")
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = themeCss(look)
  if (FONT_VAR[look.font]) root.style.setProperty("--font-sans", FONT_VAR[look.font])
  else root.style.removeProperty("--font-sans")
  root.dataset.density = look.density
}
