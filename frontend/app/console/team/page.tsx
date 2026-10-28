"use client"

import * as React from "react"
import { toast } from "sonner"
import { Pencil, UserPlus, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { Chip, Empty, Failed, Loading, Page, Panel, ago } from "@/components/console/kit"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import type { ConsoleMember, ConsoleRole } from "@/lib/console"

// Team: the people who use this Console — AHEAD's team and vendors, or a partner's own staff.
// Edits save at once; only deactivating someone asks first, because it signs them out.

type Patch = { roleKey?: string; reportsTo?: string | null; status?: "active" | "deactivated" }

function AddDialog({ open, onOpenChange, roles, members, partner, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; roles: ConsoleRole[]; members: ConsoleMember[]; partner: boolean; onSaved: () => void }) {
  const first = roles[roles.length - 1]?.key ?? ""
  const [form, setForm] = React.useState({ email: "", name: "", mobile: "", roleKey: first, reportsTo: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const r = await api.post<{ newUser: boolean }>("/console/members", { email: form.email, name: form.name || undefined, mobile: form.mobile || undefined, roleKey: form.roleKey || first, reportsTo: form.reportsTo || null })
      toast.success(r.newUser ? "Added — they sign in with their mobile (one-time code)" : "Added")
      onOpenChange(false)
      setForm({ email: "", name: "", mobile: "", roleKey: first, reportsTo: "" })
      onSaved()
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...err.fields, form: errorMessage(err) } : { form: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a person</DialogTitle>
            <DialogDescription>Someone who already has an AHEAD account is added by email. For someone new, add their name and mobile too.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" required error={errors.email} className="sm:col-span-2">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoFocus />
            </Field>
            <Field label="Name" error={errors.name}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Mobile" error={errors.mobile}>
              <Input inputMode="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="98765 43210" />
            </Field>
            <Field label="Role" error={errors.roleKey} className={partner ? "sm:col-span-2" : undefined}>
              <NativeSelect value={form.roleKey || first} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {!partner && (
              <Field label="Reports to" hint="A Sales Manager sees their team's clients" error={errors.reportsTo}>
                <NativeSelect value={form.reportsTo} onChange={(e) => setForm({ ...form, reportsTo: e.target.value })}>
                  <option value="">Nobody</option>
                  {members.filter((m) => m.status === "active").map((m) => (
                    <option key={m.id} value={m.user.id}>
                      {m.user.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>
          <p className="text-[13px] text-muted-foreground">{roles.find((r) => r.key === (form.roleKey || first))?.description}</p>
          <FormError message={errors.form} />
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add person"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({ member, self, roles, members, partner, onClose, onSave }: { member: ConsoleMember; self: boolean; roles: ConsoleRole[]; members: ConsoleMember[]; partner: boolean; onClose: () => void; onSave: (body: Patch) => Promise<boolean> }) {
  const [form, setForm] = React.useState({ roleKey: member.role.key, reportsTo: member.reportsTo?.userId ?? "", status: (member.status === "deactivated" ? "deactivated" : "active") as "active" | "deactivated" })
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            const body: Patch = { ...(self ? {} : { roleKey: form.roleKey !== member.role.key ? form.roleKey : undefined, status: form.status !== member.status ? form.status : undefined }), ...(partner ? {} : { reportsTo: form.reportsTo || null }) }
            if (await onSave(body)) onClose()
            setBusy(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>{member.user.name}</DialogTitle>
            <DialogDescription>{self ? "Someone else changes your own role or status." : member.user.email}</DialogDescription>
          </DialogHeader>
          <Field label="Role">
            <NativeSelect value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })} disabled={self}>
              {roles.some((r) => r.key === member.role.key) ? null : <option value={member.role.key}>{member.role.name}</option>}
              {roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {!partner && (
            <Field label="Reports to">
              <NativeSelect value={form.reportsTo} onChange={(e) => setForm({ ...form, reportsTo: e.target.value })}>
                <option value="">Nobody</option>
                {members.filter((o) => o.id !== member.id && o.status === "active").map((o) => (
                  <option key={o.id} value={o.user.id}>
                    {o.user.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {!self && (
            <Field label="Access">
              <NativeSelect value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "active" | "deactivated" })}>
                <option value="active">Can sign in</option>
                <option value="deactivated">Turned off — signs them out</option>
              </NativeSelect>
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function TeamPage() {
  const { me, canConsole } = useAuth()
  const members = useApi<{ data: ConsoleMember[] }>("/console/members")
  const roles = useApi<{ data: ConsoleRole[] }>("/console/roles")
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ConsoleMember | null>(null)
  const [turnOff, setTurnOff] = React.useState<{ member: ConsoleMember; body: Patch; resolve: (ok: boolean) => void } | null>(null)
  const partner = me?.console?.audience === "partner"
  const canEdit = canConsole("platform.member.edit")
  const isSuper = me?.console?.role.key === "super_admin"

  async function send(m: ConsoleMember, body: Patch) {
    try {
      await api.patch(`/console/members/${m.id}`, body)
      toast.success("Saved")
      await members.reload()
      return true
    } catch (err) {
      toast.error(errorMessage(err))
      return false
    }
  }

  // Turning someone off signs them out at once, so that one change asks first
  const save = (m: ConsoleMember, body: Patch) =>
    body.status === "deactivated" ? new Promise<boolean>((resolve) => setTurnOff({ member: m, body, resolve })) : send(m, body)

  if (members.error) return <Failed error={members.error} onRetry={members.reload} />
  if (!members.data || !roles.data) return <Loading rows={5} className="mx-auto max-w-6xl" />
  const all = members.data.data
  const assignable = roles.data.data.filter((r) => r.key !== "super_admin" || isSuper)

  return (
    <Page
      title="Team"
      subtitle={partner ? `People at ${me?.console?.partner?.name} who use this panel.` : "AHEAD's team and vendors. Each role decides what that person can do."}
      back={partner ? undefined : { href: "/console/settings", label: "Settings" }}
      actions={
        canConsole("platform.member.create") && (
          <Button onClick={() => setOpen(true)}>
            <UserPlus /> Add person
          </Button>
        )
      }
    >
      <Panel padded={false}>
        {!all.length ? (
          <Empty icon={Users} title="Nobody here yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Person</th>
                  <th className="px-3 py-3 font-medium">Role</th>
                  {!partner && <th className="px-3 py-3 font-medium">Reports to</th>}
                  <th className="px-3 py-3 font-medium">Last signed in</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {all.map((m) => {
                  const self = m.user.id === me?.user.id
                  const locked = !canEdit || (m.role.key === "super_admin" && !isSuper)
                  return (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2 font-medium">
                          {m.user.name}
                          {self && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                          {m.status !== "active" && <Chip tone="grey">Turned off</Chip>}
                        </div>
                        <div className="text-[13px] text-muted-foreground">{m.user.email}</div>
                      </td>
                      <td className="px-3 py-3.5">{m.role.name}</td>
                      {!partner && <td className="px-3 py-3.5 text-muted-foreground">{m.reportsTo?.name ?? "—"}</td>}
                      <td className="px-3 py-3.5 text-muted-foreground">{ago(m.user.lastLoginAt)}</td>
                      <td className="px-5 py-3.5 text-right">
                        {!locked && (
                          <Button size="sm" variant="ghost" onClick={() => setEditing(m)} aria-label={`Edit ${m.user.name}`}>
                            <Pencil /> Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="What each role can do">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.data.data.map((r) => (
            <div key={r.key} className="rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{r.name}</span>
                <span className="text-xs text-muted-foreground">{r.members} active</span>
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">{r.description}</p>
            </div>
          ))}
        </div>
      </Panel>

      <AddDialog open={open} onOpenChange={setOpen} roles={assignable} members={all} partner={partner} onSaved={members.reload} />
      {editing && <EditDialog member={editing} self={editing.user.id === me?.user.id} roles={assignable} members={all} partner={partner} onClose={() => setEditing(null)} onSave={(body) => save(editing, body)} />}
      <ConfirmDialog
        open={!!turnOff}
        onOpenChange={(o) => {
          if (!o && turnOff) {
            turnOff.resolve(false)
            setTurnOff(null)
          }
        }}
        title={`Turn off ${turnOff?.member.user.name ?? ""}?`}
        description="They are signed out now and can't sign in to this Console until someone turns them back on."
        confirmLabel="Turn off"
        destructive
        onConfirm={async () => {
          if (!turnOff) return
          const ok = await send(turnOff.member, turnOff.body)
          turnOff.resolve(ok)
          setTurnOff(null)
        }}
      />
    </Page>
  )
}
