"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CalendarClock, Check, MessageCircle, Phone } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { EmptyState, Spinner } from "@/components/common"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { waLink } from "@/lib/crm"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

// Tasks and follow-ups across all leads, customers and deals: what is late, what is due today,
// what is coming. Tick to finish; call or WhatsApp from the row.

interface Row {
  id: string
  type: "task" | "follow_up"
  title: string | null
  body: string | null
  dueAt: string
  completedAt: string | null
  assigneeName: string | null
  contact: { id: string; name: string; phone: string | null; type: string } | null
  deal: { id: string; title: string } | null
}

const DAY = 86_400_000
function bucket(due: string, now: number) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const t = new Date(due).getTime()
  if (t < start.getTime()) return "Late"
  if (t < start.getTime() + DAY) return "Today"
  if (t < start.getTime() + 2 * DAY) return "Tomorrow"
  if (t < start.getTime() + 7 * DAY) return "This week"
  return "Later"
}
const ORDER = ["Late", "Today", "Tomorrow", "This week", "Later"]

export default function TasksPage() {
  const { can } = useAuth()
  const [done, setDone] = React.useState(false)
  const { data, reload } = useApi<{ data: Row[] }>(`/follow-ups${done ? "?done=true" : ""}`)
  const [now] = React.useState(() => Date.now())
  if (!can("crm.activity.view")) return <PageHeader title="Tasks" description="You don't have access to tasks. Ask your admin." />

  async function toggle(r: Row) {
    try {
      await api.patch(`/activities/${r.id}`, { completed: !r.completedAt })
      toast.success(r.completedAt ? "Moved back to pending" : "Done")
      void reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const rows = data?.data ?? []
  const groups = done ? [["Done", rows] as const] : ORDER.map((g) => [g, rows.filter((r) => bucket(r.dueAt, now) === g)] as const).filter(([, list]) => list.length)
  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })

  return (
    <div className="grid gap-5">
      <PageHeader title="Tasks and follow-ups" description="Everything promised to leads, customers and deals. Add them from a lead or deal page." />
      <div className="flex w-fit gap-1 rounded-xl border p-1 text-sm" role="tablist">
        <button role="tab" aria-selected={!done} onClick={() => setDone(false)} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", !done && "bg-primary text-primary-foreground")}>Pending</button>
        <button role="tab" aria-selected={done} onClick={() => setDone(true)} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", done && "bg-primary text-primary-foreground")}>Done</button>
      </div>
      {!data ? <div className="grid place-items-center py-24"><Spinner /></div> : rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title={done ? "Nothing finished yet" : "Nothing pending"} description="Add a task or follow-up from a lead or deal so the next step is never forgotten." />
      ) : (
        groups.map(([g, list]) => (
          <section key={g} className="ui-surface overflow-hidden">
            <h2 className={cn("flex items-center justify-between border-b px-5 py-3 font-semibold", g === "Late" && "text-destructive")}>{g}<span className="rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground tabular-nums">{list.length}</span></h2>
            <ul className="divide-y">
              {list.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                  <button type="button" onClick={() => toggle(r)} aria-label={r.completedAt ? `Mark ${r.title} not done` : `Mark ${r.title} done`} className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border", r.completedAt ? "border-emerald-500 bg-emerald-500 text-white" : "hover:border-primary")}>{r.completedAt && <Check className="size-3.5" />}</button>
                  <div className="min-w-0 flex-1">
                    <p className={cn("font-medium", r.completedAt && "text-muted-foreground line-through")}>{r.title || r.body}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.type === "follow_up" ? "Follow-up" : "Task"} · {r.contact && <Link href={r.contact.type === "customer" ? `/app/m/crm/${r.contact.id}` : `/app/m/crm/${r.contact.id}`} className="font-medium text-foreground hover:underline">{r.contact.name}</Link>}
                      {r.deal && <> · <Link href={`/app/m/crm/deals/${r.deal.id}`} className="hover:underline">{r.deal.title}</Link></>}
                      {r.assigneeName ? ` · ${r.assigneeName}` : ""}
                    </p>
                  </div>
                  <span className={cn("text-sm tabular-nums", !r.completedAt && g === "Late" ? "font-semibold text-destructive" : "text-muted-foreground")}>{formatDateTime(r.dueAt)}</span>
                  {r.contact?.phone && (
                    <span className="flex">
                      <a href={`tel:${r.contact.phone}`} className={icon} aria-label={`Call ${r.contact.name}`} title="Call"><Phone /></a>
                      <a href={waLink(r.contact.phone, `Hello ${r.contact.name},`)} target="_blank" rel="noreferrer" className={cn(icon, "text-emerald-600 dark:text-emerald-400")} aria-label={`WhatsApp ${r.contact.name}`} title="WhatsApp"><MessageCircle /></a>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
