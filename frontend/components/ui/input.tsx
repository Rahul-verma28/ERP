import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"
import { MASKS, type InputMask, type MaskRule } from "@/lib/input-masks"

function Input({ className, type, mask, onChange, onKeyDown, ...props }: React.ComponentProps<"input"> & { mask?: InputMask }) {
  const rule: MaskRule | undefined = mask ? MASKS[mask] : undefined
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      inputMode={rule?.inputMode}
      autoCapitalize={rule?.autoCapitalize}
      className={cn(
        "h-10 w-full min-w-0 rounded-xl border border-input bg-muted px-3 py-1 text-base text-foreground transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:bg-destructive/[0.03] aria-invalid:focus-visible:ring-destructive/20 md:text-sm file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      onChange={
        rule
          ? (e: React.ChangeEvent<HTMLInputElement>) => {
              e.target.value = rule.clean(e.target.value)
              onChange?.(e)
            }
          : onChange
      }
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
        // Number boxes would otherwise accept e, + and (where nothing below zero is allowed) -
        if (type === "number" && !e.ctrlKey && !e.metaKey && (e.key === "e" || e.key === "E" || e.key === "+" || (e.key === "-" && Number(props.min) >= 0))) e.preventDefault()
        onKeyDown?.(e)
      }}
      {...props}
    />
  )
}

export { Input }
