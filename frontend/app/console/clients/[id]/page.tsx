"use client"

import * as React from "react"
import { toast } from "sonner"
import { BadgeIndianRupee, CalendarPlus, Layers, MoreHorizontal, Send, UserCog } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ConvertDialog } from "@/components/console/convert-dialog"
import { ChangePlanDialog, ExtendDialog, SourceDialog } from "@/components/console/client-dialogs"
import { ActivityAndNotes, NextStep, OwnerPanel, PlanAndPayments, SetupAndUsage, UsersPanel } from "@/components/console/client-sections"
import { ClientStatus, Failed, Loading, Page, daysFrom, industryLabel } from "@/components/console/kit"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate } from "@/lib/format"
import { ACQUIRER_LABEL, type ClientDetail } from "@/lib/console"

// One page per client: who they are, where they stand, and the one thing to do next.

function statusSuffix(c: ClientDetail) {
  if (c.status !== "trialing" || !c.subscription?.trialEndsAt) return undefined
  const d = daysFrom(c.subscription.trialEndsAt) ?? 0
  return d <= 0 ? "ends today" : `${d} day${d === 1 ? "" : "s"} left`
}

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { me, canConsole } = useAuth()
  const { data: c, error, reload } = useApi<ClientDetail>(`/console/tenants/${id}`)
  const [dialog, setDialog] = React.useState<"extend" | "convert" | "source" | "plan" | null>(null)
  const [sending, setSending] = React.useState(false)
  const audience = me?.console?.audience ?? "team"

  if (error) return <Failed error={error} onRetry={reload} />
  if (!c) return <Loading rows={6} className="mx-auto max-w-6xl" />

  const partnerBilled = c.billedBy === "partner"
  const unpaid = c.orders.find((o) => o.status === "awaiting_payment")
  const waitingApproval = c.orders.find((o) => o.status === "pending_approval")
  const canExtend = !partnerBilled && canConsole("platform.grace.create") && (c.status === "trialing" || c.status === "past_due")
  const canConvert = !partnerBilled && audience !== "partner" && canConsole("platform.tenant.create") && ["trialing", "free", "past_due"].includes(c.status) && !unpaid && !waitingApproval
  const canChangePlan = audience === "partner" && canConsole("platform.tenant.edit")
  const canSource = audience === "team" && canConsole("platform.tenant.edit") && !partnerBilled
  const a = c.acquisition
  const broughtBy = c.partner ? `${c.partner.name} (partner)` : a?.by ? a.by.name : a ? ACQUIRER_LABEL[a.byType] : null

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
      back={{ href: "/console/clients", label: audience === "vendor" ? "My clients" : "Clients" }}
      title={
        <span className="flex flex-wrap items-center gap-3">
          {c.name}
          <ClientStatus status={c.status} suffix={statusSuffix(c)} partnerBilled={c.billedBy === "partner"} />
        </span>
      }
      subtitle={[industryLabel(c.industryKey), `joined ${formatDate(c.createdAt)}`, broughtBy && audience === "team" ? `brought in by ${broughtBy}` : null].filter(Boolean).join(" · ")}
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
                  <UserCog className="size-4" /> Change who brought them in
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      }
    >
      {waitingApproval && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          The discount on this client&apos;s order is waiting for a Super Admin&apos;s approval. The payment link goes out once it&apos;s approved.
        </div>
      )}
      {c.isInternal && <p className="text-sm text-muted-foreground">This is AHEAD&apos;s own workspace.</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <PlanAndPayments client={c} />
          <ActivityAndNotes tenantId={c.id} />
        </div>
        <div className="grid content-start gap-6">
          <OwnerPanel client={c} showContact={audience !== "vendor"} />
          {audience === "team" && canConsole("platform.prospect.view") && <NextStep tenantId={c.id} />}
          {audience !== "vendor" && <SetupAndUsage tenantId={c.id} />}
          {audience !== "vendor" && <UsersPanel tenantId={c.id} />}
        </div>
      </div>

      {dialog === "extend" && <ExtendDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} onDone={reload} />}
      {dialog === "convert" && <ConvertDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "source" && <SourceDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} onDone={reload} />}
      {dialog === "plan" && <ChangePlanDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} onDone={reload} />}
    </Page>
  )
}
