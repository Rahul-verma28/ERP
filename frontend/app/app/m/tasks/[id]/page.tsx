"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { CheckCheck, Copy, ListChecks, MessageSquare, Pencil, Play, Plus, Send, ShieldCheck, Timer, Trash2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog } from "@/components/common"
import { ActionMenu, Avatar, BackLink, DetailHeader, DetailList, Pill, Section } from "@/components/page-parts"
import { ApprovalDialog, TaskDialog, TimeDialog } from "@/components/tasks/forms"
import { ProjectDot } from "@/components/tasks/bits"
import { PageLoading } from "@/components/page-states"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatDateTime, formatPaise } from "@/lib/format"
import { APPROVAL_STATUS, PRIORITY, REPEAT_LABEL, STATUS, fmtMin, type TaskDetail, type TaskEvent, type TaskStatus } from "@/lib/tasks"
import { cn } from "@/lib/utils"

// One task: what it is, its steps and subtasks, the conversation and history, the time spent and
// any approval asked. Everything is done from here or from the list row.

function eventText(e: TaskEvent) {
  const d = (e.data ?? {}) as Record<string, unknown>
  switch (e.type) {
    case "created": return e.body ?? "created the task"
    case "status": return `moved it from ${STATUS[d.from as TaskStatus]?.label ?? d.from} to ${STATUS[d.to as TaskStatus]?.label ?? d.to}`
    case "assigned": return d.to ? "changed who it is assigned to" : "unassigned it"
    case "edited": return `changed ${(d.fields as string[] | undefined)?.join(", ").replace("dueAt", "due date").replace("startOn", "start date").replace("projectId", "project").replace("estimateMin", "estimate") ?? "details"}`
    case "checklist": return `${d.done ? "ticked" : "unticked"} “${e.body}”`
    case "time": return `logged ${fmtMin(Number(d.minutes))}${e.body ? `: ${e.body}` : ""}`
    case "approval": return `${d.decision === "approved" ? "approved" : "rejected"} ${d.number}${e.body ? `: ${e.body}` : ""}`
    default: return e.type
  }
}

export default function TaskPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can, me } = useAuth()
  const res = useApi<TaskDetail>(`/tasks/${id}`)
  const [editing, setEditing] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [timing, setTiming] = React.useState(false)
  const [asking, setAsking] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [comment, setComment] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  if (res.error && !res.data) return <PageHeader title="Task not found" description={errorMessage(res.error)} />
  const t = res.data
  if (!t) return <PageLoading />
  const reload = () => void res.reload()
  const canEdit = can("tasks.task.edit")
  const open = t.status === "todo" || t.status === "in_progress"
  const steps = t.checklist ?? []

  async function act(fn: () => Promise<unknown>, done: string) {
    try { await fn(); toast.success(done); reload() } catch (e) { toast.error(errorMessage(e)) }
  }
  const setStatus = (status: TaskStatus) => act(() => api.patch(`/tasks/${t.id}`, { status, version: t.version }), status === "done" ? (t.repeat !== "none" ? "Done. The next one is made." : "Done") : status === "in_progress" ? "Started" : "Opened again")
  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!comment.trim()) return
    setBusy(true)
    try { await api.post(`/tasks/${id}/comments`, { body: comment.trim() }); setComment(""); reload() } catch (err) { toast.error(errorMessage(err)) } finally { setBusy(false) }
  }
  const estimate = t.estimateMin ? Math.round(((t.loggedMin ?? 0) / t.estimateMin) * 100) : null

  return (
    <div className="grid gap-5">
      <BackLink href={t.parent ? `/app/m/tasks/${t.parent.id}` : t.project ? `/app/m/tasks/projects/${t.project.id}` : "/app/m/tasks"}>{t.parent ? t.parent.title : t.project ? t.project.name : "Tasks"}</BackLink>
      <DetailHeader
        title={t.title}
        icon={ListChecks}
        pills={<><Pill color={STATUS[t.status].color}>{STATUS[t.status].label}</Pill><Pill color={PRIORITY[t.priority].color} dot>{PRIORITY[t.priority].label}</Pill>{t.repeat !== "none" && <Pill color="violet">{REPEAT_LABEL[t.repeat]}</Pill>}{t.overdue && <Pill color="rose">Late</Pill>}</>}
        subtitle={[t.assigneeName ? `For ${t.assigneeName}` : "Unassigned", t.dueAt ? `Due ${formatDateTime(t.dueAt)}` : null, t.project?.name, t.contact?.name].filter(Boolean).join(" · ")}
        actions={<>
          {canEdit && t.status === "todo" && <Button variant="outline" onClick={() => void setStatus("in_progress")}><Play /> Start</Button>}
          {canEdit && open && <Button onClick={() => void setStatus("done")}><CheckCheck /> Mark done</Button>}
          {canEdit && !open && t.status !== "cancelled" && <Button variant="outline" onClick={() => void setStatus("todo")}><Play /> Open again</Button>}
          {canEdit && <Button variant="outline" size="icon" title="Edit" aria-label="Edit task" onClick={() => setEditing(true)}><Pencil /></Button>}
          <ActionMenu items={[
            open && { label: "Log time", icon: Timer, onClick: () => setTiming(true) },
            can("tasks.approval.create") && { label: "Ask for approval", icon: ShieldCheck, onClick: () => setAsking(true) },
            can("tasks.task.create") && !t.parentId && { label: "Add subtask", icon: Plus, onClick: () => setAdding(true) },
            can("tasks.task.create") && { label: "Make a copy", icon: Copy, onClick: () => void api.post<{ id: string }>(`/tasks/${t.id}/duplicate`).then((c) => { toast.success("Copy made"); router.push(`/app/m/tasks/${c.id}`) }).catch((e) => toast.error(errorMessage(e))) },
            "-",
            can("tasks.task.delete") && open && { label: "Cancel task", icon: XCircle, destructive: true, onClick: () => setCancelling(true) },
          ]} />
        </>}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid content-start gap-5">
          <Section title="Details">
            {t.description ? <p className="text-sm whitespace-pre-wrap">{t.description}</p> : <p className="text-sm text-muted-foreground">No details. {canEdit && <button type="button" className="font-medium text-primary hover:underline" onClick={() => setEditing(true)}>Add some</button>}</p>}
            {!!t.labels.length && <div className="mt-3 flex flex-wrap gap-1">{t.labels.map((l) => <span key={l} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{l}</span>)}</div>}
          </Section>

          <Section title={`Checklist${steps.length ? ` · ${steps.filter((s) => s.done).length}/${steps.length}` : ""}`} action={canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil /> Edit steps</Button>}>
            {steps.length ? (
              <ul className="grid gap-1.5">
                {steps.map((s) => (
                  <li key={s.id}>
                    <label className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm hover:bg-muted/50">
                      <input type="checkbox" className="size-4 accent-primary" checked={s.done} disabled={!canEdit} onChange={(e) => void act(() => api.post(`/tasks/${t.id}/checklist/${s.id}`, { done: e.target.checked }), e.target.checked ? "Ticked" : "Unticked")} />
                      <span className={cn(s.done && "text-muted-foreground line-through")}>{s.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No steps. Break the task into steps to tick off.</p>}
          </Section>

          {!t.parentId && (
            <Section title={`Subtasks${t.subtasks.length ? ` · ${t.subtasks.filter((s) => s.status === "done").length}/${t.subtasks.length}` : ""}`} action={can("tasks.task.create") && <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus /> Add subtask</Button>} flush>
              {t.subtasks.length ? (
                <ul className="divide-y">
                  {t.subtasks.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <input type="checkbox" className="size-4 accent-primary" checked={s.status === "done"} disabled={!canEdit || s.status === "cancelled"} aria-label={`Done: ${s.title}`} onChange={(e) => void act(() => api.patch(`/tasks/${s.id}`, { status: e.target.checked ? "done" : "todo", version: s.version }), e.target.checked ? "Subtask done" : "Opened again")} />
                      <Link href={`/app/m/tasks/${s.id}`} className={cn("min-w-0 flex-1 truncate hover:underline", s.status === "done" && "text-muted-foreground line-through")}>{s.title}</Link>
                      {s.assigneeName && <Avatar name={s.assigneeName} className="size-6 text-[9px]" />}
                      <span className="text-xs text-muted-foreground">{s.dueAt ? formatDate(s.dueAt) : ""}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="p-5 text-sm text-muted-foreground">No subtasks.</p>}
            </Section>
          )}

          <Section title="Comments and history">
            <form onSubmit={send} className="mb-4 flex items-end gap-2">
              <Textarea rows={2} maxLength={4000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment. The person it is assigned to and its creator are told." aria-label="Comment" />
              <Button type="submit" size="icon" disabled={busy || !comment.trim()} aria-label="Send comment"><Send /></Button>
            </form>
            <ol className="grid gap-3">
              {[...t.events].reverse().map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <Avatar name={e.actorName ?? "?"} className="size-8 text-[10px]" />
                  <div className="min-w-0 flex-1">
                    {e.type === "comment"
                      ? <div className="rounded-2xl rounded-tl-sm bg-muted/60 px-3 py-2"><p className="text-xs font-medium">{e.actorName ?? "Someone"} <span className="font-normal text-muted-foreground">· {formatDateTime(e.at)}</span></p><p className="mt-0.5 whitespace-pre-wrap">{e.body}</p></div>
                      : <p className="pt-1.5 text-muted-foreground"><span className="font-medium text-foreground">{e.actorName ?? "Someone"}</span> {eventText(e)} · <span className="text-xs">{formatDateTime(e.at)}</span></p>}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="grid content-start gap-5">
          <Section title="About">
            <DetailList cols={1} items={[
              ["Status", <Pill key="s" color={STATUS[t.status].color}>{STATUS[t.status].label}</Pill>],
              ["Priority", PRIORITY[t.priority].label],
              ["Assigned to", t.assigneeName ?? "Unassigned"],
              ["Project", t.project ? <Link key="p" href={`/app/m/tasks/projects/${t.project.id}`} className="inline-flex items-center gap-1.5 hover:underline"><ProjectDot color={t.project.color} />{t.project.name}</Link> : "—"],
              ["Customer", t.contact ? <Link key="c" href={t.contact.type === "lead" ? `/app/m/crm/${t.contact.id}` : `/app/m/sales/customers/${t.contact.id}`} className="hover:underline">{t.contact.name}</Link> : "—"],
              ["Start", t.startOn ? formatDate(t.startOn) : "—"],
              ["Due", t.dueAt ? formatDateTime(t.dueAt) : "No date"],
              ["Repeats", REPEAT_LABEL[t.repeat]],
              ["Created", `${t.createdByName ?? "—"} · ${formatDate(t.createdAt)}`],
              !!t.completedAt && ["Done on", formatDateTime(t.completedAt)],
            ]} />
          </Section>

          <Section title="Time" action={open && <Button size="sm" variant="ghost" onClick={() => setTiming(true)}><Timer /> Log time</Button>} flush>
            <div className="grid gap-2 px-5 pt-4 pb-3">
              <p className="flex items-baseline justify-between text-sm"><span className="text-muted-foreground">Logged</span><span className="text-xl font-bold tabular-nums">{fmtMin(t.loggedMin)}</span></p>
              {t.estimateMin != null && <>
                <span className="h-2 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", (estimate ?? 0) > 100 ? "bg-rose-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, estimate ?? 0)}%` }} /></span>
                <p className="text-xs text-muted-foreground">{estimate}% of the {fmtMin(t.estimateMin)} estimate</p>
              </>}
            </div>
            {t.times.length ? (
              <ul className="divide-y border-t">
                {t.times.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0 flex-1"><span className="font-medium">{m.userName}</span> · {formatDate(m.workDate)}{m.billable && <Pill color="emerald" className="ml-1.5">Billable</Pill>}{m.note && <span className="block truncate text-xs text-muted-foreground">{m.note}</span>}</span>
                    <span className="tabular-nums">{fmtMin(m.minutes)}</span>
                    {(m.userId === me?.user.id || canEdit) && <button type="button" className="text-muted-foreground hover:text-destructive" aria-label="Remove time" onClick={() => void act(() => api.delete(`/task-times/${m.id}`), "Time removed")}><Trash2 className="size-4" /></button>}
                  </li>
                ))}
              </ul>
            ) : <p className="border-t px-5 py-4 text-sm text-muted-foreground">No time logged yet.</p>}
          </Section>

          {!!t.approvals.length && (
            <Section title="Approvals" flush>
              <ul className="divide-y">
                {t.approvals.map((a) => (
                  <li key={a.id}><Link href="/app/m/tasks/approvals" className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/40"><span className="font-mono text-xs text-primary">{a.number}</span><span className="min-w-0 flex-1 truncate">{a.title}</span>{a.amountPaise ? <span className="tabular-nums">{formatPaise(a.amountPaise)}</span> : null}<Pill color={APPROVAL_STATUS[a.status as keyof typeof APPROVAL_STATUS]?.color ?? "slate"}>{APPROVAL_STATUS[a.status as keyof typeof APPROVAL_STATUS]?.label ?? a.status}</Pill></Link></li>
                ))}
              </ul>
            </Section>
          )}
          <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground"><MessageSquare className="size-3.5" /> {t.events.filter((e) => e.type === "comment").length} comments · {t.events.length} updates</p>
        </div>
      </div>

      {editing && <TaskDialog task={t} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload() }} />}
      {adding && <TaskDialog parentId={t.id} defaults={{ projectId: t.projectId }} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} />}
      {timing && <TimeDialog task={t} onClose={() => setTiming(false)} onSaved={() => { setTiming(false); reload() }} />}
      {asking && <ApprovalDialog task={t} onClose={() => setAsking(false)} onSaved={() => { setAsking(false); reload() }} />}
      <ConfirmDialog open={cancelling} onOpenChange={setCancelling} destructive title={`Cancel “${t.title}”?`} description="It and its open subtasks are marked cancelled. History stays." confirmLabel="Cancel task"
        onConfirm={async () => { try { await api.delete(`/tasks/${t.id}`); toast.success("Task cancelled"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </div>
  )
}
