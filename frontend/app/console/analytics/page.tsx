"use client"

import * as React from "react"
import Link from "next/link"
import { Info } from "lucide-react"
import { Failed, Loading, Page, Panel, Stat, StatGrid, ago, money, relDays } from "@/components/console/kit"
import { MonthBars, ShareBars } from "@/components/console/charts"
import { useApi } from "@/lib/use-api"
import { useAuth } from "@/lib/auth"
import { useConsoleBase } from "@/lib/console-base"
import type { Analytics } from "@/lib/console"
import { cn } from "@/lib/utils"

// Analytics (blueprint Phase F): how AHEAD is doing, for each role and only within the
// person's own businesses. Admin sees money; Staff the same without money; Sales and vendors
// their own numbers; a partner its own businesses. Each figure opens the list behind it.

const PERIODS = [3, 6, 12] as const
const SOURCE_LABEL = { direct: "Website & AHEAD team", vendor: "Vendors", sales: "Sales team", partner: "Partners" } as const

/** ₹1.2L, ₹45K: short enough for a bar label. */
function short(paise: number) {
  const r = paise / 100
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(1).replace(/\.0$/, "")}Cr`
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1).replace(/\.0$/, "")}L`
  if (r >= 1e3) return `₹${Math.round(r / 1e3)}K`
  return `₹${Math.round(r)}`
}

export default function AnalyticsPage() {
  const { me } = useAuth()
  const base = useConsoleBase()
  const [months, setMonths] = React.useState<(typeof PERIODS)[number]>(6)
  const { data, error, reload } = useApi<Analytics>(`/console/analytics?months=${months}`)
  const audience = me?.console?.audience ?? "team"
  const own = audience === "vendor" || me?.console?.role.key === "console_sales"
  const partner = audience === "partner"
  const clients = `${base}/clients`

  const subtitle = partner ? "Your businesses: growth, use and who is active." : own ? "Your businesses and how they are doing." : "How AHEAD is growing: new businesses, payments and use."

  return (
    <Page
      eyebrow="Insights"
      title="Analytics"
      subtitle={subtitle}
      wide
      actions={
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="Period">
          {PERIODS.map((m) => (
            <button key={m} type="button" onClick={() => setMonths(m)} aria-pressed={months === m} className={cn("rounded-md px-3 py-1.5 text-sm transition-colors", months === m ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
              {m} months
            </button>
          ))}
        </div>
      }
    >
      {error ? (
        <Failed error={error} onRetry={reload} />
      ) : !data ? (
        <Loading rows={8} />
      ) : (
        <>
          <StatGrid>
            <Stat label="Live businesses" value={data.kpis.live} hint={`${data.kpis.started} started in ${months} months`} href={clients} />
            <Stat label="Paying" value={data.kpis.paying} hint={`${data.kpis.trials} on a free trial`} href={`${clients}?status=active`} />
            <Stat label="Paid conversion" value={data.kpis.conversionPercent === null ? "—" : `${data.kpis.conversionPercent}%`} hint={`${data.kpis.converted} of ${data.kpis.started} new businesses paid`} />
            {data.kpis.receivedPaise !== null ? (
              <Stat label="Money received" value={short(data.kpis.receivedPaise)} hint={`${money(data.kpis.receivedPaise)} incl. GST`} href={`${base}/payments?tab=payments`} />
            ) : (
              <Stat label="Lost" value={data.kpis.lost} hint="Paid before, now Free or closed" tone={data.kpis.lost ? "warn" : undefined} />
            )}
          </StatGrid>

          {data.mine && <MyNumbers data={data} clients={clients} />}

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="New businesses and first payments" description="Each month: businesses that started, and businesses that paid for the first time.">
              <MonthBars
                title="New businesses and first payments"
                labels={data.series.map((s) => s.label)}
                series={[
                  { label: "New businesses", values: data.series.map((s) => s.newBusinesses), fill: "fill-primary", swatch: "bg-primary" },
                  { label: "First payments", values: data.series.map((s) => s.firstPayments), fill: "fill-emerald-500", swatch: "bg-emerald-500" },
                ]}
              />
            </Panel>
            {data.kpis.receivedPaise !== null ? (
              <Panel title="Money received" description="Payments AHEAD received each month, including GST.">
                <MonthBars title="Money received" labels={data.series.map((s) => s.label)} series={[{ label: "Received", values: data.series.map((s) => s.receivedPaise ?? 0), fill: "fill-primary", swatch: "bg-primary" }]} format={short} />
              </Panel>
            ) : (
              <Panel title="Active businesses" description="Businesses where someone signed in that month.">
                <MonthBars title="Active businesses" labels={data.series.map((s) => s.label)} series={[{ label: "Active", values: data.series.map((s) => s.activeBusinesses), fill: "fill-primary", swatch: "bg-primary" }]} />
              </Panel>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            {data.kpis.receivedPaise !== null && (
              <Panel title="Active businesses" description="Someone signed in that month.">
                <MonthBars title="Active businesses" labels={data.series.map((s) => s.label)} series={[{ label: "Active", values: data.series.map((s) => s.activeBusinesses), fill: "fill-sky-500", swatch: "bg-sky-500" }]} />
              </Panel>
            )}
            <Panel title="Invoices made by businesses" description="GST invoices issued in the ERP each month: a sign the product is in daily use.">
              <MonthBars title="Invoices made by businesses" labels={data.series.map((s) => s.label)} series={[{ label: "Invoices", values: data.series.map((s) => s.invoices), fill: "fill-violet-500", swatch: "bg-violet-500" }]} />
            </Panel>
            {!own && !partner && (
              <Panel title="Where new businesses came from" description={`Started in the last ${months} months.`}>
                <ShareBars
                  rows={data.sources.map((s) => ({
                    key: s.key,
                    label: SOURCE_LABEL[s.key],
                    value: s.count,
                    percent: data.kpis.started ? Math.round((s.count / data.kpis.started) * 100) : 0,
                    href: s.key === "direct" ? undefined : `${clients}?onboarded=${s.key}`,
                  }))}
                  empty="No new businesses in this period."
                />
              </Panel>
            )}
            {data.revenueByPlan && (
              <Panel title="Money by plan" description={`Received in the last ${months} months.`}>
                <ShareBars rows={data.revenueByPlan.map((r) => ({ key: r.name, label: r.name, value: r.paise }))} format={short} empty="No payments in this period." />
              </Panel>
            )}
          </div>

          {!own && (
            <Panel title="Module use" description="Share of live businesses with each module switched on.">
              <div className="grid gap-x-10 gap-y-3 md:grid-cols-2">
                <ShareBars rows={data.modules.slice(0, Math.ceil(data.modules.length / 2)).map((m) => ({ key: m.key, label: m.name, value: m.businesses, percent: m.percent }))} />
                <ShareBars rows={data.modules.slice(Math.ceil(data.modules.length / 2)).map((m) => ({ key: m.key, label: m.name, value: m.businesses, percent: m.percent }))} empty="" />
              </div>
            </Panel>
          )}

          {data.perBusiness && <PerBusiness rows={data.perBusiness} clients={clients} />}

          <details className="rounded-xl border bg-card px-5 py-3 text-sm">
            <summary className="flex cursor-pointer items-center gap-2 font-medium"><Info className="size-4 text-muted-foreground" /> How these numbers are counted</summary>
            <dl className="mt-3 grid gap-2 sm:grid-cols-[10rem_1fr]">
              {(["live", "paying", "conversion", "active", "lost"] as const).map((k) => (
                <React.Fragment key={k}>
                  <dt className="text-muted-foreground capitalize">{k === "conversion" ? "Paid conversion" : k}</dt>
                  <dd>{data.definitions[k]}</dd>
                </React.Fragment>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Updated every minute. Only businesses you can see are counted.</p>
          </details>
        </>
      )}
    </Page>
  )
}

function MyNumbers({ data, clients }: { data: Analytics; clients: string }) {
  const mine = data.mine!
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_2fr]">
      <div className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1">
        <Stat label="Signed up with my link or code" value={mine.linkSignups} hint={`In the last ${data.months} months`} />
        <Stat label="Discounts I gave" value={mine.discounts.orders} hint={mine.discounts.orders ? `Average ${mine.discounts.averagePercent}% · ${mine.discounts.approved} approved by an Admin` : "No discounted orders"} />
      </div>
      <Panel title="Trials ending this week" description="Talk to them before the trial ends." padded={false}>
        {!mine.trialsEnding.length ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">No trials end in the next 7 days.</p>
        ) : (
          <ul className="divide-y border-t">
            {mine.trialsEnding.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <Link href={`${clients}/${t.id}`} className="min-w-0 truncate font-medium hover:underline">{t.name}</Link>
                <span className="shrink-0 text-muted-foreground">{relDays(t.trialEndsAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function PerBusiness({ rows, clients }: { rows: NonNullable<Analytics["perBusiness"]>; clients: string }) {
  return (
    <Panel title="Each business" description="Users, invoices this month and the last sign-in." padded={false}>
      {!rows.length ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">No live businesses yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y text-left text-xs whitespace-nowrap text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Business</th>
                <th className="px-3 py-2.5 text-right font-medium">Users</th>
                <th className="px-3 py-2.5 text-right font-medium">Invoices this month</th>
                <th className="px-5 py-2.5 font-medium">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-5 py-2.5"><Link href={`${clients}/${r.id}`} className="font-medium hover:underline">{r.name}</Link></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.users}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.invoicesThisMonth}</td>
                  <td className={cn("px-5 py-2.5 whitespace-nowrap", !r.lastSignIn && "text-amber-700 dark:text-amber-400")}>{r.lastSignIn ? ago(r.lastSignIn) : "Not signed in yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
