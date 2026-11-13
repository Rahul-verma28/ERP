"use client"

import * as React from "react"
import { PageHeader } from "@/components/app-shell"
import { Spinner } from "@/components/common"
import { NativeSelect } from "@/components/form"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { tone, useCrmSetup } from "@/lib/crm"
import { formatPaise } from "@/lib/format"
import { cn } from "@/lib/utils"

// CRM reports: how many leads, where they come from, who works them, how many turn into sales,
// what is in the pipeline and why sales are lost.

interface Row { name: string; value: number; color?: string; valuePaise?: number }
interface Report {
  leads: { total: number; open: number; converted: number; lost: number; conversionRate: number; byStage: Row[]; bySource: Row[]; byOwner: Row[]; lostReasons: Row[]; byMonth: Row[] }
  deals: { open: number; openValuePaise: number; weightedPaise: number; won: number; wonValuePaise: number; lost: number; winRate: number; byStage: Row[]; byOwner: { name: string; open: number; won: number; wonValuePaise: number }[]; lostReasons: Row[]; wonByMonth: Row[] }
}

const month = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" })

function Bars({ title, hint, rows, money, label }: { title: string; hint?: string; rows: Row[]; money?: boolean; label?: (r: Row) => string }) {
  const max = Math.max(1, ...rows.map((r) => (money ? r.valuePaise ?? 0 : r.value)))
  return (
    <section className="ui-surface p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {rows.length === 0 || rows.every((r) => !r.value) ? <p className="py-8 text-center text-sm text-muted-foreground">Nothing yet</p> : (
        <ul className="mt-4 grid gap-2.5">
          {rows.map((r) => {
            const v = money ? r.valuePaise ?? 0 : r.value
            return (
              <li key={r.name} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate text-muted-foreground" title={label ? label(r) : r.name}>{label ? label(r) : r.name}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", r.color ? tone(r.color).bar : "bg-primary")} style={{ width: `${Math.max(2, (v / max) * 100)}%` }} /></span>
                <span className="font-medium tabular-nums">{money ? formatPaise(v) : r.value}{money && r.value ? <span className="ml-1 text-xs font-normal text-muted-foreground">({r.value})</span> : null}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default function CrmReportsPage() {
  const { can } = useAuth()
  const setup = useCrmSetup().data
  const [pipelineId, setPipelineId] = React.useState("")
  const pipeline = setup?.pipelines.find((p) => p.id === pipelineId) ?? setup?.pipelines.find((p) => p.isDefault) ?? setup?.pipelines[0]
  const { data } = useApi<Report>(pipeline ? `/crm/report?pipelineId=${pipeline.id}` : null)
  if (!can("crm.lead.view")) return <PageHeader title="CRM reports" description="You don't have access to this. Ask your admin." />
  if (!data || !setup) return <div className="grid place-items-center py-24"><Spinner /></div>
  const kpi = (label: string, value: React.ReactNode, hint?: string, accent?: string) => <div className="ui-surface grid gap-1 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("text-2xl font-bold tabular-nums", accent)}>{value}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
  return (
    <div className="grid gap-5">
      <PageHeader title="CRM reports" description="Where leads come from, how many become sales, and what is in the pipeline." actions={setup.pipelines.length > 1 ? <div className="w-48"><NativeSelect value={pipeline!.id} onChange={(e) => setPipelineId(e.target.value)} aria-label="Pipeline">{setup.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></div> : undefined} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpi("Open leads", data.leads.open, `${data.leads.total} in all`)}
        {kpi("Lead conversion", `${data.leads.conversionRate}%`, `${data.leads.converted} converted · ${data.leads.lost} lost`, "text-primary")}
        {kpi("Open deals", formatPaise(data.deals.openValuePaise), `${data.deals.open} deals · likely ${formatPaise(data.deals.weightedPaise)}`)}
        {kpi("Won", formatPaise(data.deals.wonValuePaise), `${data.deals.won} won · win rate ${data.deals.winRate}%`, "text-emerald-600 dark:text-emerald-400")}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Bars title="Open leads by stage" hint={`${pipeline!.name} pipeline`} rows={data.leads.byStage} />
        <Bars title="Open deals by stage" hint="Value in each stage" rows={data.deals.byStage} money />
        <Bars title="Leads by source" hint="Where enquiries come from, all time" rows={data.leads.bySource} />
        <Bars title="Leads by person" hint="Assigned to" rows={data.leads.byOwner} />
        <Bars title="New leads by month" rows={data.leads.byMonth} label={(r) => month(r.name)} />
        <Bars title="Deals won by month" rows={data.deals.wonByMonth} money label={(r) => month(r.name)} />
        <Bars title="Why leads are lost" rows={data.leads.lostReasons} />
        <Bars title="Why deals are lost" rows={data.deals.lostReasons} />
      </div>
      <section className="ui-surface overflow-x-auto p-5">
        <h2 className="mb-3 font-semibold">Deals by person</h2>
        {data.deals.byOwner.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No deals yet</p> : (
          <table className="w-full min-w-[420px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 font-medium">Person</th><th className="py-2 text-right font-medium">Open</th><th className="py-2 text-right font-medium">Won</th><th className="py-2 text-right font-medium">Won value</th></tr></thead>
            <tbody>{data.deals.byOwner.map((o) => <tr key={o.name} className="border-b border-border/60 last:border-0"><td className="py-2 font-medium">{o.name}</td><td className="py-2 text-right tabular-nums">{o.open}</td><td className="py-2 text-right tabular-nums">{o.won}</td><td className="py-2 text-right font-semibold tabular-nums">{formatPaise(o.wonValuePaise)}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </div>
  )
}
