"use client"

import * as React from "react"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Star, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { STAGE_COLORS, tone, useCrmSetup, type CrmOption, type Pipeline, type Stage } from "@/lib/crm"
import { cn } from "@/lib/utils"
import { PageError, PageLoading } from "@/components/page-states"

// CRM setup on one page: pipelines and their lead and deal stages, sources, labels, lost reasons.

function ColorPick({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
      {STAGE_COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} title={c} onClick={() => onChange(c)} className={cn("size-6 rounded-full ring-offset-2 ring-offset-background", tone(c).dot, value === c && "ring-2 ring-primary")} />)}
    </div>
  )
}

function StageDialog({ stage, pipelineId, kind, onClose, onSaved }: { stage: Stage | null; pipelineId: string; kind: "lead" | "deal"; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(stage?.name ?? "")
  const [color, setColor] = React.useState(stage?.color ?? "blue")
  const [prob, setProb] = React.useState(stage?.probability == null ? "" : String(stage.probability))
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setErrors({ name: "Enter the stage name" })
    if (kind === "deal" && prob === "") return setErrors({ probability: "Enter the chance of winning at this stage" })
    setBusy(true)
    const body = { name: name.trim(), color, ...(kind === "deal" ? { probability: Number(prob) } : {}) }
    try {
      if (stage) await api.patch(`/crm/stages/${stage.id}`, body)
      else await api.post("/crm/stages", { ...body, pipelineId, kind })
      toast.success("Stage saved")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{stage ? "Edit stage" : `New ${kind} stage`}</DialogTitle><DialogDescription>{kind === "lead" ? "A step a lead goes through before it becomes a deal." : "A step a deal goes through before it is won."}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Name" required error={errors.name}><Input value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setErrors({}) }} placeholder={kind === "lead" ? "e.g. Site visit done" : "e.g. Sample sent"} autoFocus /></Field>
          {kind === "deal" && <Field label="Chance of winning" required error={errors.probability} hint="Used for the likely value of open deals"><NumberStepper max={100} step={5} suffix="%" value={prob} onChange={(v) => { setProb(v); setErrors({}) }} placeholder="e.g. 50" /></Field>}
          <Field label="Colour"><ColorPick value={color} onChange={setColor} /></Field>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save stage"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StageList({ pipeline, kind, reload }: { pipeline: Pipeline; kind: "lead" | "deal"; reload: () => Promise<void> }) {
  const stages = kind === "lead" ? pipeline.leadStages : pipeline.dealStages
  const [editing, setEditing] = React.useState<Stage | "new" | null>(null)
  const [removing, setRemoving] = React.useState<Stage | null>(null)
  async function move(i: number, by: -1 | 1) {
    const ids = stages.map((s) => s.id)
    ;[ids[i], ids[i + by]] = [ids[i + by], ids[i]]
    try {
      await api.post("/crm/stages/order", { pipelineId: pipeline.id, kind, ids })
      await reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <section className="ui-surface overflow-hidden">
      <header className="flex items-center justify-between border-b px-5 py-3">
        <div><h3 className="font-semibold">{kind === "lead" ? "Lead stages" : "Deal stages"}</h3><p className="text-xs text-muted-foreground">{kind === "lead" ? "From first enquiry until it is ready to be a deal" : "From requirement until won; each with its chance of winning"}</p></div>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}><Plus /> Add</Button>
      </header>
      <ol className="divide-y">
        {stages.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 px-5 py-2.5">
            <span className="w-5 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            <span className={cn("size-2.5 shrink-0 rounded-full", tone(s.color).dot)} />
            <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
            {kind === "deal" && <span className="text-xs text-muted-foreground tabular-nums">{s.probability ?? 0}%</span>}
            <span className="flex">
              <Button variant="ghost" size="icon-sm" disabled={i === 0} aria-label={`Move ${s.name} up`} onClick={() => move(i, -1)}><ArrowUp /></Button>
              <Button variant="ghost" size="icon-sm" disabled={i === stages.length - 1} aria-label={`Move ${s.name} down`} onClick={() => move(i, 1)}><ArrowDown /></Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Pencil /></Button>
              <Button variant="ghost" size="icon-sm" className="text-destructive" disabled={stages.length < 2} aria-label={`Delete ${s.name}`} onClick={() => setRemoving(s)}><Trash2 /></Button>
            </span>
          </li>
        ))}
      </ol>
      {editing && <StageDialog stage={editing === "new" ? null : editing} pipelineId={pipeline.id} kind={kind} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload() }} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive title={`Delete the stage "${removing?.name}"?`} description="Only an empty stage can be deleted. Move its leads or deals first." confirmLabel="Delete stage" onConfirm={async () => { try { await api.delete(`/crm/stages/${removing!.id}`); await reload(); toast.success("Stage deleted") } catch (e) { toast.error(errorMessage(e)) } }} />
    </section>
  )
}

function OptionList({ kind, title, hint, rows, reload, colored }: { kind: CrmOption["kind"]; title: string; hint: string; rows: CrmOption[]; reload: () => Promise<void>; colored?: boolean }) {
  const [name, setName] = React.useState("")
  const [color, setColor] = React.useState("blue")
  const [editing, setEditing] = React.useState<{ id: string; name: string; color: string } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setError("Enter at least 2 letters")
    try {
      await api.post("/crm/options", { kind, name: name.trim(), color: colored ? color : null })
      setName("")
      setError(null)
      await reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  async function saveEdit() {
    if (!editing || editing.name.trim().length < 2) return
    try {
      await api.patch(`/crm/options/${editing.id}`, { name: editing.name.trim(), color: colored ? editing.color : undefined })
      setEditing(null)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <section className="ui-surface overflow-hidden">
      <header className="border-b px-5 py-3"><h3 className="font-semibold">{title}</h3><p className="text-xs text-muted-foreground">{hint}</p></header>
      <ul className="divide-y">
        {rows.map((o) => (
          <li key={o.id} className="flex items-center gap-3 px-5 py-2.5">
            {editing?.id === o.id ? (
              <>
                {colored && <ColorPick value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />}
                <Input value={editing.name} maxLength={40} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-8 flex-1" autoFocus onKeyDown={(e) => { if (e.key === "Enter") void saveEdit() }} />
                <Button size="icon-sm" aria-label="Save" onClick={saveEdit}><Check /></Button>
                <Button size="icon-sm" variant="outline" aria-label="Cancel" onClick={() => setEditing(null)}><X /></Button>
              </>
            ) : (
              <>
                {colored ? <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", tone(o.color).pill)}>{o.name}</span> : <span className="flex-1">{o.name}</span>}
                {colored && <span className="flex-1" />}
                <Button variant="ghost" size="icon-sm" aria-label={`Rename ${o.name}`} onClick={() => setEditing({ id: o.id, name: o.name, color: o.color ?? "blue" })}><Pencil /></Button>
                <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label={`Remove ${o.name}`} onClick={async () => { try { await api.delete(`/crm/options/${o.id}`); await reload() } catch (e) { toast.error(errorMessage(e)) } }}><Trash2 /></Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="grid gap-2 border-t px-5 py-3">
        {colored && <ColorPick value={color} onChange={setColor} />}
        <div className="flex gap-2"><Input value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setError(null) }} placeholder={`New ${title.toLowerCase().replace(/s$/, "")}`} className="h-9" /><Button type="submit" size="sm"><Plus /> Add</Button></div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>
    </section>
  )
}

function PipelineDialog({ pipeline, onClose, onSaved }: { pipeline: Pipeline | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [name, setName] = React.useState(pipeline?.name ?? "")
  const [isDefault, setIsDefault] = React.useState(pipeline?.isDefault ?? false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setError("Enter the pipeline name")
    setBusy(true)
    try {
      const p = pipeline ? await api.patch<Pipeline>(`/crm/pipelines/${pipeline.id}`, { name: name.trim(), isDefault: isDefault || undefined }) : await api.post<Pipeline>("/crm/pipelines", { name: name.trim(), isDefault })
      toast.success("Pipeline saved")
      onSaved(p.id)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{pipeline ? "Rename pipeline" : "New pipeline"}</DialogTitle><DialogDescription>Use a separate pipeline when a kind of sale has its own steps, e.g. Retail and Projects.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Name" required error={error}><Input value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setError(null) }} placeholder="e.g. Projects" autoFocus /></Field>
          {!pipeline?.isDefault && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Open this pipeline first</label>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function CrmSetupPage() {
  const { can } = useAuth()
  const setup = useCrmSetup()
  const [pipelineId, setPipelineId] = React.useState("")
  const [tab, setTab] = React.useState<"pipelines" | "lists">("pipelines")
  const [editing, setEditing] = React.useState<Pipeline | "new" | null>(null)
  const [removing, setRemoving] = React.useState<Pipeline | null>(null)
  if (!can("crm.pipeline.edit")) return <PageHeader title="CRM setup" description="You don't have access to this. Ask your admin." />
  const data = setup.data
  if (setup.error) return <PageError error={setup.error} onRetry={() => void setup.reload()} />
  if (!data) return <PageLoading />
  const pipeline = data.pipelines.find((p) => p.id === pipelineId) ?? data.pipelines.find((p) => p.isDefault) ?? data.pipelines[0]

  return (
    <div className="grid gap-5">
      <PageHeader title="CRM setup" description="Your pipelines and their stages, and the lists used on leads and deals." />
      <div className="flex w-fit gap-1 rounded-xl border p-1 text-sm" role="tablist">
        {([["pipelines", "Pipelines and stages"], ["lists", "Sources, labels, lost reasons"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("rounded-lg px-3 py-1.5 font-medium text-muted-foreground", tab === k && "bg-primary text-primary-foreground")}>{l}</button>)}
      </div>
      {tab === "pipelines" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-56"><NativeSelect value={pipeline.id} onChange={(e) => setPipelineId(e.target.value)} aria-label="Pipeline">{data.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " (default)" : ""}</option>)}</NativeSelect></div>
            <Button variant="outline" onClick={() => setEditing(pipeline)}><Pencil /> Rename</Button>
            {!pipeline.isDefault && <Button variant="outline" onClick={async () => { await api.patch(`/crm/pipelines/${pipeline.id}`, { isDefault: true }); await setup.reload(); toast.success(`${pipeline.name} opens first`) }}><Star /> Make default</Button>}
            {data.pipelines.length > 1 && <Button variant="ghost" className="text-destructive" onClick={() => setRemoving(pipeline)}><Trash2 /> Delete</Button>}
            <Button onClick={() => setEditing("new")}><Plus /> New pipeline</Button>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <StageList pipeline={pipeline} kind="lead" reload={setup.reload} />
            <StageList pipeline={pipeline} kind="deal" reload={setup.reload} />
          </div>
        </>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <OptionList kind="source" title="Sources" hint="Where leads come from" rows={data.sources} reload={setup.reload} />
          <OptionList kind="label" title="Labels" hint="Tags to group leads and deals" rows={data.labels} reload={setup.reload} colored />
          <OptionList kind="lost_reason" title="Lost reasons" hint="Asked when a lead or deal is lost" rows={data.lostReasons} reload={setup.reload} />
        </div>
      )}
      {editing && <PipelineDialog pipeline={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async (id) => { setEditing(null); await setup.reload(); setPipelineId(id) }} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} destructive title={`Delete the pipeline "${removing?.name}"?`} description="Only a pipeline with no leads or deals can be deleted." confirmLabel="Delete pipeline" onConfirm={async () => { try { await api.delete(`/crm/pipelines/${removing!.id}`); setPipelineId(""); await setup.reload(); toast.success("Pipeline deleted") } catch (e) { toast.error(errorMessage(e)) } }} />
    </div>
  )
}
