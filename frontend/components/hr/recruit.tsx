"use client"

import * as React from "react"
import { toast } from "sonner"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { MoneyInput } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { SearchSelect } from "@/components/search-select"
import { DepartmentSelect, DesignationSelect, EmployeeSelect, ListSelect } from "@/components/hr/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useSharedApi } from "@/lib/use-api"
import { EMPLOYMENT_LABEL, useCurrentEmployees, type EmploymentType } from "@/lib/hr"
import { cn } from "@/lib/utils"
import { useChanged } from "@/lib/use-dirty"
import { activeOr } from "@/lib/active"
import { FileField } from "@/components/file-field"

// Recruitment forms: job opening, candidate, interview, and hiring a candidate as an employee.

export interface Job { id: string; title: string; departmentId: string | null; department: string | null; branchId: string | null; branch: string | null; location: string | null; employmentType: EmploymentType; positions: number; minExp: number | null; maxExp: number | null; minSalaryPaise: number | null; maxSalaryPaise: number | null; skills: string[]; description: string | null; closesOn: string | null; status: "open" | "on_hold" | "closed"; candidates: number; hired: number; createdAt: string }
export interface Candidate { id: string; jobId: string; job: string; name: string; email: string | null; phone: string | null; source: string | null; experience: number | null; currentCtcPaise: number | null; expectedCtcPaise: number | null; resumeUrl: string | null; stage: Stage; rating: number | null; notes: string | null; employeeId: string | null; interviews: number; createdAt: string }
export interface Interview { id: string; candidateId: string; candidate: string; candidateStage: Stage | null; job: string; round: string; onDate: string; atTime: string | null; mode: "in_person" | "phone" | "video"; interviewerIds: string[]; interviewers: string[]; result: "scheduled" | "passed" | "failed" | "no_show" | "cancelled"; rating: number | null; feedback: string | null }
export type Stage = "applied" | "screening" | "interview" | "offer" | "hired" | "rejected"
export const STAGE: Record<Stage, { label: string; color: string }> = { applied: { label: "Applied", color: "slate" }, screening: { label: "Screening", color: "blue" }, interview: { label: "Interview", color: "violet" }, offer: { label: "Offer", color: "amber" }, hired: { label: "Hired", color: "emerald" }, rejected: { label: "Rejected", color: "rose" } }
export const JOB_STATUS: Record<string, { label: string; color: string }> = { open: { label: "Open", color: "emerald" }, on_hold: { label: "On hold", color: "amber" }, closed: { label: "Closed", color: "slate" } }
export const RESULT: Record<string, { label: string; color: string }> = { scheduled: { label: "Scheduled", color: "blue" }, passed: { label: "Passed", color: "emerald" }, failed: { label: "Not selected", color: "rose" }, no_show: { label: "Didn't come", color: "orange" }, cancelled: { label: "Cancelled", color: "slate" } }
export const MODE: Record<string, string> = { in_person: "In person", phone: "Phone", video: "Video call" }

export function useJobs() {
  return useSharedApi<{ data: Job[] }>("/hr/jobs")
}

export function JobDialog({ job, onClose, onSaved }: { job: Job | null; onClose: () => void; onSaved: () => void }) {
  const branches = useSharedApi<{ data: { id: string; name: string }[] }>("/branches")
  const [f, setF] = React.useState({ title: job?.title ?? "", departmentId: job?.departmentId ?? "", branchId: job?.branchId ?? "", location: job?.location ?? "", employmentType: job?.employmentType ?? "full_time", positions: String(job?.positions ?? 1), minExp: job?.minExp == null ? "" : String(job.minExp), maxExp: job?.maxExp == null ? "" : String(job.maxExp), minSalaryPaise: job?.minSalaryPaise ?? null, maxSalaryPaise: job?.maxSalaryPaise ?? null, skills: job?.skills ?? [], skill: "", description: job?.description ?? "", closesOn: job?.closesOn?.slice(0, 10) ?? "", status: job?.status ?? "open" })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  const addSkill = () => { const s = f.skill.trim(); if (s && !f.skills.includes(s)) setF((x) => ({ ...x, skills: [...x.skills, s], skill: "" })); else set("skill", "") }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.title.trim().length < 2) x.title = "Enter the job title"
    if (!(Number(f.positions) >= 1)) x.positions = "At least 1"
    if (f.minExp && f.maxExp && Number(f.maxExp) < Number(f.minExp)) x.maxExp = "At least the minimum"
    if (f.minSalaryPaise && f.maxSalaryPaise && f.maxSalaryPaise < f.minSalaryPaise) x.maxSalaryPaise = "At least the minimum"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const n = (v: string) => v.trim() || null
    const body = { title: f.title.trim(), departmentId: n(f.departmentId), branchId: n(f.branchId), location: n(f.location), employmentType: f.employmentType, positions: Number(f.positions), minExp: f.minExp === "" ? null : Number(f.minExp), maxExp: f.maxExp === "" ? null : Number(f.maxExp), minSalaryPaise: f.minSalaryPaise, maxSalaryPaise: f.maxSalaryPaise, skills: f.skills, description: n(f.description), closesOn: n(f.closesOn), status: f.status }
    try {
      if (job) await api.put(`/hr/jobs/${job.id}`, body)
      else await api.post("/hr/jobs", body)
      toast.success(job ? "Job saved" : `${body.title} opened`)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{job ? `Edit ${job.title}` : "Open a job"}</DialogTitle><DialogDescription>A role you are hiring for. Candidates are added against it.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Job title" required error={errors.title}><Input value={f.title} autoFocus maxLength={120} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Sales executive" /></Field>
          <Field label="Type"><NativeSelect value={f.employmentType} aria-label="Type" onChange={(e) => set("employmentType", e.target.value as EmploymentType)}>{(Object.keys(EMPLOYMENT_LABEL) as EmploymentType[]).map((k) => <option key={k} value={k}>{EMPLOYMENT_LABEL[k]}</option>)}</NativeSelect></Field>
          <Field label="Department"><DepartmentSelect value={f.departmentId} onChange={(v) => set("departmentId", v)} aria-label="Department" /></Field>
          <Field label="Openings" error={errors.positions}><NumberStepper min={1} max={500} value={f.positions} onChange={(v) => set("positions", v)} aria-label="Openings" /></Field>
          {(branches.data?.data.length ?? 0) > 1 && <Field label="Branch"><SearchSelect value={f.branchId} onChange={(v) => set("branchId", v)} options={[{ value: "", label: "Any branch" }, ...activeOr(branches.data?.data ?? [], f.branchId).map((b) => ({ value: b.id, label: b.name }))]} aria-label="Branch" /></Field>}
          <Field label="Location"><ListSelect list="jobLocations" value={f.location} onChange={(v) => set("location", v)} aria-label="Location" /></Field>
          <Field label="Experience from (years)"><NumberStepper max={50} value={f.minExp} onChange={(v) => set("minExp", v)} placeholder="Any" aria-label="Minimum experience" /></Field>
          <Field label="Experience up to (years)" error={errors.maxExp}><NumberStepper max={50} value={f.maxExp} onChange={(v) => set("maxExp", v)} placeholder="Any" aria-label="Maximum experience" /></Field>
          <Field label="Salary from (a month)"><MoneyInput value={f.minSalaryPaise} onChange={(v) => set("minSalaryPaise", v)} aria-label="Salary from" /></Field>
          <Field label="Salary up to (a month)" error={errors.maxSalaryPaise}><MoneyInput value={f.maxSalaryPaise} onChange={(v) => set("maxSalaryPaise", v)} aria-label="Salary up to" /></Field>
          <Field label="Skills" className="sm:col-span-2" hint="Type one and press Enter">
            <div className="grid gap-2">
              <Input value={f.skill} maxLength={40} onChange={(e) => set("skill", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill() } }} placeholder="e.g. Tally, Hindi, Two-wheeler" />
              {f.skills.length > 0 && <div className="flex flex-wrap gap-1.5">{f.skills.map((s) => <span key={s} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">{s}<button type="button" aria-label={`Remove ${s}`} onClick={() => set("skills", f.skills.filter((x) => x !== s))}><X className="size-3" /></button></span>)}</div>}
            </div>
          </Field>
          <Field label="Last date to apply"><Input type="date" value={f.closesOn} min={todayInIndia()} onChange={(e) => set("closesOn", e.target.value)} /></Field>
          <Field label="Status"><NativeSelect value={f.status} aria-label="Status" onChange={(e) => set("status", e.target.value as Job["status"])}>{Object.entries(JOB_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</NativeSelect></Field>
          <Field label="About the job" className="sm:col-span-2"><Textarea rows={3} maxLength={5000} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What they will do, timings, what you offer" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!job && unchanged)}>{busy ? "Saving…" : job ? "Save job" : "Open job"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CandidateDialog({ candidate, jobId, onClose, onSaved }: { candidate: Candidate | null; jobId?: string; onClose: () => void; onSaved: () => void }) {
  const jobs = useJobs()
  const [f, setF] = React.useState({ jobId: candidate?.jobId ?? jobId ?? "", name: candidate?.name ?? "", phone: candidate?.phone ?? "", email: candidate?.email ?? "", source: candidate?.source ?? "", experience: candidate?.experience == null ? "" : String(candidate.experience), currentCtcPaise: candidate?.currentCtcPaise ?? null, expectedCtcPaise: candidate?.expectedCtcPaise ?? null, resumeUrl: candidate?.resumeUrl ?? "", rating: candidate?.rating ?? 0, notes: candidate?.notes ?? "" })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.jobId) x.jobId = "Choose the job"
    if (f.name.trim().length < 2) x.name = "Enter the name"
    if (!f.phone && !f.email) x.phone = "Enter a mobile number or email"
    if (f.phone && !/^[6-9]\d{9}$/.test(f.phone)) x.phone = "Enter a 10-digit mobile number"
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) x.email = "Enter a valid email"
    // A new candidate comes with a resume; one added before uploads existed can still be saved
    if (!candidate && !f.resumeUrl) x.resumeUrl = "Upload the resume"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const n = (v: string) => v.trim() || null
    const body = { jobId: f.jobId, name: f.name.trim(), phone: n(f.phone), email: n(f.email), source: n(f.source), experience: f.experience === "" ? null : Number(f.experience), currentCtcPaise: f.currentCtcPaise, expectedCtcPaise: f.expectedCtcPaise, resumeUrl: n(f.resumeUrl), rating: f.rating || null, notes: n(f.notes) }
    try {
      if (candidate) await api.put(`/hr/candidates/${candidate.id}`, body)
      else await api.post("/hr/candidates", body)
      toast.success(candidate ? "Candidate saved" : `${body.name} added`)
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
        <DialogHeader><DialogTitle>{candidate ? `Edit ${candidate.name}` : "Add candidate"}</DialogTitle><DialogDescription>Someone who applied or was referred.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="For the job" required error={errors.jobId} className="sm:col-span-2"><SearchSelect value={f.jobId} onChange={(v) => set("jobId", v)} searchable options={(jobs.data?.data ?? []).filter((j) => j.status !== "closed" || j.id === f.jobId).map((j) => ({ value: j.id, label: j.title, keywords: j.department ?? "" }))} placeholder="Choose the job" aria-label="Job" /></Field>
          <Field label="Name" required error={errors.name} className="sm:col-span-2"><Input value={f.name} autoFocus maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder="Full name" /></Field>
          <Field label="Mobile" required error={errors.phone}><Input value={f.phone} inputMode="numeric" maxLength={10} onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))} placeholder="10-digit mobile" /></Field>
          <Field label="Email" error={errors.email}><Input type="email" value={f.email} maxLength={160} onChange={(e) => set("email", e.target.value)} placeholder="name@example.com" /></Field>
          <Field label="Came through"><ListSelect list="candidateSources" value={f.source} onChange={(v) => set("source", v)} aria-label="Source" /></Field>
          <Field label="Experience (years)"><NumberStepper decimals max={60} step={0.5} value={f.experience} onChange={(v) => set("experience", v)} placeholder="e.g. 2" aria-label="Experience" /></Field>
          <Field label="Current salary (a month)"><MoneyInput value={f.currentCtcPaise} onChange={(v) => set("currentCtcPaise", v)} aria-label="Current salary" /></Field>
          <Field label="Expects (a month)"><MoneyInput value={f.expectedCtcPaise} onChange={(v) => set("expectedCtcPaise", v)} aria-label="Expected salary" /></Field>
          <Field label="Resume" required={!candidate} error={errors.resumeUrl} className="sm:col-span-2" hint="PDF or Word"><FileField value={f.resumeUrl} onChange={(v) => set("resumeUrl", v ?? "")} prompt="Upload the resume" /></Field>
          <Field label="Your rating" className="sm:col-span-2"><span className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`${n} of 5`} aria-pressed={f.rating === n} onClick={() => set("rating", f.rating === n ? 0 : n)} className={cn("size-8 rounded-lg border text-sm font-semibold", n <= f.rating && "border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200")}>{n}</button>)}</span></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} maxLength={3000} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything from the call or CV" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!candidate && unchanged)}>{busy ? "Saving…" : candidate ? "Save" : "Add candidate"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function InterviewDialog({ interview, candidateId, onClose, onSaved }: { interview: Interview | null; candidateId?: string; onClose: () => void; onSaved: () => void }) {
  const cands = useSharedApi<{ data: Candidate[] }>("/hr/candidates")
  const emps = useCurrentEmployees()
  const [f, setF] = React.useState({ candidateId: interview?.candidateId ?? candidateId ?? "", round: interview?.round ?? "HR round", onDate: interview?.onDate.slice(0, 10) ?? todayInIndia(), atTime: interview?.atTime ?? "11:00", mode: interview?.mode ?? "in_person", interviewerIds: interview?.interviewerIds ?? [] })
  // Editing: Save works only once something changed
  const unchanged = !useChanged(f)
  const [pick, setPick] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setError(null) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!f.candidateId) x.candidateId = "Choose the candidate"
    if (!f.round.trim()) x.round = "Name the round"
    if (!f.onDate) x.onDate = "Choose the date"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const body = { ...f, round: f.round.trim(), atTime: f.atTime || null }
    try {
      if (interview) await api.put(`/hr/interviews/${interview.id}`, body)
      else await api.post("/hr/interviews", body)
      toast.success(interview ? "Interview saved" : "Interview scheduled")
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
        <DialogHeader><DialogTitle>{interview ? "Edit interview" : "Schedule interview"}</DialogTitle><DialogDescription>The candidate moves to the Interview stage.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Candidate" required error={errors.candidateId} className="sm:col-span-2"><SearchSelect value={f.candidateId} onChange={(v) => set("candidateId", v)} searchable options={(cands.data?.data ?? []).filter((c) => !["hired", "rejected"].includes(c.stage) || c.id === f.candidateId).map((c) => ({ value: c.id, label: `${c.name} · ${c.job}`, keywords: c.phone ?? "" }))} placeholder="Choose the candidate" aria-label="Candidate" /></Field>
          <Field label="Round" required error={errors.round}><Input value={f.round} maxLength={60} onChange={(e) => set("round", e.target.value)} placeholder="e.g. HR round, Practical test" /></Field>
          <Field label="How"><NativeSelect value={f.mode} aria-label="How" onChange={(e) => set("mode", e.target.value as Interview["mode"])}>{Object.entries(MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
          <Field label="Date" required error={errors.onDate}><Input type="date" value={f.onDate} onChange={(e) => set("onDate", e.target.value)} /></Field>
          <Field label="Time"><Input type="time" value={f.atTime} onChange={(e) => set("atTime", e.target.value)} /></Field>
          <Field label="Interviewers" className="sm:col-span-2">
            <div className="grid gap-2">
              <EmployeeSelect value={pick} onChange={(v) => { if (v && !f.interviewerIds.includes(v)) set("interviewerIds", [...f.interviewerIds, v]); setPick("") }} placeholder="Add an interviewer" aria-label="Add interviewer" />
              {f.interviewerIds.length > 0 && <div className="flex flex-wrap gap-1.5">{f.interviewerIds.map((id) => { const n = emps.data?.data.find((e) => e.id === id)?.name ?? "—"; return <span key={id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">{n}<button type="button" aria-label={`Remove ${n}`} onClick={() => set("interviewerIds", f.interviewerIds.filter((x) => x !== id))}><X className="size-3" /></button></span> })}</div>}
            </div>
          </Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || (!!interview && unchanged)}>{busy ? "Saving…" : interview ? "Save" : "Schedule"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ResultDialog({ interview, onClose, onSaved }: { interview: Interview; onClose: () => void; onSaved: () => void }) {
  const [result, setResult] = React.useState<Interview["result"]>(interview.result === "scheduled" ? "passed" : interview.result)
  const [rating, setRating] = React.useState(interview.rating ?? 0)
  const [feedback, setFeedback] = React.useState(interview.feedback ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if ((result === "passed" || result === "failed") && feedback.trim().length < 3) return setError("Add a line of feedback")
    setBusy(true)
    try {
      await api.post(`/hr/interviews/${interview.id}/result`, { result, rating: rating || null, feedback: feedback.trim() || null })
      toast.success("Result saved")
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>How did it go?</DialogTitle><DialogDescription>{interview.candidate} · {interview.round}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Result"><NativeSelect value={result} aria-label="Result" onChange={(e) => setResult(e.target.value as Interview["result"])}>{Object.entries(RESULT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</NativeSelect></Field>
          <Field label="Rating"><span className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`${n} of 5`} aria-pressed={rating === n} onClick={() => setRating(rating === n ? 0 : n)} className={cn("size-8 rounded-lg border text-sm font-semibold", n <= rating && "border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200")}>{n}</button>)}</span></Field>
          <Field label="Feedback" required={result === "passed" || result === "failed"}><Textarea rows={3} maxLength={3000} value={feedback} autoFocus onChange={(e) => { setFeedback(e.target.value); setError(null) }} placeholder="e.g. Good with customers, slow on billing" /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save result"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function HireDialog({ candidate, onClose, onSaved }: { candidate: Candidate; onClose: () => void; onSaved: (employeeId: string) => void }) {
  const jobs = useJobs()
  const job = jobs.data?.data.find((j) => j.id === candidate.jobId)
  const [f, setF] = React.useState({ joinedOn: todayInIndia(), basicPaise: candidate.expectedCtcPaise ?? (null as number | null), departmentId: job?.departmentId ?? "", designationId: "" })
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!f.joinedOn) return setError("Choose the joining date")
    setBusy(true)
    try {
      const emp = await api.post<{ id: string; code: string }>(`/hr/candidates/${candidate.id}/hire`, { joinedOn: f.joinedOn, basicPaise: f.basicPaise ?? 0, departmentId: f.departmentId || job?.departmentId || null, designationId: f.designationId || null })
      toast.success(`${candidate.name} hired as ${emp.code}`)
      onSaved(emp.id)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Hire {candidate.name}</DialogTitle><DialogDescription>They become an employee with their name, mobile and email. Fill the rest on their profile.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Joining date" required><Input type="date" value={f.joinedOn} onChange={(e) => setF((x) => ({ ...x, joinedOn: e.target.value }))} /></Field>
          <Field label="Department"><DepartmentSelect value={f.departmentId} onChange={(v) => setF((x) => ({ ...x, departmentId: v }))} aria-label="Department" /></Field>
          <Field label="Designation"><DesignationSelect value={f.designationId} departmentId={f.departmentId} onChange={(v) => setF((x) => ({ ...x, designationId: v }))} aria-label="Designation" /></Field>
          <Field label="Basic pay a month" hint="Can be set later in Salary"><MoneyInput value={f.basicPaise} onChange={(v) => setF((x) => ({ ...x, basicPaise: v }))} aria-label="Basic pay" /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}><Plus /> {busy ? "Hiring…" : "Hire and add employee"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
