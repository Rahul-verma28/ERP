"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { KeyRound, Lock, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FormError, NativeSelect } from "@/components/form"
import { Chip, Empty, Failed, Loading, Page, Panel } from "@/components/console/kit"
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
  const [open, setOpen] = React.useState(!!copyFrom)

  return (
    <Page
      eyebrow="People & access"
      title="Roles & permissions"
      subtitle="What each Console role can see and do. Every request is checked on the server, not just hidden in the menu."
      actions={isAdmin && data && <Button onClick={() => setOpen(true)}><Plus /> New role</Button>}
    >
      <Panel padded={false}>
        {error ? (
          <div className="p-5"><Failed error={error} onRetry={reload} /></div>
        ) : !data ? (
          <Loading rows={5} className="p-5" />
        ) : !data.data.length ? (
          <Empty icon={KeyRound} title="No roles" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-3 py-3 font-medium">Type</th>
                  <th className="px-3 py-3 text-right font-medium">Permissions</th>
                  <th className="px-5 py-3 text-right font-medium">People</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((r) => (
                  <tr key={r.id} onClick={() => router.push(`/console/roles/${r.id}`)} className="cursor-pointer border-b last:border-0 hover:bg-muted/50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 font-medium">{r.name} {r.locked && <Lock className="size-3.5 text-muted-foreground" aria-label="Fixed" />}</div>
                      <div className="max-w-xl text-[13px] text-muted-foreground">{r.description}</div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {r.locked ? <Chip tone="grey">Fixed</Chip> : r.builtIn ? (r.customized ? <Chip tone="amber">Built-in · changed</Chip> : <Chip tone="grey">Built-in</Chip>) : <Chip tone="blue">Custom</Chip>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.locked ? "All" : r.permissions}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{r.members}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {open && isAdmin && data && <NewRoleDialog roles={data.data} from={copyFrom} open onOpenChange={setOpen} />}
    </Page>
  )
}
