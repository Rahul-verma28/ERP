"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { BadgePercent, Building2, CalendarClock, CheckCircle2, Copy, CreditCard, Link2, LogIn, Plus, Sparkles, Target } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { ClientStatus, Empty, Failed, Loading, Page, Panel, PanelLink, Row, Stat, StatGrid, greeting, industryLabel, money, relDays, type Tone } from "@/components/console/kit"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatNumber } from "@/lib/format"
import type { ConsoleHome, HomeTodo } from "@/lib/console"

// Home: what needs doing today, a few plain numbers and the newest clients.
// The same page for the AHEAD team, vendors and partners — each sees only their own clients.

const TODO: Record<HomeTodo["kind"], { icon: typeof Target; tone: Tone }> = {
  discount: { icon: BadgePercent, tone: "amber" },
  unpaid: { icon: CreditCard, tone: "red" },
  trial: { icon: CalendarClock, tone: "blue" },
  followup: { icon: Target, tone: "blue" },
  setup: { icon: Sparkles, tone: "grey" },
  signin: { icon: LogIn, tone: "grey" },
}

const CHART_PX = 120

function IncomeChart({ rows }: { rows: NonNullable<ConsoleHome["income"]> }) {
  const max = Math.max(1, ...rows.map((r) => r.paise))
  return (
    <div className="flex items-end gap-3 pt-2" role="img" aria-label={rows.map((r) => `${r.label}: ${money(r.paise)}`).join(", ")}>
      {rows.map((r, i) => (
        <div key={r.month} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <span className="h-4 truncate text-[11px] font-medium text-muted-foreground tabular-nums">{r.paise ? money(r.paise) : ""}</span>
          <div className="flex w-full items-end rounded-lg bg-muted/60" style={{ height: CHART_PX }}>
            <div className={i === rows.length - 1 ? "w-full rounded-lg bg-primary" : "w-full rounded-lg bg-primary/40"} style={{ height: r.paise ? Math.max(6, Math.round((r.paise / max) * CHART_PX)) : 0 }} title={`${r.label}: ${money(r.paise)}`} />
          </div>
          <span className="text-xs text-muted-foreground">{r.label}</span>
        </div>
      ))}
    </div>
  )
}

function ReferralCard({ code, link }: { code: string; link: string }) {
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error("Couldn't copy — select it and copy instead")
    }
  }
  return (
    <Panel title="Your referral link" description="Anyone who signs up with this link or code is added to your clients automatically.">
      <div className="grid min-w-0 gap-3">
        <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2.5">
          <Link2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{link}</span>
          <button type="button" onClick={() => copy(link, "Link")} className={buttonVariants({ size: "sm", variant: "outline" })}>
            <Copy /> Copy link
          </button>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-2.5">
          <span className="text-[13px] text-muted-foreground">
            Code <span className="ml-1 font-mono text-[15px] font-semibold tracking-wider text-foreground">{code}</span>
          </span>
          <button type="button" onClick={() => copy(code, "Code")} className={buttonVariants({ size: "sm", variant: "ghost" })}>
            <Copy /> Copy
          </button>
        </div>
      </div>
    </Panel>
  )
}

export default function ConsoleHomePage() {
  const { me, canConsole } = useAuth()
  const { data, error, reload } = useApi<ConsoleHome>("/console/home")
  const audience = me?.console?.audience ?? "team"
  const first = me?.user.name.split(" ")[0] ?? ""
  const canAdd = canConsole("platform.tenant.create") && me?.console?.partner?.status !== "paused"
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date())
  const subtitle = audience === "partner" ? `${me?.console?.partner?.name} · ${today}` : audience === "vendor" ? `Your clients and referrals · ${today}` : today

  return (
    <Page
      title={`${greeting()}, ${first}`}
      subtitle={subtitle}
      actions={
        canAdd && (
          <Link href="/console/clients/new" className={buttonVariants()}>
            <Plus /> Add client
          </Link>
        )
      }
    >
      {me?.console?.partner?.status === "paused" && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Your partner account is paused, so new clients can&apos;t be added. Your existing clients keep working. Please contact AHEAD.
        </div>
      )}
      {error && <Failed error={error} onRetry={reload} />}

      <StatGrid>
        {data
          ? data.stats.map((s) => <Stat key={s.key} label={s.label} value={s.money ? money(s.value) : formatNumber(s.value)} hint={s.hint} href={s.href} />)
          : Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[118px] animate-pulse rounded-2xl bg-muted" />)}
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="To do" description={data && data.todo.length ? `${data.todo.length} thing${data.todo.length === 1 ? "" : "s"} need${data.todo.length === 1 ? "s" : ""} you` : undefined} className="self-start lg:col-span-3" padded={false}>
          <div className="px-3 pb-3">
            {!data ? (
              <Loading className="px-2 pt-2" />
            ) : data.todo.length ? (
              <div className="divide-y">
                {data.todo.map((t, i) => (
                  <Row key={`${t.kind}-${i}`} icon={TODO[t.kind].icon} tone={TODO[t.kind].tone} title={t.title} detail={t.detail} right={<Link href={t.href} className={buttonVariants({ size: "sm", variant: t.kind === "discount" || t.kind === "unpaid" ? "default" : "outline" })}>{t.action}</Link>} />
                ))}
              </div>
            ) : (
              <Empty icon={CheckCircle2} title="You're all caught up" text={audience === "partner" ? "Clients whose owner hasn't signed in yet show up here." : audience === "vendor" ? "Your clients' unpaid orders and trials ending soon show up here." : "Trials ending soon, unpaid orders and follow-ups show up here when they need you."} />
            )}
          </div>
        </Panel>

        <div className="grid min-w-0 content-start gap-6 lg:col-span-2">
          {data?.referral && <ReferralCard {...data.referral} />}
          {data?.income && (
            <Panel title="Income" description="Last 6 months, paid AHEAD invoices before GST">
              <IncomeChart rows={data.income} />
            </Panel>
          )}
          <Panel title={audience === "team" ? "Newest clients" : "Your newest clients"} action={<PanelLink href="/console/clients">All clients</PanelLink>} padded={false}>
            <div className="px-3 pb-3">
              {!data ? (
                <Loading rows={3} className="px-2 pt-2" />
              ) : data.recent.length ? (
                <div className="divide-y">
                  {data.recent.map((c) => (
                    <Row key={c.id} href={`/console/clients/${c.id}`} icon={Building2} tone="grey" title={c.name} detail={`${industryLabel(c.industryKey)} · joined ${relDays(c.createdAt)}`} right={<ClientStatus status={c.status} />} />
                  ))}
                </div>
              ) : (
                <Empty
                  icon={Building2}
                  title="No clients yet"
                  text={audience === "vendor" ? "Share your referral link or add a client yourself." : "Add your first client — it takes about two minutes."}
                  action={
                    canAdd && (
                      <Link href="/console/clients/new" className={buttonVariants({ size: "sm" })}>
                        <Plus /> Add client
                      </Link>
                    )
                  }
                />
              )}
            </div>
          </Panel>
        </div>
      </div>
    </Page>
  )
}
