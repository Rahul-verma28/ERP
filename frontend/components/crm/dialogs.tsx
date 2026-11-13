"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Briefcase, CalendarClock, CheckSquare, Handshake, Mail, MessageSquare, Phone, Tag, Trash2, User, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { MoneyInput, Spinner } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { FormSection } from "@/components/contact-dialog"
import { NumberStepper } from "@/components/number-stepper"
import { SearchSelect } from "@/components/search-select"
import { StateSelect } from "@/components/search-select"
import { ContactPicker, ItemPicker, useDirectory, type ContactOption } from "@/components/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { tone, useCrmSetup, type CrmProduct, type Deal, type Lead, type Stage } from "@/lib/crm"
import { cn } from "@/lib/utils"

// CRM forms and small pieces, shared by the lead and deal lists, boards and pages.

// ── Display pieces ──

export function StagePill({ stage, className }: { stage: Pick<Stage, "name" | "color"> | null | undefined; className?: string }) {
  if (!stage) return <span className="text-muted-foreground">—</span>
  return <span className={cn("inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-xs font-semibold whitespace-nowrap", tone(stage.color).pill, className)}><span className={cn("size-1.5 rounded-full", tone(stage.color).dot)} />{stage.name}</span>
}

export function LabelChips({ labels, max = 3 }: { labels: string[]; max?: number }) {
  const setup = useCrmSetup().data
  if (!labels.length) return null
  const color = (l: string) => setup?.labels.find((x) => x.name === l)?.color ?? "slate"
  return (
    <span className="flex flex-wrap gap-1">
      {labels.slice(0, max).map((l) => <span key={l} className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", tone(color(l)).pill)}>{l}</span>)}
      {labels.length > max && <span className="text-[11px] text-muted-foreground">+{labels.length - max}</span>}
    </span>
  )
}

export function TaskBar({ tasks }: { tasks: { done: number; total: number } }) {
  if (!tasks.total) return <span className="text-xs text-muted-foreground">No tasks</span>
  const pct = Math.round((tasks.done / tasks.total) * 100)
  return (
    <span className="grid w-24 gap-1">
      <span className="flex justify-between text-xs tabular-nums"><span>{tasks.done}/{tasks.total}</span><span className="text-muted-foreground">{pct}%</span></span>
      <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", pct === 100 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${pct}%` }} /></span>
    </span>
  )
}

// ── Managed lists inside dropdowns: sources and labels ──

async function addOption(kind: "source" | "label" | "lost_reason", name: string, reload: () => Promise<void>) {
  try {
    await api.post("/crm/options", { kind, name, color: kind === "label" ? "blue" : null })
    await reload()
    toast.success(`${name} added`)
    return true
  } catch (e) {
    toast.error(errorMessage(e))
    return false
  }
}

/** Source, or lost reason: pick one, or type a new one and add it to the list */
export function OptionSelect({ kind, value, onChange, placeholder, ...rest }: { kind: "source" | "lost_reason"; value: string; onChange: (v: string) => void; placeholder?: string; "aria-label"?: string; "aria-invalid"?: boolean }) {
  const { can } = useAuth()
  const setup = useCrmSetup()
  const list = (kind === "source" ? setup.data?.sources : setup.data?.lostReasons) ?? []
  const options = [...list.map((o) => ({ value: o.name, label: o.name })), ...(value && !list.some((o) => o.name === value) ? [{ value, label: value }] : [])]
  return (
    <SearchSelect
      {...rest}
      value={value}
      onChange={onChange}
      options={options}
      searchable
      placeholder={placeholder ?? (kind === "source" ? "Where did they come from?" : "Choose the reason")}
      searchPlaceholder="Search or type a new one…"
      onCreate={can("crm.pipeline.edit") ? async (typed) => { const name = typed.trim(); if (name.length < 2) return toast.error("Type the new name in the search first"); if (await addOption(kind, name, setup.reload)) onChange(name) } : undefined}
      createLabel={kind === "source" ? "Add this source" : "Add this reason"}
    />
  )
}

/** Labels: tick any number; a new one can be typed and added */
export function LabelPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { can } = useAuth()
  const setup = useCrmSetup()
  const [typed, setTyped] = React.useState("")
  const labels = setup.data?.labels ?? []
  const toggle = (name: string) => onChange(value.includes(name) ? value.filter((l) => l !== name) : [...value, name])
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Labels">
        {labels.map((l) => {
          const on = value.includes(l.name)
          return (
            <button key={l.id} type="button" aria-pressed={on} onClick={() => toggle(l.name)} className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors", on ? cn(tone(l.color).pill, "border-transparent") : "text-muted-foreground hover:bg-muted")}>
              <Tag className="size-3" aria-hidden /> {l.name}
            </button>
          )
        })}
      </div>
      {can("crm.pipeline.edit") && (
        <div className="flex max-w-xs gap-2">
          <Input value={typed} maxLength={40} onChange={(e) => setTyped(e.target.value)} placeholder="New label, e.g. Diwali offer" className="h-8 text-xs" onKeyDown={async (e) => { if (e.key === "Enter") { e.preventDefault(); if (typed.trim().length >= 2 && (await addOption("label", typed.trim(), setup.reload))) { toggle(typed.trim()); setTyped("") } } }} />
          <Button type="button" size="sm" variant="outline" disabled={typed.trim().length < 2} onClick={async () => { if (await addOption("label", typed.trim(), setup.reload)) { toggle(typed.trim()); setTyped("") } }}>Add</Button>
        </div>
      )}
    </div>
  )
}

export function OwnerSelect({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void; "aria-label"?: string }) {
  const users = useDirectory()
  return (
    <SearchSelect {...rest} value={value} onChange={onChange} searchable options={[{ value: "", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: `${u.name} · ${u.roleName}` }))]} placeholder="Choose a person" searchPlaceholder="Search people…" />
  )
}

export function PipelineStageFields({ kind, pipelineId, stageId, onChange, errors }: { kind: "lead" | "deal"; pipelineId: string; stageId: string; onChange: (pipelineId: string, stageId: string) => void; errors?: Record<string, string> }) {
  const setup = useCrmSetup().data
  const pipelines = setup?.pipelines ?? []
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines.find((p) => p.isDefault) ?? pipelines[0]
  const stages = (kind === "lead" ? pipeline?.leadStages : pipeline?.dealStages) ?? []
  return (
    <>
      {pipelines.length > 1 && (
        <Field label="Pipeline" required error={errors?.pipelineId}>
          <NativeSelect value={pipeline?.id ?? ""} onChange={(e) => { const p = pipelines.find((x) => x.id === e.target.value); const first = (kind === "lead" ? p?.leadStages : p?.dealStages)?.[0]; onChange(e.target.value, first?.id ?? "") }} aria-label="Pipeline">
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </Field>
      )}
      <Field label="Stage" required error={errors?.stageId} hint={kind === "deal" && stages.find((s) => s.id === stageId)?.probability != null ? `${stages.find((s) => s.id === stageId)!.probability}% chance of winning` : undefined}>
        <NativeSelect value={stageId || stages[0]?.id || ""} onChange={(e) => onChange(pipeline?.id ?? "", e.target.value)} aria-label="Stage">
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </NativeSelect>
      </Field>
    </>
  )
}

// ── Lead form ──

type LeadForm = { name: string; phone: string; email: string; companyName: string; subject: string; valuePaise: number | null; leadSource: string; pipelineId: string; stageId: string; ownerId: string; followUpOn: string; labels: string[]; notes: string }

export function LeadDialog({ lead, onClose, onSaved, initialStageId }: { lead?: Lead | null; onClose: () => void; onSaved: (l: Lead) => void; initialStageId?: string }) {
  const { me } = useAuth()
  const setup = useCrmSetup().data
  const today = todayInIndia()
  const def = setup?.pipelines.find((p) => p.isDefault) ?? setup?.pipelines[0]
  const stagePipeline = initialStageId ? setup?.pipelines.find((p) => p.leadStages.some((s) => s.id === initialStageId)) : null
  const [f, setF] = React.useState<LeadForm>({
    name: lead?.name ?? "", phone: lead?.phone ?? "", email: lead?.email ?? "", companyName: lead?.companyName ?? "", subject: lead?.subject ?? "",
    valuePaise: lead?.valuePaise ?? null, leadSource: lead?.leadSource ?? "", pipelineId: lead?.pipelineId ?? stagePipeline?.id ?? def?.id ?? "", stageId: lead?.stageId ?? initialStageId ?? "",
    ownerId: lead ? (lead.ownerId ?? "") : (me?.user?.id ?? ""), followUpOn: lead?.followUpOn?.slice(0, 10) ?? "", labels: lead?.labels ?? [], notes: lead?.notes ?? "",
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [dup, setDup] = React.useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof LeadForm>(k: K, v: LeadForm[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: "" } : e)); setError(null) }

  function check() {
    const e: Record<string, string> = {}
    if (f.name.trim().length < 2) e.name = "Enter the name"
    if (!f.phone && !f.email) e.phone = "Enter a mobile number or an email"
    if (f.phone && !/^(\+\d[\d ]{7,17}|[6-9]\d{9})$/.test(f.phone.replace(/\s/g, ""))) e.phone = "Enter a 10-digit mobile number"
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) e.email = "Enter a valid email"
    if (f.subject.trim().length < 2) e.subject = "Write what they are looking for"
    if (f.followUpOn && !lead && f.followUpOn < today) e.followUpOn = "Choose today or a later date"
    setErrors(e)
    return !Object.keys(e).length
  }

  async function save(ev: React.FormEvent, allowDuplicate = false) {
    ev.preventDefault()
    ev.stopPropagation()
    if (!check()) return setError("Fix the marked fields first.")
    setBusy(true)
    const body = {
      name: f.name.trim(), phone: f.phone || null, email: f.email.trim() || null, companyName: f.companyName.trim() || null, subject: f.subject.trim(), valuePaise: f.valuePaise,
      leadSource: f.leadSource || null, ownerId: f.ownerId || null, followUpOn: f.followUpOn || null, labels: f.labels, notes: f.notes.trim() || null,
      ...(lead ? (f.stageId !== lead.stageId ? { stageId: f.stageId } : {}) : { pipelineId: f.pipelineId || null, stageId: f.stageId || null, allowDuplicate }),
    }
    try {
      const saved = lead ? await api.patch<Lead>(`/contacts/${lead.id}`, { ...body, version: lead.version }) : await api.post<Lead>("/leads", body)
      toast.success(lead ? "Lead saved" : `${saved.name} added`)
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields)
        const d = err.details as { duplicateId?: string } | undefined
        if (err.code === "CONFLICT" && d?.duplicateId) setDup({ id: d.duplicateId, name: err.message })
      }
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead ? `Edit ${lead.name}` : "New lead"}</DialogTitle>
          <DialogDescription>Someone who may buy. Only the name, a way to reach them and what they want are needed.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => save(e)} className="grid gap-5" noValidate>
          <FormSection icon={User} title="Contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required error={errors.name}><Input mask="name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Anita Singh" autoFocus /></Field>
              <Field label="Company" hint="Leave empty for a person buying for themselves"><Input value={f.companyName} maxLength={160} onChange={(e) => set("companyName", e.target.value)} placeholder="e.g. Singh Interiors" /></Field>
              <Field label="Mobile" required={!f.email} error={errors.phone} hint="Mobile or email, at least one"><Input mask="phone" value={f.phone} onChange={(e) => { set("phone", e.target.value); setErrors((x) => ({ ...x, email: "" })) }} placeholder="e.g. 9876543210" /></Field>
              <Field label="Email" error={errors.email}><Input mask="email" type="email" value={f.email} onChange={(e) => { set("email", e.target.value); setErrors((x) => ({ ...x, phone: "" })) }} placeholder="e.g. anita@gmail.com" /></Field>
            </div>
          </FormSection>
          <FormSection icon={Briefcase} title="Requirement">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Looking for" required error={errors.subject} className="sm:col-span-2" hint="What they asked about, in a line"><Input value={f.subject} maxLength={200} onChange={(e) => set("subject", e.target.value)} placeholder="e.g. 20 ceiling fans for a new office" /></Field>
              <Field label="Expected value" hint="Rough amount of the sale"><MoneyInput value={f.valuePaise} onChange={(v) => set("valuePaise", v)} aria-label="Expected value" /></Field>
              <Field label="Source"><OptionSelect kind="source" value={f.leadSource} onChange={(v) => set("leadSource", v)} aria-label="Source" /></Field>
            </div>
          </FormSection>
          <FormSection icon={Users} title="Pipeline and follow-up">
            <div className="grid gap-4 sm:grid-cols-2">
              <PipelineStageFields kind="lead" pipelineId={f.pipelineId} stageId={f.stageId} onChange={(p, s) => { set("pipelineId", p); set("stageId", s) }} errors={errors} />
              <Field label="Assigned to"><OwnerSelect value={f.ownerId} onChange={(v) => set("ownerId", v)} aria-label="Assigned to" /></Field>
              <Field label="Follow up on" error={errors.followUpOn} hint="Shows in the list and in Tasks when due"><Input type="date" value={f.followUpOn} min={lead ? undefined : today} onChange={(e) => set("followUpOn", e.target.value)} /></Field>
              <Field label="Labels" className="sm:col-span-2"><LabelPicker value={f.labels} onChange={(v) => set("labels", v)} /></Field>
              <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} maxLength={4000} rows={2} onChange={(e) => set("notes", e.target.value)} placeholder="Budget, timeline, anything said on the call" /></Field>
            </div>
          </FormSection>
          {dup && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <span>{dup.name}</span>
              <span className="flex gap-2">
                <Link href={`/app/m/crm/${dup.id}`} className="font-medium underline">Open it</Link>
                <button type="button" className="font-medium underline" onClick={(e) => save(e as unknown as React.FormEvent, true)}>Add anyway</button>
              </span>
            </div>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : lead ? "Save lead" : "Add lead"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Log an activity: note, call, meeting, email or task ──

export const ACTIVITY_META = {
  note: { label: "Note", icon: MessageSquare },
  call: { label: "Call", icon: Phone },
  meeting: { label: "Meeting", icon: Users },
  email: { label: "Email", icon: Mail },
  task: { label: "Task", icon: CheckSquare },
  follow_up: { label: "Follow-up", icon: CalendarClock },
} as const
type ActivityKind = keyof typeof ACTIVITY_META
const CALL_RESULTS = ["Talked", "No answer", "Busy", "Switched off", "Wrong number", "Call back later"]

export function ActivityDialog({ contactId, dealId, who, initialType = "note", onClose, onSaved }: { contactId: string; dealId?: string | null; who: string; initialType?: ActivityKind; onClose: () => void; onSaved: () => void }) {
  const { me } = useAuth()
  const [type, setType] = React.useState<ActivityKind>(initialType)
  const [title, setTitle] = React.useState("")
  const [body, setBody] = React.useState("")
  const [result, setResult] = React.useState("Talked")
  const [due, setDue] = React.useState(`${todayInIndia()}T10:00`)
  const [assignee, setAssignee] = React.useState(me?.user?.id ?? "")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const timed = type === "task" || type === "follow_up"

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    const e: Record<string, string> = {}
    if (timed && !title.trim()) e.title = type === "task" ? "Enter the task" : "Enter what to follow up on"
    if (timed && !due) e.dueAt = "Choose when it is due"
    if (!timed && type !== "call" && !body.trim() && !title.trim()) e.body = "Write something"
    if (type === "meeting" && !title.trim()) e.title = "Enter what the meeting was about"
    setErrors(e)
    if (Object.keys(e).length) return setError("Fix the marked fields first.")
    setBusy(true)
    try {
      await api.post(`/contacts/${contactId}/activities`, {
        type,
        title: type === "call" ? `Call: ${result}` : title.trim() || undefined,
        body: body.trim() || undefined,
        dueAt: timed ? new Date(due).toISOString() : undefined,
        assigneeId: timed && assignee ? assignee : undefined,
        dealId: dealId ?? undefined,
      })
      toast.success(`${ACTIVITY_META[type].label} saved`)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const kinds: ActivityKind[] = ["note", "call", "meeting", "email", "task", "follow_up"]
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log activity</DialogTitle>
          <DialogDescription>With {who}. It shows on the timeline; tasks and follow-ups also show in Tasks.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" role="radiogroup" aria-label="Type">
            {kinds.map((k) => {
              const Icon = ACTIVITY_META[k].icon
              return (
                <button key={k} type="button" role="radio" aria-checked={type === k} onClick={() => { setType(k); setErrors({}); setError(null) }} className={cn("grid justify-items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium", type === k ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
                  <Icon className="size-4" aria-hidden /> {ACTIVITY_META[k].label}
                </button>
              )
            })}
          </div>
          {type === "call" && (
            <Field label="How did it go" required>
              <NativeSelect value={result} onChange={(e) => setResult(e.target.value)} aria-label="Call result">
                {CALL_RESULTS.map((r) => <option key={r}>{r}</option>)}
              </NativeSelect>
            </Field>
          )}
          {(timed || type === "meeting" || type === "email") && (
            <Field label={type === "task" ? "Task" : type === "follow_up" ? "Follow up on" : type === "email" ? "Subject" : "About"} required={type !== "email"} error={errors.title}>
              <Input value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setErrors((x) => ({ ...x, title: "" })) }} placeholder={type === "task" ? "e.g. Send price list" : type === "follow_up" ? "e.g. Ask about the site visit" : type === "email" ? "e.g. Quotation for fans" : "e.g. Showroom visit"} autoFocus />
            </Field>
          )}
          {timed && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Due" required error={errors.dueAt}><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
              <Field label="For"><OwnerSelect value={assignee} onChange={setAssignee} aria-label="Assigned to" /></Field>
            </div>
          )}
          <Field label={type === "note" ? "Note" : "Details"} required={type === "note"} error={errors.body}>
            <Textarea value={body} rows={3} maxLength={4000} onChange={(e) => { setBody(e.target.value); setErrors((x) => ({ ...x, body: "" })) }} placeholder={type === "call" ? "What was said, next step" : type === "email" ? "What the email said" : "Write it down"} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : `Save ${ACTIVITY_META[type].label.toLowerCase()}`}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Lost: lead or deal ──

export function LostDialog({ title, onClose, onConfirm }: { title: string; onClose: () => void; onConfirm: (reason: string, note: string) => Promise<void> }) {
  const [reason, setReason] = React.useState("")
  const [note, setNote] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!reason) return setError("Choose the reason.")
    if (reason === "Other" && !note.trim()) return setError("Write what happened.")
    setBusy(true)
    try {
      await onConfirm(reason, note.trim())
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>The reason helps you see where sales are lost. It can be reopened later.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Reason" required><OptionSelect kind="lost_reason" value={reason} onChange={(v) => { setReason(v); setError(null) }} aria-label="Reason" /></Field>
          <Field label="What happened" required={reason === "Other"}><Textarea value={note} rows={2} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bought from the shop next door for ₹200 less" /></Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={busy}>{busy ? "Saving…" : "Mark lost"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Assign ──

export function AssignDialog({ count, current, onClose, onConfirm }: { count: number; current?: string | null; onClose: () => void; onConfirm: (ownerId: string) => Promise<void> }) {
  const [owner, setOwner] = React.useState(current ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Assign {count === 1 ? "lead" : `${count} leads`}</DialogTitle><DialogDescription>They get a notification.</DialogDescription></DialogHeader>
        <Field label="Assign to" required><OwnerSelect value={owner} onChange={setOwner} aria-label="Assign to" /></Field>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={async () => { if (!owner) return setError("Choose a person."); setBusy(true); try { await onConfirm(owner) } catch (e) { setError(errorMessage(e)); setBusy(false) } }}>{busy ? "Saving…" : "Assign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Deal form, and lead → deal ──

type DealForm = { title: string; contact: ContactOption | null; valuePaise: number | null; pipelineId: string; stageId: string; expectedCloseOn: string; ownerId: string; source: string; labels: string[]; notes: string; makeCustomer: boolean; stateCode: string; copyProducts: boolean }

/** New deal, edit a deal, or turn a lead into one (`fromLead`) */
export function DealDialog({ deal, fromLead, initialContact, initialStageId, onClose, onSaved }: { deal?: Deal | null; fromLead?: Lead | null; initialContact?: ContactOption | null; initialStageId?: string; onClose: () => void; onSaved: (d: Deal) => void }) {
  const { me } = useAuth()
  const setup = useCrmSetup().data
  const today = todayInIndia()
  const def = setup?.pipelines.find((p) => p.isDefault) ?? setup?.pipelines[0]
  const stagePipeline = initialStageId ? setup?.pipelines.find((p) => p.dealStages.some((s) => s.id === initialStageId)) : null
  const [f, setF] = React.useState<DealForm>({
    title: deal?.title ?? (fromLead ? `${fromLead.subject ?? "Deal"} - ${fromLead.companyName || fromLead.name}` : ""),
    contact: deal?.contact ? { id: deal.contactId, name: deal.contact.name, companyName: deal.contact.companyName, phone: deal.contact.phone } : fromLead ? { id: fromLead.id, name: fromLead.name, companyName: fromLead.companyName, phone: fromLead.phone } : initialContact ?? null,
    valuePaise: deal?.valuePaise ?? fromLead?.valuePaise ?? null, pipelineId: deal?.pipelineId ?? fromLead?.pipelineId ?? stagePipeline?.id ?? def?.id ?? "", stageId: deal?.stageId ?? initialStageId ?? "",
    expectedCloseOn: deal?.expectedCloseOn?.slice(0, 10) ?? "", ownerId: deal ? (deal.ownerId ?? "") : (fromLead?.ownerId ?? me?.user?.id ?? ""), source: deal?.source ?? fromLead?.leadSource ?? "",
    labels: deal?.labels ?? fromLead?.labels ?? [], notes: deal?.notes ?? "", makeCustomer: !!fromLead, stateCode: "", copyProducts: true,
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof DealForm>(k: K, v: DealForm[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: "" } : e)); setError(null) }
  const needsState = !!fromLead && f.makeCustomer

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    ev.stopPropagation()
    const e: Record<string, string> = {}
    if (f.title.trim().length < 2) e.title = "Enter what is being sold"
    if (!f.contact) e.contactId = "Choose the customer or lead"
    if (!f.valuePaise) e.valuePaise = "Enter the deal value"
    if (f.expectedCloseOn && f.expectedCloseOn < today && !deal) e.expectedCloseOn = "Choose today or a later date"
    if (needsState && !fromLead!.phone) e.makeCustomer = "The lead has no mobile number. Add it, or untick this."
    if (needsState && !f.stateCode) e.stateCode = "Choose the state"
    setErrors(e)
    if (Object.keys(e).length) return setError("Fix the marked fields first.")
    setBusy(true)
    const body = { title: f.title.trim(), valuePaise: f.valuePaise ?? 0, expectedCloseOn: f.expectedCloseOn || null, ownerId: f.ownerId || null, source: f.source || null, labels: f.labels, notes: f.notes.trim() || null }
    try {
      let saved: Deal
      if (deal) saved = await api.patch<Deal>(`/deals/${deal.id}`, { ...body, contactId: f.contact!.id, ...(f.stageId !== deal.stageId ? { stageId: f.stageId } : {}), version: deal.version })
      else if (fromLead) saved = await api.post<Deal>(`/leads/${fromLead.id}/deal`, { ...body, pipelineId: f.pipelineId || null, stageId: f.stageId || null, makeCustomer: f.makeCustomer, stateCode: f.stateCode || null, copyProducts: f.copyProducts })
      else saved = await api.post<Deal>("/deals", { ...body, contactId: f.contact!.id, pipelineId: f.pipelineId || null, stageId: f.stageId || null })
      toast.success(deal ? "Deal saved" : fromLead ? "Lead converted to a deal" : "Deal added")
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{deal ? `Edit ${deal.title}` : fromLead ? `Convert ${fromLead.name} to a deal` : "New deal"}</DialogTitle>
          <DialogDescription>{fromLead ? "The lead's notes, calls and tasks stay with it and show on the deal." : "A sale you are working on: what, how much, and when you expect to close."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-5" noValidate>
          <FormSection icon={Handshake} title="Deal">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Deal name" required error={errors.title} className="sm:col-span-2" hint="What is being sold, e.g. the product and the buyer"><Input value={f.title} maxLength={160} onChange={(e) => set("title", e.target.value)} placeholder="e.g. 20 fans - Singh Interiors" autoFocus /></Field>
              <Field label="Customer or lead" required error={errors.contactId} className="sm:col-span-2">
                {fromLead ? <div className="flex h-10 items-center rounded-xl border bg-muted/40 px-3 text-sm font-medium">{fromLead.companyName || fromLead.name}</div> : <ContactPicker value={f.contact} onChange={(c) => set("contact", c)} />}
              </Field>
              <Field label="Value" required error={errors.valuePaise} hint="Before GST"><MoneyInput value={f.valuePaise} onChange={(v) => set("valuePaise", v)} aria-label="Value" /></Field>
              <Field label="Expected to close" error={errors.expectedCloseOn}><Input type="date" value={f.expectedCloseOn} min={deal ? undefined : today} onChange={(e) => set("expectedCloseOn", e.target.value)} /></Field>
            </div>
          </FormSection>
          <FormSection icon={Users} title="Pipeline">
            <div className="grid gap-4 sm:grid-cols-2">
              <PipelineStageFields kind="deal" pipelineId={f.pipelineId} stageId={f.stageId} onChange={(p, s) => { set("pipelineId", p); set("stageId", s) }} errors={errors} />
              <Field label="Owner"><OwnerSelect value={f.ownerId} onChange={(v) => set("ownerId", v)} aria-label="Owner" /></Field>
              <Field label="Source"><OptionSelect kind="source" value={f.source} onChange={(v) => set("source", v)} aria-label="Source" /></Field>
              <Field label="Labels" className="sm:col-span-2"><LabelPicker value={f.labels} onChange={(v) => set("labels", v)} /></Field>
              <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} rows={2} maxLength={4000} onChange={(e) => set("notes", e.target.value)} placeholder="Terms discussed, competitor, decision maker" /></Field>
            </div>
          </FormSection>
          {fromLead && (
            <FormSection icon={User} title="Also">
              <div className="grid gap-3">
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={f.makeCustomer} onChange={(e) => set("makeCustomer", e.target.checked)} /><span>Add {fromLead.name} to Customers now<span className="block text-xs text-muted-foreground">So you can send a quotation or invoice. Needs their mobile and state.</span></span></label>
                {errors.makeCustomer && <p className="text-xs text-destructive">{errors.makeCustomer}</p>}
                {needsState && <Field label="State" required error={errors.stateCode} hint="Place of supply for GST"><StateSelect value={f.stateCode} onChange={(v) => set("stateCode", v ?? "")} aria-label="State" /></Field>}
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={f.copyProducts} onChange={(e) => set("copyProducts", e.target.checked)} /> Copy the products they are interested in</label>
              </div>
            </FormSection>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : deal ? "Save deal" : fromLead ? "Convert to deal" : "Add deal"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Products a lead or deal is interested in ──

export function ProductsEditor({ path, initial, onSaved }: { path: string; initial: CrmProduct[]; onSaved: (p: CrmProduct[]) => void }) {
  const [rows, setRows] = React.useState(initial.map((p) => ({ ...p, qty: String(p.quantity) })))
  const [busy, setBusy] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const total = rows.reduce((s, r) => s + Math.round((Number(r.qty) || 0) * r.pricePaise), 0)
  const change = (i: number, patch: Partial<(typeof rows)[number]>) => { setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); setDirty(true) }
  async function save() {
    if (rows.some((r) => !(Number(r.qty) > 0))) return toast.error("Enter a quantity on every item")
    setBusy(true)
    try {
      const r = await api.put<{ data: CrmProduct[] }>(path, { items: rows.map((x) => ({ itemId: x.itemId, quantity: Number(x.qty), pricePaise: x.pricePaise })) })
      setRows(r.data.map((p) => ({ ...p, qty: String(p.quantity) })))
      setDirty(false)
      toast.success("Products saved")
      onSaved(r.data)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-3">
      <ItemPicker onPick={(it) => { if (rows.some((r) => r.itemId === it.id)) return toast.info(`${it.name} is already on the list`); setRows([...rows, { id: it.id, itemId: it.id, name: it.name, unit: it.unit, gstRateBp: it.gstRateBp, quantity: 1, qty: "1", pricePaise: it.pricePaise }]); setDirty(true) }} placeholder="Add a product they want" />
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">No products yet. Add what they asked about; the expected value follows.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-4 py-2 font-medium">Item</th><th className="w-36 px-2 py-2 font-medium">Qty</th><th className="w-36 px-2 py-2 font-medium">Price</th><th className="px-2 py-2 text-right font-medium">Amount</th><th className="w-10" /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.itemId} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-2 py-2"><NumberStepper decimals size="sm" suffix={r.unit} value={r.qty} onChange={(v) => change(i, { qty: v })} aria-label={`Quantity of ${r.name}`} /></td>
                  <td className="px-2 py-2"><MoneyInput value={r.pricePaise} onChange={(v) => change(i, { pricePaise: v ?? 0 })} aria-label={`Price of ${r.name}`} /></td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPaise(Math.round((Number(r.qty) || 0) * r.pricePaise))}</td>
                  <td className="pr-2"><Button variant="ghost" size="icon-sm" aria-label={`Remove ${r.name}`} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true) }}><Trash2 /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">Total before GST <strong className="text-foreground tabular-nums">{formatPaise(total)}</strong></span>
        <Button disabled={!dirty || busy} onClick={save}>{busy ? <Spinner /> : null} Save products</Button>
      </div>
    </div>
  )
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return <span className={cn("grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary", className)}>{name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?"}</span>
}

