"use client"

import * as React from "react"
import { brandColorError, themePreset, type WorkspacePreferences } from "@contracts/workspace"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/form"
import { BrandFields } from "@/components/console/brand-editor"
import { useBrandingPreview } from "@/components/workspace-branding"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { StepFooter, StepHeader, useStepSave, type StepProps } from "./wizard"

type Branding = WorkspacePreferences["branding"]

export function BrandingStep({ workspace, refresh, complete, back }: StepProps) {
  const { reload } = useAuth()
  const [b, setB] = React.useState<Branding>(workspace.preferences.branding)
  const [custom, setCustom] = React.useState(themePreset(b.preset).primary === b.brandColor ? "" : b.brandColor)
  const { saving, error, run } = useStepSave()
  const customError = custom ? brandColorError(custom.startsWith("#") ? custom : `#${custom}`) : null
  const colorError = brandColorError(b.brandColor)
  // The page shows the look as it is picked
  useBrandingPreview(b)

  const save = () =>
    run(async () => {
      if (colorError) return
      await api.put("/tenant/preferences/branding", b)
      await Promise.all([refresh(), reload()])
      await complete("done")
    })

  return (
    <form
      className="flex min-h-full flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <StepHeader title="Make it yours" description="Choose the look for your team. The page changes as you click. Light, dark or system is each person's own switch in the top bar." />
      <BrandFields
        value={b}
        onChange={(next) => {
          setB(next)
          if (next.preset !== b.preset) setCustom("")
        }}
      />
      <section id="colour" className="max-w-md">
        <Field label="Your own brand colour" error={customError} hint="Optional. A hex code like #7C2D12, dark enough for white text. Also used on invoices.">
          <Input
            value={custom}
            placeholder="#"
            maxLength={7}
            className="w-32 font-mono uppercase"
            onChange={(e) => {
              const raw = e.target.value.trim()
              setCustom(raw)
              const hex = raw.startsWith("#") ? raw : `#${raw}`
              if (/^#[0-9A-Fa-f]{6}$/.test(hex) && !brandColorError(hex)) setB((x) => ({ ...x, brandColor: hex.toUpperCase() }))
              if (!raw) setB((x) => ({ ...x, brandColor: themePreset(x.preset).primary }))
            }}
          />
        </Field>
      </section>
      <StepFooter back={back} onSkip={() => void complete("skipped")} saving={saving} error={error ?? colorError} />
    </form>
  )
}
