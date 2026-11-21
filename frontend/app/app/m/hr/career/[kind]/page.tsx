"use client"

import * as React from "react"
import { notFound, useParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowRight, Award, Check, CheckCircle2, ExternalLink, Eye, FileBadge, Pencil, Plus, Trash2, UserRound, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { countBy, DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ActionMenu, Pill } from "@/components/page-parts"
import { DocLink, PersonCell, RecordView } from "@/components/record-view"
import { DepartmentSelect, DesignationSelect, EmployeeSelect, HrTabs, ListSelect, TABS } from "@/components/hr/pickers"
import { SearchSelect } from "@/components/search-select"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi } from "@/lib/use-api"
import { formatDate } from "@/lib/format"
import { ACTION_STATUS, type ActionKind, type HrAction, type ListKey } from "@/lib/hr"
import { useChanged } from "@/lib/use-dirty"
import { activeOr } from "@/lib/active"

// Career and conduct records, one page per kind. Approving a promotion or transfer changes the
// employee; an accepted resignation or approved termination sets their last day.

interface KindDef {
  title: string; one: string; description: string; statuses: string[]; done?: string[]
  list?: ListKey; typeLabel?: string; dateLabel: string; effLabel?: string; move?: boolean; subject?: boolean; severity?: boolean; against?: boolean; reasonRequired?: boolean
}
const KINDS: Record<ActionKind, KindDef> = {
  promotion: { title: "Promotions", one: "promotion", description: "Moving someone up. Approving it changes their designation (and department).", statuses: ["pending", "approved", "rejected"], done: ["approved"], dateLabel: "Proposed on", effLabel: "Takes effect", move: true },
  transfer: { title: "Transfers", one: "transfer", description: "Moving someone to another department or branch. Approving it updates their record.", statuses: ["pending", "approved", "rejected"], done: ["approved"], dateLabel: "Asked on", effLabel: "Moves on", move: true },
  award: { title: "Awards", one: "award", description: "Recognition for good work. It shows on their profile.", statuses: ["given"], list: "awardTypes", typeLabel: "Award", dateLabel: "Given on" },
  warning: { title: "Warnings", one: "warning", description: "A written warning for conduct or performance.", statuses: ["issued", "acknowledged", "withdrawn"], list: "warningTypes", typeLabel: "Warning for", dateLabel: "Issued on", subject: true, severity: true },
  complaint: { title: "Complaints", one: "complaint", description: "Complaints raised by staff, followed until resolved.", statuses: ["open", "in_review", "resolved", "dismissed"], list: "complaintTypes", typeLabel: "Complaint type", dateLabel: "Raised on", subject: true, against: true },
  resignation: { title: "Resignations", one: "resignation", description: "Accepting one puts them on notice till the last working day, then marks them as left.", statuses: ["pending", "accepted", "rejected"], done: ["accepted"], dateLabel: "Notice given on", effLabel: "Last working day", reasonRequired: true },
  termination: { title: "Terminations", one: "termination", description: "Ending employment. Approving it sets the last working day.", statuses: ["pending", "approved", "rejected"], done: ["approved"], list: "terminationTypes", typeLabel: "Reason type", dateLabel: "Notice date", effLabel: "Last working day", reasonRequired: true },
}
const SEVERITY: Record<string, string> = { low: "slate", medium: "amber", high: "rose" }
const SEVERITY_LABEL: Record<string, string> = { low: "Minor", medium: "Moderate", high: "Major" }

function ActionDialog({ kind, record, onClose, onSaved }: { kind: ActionKind; record: HrAction | null; onClose: () => void; onSaved: () => void }) {
  const k = KINDS[kind]
  const branches = useSharedApi<{ data: { id: string; name: string }[] }>("/branches")
  const [f, setF] = React.useState({
    employeeId: record?.employeeId ?? "", againstId: record?.againstId ?? "", onDate: record?.onDate.slice(0, 10) ?? todayInIndia(), effectiveOn: record?.effectiveOn?.slice(0, 10) ?? "",
    typeName: record?.typeName ?? "", subject: record?.subject ?? "", description: record?.description ?? "", severity: record?.severity ?? "medium",
    branchId: record?.toData?.branchId ?? "", departmentId: record?.toData?.departmentId ?? "", designationId: record?.toData?.designationId ?? "", documentUrl: record?.documentUrl ?? "",
  })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(key: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [key]: v })); setErrors({}); setError(null) }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.employeeId) x.employeeId = "Choose the employee"
    if (!f.onDate) x.onDate = "Choose the date"
    if (k.move && !f.designationId && !f.departmentId && !f.branchId) x["to.designationId"] = kind === "promotion" ? "Choose the new designation" : "Choose where they move to"
    if (k.effLabel && !f.effectiveOn) x.effectiveOn = `Choose the ${k.effLabel.toLowerCase()}`
    if (k.effLabel && f.effectiveOn && f.effectiveOn < f.onDate) x.effectiveOn = "Must be on or after the first date"
    if (k.list && !f.typeName) x.typeName = "Choose the type"
    if (k.subject && f.subject.trim().length < 3) x.subject = "Enter the subject"
    if (k.reasonRequired && f.description.trim().length < 3) x.description = "Give the reason"
    if (k.against && f.againstId && f.againstId === f.employeeId) x.againstId = "Someone other than the person complaining"
    if (f.documentUrl && !/^https?:\/\//.test(f.documentUrl)) x.documentUrl = "Enter a full link, starting with https://"
    setErrors(x)
    if (Object.keys(x).length) return setError("Fix the marked fields first.")
    setBusy(true)
    const n = (v: string) => v.trim() || null
    const body = { kind, employeeId: f.employeeId, againstId: k.against ? n(f.againstId) : null, onDate: f.onDate, effectiveOn: n(f.effectiveOn), typeName: n(f.typeName), subject: n(f.subject), description: n(f.description), severity: k.severity ? f.severity : null, to: k.move ? { branchId: n(f.branchId), departmentId: n(f.departmentId), designationId: n(f.designationId) } : null, documentUrl: n(f.documentUrl) }
    try {
      if (record) await api.put(`/hr/actions/${record.id}`, { ...body, version: record.version })
      else await api.post("/hr/actions", body)
      toast.success(record ? "Saved" : `${k.one[0].toUpperCase()}${k.one.slice(1)} recorded`)
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
        <DialogHeader><DialogTitle>{record ? `Edit ${k.one}` : `New ${k.one}`}</DialogTitle><DialogDescription>{k.description}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label={kind === "complaint" ? "Raised by" : "Employee"} required error={errors.employeeId} className="sm:col-span-2"><EmployeeSelect value={f.employeeId} onChange={(v) => set("employeeId", v)} aria-label="Employee" /></Field>
          {k.against && <Field label="Against" error={errors.againstId} className="sm:col-span-2" hint="Leave empty if it is not about a person"><EmployeeSelect value={f.againstId} exclude={f.employeeId} onChange={(v) => set("againstId", v)} placeholder="Who it is about (optional)" aria-label="Against" /></Field>}
          {k.move && <>
            <Field label="New department" error={errors["to.departmentId"]}><DepartmentSelect value={f.departmentId} onChange={(v) => set("departmentId", v)} aria-label="New department" /></Field>
            <Field label="New designation" required={kind === "promotion"} error={errors["to.designationId"]}><DesignationSelect value={f.designationId} departmentId={f.departmentId} onChange={(v) => set("designationId", v)} aria-label="New designation" /></Field>
            {(branches.data?.data.length ?? 0) > 1 && <Field label="New branch" className="sm:col-span-2"><SearchSelect value={f.branchId} onChange={(v) => set("branchId", v)} options={[{ value: "", label: "Same branch" }, ...activeOr(branches.data?.data ?? [], f.branchId).map((b) => ({ value: b.id, label: b.name }))]} aria-label="New branch" /></Field>}
          </>}
          {k.list && <Field label={k.typeLabel!} required error={errors.typeName}><ListSelect list={k.list} value={f.typeName} onChange={(v) => set("typeName", v)} aria-label={k.typeLabel} /></Field>}
          {k.severity && <Field label="Severity"><NativeSelect value={f.severity} aria-label="Severity" onChange={(e) => set("severity", e.target.value)}><option value="low">Minor</option><option value="medium">Moderate</option><option value="high">Major</option></NativeSelect></Field>}
          <Field label={k.dateLabel} required error={errors.onDate}><Input type="date" value={f.onDate} onChange={(e) => set("onDate", e.target.value)} /></Field>
          {k.effLabel && <Field label={k.effLabel} required error={errors.effectiveOn}><Input type="date" value={f.effectiveOn} min={f.onDate} onChange={(e) => set("effectiveOn", e.target.value)} /></Field>}
          {k.subject && <Field label="Subject" required error={errors.subject} className="sm:col-span-2"><Input value={f.subject} maxLength={160} onChange={(e) => set("subject", e.target.value)} placeholder={kind === "warning" ? "e.g. Late on 4 days in October" : "e.g. Rude behaviour at the counter"} /></Field>}
          <Field label={k.reasonRequired ? "Reason" : "Details"} required={k.reasonRequired} error={errors.description} className="sm:col-span-2"><Textarea rows={3} maxLength={2000} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder={kind === "award" ? "What they did, e.g. Highest sales in Diwali week" : "What happened, briefly"} /></Field>
          <Field label="Letter or document link" error={errors.documentUrl} className="sm:col-span-2" hint="Optional: a link to the signed letter"><Input value={f.documentUrl} maxLength={500} onChange={(e) => set("documentUrl", e.target.value)} placeholder="https://…" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!record && unchanged)}>{busy ? "Saving…" : record ? "Save" : `Record ${k.one}`}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StatusDialog({ record, status, onClose, onSaved }: { record: HrAction; status: string; onClose: () => void; onSaved: () => void }) {
  const [response, setResponse] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const needs = status === "rejected"
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (needs && response.trim().length < 3) return setError("Say why, so they know.")
    setBusy(true)
    try {
      await api.post(`/hr/actions/${record.id}/status`, { status, response: response.trim() || null })
      toast.success(`Marked ${ACTION_STATUS[status]?.label.toLowerCase() ?? status}`)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  const note: Record<string, string> = { approved: record.kind === "termination" ? "Their last working day is set; after it they are marked as left." : "Their designation, department and branch change now.", accepted: "They go on notice till the last working day, then are marked as left." }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Mark as {ACTION_STATUS[status]?.label.toLowerCase()}</DialogTitle><DialogDescription>{record.employee}{record.subject ? ` · ${record.subject}` : ""}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          {note[status] && <p className="rounded-xl bg-muted/60 p-3 text-sm">{note[status]}</p>}
          <Field label={needs ? "Why" : "Note"} required={needs}><Textarea rows={2} maxLength={1000} autoFocus value={response} onChange={(e) => { setResponse(e.target.value); setError(null) }} placeholder={needs ? "e.g. Not enough experience yet" : "Optional"} /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" variant={needs ? "destructive" : "default"} disabled={busy}>{busy ? "Saving…" : "Confirm"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}


const daysBetween = (a: string, b: string) => Math.round((new Date(b.slice(0, 10)).getTime() - new Date(a.slice(0, 10)).getTime()) / 86_400_000)
const place = (p: { branch: string | null; department: string | null; designation: string | null }) => [p.designation, p.department, p.branch].filter(Boolean).join(" · ")

export default function CareerPage() {
  const { kind } = useParams<{ kind: ActionKind }>()
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<HrAction | "new" | null>(null)
  const [viewing, setViewing] = React.useState<HrAction | null>(null)
  const [moving, setMoving] = React.useState<{ record: HrAction; status: string } | null>(null)
  const [deleting, setDeleting] = React.useState<HrAction | null>(null)
  const k = KINDS[kind]
  if (!k) notFound()
  if (!can("hr.career.view")) return <PageHeader title={k.title} description="You don't have access to this. Ask your admin." />
  const reload = () => setVersion((v) => v + 1)
  const done = (r: HrAction) => (k.done ?? []).includes(r.status)
  const presets: ViewPreset[] = k.statuses.length > 1 ? [{ key: "all", label: "All", params: {}, countKey: "all" }, ...k.statuses.map((s) => ({ key: s, label: ACTION_STATUS[s].label, params: { status: s }, countKey: s }))] : []
  const status = (r: HrAction) => <Pill color={ACTION_STATUS[r.status]?.color} dot>{ACTION_STATUS[r.status]?.label ?? r.status}</Pill>
  const person = (r: HrAction) => <PersonCell name={r.employee} sub={r.employeeSub ?? r.employeeCode} />
  const typePill = (r: HrAction) => (r.typeName ? <Pill color={kind === "award" ? "amber" : kind === "termination" ? "rose" : "violet"}>{r.typeName}</Pill> : <span className="text-muted-foreground">—</span>)
  const date = (v: string | null | undefined) => (v ? formatDate(v) : <span className="text-muted-foreground">—</span>)
  const decided = (r: HrAction) => (r.decidedByName ? <span className="text-sm">{r.decidedByName}{r.decidedAt && <span className="block text-xs text-muted-foreground">{formatDate(r.decidedAt)}</span>}</span> : <span className="text-muted-foreground">—</span>)

  // Columns follow each kind, so every list shows what matters for it
  const byKind: Record<ActionKind, Column<HrAction>[]> = {
    promotion: [
      { key: "from", header: "Previous position", csv: (r) => place(r.from), cell: (r) => <span className="block max-w-56 text-sm text-muted-foreground">{place(r.from) || "—"}</span> },
      { key: "to", header: "New designation", csv: (r) => r.to.designation ?? "", cell: (r) => <span className="grid gap-0.5"><Pill color="emerald">{r.to.designation ?? r.from.designation ?? "—"}</Pill>{(r.to.department || r.to.branch) && <span className="text-xs text-muted-foreground">{[r.to.department, r.to.branch].filter(Boolean).join(" · ")}</span>}</span> },
      { key: "eff", header: "Effective date", sort: (r) => r.effectiveOn ?? "", csv: (r) => r.effectiveOn?.slice(0, 10) ?? "", cell: (r) => date(r.effectiveOn) },
    ],
    transfer: [
      { key: "path", header: "Transfer path", csv: (r) => `${place(r.from)} → ${place(r.to)}`, cell: (r) => <span className="flex flex-wrap items-center gap-1.5 text-sm"><Pill color="slate">{r.from.branch ?? r.from.department ?? "—"}</Pill><ArrowRight className="size-3.5 text-muted-foreground" /><Pill color="blue">{r.to.branch ?? r.to.department ?? r.from.branch ?? "—"}</Pill></span> },
      { key: "dept", header: "New department", csv: (r) => r.to.department ?? "", cell: (r) => r.to.department ?? <span className="text-muted-foreground">Same</span> },
      { key: "eff", header: "Effective date", sort: (r) => r.effectiveOn ?? "", csv: (r) => r.effectiveOn?.slice(0, 10) ?? "", cell: (r) => date(r.effectiveOn) },
    ],
    award: [
      { key: "type", header: "Award type", csv: (r) => r.typeName ?? "", cell: (r) => <span className="flex items-center gap-1.5"><Award className="size-4 text-amber-500" />{typePill(r)}</span> },
      { key: "date", header: "Award date", sort: (r) => r.onDate, csv: (r) => r.onDate.slice(0, 10), cell: (r) => formatDate(r.onDate) },
      { key: "desc", header: "For", csv: (r) => r.description ?? "", cell: (r) => <span className="block max-w-64 truncate text-sm text-muted-foreground" title={r.description ?? ""}>{r.description ?? "—"}</span> },
      { key: "cert", header: "Certificate", cell: (r) => <a href={`/print/award/${r.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><FileBadge className="size-3.5" /> View certificate</a> },
    ],
    warning: [
      { key: "by", header: "Warning by", csv: (r) => r.createdByName ?? "", cell: (r) => <PersonCell name={r.createdByName} sub="Issued the warning" /> },
      { key: "subject", header: "Subject", csv: (r) => r.subject ?? "", cell: (r) => <span className="grid max-w-64 gap-1"><span className="truncate font-medium" title={r.subject ?? ""}>{r.subject}</span>{typePill(r)}</span> },
      { key: "severity", header: "Severity", csv: (r) => r.severity ?? "", cell: (r) => (r.severity ? <Pill color={SEVERITY[r.severity]}>{SEVERITY_LABEL[r.severity] ?? r.severity}</Pill> : "—") },
      { key: "date", header: "Warning date", sort: (r) => r.onDate, csv: (r) => r.onDate.slice(0, 10), cell: (r) => formatDate(r.onDate) },
      { key: "reply", header: "Employee response", defaultHidden: true, csv: (r) => r.response ?? "", cell: (r) => <span className="block max-w-56 truncate text-sm text-muted-foreground">{r.response ?? "—"}</span> },
    ],
    complaint: [
      { key: "against", header: "Against employee", csv: (r) => r.against ?? "", cell: (r) => (r.against ? <PersonCell name={r.against} sub={r.againstSub} /> : <span className="text-muted-foreground">Not about a person</span>) },
      { key: "subject", header: "Subject", csv: (r) => r.subject ?? "", cell: (r) => <span className="grid max-w-72 gap-1"><span className="truncate font-medium" title={r.subject ?? ""}>{r.subject}</span>{typePill(r)}</span> },
      { key: "date", header: "Complaint date", sort: (r) => r.onDate, csv: (r) => r.onDate.slice(0, 10), cell: (r) => formatDate(r.onDate) },
    ],
    resignation: [
      { key: "notice", header: "Notice date", sort: (r) => r.onDate, csv: (r) => r.onDate.slice(0, 10), cell: (r) => formatDate(r.onDate) },
      { key: "last", header: "Last working date", sort: (r) => r.effectiveOn ?? "", csv: (r) => r.effectiveOn?.slice(0, 10) ?? "", cell: (r) => <span>{date(r.effectiveOn)}{r.effectiveOn && <span className="block text-xs text-muted-foreground">{daysBetween(r.onDate, r.effectiveOn)} days notice</span>}</span> },
      { key: "reason", header: "Reason", csv: (r) => r.description ?? "", cell: (r) => <span className="block max-w-64 truncate text-sm text-muted-foreground" title={r.description ?? ""}>{r.description ?? "—"}</span> },
    ],
    termination: [
      { key: "type", header: "Termination type", csv: (r) => r.typeName ?? "", cell: (r) => typePill(r) },
      { key: "notice", header: "Notice date", sort: (r) => r.onDate, csv: (r) => r.onDate.slice(0, 10), cell: (r) => formatDate(r.onDate) },
      { key: "last", header: "Termination date", sort: (r) => r.effectiveOn ?? "", csv: (r) => r.effectiveOn?.slice(0, 10) ?? "", cell: (r) => <span>{date(r.effectiveOn)}{r.effectiveOn && <span className="block text-xs text-muted-foreground">{daysBetween(r.onDate, r.effectiveOn)} days notice</span>}</span> },
    ],
  }

  const columns: Column<HrAction>[] = [
    { key: "employee", header: kind === "complaint" ? "Raised by" : "Employee", hideable: false, sort: (r) => r.employee, csv: (r) => r.employee, cell: person },
    { key: "code", header: "Employee ID", defaultHidden: true, csv: (r) => r.employeeCode, cell: (r) => <span className="font-mono text-xs">{r.employeeCode}</span> },
    ...byKind[kind],
    ...(k.statuses.length > 1 ? [{ key: "status", header: "Status", csv: (r: HrAction) => ACTION_STATUS[r.status]?.label ?? r.status, cell: status }] : []),
    ...(kind !== "award" ? [{ key: "doc", header: "Document", csv: (r: HrAction) => r.documentUrl ?? "", cell: (r: HrAction) => <DocLink href={r.documentUrl} /> }] : []),
    ...(k.statuses.length > 1 ? [{ key: "decided", header: kind === "complaint" ? "Handled by" : "Approved by", csv: (r: HrAction) => r.decidedByName ?? "", cell: decided }] : []),
    { key: "created", header: "Recorded by", defaultHidden: true, csv: (r) => r.createdByName ?? "", cell: (r) => <span className="text-sm">{r.createdByName ?? "—"}<span className="block text-xs text-muted-foreground">{formatDate(r.createdAt)}</span></span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => {
        const next = k.statuses.filter((s) => s !== r.status)
        const first = next.find((s) => (k.done ?? []).includes(s) || s === "resolved" || s === "acknowledged")
        return (
          <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {can("hr.career.approve") && !done(r) && first && k.statuses[0] === r.status && <Button variant="ghost" size="icon-sm" title={ACTION_STATUS[first].label.replace("Approved", "Approve").replace("Accepted", "Accept").replace("Resolved", "Resolve")} aria-label={`Approve for ${r.employee}`} className="text-emerald-600 dark:text-emerald-400" onClick={() => setMoving({ record: r, status: first })}><CheckCircle2 /></Button>}
            {can("hr.career.approve") && !done(r) && next.includes("rejected") && <Button variant="ghost" size="icon-sm" title="Reject" aria-label={`Reject for ${r.employee}`} className="text-rose-600 dark:text-rose-400" onClick={() => setMoving({ record: r, status: "rejected" })}><XCircle /></Button>}
            <Button variant="ghost" size="icon-sm" title="View" aria-label={`View ${k.one} of ${r.employee}`} onClick={() => setViewing(r)}><Eye /></Button>
            {can("hr.career.edit") && !done(r) && <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${k.one} of ${r.employee}`} onClick={() => setEditing(r)}><Pencil /></Button>}
            <ActionMenu label={`More actions for ${r.employee}`} items={[
              ...(can("hr.career.approve") && !done(r) ? next.map((s) => ({ label: `Mark ${ACTION_STATUS[s].label.toLowerCase()}`, icon: Check, onClick: () => setMoving({ record: r, status: s }) })) : []),
              kind === "award" && { label: "Print certificate", icon: FileBadge, onClick: () => window.open(`/print/award/${r.id}`, "_blank") },
              r.documentUrl && { label: "Open document", icon: ExternalLink, onClick: () => window.open(r.documentUrl!, "_blank") },
              { label: "Open employee", icon: UserRound, href: `/app/m/hr/employees/${r.employeeId}?tab=career` },
              "-",
              can("hr.career.delete") && !done(r) && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) },
            ]} />
          </span>
        )
      },
    },
  ]
  const add = can("hr.career.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> New {k.one}</Button> : undefined

  const view = viewing && (
    <RecordView
      title={`${k.one[0].toUpperCase()}${k.one.slice(1)} details`}
      icon={kind === "award" ? Award : UserRound}
      status={k.statuses.length > 1 ? status(viewing) : undefined}
      onClose={() => setViewing(null)}
      fields={[
        { label: kind === "complaint" ? "Raised by" : "Employee", value: null, person: { name: viewing.employee, sub: [viewing.employeeCode, viewing.employeeSub].filter(Boolean).join(" · ") } },
        kind === "complaint" && (viewing.against ? { label: "Against employee", value: null, person: { name: viewing.against, sub: viewing.againstSub }, tone: "danger" } : { label: "Against employee", value: "Not about a person" }),
        kind === "warning" && { label: "Warning by", value: viewing.createdByName, person: viewing.createdByName ? { name: viewing.createdByName } : undefined },
        k.move && { label: "Previous position", value: place(viewing.from) || "—" },
        k.move && { label: "New position", value: place({ branch: viewing.to.branch ?? viewing.from.branch, department: viewing.to.department ?? viewing.from.department, designation: viewing.to.designation ?? viewing.from.designation }), tone: "success" },
        k.list && { label: k.typeLabel!, value: typePill(viewing) },
        k.severity && { label: "Severity", value: viewing.severity ? <Pill color={SEVERITY[viewing.severity]}>{SEVERITY_LABEL[viewing.severity] ?? viewing.severity}</Pill> : null },
        { label: k.dateLabel, value: formatDate(viewing.onDate) },
        !!k.effLabel && { label: k.effLabel, value: viewing.effectiveOn ? `${formatDate(viewing.effectiveOn)} · ${daysBetween(viewing.onDate, viewing.effectiveOn)} days later` : null },
        k.subject && { label: "Subject", value: viewing.subject, full: true },
        { label: k.reasonRequired ? "Reason" : "Details", value: viewing.description, full: true },
        !!viewing.response && { label: kind === "warning" ? "Employee response / note" : "Decision note", value: viewing.response, full: true, tone: viewing.status === "rejected" ? "danger" : undefined },
        { label: "Document", value: null, href: viewing.documentUrl },
        k.statuses.length > 1 && { label: kind === "complaint" ? "Handled by" : "Approved by", value: viewing.decidedByName ? `${viewing.decidedByName}${viewing.decidedAt ? ` · ${formatDate(viewing.decidedAt)}` : ""}` : "Not decided yet" },
        { label: "Recorded by", value: `${viewing.createdByName ?? "—"} · ${formatDate(viewing.createdAt)}` },
      ]}
      footer={<>
        {kind === "award" && <Button variant="outline" onClick={() => window.open(`/print/award/${viewing.id}`, "_blank")}><FileBadge /> Certificate</Button>}
        {can("hr.career.edit") && !done(viewing) && <Button variant="outline" onClick={() => { setEditing(viewing); setViewing(null) }}><Pencil /> Edit</Button>}
        {can("hr.career.approve") && !done(viewing) && k.statuses.filter((s) => s !== viewing.status).map((s) => <Button key={s} variant={s === "rejected" || s === "dismissed" || s === "withdrawn" ? "outline" : "default"} onClick={() => { setMoving({ record: viewing, status: s }); setViewing(null) }}>{ACTION_STATUS[s].label}</Button>)}
      </>}
    />
  )

  return (
    <>
      <HrTabs tabs={kind === "award" || kind === "promotion" ? TABS.recognition : kind === "complaint" || kind === "warning" ? TABS.issues : TABS.changes} active={kind} />
      <DataList<HrAction>
        id={`hr-${kind}`}
        load={localList(
          async () => (await api.get<{ data: HrAction[] }>(`/hr/actions?kind=${kind}`)).data,
          (r, q) => `${r.employee} ${r.employeeCode} ${r.subject ?? ""} ${r.typeName ?? ""} ${r.description ?? ""} ${r.against ?? ""}`.toLowerCase().includes(q),
          { filter: (r, p) => !p.status || r.status === p.status, counts: (rows) => countBy(rows, (r) => r.status) },
        )}
        params={{ v: String(version) }}
        header={{ title: k.title, description: k.description, primary: add }}
        columns={columns}
        searchPlaceholder="Search employee, subject or type"
        presetLabel="Show"
        presets={presets.length ? presets : undefined}
        tabs
        rowClick={(r) => setViewing(r)}
        exportName={kind}
        emptyState={<EmptyState icon={Award} title={`No ${k.title.toLowerCase()} yet`} action={add} />}
      />
      {view}
      {editing && <ActionDialog kind={kind} record={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {moving && <StatusDialog record={moving.record} status={moving.status} onClose={() => setMoving(null)} onSaved={() => { setMoving(null); reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete this ${k.one}?`} confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/actions/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
