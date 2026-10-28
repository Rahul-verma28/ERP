"use client"

import { PartnerBillPanel } from "@/components/console/partner-bill"
import { Failed, Loading, Page, Stat, money } from "@/components/console/kit"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import type { PartnerBill } from "@/lib/console"

// Partner › Billing: what AHEAD will bill this month — every live client at the list price minus
// the partner's discount. The partner sets its own price to its clients.

export default function BillingPage() {
  const { me } = useAuth()
  const { data, error, reload } = useApi<PartnerBill>("/console/billing")
  const month = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date())
  return (
    <Page title="Billing" subtitle={`What AHEAD bills ${me?.console?.partner?.name ?? "you"} for ${month}. You set your own price to your clients.`}>
      {error && <Failed error={error} onRetry={reload} />}
      {!data ? (
        !error && <Loading rows={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Live clients" value={data.lines.length} />
            <Stat label="Your discount" value={`${data.discountPercent}%`} hint="off AHEAD's list price" />
            <Stat label="This month's total" value={money(data.totalPaise)} hint={`with ${data.gstRatePercent}% GST`} />
          </div>
          <PartnerBillPanel bill={data} linkClients />
          <p className="text-[13px] text-muted-foreground">This total updates as you add clients or change their plans. AHEAD&apos;s team sends you the invoice for the month.</p>
        </>
      )}
    </Page>
  )
}
