"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, Building2, Copy, Plus } from "lucide-react"
import { toast } from "sonner"
import { buttonVariants } from "@/components/ui/button"
import { Chip, ClientStatus, Failed, Page, industryLabel, relDays, type Tone } from "@/components/console/kit"
import { Count, DataTable, FilterSelect, IdCell, type Column, type RowAction } from "@/components/console/data-table"
import { useApi } from "@/lib/use-api"
import { useClientTable } from "@/lib/use-table"
import { useConsoleBase } from "@/lib/console-base"
import { formatDate } from "@/lib/format"
import type { OnboardingRow } from "@/lib/console"

// Onboarding (blueprint Phase B): every business still being set up or waiting for its owner,
// with how far along it is and one click to continue.

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
  const [stage, setStage] = React.useState("")
  const rows = React.useMemo(() => data?.data.filter((r) => !stage || r.stage === stage) ?? null, [data, stage])
  const table = useClientTable(rows, { name: (r) => r.name, owner: (r) => r.owner ?? "", stage: (r) => r.stage, percent: (r) => r.percent, added: (r) => r.createdAt })
  if (error) return <Failed error={error} onRetry={reload} />

  const hrefOf = (r: OnboardingRow) => (r.nextStep ? `${base}/onboarding/${r.id}?step=${r.nextStep}` : `${base}/clients/${r.id}?tab=handover`)
  const columns: Column<OnboardingRow>[] = [
    { key: "id", header: "ID", cell: (r) => <IdCell id={r.id} href={`${base}/clients/${r.id}`} /> },
    { key: "name", header: "Business", always: true, sortable: true, cell: (r) => <div><div className="font-medium">{r.name}</div><div className="text-[12.5px] text-muted-foreground">{industryLabel(r.industryKey)}</div></div> },
    { key: "owner", header: "Owner", sortable: true, cell: (r) => r.owner ?? "—" },
    { key: "stage", header: "Stage", sortable: true, cell: (r) => <Chip tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Chip> },
    {
      key: "percent", header: "Progress", sortable: true,
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${r.percent}%` }} /></span>
          <span className="text-xs tabular-nums text-muted-foreground">{r.percent}%</span>
        </span>
      ),
    },
    { key: "next", header: "Next step", cell: (r) => <span className="text-muted-foreground">{r.nextStep ? NEXT[r.nextStep] : "Owner to accept"}</span> },
    { key: "status", header: "Account", hidden: true, cell: (r) => <ClientStatus status={r.status} /> },
    { key: "added", header: "Added", sortable: true, cell: (r) => <span className="text-muted-foreground" title={formatDate(r.createdAt)}>{relDays(r.createdAt)}</span> },
    { key: "go", header: "", always: true, cell: (r) => <Link href={hrefOf(r)} onClick={(e) => e.stopPropagation()} className={buttonVariants({ size: "sm", variant: r.nextStep ? "default" : "outline" })}>{r.nextStep ? "Continue" : "Open"}</Link> },
  ]
  const actions = (r: OnboardingRow): RowAction[] => [
    { label: r.nextStep ? `Continue: ${NEXT[r.nextStep]}` : "Open handover", icon: ArrowRight, href: hrefOf(r) },
    { label: "Open business", icon: Building2, href: `${base}/clients/${r.id}` },
    { label: "Copy ID", icon: Copy, separator: true, onClick: () => navigator.clipboard.writeText(r.id).then(() => toast.success("ID copied")) },
  ]
  const waiting = data?.data.filter((r) => r.stage !== "setting_up").length ?? 0

  return (
    <Page
      wide
      eyebrow="Workspace"
      title="Onboarding"
      subtitle="Businesses being set up, and handovers the owner hasn't accepted yet."
      actions={
        <Link href={`${base}/clients/new`} className={buttonVariants()}>
          <Plus /> Onboard business
        </Link>
      }
    >
      <DataTable
        id="onboarding"
        label="Onboarding"
        table={table}
        columns={columns}
        actions={actions}
        onRowClick={(r) => router.push(hrefOf(r))}
        searchFields={[{ key: "name", label: "Business" }, { key: "owner", label: "Owner" }]}
        summary={data && <><Count tone="blue" n={data.data.length - waiting} label="Setting up" /><Count tone="amber" n={waiting} label="With the owner" /></>}
        filters={<FilterSelect value={stage} onChange={setStage} label="Stage" options={[["", "Any stage"], ...Object.entries(STAGE).map(([k, v]) => [k, v.label] as [string, string])]} />}
        empty="Nothing in progress. When you onboard a business and continue its set-up, it stays here until the owner accepts the handover."
      />
    </Page>
  )
}
