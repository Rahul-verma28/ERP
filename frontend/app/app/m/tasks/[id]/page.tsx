"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Circle, CircleCheck, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/common"
import { Field, NativeSelect } from "@/components/form"
import { UserSelect } from "@/components/pickers"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { TaskDialog, type Task } from "../task-dialog"
import { PageError, PageLoading } from "@/components/page-states"

interface Detail extends Task {
  contact: { id: string; name: string } | null
  subtasks: Task[]
  events: { id: string; type: string; body: string | null; data: Record<string, unknown> | null; at: string; actorName: string | null }[]
}

const STATUS_LABEL: Record<string, string> = { todo: "To do", in_progress: "In progress", done: "Done", cancelled: "Cancelled" }

function describe(e: Detail["events"][number]) {
  if (e.type === "created") return "created the task"
  if (e.type === "status") return `moved it to ${STATUS_LABEL[String(e.data?.to)] ?? e.data?.to}`
  if (e.type === "assigned") return e.data?.to ? "reassigned it" : "unassigned it"
  if (e.type === "edited") return `edited ${(e.data?.fields as string[] | undefined)?.join(", ") ?? "details"}`
  return "commented"
}

const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "")

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const router = useRouter()
  const { can } = useAuth()
  const { data: t, reload, error } = useApi<Detail>(`/tasks/${id}`)
  const [comment, setComment] = React.useState("")
  const [addingSub, setAddingSub] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  if (error) return <PageError error={error} />
  if (!t) return <PageLoading />
  const editable = can("tasks.task.edit")

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api.patch(`/tasks/${id}`, { ...body, version: t.version })
      await reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <Link href="/app/m/tasks" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Tasks</Link>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <div className="flex items-start gap-3">
                <button onClick={() => patch({ status: t.status === "done" ? "todo" : "done" })} disabled={!editable} aria-label="Toggle done" className="mt-1">
                  {t.status === "done" ? <CircleCheck className="size-6 text-primary" /> : <Circle className="size-6 text-muted-foreground" />}
                </button>
                <h1 className={cn("text-2xl font-semibold tracking-tight", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</h1>
              </div>
              {t.description && <p className="text-sm whitespace-pre-wrap">{t.description}</p>}
              {t.contact && <p className="text-sm">Customer: <Link href={`/app/m/crm/${t.contact.id}`} className="font-medium hover:underline">{t.contact.name}</Link></p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Subtasks</CardTitle>
              {can("tasks.task.create") && <Button variant="outline" size="sm" onClick={() => setAddingSub(true)}><Plus /> Add</Button>}
            </CardHeader>
            <CardContent>
              {t.subtasks.length === 0 ? <p className="text-sm text-muted-foreground">Break the work into smaller steps.</p> : (
                <ul className="grid gap-2">
                  {t.subtasks.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-sm">
                      <button
                        disabled={!editable}
                        aria-label="Toggle subtask"
                        onClick={() => api.patch(`/tasks/${s.id}`, { status: s.status === "done" ? "todo" : "done", version: s.version }).then(reload).catch((e) => toast.error(errorMessage(e)))}
                      >
                        {s.status === "done" ? <CircleCheck className="size-4 text-primary" /> : <Circle className="size-4 text-muted-foreground" />}
                      </button>
                      <span className={cn(s.status === "done" && "text-muted-foreground line-through")}>{s.title}</span>
                      {s.assigneeName && <span className="text-xs text-muted-foreground">· {s.assigneeName}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <ol className="grid gap-3">
                {t.events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="font-medium">{e.actorName ?? "Someone"}</span> <span className="text-muted-foreground">{describe(e)} · {formatDateTime(e.at)}</span>
                    {e.type === "comment" && <p className="mt-1 rounded-2xl bg-muted p-3 whitespace-pre-wrap">{e.body}</p>}
                  </li>
                ))}
              </ol>
              <form
                className="grid gap-2"
                onSubmit={async (ev) => {
                  ev.preventDefault()
                  if (!comment.trim()) return
                  try {
                    await api.post(`/tasks/${id}/comments`, { body: comment })
                    setComment("")
                    await reload()
                  } catch (e) {
                    toast.error(errorMessage(e))
                  }
                }}
              >
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Write a comment…" aria-label="Comment" />
                <Button type="submit" size="sm" className="justify-self-end" disabled={!comment.trim()}>Comment</Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <Card className="content-start">
          <CardContent className="grid gap-4 pt-6">
            <Field label="Status">
              <NativeSelect value={t.status} onChange={(e) => patch({ status: e.target.value })} disabled={!editable}>
                {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Assignee">
              <UserSelect value={t.assigneeId} onChange={(v) => patch({ assigneeId: v })} />
            </Field>
            <Field label="Priority">
              <NativeSelect value={t.priority} onChange={(e) => patch({ priority: e.target.value })} disabled={!editable}>
                {["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Due">
              <Input type="datetime-local" defaultValue={toLocalInput(t.dueAt)} onBlur={(e) => e.target.value !== toLocalInput(t.dueAt) && patch({ dueAt: e.target.value ? new Date(e.target.value).toISOString() : null })} disabled={!editable} />
            </Field>
            <p className="text-xs text-muted-foreground">Created by {t.createdByName ?? "—"}</p>
            {can("tasks.task.delete") && t.status !== "cancelled" && <Button variant="ghost" className="justify-self-start" onClick={() => setDeleting(true)}><Trash2 /> Cancel task</Button>}
          </CardContent>
        </Card>
      </div>
      {addingSub && <TaskDialog parentId={id} onClose={() => setAddingSub(false)} onSaved={() => { setAddingSub(false); void reload() }} />}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} destructive title="Cancel this task?" description="It and its subtasks move to Cancelled. History is kept." confirmLabel="Cancel task"
        onConfirm={async () => { await api.delete(`/tasks/${id}`); toast.success("Task cancelled"); router.replace("/app/m/tasks") }} />
    </>
  )
}
