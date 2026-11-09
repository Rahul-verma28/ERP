"use client"

import * as React from "react"
import { toast } from "sonner"
import { BrandingStep } from "@/components/setup/branding-step"
import { SettingsStepPage } from "@/components/settings-step-page"
import { LogoUpload } from "@/components/logo-upload"
import type { SetupTenant } from "@/components/setup/wizard"
import { api, errorMessage } from "@/lib/api"

export default function BrandingSettingsPage() {
  return (
    <SettingsStepPage
      title="Branding"
      description="Logo, colour theme and font for everyone in the business. Light, dark or system is each person's own switch in the top bar."
      stepKey="branding"
      Step={BrandingStep}
      before={(p) => <LogoCard {...p} />}
    />
  )
}

function LogoCard({ tenant, refresh, readOnly }: { tenant: SetupTenant; refresh: () => Promise<void>; readOnly: boolean }) {
  const [saving, setSaving] = React.useState(false)
  const save = async (url: string) => {
    setSaving(true)
    try {
      await api.patch("/tenant", { logoUrl: url || null, expectedUpdatedAt: tenant.updatedAt })
      await refresh()
      toast.success(url ? "Logo saved" : "Logo removed")
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <section id="logo" className="grid gap-3 ui-surface p-5">
      <div>
        <h2 className="text-[15px] font-bold">Logo</h2>
        <p className="text-xs text-muted-foreground">Printed on invoices and shown in the menu. PNG, JPG or WebP; it&apos;s resized for you.</p>
      </div>
      <LogoUpload value={tenant.logoUrl ?? ""} onChange={save} disabled={readOnly || saving} />
    </section>
  )
}
