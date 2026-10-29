"use client"

import { Failed, Loading, Page } from "@/components/console/kit"
import { ReferralCard } from "@/components/console/referral-card"
import { useApi } from "@/lib/use-api"

// Vendors and salespeople: their own link and code. Signups with either count as theirs.

export default function ReferralPage() {
  const { data, error, reload } = useApi<{ code: string; link: string }>("/console/referral")
  return (
    <Page eyebrow="Workspace" title="My link & code" subtitle="Share either one. A business that signs up with it is added to your businesses automatically.">
      {error ? <Failed error={error} onRetry={reload} /> : !data ? <Loading rows={2} /> : <ReferralCard {...data} />}
    </Page>
  )
}
