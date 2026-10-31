"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { CopyPlus, KeyRound, Lock, Plus, Trash2, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FormError, NativeSelect } from "@/components/form"
import { Chip, Failed, Page } from "@/components/console/kit"
import { ConfirmDialog } from "@/components/common"
import { Count, DataTable, FilterSelect, IdCell, type Column, type RowAction } from "@/components/console/data-table"
import { useClientTable } from "@/lib/use-table"
import { formatDate } from "@/lib/format"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import type { ConsoleRoleRow } from "@/lib/console"

// Roles & permissions (blueprint Phase C): the built-in Console roles and any custom ones.
// Click a role for its permission matrix. Only an Admin creates or changes roles.

function NewRoleDialog({ roles, from, open, onOpenChange }: { roles: ConsoleRoleRow[]; from?: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter()
  const sources = roles.filter((r) => !r.locked)
  const [form, setForm] = React.useState({ fromRoleId: sources.find((r) => r.id === from)?.id ?? sources[0]?.id ?? "", name: "", description: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const r = await api.post<{ id: string }>("/console/access/roles", { ...form, description: form.description || undefined })
      router.push(`/console/roles/${r.id}`)
    } catch (x) {
      setErrors(x instanceof ApiError ? { ...x.fields, form: errorMessage(x) } : { form: errorMessage(x) })
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
            <DialogDescription>A new role starts as a copy of another one. Change its permissions on the next screen.</DialogDescription>
          </DialogHeader>
          <Field label="Start from" error={errors.fromRoleId}>
            <NativeSelect value={form.fromRoleId} onChange={(e) => setForm({ ...form, fromRoleId: e.target.value })}>
              {sources.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Name" required error={errors.name} hint="For example Finance desk or Telesales">
            <Input id="role-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} autoFocus />
          </Field>
          <Field label="What this role is for" error={errors.description}>
            <Input id="role-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} />
          </Field>
          <FormError message={errors.form} />
          <DialogFooter>
            <Button type="submit" disabled={busy || form.name.trim().length < 2}>{busy ? "Creating…" : "Create role"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function RolesPage() {
  return (
    <React.Suspense>
      <Roles />
    </React.Suspense>
  )
}

function Roles() {
  const router = useRouter()
  const copyFrom = useSearchParams().get("new")
  const { me } = useAuth()
  const isAdmin = me?.console?.role.key === "super_admin"
  const { data, error, reload } = useApi<{ data: ConsoleRoleRow[] }>("/console/access/roles")
  const [open, setOpen] = React.useState<string | null | false>(copyFrom ?? false)
  const [deleting, setDeleting] = React.useState<ConsoleRoleRow | null>(null)
  const [type, setType] = React.useState("")
  const typeOf = (r: ConsoleRoleRow) => (r.locked ? "fixed" : r.builtIn ? "builtin" : "custom")
  const rows = React.useMemo(() => data?.data.filter((r) => !type || typeOf(r) === type) ?? null, [data, type])
  const table = useClientTable(rows, { name: (r) => r.name, description: (r) => r.description ?? "", type: typeOf, permissions: (r) => (r.locked ? 999 : r.permissions), members: (r) => r.members, created: (r) => r.createdAt, changed: (r) => r.changedAt ?? "" })

  const columns: Column<ConsoleRoleRow>[] = [
    { key: "id", header: "ID", cell: (r) => <IdCell id={r.id} href={`/console/roles/${r.id}`} /> },
    { key: "name", header: "Role", always: true, sortable: true, cell: (r) => <span className="flex items-center gap-2 font-medium">{r.name} {r.locked && <Lock className="size-3.5 text-muted-foreground" aria-label="Fixed" />}</span> },
    { key: "description", header: "What it is for", cell: (r) => <span className="block max-w-md truncate text-muted-foreground" title={r.description ?? undefined}>{r.description ?? "—"}</span> },
    { key: "type", header: "Type", sortable: true, cell: (r) => (r.locked ? <Chip tone="grey">Fixed</Chip> : r.builtIn ? (r.customized ? <Chip tone="amber">Built-in · changed</Chip> : <Chip tone="grey">Built-in</Chip>) : <Chip tone="blue">Custom</Chip>) },
    { key: "permissions", header: "Permissions", align: "right", sortable: true, cell: (r) => (r.locked ? "All" : r.permissions) },
    { key: "members", header: "People", align: "right", sortable: true, cell: (r) => r.members },
    { key: "changed", header: "Last changed", sortable: true, cell: (r) => <span className="text-muted-foreground">{r.changedAt ? formatDate(r.changedAt) : "—"}</span> },
    { key: "created", header: "Created", sortable: true, hidden: true, cell: (r) => <span className="text-muted-foreground">{formatDate(r.createdAt)}</span> },
  ]
  const actions = (r: ConsoleRoleRow): RowAction[] => [
    { label: r.locked || !isAdmin ? "See permissions" : "Edit permissions", icon: KeyRound, href: `/console/roles/${r.id}` },
    { label: "Copy as a new role", icon: CopyPlus, onClick: () => setOpen(r.id), hidden: !isAdmin || r.locked },
    { label: "People with this role", icon: Users, href: `/console/team`, hidden: !r.members },
    { label: "Delete role", icon: Trash2, danger: true, separator: true, onClick: () => setDeleting(r), hidden: !isAdmin || r.builtIn },
  ]

  return (
    <Page
      wide
      eyebrow="People & access"
      title="Roles & permissions"
      subtitle="What each Console role can see and do. Every request is checked on the server, not just hidden in the menu."
      actions={isAdmin && data && <Button onClick={() => setOpen(null)}><Plus /> New role</Button>}
    >
      {error ? (
        <Failed error={error} onRetry={reload} />
      ) : (
        <DataTable
          id="roles"
          label="Roles"
          table={table}
          columns={columns}
          actions={actions}
          onRowClick={(r) => router.push(`/console/roles/${r.id}`)}
          searchFields={[{ key: "name", label: "Role" }, { key: "description", label: "What it is for" }]}
          summary={data && <><Count tone="blue" n={data.data.length} label="Roles" /><Count tone="green" n={data.data.reduce((a, r) => a + r.members, 0)} label="People" /></>}
          filters={<FilterSelect value={type} onChange={setType} label="Type" options={[["", "Any type"], ["builtin", "Built-in"], ["custom", "Custom"], ["fixed", "Fixed"]]} />}
          empty="No roles."
        />
      )}
      {open !== false && isAdmin && data && <NewRoleDialog roles={data.data} from={open} open onOpenChange={(o) => !o && setOpen(false)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description={deleting?.members ? `${deleting.members} people have this role. Give them another role first.` : "Nobody has this role. It is removed for good."}
        confirmLabel="Delete role"
        destructive
        onConfirm={async () => {
          if (!deleting) return
          try {
            await api.delete(`/console/access/roles/${deleting.id}`)
            toast.success("Role deleted")
            await reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
          setDeleting(null)
        }}
      />
    </Page>
  )
}
