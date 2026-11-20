"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { Building2, CheckSquare, Clock, IndianRupee, KeyRound, LifeBuoy, LogOut, Monitor, ShieldAlert, ShieldCheck, UserCheck, UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/common"
import { ActionMenu, BackLink, DetailHeader, Pill, Section, StatGrid, Tabs } from "@/components/page-parts"
import { PageError, PageLoading } from "@/components/page-states"
import { AboutCard, actionLabel, useTabParam } from "@/components/record-kit"
import { AccessDialog } from "@/components/users/forms"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatDateTime, formatPaise } from "@/lib/format"
import { ACTION, SCOPE, deviceName, type UserDetail } from "@/lib/users"
import { cn } from "@/lib/utils"

// One person in the business: their role and what it lets them do (module by module, and how much
// they see), their branches, the work open on them, their sign-ins and devices, and what they did.

type Tab = "access" | "work" | "signins" | "activity"
const TABS: Tab[] = ["access", "work", "signins", "activity"]
const SCOPE_COLOR: Record<string, string> = { all: "emerald", branch: "blue", team: "violet", own: "amber" }

function UserPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = useAuth()
  const { data: u, error, reload } = useApi<UserDetail>(`/users/${id}`)
  const [tab, setTab] = useTabParam<Tab>(TABS, "access")
  const [editing, setEditing] = React.useState(false)
  const [confirm, setConfirm] = React.useState<"off" | "on" | "signout" | null>(null)
  if (error) return <PageError error={error} onRetry={() => void reload()} />
  if (!u) return <PageLoading />
  const canEdit = can("tenant.member.edit") && !u.owner && !u.you
  const c = u.work.counts

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn()
      toast.success(done)
      await reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="grid gap-5">
      <BackLink href="/app/users">Users</BackLink>
      <DetailHeader
        title={u.name}
        initials={u.name}
        pills={<><Pill color={u.status === "active" ? "emerald" : "slate"} dot>{u.status === "active" ? "Can sign in" : "Login off"}</Pill><Pill color="blue">{u.role.name}</Pill>{u.you && <Pill>You</Pill>}</>}
        subtitle={[u.email, u.mobile].filter(Boolean).join(" · ")}
        extra={u.employee ? <Link href={`/app/m/hr/employees/${u.employee.id}`} className="text-xs text-primary hover:underline">Employee {u.employee.code}{u.employee.designation ? ` · ${u.employee.designation}` : ""}</Link> : undefined}
        actions={canEdit ? <>
          <Button variant="outline" onClick={() => setEditing(true)}><KeyRound /> Role and branches</Button>
          <ActionMenu items={[
            u.status === "active" ? { label: "Turn off login", icon: UserX, destructive: true, onClick: () => setConfirm("off") } : { label: "Turn on login", icon: UserCheck, onClick: () => setConfirm("on") },
            u.status === "active" && u.devices.length > 0 && { label: "Sign out everywhere", icon: LogOut, onClick: () => setConfirm("signout") },
          ]} />
        </> : u.you ? <Link href="/app/account" className="text-sm font-medium text-primary hover:underline">Edit in My account</Link> : undefined}
      />
      <StatGrid items={[
        { label: "Last sign-in", value: u.lastLoginAt ? formatDate(u.lastLoginAt) : "Never", hint: u.devices.length ? `${u.devices.length} device${u.devices.length === 1 ? "" : "s"} signed in` : "No device signed in now", icon: Clock, color: "blue" },
        { label: "Two-step", value: u.mfaEnabled ? "On" : "Off", hint: u.mfaEnabled ? "Code from their phone at sign-in" : "Ask them to turn it on in My account", icon: u.mfaEnabled ? ShieldCheck : ShieldAlert, color: u.mfaEnabled ? "emerald" : "amber" },
        { label: "Open work", value: c.tasks + c.tickets + c.appointments, hint: `${c.tasks} tasks · ${c.tickets} tickets · ${c.appointments} bookings`, icon: CheckSquare, color: "violet" },
        { label: "Billed, 30 days", value: formatPaise(c.invoiced30Paise), hint: `${c.invoices30} invoice${c.invoices30 === 1 ? "" : "s"} they made`, icon: IndianRupee, color: "emerald" },
      ]} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "access", label: "Access" },
        { key: "work", label: "Work", count: c.tasks + c.tickets + c.appointments },
        { key: "signins", label: "Sign-ins & devices", count: u.devices.length },
        { key: "activity", label: "What they did", count: u.did.length },
      ]} />

      {tab === "access" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <Section title={`What ${u.role.name} can do`} description={u.role.description ?? `${u.role.permissions} permissions in this role`} action={can("tenant.role.view") ? <Link href={`/app/users/roles/${u.role.id}`} className="text-sm font-medium text-primary hover:underline">{u.role.custom && can("tenant.role.edit") ? "Change the role" : "See the role"}</Link> : undefined} flush>
            {u.owner ? <p className="p-5 text-sm">The Owner can do everything in every module, and can&apos;t be limited.</p> : (
              <div className="divide-y">
                {[{ key: "tenant", name: "Business & settings", resources: u.access.tenant }, ...u.access.modules].filter((m) => m.resources.length).map((m) => (
                  <div key={m.key} className="grid gap-2 px-5 py-3 sm:grid-cols-[180px_1fr]">
                    <p className="text-sm font-semibold">{m.name}</p>
                    <ul className="grid gap-1.5">
                      {m.resources.map((r) => (
                        <li key={r.label} className="flex flex-wrap items-center gap-1.5 text-sm">
                          <span className="min-w-40 text-muted-foreground">{r.label}</span>
                          {r.actions.map((a) => <Pill key={a.action} color={SCOPE_COLOR[a.scope] ?? "slate"} title={SCOPE[a.scope] ?? a.scope}>{ACTION[a.action] ?? a.action}{a.scope !== "all" ? ` · ${(SCOPE[a.scope] ?? a.scope).toLowerCase()}` : ""}</Pill>)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {!u.access.modules.length && !u.access.tenant.length && <p className="p-5 text-sm text-muted-foreground">This role has no permissions in the modules on your plan.</p>}
              </div>
            )}
          </Section>
          <div className="grid content-start gap-5">
            <Section title="Branches" action={canEdit ? <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Change</Button> : undefined}>
              {u.branchOptions.length < 2 ? <p className="text-sm text-muted-foreground">One branch: they work in it.</p> : u.allBranches ? <p className="flex items-center gap-2 text-sm"><Building2 className="size-4 text-muted-foreground" /> All branches</p> : <ul className="grid gap-1 text-sm">{u.branches.map((b) => <li key={b.id} className="flex items-center gap-2"><Building2 className="size-4 text-muted-foreground" />{b.name}</li>)}</ul>}
              <p className="mt-2 text-xs text-muted-foreground">&quot;Their branches&quot; access shows only these branches&apos; records.</p>
            </Section>
            <Section title="How much they see">
              <ul className="grid gap-1.5 text-sm">{Object.entries(SCOPE).map(([k, l]) => <li key={k} className="flex items-center gap-2"><Pill color={SCOPE_COLOR[k]}>{l}</Pill><span className="text-xs text-muted-foreground">{k === "all" ? "every record" : k === "branch" ? "records of their branches" : k === "team" ? "theirs and their team's" : "records they made or own"}</span></li>)}</ul>
            </Section>
            <AboutCard id={u.id} createdAt={u.joinedAt} extra={[["Status", u.status === "active" ? "Can sign in" : `Login off${u.deactivatedAt ? ` since ${formatDate(u.deactivatedAt)}` : ""}`]]} />
          </div>
        </div>
      )}

      {tab === "work" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Section title={`Tasks · ${c.tasks}`} description={`${c.tasksDone30} done in 30 days`} flush>
            {u.work.tasks.length ? <ul className="divide-y">{u.work.tasks.map((t) => <li key={t.id}><Link href={`/app/m/tasks/${t.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-muted/40"><span className="min-w-0 truncate">{t.title}</span><span className={cn("shrink-0 text-xs", t.dueAt && new Date(t.dueAt) < new Date() ? "text-destructive" : "text-muted-foreground")}>{t.dueAt ? formatDate(t.dueAt) : "No date"}</span></Link></li>)}</ul> : <p className="p-5 text-sm text-muted-foreground">No open tasks.</p>}
          </Section>
          <Section title={`Tickets · ${c.tickets}`} description="Customer requests they handle" flush>
            {u.work.tickets.length ? <ul className="divide-y">{u.work.tickets.map((t) => <li key={t.id}><Link href={`/app/m/support/${t.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-muted/40"><span className="min-w-0 truncate"><span className="font-mono text-xs text-primary">{t.number}</span> {t.subject}</span><LifeBuoy className="size-3.5 shrink-0 text-muted-foreground" /></Link></li>)}</ul> : <p className="p-5 text-sm text-muted-foreground">No open tickets.</p>}
          </Section>
          <Section title={`Coming bookings · ${c.appointments}`} description={`${c.leads} open leads are theirs too`} flush>
            {u.work.appointments.length ? <ul className="divide-y">{u.work.appointments.map((a) => <li key={a.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm"><span className="min-w-0 truncate">{a.title}</span><span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(a.startAt)}</span></li>)}</ul> : <p className="p-5 text-sm text-muted-foreground">No bookings coming up.</p>}
          </Section>
          <p className="text-xs text-muted-foreground lg:col-span-3">Before turning off someone&apos;s login, give their open work to someone else from each list.</p>
        </div>
      )}

      {tab === "signins" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Signed in now" description="Devices with a live sign-in to this business" action={canEdit && u.devices.length ? <Button variant="ghost" size="sm" onClick={() => setConfirm("signout")}><LogOut /> Sign out all</Button> : undefined} flush>
            {u.devices.length ? <ul className="divide-y">{u.devices.map((d) => <li key={d.id} className="flex items-center gap-3 px-5 py-2.5 text-sm"><Monitor className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block font-medium">{deviceName(d.userAgent)}</span><span className="text-xs text-muted-foreground">{d.ip ?? "IP not known"} · since {formatDateTime(d.createdAt)}</span></span></li>)}</ul> : <p className="p-5 text-sm text-muted-foreground">Not signed in anywhere.</p>}
          </Section>
          <Section title="Recent sign-ins" description="The last 20 attempts" flush>
            {u.signIns.length ? (
              <ul className="divide-y">{u.signIns.map((s) => <li key={s.id} className="flex items-center gap-3 px-5 py-2.5 text-sm"><Pill color={s.outcome === "success" ? "emerald" : "rose"} dot>{s.outcome === "success" ? "Signed in" : s.outcome.replace(/_/g, " ")}</Pill><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{deviceName(s.userAgent)} · {s.ip ?? "—"}{s.method ? ` · ${s.method}` : ""}</span><span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(s.createdAt)}</span></li>)}</ul>
            ) : <p className="p-5 text-sm text-muted-foreground">No sign-ins yet.</p>}
          </Section>
        </div>
      )}

      {tab === "activity" && (
        <Section title="What they did" description="The last 40 things the audit log noted: money, stock, deletes, settings, people" flush>
          {u.did.length ? (
            <ul className="divide-y">
              {u.did.map((a) => {
                const after = (a.after ?? {}) as Record<string, unknown>
                const what = [after.number, after.invoice, after.name, after.title, after.subject].find((x) => typeof x === "string") as string | undefined
                return <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-sm"><span className="min-w-0 flex-1"><span className="font-medium">{actionLabel(a.action)}</span>{what && <span className="text-muted-foreground"> · {what}</span>}</span><span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(a.at)}</span></li>
              })}
            </ul>
          ) : <p className="p-5 text-sm text-muted-foreground">Nothing noted yet.</p>}
        </Section>
      )}

      {editing && <AccessDialog member={{ id: u.id, name: u.name, version: u.version, role: u.role, branches: u.allBranches ? [] : u.branches }} branches={u.branchOptions} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload() }} />}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive={confirm !== "on"}
        title={confirm === "off" ? `Turn off ${u.name}'s login?` : confirm === "on" ? `Turn on ${u.name}'s login?` : `Sign ${u.name} out everywhere?`}
        description={confirm === "off" ? `They are signed out at once. ${c.tasks + c.tickets + c.appointments ? `They still have ${c.tasks + c.tickets + c.appointments} open items; give them to someone else.` : "Their records stay."}` : confirm === "on" ? "They can sign in again. It takes a seat on your plan." : "Every device is signed out of this business. They can sign in again."}
        confirmLabel={confirm === "off" ? "Turn off" : confirm === "on" ? "Turn on" : "Sign out"}
        onConfirm={async () => {
          if (confirm === "signout") await act(() => api.post(`/members/${u.id}/sign-out`), "Signed out everywhere")
          else await act(() => api.patch(`/members/${u.id}`, { status: confirm === "off" ? "deactivated" : "active", version: u.version }), confirm === "off" ? "Login turned off" : "Login turned on")
        }}
      />
    </div>
  )
}

export default function Page() {
  return <React.Suspense><UserPage /></React.Suspense>
}
