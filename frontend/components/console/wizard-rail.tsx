"use client"

import { Check, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

// Onboarding progress rail (blueprint S3): all 7 steps, the current one highlighted. Steps 1–3
// create the business; 4–7 are saved on it and can be resumed later.

export const ONBOARDING_STEPS = [
  { key: "business", label: "Business", hint: "Name, industry, GST, state" },
  { key: "owner", label: "Owner", hint: "Who gets the login link" },
  { key: "plan", label: "Plan & modules", hint: "Free trial or a paid plan" },
  { key: "branding", label: "Branding", hint: "Colour, font, look (optional)" },
  { key: "config", label: "Configuration", hint: "Financial year, numbering, invoice look" },
  { key: "import", label: "Data import", hint: "Customers, products (optional)" },
  { key: "handover", label: "Review & hand over", hint: "Send the login link" },
] as const
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"]

export type RailState = "done" | "skipped" | "current" | "todo"

export function WizardRail({ states, onSelect, title }: { states: Partial<Record<OnboardingStepKey, RailState>>; onSelect?: (k: OnboardingStepKey) => void; title?: string }) {
  return (
    <nav aria-label="Onboarding steps" className="rounded-xl border bg-gradient-to-b from-accent/60 to-card p-4">
      {title && <p className="mb-3 text-[13px] text-muted-foreground">{title}</p>}
      <ol className="relative grid gap-1">
        {ONBOARDING_STEPS.map((s, i) => {
          const state = states[s.key] ?? "todo"
          const clickable = !!onSelect && state !== "todo" && state !== "current"
          const body = (
            <>
              <span
                className={cn(
                  "relative z-10 grid size-7 shrink-0 place-items-center rounded-full border-2 text-[11px] font-semibold",
                  state === "done" && "border-emerald-600 bg-emerald-600 text-white",
                  state === "skipped" && "border-muted-foreground/40 bg-muted text-muted-foreground",
                  state === "current" && "border-primary bg-primary text-primary-foreground",
                  state === "todo" && "border-border bg-card text-muted-foreground"
                )}
              >
                {state === "done" ? <Check className="size-3.5" /> : state === "skipped" ? <Minus className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 text-left">
                <span className={cn("block text-[13.5px] font-semibold", state === "todo" && "text-muted-foreground")}>{s.label}</span>
                <span className="block text-xs text-muted-foreground">{state === "skipped" ? "Skipped" : s.hint}</span>
              </span>
            </>
          )
          return (
            <li key={s.key} className="relative">
              {i < ONBOARDING_STEPS.length - 1 && <span aria-hidden className="absolute top-9 left-[13px] h-[calc(100%-1.75rem)] w-0.5 bg-border" />}
              {clickable ? (
                <button type="button" onClick={() => onSelect(s.key)} className="flex w-full items-start gap-3 rounded-lg py-2 hover:bg-card/70" aria-label={`Go to ${s.label}`}>
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-3 py-2" aria-current={state === "current" ? "step" : undefined}>
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
