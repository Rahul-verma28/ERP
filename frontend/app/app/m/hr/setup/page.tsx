"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Award, BadgeMinus, BadgePlus, Building2, CalendarClock, CalendarDays, Check, Clock, FileText, FolderOpen, HandCoins, Landmark, Megaphone, MessageSquareWarning, Network, Pencil, Plus, ShieldAlert, Trash2, UserX, Users, X, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/app-shell"
import { ConfirmDialog, EmptyState, MoneyInput } from "@/components/common"
import { DataList, localList, type Column } from "@/components/data-list"
import { Field, FormError, NativeSelect } from "@/components/form"
import { NumberStepper } from "@/components/number-stepper"
import { ErrorState, PageLoading, NoAccessPage } from "@/components/page-states"
import { ActionMenu, Pill, Section } from "@/components/page-parts"
import { DepartmentSelect } from "@/components/hr/pickers"
import { ListEditor, saveHrConfig } from "@/components/hr/list-editor"
import { SearchSelect } from "@/components/search-select"
import { Textarea } from "@/components/ui/textarea"
import { useSharedApi } from "@/lib/use-api"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatPaise } from "@/lib/format"
import { DAY_NAMES, useHrLookups, type Department, type Designation, type DocumentType, type HrConfig, type ListKey } from "@/lib/hr"
import { cn } from "@/lib/utils"
import { InlineSave } from "@/components/save-bar"
import { activeOr } from "@/lib/active"

// HR setup: working days and IDs, payroll rules (PF, ESI, PT), departments, designations,
// and the short lists the HR forms choose from. Leave types are under Leave Management.


function useConfig() {
  const look = useHrLookups()
  const { can } = useAuth()
  async function save(patch: Partial<HrConfig>, done = "Saved") {
    try {
      await api.patch("/hr/settings", patch)
      toast.success(done)
      await look.reload()
      return true
    } catch (e) {
      toast.error(errorMessage(e))
      return false
    }
  }
  return { cfg: look.data?.config, look, save, edit: can("hr.setup.edit") }
}

function Rules() {
  const { cfg } = useConfig()
  return cfg ? <RulesForm cfg={cfg} /> : <PageLoading />
}

function RulesForm({ cfg }: { cfg: HrConfig }) {
  const { save, edit } = useConfig()
  const [f, setF] = React.useState({ workingDays: cfg.workingDays, employeePrefix: cfg.employeePrefix, leaveYearStart: cfg.leaveYearStart })
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, i, 1)).toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" }))
  return (
    <Section title="Working rules" description="Weekly offs and holidays aren't counted as leave, and aren't loss of pay.">
      <div className="grid gap-5">
        <Field label="Working days" hint="The rest are weekly offs">
          <div className="flex flex-wrap gap-1.5">{[1, 2, 3, 4, 5, 6, 0].map((d) => { const on = f.workingDays.includes(d); return <button key={d} type="button" disabled={!edit} aria-pressed={on} onClick={() => setF({ ...f, workingDays: on ? f.workingDays.filter((x) => x !== d) : [...f.workingDays, d] })} className={cn("h-9 min-w-14 rounded-lg border px-3 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{DAY_NAMES[d]}</button> })}</div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Employee ID starts with" hint={`New IDs look like ${f.employeePrefix || "EMP-"}0001`}><Input value={f.employeePrefix} maxLength={8} disabled={!edit} onChange={(e) => setF({ ...f, employeePrefix: e.target.value.toUpperCase() })} placeholder="EMP-" /></Field>
          <Field label="Leave year starts in" hint="Balances reset each leave year"><NativeSelect value={String(f.leaveYearStart)} disabled={!edit} aria-label="Leave year starts in" onChange={(e) => setF({ ...f, leaveYearStart: Number(e.target.value) })}>{months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</NativeSelect></Field>
        </div>
        {edit && <InlineSave dirty={JSON.stringify(f) !== JSON.stringify({ workingDays: cfg.workingDays, employeePrefix: cfg.employeePrefix, leaveYearStart: cfg.leaveYearStart })} onDiscard={() => setF({ workingDays: cfg.workingDays, employeePrefix: cfg.employeePrefix, leaveYearStart: cfg.leaveYearStart })} disabled={!f.workingDays.length || !f.employeePrefix.trim()} onSave={() => void save({ ...f, employeePrefix: f.employeePrefix.trim() }, "Working rules saved")} saveLabel="Save working rules" />}
      </div>
    </Section>
  )
}

function Payroll() {
  const { cfg } = useConfig()
  return cfg ? <PayrollForm cfg={cfg} /> : <PageLoading />
}

function PayrollForm({ cfg }: { cfg: HrConfig }) {
  const { save, edit } = useConfig()
  const [f, setF] = React.useState<Pick<HrConfig, "pf" | "esi" | "pt">>({ pf: cfg.pf, esi: cfg.esi, pt: cfg.pt })
  const pct = (bp: number) => String(bp / 100)
  const bp = (v: string) => Math.round(Number(v || 0) * 100)
  return (
    <div className="grid gap-5">
      <Section title="Provident Fund (PF)" description="EPF Act: 12% of basic from the employee and 12% from you. Applies to employees with PF turned on." action={<Switch checked={f.pf.enabled} disabled={!edit} onCheckedChange={(v) => setF({ ...f, pf: { ...f.pf, enabled: v } })} aria-label="PF on" />}>
        <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", !f.pf.enabled && "opacity-50")}>
          <Field label="Employee share"><NumberStepper decimals max={25} step={0.5} suffix="%" value={pct(f.pf.employeeBp)} disabled={!edit} onChange={(v) => setF({ ...f, pf: { ...f.pf, employeeBp: bp(v) } })} aria-label="Employee PF" /></Field>
          <Field label="Your share"><NumberStepper decimals max={25} step={0.5} suffix="%" value={pct(f.pf.employerBp)} disabled={!edit} onChange={(v) => setF({ ...f, pf: { ...f.pf, employerBp: bp(v) } })} aria-label="Employer PF" /></Field>
          <Field label="Wage cap"><MoneyInput value={f.pf.wageCapPaise} disabled={!edit || !f.pf.capped} onChange={(v) => setF({ ...f, pf: { ...f.pf, wageCapPaise: v ?? 0 } })} aria-label="PF wage cap" /></Field>
          <label className="flex items-center justify-between gap-2 self-end rounded-xl border px-3 py-2.5 text-sm"><span className="font-medium">Only up to the cap</span><Switch checked={f.pf.capped} disabled={!edit} onCheckedChange={(v) => setF({ ...f, pf: { ...f.pf, capped: v } })} aria-label="Cap PF wage" /></label>
        </div>
      </Section>
      <Section title="ESI" description="ESI Act: for employees whose gross pay is within the limit. Rounded up to the next rupee." action={<Switch checked={f.esi.enabled} disabled={!edit} onCheckedChange={(v) => setF({ ...f, esi: { ...f.esi, enabled: v } })} aria-label="ESI on" />}>
        <div className={cn("grid gap-4 sm:grid-cols-3", !f.esi.enabled && "opacity-50")}>
          <Field label="Employee share"><NumberStepper decimals max={10} step={0.25} suffix="%" value={pct(f.esi.employeeBp)} disabled={!edit} onChange={(v) => setF({ ...f, esi: { ...f.esi, employeeBp: bp(v) } })} aria-label="Employee ESI" /></Field>
          <Field label="Your share"><NumberStepper decimals max={10} step={0.25} suffix="%" value={pct(f.esi.employerBp)} disabled={!edit} onChange={(v) => setF({ ...f, esi: { ...f.esi, employerBp: bp(v) } })} aria-label="Employer ESI" /></Field>
          <Field label="For gross pay up to"><MoneyInput value={f.esi.grossLimitPaise} disabled={!edit} onChange={(v) => setF({ ...f, esi: { ...f.esi, grossLimitPaise: v ?? 0 } })} aria-label="ESI limit" /></Field>
        </div>
      </Section>
      <Section title="Professional Tax" description="Set by your state each month. Add your state's slabs: the highest slab below the gross pay applies." action={<Switch checked={f.pt.enabled} disabled={!edit} onCheckedChange={(v) => setF({ ...f, pt: { ...f.pt, enabled: v } })} aria-label="PT on" />}>
        <div className={cn("grid gap-4", !f.pt.enabled && "opacity-50")}>
          <Field label="State"><Input value={f.pt.state} maxLength={40} disabled={!edit} onChange={(e) => setF({ ...f, pt: { ...f.pt, state: e.target.value } })} placeholder="e.g. Maharashtra" className="max-w-xs" /></Field>
          <div className="grid gap-2">
            {f.pt.slabs.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label={i === 0 ? "Gross pay above" : ""}><MoneyInput value={s.abovePaise} disabled={!edit} onChange={(v) => setF({ ...f, pt: { ...f.pt, slabs: f.pt.slabs.map((x, j) => (j === i ? { ...x, abovePaise: v ?? 0 } : x)) } })} aria-label="Gross above" /></Field>
                <Field label={i === 0 ? "Tax a month" : ""}><MoneyInput value={s.amountPaise} disabled={!edit} onChange={(v) => setF({ ...f, pt: { ...f.pt, slabs: f.pt.slabs.map((x, j) => (j === i ? { ...x, amountPaise: v ?? 0 } : x)) } })} aria-label="Tax a month" /></Field>
                {edit && <Button variant="ghost" size="icon-sm" aria-label="Remove slab" onClick={() => setF({ ...f, pt: { ...f.pt, slabs: f.pt.slabs.filter((_, j) => j !== i) } })}><Trash2 /></Button>}
              </div>
            ))}
            {edit && <Button variant="outline" size="sm" className="w-fit" onClick={() => setF({ ...f, pt: { ...f.pt, slabs: [...f.pt.slabs, { abovePaise: 0, amountPaise: 0 }] } })}><Plus /> Add slab</Button>}
            <p className="text-xs text-muted-foreground">Example (Maharashtra): above {formatPaise(750_000)} → {formatPaise(17_500)}; above {formatPaise(1_000_000)} → {formatPaise(20_000)}.</p>
          </div>
        </div>
      </Section>
      {edit && <InlineSave dirty={JSON.stringify(f) !== JSON.stringify({ pf: cfg.pf, esi: cfg.esi, pt: cfg.pt })} onDiscard={() => setF({ pf: cfg.pf, esi: cfg.esi, pt: cfg.pt })} onSave={() => void save(f, "Payroll rules saved")} saveLabel="Save payroll rules" />}
    </div>
  )
}

function NameDialog({ title, kind, value, onClose, onSave }: { title: string; kind: "department" | "designation"; value?: { name: string; departmentId?: string | null; branchId?: string | null }; onClose: () => void; onSave: (v: { name: string; departmentId?: string | null; branchId?: string | null }) => Promise<void> }) {
  const branches = useSharedApi<{ data: { id: string; name: string }[] }>("/branches")
  const [name, setName] = React.useState(value?.name ?? "")
  const [departmentId, setDepartmentId] = React.useState(value?.departmentId ?? "")
  const [branchId, setBranchId] = React.useState(value?.branchId ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setError("Enter at least 2 letters")
    setBusy(true)
    try { await onSave({ name: name.trim(), ...(kind === "designation" ? { departmentId: departmentId || null } : { branchId: branchId || null }) }) } catch (err) { setError(err instanceof ApiError ? Object.values(err.fields)[0] ?? errorMessage(err) : errorMessage(err)); setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{kind === "designation" ? "A job title, tied to the department it belongs to." : "A team in the business, at one branch or all of them."}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Name" required><Input value={name} autoFocus maxLength={80} onChange={(e) => { setName(e.target.value); setError(null) }} placeholder={kind === "designation" ? "e.g. Store manager" : "e.g. Sales, Accounts, Warehouse"} /></Field>
          {kind === "designation" && <Field label="Department"><DepartmentSelect value={departmentId} onChange={setDepartmentId} aria-label="Department" /></Field>}
          {kind === "department" && <Field label="Branch" hint="Leave empty if it works across branches"><SearchSelect value={branchId} onChange={setBranchId} options={[{ value: "", label: "All branches" }, ...activeOr(branches.data?.data ?? [], branchId).map((b) => ({ value: b.id, label: b.name }))]} aria-label="Branch" /></Field>}
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Departments({ kind }: { kind: "departments" | "designations" }) {
  const { look, edit } = useConfig()
  const branches = useSharedApi<{ data: { id: string; name: string }[] }>("/branches")
  const [version, setVersion] = React.useState(0)
  const [editing, setEditing] = React.useState<Department | Designation | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<Department | Designation | null>(null)
  const dept = kind === "departments"
  const path = `/hr/${kind}`
  const reload = () => { setVersion((v) => v + 1); void look.reload() }
  const department = (id: string | null) => look.data?.departments.find((d) => d.id === id)
  const branchName = (id: string | null | undefined) => (id ? branches.data?.data.find((b) => b.id === id)?.name : undefined)
  const body = (r: Department | Designation, isActive: boolean) => ({ name: r.name, ...("departmentId" in r ? { departmentId: r.departmentId } : { branchId: (r as Department).branchId }), isActive })
  async function toggle(r: Department | Designation) {
    try { await api.put(`${path}/${r.id}`, body(r, !r.isActive)); toast.success(r.isActive ? "Marked inactive" : "Active again"); reload() } catch (e) { toast.error(errorMessage(e)) }
  }
  type Row = Department | Designation
  const columns: Column<Row>[] = [
    { key: "name", header: dept ? "Department" : "Designation", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}{!r.isActive && <Pill color="slate" className="ml-2">Inactive</Pill>}</span> },
    ...(!dept ? [{ key: "dept", header: "Department", csv: (r: Row) => department((r as Designation).departmentId)?.name ?? "", cell: (r: Row) => (department((r as Designation).departmentId) ? <Pill color="violet">{department((r as Designation).departmentId)!.name}</Pill> : <span className="text-muted-foreground">Any</span>) }] : []),
    { key: "branch", header: "Branch", csv: (r: Row) => branchName(dept ? (r as Department).branchId : department((r as Designation).departmentId)?.branchId) ?? "", cell: (r: Row) => { const b = branchName(dept ? (r as Department).branchId : department((r as Designation).departmentId)?.branchId); return b ? <Pill color="orange">{b}</Pill> : <span className="text-muted-foreground">All branches</span> } },
    { key: "emp", header: "Employees", align: "right", sort: (r) => r.employees, csv: (r) => r.employees, cell: (r) => r.employees },
    { key: "actions", header: "Actions", hideable: false, cell: (r) => edit ? <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil /></Button><ActionMenu label="More actions" items={[{ label: r.isActive ? "Mark inactive" : "Make active", icon: r.isActive ? X : Check, onClick: () => void toggle(r) }, dept && { label: "See employees", icon: Users, href: `/app/m/hr/employees?departmentId=${r.id}` }, "-", !r.employees && { label: "Delete", icon: Trash2, destructive: true, onClick: () => setDeleting(r) }]} /></span> : null },
  ]
  const add = edit ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setEditing("new")}><Plus /> Add {dept ? "department" : "designation"}</Button> : undefined
  return (
    <>
      <DataList<Row>
        id={`hr-${kind}`}
        load={localList(async () => (await api.get<{ data: Row[] }>(path)).data, (r, q) => r.name.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: dept ? "Departments" : "Designations", description: dept ? "Teams in the business, at a branch or all of them. Pick one for each employee." : "Job titles within each department. Promotions move people between them.", primary: add }}
        columns={columns}
        searchPlaceholder="Search"
        rowClick={(r) => edit && setEditing(r)}
        exportName={kind}
        emptyState={<EmptyState icon={Building2} title={`No ${kind} yet`} action={add} />}
      />
      {editing && <NameDialog title={editing === "new" ? `Add ${dept ? "department" : "designation"}` : `Edit ${editing.name}`} kind={dept ? "department" : "designation"} value={editing === "new" ? undefined : { name: editing.name, departmentId: "departmentId" in editing ? editing.departmentId : null, branchId: "branchId" in editing ? editing.branchId : null }} onClose={() => setEditing(null)}
        onSave={async (v) => { if (editing === "new") await api.post(path, v); else await api.put(`${path}/${editing.id}`, { ...v, isActive: editing.isActive }); toast.success("Saved"); setEditing(null); reload() }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting?.name}?`} confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`${path}/${deleting!.id}`); toast.success("Deleted"); reload() } catch (e) { toast.error(errorMessage(e)) } }} />
    </>
  )
}

interface Branch { id: string; name: string; code: string; stateCode: string | null; gstin: string | null; isDefault: boolean; isActive?: boolean }

function Branches() {
  const { can } = useAuth()
  const look = useHrLookups()
  const [version, setVersion] = React.useState(0)
  const [adding, setAdding] = React.useState(false)
  const [f, setF] = React.useState({ name: "", code: "" })
  const [error, setError] = React.useState<string | null>(null)
  const depts = look.data?.departments ?? []
  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (f.name.trim().length < 2) return setError("Enter the branch name")
    if (!/^[A-Za-z0-9-]{2,12}$/.test(f.code)) return setError("Code: 2–12 letters, digits or dashes")
    try {
      await api.post("/branches", { name: f.name.trim(), code: f.code.toUpperCase() })
      toast.success(`${f.name.trim()} added`)
      setAdding(false); setF({ name: "", code: "" }); setVersion((v) => v + 1)
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  const columns: Column<Branch>[] = [
    { key: "name", header: "Branch", hideable: false, sort: (b) => b.name, csv: (b) => b.name, cell: (b) => <span className="font-medium">{b.name}{b.isDefault && <Pill color="blue" className="ml-2">Main</Pill>}</span> },
    { key: "code", header: "Code", csv: (b) => b.code, cell: (b) => <span className="font-mono text-xs">{b.code}</span> },
    { key: "gstin", header: "GSTIN", csv: (b) => b.gstin ?? "", cell: (b) => (b.gstin ? <span className="font-mono text-xs">{b.gstin}</span> : "—") },
    { key: "depts", header: "Departments", align: "right", csv: (b) => depts.filter((d) => d.branchId === b.id).length, cell: (b) => depts.filter((d) => d.branchId === b.id).length },
    { key: "status", header: "Status", csv: (b) => (b.isActive === false ? "Inactive" : "Active"), cell: (b) => <Pill color={b.isActive === false ? "slate" : "emerald"} dot>{b.isActive === false ? "Inactive" : "Active"}</Pill> },
  ]
  const addBtn = can("tenant.branch.create") ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setAdding(true)}><Plus /> Add branch</Button> : undefined
  return (
    <>
      <DataList<Branch>
        id="hr-branches"
        load={localList(async () => (await api.get<{ data: Branch[] }>("/branches")).data, (b, q) => `${b.name} ${b.code}`.toLowerCase().includes(q), {
          filter: (b, p) => (p.show === "active" ? b.isActive !== false : p.show === "inactive" ? b.isActive === false : true),
          counts: (rows) => ({ all: rows.length, active: rows.filter((b) => b.isActive !== false).length, inactive: rows.filter((b) => b.isActive === false).length }),
        })}
        params={{ v: String(version) }}
        presetLabel="Show"
        presets={[{ key: "active", label: "Active", params: { show: "active" }, countKey: "active" }, { key: "inactive", label: "Inactive", params: { show: "inactive" }, countKey: "inactive" }, { key: "all", label: "All", params: {}, countKey: "all" }]}
        header={{ title: "Branches", description: "Your shops and offices. Departments and employees are placed at a branch. Edit, address, GSTIN and making a branch inactive are in Settings → Branches.", primary: addBtn, more: [{ label: "Manage branches in Settings", href: "/app/settings/branches" }] }}
        columns={columns}
        searchPlaceholder="Search branch"
        exportName="branches"
        emptyState={<EmptyState icon={Building2} title="No branches" action={addBtn} />}
      />
      {adding && (
        <Dialog open onOpenChange={(o) => !o && setAdding(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Add branch</DialogTitle><DialogDescription>Add its address and GSTIN later in Settings → Branches.</DialogDescription></DialogHeader>
            <form onSubmit={add} className="grid gap-4" noValidate>
              <Field label="Name" required><Input value={f.name} autoFocus maxLength={100} onChange={(e) => { setF({ ...f, name: e.target.value }); setError(null) }} placeholder="e.g. Aminabad shop" /></Field>
              <Field label="Short code" required hint="Shows on reports, e.g. AMN"><Input value={f.code} maxLength={12} onChange={(e) => { setF({ ...f, code: e.target.value.toUpperCase() }); setError(null) }} placeholder="AMN" className="font-mono uppercase" /></Field>
              <FormError message={error} />
              <DialogFooter><Button type="button" variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button type="submit">Add branch</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function DocumentTypes() {
  const { cfg, look, edit } = useConfig()
  const [editing, setEditing] = React.useState<DocumentType | "new" | null>(null)
  const [deleting, setDeleting] = React.useState<DocumentType | null>(null)
  const [f, setF] = React.useState({ name: "", description: "", required: false })
  const [error, setError] = React.useState<string | null>(null)
  if (!cfg) return <PageLoading />
  const all = cfg.documentTypes
  const put = async (next: DocumentType[], done: string) => { const ok = await saveHrConfig({ documentTypes: next }, done); if (ok) await look.reload(); return ok }
  const open = (row: DocumentType | "new") => { setEditing(row); setError(null); setF(row === "new" ? { name: "", description: "", required: false } : { name: row.name, description: row.description ?? "", required: row.required }) }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const name = f.name.trim()
    if (name.length < 2) return setError("Enter the document name")
    if (all.some((d) => d.name.toLowerCase() === name.toLowerCase() && (editing === "new" || d.id !== editing!.id))) return setError("Already in the list")
    const row: DocumentType = { id: editing === "new" ? crypto.randomUUID() : editing!.id, name, description: f.description.trim() || null, required: f.required }
    if (await put(editing === "new" ? [...all, row] : all.map((d) => (d.id === row.id ? row : d)), editing === "new" ? `${name} added` : "Saved")) setEditing(null)
  }
  return (
    <Section title="Document types" description="Papers each employee hands in. Required ones show as missing on the employee's profile until uploaded." action={edit ? <Button size="sm" onClick={() => open("new")}><Plus /> Add</Button> : undefined} flush>
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-5 py-2.5 text-left font-medium">Name</th><th className="px-5 py-2.5 text-left font-medium">Description</th><th className="px-5 py-2.5 text-left font-medium">Required</th><th className="w-24 px-5 py-2.5 text-right font-medium">Actions</th></tr></thead>
        <tbody className="divide-y">
          {all.map((d) => (
            <tr key={d.id} className="hover:bg-muted/30">
              <td className="px-5 py-2.5 font-medium">{d.name}</td>
              <td className="px-5 py-2.5 text-muted-foreground">{d.description || "—"}</td>
              <td className="px-5 py-2.5">{d.required ? <Pill color="rose">Required</Pill> : <Pill color="slate">Optional</Pill>}</td>
              <td className="px-5 py-1.5 text-right">{edit && <span className="inline-flex gap-0.5"><Button variant="ghost" size="icon-sm" aria-label={`Edit ${d.name}`} onClick={() => open(d)}><Pencil /></Button><Button variant="ghost" size="icon-sm" aria-label={`Delete ${d.name}`} onClick={() => setDeleting(d)}><Trash2 className="text-destructive" /></Button></span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>{editing === "new" ? "Add document type" : `Edit ${editing.name}`}</DialogTitle><DialogDescription>Picked when adding an employee&apos;s document.</DialogDescription></DialogHeader>
            <form onSubmit={save} className="grid gap-4" noValidate>
              <Field label="Name" required><Input value={f.name} autoFocus maxLength={60} onChange={(e) => { setF({ ...f, name: e.target.value }); setError(null) }} placeholder="e.g. Driving licence" /></Field>
              <Field label="Description"><Textarea rows={2} maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Optional: why it is needed" /></Field>
              <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm"><span><span className="font-medium">Required from everyone</span><span className="block text-xs text-muted-foreground">Missing ones are flagged on the profile</span></span><Switch checked={f.required} onCheckedChange={(v) => setF({ ...f, required: v })} aria-label="Required" /></label>
              <FormError message={error} />
              <DialogFooter><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit">Save</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title={`Delete ${deleting?.name}?`} description="Documents already uploaded keep the name." confirmLabel="Delete"
        onConfirm={async () => { await put(all.filter((d) => d.id !== deleting!.id), "Deleted") }} />
    </Section>
  )
}

type Key = "branches" | "departments" | "designations" | "documentTypes" | ListKey | "rules" | "payroll"
const MENU: { group: string; items: [Key, string, LucideIcon][] }[] = [
  { group: "Organisation", items: [["branches", "Branches", Building2], ["departments", "Departments", Network], ["designations", "Designations", Users]] },
  { group: "Documents", items: [["documentTypes", "Document Types", FileText], ["documentCategories", "Document Categories", FolderOpen]] },
  { group: "Types", items: [["awardTypes", "Award Types", Award], ["terminationTypes", "Termination Types", UserX], ["warningTypes", "Warning Types", ShieldAlert], ["complaintTypes", "Complaint Types", MessageSquareWarning], ["holidayTypes", "Holiday Types", CalendarDays], ["announcementCategories", "Announcement Categories", Megaphone], ["eventTypes", "Event Types", CalendarClock], ["allowanceTypes", "Allowance Types", BadgePlus], ["deductionTypes", "Deduction Types", BadgeMinus], ["loanTypes", "Loan Types", HandCoins]] },
  { group: "Rules", items: [["rules", "Working Days & IDs", Clock], ["payroll", "PF, ESI & PT", Landmark]] },
]

export default function HrSetupPage() {
  return <React.Suspense fallback={<PageLoading />}><Setup /></React.Suspense>
}

function Setup() {
  const search = useSearchParams()
  const router = useRouter()
  const { can } = useAuth()
  const look = useHrLookups()
  const all = MENU.flatMap((g) => g.items)
  const asked = search.get("tab") as Key | null
  const tab: Key = asked && all.some(([k]) => k === asked) ? asked : "branches"
  if (!can("hr.setup.view")) return <NoAccessPage title="HR setup" permission="hr.setup.view" />
  const label = all.find(([k]) => k === tab)?.[1] ?? ""
  const go = (k: Key) => router.replace(`/app/m/hr/setup?tab=${k}`, { scroll: false })
  return (
    <div className="grid gap-5">
      <PageHeader title="System setup" description="Branches, departments, designations, document types, every HR list, working days and payroll rules." />
      <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="ui-surface grid gap-3 p-2 lg:sticky lg:top-4" aria-label="Setup sections">
          <div className="lg:hidden"><SearchSelect value={tab} onChange={(v) => go(v as Key)} options={all.map(([k, l]) => ({ value: k, label: l }))} aria-label="Section" /></div>
          {MENU.map((g) => (
            <div key={g.group} className="hidden gap-0.5 lg:grid">
              <p className="px-3 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.group}</p>
              {g.items.map(([k, l, Icon]) => (
                <button key={k} type="button" onClick={() => go(k)} aria-current={tab === k ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", tab === k && "bg-primary/10 font-semibold text-primary hover:bg-primary/10 hover:text-primary")}>
                  <Icon className="size-4 shrink-0" />{l}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0">
          {look.error ? <ErrorState error={look.error} onRetry={() => void look.reload()} /> : <>
            {tab === "branches" && <Branches />}
            {tab === "departments" && <Departments kind="departments" />}
            {tab === "designations" && <Departments kind="designations" />}
            {tab === "documentTypes" && <DocumentTypes />}
            {tab === "rules" && <Rules />}
            {tab === "payroll" && <Payroll />}
            {!["branches", "departments", "designations", "documentTypes", "rules", "payroll"].includes(tab) && <ListEditor key={tab} list={tab as ListKey} title={label} />}
          </>}
        </div>
      </div>
    </div>
  )
}
