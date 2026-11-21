"use client"

import * as React from "react"
import { cn } from "cn"
import { autoPlaceholder, FieldLabelContext } from "@/lib/placeholder"

function Textarea({ className, placeholder, ...props }: React.ComponentProps<"textarea">) {
  // Inside a <Field>: a hint of what to write when the form gave none
  const label = React.useContext(FieldLabelContext)
  return (
    <textarea
      data-slot="textarea"
      placeholder={placeholder ?? autoPlaceholder(label, { multiline: true })}
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 shadow-xs hover:border-foreground/20 text-base text-foreground transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted aria-invalid:border-destructive aria-invalid:bg-destructive/[0.03] md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
