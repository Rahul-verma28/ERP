"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Briefcase, Pause, Pencil, Play, Plus, Trash2, UserPlus, Users, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { ActionMenu, Pill } from "@/components/page-parts"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { CandidateDialog, JOB_STATUS, JobDialog, useJobs, type Job } from "@/components/hr/recruit"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatPaise } from "@/lib/format"
import { EMPLOYMENT_LABEL } from "@/lib/hr"
import { NoAccessPage } from "@/components/page-states"

// Recruitment: job openings, each with its candidates.

const PRESETS: ViewPreset[] = [{ key: "open", label: "Open", params: { status: "open" } }, { key: "on_hold", label: "On hold", params: { status: "on_hold" } }, { key: "closed", label: "Closed", params: { status: "closed" } }, { key: "all", label: "All", params: {} }]

export default function JobsPage() {
  const { can } = useAuth()
  const shared = useJobs()
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Job | "new" | null>(null)
  const [adding, setAdding] = React.useState<Job | null>(null)
  const [deleting, setDeleting] = React.useState<Job | null>(null)
  if (!can("hr.recruitment.view")) return <NoAccessPage title="Recruitment" permission="hr.recruitment.view" />
  const reload = () => { setVersion((v) => v + 1); void shared.reload() }
  async function status(j: Job, s: Job["status"]) {
    try { await api.put(`/hr/jobs/${j.id}`, { ...j, status: s }); toast.success(`${j.title}: ${JOB_STATUS[s].label.toLowerCase()}`); reload() } catch (e) { toast.error(errorMessage(e)) }
  }
  const salary = (j: Job) => j.minSalaryPaise || j.maxSalaryPaise ? `${j.minSalaryPaise ? formatPaise(j.minSalaryPaise) : ""}${j.minSalaryPaise && j.maxSalaryPaise ? " – " : ""}${j.maxSalaryPaise ? formatPaise(j.maxSalaryPaise) : ""}` : null
  const columns: Column<Job>[] = [
    { key: "title", header: "Job", hideable: false, sort: (j) => j.title, csv: (j) => j.title, cell: (j) => <span className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Briefcase className="size-4" /></span><span><span className="block font-medium">{j.title}</span><span className="text-xs text-muted-foreground">{[j.department, j.location ?? j.branch, EMPLOYMENT_LABEL[j.employmentType]].filter(Boolean).join(" · ")}</span></span></span> },
    { key: "openings", header: "Openings", align: "right", csv: (j) => j.positions, cell: (j) => <span className="tabular-nums">{j.hired}/{j.positions} filled</span> },
    { key: "candidates", header: "Candidates", align: "right", sort: (j) => j.candidates, csv: (j) => j.candidates, cell: (j) => <Link href={`/app/m/hr/recruitment/candidates?jobId=${j.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-primary tabular-nums hover:underline">{j.candidates}</Link> },
    { key: "exp", header: "Experience", csv: (j) => `${j.minExp ?? ""}-${j.maxExp ?? ""}`, cell: (j) => (j.minExp != null || j.maxExp != null ? `${j.minExp ?? 0}–${j.maxExp ?? "any"} yrs` : "Any") },
    { key: "salary", header: "Salary a month", csv: (j) => salary(j) ?? "", cell: (j) => salary(j) ?? <span className="text-muted-foreground">—</span> },
    { key: "closes", header: "Apply by", sort: (j) => j.closesOn ?? "", csv: (j) => j.closesOn?.slice(0, 10) ?? "", cell: (j) => (j.closesOn ? formatDate(j.closesOn) : "—") },
    { key: "status", header: "Status", csv: (j) => JOB_STATUS[j.status].label, cell: (j) => <Pill color={JOB_STATUS[j.status].color} dot>{JOB_STATUS[j.status].label}</Pill> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (j) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {can("hr.recruitment.create") && j.status === "open" && <Button size="sm" variant="outline" className="h-8" onClick={() => setAdding(j)}><UserPlus /> Candidate</Button>}
          <ActionMenu label={`More actions for ${j.title}`} items={[
            can("hr.recruitment.edit") && { label: "Edit", icon: Pencil, onClick: () => setEditing(j) },
            { label: "See candidates", icon: Users, href: `/app/m/hr/recruitment/candidates?jobId=${j.id}` },
            can("hr.recruitment.edit") && j.status !== "on_hold" && j.status !== "closed" && { label: "Put on hold", icon: Pause, onClick: () => void status(j, "on_hold") },
            can("hr.recruitment.edit") && j.status !== "open" && { label: "Reopen", icon: Play, onClick: () => void status(j, "open") },
            can("hr.recruitment.edit") && j.status !== "closed" && { label: "Close job", icon: XCircle, onClick: () => void status(j, "closed") },
            "-",
            can("hr.recruitment.delete") && !j.candidates && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(j) },
          ]} />
        </span>
      ),
    },
  ]
  const add = can("hr.recruitment.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Open a job</Button> : undefined
  return (
    <>
      <HrTabs tabs={TABS.recruitment} active="jobs" />
      <DataList<Job>
        id="hr-jobs"
        load={localList(async (p) => (await api.get<{ data: Job[] }>("/hr/jobs")).data.filter((j) => !p.status || j.status === p.status), (j, q) => `${j.title} ${j.department ?? ""} ${j.location ?? ""} ${j.skills.join(" ")}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Recruitment", description: "Open jobs and who applied. Move candidates through screening and interviews, then hire them as employees.", primary: add }}
        columns={columns}
        searchPlaceholder="Search job, department or skill"
        presetLabel="Show"
        presets={PRESETS}
        rowHref={(j) => `/app/m/hr/recruitment/candidates?jobId=${j.id}`}
        exportName="jobs"
        emptyState={<EmptyState icon={Briefcase} title="No jobs here" description="Open a job to start adding candidates." action={add} />}
      />
      {editing && <JobDialog job={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {adding && <CandidateDialog candidate={null} jobId={adding.id} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting?.title}?`} confirmLabel="Delete job"
        onConfirm={async () => { try { await api.delete(`/hr/jobs/${deleting!.id}`); toast.success("Job deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
