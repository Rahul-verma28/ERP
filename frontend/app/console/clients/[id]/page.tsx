"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { AlertTriangle, BadgeIndianRupee, CalendarPlus, Copy, Layers, Mail, MessageCircle, MoreHorizontal, Phone, Send, UserCog } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ConvertDialog } from "@/components/console/convert-dialog"
import { ChangePlanDialog, ExtendDialog, SourceDialog } from "@/components/console/client-dialogs"
import { ActivityAndNotes, GettingStarted, HandoverPanel, ModulesPanel, PlanAndPayments, RecentActivity, SetupAndUsage, UsersPanel } from "@/components/console/client-sections"
import { ClientStateChip, Chip, Failed, Loading, OnboardedChip, PageTabs, Panel, ago, industryLabel, money, relDays } from "@/components/console/kit"
import { useRouter, useSearchParams } from "next/navigation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate, formatNumber, GST_STATES, initials } from "@/lib/format"
import type { ClientDetail, ClientSummary } from "@/lib/console"
import { useConsoleBase } from "@/lib/console-base"
import { ChangePlanPaidDialog, ModulesWithSwitches, PendingChangeNotice } from "@/components/console/plan-tools"
import { cn } from "@/lib/utils"

// Business page (blueprint S2, redesigned): a header card with who the business is, what it
// needs and the key numbers; a details column (business, owner, subscription) that stays in
// view; and tabs with their own links (?tab=…) for the rest.

type Tab = "overview" | "plan" | "handover" | "users" | "activity"

const HEALTH_TONE: Record<string, string> = { good: "text-emerald-700 dark:text-emerald-400", errors: "text-red-700 dark:text-red-400", limit: "text-amber-700 dark:text-amber-400", no_invoice: "text-amber-700 dark:text-amber-400", quiet: "text-muted-foreground" }

const shortId = (id: string) => `#${id.replace(/-/g, "").slice(-6).toUpperCase()}`
const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`), () => toast.error(`Couldn't copy the ${what.toLowerCase()}`))

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
  const audience = me?.console?.audience ?? "team"
  const vendor = audience === "vendor"
  const summary = useApi<ClientSummary>(vendor ? null : `/console/tenants/${id}/summary`)
  const [dialog, setDialog] = React.useState<"extend" | "convert" | "source" | "plan" | "paidPlan" | null>(null)
  const [sending, setSending] = React.useState(false)
  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "plan", label: "Plan & billing" },
    ...(vendor ? [] : [{ key: "users" as const, label: "Users" }]),
    ...(canConsole("platform.tenant.create") ? [{ key: "handover" as const, label: "Handover" }] : []),
    ...(vendor ? [] : [{ key: "activity" as const, label: "Activity & notes" }]),
  ]
  const asked = search.get("tab") as Tab | null
  const tab: Tab = asked && tabs.some((t) => t.key === asked) ? asked : "overview"
  const setTab = (t: Tab) => router.replace(t === "overview" ? `${base}/clients/${id}` : `${base}/clients/${id}?tab=${t}`, { scroll: false })

  if (error) return <Failed error={error} onRetry={reload} />
  if (!c) return <Loading rows={8} className="mx-auto max-w-[90rem]" />

  const partnerBilled = c.billedBy === "partner"
  const unpaid = c.orders.find((o) => o.status === "awaiting_payment")
  const waitingApproval = c.orders.find((o) => o.status === "pending_approval")
  const canExtend = !partnerBilled && canConsole("platform.grace.create") && (c.status === "trialing" || c.status === "past_due")
  const canConvert = !partnerBilled && audience !== "partner" && canConsole("platform.tenant.create") && ["trialing", "free", "past_due"].includes(c.status) && !unpaid && !waitingApproval
  const canChangePlan = audience === "partner" && canConsole("platform.tenant.edit")
  // Phase D: AHEAD's paying businesses change plan here (pro-rated upgrade, or at renewal)
  const canChangePaid = !partnerBilled && audience !== "partner" && canConsole("platform.tenant.edit") && c.status === "active" && !unpaid && !waitingApproval
  // Module switches: people who edit all businesses (Admin, Staff), never partners or sales
  const canSwitch = audience === "team" && me?.console?.permissions["platform.tenant.edit"] === "all"
  // Only an Admin changes "Onboarded by"
  const canSource = me?.console?.role.key === "super_admin" && !partnerBilled
  const sub = c.subscription
  const s = summary.data

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
    <Button onClick={resendLink} disabled={sending}><Send /> {sending ? "Sending…" : "Send payment link again"}</Button>
  ) : canConvert ? (
    <Button onClick={() => setDialog("convert")}><BadgeIndianRupee /> Convert to paid</Button>
  ) : canChangePlan ? (
    <Button onClick={() => setDialog("plan")}><Layers /> Change plan</Button>
  ) : canChangePaid ? (
    <Button onClick={() => setDialog("paidPlan")}><Layers /> Change plan</Button>
  ) : null

  // The date that matters most for this business
  const nextDate =
    c.status === "trialing" && sub?.trialEndsAt ? { label: "Trial ends", value: formatDate(sub.trialEndsAt), hint: relDays(sub.trialEndsAt) }
    : c.status === "past_due" && sub?.graceEndsAt ? { label: "Must pay by", value: formatDate(sub.graceEndsAt), hint: relDays(sub.graceEndsAt), warn: true }
    : sub?.currentPeriodEnd && !partnerBilled ? { label: sub.cancelAtPeriodEnd ? "Ends on" : "Renews", value: formatDate(sub.currentPeriodEnd), hint: relDays(sub.currentPeriodEnd) }
    : { label: "Next date", value: "—" }
  const planText = c.status === "free" ? "Free" : c.status === "trialing" ? `Trial${sub?.plan ? ` · ${sub.plan.name}` : ""}` : sub?.plan?.name ?? "—"
  const usersMax = sub?.plan?.limits.users

  // What needs doing, in plain words
  const alerts: { tone: "amber" | "red"; text: string }[] = []
  if (waitingApproval) alerts.push({ tone: "amber", text: "The discount on this business's order is waiting for an Admin's approval. The payment link goes out once it's approved." })
  if (unpaid) alerts.push({ tone: "amber", text: `An order of ${money(unpaid.totalPaise)} is waiting for payment. It cancels ${relDays(unpaid.expiresAt)}.` })
  if (c.status === "past_due") alerts.push({ tone: "red", text: `A renewal was missed. Paid modules lock ${sub?.graceEndsAt ? relDays(sub.graceEndsAt) : "soon"} unless they pay.` })
  if (c.progress && !c.progress.loggedIn) alerts.push({ tone: "amber", text: c.progress.linkSentAt ? `The owner hasn't signed in yet. Login link sent ${formatDate(c.progress.linkSentAt)}.` : "The owner hasn't been sent a login link yet." })

  return (
    <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-5">
      <Link href={`${base}/clients`} className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
        ← {vendor || me?.console?.role.key === "console_sales" ? "My businesses" : "Businesses"}
      </Link>

      {/* Header card */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-wrap items-start gap-4 p-5 sm:p-6">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground">{initials(c.name)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[24px] leading-tight font-semibold tracking-tight">{c.name}</h1>
              <ClientStateChip status={c.status} progress={c.progress} trialEndsAt={sub?.trialEndsAt} partnerBilled={partnerBilled} />
              {c.isInternal && <Chip tone="grey">AHEAD&apos;s own</Chip>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              <button type="button" onClick={() => copy(c.id, "Business ID")} title="Copy the full business ID" className="inline-flex items-center gap-1 font-mono hover:text-foreground">{shortId(c.id)} <Copy className="size-3" /></button>
              <span>{industryLabel(c.industryKey)}</span>
              <span>Since {formatDate(c.createdAt)}</span>
              <span className="inline-flex items-center gap-1.5">Onboarded by <OnboardedChip by={c.onboardedBy} /></span>
              {partnerBilled && c.partner && <span>Partner: <Link href={`/console/partners/${c.partner.id}`} className="font-medium text-foreground hover:underline">{c.partner.name}</Link></span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canExtend && <Button variant="outline" onClick={() => setDialog("extend")}><CalendarPlus /> {c.status === "trialing" ? "Extend trial" : "More time to pay"}</Button>}
            {primary}
            {canSource && (
              <DropdownMenu>
                <DropdownMenuTrigger className="grid size-9 place-items-center rounded-lg border hover:bg-muted" aria-label="More actions"><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setDialog("source")}><UserCog className="size-4" /> Change who onboarded them</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        {/* Key numbers */}
        <dl className="grid grid-cols-2 border-t sm:grid-cols-3 xl:grid-cols-6 [&>div]:border-b [&>div]:px-5 [&>div]:py-3.5 sm:[&>div]:border-r">
          <KeyNumber label="Plan" value={planText} hint={sub && c.status !== "trialing" && c.status !== "free" && !partnerBilled ? (sub.cycle === "yearly" ? "Yearly" : "Monthly") : partnerBilled ? "Billed by the partner" : undefined} />
          <KeyNumber label="Per month" value={s?.mrr ? money(s.mrr) : "—"} hint={s?.mrr ? "Before GST" : undefined} />
          <KeyNumber label={nextDate.label} value={nextDate.value} hint={nextDate.hint} warn={nextDate.warn} />
          <KeyNumber label="Users" value={`${formatNumber(c.usage.activeUsers)}${usersMax ? ` / ${formatNumber(usersMax)}` : ""}`} hint={s ? `${s.users.activeThisWeek} active this week` : undefined} />
          <KeyNumber label="Last active" value={c.progress?.lastActiveAt ? ago(c.progress.lastActiveAt) : "Never"} hint={c.owner?.lastLoginAt ? `Owner ${ago(c.owner.lastLoginAt).toLowerCase()}` : "Owner not signed in"} />
          <KeyNumber label="Health" value={s ? <span className={HEALTH_TONE[s.health.flag]}>{s.health.label}</span> : "—"} hint={s ? `Setup ${s.setup.done} of ${s.setup.total}` : undefined} />
        </dl>
      </section>

      {alerts.length > 0 && (
        <div className="grid gap-2">
          {alerts.map((a) => (
            <div key={a.text} className={cn("flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm", a.tone === "red" ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200")}>
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {a.text}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        {/* Details column */}
        <aside className="grid content-start gap-4 lg:sticky lg:top-20 lg:self-start">
          <Panel title="Business">
            <Details
              rows={[
                ["Business ID", <button key="id" type="button" onClick={() => copy(c.id, "Business ID")} className="inline-flex items-center gap-1 font-mono text-[12.5px] hover:text-primary" title={c.id}>{shortId(c.id)} <Copy className="size-3" /></button>],
                ["Legal name", c.legalName],
                ["GSTIN", c.gstin ? <span key="g" className="font-mono text-[12.5px]">{c.gstin}</span> : null],
                ["State", c.billingStateCode ? GST_STATES.find(([code]) => code === c.billingStateCode)?.[1] ?? c.billingStateCode : null],
                ["Industry", industryLabel(c.industryKey)],
                ["Started as", c.onboardingType === "trial" ? "Free trial" : "Paid from day one"],
                ["Billed by", partnerBilled ? c.partner?.name ?? "Partner" : "AHEAD"],
                ["Created", formatDate(c.createdAt)],
              ]}
            />
          </Panel>
          <Panel title="Owner">
            {c.owner ? (
              <div className="grid gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{initials(c.owner.name)}</span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.owner.name}</div>
                    <div className="text-xs text-muted-foreground">{c.owner.lastLoginAt ? `Signed in ${ago(c.owner.lastLoginAt).toLowerCase()}` : "Not signed in yet"}</div>
                  </div>
                </div>
                {!vendor && (
                  <div className="grid gap-1.5 text-[13px]">
                    <Contact icon={Mail} value={c.owner.email} href={`mailto:${c.owner.email}`} onCopy={() => copy(c.owner!.email, "Email")} note={c.owner.emailVerified ? undefined : "not verified"} />
                    <Contact icon={Phone} value={c.owner.mobile.replace(/^[+]91/, "+91 ")} href={`tel:${c.owner.mobile}`} onCopy={() => copy(c.owner!.mobile, "Mobile")} />
                    <a href={`https://wa.me/${c.owner.mobile.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-emerald-700 hover:underline dark:text-emerald-400">
                      <MessageCircle className="size-3.5" /> Message on WhatsApp
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No owner on record.</p>
            )}
          </Panel>
          <Panel title="Subscription">
            <Details
              rows={[
                ["Status", <ClientStateChip key="s" status={c.status} progress={null} trialEndsAt={sub?.trialEndsAt} partnerBilled={partnerBilled} />],
                ["Plan", planText],
                ["Cycle", sub && c.status !== "free" && c.status !== "trialing" ? (sub.cycle === "yearly" ? "Yearly" : "Monthly") : null],
                ["Trial ends", c.status === "trialing" && sub?.trialEndsAt ? `${formatDate(sub.trialEndsAt)} · ${relDays(sub.trialEndsAt)}` : null],
                ["Paid until", sub?.currentPeriodEnd && !partnerBilled ? formatDate(sub.currentPeriodEnd) : null],
                ["Must pay by", sub?.graceEndsAt ? formatDate(sub.graceEndsAt) : null],
                ["Changes to", c.pendingChange ? `${c.pendingChange.planName} · ${c.pendingChange.cycle} on ${formatDate(c.pendingChange.effectiveAt)}` : null],
                ["Modules on", `${c.modules.filter((m) => m.status === "active").length} of ${c.modules.length}`],
                ["Coupon", c.acquisition?.couponCode ?? null],
                ["Referral code", c.acquisition?.referralCode ?? null],
              ]}
            />
            <button type="button" onClick={() => setTab("plan")} className="mt-3 text-[13px] font-medium text-primary hover:underline">Plan, orders and modules →</button>
          </Panel>
        </aside>

        {/* Tabs */}
        <div className="grid min-w-0 content-start gap-5">
          <PageTabs tabs={tabs} active={tab} onChange={setTab} />
          {tab === "overview" && (
            <>
              <UsageCards client={c} />
              <div className="grid gap-5 xl:grid-cols-2">
                <GettingStarted client={c} canResend={canConsole("platform.tenant.view")} />
                {!vendor ? <SetupAndUsage tenantId={c.id} /> : <ModulesPanel client={c} />}
              </div>
              {!vendor && <ModulesPanel client={c} />}
              {!vendor && <RecentActivity tenantId={c.id} onAll={() => setTab("activity")} />}
            </>
          )}
          {tab === "plan" && (
            <>
              <PendingChangeNotice client={c} canEdit={canConsole("platform.tenant.edit") && !partnerBilled} onDone={reload} />
              <div className="grid gap-5 xl:grid-cols-2">
                <PlanAndPayments client={c} />
                <ModulesWithSwitches client={c} canSwitch={!!canSwitch} onChanged={reload} />
              </div>
            </>
          )}
          {tab === "handover" && <HandoverPanel client={c} base={base} />}
          {tab === "users" && <UsersPanel tenantId={c.id} />}
          {tab === "activity" && <ActivityAndNotes tenantId={c.id} />}
        </div>
      </div>

      {dialog === "extend" && <ExtendDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} onDone={reload} />}
      {dialog === "convert" && <ConvertDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "source" && <SourceDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} onDone={reload} />}
      {dialog === "paidPlan" && <ChangePlanPaidDialog client={c} onClose={() => setDialog(null)} onDone={() => (setDialog(null), reload())} />}
      {dialog === "plan" && <ChangePlanDialog client={c} open onOpenChange={(o) => !o && setDialog(null)} onDone={reload} />}
    </div>
  )
}

function KeyNumber({ label, value, hint, warn }: { label: string; value: React.ReactNode; hint?: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 truncate text-[15px] font-semibold", warn && "text-red-700 dark:text-red-400")}>{value}</dd>
      {hint && <dd className="truncate text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}

/** Label/value rows; empty values are left out so the card only shows what is known. */
function Details({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-2.5 text-[13px]">
      {rows.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">{k}</dt>
          <dd className="min-w-0 text-right break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Contact({ icon: Icon, value, href, onCopy, note }: { icon: typeof Mail; value: string; href: string; onCopy: () => void; note?: string }) {
  return (
    <div className="group flex min-w-0 items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <a href={href} className="min-w-0 truncate hover:underline">{value}</a>
      {note && <span className="shrink-0 text-[11px] text-amber-700">{note}</span>}
      <button type="button" onClick={onCopy} className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100" aria-label={`Copy ${value}`}>
        <Copy className="size-3" />
      </button>
    </div>
  )
}

/** Use against the plan's limits, with a bar each. */
function UsageCards({ client: c }: { client: ClientDetail }) {
  const limits = c.subscription?.plan?.limits
  const cards: { label: string; used: number; max: number | null | undefined; hint?: string }[] = [
    { label: "Users", used: c.usage.activeUsers, max: limits?.users, hint: "Active people" },
    { label: "Branches", used: c.usage.branches, max: limits?.branches },
    { label: "Invoices this month", used: c.usage.thisMonth.invoices ?? 0, max: limits?.invoicesPerMonth },
    { label: "Modules on", used: c.modules.filter((m) => m.status === "active").length, max: c.modules.length, hint: c.modules.some((m) => m.status === "read_only") ? "Some are read-only" : undefined },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((k) => {
        const pct = k.max ? Math.min(100, Math.round((k.used / k.max) * 100)) : 0
        return (
          <div key={k.label} className="rounded-xl border bg-card p-4">
            <div className="text-[13px] font-medium text-muted-foreground">{k.label}</div>
            <div className="mt-1.5 text-[22px] leading-none font-semibold tabular-nums">
              {formatNumber(k.used)}
              <span className="text-sm font-normal text-muted-foreground"> / {k.max === null || k.max === undefined ? "∞" : formatNumber(k.max)}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", pct >= 90 ? "bg-amber-500" : "bg-primary")} style={{ width: `${k.max ? pct : 0}%` }} />
            </div>
            {k.hint && <div className="mt-2 text-xs text-muted-foreground">{k.hint}</div>}
          </div>
        )
      })}
    </div>
  )
}
