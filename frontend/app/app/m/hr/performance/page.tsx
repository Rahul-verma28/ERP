"use client"

import * as React from "react"
import { toast } from "sonner"
import { ClipboardCheck, Pencil, Plus, Star, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { countBy, DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { Field, FormError } from "@/components/form"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { EmployeeSelect, HrTabs, TABS } from "@/components/hr/pickers"
import { SearchSelect } from "@/components/search-select"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import { useHrLookups } from "@/lib/hr"
import { cn } from "@/lib/utils"

// Performance reviews: set one up (who, reviewer, cycle), then rate each area out of 5.

interface Review { id: string; employeeId: string; employee: string; employeeCode: string; reviewerId: string | null; reviewer: string | null; cycle: string; reviewOn: string; ratings: Record<string, number>; rating: number | null; strengths: string | null; improve: string | null; status: "pending" | "completed"; version: number }

function Stars({ value, onChange, label }: { value: number; onChange?: (v: number) => void; label: string }) {
  return (
    <span className="inline-flex gap-0.5" role={onChange ? "radiogroup" : undefined} aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} role={onChange ? "radio" : undefined} aria-checked={onChange ? value === n : undefined} aria-label={`${n} of 5`} onClick={() => onChange?.(n)} className={cn("disabled:cursor-default", onChange && "hover:scale-110")}>
          <Star className={cn("size-5", n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
        </button>
      ))}
    </span>
  )
}

function ReviewDialog({ review, onClose, onSaved }: { review: Review | null; onClose: () => void; onSaved: () => void }) {
  const look = useHrLookups()
  const [f, setF] = React.useState({ employeeId: review?.employeeId ?? "", reviewerId: review?.reviewerId ?? "", cycle: review?.cycle ?? "", reviewOn: review?.reviewOn.slice(0, 10) ?? todayInIndia() })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.employeeId) x.employeeId = "Choose who is reviewed"
    if (!f.cycle) x.cycle = "Choose the review cycle"
    if (f.reviewerId && f.reviewerId === f.employeeId) x.reviewerId = "Someone else"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const body = { ...f, reviewerId: f.reviewerId || null }
      if (review) await api.put(`/hr/reviews/${review.id}`, body)
      else await api.post("/hr/reviews", body)
      toast.success(review ? "Saved" : "Review set up")
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
        <DialogHeader><DialogTitle>{review ? "Edit review" : "Set up a review"}</DialogTitle><DialogDescription>The reviewer rates it later with “Conduct review”.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Employee" required error={errors.employeeId}><EmployeeSelect value={f.employeeId} onChange={(v) => set("employeeId", v)} aria-label="Employee" /></Field>
          <Field label="Reviewer" error={errors.reviewerId}><EmployeeSelect value={f.reviewerId} exclude={f.employeeId} onChange={(v) => set("reviewerId", v)} placeholder="Usually their manager" aria-label="Reviewer" /></Field>
          <Field label="Cycle" required error={errors.cycle}><SearchSelect value={f.cycle} onChange={(v) => set("cycle", v)} options={(look.data?.config.cycles ?? []).filter((c) => c.active || c.name === f.cycle).map((c) => ({ value: c.name, label: c.name }))} placeholder="Choose the cycle" aria-label="Cycle" /></Field>
          <Field label="Review date" required><Input type="date" value={f.reviewOn} onChange={(e) => set("reviewOn", e.target.value)} /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : review ? "Save" : "Set up review"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ConductDialog({ review, onClose, onSaved }: { review: Review; onClose: () => void; onSaved: () => void }) {
  const look = useHrLookups()
  const areas = (look.data?.config.indicators ?? []).filter((i) => i.active).map((i) => i.name)
  const [ratings, setRatings] = React.useState<Record<string, number>>({})
  const [strengths, setStrengths] = React.useState("")
  const [improve, setImprove] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const values = Object.values(ratings)
  const avg = values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : 0
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (values.length < areas.length) return setError("Rate every area")
    setBusy(true)
    try {
      await api.post(`/hr/reviews/${review.id}/conduct`, { ratings, strengths: strengths.trim() || null, improve: improve.trim() || null })
      toast.success(`Review done: ${avg} out of 5`)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Review {review.employee}</DialogTitle><DialogDescription>{review.cycle} · {formatDate(review.reviewOn)}. Rate each area out of 5.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <ul className="divide-y rounded-2xl border">{areas.map((a) => <li key={a} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="font-medium">{a}</span><Stars value={ratings[a] ?? 0} onChange={(v) => { setRatings((r) => ({ ...r, [a]: v })); setError(null) }} label={a} /></li>)}</ul>
          <p className="text-sm">Overall: <strong>{avg || "—"}</strong> / 5</p>
          <Field label="Did well"><Textarea rows={2} maxLength={3000} value={strengths} onChange={(e) => setStrengths(e.target.value)} placeholder="e.g. Handles customers calmly, always on time" /></Field>
          <Field label="Can improve"><Textarea rows={2} maxLength={3000} value={improve} onChange={(e) => setImprove(e.target.value)} placeholder="e.g. Learn the billing software shortcuts" /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Submit review"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const PRESETS: ViewPreset[] = [{ key: "pending", label: "To do", params: { status: "pending" }, countKey: "pending" }, { key: "completed", label: "Done", params: { status: "completed" }, countKey: "completed" }, { key: "all", label: "All", params: {}, countKey: "all" }]

export default function ReviewsPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Review | "new" | null>(null)
  const [conducting, setConducting] = React.useState<Review | null>(null)
  const [deleting, setDeleting] = React.useState<Review | null>(null)
  if (!can("hr.performance.view")) return <PageHeader title="Reviews" description="You don't have access to this. Ask your admin." />
  const reload = () => setVersion((v) => v + 1)
  const columns: Column<Review>[] = [
    { key: "employee", header: "Employee", hideable: false, sort: (r) => r.employee, csv: (r) => r.employee, cell: (r) => <span className="flex items-center gap-2.5"><Avatar name={r.employee} className="size-8" /><span><span className="block font-medium">{r.employee}</span><span className="font-mono text-xs text-muted-foreground">{r.employeeCode}</span></span></span> },
    { key: "cycle", header: "Cycle", csv: (r) => r.cycle, cell: (r) => <Pill color="blue">{r.cycle}</Pill> },
    { key: "reviewer", header: "Reviewer", csv: (r) => r.reviewer ?? "", cell: (r) => r.reviewer ?? "—" },
    { key: "date", header: "Date", sort: (r) => r.reviewOn, csv: (r) => r.reviewOn.slice(0, 10), cell: (r) => formatDate(r.reviewOn) },
    { key: "rating", header: "Rating", sort: (r) => r.rating ?? 0, csv: (r) => r.rating ?? "", cell: (r) => (r.rating ? <span className="flex items-center gap-2"><Stars value={Math.round(r.rating)} label="Rating" /><span className="tabular-nums">{r.rating}</span></span> : <span className="text-muted-foreground">—</span>) },
    { key: "status", header: "Status", csv: (r) => r.status, cell: (r) => <Pill color={r.status === "completed" ? "emerald" : "amber"} dot>{r.status === "completed" ? "Done" : "To do"}</Pill> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {r.status === "pending" && can("hr.performance.edit") && <Button size="sm" className="h-8" onClick={() => setConducting(r)}><ClipboardCheck /> Conduct review</Button>}
          <ActionMenu label={`More actions for ${r.employee}`} items={[
            r.status === "pending" && can("hr.performance.edit") && { label: "Edit", icon: Pencil, onClick: () => setEditing(r) },
            "-",
            can("hr.performance.delete") && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("hr.performance.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Set up review</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.performance} active="reviews" />
      <DataList<Review>
        id="hr-reviews"
        load={localList(async () => (await api.get<{ data: Review[] }>("/hr/reviews")).data, (r, q) => `${r.employee} ${r.employeeCode} ${r.cycle} ${r.reviewer ?? ""}`.toLowerCase().includes(q), { filter: (r, p) => !p.status || r.status === p.status, counts: (rows) => countBy(rows, (r) => r.status) })}
        tabs
        params={{ v: String(version) }}
        header={{ title: "Performance reviews", description: "Quarterly, yearly or probation reviews: rate each area out of 5 and note strengths and what to improve.", primary: add, more: [{ label: "Performance indicators", href: "/app/m/hr/performance/indicators" }, { label: "Review cycles", href: "/app/m/hr/performance/cycles" }] }}
        columns={columns}
        searchPlaceholder="Search employee, cycle or reviewer"
        presetLabel="Show"
        presets={PRESETS}
        rowClick={(r) => r.status === "pending" && can("hr.performance.edit") ? setConducting(r) : undefined}
        exportName="reviews"
        emptyState={<EmptyState icon={ClipboardCheck} title="No reviews here" action={add} />}
      />
      {editing && <ReviewDialog review={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {conducting && <ConductDialog review={conducting} onClose={() => setConducting(null)} onSaved={() => { setConducting(null); reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title="Delete this review?" confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/reviews/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
