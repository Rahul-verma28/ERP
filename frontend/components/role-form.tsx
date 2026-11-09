"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Check, Copy, ShieldCheck } from "lucide-react"
import { SENSITIVE_FIELDS, rolePermissionProblem } from "@contracts/account"
import { changeReason } from "@contracts/validation"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { SearchInput } from "@/components/common"
import { Field, FormError, NativeSelect } from "@/components/form"
import { ErrorState, NoAccess } from "@/components/page-states"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { MODULE_NAV } from "@/lib/nav"
import { useApi } from "@/lib/use-api"
import type { Role, Scope } from "@/lib/types"
import { cn } from "@/lib/utils"

// Create / edit a role on one page: a tab per module, and under it one card per feature with
// what this role can do. Predefined roles open read-only; clone one to change it.

interface Permission {
  key: string
  moduleKey: string
  resource: string
  action: string
  label: string
}

interface RoleDetail extends Role {
  isCustom: boolean
  version: number
  permissions: Record<string, Scope>
  fieldAccess: Record<string, FieldLevel>
  members: { memberId: string; name: string; email: string; status: string }[]
}

type FieldLevel = "hidden" | "read" | "write"

interface Feature {
  id: string
  module: string
  label: string
  actions: { action: string; key: string }[]
}

const SCOPES: { key: Scope; label: string }[] = [
  { key: "all", label: "All records" },
  { key: "branch", label: "Own branch" },
  { key: "team", label: "Own team" },
  { key: "own", label: "Own records" },
]
const MODULE_LABEL: Record<string, string> = { tenant: "General", ...Object.fromEntries(MODULE_NAV.map((m) => [m.key, m.label])) }
/** Only the Owner can close the business, so no role can be given this */
const OWNER_ONLY = "tenant.account.delete"
const SENSITIVE_TAB = "__sensitive"
const PEOPLE_TAB = "__people"

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")

function buildFeatures(permissions: Permission[]): Feature[] {
  const map = new Map<string, Feature>()
  for (const p of permissions) {
    if (p.key === OWNER_ONLY) continue
    const id = `${p.moduleKey}.${p.resource}`
    const f = map.get(id) ?? { id, module: p.moduleKey, label: p.label, actions: [] }
    f.actions.push({ action: p.action, key: p.key })
    map.set(id, f)
  }
  return [...map.values()]
}

export function RoleForm({ roleId, fromId }: { roleId?: string; fromId?: string | null }) {
  const { can } = useAuth()
  const router = useRouter()
  const allowed = can("tenant.role.view")
  const perms = useApi<{ data: Permission[] }>(allowed ? "/permissions" : null)
  const sourceId = roleId ?? fromId ?? null
  const source = useApi<RoleDetail>(allowed && sourceId ? `/roles/${sourceId}` : null)

  const [name, setName] = React.useState<string | null>(null)
  const [description, setDescription] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Record<string, Scope> | null>(null)
  const [fields, setFields] = React.useState<Record<string, FieldLevel> | null>(null)
  const [tab, setTab] = React.useState("tenant")
  const [search, setSearch] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const features = React.useMemo(() => buildFeatures(perms.data?.data ?? []), [perms.data])
  const catalog = React.useMemo(() => (perms.data?.data ?? []).map((p) => p.key), [perms.data])
  const modules = React.useMemo(() => [...new Set(features.map((f) => f.module))], [features])

  if (!allowed) return <NoAccess what="Roles" />
  const loadError = perms.error ?? source.error
  if (loadError) return <ErrorState error={loadError} onRetry={source.error ? source.reload : perms.reload} />
  if (!perms.data || (sourceId && !source.data)) return <Skeleton className="h-[520px] rounded-xl" />

  const data = source.data
  const isEdit = !!roleId
  const editable = isEdit ? !!data?.isCustom && can("tenant.role.edit") : can("tenant.role.create")
  const current = draft ?? data?.permissions ?? {}
  const access = fields ?? data?.fieldAccess ?? {}
  const people = isEdit ? (data?.members.length ?? 0) : 0
  const shownName = name ?? (data ? (isEdit ? data.name : `${data.name} (copy)`) : "")
  const shownDescription = description ?? (isEdit ? (data?.description ?? "") : "")
  const selected = Object.keys(current).filter((k) => k !== OWNER_ONLY).length
  const problem = rolePermissionProblem(Object.keys(current), catalog)
  const q = search.trim().toLowerCase()
  const visible = q ? features.filter((f) => f.label.toLowerCase().includes(q) || (MODULE_LABEL[f.module] ?? "").toLowerCase().includes(q) || f.actions.some((a) => a.action.includes(q))) : features.filter((f) => f.module === tab)
  const countIn = (m: string) => features.filter((f) => f.module === m).flatMap((f) => f.actions).filter((a) => current[a.key]).length
  const totalIn = (m: string) => features.filter((f) => f.module === m).flatMap((f) => f.actions).length

  const scopeOf = (f: Feature): Scope => {
    const k = f.actions.find((a) => current[a.key])
    return (k && current[k.key]) || "all"
  }
  const keyOf = (f: Feature, action: string) => f.actions.find((a) => a.action === action)?.key
  const toggle = (f: Feature, action: string, on: boolean) => {
    const next = { ...current }
    const scope = scopeOf(f)
    const key = keyOf(f, action)!
    const view = keyOf(f, "view")
    const edit = keyOf(f, "edit")
    const del = keyOf(f, "delete")
    if (on) {
      next[key] = scope
      if (action !== "view" && view) next[view] = scope
      if (action === "delete" && edit) next[edit] = scope
    } else {
      delete next[key]
      if (action === "view") for (const a of f.actions) delete next[a.key]
      if (action === "edit" && del) delete next[del]
    }
    setDraft(next)
  }
  const setFeature = (list: Feature[], on: boolean) => {
    const next = { ...current }
    for (const f of list) {
      const scope = scopeOf(f)
      for (const a of f.actions) {
        if (on) next[a.key] = scope
        else delete next[a.key]
      }
    }
    setDraft(next)
  }
  const setScope = (f: Feature, scope: Scope) => {
    const next = { ...current }
    for (const a of f.actions) if (next[a.key]) next[a.key] = scope
    setDraft(next)
  }

  const save = async () => {
    const n = shownName.trim()
    if (n.length < 2 || n.length > 40) return setErrors({ name: "Use 2–40 characters" })
    if (people > 0 && changeReason(reason)) return setErrors({ reason: changeReason(reason) ?? "Add a reason" })
    setBusy(true)
    setErrors({})
    setFormError(null)
    try {
      const details = { name: n, description: shownDescription.trim() || null, permissions: current, fieldAccess: access }
      if (isEdit) await api.patch(`/roles/${roleId}`, { version: data!.version, ...details, ...(people > 0 ? { reason: reason.trim() } : {}) })
      else await api.post("/roles", { ...details, fromRoleId: fromId ?? null })
      toast.success(isEdit ? `${n} saved` : `${n} created`)
      router.push("/app/settings/roles")
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") setFormError("Someone else changed this role. Reload to see their changes — yours aren't saved.")
      else if (e instanceof ApiError && Object.keys(e.fields).length) {
        setErrors(e.fields)
        setFormError(e.fields.permissions ?? e.fields.fieldAccess ?? null)
      } else setFormError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const heading = isEdit ? (editable ? `Edit ${data!.name}` : data!.name) : "Create New Role"
  const moduleFeatures = features.filter((f) => f.module === tab)
  const moduleAll = moduleFeatures.length > 0 && moduleFeatures.every((f) => f.actions.every((a) => current[a.key]))

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight">{heading}</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{editable ? "Name the role and choose what it can do in each module." : "This is a ready-made role, so it can't be changed. Clone it to make your own."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/app/settings/roles" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft /> Back
          </Link>
          {isEdit && !editable && data!.key !== "owner" && can("tenant.role.create") && (
            <Link href={`/app/settings/roles/new?from=${roleId}`} className={buttonVariants()}>
              <Copy /> Clone role
            </Link>
          )}
        </div>
      </div>

      <section className="ui-surface grid gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-4 text-primary" /> Role details
          </h2>
          <Badge variant="secondary">
            {selected} permission{selected === 1 ? "" : "s"} selected
          </Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Role name" required error={errors.name}>
            <Input value={shownName} disabled={!editable} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Store Manager" />
          </Field>
          <Field label="Description" error={errors.description}>
            <Input value={shownDescription} disabled={!editable} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="What this person does" />
          </Field>
        </div>
      </section>

      <section className="ui-surface grid gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Module permissions</h2>
            <p className="text-[13px] text-muted-foreground">Pick a module, then tick what this role is allowed to do.</p>
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search features…" className="w-full sm:w-64" />
        </div>

        {!q && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Modules">
            {modules.map((m) => {
              const n = countIn(m)
              return (
                <button key={m} type="button" role="tab" aria-selected={tab === m} onClick={() => setTab(m)} className={cn("flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted", tab === m && "border-primary bg-primary text-primary-foreground hover:bg-primary")}>
                  {MODULE_LABEL[m] ?? title(m)}
                  {n > 0 && <span className={cn("rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary tabular-nums", tab === m && "bg-white/25 text-primary-foreground")}>{n}</span>}
                </button>
              )
            })}
            <button type="button" role="tab" aria-selected={tab === SENSITIVE_TAB} onClick={() => setTab(SENSITIVE_TAB)} className={cn("rounded-xl border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted", tab === SENSITIVE_TAB && "border-primary bg-primary text-primary-foreground hover:bg-primary")}>
              Sensitive fields
            </button>
            {isEdit && (
              <button type="button" role="tab" aria-selected={tab === PEOPLE_TAB} onClick={() => setTab(PEOPLE_TAB)} className={cn("rounded-xl border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted", tab === PEOPLE_TAB && "border-primary bg-primary text-primary-foreground hover:bg-primary")}>
                Users ({people})
              </button>
            )}
          </div>
        )}

        {!q && modules.includes(tab) && editable && (
          <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] font-medium">
            <input type="checkbox" className="size-4 accent-primary" checked={moduleAll} onChange={(e) => setFeature(moduleFeatures, e.target.checked)} />
            Select everything in {MODULE_LABEL[tab] ?? title(tab)}
            <span className="font-normal text-muted-foreground">
              ({countIn(tab)} of {totalIn(tab)})
            </span>
          </label>
        )}

        {(q || modules.includes(tab)) && (
          <div className="grid gap-3 xl:grid-cols-2">
            {visible.map((f) => {
              const on = f.actions.filter((a) => current[a.key]).length
              const hasView = keyOf(f, "view")
              const hasEdit = keyOf(f, "edit")
              return (
                <div key={f.id} className="rounded-2xl border p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className={cn("flex items-center gap-2 font-semibold", editable && "cursor-pointer")}>
                      <input type="checkbox" className="size-4 accent-primary disabled:opacity-50" disabled={!editable} checked={on === f.actions.length} onChange={(e) => setFeature([f], e.target.checked)} aria-label={`All of ${f.label}`} />
                      {f.label}
                      {q && <span className="text-xs font-normal text-muted-foreground">· {MODULE_LABEL[f.module] ?? title(f.module)}</span>}
                    </label>
                    <div className="flex items-center gap-2">
                      {on > 0 && f.module !== "tenant" && (
                        <NativeSelect className="h-7 w-[120px] text-xs" aria-label={`Which ${f.label} records`} value={scopeOf(f)} disabled={!editable} onChange={(e) => setScope(f, e.target.value as Scope)}>
                          {SCOPES.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                        </NativeSelect>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {on} / {f.actions.length}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2 pl-6">
                    {f.actions.map((a) => {
                      const locked = !editable || (a.action !== "view" && !!hasView && !current[hasView]) || (a.action === "delete" && !!hasEdit && !current[hasEdit])
                      // A tick needs its parent action, so it stays clickable and turns that on too
                      const disabled = !editable
                      return (
                        <label key={a.key} className={cn("flex items-center gap-1.5 text-[13px]", !disabled && "cursor-pointer", locked && !current[a.key] && "text-muted-foreground")}>
                          <input type="checkbox" className="size-4 accent-primary disabled:opacity-50" disabled={disabled} checked={!!current[a.key]} onChange={(e) => toggle(f, a.action, e.target.checked)} aria-label={`${title(a.action)} ${f.label}`} />
                          {title(a.action)}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {!visible.length && <p className="py-8 text-center text-sm text-muted-foreground xl:col-span-2">No features match.</p>}
          </div>
        )}

        {!q && tab === SENSITIVE_TAB && (
          <div className="grid gap-2">
            <p className="text-[13px] text-muted-foreground">Hidden fields don&apos;t appear on screens, prints or exports for this role.</p>
            {SENSITIVE_FIELDS.map((f) => {
              const key = `${f.entity}.${f.field}`
              return (
                <div key={key} className="flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold">{f.label}</div>
                    <div className="text-xs text-muted-foreground">{f.hint}</div>
                  </div>
                  <NativeSelect className="h-8 w-28 text-xs" aria-label={`${f.label} access`} value={access[key] ?? "hidden"} disabled={!editable} onChange={(e) => setFields({ ...access, [key]: e.target.value as FieldLevel })}>
                    <option value="hidden">Hidden</option>
                    <option value="read">Read</option>
                    <option value="write">Edit</option>
                  </NativeSelect>
                </div>
              )
            })}
          </div>
        )}

        {!q && tab === PEOPLE_TAB && (
          <div className="grid gap-1.5">
            {data?.members.length ? (
              data.members.map((m) => (
                <div key={m.memberId} className="flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 text-[13px]">
                  <div>
                    <div className="font-semibold">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </div>
                  <span className="text-xs text-muted-foreground capitalize">{m.status}</span>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">Nobody has this role yet.</p>
            )}
          </div>
        )}
        {problem && <FormError message={problem} />}
      </section>

      {editable && (
        <div className="ui-surface sticky bottom-3 z-20 flex flex-wrap items-start justify-end gap-2 p-3">
          {people > 0 && (
            <div className="min-w-[240px] flex-1">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Reason, this changes access for ${people} ${people === 1 ? "person" : "people"}`} aria-label="Reason for the change" aria-invalid={!!errors.reason} />
              {errors.reason && <p className="mt-1 text-xs text-destructive">{errors.reason}</p>}
            </div>
          )}
          <FormError message={formError} />
          <Link href="/app/settings/roles" className={buttonVariants({ variant: "outline" })}>
            Cancel
          </Link>
          <Button onClick={save} disabled={busy || !!problem}>
            <Check /> {busy ? "Saving…" : isEdit ? "Save changes" : "Create role"}
          </Button>
        </div>
      )}
    </div>
  )
}
