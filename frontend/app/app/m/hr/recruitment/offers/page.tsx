"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Ban, Check, FileSignature, FileText, Pencil, Plus, Printer, Send, Trash2, UserCheck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog, EmptyState, MoneyInput } from "@/components/common"
import { DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { DepartmentSelect, DesignationSelect, HrTabs, TABS } from "@/components/hr/pickers"
import { SearchSelect } from "@/components/search-select"
import type { Candidate } from "@/components/hr/recruit"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSharedApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { useHrLookups, type HrRecord } from "@/lib/hr"
import { useChanged } from "@/lib/use-dirty"
import { NoAccessPage } from "@/components/page-states"

// Offers: position, salary and joining date for a candidate; the letter comes from the template in
// Recruitment → System Setup. An accepted offer becomes an employee in one click.

interface O { candidateId: string; position: string; designationId?: string | null; departmentId?: string | null; salaryPaise: number; joiningOn: string; expiresOn?: string | null; benefits?: string | null; notes?: string | null; employeeId?: string }
type Row = HrRecord<O>
const STATUS: Record<string, { label: string; color: string }> = { draft: { label: "Draft", color: "slate" }, sent: { label: "Sent", color: "blue" }, accepted: { label: "Accepted", color: "emerald" }, declined: { label: "Declined", color: "rose" }, withdrawn: { label: "Withdrawn", color: "slate" } }

function OfferDialog({ row, onClose, onSaved }: { row: Row | null; onClose: () => void; onSaved: () => void }) {
  const cands = useSharedApi<{ data: Candidate[] }>("/hr/candidates")
  const look = useHrLookups()
  const d = row?.data
  // Two weeks from today, a usual notice period
  const joining = new Date(new Date(`${todayInIndia()}T00:00:00Z`).getTime() + 15 * 86_400_000).toISOString().slice(0, 10)
  const [f, setF] = React.useState({ candidateId: d?.candidateId ?? "", position: d?.position ?? "", designationId: d?.designationId ?? "", departmentId: d?.departmentId ?? "", salaryPaise: d?.salaryPaise ?? (null as number | null), joiningOn: d?.joiningOn ?? joining, expiresOn: d?.expiresOn ?? "", benefits: d?.benefits ?? "", notes: d?.notes ?? "" })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  const pick = (id: string) => {
    const c = cands.data?.data.find((x) => x.id === id)
    setF((x) => ({ ...x, candidateId: id, position: x.position || c?.job || "", salaryPaise: x.salaryPaise ?? c?.expectedCtcPaise ?? null }))
    setErrors({})
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.candidateId) x.candidateId = "Choose the candidate"
    if (f.position.trim().length < 2) x.position = "Enter the position"
    if (!f.salaryPaise) x.salaryPaise = "Enter the monthly salary"
    if (!f.joiningOn) x.joiningOn = "Choose the joining date"
    else if (!row && f.joiningOn < todayInIndia()) x.joiningOn = "Can't be in the past"
    if (f.expiresOn && f.expiresOn > f.joiningOn) x.expiresOn = "Must be on or before joining"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const n = (v: string) => v.trim() || null
    const body = { candidateId: f.candidateId, position: f.position.trim(), designationId: n(f.designationId), departmentId: n(f.departmentId), salaryPaise: f.salaryPaise, joiningOn: f.joiningOn, expiresOn: n(f.expiresOn), benefits: n(f.benefits), notes: n(f.notes) }
    try {
      if (row) await api.put(`/hr/records/offer/${row.id}`, { ...body, version: row.version })
      else await api.post("/hr/records/offer", body)
      toast.success(row ? "Offer saved" : "Offer made: the candidate is now at the Offer stage")
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
        <DialogHeader><DialogTitle>{row ? "Edit offer" : "Make an offer"}</DialogTitle><DialogDescription>The offer letter uses the template in Recruitment → System Setup.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Candidate" required error={errors.candidateId} className="sm:col-span-2"><SearchSelect value={f.candidateId} onChange={pick} searchable disabled={!!row} options={(cands.data?.data ?? []).filter((c) => !["hired", "rejected"].includes(c.stage) || c.id === f.candidateId).map((c) => ({ value: c.id, label: `${c.name} · ${c.job}`, keywords: c.phone ?? "" }))} placeholder="Choose the candidate" aria-label="Candidate" /></Field>
          <Field label="Position" required error={errors.position} className="sm:col-span-2"><Input value={f.position} maxLength={120} onChange={(e) => set("position", e.target.value)} placeholder="e.g. Sales executive" /></Field>
          <Field label="Department"><DepartmentSelect value={f.departmentId} onChange={(v) => set("departmentId", v)} aria-label="Department" /></Field>
          <Field label="Designation"><DesignationSelect value={f.designationId} departmentId={f.departmentId} onChange={(v) => { set("designationId", v); const name = look.data?.designations.find((x) => x.id === v)?.name; if (name && !f.position) set("position", name) }} aria-label="Designation" /></Field>
          <Field label="Monthly salary" required error={errors.salaryPaise} hint="Becomes their basic pay when they join"><MoneyInput value={f.salaryPaise} onChange={(v) => set("salaryPaise", v)} aria-label="Monthly salary" /></Field>
          <Field label="Joining date" required error={errors.joiningOn}><Input type="date" value={f.joiningOn} onChange={(e) => set("joiningOn", e.target.value)} /></Field>
          <Field label="Reply by" error={errors.expiresOn}><Input type="date" value={f.expiresOn} max={f.joiningOn} onChange={(e) => set("expiresOn", e.target.value)} /></Field>
          <Field label="Benefits" className="sm:col-span-2"><Textarea rows={2} maxLength={2000} value={f.benefits} onChange={(e) => set("benefits", e.target.value)} placeholder="e.g. PF, ESI, Diwali bonus, two-wheeler allowance" /></Field>
          <Field label="Note to self" className="sm:col-span-2"><Input value={f.notes} maxLength={2000} onChange={(e) => set("notes", e.target.value)} placeholder="Not on the letter" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!d && unchanged)}>{busy ? "Saving…" : row ? "Save offer" : "Make offer"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The offer letter: the template from setup with this offer's details filled in */
function LetterDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const { me } = useAuth()
  const look = useHrLookups()
  const template = look.data?.config.offerTemplate ?? ""
  const values: Record<string, string> = {
    name: row.candidate?.name ?? "", position: row.data.position, department: row.names.department ?? "our", salary: formatPaise(row.data.salaryPaise), joining: formatDate(row.data.joiningOn),
    company: me?.tenant?.name ?? "", expires: row.data.expiresOn ? formatDate(row.data.expiresOn) : "the joining date",
  }
  const text = template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? "")
  function print() {
    const w = window.open("", "_blank", "width=800,height=900")
    if (!w) return toast.error("Allow pop-ups to print the letter")
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)
    w.document.write(`<html><head><title>Offer letter · ${esc(values.name)}</title><style>body{font-family:system-ui,sans-serif;max-width:680px;margin:48px auto;line-height:1.6;color:#111}h1{font-size:20px}p{white-space:pre-wrap}</style></head><body><h1>${esc(values.company)}</h1><p style="color:#555">${esc(formatDate(todayInIndia()))}</p><h2 style="font-size:16px">Offer of employment</h2><p>${esc(text)}</p>${row.data.benefits ? `<h3 style="font-size:14px">Benefits</h3><p>${esc(row.data.benefits)}</p>` : ""}</body></html>`)
    w.document.close()
    w.print()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Offer letter · {values.name}</DialogTitle><DialogDescription>Change the wording once in Recruitment → System Setup.</DialogDescription></DialogHeader>
        <article className="max-h-[60vh] overflow-y-auto rounded-2xl border bg-muted/30 p-5 text-sm leading-relaxed whitespace-pre-wrap">{text}{row.data.benefits && `\n\nBenefits: ${row.data.benefits}`}</article>
        <DialogFooter><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(text); toast.success("Letter copied") }}><FileText /> Copy text</Button><Button onClick={print}><Printer /> Print</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const PRESETS: ViewPreset[] = [{ key: "all", label: "All", params: {} }, ...Object.entries(STATUS).map(([k, v]) => ({ key: k, label: v.label, params: { status: k } }))]

export default function OffersPage() {
  const router = useRouter()
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Row | "new" | null>(null)
  const [letter, setLetter] = React.useState<Row | null>(null)
  const [deleting, setDeleting] = React.useState<Row | null>(null)
  const [converting, setConverting] = React.useState<Row | null>(null)
  if (!can("hr.recruitment.view")) return <NoAccessPage title="Offers" permission="hr.recruitment.view" />
  const reload = () => setVersion((v) => v + 1)
  const edit = can("hr.recruitment.edit")
  async function status(r: Row, s: string) { try { await api.post(`/hr/records/offer/${r.id}/status`, { status: s }); toast.success(`Offer ${STATUS[s].label.toLowerCase()}`); reload() } catch (e) { toast.error(errorMessage(e)) } }
  const columns: Column<Row>[] = [
    { key: "candidate", header: "Candidate", hideable: false, sort: (r) => r.candidate?.name ?? "", csv: (r) => r.candidate?.name ?? "", cell: (r) => <span className="flex items-center gap-2.5"><Avatar name={r.candidate?.name ?? "?"} className="size-8" /><span><span className="block font-medium">{r.candidate?.name}</span><span className="text-xs text-muted-foreground">{r.candidate?.phone ?? r.candidate?.email}</span></span></span> },
    { key: "position", header: "Position", csv: (r) => r.data.position, cell: (r) => <span><span className="block font-medium">{r.data.position}</span><span className="text-xs text-muted-foreground">{r.names.department ?? ""}</span></span> },
    { key: "salary", header: "Salary a month", align: "right", sort: (r) => r.data.salaryPaise, csv: (r) => r.data.salaryPaise / 100, cell: (r) => <span className="font-semibold tabular-nums">{formatPaise(r.data.salaryPaise)}</span> },
    { key: "joining", header: "Joining", sort: (r) => r.data.joiningOn, csv: (r) => r.data.joiningOn, cell: (r) => <span>{formatDate(r.data.joiningOn)}{r.data.expiresOn && <span className="block text-xs text-muted-foreground">Reply by {formatDate(r.data.expiresOn)}</span>}</span> },
    { key: "status", header: "Status", csv: (r) => STATUS[r.status]?.label, cell: (r) => <span className="grid gap-0.5"><Pill color={STATUS[r.status]?.color} dot>{STATUS[r.status]?.label}</Pill>{r.data.employeeId && <span className="text-xs text-emerald-700 dark:text-emerald-300">Now an employee</span>}</span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {edit && r.status === "draft" && <Button size="sm" variant="outline" className="h-8" onClick={() => void status(r, "sent")}><Send /> Mark sent</Button>}
          {edit && r.status === "sent" && <><Button size="sm" className="h-8" onClick={() => void status(r, "accepted")}><Check /> Accepted</Button><Button size="icon-sm" variant="ghost" title="Declined" aria-label="Declined" onClick={() => void status(r, "declined")}><X /></Button></>}
          {r.status === "accepted" && !r.data.employeeId && can("hr.employee.create") && <Button size="sm" className="h-8" onClick={() => setConverting(r)}><UserCheck /> Make employee</Button>}
          <ActionMenu label="More actions" items={[
            { label: "Offer letter", icon: FileSignature, onClick: () => setLetter(r) },
            edit && r.status !== "accepted" && { label: "Edit", icon: Pencil, onClick: () => setEditing(r) },
            r.data.employeeId && { label: "Open employee", icon: UserCheck, href: `/app/m/hr/employees/${r.data.employeeId}` },
            edit && ["draft", "sent"].includes(r.status) && { label: "Withdraw offer", icon: Ban, onClick: () => void status(r, "withdrawn") },
            "-",
            can("hr.recruitment.delete") && !r.data.employeeId && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("hr.recruitment.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Make an offer</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.recruitment} active="offers" />
      <DataList<Row>
        id="hr-offers"
        load={localList(async (p) => (await api.get<{ data: Row[] }>("/hr/records/offer")).data.filter((r) => !p.status || r.status === p.status), (r, q) => `${r.candidate?.name ?? ""} ${r.data.position}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Offers", description: "Draft → Sent → Accepted. An accepted offer becomes an employee with the offered salary and joining date.", primary: add }}
        columns={columns}
        searchPlaceholder="Search candidate or position"
        presetLabel="Show"
        presets={PRESETS}
        rowClick={(r) => setLetter(r)}
        exportName="offers"
        emptyState={<EmptyState icon={FileSignature} title="No offers here" description="Make an offer to a candidate who cleared the interviews." action={add} />}
      />
      {editing && <OfferDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {letter && <LetterDialog row={letter} onClose={() => setLetter(null)} />}
      <ConfirmDialog open={!!converting} onOpenChange={(o) => !o && setConverting(null)} title={`Make ${converting?.candidate?.name} an employee?`} description={converting ? `Joining ${formatDate(converting.data.joiningOn)} as ${converting.data.position}, basic ${formatPaise(converting.data.salaryPaise)} a month. The candidate is marked hired.` : ""} confirmLabel="Make employee"
        onConfirm={async () => { try { const e = await api.post<{ id: string; code: string }>(`/hr/records/offer/${converting!.id}/convert`, {}); toast.success(`Added as ${e.code}`); router.push(`/app/m/hr/employees/${e.id}`) } catch (err) { toast.error(errorMessage(err)) } }} />
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title="Delete this offer?" confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/records/offer/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
