"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Check, Clock, Phone, Plus, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SearchInput } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { Chip, Empty, Failed, Loading, Page, Panel, Row, relDays, tomorrowAt11, type Tone } from "@/components/console/kit"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useDebounced } from "@/lib/use-list"
import { formatDateTime } from "@/lib/format"
import { STAGES, STAGE_LABEL, type Followup, type Prospect, type Stage } from "@/lib/console"
import { cn } from "@/lib/utils"

// Leads: businesses that might become clients, where each one stands, and who to call next.
// When a lead signs up with the same mobile, it links to the new client by itself.

const STAGE_TONE: Record<Stage, Tone> = { new: "blue", contacted: "blue", demo: "amber", trial: "amber", won: "green", lost: "grey" }
const OPEN: Stage[] = ["new", "contacted", "demo", "trial"]

function LeadDialog({ lead, onClose, onSaved }: { lead: Prospect | null; onClose: () => void; onSaved: () => void }) {
  const industries = useApi<{ data: { key: string; name: string }[] }>("/public/industries")
  const [form, setForm] = React.useState({
    businessName: lead?.businessName ?? "",
    name: lead?.name ?? "",
    mobile: lead?.mobile?.replace(/^\+91/, "") ?? "",
    email: lead?.email ?? "",
    city: lead?.city ?? "",
    industryKey: lead?.industryKey ?? "",
    source: lead?.source ?? "",
    stage: lead?.stage ?? ("new" as Stage),
    lostReason: lead?.lostReason ?? "",
  })
  const [next, setNext] = React.useState({ title: "", due: tomorrowAt11() })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value })

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    const body = { businessName: form.businessName, name: form.name, mobile: form.mobile, email: form.email, city: form.city || null, industryKey: form.industryKey || null, source: form.source || null }
    try {
      if (lead) {
        await api.patch(`/console/prospects/${lead.id}`, { ...body, stage: form.stage, lostReason: form.stage === "lost" ? form.lostReason : null })
        if (next.title.trim()) await api.post("/console/followups", { title: next.title, dueAt: new Date(next.due).toISOString(), prospectId: lead.id })
        toast.success("Saved")
      } else {
        await api.post("/console/prospects", body)
        toast.success("Lead added — a first call is planned for tomorrow")
      }
      onSaved()
      onClose()
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...err.fields, form: errorMessage(err) } : { form: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{lead ? lead.businessName : "New lead"}</DialogTitle>
            <DialogDescription>{lead ? `Looked after by ${lead.owner ?? "—"}` : "A business that might become a client."}</DialogDescription>
          </DialogHeader>
          {lead && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stage">
              {STAGES.map((s) => (
                <button key={s} type="button" onClick={() => setForm({ ...form, stage: s })} aria-pressed={form.stage === s} className={cn("h-8 rounded-full border px-3 text-[13px] font-medium", form.stage === s ? "border-primary bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {STAGE_LABEL[s]}
                </button>
              ))}
            </div>
          )}
          {form.stage === "lost" && (
            <Field label="Why was it lost?" required error={errors.lostReason}>
              <Textarea value={form.lostReason} onChange={set("lostReason")} rows={2} required />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" required error={errors.businessName}>
              <Input value={form.businessName} onChange={set("businessName")} required autoFocus={!lead} />
            </Field>
            <Field label="Contact person" required error={errors.name}>
              <Input value={form.name} onChange={set("name")} required />
            </Field>
            <Field label="Mobile" hint="Links the lead when they sign up" error={errors.mobile}>
              <Input value={form.mobile} onChange={set("mobile")} inputMode="tel" placeholder="98765 43210" />
            </Field>
            <Field label="Email" error={errors.email}>
              <Input type="email" value={form.email} onChange={set("email")} />
            </Field>
            <Field label="Industry" error={errors.industryKey}>
              <NativeSelect value={form.industryKey} onChange={set("industryKey")}>
                <option value="">Not sure yet</option>
                {industries.data?.data.map((i) => (
                  <option key={i.key} value={i.key}>
                    {i.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="City" error={errors.city}>
              <Input value={form.city} onChange={set("city")} />
            </Field>
            <Field label="Where they came from" error={errors.source} className="sm:col-span-2">
              <Input value={form.source} onChange={set("source")} placeholder="e.g. website, walk-in, referral" />
            </Field>
          </div>
          {lead && lead.tenantId && (
            <p className="text-sm">
              They signed up —{" "}
              <Link href={`/console/clients/${lead.tenantId}`} className="font-medium text-primary hover:underline">
                open the client
              </Link>
            </p>
          )}
          {lead && !["won", "lost"].includes(form.stage) && (
            <div className="grid gap-2 rounded-xl border bg-muted/30 p-3">
              <p className="text-[13px] text-muted-foreground">{lead.next ? `Next: ${lead.next.title} · ${formatDateTime(lead.next.dueAt)}` : "No call planned"}</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input value={next.title} onChange={(e) => setNext({ ...next, title: e.target.value })} placeholder="Plan another call (optional)" aria-label="Next call" />
                <Input type="datetime-local" value={next.due} onChange={(e) => setNext({ ...next, due: e.target.value })} aria-label="When" />
              </div>
            </div>
          )}
          <FormError message={errors.form} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : lead ? "Save" : "Add lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Calls({ onLead, refresh, onChange }: { onLead: (id: string) => void; refresh: number; onChange: () => void }) {
  const { data, error, reload } = useApi<{ data: Followup[] }>(`/console/followups?mine=true&days=7&r=${refresh}`)
  async function close(f: Followup, body: { done?: boolean; snoozeDays?: number }) {
    try {
      await api.post(`/console/followups/${f.id}/close`, body)
      reload()
      onChange()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Panel title="Your calls this week" description="Includes the ones made for you automatically" padded={false}>
      <div className="px-3 pb-3">
        {error ? (
          <Failed error={error} onRetry={reload} />
        ) : !data ? (
          <Loading rows={3} className="px-2" />
        ) : !data.data.length ? (
          <Empty icon={Phone} title="No calls planned" text="Calls you plan on a lead or client show up here." />
        ) : (
          <div className="divide-y">
            {data.data.map((f) => (
              <Row
                key={f.id}
                icon={Phone}
                tone={f.overdue ? "red" : "blue"}
                title={
                  f.about?.kind === "client" ? (
                    <Link href={`/console/clients/${f.about.id}`} className="hover:underline">
                      {f.about.name}
                    </Link>
                  ) : f.about ? (
                    <button type="button" className="hover:underline" onClick={() => onLead(f.about!.id)}>
                      {f.about.name}
                    </button>
                  ) : (
                    f.title
                  )
                }
                detail={`${f.title} · ${f.overdue ? "overdue" : relDays(f.dueAt)}`}
                right={
                  <span className="flex gap-1">
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => close(f, { done: true })} aria-label={`Mark ${f.title} done`}>
                      <Check className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => close(f, { snoozeDays: 1 })} aria-label={`Move ${f.title} to tomorrow`}>
                      <Clock className="size-4" />
                    </Button>
                  </span>
                }
              />
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

export default function LeadsPage() {
  const { canConsole } = useAuth()
  const [stage, setStage] = React.useState<Stage | "open">("open")
  const [search, setSearch] = React.useState("")
  const [open, setOpen] = React.useState<Prospect | "new" | null>(null)
  const [refresh, setRefresh] = React.useState(0)
  const q = useDebounced(search)
  const { data, error, reload } = useApi<{ data: Prospect[] }>(`/console/prospects${q ? `?search=${encodeURIComponent(q)}` : ""}`)
  const all = data?.data ?? []
  const rows = all.filter((p) => (stage === "open" ? OPEN.includes(p.stage) : p.stage === stage))
  const count = (s: Stage | "open") => all.filter((p) => (s === "open" ? OPEN.includes(p.stage) : p.stage === s)).length
  const saved = () => {
    reload()
    setRefresh((n) => n + 1)
  }

  return (
    <Page
      title="Leads"
      subtitle="Businesses that might become clients. When a lead signs up with the same mobile, it's linked to the new client automatically."
      actions={
        canConsole("platform.prospect.create") && (
          <Button onClick={() => setOpen("new")}>
            <Plus /> Add lead
          </Button>
        )
      }
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-3 lg:col-span-2">
          <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1" role="tablist" aria-label="Stage">
            {(["open", "won", "lost"] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={stage === s} onClick={() => setStage(s)} className={cn("h-8 shrink-0 rounded-lg px-3 text-[13px] font-medium", stage === s ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
                {s === "open" ? "Open" : STAGE_LABEL[s]} {data ? <span className="ml-1 text-xs opacity-70">{count(s)}</span> : null}
              </button>
            ))}
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search by business, person or mobile" />
          <Panel padded={false}>
            {error ? (
              <div className="p-5">
                <Failed error={error} onRetry={reload} />
              </div>
            ) : !data ? (
              <Loading rows={5} className="p-5" />
            ) : !rows.length ? (
              <Empty icon={Target} title={stage === "open" ? "No open leads" : `No ${STAGE_LABEL[stage].toLowerCase()} leads`} text={stage === "open" ? "Add a business you're talking to, and plan your first call." : undefined} />
            ) : (
              <div className="divide-y px-3 py-1">
                {rows.map((p) => (
                  <button key={p.id} type="button" onClick={() => setOpen(p)} className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-muted/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.businessName}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">{[p.name, p.city, p.source].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="hidden text-right text-[13px] sm:block">
                      {p.next ? (
                        <>
                          <span className="block max-w-48 truncate">{p.next.title}</span>
                          <span className={cn("block", new Date(p.next.dueAt) < new Date() ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground")}>{new Date(p.next.dueAt) < new Date() ? "Overdue" : relDays(p.next.dueAt)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">No call planned</span>
                      )}
                    </span>
                    <Chip tone={STAGE_TONE[p.stage]}>{STAGE_LABEL[p.stage]}</Chip>
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </div>
        <Calls refresh={refresh} onChange={reload} onLead={(id) => setOpen(all.find((x) => x.id === id) ?? null)} />
      </div>
      {open && <LeadDialog key={open === "new" ? "new" : open.id} lead={open === "new" ? null : open} onClose={() => setOpen(null)} onSaved={saved} />}
    </Page>
  )
}
