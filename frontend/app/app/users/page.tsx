"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Eye, KeyRound, LogOut, MailPlus, RotateCcw, ShieldAlert, ShieldCheck, UserCheck, UserPlus, Users, UserX, XCircle } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog, EmptyState } from "@/components/common"
import { DataList, remoteList, type ViewPreset } from "@/components/data-list"
import { Field } from "@/components/form"
import { ActionMenu, Pill } from "@/components/page-parts"
import { PersonCell } from "@/components/record-view"
import { SummaryCards } from "@/components/summary-cards"
import { AccessDialog, InviteDialog } from "@/components/users/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatDateTime } from "@/lib/format"
import type { UserRow } from "@/lib/users"

// Users: everyone in the business and everyone invited, in one list. Invite, change a role or
// branches, turn a login off or on, reset two-step, sign someone out, and resend or cancel an
// invitation, all from the row; open a person for what they can do and what they did.

const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })
type Sums = { seats: number | null; used: number; selfService: number; signedInWeek: number; mfaPct: number; expiredInvites: number }

export default function UsersPage() {
  const { can } = useAuth()
  const [version, setVersion] = React.useState(0)
  const [branches, setBranches] = React.useState<{ id: string; name: string }[]>([])
  const [inviting, setInviting] = React.useState(false)
  const [editing, setEditing] = React.useState<UserRow | null>(null)
  const [confirm, setConfirm] = React.useState<{ row: UserRow; what: "off" | "on" | "signout" | "revoke" } | null>(null)
  const [resetFor, setResetFor] = React.useState<UserRow | null>(null)
  const reload = () => setVersion((v) => v + 1)
  if (!can("tenant.member.view")) return <EmptyState icon={Users} title="No access to users" description="Ask your admin for access." />
  const canEdit = can("tenant.member.edit")
  const canInvite = can("tenant.member.create")

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn()
      toast.success(done)
      reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const resend = (r: UserRow) => act(async () => {
    const res = await api.post<{ inviteLink?: string }>(`/invitations/${r.id}/resend`)
    if (res.inviteLink) await navigator.clipboard?.writeText(res.inviteLink)
  }, "Invitation sent again for 7 more days")

  const actions = (r: UserRow) => {
    if (r.kind === "invite") return (
      <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        {canInvite && <Button variant="ghost" size="icon-sm" title="Send again" aria-label={`Send the invitation to ${r.name} again`} onClick={() => void resend(r)}><MailPlus /></Button>}
        {canInvite && <Button variant="ghost" size="icon-sm" title="Cancel invitation" aria-label={`Cancel the invitation to ${r.name}`} className="text-destructive" onClick={() => setConfirm({ row: r, what: "revoke" })}><XCircle /></Button>}
      </span>
    )
    const locked = r.owner || r.you
    return (
      <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        <Link href={`/app/users/${r.id}`} className={icon} title="Open" aria-label={`Open ${r.name}`}><Eye /></Link>
        {canEdit && !locked && <Button variant="ghost" size="icon-sm" title="Role and branches" aria-label={`Change access for ${r.name}`} onClick={() => setEditing(r)}><KeyRound /></Button>}
        {canEdit && !locked && (
          <ActionMenu items={[
            r.status === "active" ? { label: "Turn off login", icon: UserX, destructive: true, onClick: () => setConfirm({ row: r, what: "off" }) } : { label: "Turn on login", icon: UserCheck, onClick: () => setConfirm({ row: r, what: "on" }) },
            r.status === "active" && !!r.devices && { label: `Sign out of ${r.devices} device${r.devices === 1 ? "" : "s"}`, icon: LogOut, onClick: () => setConfirm({ row: r, what: "signout" }) },
            r.mfaEnabled && { label: "Reset two-step…", icon: RotateCcw, onClick: () => setResetFor(r) },
          ]} />
        )}
      </span>
    )
  }

  const presets: ViewPreset[] = [
    { key: "all", label: "Everyone", params: {}, countKey: "all" },
    { key: "active", label: "Can sign in", params: { show: "active" }, countKey: "active" },
    { key: "invited", label: "Invited", params: { show: "invited" }, countKey: "invited" },
    { key: "deactivated", label: "Login off", params: { show: "deactivated" }, countKey: "deactivated" },
    { key: "nomfa", label: "No two-step", params: { show: "nomfa" }, countKey: "nomfa" },
  ]
  const add = canInvite ? <Button className="h-10 rounded-xl px-4 font-semibold" onClick={() => setInviting(true)}><UserPlus /> Invite user</Button> : undefined

  return (
    <div className="grid gap-6">
      <DataList<UserRow>
        id="users"
        params={{ v: String(version) }}
        load={async (q) => {
          const res = await api.get<{ data: UserRow[]; counts: Record<string, number>; sums: Sums; branches: { id: string; name: string }[] }>("/users")
          setBranches(res.branches)
          const show = q.params.show
          const rows = res.data.filter((r) => !show || (show === "nomfa" ? r.kind === "member" && r.status === "active" && !r.mfaEnabled : r.status === show))
          return remoteList<UserRow>(async () => ({ ...res, data: rows }), (r, s) => `${r.name} ${r.email ?? ""} ${r.mobile ?? ""} ${r.role.name}`.toLowerCase().includes(s))(q)
        }}
        header={{ title: "Users", description: "Everyone who works in this business, and who is invited. Give each person a role, and branches if you have more than one.", primary: add, more: [{ label: "Roles", href: "/app/users/roles" }, { label: "Security", href: "/app/settings/security" }] }}
        presets={presets}
        tabs
        top={(res) => {
          const c = (res.counts ?? {}) as Record<string, number>
          const s = (res.sums ?? {}) as Sums
          return <SummaryCards items={[
            { label: "Users on your plan", value: s.seats ? `${s.used} of ${s.seats}` : s.used, hint: s.seats && s.used >= s.seats ? `Full: add users in Subscription${s.selfService ? ` · ${s.selfService} employee logins free` : ""}` : s.selfService ? `+ ${s.selfService} employee logins, free` : "Employee self-service logins are free", color: "blue", icon: Users, href: s.seats && s.used >= s.seats && can("tenant.billing.view") ? "/app/billing" : undefined },
            { label: "Can sign in", value: c.active ?? 0, hint: `${s.signedInWeek ?? 0} signed in this week`, color: "emerald", icon: UserCheck },
            { label: "Invited", value: c.invited ?? 0, hint: s.expiredInvites ? `${s.expiredInvites} expired: send again` : "Waiting to join", color: "violet", icon: MailPlus },
            { label: "Two-step on", value: `${s.mfaPct ?? 0}%`, hint: c.nomfa ? `${c.nomfa} without it` : "Everyone is protected", color: c.nomfa ? "amber" : "emerald", icon: c.nomfa ? ShieldAlert : ShieldCheck, href: "/app/settings/security" },
            { label: "Login off", value: c.deactivated ?? 0, hint: "Kept for the record", color: "slate", icon: UserX },
          ]} />
        }}
        columns={[
          { key: "user", header: "User", hideable: false, sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span className="flex items-center gap-2"><PersonCell name={r.name} sub={r.email ?? r.mobile} />{r.you && <Pill color="blue">You</Pill>}</span> },
          { key: "mobile", header: "Mobile", defaultHidden: true, csv: (r) => r.mobile ?? "", cell: (r) => <span className="tabular-nums">{r.mobile ?? "—"}</span> },
          { key: "role", header: "Role", sort: (r) => r.role.name, csv: (r) => r.role.name, cell: (r) => <span className="flex items-center gap-1.5">{r.role.name}{r.role.custom && <Pill>Custom</Pill>}{r.seatFree && <Pill color="emerald" title="Self-service employee logins don't use a paid seat">Free seat</Pill>}</span> },
          { key: "branches", header: "Branches", csv: (r) => (r.branches.length ? r.branches.map((b) => b.name).join(", ") : "All"), cell: (r) => (branches.length < 2 ? <span className="text-muted-foreground">—</span> : r.branches.length ? <span className="text-sm">{r.branches.map((b) => b.name).join(", ")}</span> : <span className="text-muted-foreground">All</span>) },
          { key: "status", header: "Status", sort: (r) => r.status, csv: (r) => r.status, cell: (r) => r.kind === "invite" ? <Pill color={r.expired ? "rose" : "violet"}>{r.expired ? "Invite expired" : `Invited · till ${formatDate(r.expiresAt!)}`}</Pill> : <span className="flex flex-wrap gap-1"><Pill color={r.status === "active" ? "emerald" : "slate"} dot>{r.status === "active" ? "Can sign in" : "Login off"}</Pill>{r.status === "active" && (r.mfaEnabled ? <Pill color="blue">Two-step</Pill> : <Pill color="amber">No two-step</Pill>)}</span> },
          { key: "work", header: "Open work", csv: (r) => (r.work ? `${r.work.tasks} tasks, ${r.work.tickets} tickets, ${r.work.appointments} appointments, ${r.work.leads} leads` : ""), cell: (r) => (r.work ? <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">{r.work.tasks > 0 && <span className={r.work.lateTasks ? "text-destructive" : ""}>{r.work.tasks} tasks{r.work.lateTasks ? ` (${r.work.lateTasks} late)` : ""}</span>}{r.work.tickets > 0 && <span>{r.work.tickets} tickets</span>}{r.work.appointments > 0 && <span>{r.work.appointments} bookings</span>}{r.work.leads > 0 && <span>{r.work.leads} leads</span>}{!r.work.tasks && !r.work.tickets && !r.work.appointments && !r.work.leads && "—"}</span> : <span className="text-muted-foreground">—</span>) },
          { key: "last", header: "Last sign-in", sort: (r) => r.lastLoginAt ?? "", csv: (r) => r.lastLoginAt ?? "", cell: (r) => (r.kind === "invite" ? <span className="text-xs text-muted-foreground">Invited by {r.invitedBy ?? "someone"}</span> : <span className="text-sm text-muted-foreground">{r.lastLoginAt ? formatDateTime(r.lastLoginAt) : "Never"}</span>) },
          { key: "joined", header: "Joined", defaultHidden: true, sort: (r) => r.joinedAt, csv: (r) => r.joinedAt.slice(0, 10), cell: (r) => formatDate(r.joinedAt) },
          { key: "actions", header: "Actions", hideable: false, cell: actions },
        ]}
        searchPlaceholder="Search name, email, mobile or role"
        rowHref={(r) => (r.kind === "member" ? `/app/users/${r.id}` : "")}
        exportName="users"
        emptyState={<EmptyState icon={Users} title="No one here" description="Invite the people who work with you. Each gets only what their role allows." action={add} />}
      />
      {inviting && <InviteDialog branches={branches} onClose={() => setInviting(false)} onSaved={() => { setInviting(false); reload() }} />}
      {editing && editing.kind === "member" && <AccessDialog member={{ id: editing.id, name: editing.name, version: editing.version!, role: editing.role, branches: editing.branches }} branches={branches} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive={confirm?.what !== "on"}
        title={confirm?.what === "off" ? `Turn off ${confirm.row.name}'s login?` : confirm?.what === "on" ? `Turn on ${confirm.row.name}'s login?` : confirm?.what === "signout" ? `Sign ${confirm?.row.name} out everywhere?` : `Cancel the invitation to ${confirm?.row.name}?`}
        description={confirm?.what === "off" ? "They are signed out at once and can't sign in to this business. Their records stay. Their seat is freed." : confirm?.what === "on" ? "They can sign in again with their role. It takes a seat on your plan." : confirm?.what === "signout" ? "Every device they use for this business is signed out. They can sign in again." : "The link stops working. You can invite them again later."}
        confirmLabel={confirm?.what === "off" ? "Turn off" : confirm?.what === "on" ? "Turn on" : confirm?.what === "signout" ? "Sign out" : "Cancel invitation"}
        onConfirm={async () => {
          const c = confirm!
          if (c.what === "revoke") await act(() => api.delete(`/invitations/${c.row.id}`), "Invitation cancelled")
          else if (c.what === "signout") await act(() => api.post(`/members/${c.row.id}/sign-out`), `${c.row.name} is signed out`)
          else await act(() => api.patch(`/members/${c.row.id}`, { status: c.what === "off" ? "deactivated" : "active", version: c.row.version }), c.what === "off" ? "Login turned off" : "Login turned on")
        }}
      />
      {resetFor && <ResetTwoStepDialog member={resetFor} onClose={() => setResetFor(null)} />}
    </div>
  )
}

/** Lost phone, no backup codes: an Owner/Admin resets two-step (A4-C). Audited and emailed to the person. */
function ResetTwoStepDialog({ member, onClose }: { member: UserRow; onClose: () => void }) {
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const submit = async () => {
    const r = reason.trim()
    if (r.length < 10 || r.length > 500) return setError("Give a reason of 10–500 characters")
    setBusy(true)
    try {
      await api.post(`/members/${member.id}/mfa-reset`, { reason: r })
      toast.success(`Two-step reset for ${member.name}. They'll set it up again at their next sign-in.`)
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset two-step for {member.name}?</DialogTitle>
          <DialogDescription>Use this when they lost their phone and their backup codes. They&apos;ll set two-step up again at their next sign-in. The reset is in the audit log and emailed to them.</DialogDescription>
        </DialogHeader>
        <Field label="Reason" required error={error} hint="e.g. Phone stolen on 24 Oct; confirmed over a call"><Input value={reason} onChange={(e) => { setReason(e.target.value); setError(null) }} autoFocus /></Field>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" onClick={submit} disabled={busy}>{busy ? "Resetting…" : "Reset two-step"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

