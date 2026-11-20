"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Copy, Eye, Pencil, Plus, ShieldCheck, Sparkles, Trash2, UserCog, Users } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/common"
import { DataList, HeaderLink, localList, type ViewPreset } from "@/components/data-list"
import { Avatar, Pill } from "@/components/page-parts"
import { NoAccess } from "@/components/page-states"
import { SummaryCards } from "@/components/summary-cards"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { Role } from "@/lib/types"
import type { UserRow } from "@/lib/users"

// Roles: what each kind of person can see and do. Ready-made roles come with each module; copy one
// to make your own. The list shows who has each role, so a change's reach is clear before it's made.

const iconLink = buttonVariants({ variant: "ghost", size: "icon-sm" })
type RoleRow = Role & { people: string[] }

export default function RolesPage() {
  const { can, me } = useAuth()
  const [deleting, setDeleting] = React.useState<RoleRow | null>(null)
  const [version, setVersion] = React.useState(0)
  if (!can("tenant.role.view")) return <NoAccess what="Roles" />

  const freePlan = me?.subscription?.status === "free"
  const canCreate = can("tenant.role.create") && !freePlan

  const remove = async () => {
    try {
      await api.delete(`/roles/${deleting!.id}`)
      toast.success(`${deleting!.name} deleted`)
      setDeleting(null)
      setVersion((v) => v + 1)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const presets: ViewPreset[] = [
    { key: "all", label: "All roles", params: {}, countKey: "all" },
    { key: "used", label: "In use", params: { show: "used" }, countKey: "used" },
    { key: "custom", label: "Your own", params: { show: "custom" }, countKey: "custom" },
    { key: "ready", label: "Ready-made", params: { show: "ready" }, countKey: "ready" },
  ]

  return (
    <div className="flex flex-col gap-4">
      {freePlan && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          Your own roles need a paid plan. Ready-made roles keep working.{" "}
          {can("tenant.billing.view") && <Link href="/app/billing" className="font-semibold underline">See plans</Link>}
        </p>
      )}
      <DataList<RoleRow>
        id="roles"
        load={localList(async () => {
          const [roles, users] = await Promise.all([api.get<{ data: Role[] }>("/roles"), can("tenant.member.view") ? api.get<{ data: UserRow[] }>("/users") : Promise.resolve({ data: [] as UserRow[] })])
          return roles.data.map((r) => ({ ...r, people: users.data.filter((u) => u.kind === "member" && u.status === "active" && u.role.id === r.id).map((u) => u.name) }))
        }, (r, q) => `${r.name} ${r.description ?? ""} ${r.people.join(" ")}`.toLowerCase().includes(q), {
          filter: (r, p) => (p.show === "used" ? r.memberCount > 0 : p.show === "custom" ? !r.isPredefined : p.show === "ready" ? r.isPredefined : true),
          counts: (rows) => ({ all: rows.length, used: rows.filter((r) => r.memberCount > 0).length, custom: rows.filter((r) => !r.isPredefined).length, ready: rows.filter((r) => r.isPredefined).length }),
          meta: (rows) => ({ people: rows.reduce((s, r) => s + r.memberCount, 0) }),
        })}
        params={{ v: String(version) }}
        header={{ title: "Roles", description: "What each kind of person can see and do, module by module. Copy a ready-made role to make your own.", primary: canCreate ? <HeaderLink href="/app/users/roles/new" primary><Plus /> Create role</HeaderLink> : undefined, more: [{ label: "Users", href: "/app/users" }] }}
        presets={presets}
        tabs
        top={(res) => {
          const c = (res.counts ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "Roles", value: c.all ?? 0, hint: `${c.ready ?? 0} ready-made for your modules`, color: "blue", icon: ShieldCheck },
            { label: "In use", value: c.used ?? 0, hint: `${Number(res.people ?? 0)} people have a role`, color: "emerald", icon: Users },
            { label: "Your own", value: c.custom ?? 0, hint: freePlan ? "Needs a paid plan" : "Copied and changed to fit", color: "violet", icon: Sparkles },
          ]} />
        }}
        columns={[
          { key: "name", header: "Role", hideable: false, sort: (r) => r.name, csv: (r) => r.name, className: "max-w-[420px] whitespace-normal", cell: (r) => <span className="flex items-start gap-2.5"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><UserCog className="size-4" /></span><span><span className="block font-medium">{r.name}</span>{r.description && <span className="text-xs text-muted-foreground">{r.description}</span>}</span></span> },
          { key: "type", header: "Type", csv: (r) => (r.key === "owner" ? "Fixed" : r.isPredefined ? "Ready-made" : "Your own"), cell: (r) => <Pill color={r.key === "owner" ? "slate" : r.isPredefined ? "blue" : "violet"}>{r.key === "owner" ? "Fixed" : r.isPredefined ? "Ready-made" : "Your own"}</Pill> },
          { key: "permissions", header: "Permissions", align: "right", sort: (r) => r.permissionCount, csv: (r) => r.permissionCount, cell: (r) => r.permissionCount },
          { key: "people", header: "Who has it", sort: (r) => r.memberCount, csv: (r) => r.people.join(", "), cell: (r) => r.memberCount ? <span className="flex items-center gap-2"><span className="flex -space-x-2">{r.people.slice(0, 4).map((p) => <Avatar key={p} name={p} className="size-7 border-2 border-card text-[10px]" />)}</span><span className="text-sm text-muted-foreground">{r.people.length ? r.people.slice(0, 2).join(", ") : ""}{r.memberCount > 2 ? ` +${r.memberCount - 2}` : ""}</span></span> : <span className="text-muted-foreground">Nobody</span> },
          {
            key: "actions", header: "Actions", hideable: false,
            cell: (r) => (
              <span className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Link href={`/app/users/roles/${r.id}`} className={iconLink} aria-label={`${r.isPredefined ? "View" : "Edit"} ${r.name}`} title={r.isPredefined ? "View" : "Edit"}>{r.isPredefined ? <Eye /> : <Pencil />}</Link>
                {r.key !== "owner" && canCreate && <Link href={`/app/users/roles/new?from=${r.id}`} className={iconLink} aria-label={`Copy ${r.name}`} title="Copy to make your own"><Copy /></Link>}
                {!r.isPredefined && can("tenant.role.delete") && <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label={`Delete ${r.name}`} title="Delete" onClick={() => setDeleting(r)}><Trash2 /></Button>}
              </span>
            ),
          },
        ]}
        searchPlaceholder="Search roles or people"
        rowHref={(r) => `/app/users/roles/${r.id}`}
        exportName="roles"
        emptyState={<EmptyState icon={ShieldCheck} title="No roles here" />}
      />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>{deleting?.memberCount ? `${deleting.memberCount} ${deleting.memberCount === 1 ? "person has" : "people have"} this role${deleting.people.length ? ` (${deleting.people.join(", ")})` : ""}. Give them another role in Users first.` : "This can't be undone."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!!deleting?.memberCount} onClick={remove}>Delete role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
