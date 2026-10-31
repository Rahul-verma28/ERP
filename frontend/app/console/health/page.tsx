"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Activity, CheckCircle2, CircleAlert, Clock, CreditCard, Loader2, RefreshCw, TriangleAlert, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chip, Failed, Loading, Page, Panel, Stat, StatGrid, ago, type Tone } from "@/components/console/kit"
import { api, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"
import { useAuth } from "@/lib/auth"
import { formatDate } from "@/lib/format"
import type { JobStatus, SystemHealth } from "@/lib/console"

// System health (blueprint Phase F): is everything behind the scenes working? Scheduled jobs,
// background events that failed, payment webhooks that need a person, and businesses with
// errors. Admin and Staff see it; only an Admin runs a job, retries or dismisses.

const JOB_STATE: Record<JobStatus, { label: string; tone: Tone }> = {
  ok: { label: "Working", tone: "green" },
  running: { label: "Running now", tone: "blue" },
  late: { label: "Not run recently", tone: "amber" },
  failed: { label: "Failed", tone: "red" },
}

export default function SystemHealthPage() {
  const { canConsole } = useAuth()
  const canAct = canConsole("platform.setting.edit")
  const { data, error, reload } = useApi<SystemHealth>("/console/health")
  const [busy, setBusy] = React.useState<string | null>(null)

  async function act(id: string, fn: () => Promise<unknown>, done: string) {
    setBusy(id)
    try {
      await fn()
      toast.success(done)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (error) return <Failed error={error} onRetry={reload} />
  if (!data) return <Loading rows={8} className="mx-auto max-w-6xl" />
  const s = data.summary
  const problems = s.jobsFailing + s.eventsFailed + s.webhooks + (s.queueStuck ? 1 : 0)

  return (
    <Page
      eyebrow="Insights"
      title="System health"
      subtitle="Everything AHEAD does in the background: scheduled jobs, follow-up work after each action, and payment notices from the gateway."
      wide
      actions={<Button variant="outline" size="sm" onClick={reload}><RefreshCw /> Refresh</Button>}
    >
      <div className={problems ? "flex items-center gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" : "flex items-center gap-3 rounded-xl border border-emerald-300/60 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"}>
        {problems ? <TriangleAlert className="size-5 shrink-0" /> : <CheckCircle2 className="size-5 shrink-0" />}
        <span>{problems ? `${problems} thing${problems === 1 ? "" : "s"} need${problems === 1 ? "s" : ""} a look. Details below.` : "All systems are working. Nothing needs you right now."}</span>
      </div>

      <StatGrid>
        <Stat icon={Clock} label="Scheduled jobs" value={s.jobsFailing ? `${s.jobsFailing} failed` : s.jobsLate ? `${s.jobsLate} late` : "All working"} hint="Run every hour" tone={s.jobsFailing || s.jobsLate ? "warn" : undefined} />
        <Stat icon={Workflow} label="Background work" value={s.eventsFailed ? `${s.eventsFailed} failed` : "No failures"} hint={s.queueStuck ? "Queue is not moving" : `${s.eventsWaiting} waiting · ${s.eventsRetrying} retrying`} tone={s.eventsFailed || s.queueStuck ? "warn" : undefined} />
        <Stat icon={CreditCard} label="Payment notices" value={s.webhooks ? `${s.webhooks} to check` : "All handled"} hint="From the payment gateway" tone={s.webhooks ? "warn" : undefined} />
        <Stat icon={Activity} label="Businesses with errors" value={s.businessesWithErrors} hint="In the last 7 days" tone={s.businessesWithErrors ? "warn" : undefined} />
      </StatGrid>

      <Panel title="Scheduled jobs" description="The worker runs these every hour. Each one only acts on what is due, so running it again is safe." padded={false}>
        <ul className="divide-y border-t">
          {data.jobs.map((j) => (
            <li key={j.key} className="grid gap-2 px-5 py-3.5 md:grid-cols-[1fr_12rem_auto] md:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-medium">{j.label} <Chip tone={JOB_STATE[j.status].tone}>{JOB_STATE[j.status].label}</Chip></div>
                <div className="text-xs text-muted-foreground">{j.text}</div>
                {j.lastError && <div className="mt-1 text-xs break-words text-destructive">{j.lastError}</div>}
              </div>
              <div className="text-xs text-muted-foreground">
                {j.lastRunAt ? `Last run ${ago(j.lastRunAt).toLowerCase()}` : "Not run yet"}
                {j.failures > 0 && <div>{j.failures} of {j.runs} runs failed</div>}
              </div>
              {canAct && (
                <Button variant="outline" size="sm" disabled={!!busy || j.status === "running"} onClick={() => act(j.key, async () => {
                  const r = await api.post<{ ok: boolean; error: string | null }>(`/console/health/jobs/${j.key}/run`)
                  if (!r.ok) throw new Error(r.error ?? "The job failed")
                }, `${j.label} ran`)}>
                  {busy === j.key ? <Loader2 className="animate-spin" /> : <RefreshCw />} Run now
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Background work that failed"
        description="After an action (a new business, a payment, a plan change) AHEAD finishes some work in the background. These failed 8 times and stopped. Retry once the cause is fixed, or dismiss if it no longer matters."
        action={canAct && data.failedEvents.length > 1 ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("all", () => api.post("/console/health/events/retry-all"), "Sent to retry")}>Retry all</Button> : undefined}
        padded={false}
      >
        {!data.failedEvents.length ? (
          <Ok text="Nothing failed." />
        ) : (
          <ul className="divide-y border-t">
            {data.failedEvents.map((e) => (
              <li key={e.id} className="grid gap-2 px-5 py-3 md:grid-cols-[1fr_auto] md:items-center">
                <div className="min-w-0 text-sm">
                  <div className="font-medium">{e.what}{e.business && e.tenantId && <> · <Link href={`/console/clients/${e.tenantId}`} className="hover:underline">{e.business}</Link></>}</div>
                  <div className="text-xs break-words text-destructive">{e.error}</div>
                  <div className="text-xs text-muted-foreground">{formatDate(e.at)} · tried {e.attempts} times · <code>{e.type}</code></div>
                </div>
                {canAct && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act(e.id, () => api.post(`/console/health/events/${e.id}/dismiss`), "Dismissed")}>Dismiss</Button>
                    <Button size="sm" disabled={!!busy} onClick={() => act(e.id, () => api.post(`/console/health/events/${e.id}/retry`), "Sent to retry")}>Retry</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Payment notices to check" description="The gateway said a payment link was paid, but AHEAD could not match it (unknown link, different amount, cancelled order). Sort it out in Billing, then mark it handled." padded={false}>
          {!data.webhooks.length ? (
            <Ok text="All payment notices were handled." />
          ) : (
            <ul className="divide-y border-t">
              {data.webhooks.map((w) => (
                <li key={w.id} className="grid gap-2 px-5 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium break-words">{w.error}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(w.at)} · {w.gateway} · <code className="break-all">{w.eventId}</code></div>
                  </div>
                  {canAct && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(w.id, () => api.post(`/console/health/webhooks/${w.id}/resolve`), "Marked handled")}>Mark handled</Button>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Businesses with errors" description="Background work that failed for a business in the last 7 days." padded={false}>
          {!data.businesses.length ? (
            <Ok text="No business had errors this week." />
          ) : (
            <ul className="divide-y border-t">
              {data.businesses.map((b) => (
                <li key={b.tenantId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <Link href={`/console/clients/${b.tenantId}`} className="min-w-0 truncate font-medium hover:underline">{b.business}</Link>
                  <Chip tone="red">{b.errors} error{b.errors === 1 ? "" : "s"}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {!canAct && <p className="flex items-center gap-2 text-sm text-muted-foreground"><CircleAlert className="size-4" /> Only an Admin can run jobs, retry or dismiss.</p>}
    </Page>
  )
}

function Ok({ text }: { text: string }) {
  return <p className="flex items-center gap-2 px-5 pb-5 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-600" /> {text}</p>
}
