"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { AlarmClock, CheckCircle2, Eye, Inbox, KanbanSquare, LifeBuoy, List, MessageCircle, Pencil, Plus, Star, Timer, UserCheck } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { EmptyState, Spinner } from "@/components/common"
import { DataList, HeaderLink, type Column, type ViewPreset } from "@/components/data-list"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { SummaryCards } from "@/components/summary-cards"
import { Board } from "@/components/crm/board"
import { ResolveDialog, TicketDialog } from "@/components/support/forms"
import { SlaCell } from "@/components/support/bits"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDateTime } from "@/lib/format"
import { CHANNEL, PRIORITY, STATUS, categoryOf, duration, useAgents, useSupportSettings, waLink, type TicketRow, type TicketStatus } from "@/lib/support"
import { cn } from "@/lib/utils"

// Tickets: every complaint and request, the ones running late on their SLA first. Take one, reply,
// put it on hold or resolve it from the row; open it for the conversation and the warranty.

type View = "list" | "board"
const VIEW_KEY = "support-view"
const BOARD: TicketStatus[] = ["new", "open", "pending", "on_hold", "resolved"]
const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })

function TicketsPage() {
  const { can } = useAuth()
  const params = useSearchParams()
  const router = useRouter()
  const settings = useSupportSettings().data
  const agents = useAgents().data
  const [view, setView] = React.useState<View>(() => {
    try { return (typeof window !== "undefined" && (localStorage.getItem(VIEW_KEY) as View | null)) || "list" } catch { return "list" }
  })
  const [now] = React.useState(() => Date.now())
  const [version, setVersion] = React.useState(0)
  const [creating, setCreating] = React.useState(false)
  const [resolving, setResolving] = React.useState<{ t: TicketRow; to: "resolved" | "closed" } | null>(null)
  const board = useApi<{ data: TicketRow[] }>(view === "board" && can("support.ticket.view") ? `/support/tickets?view=all&limit=500&v=${version}` : null)
  const reload = () => setVersion((v) => v + 1)
  const switchView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private window */ } }
  if (!can("support.ticket.view")) return <PageHeader title="Tickets" description="You don't have access to customer service. Ask your admin." />
  const canEdit = can("support.ticket.edit")
  const me = agents?.me

  async function patch(t: TicketRow, body: Record<string, unknown>, done: string) {
    try {
      await api.patch(`/support/tickets/${t.id}`, { ...body, version: t.version })
      toast.success(done)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const actions = (t: TicketRow) => {
    const open = t.status !== "resolved" && t.status !== "closed"
    return (
      <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        <Link href={`/app/m/support/${t.id}`} className={icon} title="Open" aria-label={`Open ${t.number}`}><Eye /></Link>
        {canEdit && open && !t.assigneeId && me && agents?.data.some((a) => a.id === me) && <Button variant="ghost" size="icon-sm" title="Take it" aria-label={`Take ${t.number}`} onClick={() => void patch(t, { assigneeId: me }, `${t.number} is yours`)}><UserCheck /></Button>}
        {canEdit && open && <Button variant="ghost" size="icon-sm" title="Resolve" aria-label={`Resolve ${t.number}`} className="text-emerald-600" onClick={() => setResolving({ t, to: "resolved" })}><CheckCircle2 /></Button>}
        <ActionMenu items={[
          { label: "Open and reply", icon: Pencil, href: `/app/m/support/${t.id}` },
          t.phone && { label: "WhatsApp the customer", icon: MessageCircle, onClick: () => window.open(waLink(t.phone!, `Hello ${t.customer}, about your request ${t.number}: `), "_blank") },
          "-",
          canEdit && open && t.status !== "pending" && { label: "Waiting on customer", onClick: () => void patch(t, { status: "pending" }, `${t.number} waiting on the customer`) },
          canEdit && open && t.status !== "on_hold" && { label: "Put on hold", onClick: () => void patch(t, { status: "on_hold" }, `${t.number} on hold`) },
          canEdit && open && t.priority !== "urgent" && { label: "Make urgent", onClick: () => void patch(t, { priority: "urgent" }, `${t.number} is urgent`) },
          canEdit && !open && { label: "Reopen", onClick: () => void patch(t, { status: "open" }, `${t.number} reopened`) },
          canEdit && t.status === "resolved" && { label: "Close", onClick: () => setResolving({ t, to: "closed" }) },
        ]} />
      </span>
    )
  }

  const columns: Column<TicketRow>[] = [
    { key: "number", header: "Ticket", hideable: false, sort: (t) => t.number, csv: (t) => t.number, cell: (t) => <span className="grid gap-0.5"><span className="flex items-center gap-1.5"><span className="font-mono text-xs font-semibold text-primary">{t.number}</span>{t.awaitingUs && <span className="size-2 rounded-full bg-blue-500" title="Customer replied" />}</span><span className="max-w-72 truncate font-medium" title={t.subject}>{t.subject}</span></span> },
    { key: "customer", header: "Customer", sort: (t) => t.customer, csv: (t) => t.customer, cell: (t) => <span><span className="font-medium">{t.customer}</span>{t.phone && <span className="block text-xs text-muted-foreground">{t.phone}</span>}</span> },
    { key: "category", header: "Category", csv: (t) => categoryOf(settings?.categories, t.category).label, cell: (t) => { const c = categoryOf(settings?.categories, t.category); return <Pill color={c.color}>{c.label}</Pill> } },
    { key: "priority", header: "Priority", sort: (t) => ["urgent", "high", "medium", "low"].indexOf(t.priority), csv: (t) => PRIORITY[t.priority].label, cell: (t) => <Pill color={PRIORITY[t.priority].color} dot>{PRIORITY[t.priority].label}</Pill> },
    { key: "status", header: "Status", csv: (t) => STATUS[t.status].label, cell: (t) => <Pill color={STATUS[t.status].color}>{STATUS[t.status].label}</Pill> },
    { key: "sla", header: "SLA", sort: (t) => (t.overdue ? 0 : 1), csv: (t) => (t.overdue ? "Late" : ""), cell: (t) => <SlaCell t={t} now={now} /> },
    { key: "assignee", header: "Handled by", sort: (t) => t.assignee?.name ?? "~", csv: (t) => t.assignee?.name ?? "", cell: (t) => (t.assignee ? <span className="flex items-center gap-2"><Avatar name={t.assignee.name} className="size-6 text-[9px]" />{t.assignee.name}</span> : <span className="text-muted-foreground">Not assigned</span>) },
    { key: "channel", header: "Came in by", defaultHidden: true, csv: (t) => CHANNEL[t.channel], cell: (t) => CHANNEL[t.channel] },
    { key: "invoice", header: "Invoice", defaultHidden: true, csv: (t) => t.invoiceNumber ?? "", cell: (t) => (t.invoiceNumber ? <span className="font-mono text-xs">{t.invoiceNumber}</span> : "—") },
    { key: "product", header: "Product", defaultHidden: true, csv: (t) => [t.itemName, t.serial].filter(Boolean).join(" "), cell: (t) => (t.itemName || t.serial ? <span>{t.itemName ?? "—"}{t.serial && <span className="block font-mono text-xs text-muted-foreground">{t.serial}</span>}</span> : "—") },
    { key: "replies", header: "Messages", align: "right", defaultHidden: true, csv: (t) => t.messages, cell: (t) => t.messages || "—" },
    { key: "first", header: "First reply", align: "right", defaultHidden: true, sort: (t) => t.firstMin ?? 1e9, csv: (t) => t.firstMin ?? "", cell: (t) => duration(t.firstMin) },
    { key: "rating", header: "Rating", align: "right", defaultHidden: true, sort: (t) => t.rating ?? 0, csv: (t) => t.rating ?? "", cell: (t) => (t.rating ? <span className="inline-flex items-center gap-0.5 text-amber-500"><Star className="size-3.5 fill-current" />{t.rating}</span> : "—") },
    { key: "created", header: "Raised", sort: (t) => t.createdAt, csv: (t) => t.createdAt, cell: (t) => <span className="text-xs text-muted-foreground">{formatDateTime(t.createdAt)}</span> },
    { key: "actions", header: "Actions", hideable: false, cell: actions },
  ]
  const presets: ViewPreset[] = [
    { key: "open", label: "Open", params: { view: "open" }, countKey: "open" },
    { key: "mine", label: "Mine", params: { view: "mine" }, countKey: "mine" },
    { key: "unassigned", label: "Not assigned", params: { view: "unassigned" }, countKey: "unassigned" },
    { key: "overdue", label: "Late on SLA", params: { view: "overdue" }, countKey: "overdue" },
    { key: "new", label: "New", params: { view: "new" }, countKey: "new" },
    { key: "pending", label: "Waiting / on hold", params: { view: "pending" }, countKey: "pending" },
    { key: "resolved", label: "Resolved", params: { view: "resolved" }, countKey: "resolved" },
    { key: "closed", label: "Closed", params: { view: "closed" }, countKey: "closed" },
    { key: "all", label: "All", params: { view: "all" }, countKey: "all" },
  ]
  const add = can("support.ticket.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setCreating(true)}><Plus /> New ticket</Button> : undefined
  const toggle = (
    <div className="flex rounded-xl border bg-card p-1" role="radiogroup" aria-label="View">
      {([["list", List, "List"], ["board", KanbanSquare, "Board"]] as const).map(([k, I, label]) => (
        <button key={k} type="button" role="radio" aria-checked={view === k} title={label} onClick={() => switchView(k)} className={cn("grid size-8 place-items-center rounded-[10px] text-muted-foreground [&_svg]:size-4", view === k && "bg-primary text-primary-foreground")}><I /></button>
      ))}
    </div>
  )
  const more = [{ label: "Knowledge base", href: "/app/m/support/knowledge" }, { label: "Report", href: "/app/m/support/reports" }, ...(can("support.sla.edit") ? [{ label: "Setup", href: "/app/m/support/setup" }] : [])]

  return (
    <>
      {view === "list" ? (
        <DataList<TicketRow>
          id="support-tickets"
          path="/support/tickets"
          params={{ v: String(version) }}
          header={{ title: "Tickets", description: "Complaints, repairs and questions from customers. Late ones come first.", actions: toggle, primary: add, more }}
          columns={columns}
          searchPlaceholder="Search number, subject, customer, mobile, serial or invoice"
          presets={presets}
          defaultPreset={params.get("view") ?? undefined}
          presetLabel="Show"
          tabs
          top={(res) => {
            const c = (res.counts ?? {}) as Record<string, number>
            const s = (res.sums ?? {}) as Record<string, number | null>
            return <SummaryCards items={[
              { label: "Open tickets", value: c.open ?? 0, hint: `${c.unassigned ?? 0} not assigned · ${s.awaitingUs ?? 0} customer replied`, color: "blue", icon: Inbox, href: "/app/m/support?view=open" },
              { label: "Late on SLA", value: c.overdue ?? 0, hint: `${s.urgent ?? 0} urgent still open`, color: "rose", icon: AlarmClock, href: "/app/m/support?view=overdue" },
              { label: "First reply", value: duration(s.avgFirstMin), hint: "Average, last 30 days", color: "amber", icon: Timer },
              { label: "Resolved this week", value: s.resolvedWeek ?? 0, hint: s.slaMetPct !== null && s.slaMetPct !== undefined ? `${s.slaMetPct}% within SLA (30 days)` : "SLA met shows once resolved", color: "emerald", icon: CheckCircle2 },
              { label: "Customer rating", value: s.csat ? `${s.csat} / 5` : "—", hint: s.rated ? `From ${s.rated} ratings, 30 days` : "Asked when a ticket is resolved", color: "violet", icon: Star },
            ]} />
          }}
          filters={[
            { key: "priority", label: "Priority", options: (["urgent", "high", "medium", "low"] as const).map((p) => ({ value: p, label: PRIORITY[p].label })) },
            { key: "category", label: "Category", options: (settings?.categories ?? []).map((c) => ({ value: c.key, label: c.label })) },
            { key: "assigneeId", label: "Handled by", options: (agents?.data ?? []).map((a) => ({ value: a.id, label: a.name })) },
            { key: "channel", label: "Came in by", options: Object.entries(CHANNEL).map(([k, l]) => ({ value: k, label: l })) },
          ]}
          rowHref={(t) => `/app/m/support/${t.id}`}
          exportName="tickets"
          emptyState={<EmptyState icon={LifeBuoy} title="No tickets here" description="Add a complaint when a customer calls, or switch on the online request form so they raise it themselves." action={add} />}
        />
      ) : (
        <div className="grid gap-4">
          <PageHeader title="Tickets" description="Drag a card to change its status. Resolving asks what was done." actions={<div className="flex flex-wrap items-center gap-2">{toggle}<HeaderLink href="/app/m/support/knowledge">Knowledge base</HeaderLink>{add}</div>} />
          {!board.data ? <div className="grid place-items-center py-24"><Spinner /></div> : (
            <Board<TicketRow & { stageId: string }>
              stages={BOARD.map((s, i) => ({ id: s, pipelineId: "", kind: "deal", name: STATUS[s].label, color: STATUS[s].color, position: i, probability: null }))}
              items={board.data.data.filter((t) => t.status !== "closed").map((t) => ({ ...t, stageId: t.status }))}
              canMove={canEdit}
              onMove={async (t, s) => { if (s === "resolved") setResolving({ t, to: "resolved" }); else await patch(t, { status: s }, `${t.number}: ${STATUS[s as TicketStatus].label}`) }}
              empty="Nothing here"
              card={(t) => (
                <Link href={`/app/m/support/${t.id}`} className={cn("grid gap-2 rounded-2xl border bg-card p-3 text-sm shadow-sm hover:border-primary/40", t.overdue && "border-rose-300 dark:border-rose-500/40")}>
                  <span className="flex items-start justify-between gap-2"><span className="font-mono text-xs font-semibold text-primary">{t.number}</span><Pill color={PRIORITY[t.priority].color} dot>{PRIORITY[t.priority].label}</Pill></span>
                  <span className="font-medium">{t.subject}</span>
                  <span className="text-xs text-muted-foreground">{t.customer} · {categoryOf(settings?.categories, t.category).label}</span>
                  <span className="flex items-center justify-between gap-2"><SlaCell t={t} now={now} />{t.assignee && <Avatar name={t.assignee.name} className="size-6 text-[9px]" />}</span>
                </Link>
              )}
            />
          )}
        </div>
      )}
      {creating && <TicketDialog onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); router.push(`/app/m/support/${t.id}`) }} />}
      {resolving && <ResolveDialog ticket={resolving.t} to={resolving.to} onClose={() => setResolving(null)} onSaved={() => { setResolving(null); reload() }} />}
    </>
  )
}

export default function Page() {
  return <React.Suspense><TicketsPage /></React.Suspense>
}
