"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Copy, Eye, Pencil, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SearchInput } from "@/components/common"
import { ErrorState, NoAccess } from "@/components/page-states"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import type { Role } from "@/lib/types"

export default function RolesPage() {
  const { can, me } = useAuth()
  const allowed = can("tenant.role.view")
  const roles = useApi<{ data: Role[] }>(allowed ? "/roles" : null)
  const [search, setSearch] = React.useState("")
  const [deleting, setDeleting] = React.useState<Role | null>(null)
  if (!allowed) return <NoAccess what="Roles" />
  if (roles.error && !roles.data) return <ErrorState error={roles.error} onRetry={roles.reload} />

  const freePlan = me?.subscription?.status === "free"
  const canCreate = can("tenant.role.create") && !freePlan
  const q = search.trim().toLowerCase()
  const list = (roles.data?.data ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q))

  const remove = async () => {
    try {
      await api.delete(`/roles/${deleting!.id}`)
      toast.success(`${deleting!.name} deleted`)
      setDeleting(null)
      await roles.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Manage Roles</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Set what each person can see and do, module by module.</p>
        </div>
        {canCreate && (
          <Link href="/app/settings/roles/new" className={buttonVariants()}>
            <Plus /> Create role
          </Link>
        )}
      </div>

      {freePlan && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          Custom roles need a paid plan. Ready-made roles keep working.{" "}
          {can("tenant.billing.view") && (
            <Link href="/app/billing" className="font-semibold underline">
              See plans
            </Link>
          )}
        </p>
      )}

      <div className="ui-surface grid gap-3 p-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search roles…" className="max-w-sm" />
        {!roles.data ? (
          <Skeleton className="h-72 rounded-xl" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Permissions</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((r) => {
                  const custom = !r.isPredefined
                  const owner = r.key === "owner"
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-[420px] whitespace-normal">
                        <Link href={`/app/settings/roles/${r.id}`} className="font-medium hover:underline">
                          {r.name}
                        </Link>
                        {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={custom ? "secondary" : "outline"}>{owner ? "Fixed" : custom ? "Custom" : "Ready-made"}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.permissionCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.memberCount}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Link href={`/app/settings/roles/${r.id}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={`${custom ? "Edit" : "View"} ${r.name}`} title={custom ? "Edit" : "View"}>
                            {custom ? <Pencil /> : <Eye />}
                          </Link>
                          {!owner && canCreate && (
                            <Link href={`/app/settings/roles/new?from=${r.id}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={`Clone ${r.name}`} title="Clone">
                              <Copy />
                            </Link>
                          )}
                          {custom && can("tenant.role.delete") && (
                            <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label={`Delete ${r.name}`} title="Delete" onClick={() => setDeleting(r)}>
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {!list.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No roles match.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>{deleting?.memberCount ? `${deleting.memberCount} ${deleting.memberCount === 1 ? "person has" : "people have"} this role. Give them another role in Users first.` : "This can't be undone."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!!deleting?.memberCount} onClick={remove}>
              Delete role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
