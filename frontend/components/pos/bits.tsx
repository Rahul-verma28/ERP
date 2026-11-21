import { formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Cash counted against expected at close: matched, short or over */
export function Difference({ paise }: { paise: number | null }) {
  if (paise === null) return <span className="text-muted-foreground">—</span>
  if (paise === 0) return <span className="text-emerald-700 dark:text-emerald-400">Matched</span>
  return <span className={cn("font-medium tabular-nums", paise < 0 ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>{paise < 0 ? "Short " : "Over "}{formatPaise(Math.abs(paise))}</span>
}
