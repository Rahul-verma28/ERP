"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, ClipboardList, Pencil, Plus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { EmployeeSelect, HrTabs, ListSelect, TABS } from "@/components/hr/pickers"
import { SearchSelect } from "@/components/search-select"
import type { Candidate } from "@/components/hr/recruit"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi } from "@/lib/use-api"
import { formatDate } from "@/lib/format"
import type { HrRecord } from "@/lib/hr"
import { useChanged } from "@/lib/use-dirty"
import { NoAccessPage } from "@/components/page-states"

// Candidate assessments: tests and tasks a candidate does, with the score and who checked it.

interface A { candidateId: string; title: string; onDate: string; conductedById?: string | null; score?: number | null; maxScore?: number | null; remarks?: string | null }
type Row = HrRecord<A>
const STATUS: Record<string, { label: string; color: string }> = { pending: { label: "Pending", color: "amber" }, passed: { label: "Passed", color: "emerald" }, failed: { label: "Not cleared", color: "rose" } }

function AssessmentDialog({ row, onClose, onSaved }: { row: Row | null; onClose: () => void; onSaved: () => void }) {
  const cands = useSharedApi<{ data: Candidate[] }>("/hr/candidates")
  const d = row?.data
  const [f, setF] = React.useState({ candidateId: d?.candidateId ?? "", title: d?.title ?? "", onDate: d?.onDate ?? todayInIndia(), conductedById: d?.conductedById ?? "", score: d?.score == null ? "" : String(d.score), maxScore: d?.maxScore == null ? "10" : String(d.maxScore), remarks: d?.remarks ?? "" })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.candidateId) x.candidateId = "Choose the candidate"
    if (!f.title) x.title = "Choose the assessment"
    if (!f.onDate) x.onDate = "Choose the date"
    if (f.score !== "" && f.maxScore !== "" && Number(f.score) > Number(f.maxScore)) x.score = "More than the maximum"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const body = { candidateId: f.candidateId, title: f.title, onDate: f.onDate, conductedById: f.conductedById || null, score: f.score === "" ? null : Number(f.score), maxScore: f.maxScore === "" ? null : Number(f.maxScore), remarks: f.remarks.trim() || null }
    try {
      if (row) await api.put(`/hr/records/assessment/${row.id}`, { ...body, version: row.version })
      else await api.post("/hr/records/assessment", body)
      toast.success(row ? "Assessment saved" : "Assessment added")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{row ? "Edit assessment" : "Add assessment"}</DialogTitle><DialogDescription>A test or task the candidate does before an offer.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Candidate" required error={errors.candidateId} className="sm:col-span-2"><SearchSelect value={f.candidateId} onChange={(v) => set("candidateId", v)} searchable options={(cands.data?.data ?? []).filter((c) => !["hired", "rejected"].includes(c.stage) || c.id === f.candidateId).map((c) => ({ value: c.id, label: `${c.name} · ${c.job}`, keywords: c.phone ?? "" }))} placeholder="Choose the candidate" aria-label="Candidate" /></Field>
          <Field label="Assessment" required error={errors.title}><ListSelect list="assessmentTypes" value={f.title} onChange={(v) => set("title", v)} aria-label="Assessment" /></Field>
          <Field label="Date" required error={errors.onDate}><Input type="date" value={f.onDate} onChange={(e) => set("onDate", e.target.value)} /></Field>
          <Field label="Score" error={errors.score}><NumberStepper decimals max={1000} value={f.score} onChange={(v) => set("score", v)} placeholder="e.g. 8" aria-label="Score" /></Field>
          <Field label="Out of"><NumberStepper decimals min={1} max={1000} value={f.maxScore} onChange={(v) => set("maxScore", v)} aria-label="Maximum score" /></Field>
          <Field label="Checked by" className="sm:col-span-2"><EmployeeSelect value={f.conductedById} onChange={(v) => set("conductedById", v)} placeholder="Who checked it (optional)" aria-label="Checked by" /></Field>
          <Field label="Remarks" className="sm:col-span-2"><Textarea rows={2} maxLength={2000} value={f.remarks} onChange={(e) => set("remarks", e.target.value)} placeholder="e.g. Fast at billing, needs to learn returns" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!d && unchanged)}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const PRESETS: ViewPreset[] = [{ key: "all", label: "All", params: {} }, ...Object.entries(STATUS).map(([k, v]) => ({ key: k, label: v.label, params: { status: k } }))]

export default function AssessmentsPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Row | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<Row | null>(null)
  if (!can("hr.recruitment.view")) return <NoAccessPage title="Candidate assessments" permission="hr.recruitment.view" />
  const reload = () => setVersion((v) => v + 1)
  const edit = can("hr.recruitment.edit")
  async function status(r: Row, s: string) { try { await api.post(`/hr/records/assessment/${r.id}/status`, { status: s }); toast.success(`Marked ${STATUS[s].label.toLowerCase()}`); reload() } catch (e) { toast.error(errorMessage(e)) } }
  const columns: Column<Row>[] = [
    { key: "candidate", header: "Candidate", hideable: false, sort: (r) => r.candidate?.name ?? "", csv: (r) => r.candidate?.name ?? "", cell: (r) => <span className="flex items-center gap-2.5"><Avatar name={r.candidate?.name ?? "?"} className="size-8" /><span><span className="block font-medium">{r.candidate?.name}</span><span className="text-xs text-muted-foreground">{r.candidate?.job}</span></span></span> },
    { key: "title", header: "Assessment", csv: (r) => r.data.title, cell: (r) => <span className="font-medium">{r.data.title}</span> },
    { key: "date", header: "Date", sort: (r) => r.data.onDate, csv: (r) => r.data.onDate, cell: (r) => formatDate(r.data.onDate) },
    { key: "score", header: "Score", align: "right", csv: (r) => (r.data.score != null ? `${r.data.score}/${r.data.maxScore ?? ""}` : ""), cell: (r) => (r.data.score != null ? <span className="tabular-nums"><strong>{r.data.score}</strong>{r.data.maxScore ? <span className="text-muted-foreground">/{r.data.maxScore}</span> : null}{r.data.maxScore ? <span className="block text-xs text-muted-foreground">{Math.round((r.data.score / r.data.maxScore) * 100)}%</span> : null}</span> : "—") },
    { key: "by", header: "Checked by", csv: (r) => r.names.conductedBy ?? "", cell: (r) => r.names.conductedBy ?? "—" },
    { key: "status", header: "Result", csv: (r) => STATUS[r.status]?.label, cell: (r) => <span className="grid gap-0.5"><Pill color={STATUS[r.status]?.color} dot>{STATUS[r.status]?.label}</Pill>{r.data.remarks && <span className="block max-w-56 truncate text-xs text-muted-foreground" title={r.data.remarks}>{r.data.remarks}</span>}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {edit && r.status === "pending" && <><Button size="sm" className="h-8" onClick={() => void status(r, "passed")}><Check /> Passed</Button><Button size="icon-sm" variant="ghost" title="Not cleared" aria-label="Not cleared" onClick={() => void status(r, "failed")}><X /></Button></>}
          <ActionMenu label="More actions" items={[edit && { label: "Edit", icon: Pencil, onClick: () => setEditing(r) }, edit && r.status !== "pending" && { label: "Back to pending", icon: ClipboardList, onClick: () => void status(r, "pending") }, "-", can("hr.recruitment.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) }]} />
        </span>
      ),
    },
  ]
  const add = can("hr.recruitment.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Add assessment</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.recruitment} active="assessments" />
      <DataList<Row>
        id="hr-assessments"
        load={localList(async (p) => (await api.get<{ data: Row[] }>("/hr/records/assessment")).data.filter((r) => !p.status || r.status === p.status), (r, q) => `${r.candidate?.name ?? ""} ${r.data.title} ${r.candidate?.job ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Candidate assessments", description: "Tests, practical tasks and discussions, with the score and result.", primary: add }}
        columns={columns}
        searchPlaceholder="Search candidate or assessment"
        presetLabel="Show"
        presets={PRESETS}
        rowClick={(r) => edit && setEditing(r)}
        exportName="assessments"
        emptyState={<EmptyState icon={ClipboardList} title="No assessments here" action={add} />}
      />
      {editing && <AssessmentDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title="Delete this assessment?" confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/records/assessment/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
