"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/app-shell"
import { useApi } from "@/lib/use-api"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDate, formatNumber, formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ModuleEntitlement, ModuleKey, PlanLimits, TenantStatus } from "@/lib/types"

interface Plans {
  plans: { key: string; name: string; tagline: string; limits: PlanLimits; fullModules: ModuleKey[]; monthlyPaise: number | null; yearlyPaise: number | null }[]
  modules: { key: ModuleKey; name: string; freeTier: boolean }[]
}

interface Subscription {
  status: TenantStatus
  planKey: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  limits: PlanLimits
  modules: Record<ModuleKey, ModuleEntitlement>
  usage: { users: number; branches: number }
}

const STATUS_LABEL: Record<TenantStatus, string> = {
  incomplete: "Awaiting payment",
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment due",
  free: "Free plan",
  closed: "Closed",
  purged: "Closed",
}

interface PendingOrder {
  kind: "fresh" | "renewal"
  status: "pending_approval" | "awaiting_payment"
  totalPaise: number
  taxPaise: number
  expiresAt: string
  paymentLinkUrl: string | null
}

const limit = (n: number | null) => (n === null ? "Unlimited" : formatNumber(n))

export default function BillingPage() {
  const plans = useApi<Plans>("/billing/plans")
  const sub = useApi<Subscription>("/billing/subscription")
  const [cycle, setCycle] = React.useState<"monthly" | "yearly">("monthly")
  const { can } = useAuth()
  const due = useApi<PendingOrder | null>("/billing/pending-order")
  const [opening, setOpening] = React.useState(false)

  if (!plans.data || !sub.data) return <Skeleton className="h-96 rounded-4xl" />
  const s = sub.data
  const currentKey = s.status === "trialing" ? null : s.planKey

  return (
    <>
      <PageHeader title="Plan & billing" description="Prices exclude 18% GST. Change plans anytime; upgrades apply immediately." />

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {STATUS_LABEL[s.status]}
            {s.status !== "trialing" && <Badge variant="secondary">{plans.data.plans.find((p) => p.key === s.planKey)?.name}</Badge>}
          </CardTitle>
          <CardDescription>
            {s.status === "trialing" && s.trialEndsAt && `All modules unlocked until ${formatDate(s.trialEndsAt)}. After that you move to the Free plan — nothing is deleted.`}
            {s.status === "free" && "Free core modules stay active. Paid-module data is read-only until you upgrade."}
            {s.status === "active" && s.currentPeriodEnd && `Renews on ${formatDate(s.currentPeriodEnd)}.`}
            {s.status === "incomplete" && "Your workspace is ready. Modules open as soon as the payment below is received."}
            {s.status === "past_due" && "The last renewal is unpaid. Everything keeps working during the grace period."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Usage label="Users" used={s.usage.users} max={s.limits.users} />
          <Usage label="Branches" used={s.usage.branches} max={s.limits.branches} />
        </CardContent>
      </Card>

      {due.data && (
        <Card className="mb-8 border-primary">
          <CardHeader>
            <CardTitle>{due.data.kind === "renewal" ? "Renewal due" : "Payment due"} · {formatPaise(due.data.totalPaise)}</CardTitle>
            <CardDescription>
              {due.data.status === "pending_approval"
                ? "Your AHEAD contact is finalising this order. You'll get a payment link shortly."
                : `Includes ${formatPaise(due.data.taxPaise)} GST. Pay by ${formatDate(due.data.expiresAt)}${due.data.kind === "renewal" ? " to keep every module running." : " to open your modules."}`}
            </CardDescription>
          </CardHeader>
          {due.data.status === "awaiting_payment" && can("tenant.billing.edit") && (
            <CardFooter>
              <Button
                disabled={opening}
                onClick={async () => {
                  setOpening(true)
                  try {
                    const url = due.data!.paymentLinkUrl ?? (await api.post<{ url: string }>("/billing/pending-order/link")).url
                    window.location.href = url
                  } catch (e) {
                    toast.error(errorMessage(e))
                    setOpening(false)
                  }
                }}
              >
                {opening ? "Opening…" : `Pay ${formatPaise(due.data.totalPaise)}`}
              </Button>
            </CardFooter>
          )}
        </Card>
      )}

      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Plans</h2>
        <div className="inline-flex rounded-full bg-muted p-1 text-sm" role="radiogroup" aria-label="Billing cycle">
          {(["monthly", "yearly"] as const).map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={cycle === c}
              onClick={() => setCycle(c)}
              className={cn("rounded-full px-3 py-1 capitalize", cycle === c && "bg-background font-medium shadow-sm")}
            >
              {c}
              {c === "yearly" && <span className="ml-1 text-xs text-muted-foreground">2 months free</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.data.plans
          .filter((p) => p.key !== "enterprise")
          .map((p) => {
            const price = cycle === "monthly" ? p.monthlyPaise : p.yearlyPaise
            const isCurrent = currentKey === p.key
            const recommended = p.key === "professional"
            return (
              <Card key={p.key} className={cn(recommended && "ring-2 ring-primary")}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {p.name} {recommended && <Badge>Recommended</Badge>}
                  </CardTitle>
                  <CardDescription>{p.tagline}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <p>
                    <span className="text-3xl font-semibold">{price === null ? "Custom" : formatPaise(price, true)}</span>
                    {price !== null && price > 0 && <span className="text-sm text-muted-foreground"> /{cycle === "monthly" ? "month" : "year"}</span>}
                  </p>
                  <ul className="grid gap-1.5 text-sm">
                    <li className="flex gap-2"><Check className="size-4 shrink-0" /> {p.limits.users} users, {p.limits.branches} branch{p.limits.branches === 1 ? "" : "es"}</li>
                    <li className="flex gap-2"><Check className="size-4 shrink-0" /> {limit(p.limits.invoicesPerMonth)} invoices / month</li>
                    <li className="flex gap-2"><Check className="size-4 shrink-0" /> {limit(p.limits.contacts)} customers</li>
                    {p.limits.aiCredits > 0 && <li className="flex gap-2"><Check className="size-4 shrink-0" /> {formatNumber(p.limits.aiCredits)} AI credits / month</li>}
                    <li className="flex gap-2 text-muted-foreground">
                      <Check className="size-4 shrink-0" />
                      {p.fullModules.length ? plans.data!.modules.filter((m) => p.fullModules.includes(m.key) && !m.freeTier).map((m) => m.name).join(", ") || "Full core modules" : "Free core modules"}
                    </li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button className="w-full" variant={isCurrent ? "outline" : "default"} disabled title={isCurrent ? undefined : "Online checkout is not connected yet"}>
                    {isCurrent ? "Current plan" : p.key === "free" ? "Included" : "Checkout coming soon"}
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Online payment (Razorpay, UPI AutoPay) is the next billing milestone. Need Enterprise or an offline invoice? Contact AHEAD sales.
      </p>
    </>
  )
}

function Usage({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = Math.min(100, (used / max) * 100)
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {used} of {max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemax={max}>
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-destructive" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
