"use client"

import * as React from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineSave } from "@/components/save-bar"
import { ErrorState, NoAccess } from "@/components/page-states"
import { SettingsPage } from "@/components/settings-shell"
import type { SetupTenant, Workspace } from "@/components/setup/wizard"
import { ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useWorkspaceData } from "@/lib/use-workspace"
import { cn } from "@/lib/utils"

/**
 * Settings › Module settings › <module>: the settings are read from the workspace, edited as one
 * draft, checked, and saved together with one Save (only when something changed).
 */
export interface ModuleSettingsProps<D> {
  draft: D
  set: (patch: Partial<D>) => void
  errors: Record<string, string>
  editable: boolean
  tenant: SetupTenant
  workspace: Workspace
}

export function ModuleSettingsPage<D extends Record<string, unknown>>({
  title,
  description,
  read,
  check,
  save,
  children,
}: {
  title: string
  description: string
  read: (w: Workspace) => D
  /** Field → message for anything wrong (empty when fine) */
  check?: (d: D) => Record<string, string>
  /** Save what changed (the draft and what is stored now) */
  save: (draft: D, saved: D) => Promise<void>
  children: (p: ModuleSettingsProps<D>) => React.ReactNode
}) {
  const { can } = useAuth()
  const { tenant, workspace, error, refresh } = useWorkspaceData()
  if (!can("tenant.settings.view")) return <NoAccess what={`${title} settings`} />
  const readOnly = !can("tenant.settings.edit")
  return (
    <SettingsPage title={title} description={description} actions={readOnly ? <Badge variant="outline">View only</Badge> : undefined}>
      {error && (!tenant || !workspace) ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : !tenant || !workspace ? (
        <div className="grid gap-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : (
        // Keyed by what is stored: after a save the draft starts again from it
        <Draft key={JSON.stringify(read(workspace))} tenant={tenant} workspace={workspace} refresh={refresh} read={read} check={check} save={save} readOnly={readOnly} title={title}>
          {children}
        </Draft>
      )}
    </SettingsPage>
  )
}

function Draft<D extends Record<string, unknown>>({ tenant, workspace, refresh, read, check, save, readOnly, title, children }: {
  tenant: SetupTenant
  workspace: Workspace
  refresh: () => Promise<void>
  read: (w: Workspace) => D
  check?: (d: D) => Record<string, string>
  save: (draft: D, saved: D) => Promise<void>
  readOnly: boolean
  title: string
  children: (p: ModuleSettingsProps<D>) => React.ReactNode
}) {
  const saved = read(workspace)
  const [draft, setDraft] = React.useState(saved)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const set = (patch: Partial<D>) => {
    setDraft((d) => ({ ...d, ...patch }))
    // A field being fixed loses its old message
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))))
  }
  const submit = async () => {
    const problems = check?.(draft) ?? {}
    setErrors(problems)
    if (Object.keys(problems).length) return toast.error("Fix the highlighted settings first.")
    setSaving(true)
    try {
      await save(draft, saved)
      await refresh()
      toast.success(`${title} settings saved`)
    } catch (e) {
      // A message for a field on this page shows beside it; any other is said out loud
      const own = e instanceof ApiError ? Object.fromEntries(Object.entries(e.fields).filter(([k]) => k in draft)) : {}
      if (Object.keys(own).length) setErrors(own)
      else toast.error(e instanceof ApiError && Object.keys(e.fields).length ? Object.values(e.fields)[0] : errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="grid gap-4">
      {children({ draft, set, errors, editable: !readOnly && !saving, tenant, workspace })}
      <div className={cn(dirty && "sticky bottom-3 z-10 rounded-xl border bg-background/95 px-4 pb-3 shadow-lg backdrop-blur")}>
        <InlineSave dirty={dirty} saving={saving} onDiscard={() => { setDraft(saved); setErrors({}) }} onSave={() => void submit()} saveLabel="Save changes" />
      </div>
    </div>
  )
}

/** Only the keys whose value differs from what is stored */
export function changed<T extends Record<string, unknown>>(draft: T, saved: T): Partial<T> {
  return Object.fromEntries(Object.entries(draft).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(saved[k]))) as Partial<T>
}

/** "" ↔ null for optional day counts */
export const daysText = (v: number | null) => (v == null ? "" : String(v))
export const daysValue = (v: string) => (v === "" ? null : Number(v))
export const daysError = (v: string, min: number, max: number, required = false) => {
  if (v === "") return required ? `Enter ${min} to ${max}` : null
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? null : `Enter ${min} to ${max}`
}
