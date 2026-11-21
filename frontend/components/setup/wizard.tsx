"use client"

import * as React from "react"
import type { SetupState, SetupStepKey, WorkspacePreferences, WorkspaceProfile } from "@contracts/workspace"
import { ArrowLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DiscardChangesDialog, FormError } from "@/components/form"
import { useUnsavedChanges } from "@/lib/use-unsaved"

// Shared types and chrome for the setup wizard steps (wireframes 2.1–2.7).

export interface SetupTenant {
  name: string
  legalName: string | null
  gstin: string | null
  billingStateCode: string | null
  logoUrl: string | null
  fyStartMonth: number
  address: { line1?: string; line2?: string; city?: string; state?: string; pincode?: string } | null
  updatedAt: string
}

export interface Workspace {
  profile: WorkspaceProfile & { industry?: string; composition?: boolean }
  preferences: WorkspacePreferences
  setup: SetupState
}

export interface StepProps {
  tenant: SetupTenant
  workspace: Workspace
  /** Reload tenant + workspace after a save */
  refresh: () => Promise<void>
  /** Mark the step and move to the next one */
  complete: (state: "done" | "skipped") => Promise<void>
  back: (() => void) | null
  stepKey: SetupStepKey
}

/** The same step forms also open in Settings, without the wizard's header, Back and Skip. */
export const StepMode = React.createContext<"wizard" | "settings">("wizard")

export function StepHeader({ title, description }: { title: string; description?: string }) {
  const mode = React.useContext(StepMode)
  if (mode === "settings") return null
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}

/** Back · Skip for now · Save & continue — the wizard's sticky footer. */
export function StepFooter({ back, onSkip, saving, error, saveLabel = "Save & continue", note, dirty }: { back: (() => void) | null; onSkip?: () => void; saving: boolean; error?: string | null; saveLabel?: string; note?: React.ReactNode; /** Settings: Save works only once something changed */ dirty?: boolean }) {
  const mode = React.useContext(StepMode)
  if (mode === "settings") return <SettingsFooter saving={saving} error={error} note={note} dirty={dirty} />
  return <WizardFooter back={back} onSkip={onSkip} saving={saving} error={error} saveLabel={saveLabel} note={note} />
}

function SettingsFooter({ saving, error, note, dirty }: { saving: boolean; error?: string | null; note?: React.ReactNode; dirty?: boolean }) {
  const guard = useUnsavedChanges(!!dirty && !saving)
  {
    return (
      <div className="mt-2 grid gap-2">
        <FormError message={error} />
        <DiscardChangesDialog open={guard.leaving} onKeep={guard.stay} onDiscard={guard.leave} />
        <div className="flex items-center justify-end gap-2">
          {note && <span className="mr-auto text-xs text-muted-foreground">{note}</span>}
          {dirty === false && !note && <span className="mr-auto text-xs text-muted-foreground">No changes to save</span>}
          {dirty && <span className="mr-auto flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400"><span className="size-1.5 rounded-full bg-amber-500" />Not saved yet</span>}
          <Button type="submit" disabled={saving || dirty === false}>
            {saving ? (
              <>
                <Loader2 className="animate-spin" /> Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </div>
    )
  }
}

function WizardFooter({ back, onSkip, saving, error, saveLabel, note }: { back: (() => void) | null; onSkip?: () => void; saving: boolean; error?: string | null; saveLabel: string; note?: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-4 mt-auto grid gap-2 border-t bg-background/95 px-4 py-4 backdrop-blur sm:-mx-8 sm:px-8">
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        {back ? (
          <Button type="button" variant="outline" onClick={back} disabled={saving}>
            <ArrowLeft /> Back
          </Button>
        ) : null}
        {note && <span className="hidden text-xs text-muted-foreground sm:inline">{note}</span>}
        <div className="ml-auto flex gap-2">
          {onSkip && (
            <Button type="button" variant="ghost" onClick={onSkip} disabled={saving}>
              Skip for now
            </Button>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="animate-spin" /> Saving…
              </>
            ) : (
              saveLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Run a save; field errors stay on the form (useForm), anything else shows in the footer. */
export function useStepSave() {
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setSaving(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Please try again.")
    } finally {
      setSaving(false)
    }
  }
  return { saving, error, run, setError }
}
