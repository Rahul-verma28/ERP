"use client"

import * as React from "react"
import { toast } from "sonner"
import { Copy, KeyRound, Pencil, UserCheck, UserPlus, UserX, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import Link from "next/link"
import { Chip, Failed, Loading, Page, Stat, StatGrid, ago } from "@/components/console/kit"
import { Count, DataTable, FilterSelect, IdCell, type Column, type RowAction } from "@/components/console/data-table"
import { LoginLinkBox, type LoginLink } from "@/components/console/login-link"
import { useClientTable } from "@/lib/use-table"
import { formatDate } from "@/lib/format"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import type { ConsoleMember, ConsoleRole } from "@/lib/console"

// People (Console v3): AHEAD's team, salespeople and vendors, or a partner's own staff. A new
// person gets a login link and sets their own password. Edits save at once; only turning
// someone off asks first, because it signs them out.

type Patch = { roleKey?: string; reportsTo?: string | null; status?: "active" | "deactivated" }

function AddDialog({ open, onOpenChange, roles, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; roles: ConsoleRole[]; onSaved: () => void }) {
  const first = roles[roles.length - 1]?.key ?? ""
  const [form, setForm] = React.useState({ email: "", name: "", mobile: "", roleKey: first, reportsTo: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [added, setAdded] = React.useState<{ name: string; mobile: string; link: LoginLink } | null>(null)
  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setAdded(null)
      setForm({ email: "", name: "", mobile: "", roleKey: first, reportsTo: "" })
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const r = await api.post<{ newUser: boolean; loginLink: LoginLink }>("/console/members", { email: form.email, name: form.name || undefined, mobile: form.mobile || undefined, roleKey: form.roleKey || first })
      setAdded({ name: form.name || form.email, mobile: form.mobile, link: r.loginLink })
      onSaved()
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...err.fields, form: errorMessage(err) } : { form: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  if (added)
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{added.name} is added</DialogTitle>
            <DialogDescription>We sent them a login link by SMS and email. You can also share it yourself.</DialogDescription>
          </DialogHeader>
          <LoginLinkBox link={added.link} mobile={added.mobile || undefined} message="Join the AHEAD Console here:" />
          <DialogFooter>
            <Button type="button" onClick={() => close(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a person</DialogTitle>
            <DialogDescription>They get a login link by SMS and email and choose their own password. Someone who already has an AHEAD account is found by email.</DialogDescription>
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
            <Field label="Role" error={errors.roleKey} className="sm:col-span-2">
              <NativeSelect value={form.roleKey || first} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
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

function EditDialog({ member, self, roles, onClose, onSave }: { member: ConsoleMember; self: boolean; roles: ConsoleRole[]; onClose: () => void; onSave: (body: Patch) => Promise<boolean> }) {
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
            const body: Patch = self ? {} : { roleKey: form.roleKey !== member.role.key ? form.roleKey : undefined, status: form.status !== member.status ? form.status : undefined }
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
  const [roleFilter, setRoleFilter] = React.useState("")
  const [turnOff, setTurnOff] = React.useState<{ member: ConsoleMember; body: Patch; resolve: (ok: boolean) => void } | null>(null)
  const partner = me?.console?.audience === "partner"
  const canEdit = canConsole("platform.member.edit")
  const isSuper = me?.console?.role.key === "super_admin"
  const [statusFilter, setStatusFilter] = React.useState("")
  const [linkFor, setLinkFor] = React.useState<ConsoleMember | null>(null)
  const filtered = React.useMemo(
    () => members.data?.data.filter((m) => (!roleFilter || m.role.key === roleFilter) && (!statusFilter || (statusFilter === "active" ? m.status === "active" : m.status !== "active"))) ?? null,
    [members.data, roleFilter, statusFilter],
  )
  const table = useClientTable(filtered, {
    name: (m) => m.user.name, email: (m) => m.user.email, mobile: (m) => m.user.mobile, role: (m) => m.role.name,
    status: (m) => m.status, mfa: (m) => (m.user.mfaEnabled ? 1 : 0), lastLogin: (m) => m.user.lastLoginAt ?? "", joined: (m) => m.joinedAt,
  })
  const columns: Column<ConsoleMember>[] = [
    { key: "id", header: "ID", cell: (m) => <IdCell id={m.id} /> },
    {
      key: "name", header: "Name", always: true, sortable: true,
      cell: (m) => (
        <span className="flex items-center gap-2 font-medium">
          {m.user.name}
          {m.user.id === me?.user.id && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
        </span>
      ),
    },
    { key: "role", header: "Role", sortable: true, cell: (m) => (partner ? <Chip tone="blue">{m.role.name}</Chip> : <Link href={`/console/roles/${m.role.id}`} onClick={(e) => e.stopPropagation()}><Chip tone="blue">{m.role.name}</Chip></Link>) },
    { key: "email", header: "Email", sortable: true, cell: (m) => m.user.email },
    { key: "mobile", header: "Phone", cell: (m) => <span className="tabular-nums">{m.user.mobile.replace(/^[+]91/, "+91 ")}</span> },
    { key: "reportsTo", header: "Reports to", hidden: partner, cell: (m) => m.reportsTo?.name ?? "—" },
    { key: "mfa", header: "Two-step", sortable: true, cell: (m) => (m.user.mfaEnabled ? <Chip tone="green">On</Chip> : <Chip tone="amber">Off</Chip>) },
    { key: "lastLogin", header: "Last signed in", sortable: true, cell: (m) => <span className="text-muted-foreground">{m.user.lastLoginAt ? ago(m.user.lastLoginAt) : "Not yet"}</span> },
    { key: "joined", header: "Added", sortable: true, cell: (m) => <span className="text-muted-foreground">{formatDate(m.joinedAt)}</span> },
    { key: "status", header: "Status", sortable: true, cell: (m) => (m.status === "active" ? <Chip tone="green">Active</Chip> : <Chip tone="red">Turned off</Chip>) },
  ]
  const actions = (m: ConsoleMember): RowAction[] => {
    const self = m.user.id === me?.user.id
    const locked = !canEdit || (m.role.key === "super_admin" && !isSuper)
    return [
      { label: "Edit role and access", icon: Pencil, onClick: () => setEditing(m), hidden: locked },
      { label: "Send new login link", icon: KeyRound, onClick: () => setLinkFor(m), hidden: m.status !== "active" || !canConsole("platform.member.create") },
      { label: "Turn off", icon: UserX, danger: true, separator: true, onClick: () => void save(m, { status: "deactivated" }), hidden: locked || self || m.status !== "active" },
      { label: "Turn back on", icon: UserCheck, separator: true, onClick: () => void save(m, { status: "active" }), hidden: locked || m.status === "active" },
      { label: "Copy email", icon: Copy, separator: true, onClick: () => navigator.clipboard.writeText(m.user.email).then(() => toast.success("Email copied")) },
    ]
  }

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
  const everyone = members.data.data
  const active = everyone.filter((m) => m.status === "active")
  const assignable = roles.data.data.filter((r) => r.key !== "super_admin" || isSuper)

  return (
    <Page
      wide
      eyebrow={partner ? "People" : "People & access"}
      title={partner ? "Team" : "People"}
      subtitle={partner ? `People at ${me?.console?.partner?.name} who use this panel.` : "AHEAD's team, salespeople and vendors. Each role decides what that person can do."}
      actions={
        canConsole("platform.member.create") && (
          <Button onClick={() => setOpen(true)}>
            <UserPlus /> Add person
          </Button>
        )
      }
    >
      <StatGrid>
        <Stat label="People" value={active.length} hint={everyone.length > active.length ? `${everyone.length - active.length} turned off` : "All active"} />
        <Stat label="Two-step on" value={`${active.filter((m) => m.user.mfaEnabled).length} / ${active.length}`} hint="Required for Console users" tone={active.some((m) => !m.user.mfaEnabled) ? "warn" : undefined} />
        <Stat label="Never signed in" value={active.filter((m) => !m.user.lastLoginAt).length} hint="Send them a new login link" />
        <Stat label="Roles in use" value={new Set(active.map((m) => m.role.key)).size} hint={partner ? undefined : "See Roles & permissions"} href={partner ? undefined : "/console/roles"} />
      </StatGrid>

      <DataTable
        id="team"
        label="People"
        table={table}
        columns={columns}
        actions={actions}
        searchFields={[{ key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "mobile", label: "Phone" }, { key: "role", label: "Role" }]}
        summary={<><Count tone="green" n={active.length} label="Active" /><Count tone="red" n={everyone.length - active.length} label="Turned off" /></>}
        filters={
          <>
            <FilterSelect value={roleFilter} onChange={setRoleFilter} label="Role" options={[["", "Any role"], ...roles.data.data.filter((r) => everyone.some((m) => m.role.key === r.key)).map((r) => [r.key, r.name] as [string, string])]} />
            <FilterSelect value={statusFilter} onChange={setStatusFilter} label="Access" options={[["", "Any access"], ["active", "Can sign in"], ["deactivated", "Turned off"]]} />
          </>
        }
        empty={<span className="inline-flex items-center gap-2"><Users className="size-4" /> Nobody here yet</span>}
      />

      <AddDialog open={open} onOpenChange={setOpen} roles={assignable} onSaved={members.reload} />
      {editing && <EditDialog member={editing} self={editing.user.id === me?.user.id} roles={assignable} onClose={() => setEditing(null)} onSave={(body) => save(editing, body)} />}
      {linkFor && <NewLinkDialog member={linkFor} onClose={() => setLinkFor(null)} />}
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

/** Sends a fresh login link (the old one stops working) and shows it to copy or share. */
function NewLinkDialog({ member, onClose }: { member: ConsoleMember; onClose: () => void }) {
  const [link, setLink] = React.useState<LoginLink | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function send() {
    setBusy(true)
    try {
      setLink(await api.post<LoginLink>(`/console/members/${member.id}/login-link`))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{link ? "New login link sent" : `Send ${member.user.name} a new login link?`}</DialogTitle>
          <DialogDescription>{link ? "We sent it by SMS and email. You can also copy it or send it on WhatsApp." : "Their old link stops working. They verify their mobile and set their own password."}</DialogDescription>
        </DialogHeader>
        {link && <LoginLinkBox link={link} mobile={member.user.mobile} message="Your AHEAD Console login:" />}
        <DialogFooter>
          {link ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={send} disabled={busy}>{busy ? "Sending…" : "Send link"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
