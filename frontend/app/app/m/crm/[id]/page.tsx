"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Check, CheckSquare, Handshake, Mail, MessageCircle, Pencil, Phone, Plus } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { ACTIVITY_META, ActivityDialog, DealDialog, LabelChips, ProductsEditor, StagePill } from "@/components/crm/dialogs"
import { LeadMenu, useLeadActions } from "@/components/crm/lead-actions"
import { TaskList, Timeline } from "@/components/crm/timeline"
import { todayInIndia } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { dueLabel, LEAD_STATUS, tone, useCrmSetup, waLink, type Activity, type CrmProduct, type Deal, type Lead } from "@/lib/crm"
import { formatDate, formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"
import { PageError, PageLoading } from "@/components/page-states"

// One lead (or a customer's CRM side): where it stands, what was said, what is to be done,
// what they want, and the deals made from it.

interface Detail extends Lead {
  activities: Activity[]
  products: CrmProduct[]
  deals: Deal[]
  documents: { id: string; kind: string; number: string | null; status: string; issueDate: string; totalPaise: number }[]
}

type Tab = "overview" | "activity" | "tasks" | "products" | "deals"

function StageStepper({ lead, onMove }: { lead: Detail; onMove: (stageId: string) => void }) {
  const setup = useCrmSetup().data
  const stages = setup?.pipelines.find((p) => p.id === lead.pipelineId)?.leadStages ?? []
  const at = stages.findIndex((s) => s.id === lead.stageId)
  const closed = lead.leadStatus === "lost" || lead.leadStatus === "converted"
  if (!stages.length) return null
  return (
    <ol className="flex w-full overflow-x-auto rounded-2xl border bg-card p-1 text-sm" aria-label="Stages">
      {stages.map((s, i) => {
        const done = i < at
        const current = i === at
        return (
          <li key={s.id} className="min-w-28 flex-1">
            <button
              type="button"
              disabled={closed || current}
              onClick={() => onMove(s.id)}
              title={closed ? "Reopen the lead to move it" : current ? "Current stage" : `Move to ${s.name}`}
              className={cn("flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-3 font-medium whitespace-nowrap transition-colors disabled:cursor-default",
                current ? cn(tone(s.color).pill, "font-semibold") : done ? "text-foreground hover:bg-muted" : "text-muted-foreground hover:bg-muted")}
            >
              {done ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <span className={cn("size-2 rounded-full", current ? tone(s.color).dot : "bg-muted-foreground/30")} />}
              {s.name}
            </button>
          </li>
        )
      })}
      {closed && (
        <li className="min-w-28 flex-1">
          <span className={cn("flex h-10 items-center justify-center rounded-xl px-3 font-semibold", tone(LEAD_STATUS[lead.leadStatus!].tone).pill)}>{LEAD_STATUS[lead.leadStatus!].label}</span>
        </li>
      )}
    </ol>
  )
}

export default function LeadPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can } = useAuth()
  const { data, setData, error, reload } = useApi<Detail>(`/contacts/${id}`)
  const [tab, setTab] = React.useState<Tab>("overview")
  const [logging, setLogging] = React.useState<"note" | "call" | "task" | "email" | "meeting" | "follow_up" | null>(null)
  const [newDeal, setNewDeal] = React.useState(false)
  const [removing, setRemoving] = React.useState<Activity | null>(null)
  const today = todayInIndia()
  const actions = useLeadActions((l) => { if (l === null) router.push("/app/m/crm"); else void reload() })

  if (error) return <PageError error={error} />
  if (!data) return <PageLoading />

  const lead = data
  const isLead = lead.type === "lead"
  const closed = lead.leadStatus === "lost" || lead.leadStatus === "converted"
  const openTasks = lead.activities.filter((a) => (a.type === "task" || a.type === "follow_up") && !a.completedAt).length
  const due = dueLabel(lead.followUpOn, today)
  const days = Math.max(0, Math.floor((Date.parse(`${today}T23:59:59+05:30`) - Date.parse(lead.createdAt)) / 86_400_000))
  const timeline = lead.activities.filter((a) => a.type !== "task" && a.type !== "follow_up" || a.completedAt)

  async function toggle(a: Activity) {
    try {
      await api.patch(`/activities/${a.id}`, { completed: !a.completedAt })
      toast.success(a.completedAt ? "Marked not done" : "Done")
      void reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const tabs: [Tab, string, number | null][] = [
    ["overview", "Overview", null],
    ["activity", "Activity", timeline.length],
    ["tasks", "Tasks", openTasks],
    ...(isLead || lead.products.length ? [["products", "Products", lead.products.length] as [Tab, string, number]] : []),
    ["deals", "Deals", lead.deals.length],
  ]
  const back = isLead ? { href: "/app/m/crm", label: "Leads" } : { href: `/app/m/sales/customers/${lead.id}`, label: lead.name }
  const card = (label: string, value: React.ReactNode, hint?: React.ReactNode, accent?: string) => (
    <div className="ui-surface grid gap-1 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("text-lg font-semibold tabular-nums", accent)}>{value}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
  )

  return (
    <div className="grid gap-5">
      <Link href={back.href} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {back.label}</Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-lg font-bold text-primary">{lead.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}</span>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">{lead.name} {isLead && !closed && <StagePill stage={lead.stage} />}{lead.leadStatus && LEAD_STATUS[lead.leadStatus] && <span className={cn("inline-flex h-[22px] items-center rounded-full px-2 text-xs font-semibold", tone(LEAD_STATUS[lead.leadStatus].tone).pill)}>{LEAD_STATUS[lead.leadStatus].label}</span>}</h1>
            <p className="text-sm text-muted-foreground">{[lead.companyName, lead.subject].filter(Boolean).join(" · ") || (isLead ? "Lead" : "Customer")}</p>
            <div className="mt-1"><LabelChips labels={lead.labels} max={6} /></div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lead.phone && <a href={`tel:${lead.phone}`} className={buttonVariants({ variant: "outline" })} onClick={() => setTimeout(() => setLogging("call"), 600)}><Phone /> Call</a>}
          {lead.phone && <a href={waLink(lead.phone, `Hello ${lead.name},`)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline" }), "text-emerald-700 dark:text-emerald-300")}><MessageCircle /> WhatsApp</a>}
          {lead.email && <a href={`mailto:${lead.email}`} className={buttonVariants({ variant: "outline" })} onClick={() => setTimeout(() => setLogging("email"), 600)}><Mail /> Email</a>}
          {can("crm.activity.create") && <Button variant="outline" onClick={() => setLogging("note")}><Pencil /> Log activity</Button>}
          {isLead && !closed && can("crm.deal.create") && <Button onClick={() => actions.act("deal", lead)}><Handshake /> Convert to deal</Button>}
          {!isLead && can("crm.deal.create") && <Button onClick={() => setNewDeal(true)}><Plus /> New deal</Button>}
          {isLead && <LeadMenu lead={lead} actions={actions} view={false} />}
        </div>
      </header>

      {isLead && <StageStepper lead={lead} onMove={(stageId) => void actions.moveTo(lead, stageId).then(() => toast.success("Stage changed")).catch(() => undefined)} />}
      {lead.leadStatus === "lost" && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">Lost{lead.lostReason ? `: ${lead.lostReason}` : ""}. {can("crm.lead.edit") && <button type="button" className="font-semibold underline" onClick={() => void actions.reopen(lead)}>Reopen</button>}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {card("Expected value", lead.valuePaise ? formatPaise(lead.valuePaise) : "—", lead.products.length ? `${lead.products.length} product${lead.products.length === 1 ? "" : "s"}` : "Add products to work it out")}
        {card("Follow up", lead.followUpOn ? formatDate(lead.followUpOn) : "Not set", due?.text, due?.late ? "text-destructive" : undefined)}
        {card("Open tasks", openTasks, `${lead.activities.filter((a) => a.type === "task" || a.type === "follow_up").length} in all`)}
        {card(isLead ? "Days open" : "With you for", `${days} day${days === 1 ? "" : "s"}`, `Added ${formatDate(lead.createdAt)}`)}
      </div>

      <div className="flex flex-wrap gap-1 border-b" role="tablist">
        {tabs.map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium", tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}{n ? <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{n}</span> : null}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <section className="ui-surface p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Details</h2>{isLead && !closed && can("crm.lead.edit") && <Button size="sm" variant="ghost" onClick={() => actions.act("edit", lead)}><Pencil /> Edit</Button>}</div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {[
                ["Mobile", lead.phone], ["Email", lead.email], ["Company", lead.companyName], ["Looking for", lead.subject],
                ["Source", lead.leadSource], ["Assigned to", lead.owner?.name ?? "Unassigned"], ["Stage", lead.stage?.name], ["Added", formatDate(lead.createdAt)],
              ].map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium break-words">{v || "—"}</dd></div>)}
            </dl>
            {lead.notes && <div className="mt-4 rounded-2xl bg-muted/60 p-3 text-sm whitespace-pre-wrap">{lead.notes}</div>}
          </section>
          <section className="ui-surface p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Latest activity</h2><Button size="sm" variant="ghost" onClick={() => setTab("activity")}>See all</Button></div>
            <Timeline items={timeline.slice(0, 4)} />
          </section>
        </div>
      )}

      {tab === "activity" && (
        <section className="grid gap-4">
          {can("crm.activity.create") && (
            <div className="flex flex-wrap gap-2">
              {(["note", "call", "meeting", "email"] as const).map((k) => { const Icon = ACTIVITY_META[k].icon; return <Button key={k} variant="outline" size="sm" onClick={() => setLogging(k)}><Icon /> {ACTIVITY_META[k].label}</Button> })}
            </div>
          )}
          <Timeline items={timeline} onDelete={can("crm.activity.delete") ? setRemoving : undefined} />
        </section>
      )}

      {tab === "tasks" && (
        <section className="grid gap-3">
          {can("crm.activity.create") && <div className="flex gap-2"><Button size="sm" onClick={() => setLogging("task")}><CheckSquare /> Add task</Button><Button size="sm" variant="outline" onClick={() => setLogging("follow_up")}>Schedule follow-up</Button></div>}
          <TaskList items={lead.activities} onToggle={toggle} emptyHint="No tasks. Add the next thing to do, with a date, so it is not forgotten." />
        </section>
      )}

      {tab === "products" && (
        <section className="ui-surface p-5">
          <h2 className="mb-1 font-semibold">Products they want</h2>
          <p className="mb-4 text-sm text-muted-foreground">The expected value follows these. They carry over when the lead becomes a deal.</p>
          {isLead && !closed && can("crm.lead.edit") ? <ProductsEditor path={`/leads/${lead.id}/products`} initial={lead.products} onSaved={(p) => setData({ ...lead, products: p, valuePaise: p.reduce((s, x) => s + Math.round(x.quantity * x.pricePaise), 0) || lead.valuePaise })} /> : (
            <ul className="divide-y text-sm">{lead.products.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{p.name} × {p.quantity} {p.unit}</span><span className="tabular-nums">{formatPaise(Math.round(p.quantity * p.pricePaise))}</span></li>)}</ul>
          )}
        </section>
      )}

      {tab === "deals" && (
        <section className="grid gap-3">
          {lead.deals.length === 0 ? (
            <EmptyState icon={Handshake} title="No deals yet" description={isLead ? "When they are ready to buy, convert the lead to a deal." : "Start a deal to track a sale with this customer."} action={isLead && !closed && can("crm.deal.create") ? <Button onClick={() => actions.act("deal", lead)}><Handshake /> Convert to deal</Button> : !isLead && can("crm.deal.create") ? <Button onClick={() => setNewDeal(true)}><Plus /> New deal</Button> : undefined} />
          ) : (
            <ul className="divide-y rounded-2xl border bg-card">
              {lead.deals.map((d) => (
                <li key={d.id}>
                  <Link href={`/app/m/crm/deals/${d.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                    <span className="min-w-0"><span className="block font-medium">{d.title}</span><span className="text-xs text-muted-foreground">Added {formatDate(d.createdAt)}{d.expectedCloseOn ? ` · closes ${formatDate(d.expectedCloseOn)}` : ""}</span></span>
                    <span className="flex items-center gap-3">{d.status === "open" ? <StagePill stage={d.stage} /> : <span className={cn("inline-flex h-[22px] items-center rounded-full px-2 text-xs font-semibold", d.status === "won" ? tone("emerald").pill : tone("rose").pill)}>{d.status === "won" ? "Won" : "Lost"}</span>}<span className="font-semibold tabular-nums">{formatPaise(d.valuePaise)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {logging && <ActivityDialog contactId={lead.id} who={lead.name} initialType={logging} onClose={() => setLogging(null)} onSaved={() => { setLogging(null); void reload() }} />}
      {newDeal && <DealDialog initialContact={{ id: lead.id, name: lead.name, companyName: lead.companyName, phone: lead.phone }} onClose={() => setNewDeal(false)} onSaved={(d) => router.push(`/app/m/crm/deals/${d.id}`)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        title="Delete this entry?"
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/activities/${removing!.id}`)
            void reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
      {actions.dialogs}
    </div>
  )
}
