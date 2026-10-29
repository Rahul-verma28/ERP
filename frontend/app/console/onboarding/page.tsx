"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ClipboardCheck, Plus } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { Chip, Empty, Failed, Loading, Page, Panel, industryLabel, relDays, type Tone } from "@/components/console/kit"
import { useApi } from "@/lib/use-api"
import { useConsoleBase } from "@/lib/console-base"
import type { OnboardingRow } from "@/lib/console"

// Onboarding (blueprint Phase B): every business still being set up or waiting for its owner,
// with how far along it is and one button to continue.

const STAGE: Record<OnboardingRow["stage"], { label: string; tone: Tone }> = {
  setting_up: { label: "Setting up", tone: "blue" },
  sent: { label: "Handed over · not signed in", tone: "amber" },
  signed_in: { label: "Signed in · not accepted", tone: "green" },
  accepted: { label: "Accepted", tone: "green" },
}
const NEXT: Record<string, string> = { branding: "Branding", config: "Configuration", import: "Data import", handover: "Review & hand over" }

export default function OnboardingPage() {
  const router = useRouter()
  const base = useConsoleBase()
  const { data, error, reload } = useApi<{ data: OnboardingRow[] }>("/console/onboarding")
  return (
    <Page
      eyebrow="Workspace"
      title="Onboarding"
      subtitle="Businesses being set up, and handovers the owner hasn't accepted yet."
      actions={
        <Link href={`${base}/clients/new`} className={buttonVariants()}>
          <Plus /> Onboard business
        </Link>
      }
    >
      <Panel padded={false}>
        {error ? (
          <div className="p-5"><Failed error={error} onRetry={reload} /></div>
        ) : !data ? (
          <Loading rows={5} className="p-5" />
        ) : !data.data.length ? (
          <Empty icon={ClipboardCheck} title="Nothing in progress" text="When you onboard a business and choose “continue set-up”, it stays here until the owner accepts the handover." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Business</th>
                  <th className="px-3 py-3 font-medium">Owner</th>
                  <th className="px-3 py-3 font-medium">Stage</th>
                  <th className="px-3 py-3 font-medium">Progress</th>
                  <th className="px-3 py-3 font-medium">Next</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.data.map((r) => {
                  const href = r.nextStep ? `${base}/onboarding/${r.id}?step=${r.nextStep}` : `${base}/clients/${r.id}?tab=handover`
                  return (
                    <tr key={r.id} onClick={() => router.push(href)} className="cursor-pointer border-b last:border-0 hover:bg-muted/50">
                      <td className="px-5 py-3">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-[13px] text-muted-foreground">{industryLabel(r.industryKey)} · added {relDays(r.createdAt)}</div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{r.owner ?? "—"}</td>
                      <td className="px-3 py-3"><Chip tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Chip></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${r.percent}%` }} /></span>
                          <span className="text-xs tabular-nums text-muted-foreground">{r.percent}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{r.nextStep ? NEXT[r.nextStep] : "Owner to accept"}</td>
                      <td className="px-5 py-3 text-right">
                        <Link href={href} onClick={(e) => e.stopPropagation()} className={buttonVariants({ size: "sm", variant: r.nextStep ? "default" : "outline" })}>
                          {r.nextStep ? "Continue" : "Open"}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  )
}
