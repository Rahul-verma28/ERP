"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Copy, Eye, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/common"
import { DataList, HeaderLink, localList } from "@/components/data-list"
import { NoAccess } from "@/components/page-states"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import type { Role } from "@/lib/types"

const iconLink = buttonVariants({ variant: "ghost", size: "icon-sm" })

export default function RolesPage() {
  const { can, me } = useAuth()
  const [deleting, setDeleting] = React.useState<Role | null>(null)
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

  return (
    <div className="flex flex-col gap-4">
      {freePlan && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          Custom roles need a paid plan. Ready-made roles keep working.{" "}
          {can("tenant.billing.view") && <Link href="/app/billing" className="font-semibold underline">See plans</Link>}
        </p>
      )}
      <DataList<Role>
        id="roles"
        load={localList(async () => (await api.get<{ data: Role[] }>("/roles")).data, (r, q) => `${r.name} ${r.description ?? ""}`.toLowerCase().includes(q))}
        params={{ v: String(version) }}
        header={{ title: "Manage Roles", description: "Set what each person can see and do, module by module.", primary: canCreate ? <HeaderLink href="/app/settings/roles/new" primary><Plus /> Create role</HeaderLink> : undefined }}
        columns={[
          { key: "name", header: "Role", hideable: false, sort: (r) => r.name, className: "max-w-[420px] whitespace-normal", cell: (r) => <span><span className="block font-medium">{r.name}</span>{r.description && <span className="text-xs text-muted-foreground">{r.description}</span>}</span> },
          { key: "type", header: "Type", cell: (r) => <Badge variant={r.isPredefined ? "outline" : "secondary"}>{r.key === "owner" ? "Fixed" : r.isPredefined ? "Ready-made" : "Custom"}</Badge> },
          { key: "permissions", header: "Permissions", align: "right", sort: (r) => r.permissionCount, cell: (r) => r.permissionCount },
          { key: "users", header: "Users", align: "right", sort: (r) => r.memberCount, cell: (r) => r.memberCount },
          {
            key: "actions", header: "Actions", hideable: false,
            cell: (r) => (
              <span className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Link href={`/app/settings/roles/${r.id}`} className={iconLink} aria-label={`${r.isPredefined ? "View" : "Edit"} ${r.name}`} title={r.isPredefined ? "View" : "Edit"}>{r.isPredefined ? <Eye /> : <Pencil />}</Link>
                {r.key !== "owner" && canCreate && <Link href={`/app/settings/roles/new?from=${r.id}`} className={iconLink} aria-label={`Clone ${r.name}`} title="Clone"><Copy /></Link>}
                {!r.isPredefined && can("tenant.role.delete") && <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label={`Delete ${r.name}`} title="Delete" onClick={() => setDeleting(r)}><Trash2 /></Button>}
              </span>
            ),
          },
        ]}
        searchPlaceholder="Search roles"
        rowHref={(r) => `/app/settings/roles/${r.id}`}
        emptyState={<EmptyState icon={ShieldCheck} title="No roles yet" />}
      />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>{deleting?.memberCount ? `${deleting.memberCount} ${deleting.memberCount === 1 ? "person has" : "people have"} this role. Give them another role in Users first.` : "This can't be undone."}</DialogDescription>
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
