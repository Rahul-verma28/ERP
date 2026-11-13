"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Check, CheckSquare, FileText, MessageCircle, Pencil, Phone, RotateCcw, Trophy, XCircle } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { ConfirmDialog, Spinner } from "@/components/common"
import { ACTIVITY_META, ActivityDialog, LabelChips, ProductsEditor, StagePill } from "@/components/crm/dialogs"
import { DealMenu, DealStatus, useDealActions } from "@/components/crm/deal-actions"
import { TaskList, Timeline } from "@/components/crm/timeline"
import { todayInIndia } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { dueLabel, tone, useCrmSetup, waLink, type Activity, type CrmProduct, type Deal } from "@/lib/crm"
import { formatDate, formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"

// One deal: where it stands in the pipeline, what was said and is to be done, what is being sold,
// and the quotations and invoices made for it.

interface Detail extends Deal {
  activities: Activity[]
  products: CrmProduct[]
  documents: { id: string; kind: string; number: string | null; status: string; issueDate: string; totalPaise: number }[]
}
type Tab = "overview" | "activity" | "tasks" | "products" | "documents"
const DOC_LABEL: Record<string, string> = { quotation: "Quotation", invoice: "Invoice", sales_order: "Sales order" }
const docHref = (d: { id: string; kind: string }) => (d.kind === "quotation" ? `/app/m/sales/${d.id}` : d.kind === "sales_order" ? `/app/m/sales/orders/${d.id}` : `/app/m/billing/${d.id}`)

export default function DealPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can } = useAuth()
  const setup = useCrmSetup().data
  const { data, setData, error, reload } = useApi<Detail>(`/deals/${id}`)
  const [tab, setTab] = React.useState<Tab>("overview")
  const [logging, setLogging] = React.useState<keyof typeof ACTIVITY_META | null>(null)
  const [removing, setRemoving] = React.useState<Activity | null>(null)
  const today = todayInIndia()
  const actions = useDealActions((d) => { if (d === null) router.push("/app/m/crm/deals"); else void reload() })

  if (error) return <p className="text-sm text-muted-foreground">{error.message}</p>
  if (!data) return <div className="grid place-items-center py-24"><Spinner /></div>

  const deal = data
  const open = deal.status === "open"
  const stages = setup?.pipelines.find((p) => p.id === deal.pipelineId)?.dealStages ?? []
  const at = stages.findIndex((s) => s.id === deal.stageId)
  const tasks = deal.activities.filter((a) => a.type === "task" || a.type === "follow_up")
  const openTasks = tasks.filter((t) => !t.completedAt).length
  const timeline = deal.activities.filter((a) => (a.type !== "task" && a.type !== "follow_up") || a.completedAt)
  const due = deal.expectedCloseOn ? dueLabel(deal.expectedCloseOn, today) : null
  const who = deal.contact?.companyName || deal.contact?.name || "Customer"
  const contactHref = deal.contact?.type === "customer" ? `/app/m/sales/customers/${deal.contactId}` : `/app/m/crm/${deal.contactId}`

  async function toggle(a: Activity) {
    try {
      await api.patch(`/activities/${a.id}`, { completed: !a.completedAt })
      void reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const tabs: [Tab, string, number | null][] = [["overview", "Overview", null], ["activity", "Activity", timeline.length], ["tasks", "Tasks", openTasks], ["products", "Products", deal.products.length], ["documents", "Quotations & invoices", deal.documents.length]]
  const card = (label: string, value: React.ReactNode, hint?: React.ReactNode, accent?: string) => (
    <div className="ui-surface grid gap-1 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("text-lg font-semibold tabular-nums", accent)}>{value}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
  )

  return (
    <div className="grid gap-5">
      <Link href="/app/m/crm/deals" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Deals</Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">{deal.title} {open ? <StagePill stage={deal.stage} /> : <DealStatus deal={deal} />}</h1>
          <p className="text-sm text-muted-foreground">With <Link href={contactHref} className="font-medium text-foreground hover:underline">{who}</Link>{deal.contact?.type === "lead" ? " (lead)" : ""} · {formatPaise(deal.valuePaise)}</p>
          <div className="mt-1"><LabelChips labels={deal.labels} max={6} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {deal.contact?.phone && <a href={`tel:${deal.contact.phone}`} className={buttonVariants({ variant: "outline" })} onClick={() => setTimeout(() => setLogging("call"), 600)}><Phone /> Call</a>}
          {deal.contact?.phone && <a href={waLink(deal.contact.phone, `Hello ${deal.contact.name},`)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline" }), "text-emerald-700 dark:text-emerald-300")}><MessageCircle /> WhatsApp</a>}
          {can("crm.activity.create") && <Button variant="outline" onClick={() => setLogging("note")}><Pencil /> Log activity</Button>}
          {deal.contact?.type === "customer" && can("sales.quotation.create") && <Link href={`/app/m/sales/new?contact=${deal.contactId}`} className={buttonVariants({ variant: "outline" })}><FileText /> Make quotation</Link>}
          {open && can("crm.deal.edit") && <Button variant="outline" className="text-destructive" onClick={() => actions.act("lost", deal)}><XCircle /> Lost</Button>}
          {open && can("crm.deal.edit") && <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => actions.act("won", deal)}><Trophy /> Won</Button>}
          {!open && can("crm.deal.edit") && <Button variant="outline" onClick={() => void actions.reopen(deal)}><RotateCcw /> Reopen</Button>}
          <DealMenu deal={deal} actions={actions} view={false} />
        </div>
      </header>

      {stages.length > 0 && (
        <ol className="flex w-full overflow-x-auto rounded-2xl border bg-card p-1 text-sm" aria-label="Stages">
          {stages.map((s, i) => {
            const current = i === at
            return (
              <li key={s.id} className="min-w-32 flex-1">
                <button type="button" disabled={!open || current || !can("crm.deal.edit")} onClick={() => void actions.moveTo(deal, s.id).then(() => toast.success(`Moved to ${s.name}`)).catch(() => undefined)} title={open ? `Move to ${s.name}` : "Reopen the deal to move it"}
                  className={cn("flex h-11 w-full flex-col items-center justify-center rounded-xl px-3 leading-tight font-medium whitespace-nowrap transition-colors disabled:cursor-default", current && open ? cn(tone(s.color).pill, "font-semibold") : i < at ? "text-foreground hover:bg-muted" : "text-muted-foreground hover:bg-muted")}>
                  <span className="flex items-center gap-1.5">{i < at && <Check className="size-3.5 text-emerald-600" aria-hidden />}{s.name}</span>
                  {s.probability != null && <span className="text-[10px] font-normal opacity-70">{s.probability}%</span>}
                </button>
              </li>
            )
          })}
          {!open && <li className="min-w-28 flex-1"><span className={cn("flex h-11 items-center justify-center rounded-xl px-3 font-semibold", tone(deal.status === "won" ? "emerald" : "rose").pill)}>{deal.status === "won" ? "Won" : `Lost${deal.lostReason ? ` · ${deal.lostReason}` : ""}`}</span></li>}
        </ol>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {card("Value", formatPaise(deal.valuePaise), deal.products.length ? `From ${deal.products.length} product${deal.products.length === 1 ? "" : "s"}` : "Before GST")}
        {card("Expected close", deal.expectedCloseOn ? formatDate(deal.expectedCloseOn) : "Not set", open ? due?.text : deal.closedAt ? `Closed ${formatDate(deal.closedAt)}` : undefined, open && due?.late ? "text-destructive" : undefined)}
        {card("Chance of winning", open ? `${deal.stage?.probability ?? 0}%` : deal.status === "won" ? "Won" : "Lost", open ? `Likely ${formatPaise(Math.round((deal.valuePaise * (deal.stage?.probability ?? 0)) / 100))}` : undefined)}
        {card("Open tasks", openTasks, `${tasks.length} in all`)}
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
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Details</h2>{can("crm.deal.edit") && <Button size="sm" variant="ghost" onClick={() => actions.act("edit", deal)}><Pencil /> Edit</Button>}</div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {[["Customer", who], ["Mobile", deal.contact?.phone], ["Owner", deal.owner?.name ?? "Unassigned"], ["Source", deal.source], ["Pipeline", setup?.pipelines.find((p) => p.id === deal.pipelineId)?.name], ["Added", formatDate(deal.createdAt)]].map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v || "—"}</dd></div>)}
            </dl>
            {deal.notes && <div className="mt-4 rounded-2xl bg-muted/60 p-3 text-sm whitespace-pre-wrap">{deal.notes}</div>}
            {deal.leadId && <p className="mt-4 text-xs text-muted-foreground">Made from a lead. <Link href={`/app/m/crm/${deal.leadId}`} className="underline">See the lead&apos;s history</Link></p>}
          </section>
          <section className="ui-surface p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Latest activity</h2><Button size="sm" variant="ghost" onClick={() => setTab("activity")}>See all</Button></div>
            <Timeline items={timeline.slice(0, 4)} />
          </section>
        </div>
      )}
      {tab === "activity" && (
        <section className="grid gap-4">
          {can("crm.activity.create") && <div className="flex flex-wrap gap-2">{(["note", "call", "meeting", "email"] as const).map((k) => { const Icon = ACTIVITY_META[k].icon; return <Button key={k} variant="outline" size="sm" onClick={() => setLogging(k)}><Icon /> {ACTIVITY_META[k].label}</Button> })}</div>}
          <Timeline items={timeline} onDelete={can("crm.activity.delete") ? setRemoving : undefined} />
        </section>
      )}
      {tab === "tasks" && (
        <section className="grid gap-3">
          {can("crm.activity.create") && <div><Button size="sm" onClick={() => setLogging("task")}><CheckSquare /> Add task</Button></div>}
          <TaskList items={deal.activities} onToggle={toggle} emptyHint="No tasks. Add the next step, like sending the quotation or a site visit." />
        </section>
      )}
      {tab === "products" && (
        <section className="ui-surface p-5">
          <h2 className="mb-1 font-semibold">Products in this deal</h2>
          <p className="mb-4 text-sm text-muted-foreground">The deal value follows these. Use them when you make the quotation.</p>
          {open && can("crm.deal.edit") ? <ProductsEditor path={`/deals/${deal.id}/products`} initial={deal.products} onSaved={(p) => setData({ ...deal, products: p, valuePaise: p.reduce((s, x) => s + Math.round(x.quantity * x.pricePaise), 0) || deal.valuePaise })} /> : (
            <ul className="divide-y text-sm">{deal.products.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{p.name} × {p.quantity} {p.unit}</span><span className="tabular-nums">{formatPaise(Math.round(p.quantity * p.pricePaise))}</span></li>)}</ul>
          )}
        </section>
      )}
      {tab === "documents" && (
        <section className="grid gap-3">
          {deal.documents.length === 0 ? (
            <p className="rounded-2xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">{deal.contact?.type === "customer" ? "No quotation or invoice for this customer since the deal began." : "Add the lead to Customers to send a quotation or invoice."}</p>
          ) : (
            <ul className="divide-y rounded-2xl border bg-card">
              {deal.documents.map((d) => (
                <li key={d.id}><Link href={docHref(d)} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"><span><span className="font-mono text-xs text-primary">{d.number ?? "Draft"}</span><span className="block text-xs text-muted-foreground">{DOC_LABEL[d.kind] ?? d.kind} · {formatDate(d.issueDate)} · {d.status}</span></span><span className="font-semibold tabular-nums">{formatPaise(d.totalPaise)}</span></Link></li>
              ))}
            </ul>
          )}
        </section>
      )}

      {logging && <ActivityDialog contactId={deal.contactId} dealId={deal.id} who={who} initialType={logging} onClose={() => setLogging(null)} onSaved={() => { setLogging(null); void reload() }} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive title="Delete this entry?" confirmLabel="Delete" onConfirm={async () => { try { await api.delete(`/activities/${removing!.id}`); void reload() } catch (e) { toast.error(errorMessage(e)) } }} />
      {actions.dialogs}
    </div>
  )
}
