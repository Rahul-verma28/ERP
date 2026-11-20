"use client"

import * as React from "react"
import { toast } from "sonner"
import { Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FormError, NativeSelect } from "@/components/form"
import { FormSection } from "@/components/tasks/forms"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import type { Role } from "@/lib/types"

// Users forms: invite someone (role and branches), and change a person's role or branches. Each
// checks its fields before sending and shows the API's errors where they belong.

export function useAssignableRoles() {
  const { can, term } = useAuth()
  const roles = useApi<{ data: Role[] }>(can("tenant.role.view") ? "/roles" : null)
  const name = (r: { key: string; name: string }) => (r.key === "service_provider" ? term("role.service_provider", r.name) : r.name)
  return { roles: (roles.data?.data ?? []).filter((r) => r.key !== "owner"), name }
}

/** Which branches a person works in: all of them, or the ones ticked */
function BranchPicker({ branches, value, onChange, error }: { branches: { id: string; name: string }[]; value: string[] | null; onChange: (v: string[] | null) => void; error?: string }) {
  if (branches.length < 2) return <p className="text-xs text-muted-foreground sm:col-span-2">One branch, so everyone works in it.</p>
  return (
    <div className="grid gap-2 sm:col-span-2">
      <div className="flex rounded-xl border p-1 text-sm" role="radiogroup" aria-label="Branches">
        {([[null, "All branches"], [[], "Only some"]] as const).map(([v, l]) => <button key={l} type="button" role="radio" aria-checked={(value === null) === (v === null)} onClick={() => onChange(v === null ? null : value ?? [])} className={`flex-1 rounded-lg px-3 py-1.5 font-medium ${(value === null) === (v === null) ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{l}</button>)}
      </div>
      {value !== null && (
        <div className="flex flex-wrap gap-3">
          {branches.map((b) => <label key={b.id} className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={value.includes(b.id)} onChange={(e) => onChange(e.target.checked ? [...value, b.id] : value.filter((x) => x !== b.id))} />{b.name}</label>)}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">With &quot;Their branches&quot; access in the role, they see only these branches&apos; bills, stock and people.</p>
    </div>
  )
}

/** `employee`: giving an HR employee their login; it links to them when they accept, as Employee (Self-service) unless changed */
export function InviteDialog({ branches, employee, onClose, onSaved }: { branches: { id: string; name: string }[]; employee?: { id: string; name: string; email: string | null; mobile: string | null }; onClose: () => void; onSaved: () => void }) {
  const { roles, name } = useAssignableRoles()
  const [f, setF] = React.useState({ name: employee?.name ?? "", email: employee?.email ?? "", mobile: employee?.mobile ?? "", roleId: "" })
  // From an employee page, start on the free self-service role once the roles arrive
  const selfService = roles.find((r) => r.key === "employee")?.id
  const roleId = f.roleId || (employee && selfService) || ""
  const [branchIds, setBranchIds] = React.useState<string[] | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [link, setLink] = React.useState<string | null>(null)
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setError(null) }
  const role = roles.find((r) => r.id === roleId)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (f.name.trim() && f.name.trim().length < 2) x.name = "At least 2 letters"
    if (!f.email && !f.mobile) x.email = "Give an email or a mobile number so the invitation reaches them"
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) x.email = "Enter a valid email"
    if (f.mobile && f.mobile.replace(/\D/g, "").length < 10) x.mobile = "Enter a 10-digit mobile number"
    if (!roleId) x.roleId = "Choose what they will do"
    if (branchIds !== null && !branchIds.length) x.branchIds = "Tick at least one branch, or choose All branches"
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      const r = await api.post<{ inviteLink?: string }>("/invitations", { name: f.name.trim() || undefined, email: f.email.trim() || undefined, mobile: f.mobile || undefined, roleId, branchIds: branchIds ?? [], employeeId: employee?.id })
      toast.success("Invitation sent")
      if (r.inviteLink) setLink(r.inviteLink)
      else onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && (link ? onSaved() : onClose())}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{employee ? `App login for ${employee.name}` : "Invite a user"}</DialogTitle><DialogDescription>{employee ? "They get a link by email or SMS to set a password. Once they join, the login is linked to their employee record, so they can clock in, apply for leave and see payslips." : "They get a link by email or SMS to set their password and join. It works for 7 days."}</DialogDescription></DialogHeader>
        {link ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">Invitation made. While testing, messages are not really sent, so share this link with them:</p>
            <div className="flex gap-2"><Input readOnly value={link} aria-label="Invitation link" /><Button variant="outline" size="icon" aria-label="Copy link" onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success("Link copied"))}><Copy /></Button></div>
            <DialogFooter><Button onClick={onSaved}>Done</Button></DialogFooter>
          </div>
        ) : (
          <form onSubmit={save} className="grid gap-4" noValidate>
            <FormSection title="Who">
              <Field label="Name" error={errors.name} className="sm:col-span-2" hint="They can change it when they join"><Input value={f.name} maxLength={100} autoFocus onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Email" error={errors.email}><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
              <Field label="Mobile" error={errors.mobile}><Input mask="mobile" value={f.mobile} onChange={(e) => set("mobile", e.target.value)} /></Field>
            </FormSection>
            <FormSection title="Access">
              <Field label="Role" required error={errors.roleId} className="sm:col-span-2" hint={role ? `${role.description ?? ""}${role.roleType === "employee" ? " · Free: doesn't use a paid seat" : ""}` : "Employee (Self-service) logins are free; other roles use a seat on your plan"}>
                <NativeSelect value={roleId} onChange={(e) => set("roleId", e.target.value)}><option value="" disabled>Choose a role</option>{roles.map((r) => <option key={r.id} value={r.id}>{name(r)}{r.isPredefined ? "" : " (custom)"}</option>)}</NativeSelect>
              </Field>
              <BranchPicker branches={branches} value={branchIds} onChange={(v) => { setBranchIds(v); setErrors((e) => ({ ...e, branchIds: "" })) }} error={errors.branchIds} />
            </FormSection>
            <FormError message={error} />
            <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Change a person's role or branches, with what changes said plainly */
export function AccessDialog({ member, branches, onClose, onSaved }: { member: { id: string; name: string; version: number; role: { id: string; name: string }; branches: { id: string }[] }; branches: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { roles, name } = useAssignableRoles()
  const [roleId, setRoleId] = React.useState(member.role.id)
  const [branchIds, setBranchIds] = React.useState<string[] | null>(member.branches.length ? member.branches.map((b) => b.id) : null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const role = roles.find((r) => r.id === roleId)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (branchIds !== null && !branchIds.length) return setErrors({ branchIds: "Tick at least one branch, or choose All branches" })
    setBusy(true)
    try {
      await api.patch(`/members/${member.id}`, { roleId: roleId !== member.role.id ? roleId : undefined, branchIds: branchIds ?? [], version: member.version })
      toast.success(`${member.name}'s access saved`)
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
        <DialogHeader><DialogTitle>Access for {member.name}</DialogTitle><DialogDescription>A new role works from their next click. They get a notification about it.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <Field label="Role" required error={errors.roleId} hint={role?.description ?? undefined}>
            <NativeSelect value={roleId} onChange={(e) => setRoleId(e.target.value)}>{!roles.some((r) => r.id === member.role.id) && <option value={member.role.id}>{member.role.name}</option>}{roles.map((r) => <option key={r.id} value={r.id}>{name(r)}{r.isPredefined ? "" : " (custom)"}</option>)}</NativeSelect>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2"><BranchPicker branches={branches} value={branchIds} onChange={(v) => { setBranchIds(v); setErrors({}) }} error={errors.branchIds} /></div>
          <FormError message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save access"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
