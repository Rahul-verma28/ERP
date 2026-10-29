"use client"

import * as React from "react"
import Link from "next/link"
import { Activity, AlertTriangle, BadgePercent, Building2, CalendarClock, CheckCircle2, CreditCard, LogIn, Plus, Sparkles, Target, Users, Wallet } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { ClientStatus, Empty, Failed, Loading, Page, Panel, PanelLink, Row, Stat, StatGrid, ago, greeting, industryLabel, money, relDays, type Tone } from "@/components/console/kit"
import { ReferralCard } from "@/components/console/referral-card"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatNumber } from "@/lib/format"
import type { ConsoleHome, HomeTodo } from "@/lib/console"
import { atBase, useConsoleBase } from "@/lib/console-base"
import { cn } from "@/lib/utils"

// Overview (blueprint S1): four numbers, 12 weeks of growth, what needs attention, businesses
// still setting up, plan mix and recent Console activity. Each person sees only their scope.

const TODO: Record<HomeTodo["kind"], { icon: typeof Target; tone: Tone }> = {
  discount: { icon: BadgePercent, tone: "amber" },
  unpaid: { icon: CreditCard, tone: "red" },
  trial: { icon: CalendarClock, tone: "blue" },
  followup: { icon: Target, tone: "blue" },
  setup: { icon: Sparkles, tone: "grey" },
  signin: { icon: LogIn, tone: "red" },
}

const STAT_ICON: Record<string, typeof Building2> = { businesses: Building2, users: Users, paying: Wallet, attention: AlertTriangle, clients: Building2, trial: CalendarClock, live: Building2, bill: Wallet, paid: Wallet }

/** New businesses (line + area) and first payments (dashed) per week, one shared scale */
function GrowthChart({ rows }: { rows: ConsoleHome["growth"] }) {
  const W = 600
  const H = 150
  const PAD = { l: 26, r: 8, t: 10, b: 22 }
  const max = Math.max(2, ...rows.map((r) => Math.max(r.newBusinesses, r.firstPayments)))
  const top = Math.ceil(max / 2) * 2
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(1, rows.length - 1)
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / top)
  const line = (k: "newBusinesses" | "firstPayments") => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(" ")
  const area = `${line("newBusinesses")} L${x(rows.length - 1)},${y(0)} L${x(0)},${y(0)}Z`
  const ticks = [0, top / 2, top]
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
  const last = rows[rows.length - 1]
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[170px] w-full" role="img" aria-label={`New businesses per week, last ${rows.length} weeks: ${rows.map((r) => r.newBusinesses).join(", ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{t}</text>
          </g>
        ))}
        <path d={area} className="fill-primary/10" />
        <path d={line("newBusinesses")} fill="none" className="stroke-primary" strokeWidth={2.5} strokeLinejoin="round" />
        <path d={line("firstPayments")} fill="none" className="stroke-emerald-600 dark:stroke-emerald-400" strokeWidth={2} strokeDasharray="4 4" />
        <circle cx={x(rows.length - 1)} cy={y(last.newBusinesses)} r={4} className="fill-primary" />
        {[0, Math.floor((rows.length - 1) / 2), rows.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 5} textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[10px]">{fmt(rows[i].weekStart)}</text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-primary" /> New businesses</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-emerald-600 dark:border-emerald-400" /> First payments</span>
      </div>
    </div>
  )
}

function PlanMix({ rows }: { rows: ConsoleHome["planMix"] }) {
  const total = rows.reduce((t, r) => t + r.count, 0) || 1
  return (
    <div className="grid gap-3">
      {rows.map((r) => (
        <div key={r.key} className="grid gap-1">
          <div className="flex justify-between gap-2 text-[13px]">
            <span>{r.name}</span>
            <span className="tabular-nums text-muted-foreground">{r.count} · {Math.round((r.count / total) * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", r.key === "trial" ? "bg-sky-500" : r.key === "free" ? "bg-muted-foreground/40" : "bg-primary")} style={{ width: `${(r.count / total) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ConsoleHomePage() {
  const { me, canConsole } = useAuth()
  const { data, error, reload } = useApi<ConsoleHome>("/console/home")
  const base = useConsoleBase()
  const audience = me?.console?.audience ?? "team"
  const team = audience === "team"
  const canAdd = canConsole("platform.tenant.create") && me?.console?.partner?.status !== "paused"
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })
  const first = me?.user.name.split(" ")[0] ?? ""

  return (
    <Page
      eyebrow={team ? "Workspace" : undefined}
      title={team ? "Platform overview" : `${greeting()}, ${first}`}
      subtitle={team ? `Your SaaS business at a glance · ${today}` : audience === "partner" ? `${me?.console?.partner?.name} · ${today}` : `Your businesses and referrals · ${today}`}
      actions={
        canAdd && (
          <Link href={`${base}/clients/new`} className={buttonVariants()}>
            <Plus /> Onboard business
          </Link>
        )
      }
    >
      {me?.console?.partner?.status === "paused" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Your partner account is paused, so new businesses can&apos;t be added. Your existing businesses keep working. Please contact AHEAD.
        </div>
      )}
      {error && <Failed error={error} onRetry={reload} />}

      <StatGrid>
        {data
          ? data.stats.slice(0, 4).map((s) => <Stat key={s.key} icon={STAT_ICON[s.key]} label={s.label} value={s.money ? money(s.value) : formatNumber(s.value)} hint={s.hint} href={s.href && atBase(base, s.href)} tone={s.key === "attention" && s.value > 0 ? "warn" : undefined} />)
          : Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[138px] animate-pulse rounded-xl bg-muted" />)}
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="New businesses & first payments" description="Last 12 weeks" className="lg:col-span-3">
          {!data ? <Loading rows={3} /> : <GrowthChart rows={data.growth} />}
        </Panel>

        <Panel title="Needs attention" description={data && data.todo.length ? `${data.todo.length} thing${data.todo.length === 1 ? "" : "s"}` : undefined} className="self-start lg:col-span-2" padded={false}>
          <div className="px-3 pb-3">
            {!data ? (
              <Loading className="px-2 pt-2" />
            ) : data.todo.length ? (
              <div className="divide-y">
                {data.todo.map((t, i) => (
                  <Row key={`${t.kind}-${i}`} icon={TODO[t.kind].icon} tone={TODO[t.kind].tone} title={t.title} detail={t.detail} right={<Link href={atBase(base, t.href)} className={buttonVariants({ size: "sm", variant: t.kind === "discount" || t.kind === "unpaid" ? "default" : "outline" })}>{t.action}</Link>} />
                ))}
              </div>
            ) : (
              <Empty icon={CheckCircle2} title="You're all caught up" text="Owners who haven't signed in, approvals, unpaid orders and trials ending soon show up here." />
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Setting up" description="Owner not signed in yet, or setup not finished" padded={false}>
          <div className="px-3 pb-3">
            {!data ? (
              <Loading rows={3} className="px-2 pt-2" />
            ) : data.onboarding.length ? (
              <div className="divide-y">
                {data.onboarding.map((o) => (
                  <Row key={o.id} href={`${base}/clients/${o.id}`} icon={Building2} tone="grey" title={o.name} detail={o.signedIn ? `Setting up · added ${relDays(o.createdAt)}` : `Owner hasn't signed in · added ${relDays(o.createdAt)}`} right={<span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground tabular-nums">{o.percent}%</span>} />
                ))}
              </div>
            ) : (
              <p className="px-2 pt-2 text-sm text-muted-foreground">Every new business is set up.</p>
            )}
          </div>
        </Panel>

        <Panel title="Plan mix" description="Businesses by plan today">
          {!data ? <Loading rows={3} /> : data.planMix.length ? <PlanMix rows={data.planMix} /> : <p className="text-sm text-muted-foreground">No businesses yet.</p>}
        </Panel>

        {team ? (
          <Panel title="Recent activity" description="Changes made in the Console" padded={false}>
            <div className="px-3 pb-3">
              {!data ? (
                <Loading rows={3} className="px-2 pt-2" />
              ) : data.activity.length ? (
                <div className="divide-y">
                  {data.activity.map((a) => (
                    <Row key={a.id} href={a.href ?? undefined} icon={Activity} tone="blue" title={<span className="whitespace-normal">{a.text}</span>} detail={ago(a.at)} />
                  ))}
                </div>
              ) : (
                <p className="px-2 pt-2 text-sm text-muted-foreground">Nothing yet.</p>
              )}
            </div>
          </Panel>
        ) : data?.referral ? (
          <ReferralCard {...data.referral} />
        ) : (
          <Panel title="Your newest businesses" action={<PanelLink href={`${base}/clients`}>All</PanelLink>} padded={false}>
            <div className="px-3 pb-3">
              {!data ? (
                <Loading rows={3} className="px-2 pt-2" />
              ) : data.recent.length ? (
                <div className="divide-y">
                  {data.recent.map((c) => (
                    <Row key={c.id} href={`${base}/clients/${c.id}`} icon={Building2} tone="grey" title={c.name} detail={`${industryLabel(c.industryKey)} · joined ${relDays(c.createdAt)}`} right={<ClientStatus status={c.status} />} />
                  ))}
                </div>
              ) : (
                <p className="px-2 pt-2 text-sm text-muted-foreground">No businesses yet.</p>
              )}
            </div>
          </Panel>
        )}
      </div>
    </Page>
  )
}
