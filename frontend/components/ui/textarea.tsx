import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-xl border border-transparent bg-muted px-3 py-2.5 text-base text-foreground transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted aria-invalid:border-destructive aria-invalid:bg-destructive/[0.03] md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
