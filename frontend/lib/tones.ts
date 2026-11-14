// Colour tones used for status pills, stage dots and bars across the ERP. Full class strings so
// Tailwind keeps them. One place, so a "green" status looks the same in Sales, Stock and CRM.

export const TONES: Record<string, { pill: string; dot: string; bar: string; soft: string; text: string }> = {
  slate: { pill: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300", dot: "bg-slate-400", bar: "bg-slate-400", soft: "bg-slate-50 dark:bg-slate-500/5", text: "text-slate-600 dark:text-slate-300" },
  blue: { pill: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300", dot: "bg-blue-500", bar: "bg-blue-500", soft: "bg-blue-50/60 dark:bg-blue-500/5", text: "text-blue-700 dark:text-blue-300" },
  violet: { pill: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300", dot: "bg-violet-500", bar: "bg-violet-500", soft: "bg-violet-50/60 dark:bg-violet-500/5", text: "text-violet-700 dark:text-violet-300" },
  amber: { pill: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", dot: "bg-amber-500", bar: "bg-amber-500", soft: "bg-amber-50/60 dark:bg-amber-500/5", text: "text-amber-700 dark:text-amber-300" },
  orange: { pill: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300", dot: "bg-orange-500", bar: "bg-orange-500", soft: "bg-orange-50/60 dark:bg-orange-500/5", text: "text-orange-700 dark:text-orange-300" },
  emerald: { pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", dot: "bg-emerald-500", bar: "bg-emerald-500", soft: "bg-emerald-50/60 dark:bg-emerald-500/5", text: "text-emerald-700 dark:text-emerald-300" },
  rose: { pill: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300", dot: "bg-rose-500", bar: "bg-rose-500", soft: "bg-rose-50/60 dark:bg-rose-500/5", text: "text-rose-700 dark:text-rose-300" },
  cyan: { pill: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300", dot: "bg-cyan-500", bar: "bg-cyan-500", soft: "bg-cyan-50/60 dark:bg-cyan-500/5", text: "text-cyan-700 dark:text-cyan-300" },
}
export type Tone = keyof typeof TONES
export const tone = (color: string | null | undefined) => TONES[color ?? "slate"] ?? TONES.slate
