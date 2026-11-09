"use client"

import * as React from "react"
import { toast } from "sonner"
import { Copy, MoreHorizontal, UserPlus, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/common"
import { DataList, localList } from "@/components/data-list"
import { Field, FormError, NativeSelect } from "@/components/form"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate } from "@/lib/format"
import type { Role } from "@/lib/types"

interface Members {
  members: {
    id: string
    status: "invited" | "active" | "deactivated"
    version: number
    joinedAt: string | null
    user: { id: string; name: string; email: string; mobile: string; lastLoginAt: string | null; mfaEnabled: boolean }
    role: { id: string; key: string; name: string }
  }[]
  invitations: { id: string; name: string | null; email: string | null; mobile: string | null; roleId: string; expiresAt: string; expired: boolean }[]
}

type Member = Members["members"][number]

export default function TeamPage() {
  const { me, can, term } = useAuth()
  const members = useApi<Members>("/members")
  const roles = useApi<{ data: Role[] }>(can("tenant.role.view") ? "/roles" : null)
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState({ name: "", email: "", mobile: "", roleId: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [link, setLink] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)
  const [resetFor, setResetFor] = React.useState<Members["members"][number] | null>(null)

  const assignable = (roles.data?.data ?? []).filter((r) => r.key !== "owner")
  const roleName = (r: { key: string; name: string }) => (r.key === "service_provider" ? term("role.service_provider", r.name) : r.name)
  const activeCount = members.data?.members.filter((m) => m.status === "active").length ?? 0
  const pending = members.data?.invitations.filter((i) => !i.expired).length ?? 0

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      const r = await api.post<{ inviteLink?: string }>("/invitations", {
        name: form.name || undefined,
        email: form.email || undefined,
        mobile: form.mobile || undefined,
        roleId: form.roleId,
      })
      toast.success("Invitation sent")
      setLink(r.inviteLink ?? null)
      setForm({ name: "", email: "", mobile: "", roleId: "" })
      await members.reload()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function patchMember(m: Members["members"][number], patch: Record<string, unknown>) {
    try {
      await api.patch(`/members/${m.id}`, { ...patch, version: m.version })
      toast.success("User updated")
      await members.reload()
      setVersion((v) => v + 1)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function revoke(id: string) {
    try {
      await api.delete(`/invitations/${id}`)
      toast.success("Invitation revoked")
      await members.reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="grid gap-6">
      <DataList<Member>
        id="users"
        load={localList(async () => (await api.get<Members>("/members")).members, (m, q) => `${m.user.name} ${m.user.email} ${m.user.mobile}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{
          title: "Manage Users",
          description: members.data ? `Everyone who works in this business. ${activeCount + pending} of ${me?.limits?.users} users on your plan.` : "Everyone who works in this business.",
          primary: can("tenant.member.create") ? <Button onClick={() => { setLink(null); setOpen(true) }}><UserPlus /> Invite user</Button> : undefined,
        }}
        columns={[
          { key: "user", header: "User", hideable: false, sort: (m) => m.user.name, cell: (m) => <span><span className="block font-medium">{m.user.name}</span><span className="text-xs text-muted-foreground">{m.user.email}</span></span> },
          { key: "mobile", header: "Mobile", cell: (m) => <span className="text-sm tabular-nums">{m.user.mobile || "—"}</span> },
          {
            key: "role", header: "Role",
            cell: (m) => can("tenant.member.edit") && m.role.key !== "owner" && m.user.id !== me?.user.id && assignable.length ? (
              <NativeSelect className="h-8 w-48" value={m.role.id} onChange={(e) => patchMember(m, { roleId: e.target.value })} aria-label={`Role for ${m.user.name}`}>
                {!assignable.some((r) => r.id === m.role.id) && <option value={m.role.id}>{roleName(m.role)}</option>}
                {assignable.map((r) => <option key={r.id} value={r.id}>{roleName(r)}</option>)}
              </NativeSelect>
            ) : roleName(m.role),
          },
          { key: "status", header: "Login status", cell: (m) => <span className="flex flex-wrap gap-1"><Badge variant={m.status === "active" ? "secondary" : "outline"}>{m.status === "active" ? "Enabled" : m.status === "deactivated" ? "Disabled" : "Invited"}</Badge>{m.user.mfaEnabled && <Badge variant="outline" title="Two-step verification is on">Two-step</Badge>}</span> },
          { key: "last", header: "Last sign-in", cell: (m) => <span className="text-sm text-muted-foreground">{m.user.lastLoginAt ? formatDate(m.user.lastLoginAt) : "Never"}</span> },
          {
            key: "actions", header: "Actions", hideable: false,
            cell: (m) => can("tenant.member.edit") && m.role.key !== "owner" && m.user.id !== me?.user.id ? (
              <DropdownMenu>
                <DropdownMenuTrigger className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={`Actions for ${m.user.name}`}><MoreHorizontal /></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {m.status === "active" ? <DropdownMenuItem onClick={() => patchMember(m, { status: "deactivated" })}>Disable login</DropdownMenuItem> : <DropdownMenuItem onClick={() => patchMember(m, { status: "active" })}>Enable login</DropdownMenuItem>}
                  {m.user.mfaEnabled && <DropdownMenuItem onClick={() => setResetFor(m)}>Reset two-step…</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null,
          },
        ]}
        searchPlaceholder="Search name, email or mobile"
        emptyState={<EmptyState icon={Users} title="No users yet" />}
      />

      {!!members.data?.invitations.length && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending invitations</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {members.data.invitations.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{i.name || i.email || i.mobile}</span>{" "}
                  <span className="text-muted-foreground">
                    · {assignable.find((r) => r.id === i.roleId)?.name ?? "Role"} · {i.expired ? "expired" : `expires ${formatDate(i.expiresAt)}`}
                  </span>
                </span>
                {can("tenant.member.create") && (
                  <Button variant="ghost" size="sm" onClick={() => revoke(i.id)}>
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a user</DialogTitle>
            <DialogDescription>They get a link by email and SMS. Invitations expire in 7 days.</DialogDescription>
          </DialogHeader>
          {link ? (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">Invitation created. In development, messages are printed in the API log — you can also share this link directly:</p>
              <div className="flex gap-2">
                <Input readOnly value={link} aria-label="Invitation link" />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy link"
                  onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Link copied"))}
                >
                  <Copy />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={invite} className="grid gap-4">
              <Field label="Name (optional)">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email" error={errors.email}>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
                <Field label="Mobile" error={errors.mobile}>
                  <Input mask="mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
                </Field>
              </div>
              <Field label="Role" error={errors.roleId} hint="Module roles appear when their module is in your plan">
                <NativeSelect value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} required>
                  <option value="" disabled>
                    Choose a role
                  </option>
                  {assignable.map((r) => (
                    <option key={r.id} value={r.id}>
                      {roleName(r)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <FormError message={error} />
              <DialogFooter>
                <Button type="submit" disabled={busy}>
                  {busy ? "Sending…" : "Send invitation"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <ResetTwoStepDialog member={resetFor} onClose={() => setResetFor(null)} />
    </div>
  )
}

/** Lost phone, no backup codes: an Owner/Admin resets two-step (A4-C). Audited and emailed to the person. */
function ResetTwoStepDialog({ member, onClose }: { member: Members["members"][number] | null; onClose: () => void }) {
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const submit = async () => {
    const r = reason.trim()
    if (r.length < 10 || r.length > 500) return setError("Give a reason of 10–500 characters")
    setBusy(true)
    try {
      await api.post(`/members/${member!.id}/mfa-reset`, { reason: r })
      toast.success(`Two-step reset for ${member!.user.name}. They'll set it up again at their next sign-in.`)
      setReason("")
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && (setError(null), onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset two-step for {member?.user.name}?</DialogTitle>
          <DialogDescription>Use this when they lost their phone and their backup codes. They&apos;ll set two-step up again at their next sign-in. The reset is in the audit log and emailed to them.</DialogDescription>
        </DialogHeader>
        <Field label="Reason" required error={error} hint="e.g. Phone stolen on 24 Oct; confirmed over a call">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? "Resetting…" : "Reset two-step"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
