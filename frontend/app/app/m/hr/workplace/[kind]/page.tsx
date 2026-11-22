"use client"

import * as React from "react"
import { notFound, useParams, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { CalendarDays, CheckCircle2, ExternalLink, Eye, FileText, List, Megaphone, Pencil, Plus, RotateCcw, Trash2, Users, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { countBy, DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { RecordView } from "@/components/record-view"
import { MonthCalendar } from "@/components/hr/month-calendar"
import { Field, FormError, NativeSelect } from "@/components/form"
import { PageLoading } from "@/components/page-states"
import { ActionMenu, Pill } from "@/components/page-parts"
import { ListSelect } from "@/components/hr/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate } from "@/lib/format"
import { useHrLookups, type Post } from "@/lib/hr"
import { cn } from "@/lib/utils"
import { useChanged } from "@/lib/use-dirty"
import { openFile } from "@/lib/files"
import { FileField } from "@/components/file-field"

// Workplace: announcements, events, and documents and policies staff confirm they have read.

type Kind = Post["kind"]
const KINDS: Record<Kind, { title: string; one: string; icon: typeof Megaphone; description: string }> = {
  announcement: { title: "Announcements", one: "announcement", icon: Megaphone, description: "Notices for everyone, or for some departments. Active ones show on the HR dashboard." },
  event: { title: "Events", one: "event", icon: CalendarDays, description: "Meetings, celebrations and outings, with date, time and place. Approved ones show on the calendar." },
  document: { title: "Documents & policies", one: "document", icon: FileText, description: "Handbook, leave policy, forms. Approved ones reach staff; ask them to confirm they have read the important ones." },
}
const PRIORITY: Record<string, string> = { low: "slate", normal: "blue", high: "rose" }
const STATUS: Record<string, { label: string; color: string }> = { active: { label: "Active", color: "emerald" }, draft: { label: "Draft", color: "slate" }, inactive: { label: "Inactive", color: "slate" }, pending: { label: "Pending", color: "amber" }, approved: { label: "Approved", color: "emerald" }, rejected: { label: "Rejected", color: "rose" } }
const LIVE = ["active", "approved"]

function PostDialog({ kind, post, onClose, onSaved }: { kind: Kind; post: Post | null; onClose: () => void; onSaved: () => void }) {
  const look = useHrLookups()
  const k = KINDS[kind]
  const [f, setF] = React.useState({ title: post?.title ?? "", category: post?.category ?? "", body: post?.body ?? "", startsOn: post?.startsOn?.slice(0, 10) ?? (kind === "document" ? "" : todayInIndia()), endsOn: post?.endsOn?.slice(0, 10) ?? "", startsAt: post?.startsAt ?? "", endsAt: post?.endsAt ?? "", location: post?.location ?? "", priority: post?.priority ?? "normal", departmentIds: post?.departmentIds ?? [], url: post?.url ?? "", needsAck: post?.needsAck ?? false, status: post?.status ?? (kind === "announcement" ? "active" : "pending"), color: post?.color ?? "" })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(key: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [key]: v })); setErrors({}); setError(null) }
  const depts = look.data?.departments ?? []
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.title.trim().length < 3) x.title = "Enter the title"
    if (kind === "announcement" && f.body.trim().length < 3) x.body = "Write the announcement"
    if (kind === "event" && !f.startsOn) x.startsOn = "Choose the date"
    if (kind === "document" && !f.url.trim() && !f.body.trim()) x.url = "Upload the document, or write its text below"
    if (f.startsOn && f.endsOn && f.endsOn < f.startsOn) x.endsOn = "Must be on or after the start"
    setErrors(x)
    if (Object.keys(x).length) return setError("Fix the marked fields first.")
    setBusy(true)
    const n = (v: string) => v.trim() || null
    const body = { kind, title: f.title.trim(), category: n(f.category), body: n(f.body), startsOn: n(f.startsOn), endsOn: n(f.endsOn), startsAt: n(f.startsAt), endsAt: n(f.endsAt), location: n(f.location), priority: f.priority, departmentIds: f.departmentIds, url: n(f.url), needsAck: kind === "document" && f.needsAck, status: f.status, color: n(f.color) }
    try {
      if (post?.id) await api.put(`/hr/posts/${post.id}`, body)
      else await api.post("/hr/posts", body)
      toast.success(post?.id ? "Saved" : `${k.one[0].toUpperCase()}${k.one.slice(1)} added`)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{post?.id ? `Edit ${k.one}` : `New ${k.one}`}</DialogTitle><DialogDescription>{k.description}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Title" required error={errors.title} className="sm:col-span-2"><Input value={f.title} autoFocus maxLength={160} onChange={(e) => set("title", e.target.value)} placeholder={kind === "event" ? "e.g. Diwali celebration" : kind === "document" ? "e.g. Leave policy 2026" : "e.g. Shop closed on Sunday for stock-taking"} /></Field>
          <Field label="Category"><ListSelect list={kind === "event" ? "eventTypes" : kind === "document" ? "documentCategories" : "announcementCategories"} value={f.category} onChange={(v) => set("category", v)} aria-label="Category" /></Field>
          <Field label="Priority"><NativeSelect value={f.priority} aria-label="Priority" onChange={(e) => set("priority", e.target.value as Post["priority"])}><option value="low">Low</option><option value="normal">Normal</option><option value="high">Important</option></NativeSelect></Field>
          {kind !== "document" ? <>
            <Field label={kind === "event" ? "Date" : "Show from"} required={kind === "event"} error={errors.startsOn}><Input type="date" value={f.startsOn} onChange={(e) => set("startsOn", e.target.value)} /></Field>
            <Field label={kind === "event" ? "Till (for more days)" : "Show till"} error={errors.endsOn}><Input type="date" value={f.endsOn} min={f.startsOn} onChange={(e) => set("endsOn", e.target.value)} /></Field>
          </> : <Field label="Effective from"><Input type="date" value={f.startsOn} onChange={(e) => set("startsOn", e.target.value)} /></Field>}
          {kind === "event" && <>
            <Field label="Starts at"><Input type="time" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></Field>
            <Field label="Ends at"><Input type="time" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></Field>
            <Field label="Where" className="sm:col-span-2"><Input value={f.location} maxLength={160} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Main shop, first floor" /></Field>
          </>}
          {kind === "announcement" && <Field label="Status"><NativeSelect value={f.status} aria-label="Status" onChange={(e) => set("status", e.target.value as Post["status"])}><option value="active">Active</option><option value="draft">Draft</option><option value="inactive">Inactive</option></NativeSelect></Field>}
          {kind === "document" && <Field label="Document" error={errors.url} className="sm:col-span-2" hint="The policy or handbook file"><FileField value={f.url} onChange={(v) => set("url", v ?? "")} prompt="Upload the document" /></Field>}
          <Field label={kind === "announcement" ? "Announcement" : kind === "event" ? "Details" : "Or the text"} required={kind === "announcement"} error={errors.body} className="sm:col-span-2"><Textarea rows={4} maxLength={5000} value={f.body} onChange={(e) => set("body", e.target.value)} placeholder={kind === "announcement" ? "Write what everyone should know" : "Optional"} /></Field>
          {depts.length > 0 && kind !== "document" && (
            <Field label="Who sees it" className="sm:col-span-2" hint="None chosen = everyone">
              <div className="flex flex-wrap gap-1.5">{depts.map((d) => { const on = f.departmentIds.includes(d.id); return <button key={d.id} type="button" aria-pressed={on} onClick={() => set("departmentIds", on ? f.departmentIds.filter((x) => x !== d.id) : [...f.departmentIds, d.id])} className={cn("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{d.name}</button> })}</div>
            </Field>
          )}
          {kind === "document" && <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm sm:col-span-2"><span><span className="font-medium">Staff must confirm they have read it</span><span className="block text-xs text-muted-foreground">You see who has and who hasn&apos;t</span></span><Switch checked={f.needsAck} onCheckedChange={(v) => set("needsAck", v)} aria-label="Needs confirmation" /></label>}
          <div className="sm:col-span-2"><FormError message={error} /></div>
          {kind !== "announcement" && !post?.id && <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">It goes in as <strong>Pending</strong>. Staff see it once someone approves it from the list.</p>}
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!post && unchanged)}>{busy ? "Saving…" : post?.id ? "Save" : `Add ${k.one}`}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const EVENT_COLORS = ["blue", "emerald", "violet", "orange", "rose", "amber"]
const BLANK_EVENT = { id: "", kind: "event", title: "", category: null, body: null, startsOn: null, endsOn: null, startsAt: null, endsAt: null, location: null, priority: "normal", departmentIds: [], departments: [], url: null, needsAck: false, status: "pending", color: null, createdByName: null, approvedByName: null, approvedAt: null, acks: 0, employees: 0, ackedByMe: null, createdAt: "" } as unknown as Post

function AcksDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  const { data } = useApi<{ data: { id: string; name: string; code: string; ackedAt: string | null }[] }>(`/hr/posts/${post.id}/acks`)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Who has read it</DialogTitle><DialogDescription>{post.title}</DialogDescription></DialogHeader>
        {!data ? <PageLoading /> : (
          <ul className="max-h-96 divide-y overflow-y-auto rounded-xl border">{data.data.map((e) => <li key={e.id} className="flex items-center justify-between px-3 py-2 text-sm"><span>{e.name} <span className="font-mono text-xs text-muted-foreground">{e.code}</span></span>{e.ackedAt ? <Pill color="emerald" dot>{formatDate(e.ackedAt)}</Pill> : <Pill color="amber">Not yet</Pill>}</li>)}</ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function WorkplacePage() {
  return <React.Suspense fallback={<PageLoading />}><Workplace /></React.Suspense>
}

function Workplace() {
  const { kind } = useParams<{ kind: Kind }>()
  const search = useSearchParams()
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Post | "new" | null>(search.get("add") ? "new" : null)
  const [acks, setAcks] = React.useState<Post | null>(null)
  const [viewing, setViewing] = React.useState<Post | null>(null)
  const [mode, setMode] = React.useState<"list" | "calendar">(search.get("view") === "calendar" ? "calendar" : "list")
  const [month, setMonth] = React.useState(() => todayInIndia().slice(0, 7))
  const cal = useApi<{ data: Post[] }>(mode === "calendar" && kind === "event" ? `/hr/posts?kind=event&v=${version}` : null)
  const [deleting, setDeleting] = React.useState<Post | null>(null)
  const k = KINDS[kind]
  if (!k) notFound()
  if (!can("hr.workplace.view")) return <PageHeader title={k.title} description="You don't have access to this. Ask your admin." />
  const reload = () => setVersion((v) => v + 1)
  const edit = can("hr.workplace.edit")
  const today = todayInIndia()
  async function decide(p: Post, status: string) {
    try { await api.post(`/hr/posts/${p.id}/status`, { status }); toast.success(`${p.title}: ${STATUS[status]?.label.toLowerCase() ?? status}`); reload() } catch (e) { toast.error(errorMessage(e)) }
  }
  async function ack(p: Post) {
    try { await api.post(`/hr/posts/${p.id}/ack`, {}); toast.success("Thanks, noted that you have read it"); reload() } catch (e) { toast.error(errorMessage(e)) }
  }
  const presets: ViewPreset[] = kind === "announcement"
    ? [{ key: "all", label: "All", params: {}, countKey: "all" }, { key: "active", label: "Active", params: { status: "active" }, countKey: "active" }, { key: "draft", label: "Draft", params: { status: "draft" }, countKey: "draft" }, { key: "inactive", label: "Inactive", params: { status: "inactive" }, countKey: "inactive" }]
    : [{ key: "all", label: "All", params: {}, countKey: "all" }, { key: "pending", label: "Pending", params: { status: "pending" }, countKey: "pending" }, { key: "approved", label: "Approved", params: { status: "approved" }, countKey: "approved" }, { key: "rejected", label: "Rejected", params: { status: "rejected" }, countKey: "rejected" }, ...(kind === "event" ? [{ key: "upcoming", label: "Coming up", params: { status: "approved", show: "upcoming" } }] : [])]
  const columns: Column<Post>[] = [
    { key: "title", header: "Title", hideable: false, sort: (p) => p.title, csv: (p) => p.title, cell: (p) => { const Icon = k.icon; return <span className="flex items-center gap-2.5"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-4" /></span><span className="min-w-0"><span className="block font-medium">{p.title}{p.priority === "high" && <Pill color="rose" className="ml-2">Important</Pill>}</span><span className="block max-w-80 truncate text-xs text-muted-foreground">{p.body ?? p.url ?? ""}</span></span></span> } },
    { key: "category", header: "Category", csv: (p) => p.category ?? "", cell: (p) => (p.category ? <Pill color={PRIORITY[p.priority]}>{p.category}</Pill> : "—") },
    { key: "when", header: kind === "event" ? "When" : kind === "document" ? "Effective" : "Shows", sort: (p) => p.startsOn ?? "", csv: (p) => p.startsOn?.slice(0, 10) ?? "", cell: (p) => (p.startsOn ? <span>{formatDate(p.startsOn)}{p.endsOn && p.endsOn !== p.startsOn && <> – {formatDate(p.endsOn)}</>}{(p.startsAt || p.location) && <span className="block text-xs text-muted-foreground">{[p.startsAt && `${p.startsAt}${p.endsAt ? `–${p.endsAt}` : ""}`, p.location].filter(Boolean).join(" · ")}</span>}</span> : "—") },
    { key: "who", header: "For", csv: (p) => p.departments.join(", ") || "Everyone", cell: (p) => <span className="text-sm">{p.departments.length ? p.departments.join(", ") : "Everyone"}</span> },
    ...(kind === "document" ? [{ key: "acks", header: "Read by", csv: (p: Post) => (p.needsAck ? `${p.acks}/${p.employees}` : ""), cell: (p: Post) => (p.needsAck && LIVE.includes(p.status) ? (p.ackedByMe === false ? <Button size="sm" className="h-8" onClick={(e) => { e.stopPropagation(); void ack(p) }}><CheckCircle2 /> I have read it</Button> : <button type="button" onClick={(e) => { e.stopPropagation(); if (edit) setAcks(p) }} className="text-sm hover:underline"><strong className="tabular-nums">{p.acks}</strong> of {p.employees}</button>) : <span className="text-muted-foreground">—</span>) }] : []),
    ...(kind === "document" ? [{ key: "file", header: "Document", csv: (p: Post) => p.url ?? "", cell: (p: Post) => (p.url ? <a href={p.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><ExternalLink className="size-3.5" /> Open</a> : <span className="text-muted-foreground">Text only</span>) }] : []),
    { key: "by", header: "Uploaded by", sort: (p) => p.createdByName ?? "", csv: (p) => p.createdByName ?? "", cell: (p) => <span className="text-sm">{p.createdByName ?? "—"}<span className="block text-xs text-muted-foreground">{formatDate(p.createdAt)}</span></span> },
    { key: "approved", header: kind === "announcement" ? "Published by" : "Approved by", csv: (p) => p.approvedByName ?? "", cell: (p) => (p.approvedByName ? <span className="text-sm">{p.approvedByName}{p.approvedAt && <span className="block text-xs text-muted-foreground">{formatDate(p.approvedAt)}</span>}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "status", header: "Status", csv: (p) => STATUS[p.status]?.label ?? p.status, cell: (p) => <Pill color={STATUS[p.status]?.color} dot>{STATUS[p.status]?.label}</Pill> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (p) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {edit && p.status === "pending" && <>
            <Button variant="ghost" size="icon-sm" title="Approve" aria-label={`Approve ${p.title}`} className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400" onClick={() => void decide(p, "approved")}><CheckCircle2 /></Button>
            <Button variant="ghost" size="icon-sm" title="Reject" aria-label={`Reject ${p.title}`} className="text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => void decide(p, "rejected")}><XCircle /></Button>
          </>}
          <Button variant="ghost" size="icon-sm" title="View" aria-label={`View ${p.title}`} onClick={() => setViewing(p)}><Eye /></Button>
          {edit && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${p.title}`} onClick={() => setEditing(p)}><Pencil /></Button>}
          <ActionMenu label={`More actions for ${p.title}`} items={[
            edit && kind !== "announcement" && p.status !== "approved" && { label: "Approve", icon: CheckCircle2, onClick: () => void decide(p, "approved") },
            edit && kind !== "announcement" && p.status !== "rejected" && { label: "Reject", icon: XCircle, onClick: () => void decide(p, "rejected") },
            edit && kind !== "announcement" && p.status !== "pending" && { label: "Back to pending", icon: RotateCcw, onClick: () => void decide(p, "pending") },
            edit && kind === "announcement" && p.status !== "active" && { label: "Publish (active)", icon: CheckCircle2, onClick: () => void decide(p, "active") },
            edit && kind === "announcement" && p.status === "active" && { label: "Make inactive", icon: XCircle, onClick: () => void decide(p, "inactive") },
            p.url && { label: "Open document", icon: ExternalLink, onClick: () => void openFile(p.url) },
            kind === "document" && p.needsAck && edit && { label: "Who has read it", icon: Users, onClick: () => setAcks(p) },
            "-",
            can("hr.workplace.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(p) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("hr.workplace.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> New {k.one}</Button> : undefined
  const toggle = kind === "event" ? (
    <div className="flex rounded-xl border p-0.5" role="radiogroup" aria-label="Show as">
      {(["list", "calendar"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn("flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{m === "list" ? <List className="size-4" /> : <CalendarDays className="size-4" />}{m === "list" ? "List" : "Calendar"}</button>)}
    </div>
  ) : undefined
  const calendar = mode === "calendar" && kind === "event" && (
    <section className="ui-surface grid gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-[26px] leading-tight font-bold tracking-tight">{k.title}</h1><p className="mt-0.5 text-sm text-muted-foreground">Approved events are solid, waiting ones are faded. Click one to see it.</p></div>
        <div className="flex flex-wrap gap-2">{toggle}{add}</div>
      </div>
      {!cal.data ? <PageLoading /> : (
        <MonthCalendar month={month} onMonth={setMonth} onPick={(id) => setViewing(cal.data!.data.find((x) => x.id === id) ?? null)}
          onDay={can("hr.workplace.create") ? (d) => setEditing({ ...BLANK_EVENT, startsOn: d }) : undefined}
          items={cal.data.data.filter((x) => x.startsOn && x.status !== "rejected").map((x) => ({ id: x.id, title: `${x.startsAt ? `${x.startsAt} ` : ""}${x.title}`, from: x.startsOn!, to: x.endsOn, color: EVENT_COLORS[(x.category ?? "").length % EVENT_COLORS.length], striped: x.status !== "approved", sub: x.location }))} />
      )}
    </section>
  )
  return (
    <>
      {calendar || <DataList<Post>
        id={`hr-${kind}`}
        load={localList(
          async () => (await api.get<{ data: Post[] }>(`/hr/posts?kind=${kind}`)).data,
          (p, q) => `${p.title} ${p.category ?? ""} ${p.body ?? ""} ${p.location ?? ""}`.toLowerCase().includes(q),
          {
            filter: (p, q) => {
              const end = (p.endsOn ?? p.startsOn ?? "9999").slice(0, 10)
              if (q.status && p.status !== q.status) return false
              if (q.show === "upcoming") return end >= today
              return true
            },
            counts: (rows) => countBy(rows, (p) => p.status),
          },
        )}
        params={{ v: String(version) }}
        tabs
        header={{ title: k.title, description: k.description, primary: add, actions: toggle }}
        columns={columns}
        searchPlaceholder="Search title or text"
        presetLabel="Show"
        presets={presets}
        rowClick={(p) => setViewing(p)}
        exportName={kind}
        emptyState={<EmptyState icon={k.icon} title={`No ${k.title.toLowerCase()} here`} action={add} />}
      />}
      {viewing && (
        <RecordView
          title={viewing.title}
          icon={k.icon}
          status={<Pill color={STATUS[viewing.status]?.color} dot>{STATUS[viewing.status]?.label}</Pill>}
          onClose={() => setViewing(null)}
          fields={[
            { label: "Category", value: viewing.category },
            { label: "Priority", value: <Pill color={PRIORITY[viewing.priority]}>{viewing.priority === "high" ? "Important" : viewing.priority === "low" ? "Low" : "Normal"}</Pill> },
            { label: kind === "event" ? "Date" : kind === "document" ? "Effective from" : "Shows from", value: viewing.startsOn ? formatDate(viewing.startsOn) : null },
            kind !== "document" && { label: kind === "event" ? "Till" : "Shows till", value: viewing.endsOn ? formatDate(viewing.endsOn) : "No end date" },
            kind === "event" && { label: "Time", value: viewing.startsAt ? `${viewing.startsAt}${viewing.endsAt ? ` – ${viewing.endsAt}` : ""}` : "All day" },
            kind === "event" && { label: "Where", value: viewing.location },
            { label: "For", value: viewing.departments.length ? viewing.departments.join(", ") : "Everyone" },
            kind === "document" && { label: "Document", value: viewing.url ? null : "Text only", href: viewing.url },
            kind === "document" && viewing.needsAck && { label: "Read by", value: `${viewing.acks} of ${viewing.employees} staff` },
            { label: kind === "document" ? "Uploaded by" : "Added by", value: `${viewing.createdByName ?? "—"} · ${formatDate(viewing.createdAt)}` },
            { label: kind === "announcement" ? "Published by" : "Approved by", value: viewing.approvedByName ? `${viewing.approvedByName}${viewing.approvedAt ? ` · ${formatDate(viewing.approvedAt)}` : ""}` : "Not yet" },
            !!viewing.body && { label: kind === "announcement" ? "Announcement" : "Details", value: viewing.body, full: true },
          ]}
          footer={<>
            {viewing.url && <Button variant="outline" onClick={() => void openFile(viewing.url)}><ExternalLink /> Open document</Button>}
            {kind === "document" && viewing.needsAck && viewing.ackedByMe === false && LIVE.includes(viewing.status) && <Button variant="outline" onClick={() => { void ack(viewing); setViewing(null) }}><CheckCircle2 /> I have read it</Button>}
            {edit && <Button variant="outline" onClick={() => { setEditing(viewing); setViewing(null) }}><Pencil /> Edit</Button>}
            {edit && kind !== "announcement" && viewing.status !== "rejected" && <Button variant="outline" onClick={() => { void decide(viewing, "rejected"); setViewing(null) }}><XCircle /> Reject</Button>}
            {edit && kind !== "announcement" && viewing.status !== "approved" && <Button onClick={() => { void decide(viewing, "approved"); setViewing(null) }}><CheckCircle2 /> Approve</Button>}
            {edit && kind === "announcement" && viewing.status !== "active" && <Button onClick={() => { void decide(viewing, "active"); setViewing(null) }}><CheckCircle2 /> Publish</Button>}
          </>}
        />
      )}
      {editing && <PostDialog kind={kind} post={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {acks && <AcksDialog post={acks} onClose={() => setAcks(null)} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete "${deleting?.title}"?`} confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/posts/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
