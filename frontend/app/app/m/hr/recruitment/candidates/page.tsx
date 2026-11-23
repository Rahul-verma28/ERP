"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowRight, CalendarClock, ExternalLink, LayoutGrid, List, Pencil, Phone, Plus, Trash2, UserCheck, UserPlus, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, localList, type Column } from "@/components/data-list"
import { PageError, PageLoading, NoAccessPage } from "@/components/page-states"
import { ActionMenu, Avatar, Pill } from "@/components/page-parts"
import { HrTabs, TABS } from "@/components/hr/pickers"
import { CandidateDialog, HireDialog, InterviewDialog, STAGE, useJobs, type Candidate, type Stage } from "@/components/hr/recruit"
import { SearchSelect } from "@/components/search-select"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatPaise } from "@/lib/format"
import { openFile } from "@/lib/files"

// Candidates as a board (Applied → Screening → Interview → Offer) or a list. Hire makes them an employee.

const FLOW: Stage[] = ["applied", "screening", "interview", "offer"]

export default function CandidatesPage() {
  return <React.Suspense fallback={<PageLoading />}><Candidates /></React.Suspense>
}

function Candidates() {
  const router = useRouter()
  const search = useSearchParams()
  const { can } = useAuth()
  const jobs = useJobs()
  const [jobId, setJobId] = React.useState(search.get("jobId") ?? "")
  const [view, setView] = React.useState<"board" | "list">("board")
  const { data, error, reload } = useApi<{ data: Candidate[] }>(can("hr.recruitment.view") ? `/hr/candidates${jobId ? `?jobId=${jobId}` : ""}` : null)
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Candidate | "new" | null>(null)
  const [hiring, setHiring] = React.useState<Candidate | null>(null)
  const [interviewing, setInterviewing] = React.useState<Candidate | null>(null)
  const [deleting, setDeleting] = React.useState<Candidate | null>(null)
  if (!can("hr.recruitment.view")) return <NoAccessPage title="Candidates" permission="hr.recruitment.view" />
  const refresh = () => { void reload(); setVersion((v) => v + 1); void jobs.reload() }
  const edit = can("hr.recruitment.edit")

  async function move(c: Candidate, stage: Stage) {
    try { await api.post(`/hr/candidates/${c.id}/stage`, { stage }); toast.success(`${c.name} → ${STAGE[stage].label}`); refresh() } catch (e) { toast.error(errorMessage(e)) }
  }
  const menu = (c: Candidate) => [
    edit && c.stage !== "hired" && { label: "Edit", icon: Pencil, onClick: () => setEditing(c) },
    can("hr.recruitment.create") && !["hired", "rejected"].includes(c.stage) && { label: "Schedule interview", icon: CalendarClock, onClick: () => setInterviewing(c) },
    c.resumeUrl && { label: "Open resume", icon: ExternalLink, onClick: () => void openFile(c.resumeUrl) },
    c.phone && { label: `Call ${c.phone}`, icon: Phone, onClick: () => window.open(`tel:${c.phone}`) },
    ...(edit && c.stage !== "hired" ? FLOW.filter((s) => s !== c.stage).map((s) => ({ label: `Move to ${STAGE[s].label}`, icon: ArrowRight, onClick: () => void move(c, s) })) : []),
    can("hr.employee.create") && !["hired", "rejected"].includes(c.stage) && { label: "Hire", icon: UserCheck, onClick: () => setHiring(c) },
    c.employeeId && { label: "Open employee", icon: UserCheck, href: `/app/m/hr/employees/${c.employeeId}` },
    "-" as const,
    edit && !["hired", "rejected"].includes(c.stage) && { label: "Reject", icon: XCircle, onClick: () => void move(c, "rejected") },
    can("hr.recruitment.delete") && !c.employeeId && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(c) },
  ]

  const columns: Column<Candidate>[] = [
    { key: "name", header: "Candidate", hideable: false, sort: (c) => c.name, csv: (c) => c.name, cell: (c) => <span className="flex items-center gap-2.5"><Avatar name={c.name} className="size-8" /><span><span className="block font-medium">{c.name}</span><span className="text-xs text-muted-foreground">{c.phone ?? c.email}</span></span></span> },
    { key: "job", header: "Job", csv: (c) => c.job, cell: (c) => c.job },
    { key: "exp", header: "Experience", csv: (c) => c.experience ?? "", cell: (c) => (c.experience != null ? `${c.experience} yrs` : "—") },
    { key: "expects", header: "Expects", align: "right", csv: (c) => (c.expectedCtcPaise ?? 0) / 100, cell: (c) => (c.expectedCtcPaise ? <span className="tabular-nums">{formatPaise(c.expectedCtcPaise)}</span> : "—") },
    { key: "source", header: "Came through", defaultHidden: true, csv: (c) => c.source ?? "", cell: (c) => c.source ?? "—" },
    { key: "rating", header: "Rating", csv: (c) => c.rating ?? "", cell: (c) => (c.rating ? `${c.rating}/5` : "—") },
    { key: "stage", header: "Stage", csv: (c) => STAGE[c.stage].label, cell: (c) => <Pill color={STAGE[c.stage].color} dot>{STAGE[c.stage].label}</Pill> },
    { key: "added", header: "Added", sort: (c) => c.createdAt, csv: (c) => c.createdAt.slice(0, 10), cell: (c) => formatDate(c.createdAt) },
    { key: "actions", header: "Actions", hideable: false, cell: (c) => <span onClick={(e) => e.stopPropagation()}><ActionMenu label={`More actions for ${c.name}`} items={menu(c)} /></span> },
  ]
  const add = can("hr.recruitment.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Add candidate</Button> : undefined
  const jobPicker = <div className="w-64"><SearchSelect value={jobId} onChange={(v) => { setJobId(v); router.replace(`/app/m/hr/recruitment/candidates${v ? `?jobId=${v}` : ""}`, { scroll: false }) }} searchable options={[{ value: "", label: "All jobs" }, ...(jobs.data?.data ?? []).map((j) => ({ value: j.id, label: `${j.title} (${j.candidates})` }))]} aria-label="Job" /></div>
  const toggle = <div className="flex rounded-xl border p-0.5"><Button size="icon-sm" variant={view === "board" ? "default" : "ghost"} aria-label="Board" onClick={() => setView("board")}><LayoutGrid /></Button><Button size="icon-sm" variant={view === "list" ? "default" : "ghost"} aria-label="List" onClick={() => setView("list")}><List /></Button></div>

  return (
    <>
      <HrTabs tabs={TABS.recruitment} active="candidates" />
      {view === "board" ? (
        <div className="grid gap-4">
          <PageHeader title="Candidates" description="Move people along as they clear each step. Hire makes them an employee." actions={<div className="flex flex-wrap items-center gap-2">{jobPicker}{toggle}{add}</div>} />
          {error ? <PageError error={error} onRetry={() => void reload()} /> : !data ? <PageLoading /> : data.data.length === 0 ? <section className="ui-surface"><EmptyState icon={UserPlus} title="No candidates yet" description="Add people who applied or were referred." action={add} /></section> : (
            <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-2 xl:grid-cols-4">
              {FLOW.map((s) => {
                const list = data.data.filter((c) => c.stage === s)
                return (
                  <section key={s} className="grid min-w-64 content-start gap-2 rounded-2xl bg-muted/50 p-3">
                    <header className="flex items-center justify-between px-1"><Pill color={STAGE[s].color} dot>{STAGE[s].label}</Pill><span className="text-xs text-muted-foreground tabular-nums">{list.length}</span></header>
                    {list.map((c) => (
                      <article key={c.id} className="grid gap-2 rounded-xl border bg-card p-3 text-sm shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <button type="button" onClick={() => edit && setEditing(c)} className="min-w-0 text-left"><span className="block truncate font-semibold hover:underline">{c.name}</span><span className="block truncate text-xs text-muted-foreground">{c.job}</span></button>
                          <ActionMenu label={`More actions for ${c.name}`} items={menu(c)} />
                        </div>
                        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">{c.experience != null && <span>{c.experience} yrs</span>}{c.expectedCtcPaise && <span>{formatPaise(c.expectedCtcPaise)}/mo</span>}{c.rating && <span>★ {c.rating}</span>}{c.interviews > 0 && <span>{c.interviews} interview{c.interviews === 1 ? "" : "s"}</span>}</p>
                        {edit && (
                          <div className="flex gap-1.5">
                            {s !== "offer" ? <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={() => void move(c, FLOW[FLOW.indexOf(s) + 1])}>{STAGE[FLOW[FLOW.indexOf(s) + 1]].label} <ArrowRight /></Button>
                              : can("hr.employee.create") && <Button size="sm" className="h-7 flex-1 text-xs" onClick={() => setHiring(c)}><UserCheck /> Hire</Button>}
                            <Button size="icon-sm" variant="ghost" className="size-7" title="Reject" aria-label={`Reject ${c.name}`} onClick={() => void move(c, "rejected")}><XCircle /></Button>
                          </div>
                        )}
                      </article>
                    ))}
                    {list.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nobody here</p>}
                  </section>
                )
              })}
            </div>
          )}
          {data && data.data.some((c) => c.stage === "hired" || c.stage === "rejected") && (
            <p className="text-sm text-muted-foreground">{data.data.filter((c) => c.stage === "hired").length} hired · {data.data.filter((c) => c.stage === "rejected").length} rejected · <button type="button" className="text-primary hover:underline" onClick={() => setView("list")}>see them in the list</button></p>
          )}
        </div>
      ) : (
        <DataList<Candidate>
          id="hr-candidates"
          load={localList(async (p) => (await api.get<{ data: Candidate[] }>(`/hr/candidates${jobId ? `?jobId=${jobId}` : ""}`)).data.filter((c) => !p.stage || c.stage === p.stage), (c, q) => `${c.name} ${c.phone ?? ""} ${c.email ?? ""} ${c.job}`.toLowerCase().includes(q))}
          params={{ v: String(version), jobId }}
          header={{ title: "Candidates", description: "Everyone who applied, with their stage.", primary: add, actions: <div className="flex items-center gap-2">{jobPicker}{toggle}</div> }}
          columns={columns}
          searchPlaceholder="Search name, mobile or job"
          presetLabel="Stage"
          presets={[{ key: "all", label: "All", params: {} }, ...(Object.keys(STAGE) as Stage[]).map((s) => ({ key: s, label: STAGE[s].label, params: { stage: s } }))]}
          rowClick={(c) => edit && c.stage !== "hired" && setEditing(c)}
          exportName="candidates"
          emptyState={<EmptyState icon={UserPlus} title="No candidates here" action={add} />}
        />
      )}
      {editing && <CandidateDialog candidate={editing === "new" ? null : editing} jobId={jobId || undefined} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
      {interviewing && <InterviewDialog interview={null} candidateId={interviewing.id} onClose={() => setInterviewing(null)} onSaved={() => { setInterviewing(null); refresh() }} />}
      {hiring && <HireDialog candidate={hiring} onClose={() => setHiring(null)} onSaved={(id) => { setHiring(null); router.push(`/app/m/hr/employees/${id}`) }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting?.name}?`} description="Their interviews go too." confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/hr/candidates/${deleting!.id}`); toast.success("Deleted"); refresh() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}
