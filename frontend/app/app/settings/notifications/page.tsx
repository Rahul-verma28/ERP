"use client"

import * as React from "react"
import { toast } from "sonner"
import { CUSTOMER_EVENTS, TEAM_EVENTS, renderTemplate, templateProblems, type CustomerEvent, type NotificationSettings } from "@contracts/account"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ErrorState, NoAccess } from "@/components/page-states"
import { SettingsPage } from "@/components/settings-shell"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useUnsavedChanges } from "@/lib/use-unsaved"
import { cn } from "@/lib/utils"

// Settings › Notifications (wireframe X5): messages to customers (templates per event),
// alerts to the team, and quiet hours & limits. SMS and WhatsApp need a provider first.

interface Data {
  settings: NotificationSettings
  defaults: NotificationSettings
  providers: { email: boolean; sms: boolean; whatsapp: boolean }
}

const SAMPLE: Record<string, string> = {
  customer: "Meera Kulkarni", amount: "₹1,770.00", number: "INV/26-27/0001", due_date: "24 Nov 2026", link: "ahead.app/d/x7Q…", date: "26 Oct 2026", time: "11:30 am", service: "Haircut",
}
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}` }))

export default function NotificationsPage() {
  const { can } = useAuth()
  const { data, error, reload } = useApi<Data>(can("tenant.settings.view") ? "/tenant/notifications" : null)
  const [tab, setTab] = React.useState<"customer" | "team" | "limits">("customer")
  // Kept here so the open template survives the reload after a save
  const [event, setEvent] = React.useState<CustomerEvent>("invoice_issued")
  if (!can("tenant.settings.view")) return <NoAccess what="Notifications" />
  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  const tabs = [
    ["customer", "Messages to customers"],
    ["team", "Alerts to your team"],
    ["limits", "Quiet hours & limits"],
  ] as const
  return (
    <SettingsPage title="Notifications" crumb className="max-w-none">
      <div className="flex gap-1 ui-surface w-fit max-w-full rounded-2xl p-1" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cn("shrink-0 rounded-[11px] px-3.5 py-2 text-sm font-medium capitalize text-muted-foreground transition-colors hover:text-foreground", tab === key && "bg-primary text-primary-foreground hover:text-primary-foreground")}>
            {label}
          </button>
        ))}
      </div>
      {!data ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <Editor key={JSON.stringify(data.settings)} data={data} tab={tab} event={event} setEvent={setEvent} onSaved={reload} />
      )}
    </SettingsPage>
  )
}

function Editor({ data, tab, event, setEvent, onSaved }: { data: Data; tab: "customer" | "team" | "limits"; event: CustomerEvent; setEvent: (e: CustomerEvent) => void; onSaved: () => Promise<void> }) {
  const { can } = useAuth()
  const editable = can("tenant.settings.edit")
  const [s, setS] = React.useState(data.settings)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const dirty = JSON.stringify(s) !== JSON.stringify(data.settings)
  useUnsavedChanges(dirty)

  const save = async (next = s, message = "Notifications saved") => {
    setSaving(true)
    setError(null)
    try {
      await api.put("/tenant/notifications", next)
      toast.success(message)
      await onSaved()
    } catch (e) {
      setError(e instanceof ApiError && Object.keys(e.fields).length ? Object.values(e.fields)[0] : errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  /** Channel switches save straight away; templates save from the editor */
  const quick = (next: NotificationSettings, message: string) => {
    setS(next)
    void save(next, message)
  }

  if (tab === "team") {
    return (
      <section className="ui-surface px-4 py-3">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-semibold">When</th>
              <th className="w-24 py-2 text-center font-semibold">In-app</th>
              <th className="w-24 py-2 text-center font-semibold">Email</th>
            </tr>
          </thead>
          <tbody>
            {TEAM_EVENTS.map((e) => (
              <tr key={e.key} className="border-b border-border/60 last:border-0">
                <td className="py-2.5 font-semibold">{e.label}</td>
                {(["inApp", "email"] as const).map((ch) => (
                  <td key={ch} className="py-2.5 text-center">
                    <Switch
                      aria-label={`${e.label} · ${ch === "inApp" ? "in-app" : "email"}`}
                      checked={s.team[e.key][ch]}
                      disabled={!editable || saving}
                      onCheckedChange={(on) => quick({ ...s, team: { ...s.team, [e.key]: { ...s.team[e.key], [ch]: on } } }, `${e.label}: ${ch === "inApp" ? "in-app" : "email"} ${on ? "on" : "off"}`)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2.5 text-xs text-muted-foreground">Each person can mute alerts for themselves in My account › My notifications. Customer messages can&apos;t be muted there.</p>
        <FormError message={error} />
      </section>
    )
  }

  if (tab === "limits") {
    return (
      <section className="grid gap-4 ui-surface px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold">Quiet hours</h2>
            <p className="text-xs text-muted-foreground">No SMS or WhatsApp to customers in these hours (India time). Email isn&apos;t held back.</p>
          </div>
          <Switch aria-label="Quiet hours" checked={s.quietHours.enabled} disabled={!editable} onCheckedChange={(on) => setS({ ...s, quietHours: { ...s.quietHours, enabled: on } })} />
        </div>
        {s.quietHours.enabled && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            From
            <NativeSelect className="h-9 w-28" aria-label="Quiet from" value={s.quietHours.from} disabled={!editable} onChange={(e) => setS({ ...s, quietHours: { ...s.quietHours, from: Number(e.target.value) } })}>
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
            </NativeSelect>
            to
            <NativeSelect className="h-9 w-28" aria-label="Quiet until" value={s.quietHours.to} disabled={!editable} onChange={(e) => setS({ ...s, quietHours: { ...s.quietHours, to: Number(e.target.value) } })}>
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
            </NativeSelect>
            {s.quietHours.from === s.quietHours.to && <span className="text-xs text-destructive">Start and end can&apos;t be the same</span>}
          </div>
        )}
        <Field label="Most messages one customer gets in a day" hint="Reminders over the limit wait for the next day">
          <NativeSelect className="w-40" value={s.dailyCap} disabled={!editable} onChange={(e) => setS({ ...s, dailyCap: Number(e.target.value) })}>
            {[1, 2, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n} message{n === 1 ? "" : "s"}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <FormError message={error} />
        {editable && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={!dirty || saving} onClick={() => setS(data.settings)}>
              Cancel
            </Button>
            <Button disabled={!dirty || saving || (s.quietHours.enabled && s.quietHours.from === s.quietHours.to)} onClick={() => save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      <section className="min-w-0 flex-1 ui-surface px-4 py-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 font-semibold">When</th>
                <th className="py-2 text-center font-semibold">Email</th>
                {(["SMS", "WhatsApp"] as const).map((c) => (
                  <th key={c} className="py-2 text-center font-semibold">
                    {c}
                    <br />
                    <span className="mt-0.5 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">Needs provider</span>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {CUSTOMER_EVENTS.map((e) => (
                <tr key={e.key} className={cn("border-b border-border/60 last:border-0", event === e.key && "bg-accent/40")}>
                  <td className="py-2.5 pr-2">
                    <strong>{e.label}</strong>
                    <div className="text-xs text-muted-foreground">{e.hint}</div>
                  </td>
                  <td className="py-2.5 text-center">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      aria-label={`${e.label} email`}
                      checked={s.customer[e.key].email}
                      disabled={!editable || saving}
                      onChange={(ev) => quick({ ...s, customer: { ...s.customer, [e.key]: { ...s.customer[e.key], email: ev.target.checked } } }, `${e.label} email ${ev.target.checked ? "on" : "off"}`)}
                    />
                  </td>
                  <td className="py-2.5 text-center">
                    <input type="checkbox" className="size-4" aria-label={`${e.label} SMS (needs a provider)`} checked={false} disabled />
                  </td>
                  <td className="py-2.5 text-center">
                    <input type="checkbox" className="size-4" aria-label={`${e.label} WhatsApp (needs a provider)`} checked={false} disabled />
                  </td>
                  <td className="py-2.5 text-right">
                    <Button variant="outline" size="sm" onClick={() => setEvent(e.key)} aria-pressed={event === e.key}>
                      Edit message
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2.5 text-xs text-muted-foreground">SMS and WhatsApp switch on once a provider is connected (DLT-registered templates for SMS). Appointment messages go out when bookings arrive in your plan.</p>
        <FormError message={error} />
      </section>
      <TemplateEditor key={event} event={event} settings={s} defaults={data.defaults} editable={editable} onSave={(t) => {
        const next = { ...s, customer: { ...s.customer, [event]: { ...s.customer[event], ...t } } }
        setS(next)
        return save(next, "Message saved")
      }} />
    </div>
  )
}

function TemplateEditor({ event, settings, defaults, editable, onSave }: { event: CustomerEvent; settings: NotificationSettings; defaults: NotificationSettings; editable: boolean; onSave: (t: { subject: string; body: string }) => Promise<void> }) {
  const { me } = useAuth()
  const def = CUSTOMER_EVENTS.find((e) => e.key === event)!
  const saved = settings.customer[event]
  const [subject, setSubject] = React.useState(saved.subject)
  const [body, setBody] = React.useState(saved.body)
  const [busy, setBusy] = React.useState<"save" | "test" | null>(null)
  const bodyRef = React.useRef<HTMLTextAreaElement>(null)
  const problem = templateProblems(event, { subject, body })
  const vars = { ...SAMPLE, business: me?.tenant?.name ?? "Your business" }
  const changed = subject !== saved.subject || body !== saved.body

  const insert = (v: string) => {
    const el = bodyRef.current
    const token = `{${v}}`
    if (!el) return setBody((b) => b + token)
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    setBody(body.slice(0, start) + token + body.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <section className="flex w-full shrink-0 flex-col gap-2.5 ui-surface px-4 py-3.5 xl:w-[380px]" aria-label={`${def.label} email template`}>
      <h2 className="text-[15px] font-bold">{def.label} · Email</h2>
      <Field label="Subject" error={!subject.trim() ? "Add a subject" : null}>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!editable} maxLength={150} />
      </Field>
      <Field label="Message" error={problem} count={[body.length, 1000]}>
        <Textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable} rows={5} maxLength={1000} />
      </Field>
      <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        Insert:
        {def.vars
          .filter((v) => v !== "business")
          .map((v) => (
            <button key={v} type="button" disabled={!editable} onClick={() => insert(v)} className="inline-flex h-[22px] items-center rounded-md bg-accent px-[7px] font-mono text-xs font-semibold text-accent-foreground hover:opacity-80">
              {`{${v}}`}
            </button>
          ))}
        {def.required.length > 0 && (
          <span>
            · <strong>{`{${def.required[0]}}`}</strong> is required
          </span>
        )}
      </p>
      <div className="rounded-[10px] bg-muted px-3 py-2.5 text-xs leading-relaxed">
        <div className="mb-0.5 font-bold">Preview</div>
        <div className="font-semibold">{renderTemplate(subject, vars)}</div>
        <div className="whitespace-pre-wrap">{renderTemplate(body, vars)}</div>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!!problem || busy !== null}
          onClick={async () => {
            setBusy("test")
            try {
              const r = await api.post<{ sentTo: string }>("/tenant/notifications/test", { event, subject, body })
              toast.success(`Test sent to ${r.sentTo}`)
            } catch (e) {
              toast.error(errorMessage(e))
            } finally {
              setBusy(null)
            }
          }}
        >
          Send test to me
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!editable || (subject === defaults.customer[event].subject && body === defaults.customer[event].body)}
          onClick={() => {
            setSubject(defaults.customer[event].subject)
            setBody(defaults.customer[event].body)
          }}
        >
          Reset to default
        </Button>
        <Button
          size="sm"
          className="ml-auto"
          disabled={!editable || !changed || !!problem || !subject.trim() || busy !== null}
          onClick={async () => {
            setBusy("save")
            await onSave({ subject: subject.trim(), body: body.trim() })
            setBusy(null)
          }}
        >
          {busy === "save" ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  )
}
