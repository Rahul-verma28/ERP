"use client"

import * as React from "react"
import { Eye, EyeOff, Lock, type LucideIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// Inputs with an icon at the start (mail, phone, lock …) and a password box with show / hide.
// They pass every prop to the plain Input, so Field's id, aria-invalid and masks still work.

type InputProps = React.ComponentProps<typeof Input>

export function IconInput({ icon: Icon, className, end, ...props }: InputProps & { icon: LucideIcon; end?: React.ReactNode }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input {...props} className={cn("pl-10", end && "pr-11", className)} />
      {end && <span className="absolute inset-y-0 right-1.5 flex items-center">{end}</span>}
    </div>
  )
}

export function PasswordInput({ className, ...props }: Omit<InputProps, "type">) {
  const [shown, setShown] = React.useState(false)
  return (
    <IconInput
      icon={Lock}
      type={shown ? "text" : "password"}
      spellCheck={false}
      className={className}
      {...props}
      end={
        <button type="button" onClick={() => setShown((s) => !s)} className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}>
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  )
}

/** How strong a new password is: four bars and a word; rules come from the caller */
export function PasswordStrength({ value, checks }: { value: string; checks: { label: string; ok: boolean }[] }) {
  if (!value) return null
  const met = checks.filter((c) => c.ok).length
  const score = Math.round((met / checks.length) * 4)
  const tone = score <= 1 ? "bg-red-500" : score === 2 ? "bg-amber-500" : score === 3 ? "bg-lime-500" : "bg-emerald-500"
  const word = score <= 1 ? "Weak" : score === 2 ? "Fair" : score === 3 ? "Good" : "Strong"
  return (
    <div className="grid gap-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-4 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={cn("h-1 rounded-full", i < score ? tone : "bg-muted")} />)}</div>
        <span className="w-12 text-right text-xs font-medium text-muted-foreground">{word}</span>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {checks.map((c) => <li key={c.label} className={cn("flex items-center gap-1.5", c.ok ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}><span className={cn("size-1.5 rounded-full", c.ok ? "bg-emerald-500" : "bg-muted-foreground/40")} />{c.label}</li>)}
      </ul>
    </div>
  )
}

/** The usual checks for a new password: 8+ characters, a letter, a number, a symbol */
export const passwordChecks = (p: string) => [
  { label: "8 or more characters", ok: p.length >= 8 },
  { label: "A letter", ok: /[A-Za-z]/.test(p) },
  { label: "A number", ok: /\d/.test(p) },
  { label: "A symbol", ok: /[^A-Za-z0-9]/.test(p) },
]
