"use client"

import * as React from "react"
import { toast } from "sonner"
import type { SetupStepKey } from "@contracts/workspace"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ErrorState, NoAccess } from "@/components/page-states"
import { SettingsPage } from "@/components/settings-shell"
import { StepMode, type StepProps } from "@/components/setup/wizard"
import { useAuth } from "@/lib/auth"
import { useWorkspaceData } from "@/lib/use-workspace"

/** A setup-wizard step shown as a Settings page (same form, same rules, "Save changes"). */
export function SettingsStepPage({ title, description, stepKey, Step, anchor, before }: { title: string; description: string; stepKey: SetupStepKey; Step: (p: StepProps) => React.ReactNode; anchor?: string; before?: (p: { tenant: StepProps["tenant"]; refresh: () => Promise<void>; readOnly: boolean }) => React.ReactNode }) {
  const { can } = useAuth()
  const { tenant, workspace, error, refresh } = useWorkspaceData()
  if (!can("tenant.settings.view")) return <NoAccess what={title} />
  const readOnly = !can("tenant.settings.edit")
  return (
    <SettingsPage title={title} description={description} actions={readOnly ? <Badge variant="outline">View only</Badge> : undefined}>
      {error && (!tenant || !workspace) ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : !tenant || !workspace ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <>
        {before?.({ tenant, refresh, readOnly })}
        <fieldset id={anchor} disabled={readOnly} className="min-w-0 ui-surface p-5">
          <StepMode.Provider value="settings">
            <Step tenant={tenant} workspace={workspace} refresh={refresh} back={null} stepKey={stepKey} complete={async () => void toast.success(`${title} saved`)} />
          </StepMode.Provider>
        </fieldset>
        </>
      )}
    </SettingsPage>
  )
}
