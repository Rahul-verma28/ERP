"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Check, Loader2 } from "lucide-react"
import { SETUP_STEPS, type SetupStepKey } from "@contracts/workspace"
import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/page-states"
import { BrandingStep } from "@/components/setup/branding-step"
import { DataStep } from "@/components/setup/data-step"
import { DocumentsStep } from "@/components/setup/documents-step"
import { DoneStep } from "@/components/setup/done-step"
import { ProfileStep } from "@/components/setup/profile-step"
import { TaxesStep } from "@/components/setup/taxes-step"
import { TeamStep } from "@/components/setup/team-step"
import type { SetupTenant, StepProps, Workspace } from "@/components/setup/wizard"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { initials } from "@/lib/format"
import { useApi } from "@/lib/use-api"
import { cn } from "@/lib/utils"

// Setup wizard (wireframes 2.1–2.7): owner-only, every step skippable and resumable.

type Key = SetupStepKey | "done"
const STEP_COMPONENT: Record<SetupStepKey, React.ComponentType<StepProps>> = {
  profile: ProfileStep,
  documents: DocumentsStep,
  taxes: TaxesStep,
  data: DataStep,
  team: TeamStep,
  branding: BrandingStep,
}

export default function SetupPage() {
  return (
    <React.Suspense fallback={<div className="grid min-h-svh place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}>
      <SetupWizard />
    </React.Suspense>
  )
}

function SetupWizard() {
  const router = useRouter()
  const params = useSearchParams()
  const { me, can } = useAuth()
  const tenant = useApi<SetupTenant>("/tenant")
  const workspace = useApi<Workspace>("/tenant/workspace")
  const [current, setCurrent] = React.useState<Key | null>(null)
  const [leaving, setLeaving] = React.useState(false)
  const allowed = can("tenant.settings.edit")

  React.useEffect(() => {
    if (me && !allowed) router.replace("/app")
  }, [me, allowed, router])

  const states = workspace.data?.setup.steps ?? {}
  const firstOpen = (SETUP_STEPS.find((s) => !states[s.key])?.key ?? "done") as Key
  const requested = params.get("step") as Key | null
  const step: Key = current ?? (requested && (requested === "done" || SETUP_STEPS.some((s) => s.key === requested)) ? requested : firstOpen)
  const index = step === "done" ? SETUP_STEPS.length : SETUP_STEPS.findIndex((s) => s.key === step)

  if (tenant.error || workspace.error) return <ErrorState error={tenant.error ?? workspace.error} onRetry={() => void Promise.all([tenant.reload(), workspace.reload()])} />
  if (!tenant.data || !workspace.data || !me) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    )
  }

  const refresh = async () => {
    await Promise.all([tenant.reload(), workspace.reload()])
  }
  const goTo = (k: Key) => {
    setCurrent(k)
    window.scrollTo({ top: 0 })
  }
  const complete = (key: SetupStepKey) => async (state: "done" | "skipped") => {
    await api.patch("/tenant/setup", { step: key, state })
    await workspace.reload()
    const nextIndex = SETUP_STEPS.findIndex((s) => s.key === key) + 1
    goTo((SETUP_STEPS[nextIndex]?.key ?? "done") as Key)
  }
  const finishLater = async () => {
    setLeaving(true)
    await api.patch("/tenant/setup", { action: "defer" }).catch(() => undefined)
    router.replace("/app")
  }

  const doneCount = SETUP_STEPS.filter((s) => states[s.key] === "done").length
  const skipped = SETUP_STEPS.filter((s) => states[s.key] === "skipped").length
  const Step = step === "done" ? null : STEP_COMPONENT[step]

  return (
    <div className="flex min-h-svh flex-col bg-card">
      <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">{initials(tenant.data.name)}</span>
        <span className="font-semibold">Set up {tenant.data.name}</span>
        <span className="hidden text-sm text-muted-foreground sm:inline">
          · {doneCount} of {SETUP_STEPS.length + 1} done{skipped ? ` · ${skipped} skipped` : ""}{SETUP_STEPS.length - doneCount - skipped > 0 ? ` · about ${SETUP_STEPS.length - doneCount - skipped} minute${SETUP_STEPS.length - doneCount - skipped > 1 ? "s" : ""}` : ""}
        </span>
        <Button variant="ghost" className="ml-auto" onClick={() => void finishLater()} disabled={leaving}>
          {leaving ? "Saving…" : "Finish later"}
        </Button>
      </header>
      <div className="flex w-full flex-1">
        <nav className="hidden w-64 shrink-0 border-r bg-background/60 p-4 md:block" aria-label="Setup steps">
          <ol className="grid gap-1">
            {[...SETUP_STEPS, { key: "done" as const, label: "Done", neededForInvoices: false }].map((s, i) => {
              const st = s.key === "done" ? undefined : states[s.key]
              const active = s.key === step
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => goTo(s.key)}
                    aria-current={active ? "step" : undefined}
                    className={cn("flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted", active && "bg-primary/10 font-semibold text-foreground")}
                  >
                    <span
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-full border-[1.5px] text-[11px] font-bold",
                        st === "done" && "border-emerald-600 bg-emerald-600 text-white",
                        st === "skipped" && "border-dashed border-muted-foreground/60",
                        active && st !== "done" && "border-primary bg-primary text-primary-foreground"
                      )}
                    >
                      {st === "done" ? <Check className="size-3.5" /> : i + 1}
                    </span>
                    <span className="flex-1">{s.label}</span>
                    {st === "skipped" && <span className="text-[10px] text-muted-foreground">Skipped</span>}
                    {s.neededForInvoices && st !== "done" && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100">For invoices</span>}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>
        <main className="flex min-w-0 flex-1 flex-col px-4 pt-6 sm:px-8">
          <p className="mb-4 text-xs text-muted-foreground md:hidden">
            Step {Math.min(index + 1, SETUP_STEPS.length + 1)} of {SETUP_STEPS.length + 1}
          </p>
          {Step ? (
            <Step key={step} stepKey={step as SetupStepKey} tenant={tenant.data} workspace={workspace.data} refresh={refresh} complete={complete(step as SetupStepKey)} back={index > 0 ? () => goTo(SETUP_STEPS[index - 1].key) : null} />
          ) : (
            <DoneStep workspace={workspace.data} goTo={goTo} />
          )}
        </main>
      </div>
    </div>
  )
}
