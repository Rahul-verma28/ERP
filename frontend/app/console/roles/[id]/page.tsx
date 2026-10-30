"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, Copy, Lock, RotateCcw, Trash2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/common"
import { Field, NativeSelect } from "@/components/form"
import { Chip, Failed, Loading, Page, Panel } from "@/components/console/kit"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import type { ConsoleRoleDetail, MatrixRow } from "@/lib/console"
import { cn } from "@/lib/utils"

// Role permission matrix (blueprint S5): area × action × which records. Risky permissions are
// marked. Admins edit; everyone else reads. Saving applies within a minute and is audited.

/** Console permissions are scoped to own, team or all businesses (no branches here) */
type Scope = "own" | "team" | "all"

const COLUMNS = [
  { action: "view", label: "View" },
  { action: "create", label: "Add" },
  { action: "edit", label: "Edit" },
  { action: "approve", label: "Approve" },
] as const

// Areas where "which records" means something; the rest are all-or-nothing
const SCOPED = new Set(["dashboard", "tenant", "grace", "payment", "commission", "member", "revenue", "prospect", "note"])
const SCOPE_LABEL: Record<Scope, string> = { own: "Own businesses", team: "Their team's", all: "All" }
const ACTION_WORD: Record<string, string> = { view: "see", create: "add", edit: "change", approve: "approve", delete: "delete", export: "export" }

const rowScope = (row: MatrixRow, grants: Record<string, Scope>): Scope | null => row.actions.map((a) => grants[a.key]).find(Boolean) ?? null

export default function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const router = useRouter()
  const { me } = useAuth()
  const isAdmin = me?.console?.role.key === "super_admin"
  const { data, error, reload, setData } = useApi<ConsoleRoleDetail>(`/console/access/roles/${id}`)
  const [grants, setGrants] = React.useState<Record<string, Scope> | null>(null)
  const roleGrants = (data?.grants ?? {}) as Record<string, Scope>
  const [limit, setLimit] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [confirm, setConfirm] = React.useState<"reset" | "delete" | null>(null)

  if (error) return <Failed error={error} onRetry={reload} />
  if (!data) return <Loading rows={8} className="mx-auto max-w-6xl" />

  const editable = isAdmin && !data.locked
  const g = grants ?? roleGrants
  const dirty = (grants && JSON.stringify(grants) !== JSON.stringify(data.grants)) || (limit !== null && Number(limit) !== data.discountLimitPercent)

  function toggle(row: MatrixRow, key: string) {
    setGrants((cur) => {
      const next = { ...(cur ?? roleGrants) }
      if (next[key]) delete next[key]
      else next[key] = rowScope(row, next) ?? (SCOPED.has(row.resource) && data!.key !== "console_staff" ? "own" : "all")
      return next
    })
  }
  function setScope(row: MatrixRow, scope: Scope) {
    setGrants((cur) => {
      const next = { ...(cur ?? roleGrants) }
      for (const a of row.actions) if (next[a.key]) next[a.key] = scope
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      const d = await api.patch<ConsoleRoleDetail>(`/console/access/roles/${id}`, { grants: g, ...(limit !== null ? { discountLimitPercent: Number(limit) || 0 } : {}) })
      setData(d)
      setGrants(null)
      setLimit(null)
      toast.success("Saved. It applies within a minute.")
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    try {
      setData(await api.post<ConsoleRoleDetail>(`/console/access/roles/${id}/reset`))
      setGrants(null)
      toast.success("Back to the default permissions")
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  async function remove() {
    try {
      await api.delete(`/console/access/roles/${id}`)
      toast.success(`${data!.name} deleted`)
      router.push("/console/roles")
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const summary = data.matrix
    .map((row) => {
      const on = row.actions.filter((a) => g[a.key])
      if (!on.length) return null
      const scope = SCOPED.has(row.resource) ? rowScope(row, g) : null
      return { label: row.label, text: `can ${on.map((a) => ACTION_WORD[a.action] ?? a.action).join(", ")}${scope && scope !== "all" ? ` (${SCOPE_LABEL[scope].toLowerCase()})` : ""}` }
    })
    .filter(Boolean) as { label: string; text: string }[]

  return (
    <Page
      back={{ href: "/console/roles", label: "Roles & permissions" }}
      title={
        <span className="flex flex-wrap items-center gap-3">
          {data.name}
          {data.locked ? <Chip tone="grey">Fixed</Chip> : data.builtIn ? <Chip tone={data.customized ? "amber" : "grey"}>{data.customized ? "Built-in · changed" : "Built-in"}</Chip> : <Chip tone="blue">Custom</Chip>}
        </span>
      }
      subtitle={[data.description, data.copiedFrom ? `Copied from ${data.copiedFrom}` : null, `${data.members.length} ${data.members.length === 1 ? "person" : "people"}`].filter(Boolean).join(" · ")}
      actions={
        isAdmin && (
          <>
            {data.builtIn && data.customized && <Button variant="outline" onClick={() => setConfirm("reset")}><RotateCcw /> Reset to default</Button>}
            {!data.builtIn && <Button variant="outline" onClick={() => setConfirm("delete")} disabled={data.members.length > 0} title={data.members.length ? "Move its people to another role first" : undefined}><Trash2 /> Delete</Button>}
            {!data.locked && <Link href={`/console/roles?new=${data.id}`} className={buttonVariants({ variant: "outline" })}><Copy /> Copy as new role</Link>}
            {editable && <Button onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save changes"}</Button>}
          </>
        )
      }
    >
      {data.locked && (
        <p className="flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm"><Lock className="size-4" /> The Admin role always has every permission, so nobody can lock themselves out. It can&apos;t be changed.</p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Panel padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Area</th>
                  {COLUMNS.map((c) => (
                    <th key={c.action} className="w-16 px-2 py-3 text-center font-medium">{c.label}</th>
                  ))}
                  <th className="px-4 py-3 font-medium">Which records</th>
                </tr>
              </thead>
              <tbody>
                {data.matrix.map((row) => {
                  const scope = rowScope(row, g)
                  const risky = row.actions.some((a) => a.risky)
                  return (
                    <tr key={row.resource} className="border-b align-middle last:border-0">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2 font-medium">
                          {row.label}
                          {risky && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"><AlertTriangle className="size-3" /> risky</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{row.help}</div>
                      </td>
                      {COLUMNS.map((c) => {
                        const a = row.actions.find((x) => x.action === c.action)
                        if (!a) return <td key={c.action} className="px-2 py-2.5 text-center text-muted-foreground/50">—</td>
                        const on = !!g[a.key]
                        return (
                          <td key={c.action} className="px-2 py-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={!editable}
                              onChange={() => toggle(row, a.key)}
                              aria-label={`${row.label}: ${c.label}`}
                              className={cn("size-4 accent-[var(--primary)]", a.risky && on && "accent-amber-600")}
                            />
                          </td>
                        )
                      })}
                      <td className="px-4 py-2.5">
                        {!scope ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : SCOPED.has(row.resource) ? (
                          <NativeSelect value={scope} disabled={!editable} onChange={(e) => setScope(row, e.target.value as Scope)} className="h-8 w-40 text-xs" aria-label={`${row.label}: which records`}>
                            {(["own", "team", "all"] as const).map((s) => (
                              <option key={s} value={s}>{SCOPE_LABEL[s]}</option>
                            ))}
                          </NativeSelect>
                        ) : (
                          <span className="text-xs text-muted-foreground">Everything</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid content-start gap-6">
          {!data.locked && (
            <Panel title="Discount limit" description="The highest discount this role gives without an Admin's approval.">
              <Field label="Up to (%)">
                <Input id="role-limit" type="number" min={0} max={100} value={limit ?? String(data.discountLimitPercent)} disabled={!editable} onChange={(e) => setLimit(e.target.value)} />
              </Field>
            </Panel>
          )}
          <Panel title="What this means">
            {data.locked ? (
              <p className="text-sm text-muted-foreground">Everything in the Console.</p>
            ) : summary.length ? (
              <ul className="grid gap-1.5 text-sm">
                {summary.map((s) => (
                  <li key={s.label}><b className="font-medium">{s.label}</b> <span className="text-muted-foreground">— {s.text}</span></li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing yet: people with this role see an empty Console.</p>
            )}
          </Panel>
          <Panel title="People with this role">
            {data.members.length ? (
              <ul className="grid gap-1 text-sm">
                {data.members.map((m) => (
                  <li key={m.id}>{m.name} <span className="text-muted-foreground">· {m.email}</span></li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nobody yet. Give someone this role from Team.</p>
            )}
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "reset"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Reset ${data.name} to its default permissions?`}
        description="Your changes to this role are replaced by the permissions it came with."
        confirmLabel="Reset"
        onConfirm={async () => (await reset(), setConfirm(null))}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${data.name}?`}
        description="The role is removed. Nobody has it right now."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => (await remove(), setConfirm(null))}
      />
    </Page>
  )
}
