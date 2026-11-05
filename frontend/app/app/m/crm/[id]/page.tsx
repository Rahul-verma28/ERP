"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, CalendarClock, CheckCircle2, FileText, Mail, MessageSquare, Pencil, Phone, Trash2, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { AdvancesCard } from "@/components/advances"
import { CustomerLedger } from "@/components/customer-ledger"
import { ConfirmDialog, Spinner, StatusBadge } from "@/components/common"
import { NativeSelect } from "@/components/form"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useCustomFields } from "@/components/custom-fields"
import { GST_STATES, formatDate, formatDateTime, formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ContactDialog, type Contact } from "../contact-form"

interface Detail extends Contact {
  owner: { id: string; name: string } | null
  activities: { id: string; type: "note" | "call" | "meeting" | "follow_up"; title: string | null; body: string | null; dueAt: string | null; completedAt: string | null; createdAt: string; createdByName: string | null; assigneeName: string | null }[]
  documents: { id: string; kind: "invoice" | "quotation" | "credit_note" | "sales_order"; number: string | null; status: string; issueDate: string; totalPaise: number; paidPaise: number }[]
  appointments: { id: string; title: string; startAt: string; status: string }[]
}

const ACTIVITY_ICON = { note: MessageSquare, call: Phone, meeting: Users, follow_up: CalendarClock }
const ACTIVITY_LABEL = { note: "Note", call: "Call", meeting: "Meeting", follow_up: "Follow-up" }

function Composer({ contactId, onAdded }: { contactId: string; onAdded: () => void }) {
  const [type, setType] = React.useState<keyof typeof ACTIVITY_LABEL>("note")
  const [body, setBody] = React.useState("")
  const [due, setDue] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post(`/contacts/${contactId}/activities`, {
        type,
        body: body || undefined,
        title: type === "follow_up" ? body.slice(0, 120) || "Follow up" : undefined,
        dueAt: type === "follow_up" && due ? new Date(due).toISOString() : undefined,
      })
      setBody("")
      setDue("")
      onAdded()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-2">
      <div className="flex flex-wrap gap-1">
        {(Object.keys(ACTIVITY_LABEL) as (keyof typeof ACTIVITY_LABEL)[]).map((t) => {
          const Icon = ACTIVITY_ICON[t]
          return (
            <button key={t} type="button" onClick={() => setType(t)} aria-pressed={type === t} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm", type === t ? "bg-primary text-primary-foreground" : "bg-muted")}>
              <Icon className="size-3.5" /> {ACTIVITY_LABEL[t]}
            </button>
          )
        })}
      </div>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={type === "call" ? "What was discussed?" : type === "follow_up" ? "What to follow up on?" : "Add a note…"} aria-label="Activity details" />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {type === "follow_up" && <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} required className="w-56" aria-label="Follow-up date" />}
        <Button type="submit" size="sm" disabled={busy || (!body && type !== "follow_up")}>{busy ? "Saving…" : "Add"}</Button>
      </div>
    </form>
  )
}

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const router = useRouter()
  const { can, term } = useAuth()
  const { data: c, reload, error } = useApi<Detail>(`/contacts/${id}`)
  const fields = useCustomFields(c?.type === "lead" ? "lead" : "contact")
  const [editing, setEditing] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [tab, setTab] = React.useState<"overview" | "ledger">("overview")

  if (error) return <p className="text-sm text-muted-foreground">{error.message}</p>
  if (!c) return <div className="grid place-items-center py-24"><Spinner /></div>
  const isLead = c.type === "lead"
  const permBase = isLead ? "crm.lead" : "crm.contact"
  const showLedger = !isLead && can("billing.dues.view")

  async function convert() {
    try {
      await api.post(`/leads/${id}/convert`)
      toast.success(`Converted to ${term("entity.contact.singular", "customer").toLowerCase()}`)
      await reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function setLeadStatus(status: string) {
    try {
      await api.patch(`/contacts/${id}`, { leadStatus: status, version: c!.version })
      await reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <Link href="/app/m/crm" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> CRM</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {c.name}
            {isLead && c.leadStatus && <StatusBadge status={c.leadStatus} />}
            {!c.isActive && <Badge variant="outline">Inactive</Badge>}
          </h1>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {c.companyName && <span>{c.companyName}</span>}
            {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-foreground"><Phone className="size-3.5" />{c.phone}</a>}
            {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-foreground"><Mail className="size-3.5" />{c.email}</a>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isLead && c.leadStatus !== "converted" && can("crm.contact.create") && <Button onClick={convert}><CheckCircle2 /> Convert to {term("entity.contact.singular", "customer").toLowerCase()}</Button>}
          {!isLead && can("billing.invoice.create") && <Link href={`/app/m/billing/new?contact=${c.id}`} className={buttonVariants()}><FileText /> New invoice</Link>}
          {!isLead && can("sales.quotation.create") && <Link href={`/app/m/sales/new?contact=${c.id}`} className={buttonVariants({ variant: "outline" })}>New quotation</Link>}
          {can(`${permBase}.edit`) && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
          {can(`${permBase}.delete`) && <Button variant="ghost" size="icon" onClick={() => setDeleting(true)} aria-label="Delete"><Trash2 /></Button>}
        </div>
      </div>

      {showLedger && (
        <div className="mb-5 flex gap-5 border-b" role="tablist">
          {(["overview", "ledger"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("-mb-px border-b-2 border-transparent px-1 py-2 text-sm font-semibold capitalize text-muted-foreground hover:text-foreground", tab === t && "border-primary text-foreground")}>{t}</button>
          ))}
        </div>
      )}
      {showLedger && tab === "ledger" ? <CustomerLedger contactId={c.id} /> : (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
            <CardContent className="grid gap-5">
              {can("crm.activity.create") && <Composer contactId={c.id} onAdded={() => void reload()} />}
              {c.activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet. Log a call or add a note.</p>
              ) : (
                <ol className="grid gap-4">
                  {c.activities.map((a) => {
                    const Icon = ACTIVITY_ICON[a.type]
                    const overdue = a.type === "follow_up" && !a.completedAt && a.dueAt && new Date(a.dueAt) < new Date()
                    return (
                      <li key={a.id} className="flex gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted"><Icon className="size-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            <span className="font-medium">{a.title || ACTIVITY_LABEL[a.type]}</span>
                            <span className="text-muted-foreground"> · {a.createdByName ?? "System"} · {formatDateTime(a.createdAt)}</span>
                          </p>
                          {a.body && a.body !== a.title && <p className="mt-0.5 text-sm whitespace-pre-wrap text-muted-foreground">{a.body}</p>}
                          {a.type === "follow_up" && a.dueAt && (
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                              <span className={cn(overdue ? "font-medium text-destructive" : "text-muted-foreground")}>Due {formatDateTime(a.dueAt)}{a.assigneeName ? ` · ${a.assigneeName}` : ""}</span>
                              {a.completedAt ? <Badge variant="secondary">Done</Badge> : can("crm.activity.edit") && (
                                <button className="font-medium underline-offset-2 hover:underline" onClick={() => api.patch(`/activities/${a.id}`, { completed: true }).then(reload)}>Mark done</button>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </CardContent>
          </Card>

          {!isLead && (
            <Card>
              <CardHeader><CardTitle>Invoices & quotations</CardTitle></CardHeader>
              <CardContent>
                {c.documents.length === 0 ? <p className="text-sm text-muted-foreground">Nothing billed yet.</p> : (
                  <ul className="divide-y">
                    {c.documents.map((d) => (
                      <li key={d.id}>
                        <Link href={d.kind === "credit_note" ? `/app/m/billing/credit-notes/${d.id}` : d.kind === "sales_order" ? `/app/m/sales/orders/${d.id}` : `/app/m/${d.kind === "invoice" ? "billing" : "sales"}/${d.id}`} className="flex items-center gap-3 py-2 text-sm hover:underline">
                          <span className="w-28 font-mono text-xs">{d.number ?? "Draft"}</span>
                          <span className="text-muted-foreground">{formatDate(d.issueDate)}</span>
                          <StatusBadge status={d.status} />
                          <span className="ml-auto font-medium tabular-nums">{formatPaise(d.totalPaise)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm">
                {isLead && (
                  <div>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="mt-1">
                      {c.leadStatus === "converted" ? "Converted" : (
                        <NativeSelect value={c.leadStatus ?? "new"} onChange={(e) => setLeadStatus(e.target.value)} disabled={!can("crm.lead.edit")} aria-label="Lead status">
                          {["new", "contacted", "qualified", "lost"].map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
                        </NativeSelect>
                      )}
                    </dd>
                  </div>
                )}
                {[
                  ["Owner", c.owner?.name],
                  ["Source", isLead ? c.leadSource : null],
                  ["GSTIN", c.gstin],
                  ["State", GST_STATES.find(([code]) => code === c.stateCode)?.[1]],
                  ["Address", [c.address?.line1, c.address?.city, c.address?.pincode].filter(Boolean).join(", ")],
                  ...fields.map((f) => [f.label, Array.isArray(c.custom[f.key]) ? (c.custom[f.key] as string[]).join(", ") : typeof c.custom[f.key] === "boolean" ? (c.custom[f.key] ? "Yes" : "No") : (c.custom[f.key] as string | undefined)]),
                  ["Added", formatDate(c.createdAt)],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k as string} className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="text-right">{v as string}</dd>
                    </div>
                  ))}
              </dl>
              {c.notes && <p className="mt-4 rounded-2xl bg-muted p-3 text-sm whitespace-pre-wrap">{c.notes}</p>}
            </CardContent>
          </Card>
          {!isLead && can("billing.payment.view") && <AdvancesCard contactId={c.id} />}
          {c.appointments.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{term("entity.appointment.plural", "Appointments")}</CardTitle></CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm">
                  {c.appointments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{a.title}<span className="block text-xs text-muted-foreground">{formatDateTime(a.startAt)}</span></span>
                      <StatusBadge status={a.status} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      )}

      {editing && <ContactDialog kind={c.type} contact={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload() }} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        destructive
        title={`Delete ${c.name}?`}
        description="If invoices exist for this customer they are kept and the customer is marked inactive instead."
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/contacts/${id}`)
            toast.success("Deleted")
            router.replace("/app/m/crm")
          } catch (e) {
            toast.error(errorMessage(e))
          }
        }}
      />
    </>
  )
}
