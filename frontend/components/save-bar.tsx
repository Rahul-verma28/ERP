"use client"

import * as React from "react"
import { Loader2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DiscardChangesDialog } from "@/components/form"
import { useUnsavedChanges } from "@/lib/use-unsaved"
import { cn } from "@/lib/utils"

// The bar that rises from the bottom of a settings page once something changed: Discard puts the
// saved values back, Save sends them. Nothing is saved while you flip switches or type, and
// leaving the page with changes asks first.

export function SaveBar({ dirty, saving, onSave, onDiscard, label = "You have unsaved changes", saveLabel = "Save changes", disabled }: {
  dirty: boolean
  saving?: boolean
  onSave: () => void
  onDiscard: () => void
  label?: string
  saveLabel?: string
  disabled?: boolean
}) {
  const guard = useUnsavedChanges(dirty && !saving)
  return (
    <>
      <div
        aria-hidden={!dirty}
        className={cn(
          "pointer-events-none sticky bottom-4 z-20 mt-6 flex justify-center transition-all duration-200",
          dirty ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        )}
      >
        <div className={cn("flex w-full max-w-2xl flex-wrap items-center gap-3 rounded-2xl border bg-popover/95 px-4 py-3 shadow-lg backdrop-blur", dirty && "pointer-events-auto")}>
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium"><span className="size-2 shrink-0 rounded-full bg-amber-500" />{label}</span>
          <Button type="button" variant="ghost" onClick={onDiscard} disabled={!dirty || saving} tabIndex={dirty ? 0 : -1}><RotateCcw /> Discard</Button>
          <Button type="button" onClick={onSave} disabled={!dirty || saving || disabled} tabIndex={dirty ? 0 : -1}>{saving && <Loader2 className="animate-spin" />} {saving ? "Saving…" : saveLabel}</Button>
        </div>
      </div>
      <DiscardChangesDialog open={guard.leaving} onKeep={guard.stay} onDiscard={guard.leave} />
    </>
  )
}

/** The same, inside a card: a row with Discard and Save that shows only once something changed */
export function InlineSave({ dirty, saving, onSave, onDiscard, saveLabel = "Save", disabled, className }: {
  dirty: boolean
  saving?: boolean
  onSave: () => void
  onDiscard: () => void
  saveLabel?: string
  disabled?: boolean
  className?: string
}) {
  const guard = useUnsavedChanges(dirty && !saving)
  return (
    <>
      {dirty && (
        <div className={cn("flex flex-wrap items-center justify-end gap-2 border-t pt-3", className)}>
          <span className="mr-auto flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400"><span className="size-1.5 rounded-full bg-amber-500" />Not saved yet</span>
          <Button type="button" size="sm" variant="ghost" onClick={onDiscard} disabled={saving}>Discard</Button>
          <Button type="button" size="sm" onClick={onSave} disabled={saving || disabled}>{saving && <Loader2 className="animate-spin" />} {saving ? "Saving…" : saveLabel}</Button>
        </div>
      )}
      <DiscardChangesDialog open={guard.leaving} onKeep={guard.stay} onDiscard={guard.leave} />
    </>
  )
}
