"use client"

import * as React from "react"
import { Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

// The one number box for counts and quantities: − and + on either side, arrow keys step it,
// typing keeps only digits (and a decimal point when decimals are allowed), and it stays inside min/max.

type Props = Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "min" | "max" | "step" | "size"> & {
  /** Kept as text so a half-typed "1." is not lost */
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: number
  /** Allow 1.5 kg; off for pieces, days and counts */
  decimals?: boolean
  /** Unit shown inside the box, e.g. pcs or days */
  suffix?: string
  size?: "sm" | "md"
}

export function NumberStepper({ value, onChange, min = 0, max, step = 1, decimals = false, suffix, size = "md", className, disabled, onBlur, ...props }: Props) {
  const n = value === "" ? null : Number(value)
  const clamp = (v: number) => {
    let out = Math.max(min, v)
    if (max !== undefined) out = Math.min(max, out)
    return decimals ? Math.round(out * 1000) / 1000 : Math.round(out)
  }
  const bump = (dir: 1 | -1) => onChange(String(clamp((n ?? (dir > 0 ? min - step : min)) + dir * step)))
  const clean = (raw: string) => {
    let v = raw.replace(decimals ? /[^\d.]/g : /\D/g, "")
    if (decimals) {
      const [whole, ...rest] = v.split(".")
      v = rest.length ? `${whole}.${rest.join("").slice(0, 3)}` : whole
    }
    return v
  }
  const btn = cn("grid shrink-0 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40", size === "sm" ? "w-7" : "w-9")
  return (
    <div
      data-slot="number-stepper"
      className={cn(
        "flex items-stretch overflow-hidden rounded-xl border bg-input/40 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30 has-[[aria-invalid=true]]:border-destructive",
        size === "sm" ? "h-8" : "h-10",
        disabled && "opacity-60",
        className,
      )}
    >
      <button type="button" tabIndex={-1} className={btn} disabled={disabled || (n !== null && n <= min)} onClick={() => bump(-1)} aria-label="Decrease">
        <Minus className="size-3.5" />
      </button>
      <input
        {...props}
        type="text"
        inputMode={decimals ? "decimal" : "numeric"}
        role="spinbutton"
        aria-valuenow={n ?? undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(clean(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") { e.preventDefault(); bump(1) }
          else if (e.key === "ArrowDown") { e.preventDefault(); bump(-1) }
          props.onKeyDown?.(e)
        }}
        onBlur={(e) => {
          // Out of range on leaving the box: bring it back inside
          if (value !== "" && !Number.isNaN(Number(value)) && clamp(Number(value)) !== Number(value)) onChange(String(clamp(Number(value))))
          onBlur?.(e)
        }}
        className={cn("w-full min-w-0 bg-transparent text-center text-sm tabular-nums outline-none placeholder:text-muted-foreground", suffix && "pr-0")}
      />
      {suffix && <span className="flex items-center pr-1 text-xs text-muted-foreground">{suffix}</span>}
      <button type="button" tabIndex={-1} className={btn} disabled={disabled || (n !== null && max !== undefined && n >= max)} onClick={() => bump(1)} aria-label="Increase">
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}
