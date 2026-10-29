"use client"

import * as React from "react"
import { toast } from "sonner"
import { BadgeIndianRupee, CalendarPlus, Layers, MoreHorizontal, Send, UserCog } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ConvertDialog } from "@/components/console/convert-dialog"
import { ChangePlanDialog, ExtendDialog, SourceDialog } from "@/components/console/client-dialogs"
import { ActivityAndNotes, GettingStarted, HandoverPanel, ModulesPanel, OwnerPanel, PlanAndPayments, SetupAndUsage, UsersPanel } from "@/components/console/client-sections"
import { ClientStateChip, Failed, Loading, Page, PageTabs, Stat, StatGrid, industryLabel } from "@/components/console/kit"
import { useRouter, useSearchParams } from "next/navigation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatNumber } from "@/lib/format"
import type { ClientDetail } from "@/lib/console"
import { useConsoleBase } from "@/lib/console-base"

// Business page (blueprint S2): a header with the actions, then tabs with their own links
// (?tab=…): Overview, Plan & billing, Users, Activity & notes. One button per action.

type Tab = "overview" | "plan" | "handover" | "users" | "activity"

const of = (used: number, max: number | null | undefined) => `${formatNumber(used)} / ${max === null || max === undefined ? "∞" : formatNumber(max)}`

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <React.Suspense>
      <BusinessPage params={params} />
    </React.Suspense>
  )
}

function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const router = useRouter()
  const search = useSearchParams()
  const base = useConsoleBase()
  const { me, canConsole } = useAuth()
  const { data: c, error, reload } = useApi<ClientDetail>(`/console/tenants/${id}`)
  const [dialog, setDialog] = React.useState<"extend" | "convert" | "source" | "plan" | null>(null)
  const [sending, setSending] = React.useState(false)
  const audience = me?.console?.audience ?? "team"
  const vendor = audience === "vendor"
  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "plan", label: "Plan & billing" },
    ...(canConsole("platform.tenant.create") ? [{ key: "handover" as const, label: "Handover" }] : []),
    ...(vendor ? [] : [{ key: "users" as const, label: "Users" }, { key: "activity" as const, label: "Activity & notes" }]),
  ]
  const asked = search.get("tab") as Tab | null
  const tab: Tab = asked && tabs.some((t) => t.key === asked) ? asked : "overview"
  const setTab = (t: Tab) => router.replace(t === "overview" ? `${base}/clients/${id}` : `${base}/clients/${id}?tab=${t}`, { scroll: false })

  if (error) return <Failed error={error} onRetry={reload} />
  if (!c) return <Loading rows={6} className="mx-auto max-w-6xl" />

  const partnerBilled = c.billedBy === "partner"
  const unpaid = c.orders.find((o) => o.status === "awaiting_payment")
  const waitingApproval = c.orders.find((o) => o.status === "pending_approval")
  const canExtend = !partnerBilled && canConsole("platform.grace.create") && (c.status === "trialing" || c.status === "past_due")
  const canConvert = !partnerBilled && audience !== "partner" && canConsole("platform.tenant.create") && ["trialing", "free", "past_due"].includes(c.status) && !unpaid && !waitingApproval
  const canChangePlan = audience === "partner" && canConsole("platform.tenant.edit")
  // Only an Admin changes "Onboarded by"
  const canSource = me?.console?.role.key === "super_admin" && !partnerBilled

  async function resendLink() {
    if (!unpaid) return
    setSending(true)
    try {
      await api.post(`/console/orders/${unpaid.id}/payment-link`, { resend: true })
      toast.success(`Payment link sent to ${c!.owner?.email || "the owner"}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  // The single most useful action right now goes first, as the primary button
  const primary = unpaid && canConsole("platform.payment.view") ? (
    <Button onClick={resendLink} disabled={sending}>
      <Send /> {sending ? "Sending…" : "Send payment link again"}
    </Button>
  ) : canConvert ? (
    <Button onClick={() => setDialog("convert")}>
      <BadgeIndianRupee /> Convert to paid
    </Button>
  ) : canChangePlan ? (
    <Button onClick={() => setDialog("plan")}>
      <Layers /> Change plan
    </Button>
  ) : null

  return (
    <Page
      back={{ href: `${base}/clients`, label: vendor || me?.console?.role.key === "console_sales" ? "My businesses" : "Businesses" }}
      title={
        <span className="flex flex-wrap items-center gap-3">
          {c.name}
          <ClientStateChip status={c.status} progress={c.progress} trialEndsAt={c.subscription?.trialEndsAt} partnerBilled={partnerBilled} />
        </span>
      }
      subtitle={[industryLabel(c.industryKey), c.subscription?.plan && c.status !== "free" && c.status !== "trialing" ? `${c.subscription.plan.name} · ${c.subscription.cycle}` : null, `since ${formatDate(c.createdAt)}`].filter(Boolean).join(" · ")}
      actions={
        <>
          {canExtend && (
            <Button variant="outline" onClick={() => setDialog("extend")}>
              <CalendarPlus /> {c.status === "trialing" ? "Extend trial" : "More time to pay"}
            </Button>
          )}
          {primary}
          {canSource && (
            <DropdownMenu>
              <DropdownMenuTrigger className="grid size-9 place-items-center rounded-lg border hover:bg-muted" aria-label="More actions">
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDialog("source")}>
                  <UserCog className="size-4" /> Change who onboarded them
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      }
    >
      {waitingApproval && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          The discount on this business&apos;s order is waiting for an Admin&apos;s approval. The payment link goes out once it&apos;s approved.
        </div>
      )}
      {c.isInternal && <p className="text-sm text-muted-foreground">This is AHEAD&apos;s own workspace.</p>}

      <PageTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "overview" && (
        <>
          {c.usage && (
            <StatGrid>
              <Stat label="Users" value={of(c.usage.activeUsers, c.subscription?.plan?.limits.users)} hint="Active people in the business" />
              <Stat label="Branches" value={of(c.usage.branches, c.subscription?.plan?.limits.branches)} />
              <Stat label="Invoices this month" value={of(c.usage.thisMonth.invoices ?? 0, c.subscription?.plan?.limits.invoicesPerMonth)} />
              <Stat label="Modules on" value={`${c.modules.filter((m) => m.status === "active").length} / ${c.modules.length}`} hint={c.modules.some((m) => m.status === "read_only") ? "Some are read-only" : undefined} />
            </StatGrid>
          )}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="grid content-start gap-6 lg:col-span-2">
              {!vendor && <SetupAndUsage tenantId={c.id} />}
              {vendor && <ModulesPanel client={c} />}
            </div>
            <div className="grid content-start gap-6">
              <GettingStarted client={c} canResend={canConsole("platform.tenant.view")} />
              <OwnerPanel client={c} showContact />
            </div>
          </div>
        </>
      )}
      {tab === "plan" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <PlanAndPayments client={c} />
          <ModulesPanel client={c} />
        </div>
      )}
      {tab === "handover" && <HandoverPanel client={c} base={base} />}
      {tab === "users" && <UsersPanel tenantId={c.id} />}
      {tab === "activity" && <ActivityAndNotes tenantId={c.id} />}

      {dialog === "extend" && <ExtendDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} onDone={reload} />}
      {dialog === "convert" && <ConvertDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "source" && <SourceDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} onDone={reload} />}
      {dialog === "plan" && <ChangePlanDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} onDone={reload} />}
    </Page>
  )
}
