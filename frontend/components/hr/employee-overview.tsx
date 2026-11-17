"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { AlertTriangle, Briefcase, CheckCircle2, Clock, ExternalLink, FileText, Landmark, MapPin, Phone, Plus, Trash2, UserRound, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/common"
import { Field, FormError } from "@/components/form"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { SearchSelect } from "@/components/search-select"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { EMP_STATUS, EMPLOYMENT_LABEL, useHrLookups, type Employee, type HrRecord } from "@/lib/hr"
import { cn } from "@/lib/utils"

// Employee overview, laid out like a profile: who they are, their job, how to reach them,
// where their salary goes, their hours and rates, and the papers they have handed in.

function Card({ title, icon: Icon, children, action, className }: { title: string; icon: React.ElementType; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("ui-surface overflow-hidden", className)}>
      <header className="flex items-center justify-between gap-2 border-b px-5 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-muted-foreground" />{title}</h2>{action}</header>
      <div className="p-5">{children}</div>
    </section>
  )
}

function Facts({ items, cols = 2 }: { items: (readonly [string, React.ReactNode] | false | null | undefined)[]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4 text-sm", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4")}>
      {(items.filter(Boolean) as (readonly [string, React.ReactNode])[]).map(([k, v]) => (
        <div key={k} className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-0.5 font-medium break-words">{v === null || v === undefined || v === "" ? "—" : v}</dd></div>
      ))}
    </dl>
  )
}

interface Doc { employeeId: string; documentType: string; number?: string | null; url?: string | null; issuedOn?: string | null; expiresOn?: string | null; notes?: string | null }
const DOC_STATUS: Record<string, { label: string; color: string }> = { pending: { label: "To check", color: "amber" }, verified: { label: "Verified", color: "emerald" }, rejected: { label: "Rejected", color: "rose" } }

function DocDialog({ employeeId, missing, onClose, onSaved }: { employeeId: string; missing: string[]; onClose: () => void; onSaved: () => void }) {
  const look = useHrLookups()
  const types = look.data?.config.documentTypes ?? []
  const [f, setF] = React.useState({ documentType: missing[0] ?? "", number: "", url: "", issuedOn: "", expiresOn: "", notes: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.documentType) x.documentType = "Choose the document"
    if (f.url && !/^https?:\/\//.test(f.url)) x.url = "Enter a full link, starting with https://"
    if (!f.url && !f.number) x.url = "Add the link to the scan, or at least its number"
    if (f.issuedOn && f.expiresOn && f.expiresOn < f.issuedOn) x.expiresOn = "Must be after the issue date"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const n = (v: string) => v.trim() || null
    try {
      await api.post("/hr/records/emp_doc", { employeeId, documentType: f.documentType, number: n(f.number), url: n(f.url), issuedOn: n(f.issuedOn), expiresOn: n(f.expiresOn), notes: n(f.notes) })
      toast.success(`${f.documentType} added`)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add document</DialogTitle><DialogDescription>Keep the scan in Google Drive or similar and paste the link.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Document" required error={errors.documentType} className="sm:col-span-2"><SearchSelect value={f.documentType} onChange={(v) => set("documentType", v)} searchable options={types.map((t) => ({ value: t.name, label: `${t.name}${t.required ? " (required)" : ""}` }))} onCreate={(t) => t.trim() && set("documentType", t.trim())} createLabel="Use what I typed" placeholder="Choose the document" aria-label="Document" /></Field>
          <Field label="Number" hint="e.g. PAN or licence number"><Input value={f.number} maxLength={40} onChange={(e) => set("number", e.target.value.toUpperCase())} placeholder="Optional" /></Field>
          <Field label="Valid till" error={errors.expiresOn}><Input type="date" value={f.expiresOn} onChange={(e) => set("expiresOn", e.target.value)} /></Field>
          <Field label="Link to the scan" error={errors.url} className="sm:col-span-2"><Input value={f.url} maxLength={500} onChange={(e) => set("url", e.target.value)} placeholder="https://drive.google.com/…" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add document"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Documents({ e }: { e: Employee }) {
  const { can } = useAuth()
  const look = useHrLookups()
  const { data, reload } = useApi<{ data: HrRecord<Doc>[] }>(`/hr/records/emp_doc?refId=${e.id}`)
  const [adding, setAdding] = React.useState(false)
  const [deleting, setDeleting] = React.useState<HrRecord<Doc> | null>(null)
  const docs = data?.data ?? []
  const today = todayInIndia()
  const have = new Set(docs.filter((d) => d.status !== "rejected").map((d) => d.data.documentType.toLowerCase()))
  const missing = (look.data?.config.documentTypes ?? []).filter((t) => t.required && !have.has(t.name.toLowerCase())).map((t) => t.name)
  async function status(d: HrRecord<Doc>, s: string) { try { await api.post(`/hr/records/emp_doc/${d.id}/status`, { status: s }); toast.success(s === "verified" ? "Marked verified" : "Marked rejected"); void reload() } catch (err) { toast.error(errorMessage(err)) } }
  return (
    <Card title="Documents" icon={FileText} action={can("hr.employee.edit") ? <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus /> Add</Button> : undefined}>
      {missing.length > 0 && <p className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>Still to collect: <strong>{missing.join(", ")}</strong></span></p>}
      {docs.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No documents uploaded.</p> : (
        <ul className="divide-y rounded-xl border">
          {docs.map((d) => {
            const expired = d.data.expiresOn && d.data.expiresOn < today
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <FileText className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1"><span className="block font-medium">{d.data.documentType}</span><span className="text-xs text-muted-foreground">{[d.data.number, d.data.expiresOn && `valid till ${formatDate(d.data.expiresOn)}`].filter(Boolean).join(" · ") || "—"}</span></span>
                {expired ? <Pill color="rose">Expired</Pill> : <Pill color={DOC_STATUS[d.status]?.color} dot>{DOC_STATUS[d.status]?.label}</Pill>}
                {d.data.url && <a href={d.data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><ExternalLink className="size-3.5" />View</a>}
                {can("hr.employee.edit") && <ActionMenu label={`More actions for ${d.data.documentType}`} items={[d.status !== "verified" && { label: "Mark verified", icon: CheckCircle2, onClick: () => void status(d, "verified") }, d.status !== "rejected" && { label: "Reject (ask again)", icon: XCircle, onClick: () => void status(d, "rejected") }, "-", { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(d) }]} />}
              </li>
            )
          })}
        </ul>
      )}
      {adding && <DocDialog employeeId={e.id} missing={missing} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting?.data.documentType}?`} confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/records/emp_doc/${deleting!.id}`); toast.success("Deleted"); void reload() } catch (err) { toast.error(errorMessage(err)) } }} />
    </Card>
  )
}

export function EmployeeOverview({ e }: { e: Employee }) {
  const { can } = useAuth()
  const look = useHrLookups()
  const shift = look.data?.shifts.find((s) => s.id === e.shiftId) ?? look.data?.shifts.find((s) => s.isDefault)
  const days = look.data?.config.workingDays.length ?? 6
  const hours = shift ? shift.workingMinutes / 60 : 8
  const gross = e.basicPaise + (e.salaryItems ?? []).filter((i) => i.kind === "allowance").reduce((s, i) => s + (i.calc === "percent" ? Math.round((e.basicPaise * Number(i.amount)) / 10_000) : Number(i.amount)), 0)
  // Working days in an average month: days a week × 52 weeks ÷ 12
  const monthDays = (days * 52) / 12
  const perHour = e.payType === "daily" ? e.basicPaise / hours : gross / (monthDays * hours)
  const pay = can("hr.payroll.view")
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="grid gap-5">
        <section className="ui-surface grid justify-items-center gap-2 p-6 text-center">
          <Avatar name={e.name} className="size-20 text-xl" />
          <p className="text-lg font-semibold">{e.name}</p>
          <p className="text-sm text-muted-foreground">{e.email ?? e.phone ?? "—"}</p>
          <div className="flex flex-wrap justify-center gap-1.5"><Pill color={EMP_STATUS[e.status].color} dot>{EMP_STATUS[e.status].label}</Pill><Pill color="slate">{e.code}</Pill></div>
          {e.status === "on_notice" && e.exitOn && <p className="text-xs text-amber-700 dark:text-amber-300">Last working day {formatDate(e.exitOn)}</p>}
        </section>
        <Card title="Employment info" icon={Briefcase}>
          <Facts cols={2} items={[
            ["Employee ID", <span key="c" className="font-mono">{e.code}</span>],
            ["Branch", e.branch ? <Pill key="b" color="orange">{e.branch}</Pill> : "—"],
            ["Department", e.department ? <Pill key="d" color="violet">{e.department}</Pill> : "—"],
            ["Designation", e.designation ? <Pill key="g" color="blue">{e.designation}</Pill> : "—"],
            ["Employment type", <Pill key="t" color="emerald">{EMPLOYMENT_LABEL[e.employmentType]}</Pill>],
            ["Date of joining", formatDate(e.joinedOn)],
            ["Shift", shift ? `${shift.name} · ${shift.startsAt}–${shift.endsAt}` : "—"],
            ["Reports to", e.managerId ? <Link key="m" href={`/app/m/hr/employees/${e.managerId}`} className="text-primary hover:underline">{e.manager}</Link> : "—"],
            ["Probation ends", e.probationEndsOn ? formatDate(e.probationEndsOn) : "—"],
            ["Login", e.member ? `${e.member.name}` : "Not linked"],
            !!e.exitReason && ["Why leaving", e.exitReason],
          ]} />
        </Card>
      </div>
      <div className="grid gap-5">
        <Card title="Personal & contact" icon={MapPin}>
          <Facts items={[
            ["Date of birth", e.dob ? formatDate(e.dob) : null], ["Gender", e.gender ? e.gender[0].toUpperCase() + e.gender.slice(1) : null],
            ["Mobile", e.phone], ["Email", e.email],
            ["Address line 1", e.address?.line1], ["Address line 2", e.address?.line2],
            ["City", e.address?.city], ["State", e.address?.state],
            ["Country", e.address?.country || (e.address?.city ? "India" : null)], ["Postal code", e.address?.pincode],
          ]} />
        </Card>
        <Card title="Emergency contact" icon={Phone}>
          <Facts cols={3} items={[["Contact name", e.emergency?.name], ["Relationship", e.emergency?.relation], ["Contact number", e.emergency?.phone]]} />
        </Card>
        <Card title="Banking & tax" icon={Landmark}>
          <Facts items={[
            ["Bank name", e.bank?.bankName], ["Account holder", e.bank?.holder],
            ["Account number", e.bank?.accountNo ? <span key="a" className="font-mono">{pay ? e.bank.accountNo : `•••• ${e.bank.accountNo.slice(-4)}`}</span> : null], ["IFSC", e.bank?.ifsc ? <span key="i" className="font-mono">{e.bank.ifsc}</span> : null],
            ["Bank branch", e.bank?.branch], ["PAN (tax ID)", e.pan ? <span key="p" className="font-mono">{e.pan}</span> : null],
            ["UAN (PF)", e.uan], ["ESI number", e.esiNo],
          ]} />
        </Card>
        {pay && (
          <Card title="Hours & rates" icon={Clock}>
            <Facts cols={4} items={[
              [e.payType === "daily" ? "Wage a day" : "Basic salary", e.basicPaise ? formatPaise(e.basicPaise) : "Not set"],
              ["Hours a day", hours.toFixed(1)],
              ["Days a week", String(days)],
              ["Rate an hour", e.basicPaise ? formatPaise(Math.round(perHour)) : "—"],
            ]} />
            <p className="mt-3 text-xs text-muted-foreground">Hours come from the shift; the hourly rate is {e.payType === "daily" ? "the day's wage ÷ hours" : "monthly gross ÷ working days ÷ hours"}. Overtime suggests twice this rate.</p>
          </Card>
        )}
        <Documents e={e} />
        {e.notes && <Card title="Notes" icon={UserRound}><p className="text-sm whitespace-pre-wrap">{e.notes}</p></Card>}
      </div>
    </div>
  )
}
