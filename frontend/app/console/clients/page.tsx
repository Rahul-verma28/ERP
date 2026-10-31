"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Building2, Download, Plus } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { LoadMore, SearchInput } from "@/components/common"
import { NativeSelect } from "@/components/form"
import { ClientStateChip, Empty, Failed, Loading, OnboardedChip, Page, Panel, ago, industryLabel, money } from "@/components/console/kit"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useDebounced, useList } from "@/lib/use-list"
import { downloadCsv } from "@/lib/csv"
import { formatDate } from "@/lib/format"
import { MODULE_SHORT, type Catalog, type ClientRow } from "@/lib/console"
import { cn } from "@/lib/utils"
import { useConsoleBase } from "@/lib/console-base"

// Clients (Console v3): one table with every account detail; click a row for the full client
// page. Partner clients live under Partners, so the AHEAD team's list leaves them out.

const TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "trialing", label: "Free trial" },
  { key: "active", label: "Paying" },
  { key: "incomplete", label: "Waiting for payment" },
  { key: "past_due", label: "Payment overdue" },
  { key: "free", label: "Free plan" },
]

const ONBOARDED_FILTER: [string, string][] = [
  ["", "Onboarded by anyone"],
  ["team", "AHEAD team"],
  ["sales", "Sales"],
  ["vendor", "Vendor"],
  ["website", "Website"],
]

/** The next date that matters for this client */
function nextDate(c: ClientRow) {
  if (c.progress && !c.progress.loggedIn && c.progress.linkSentAt) return `Link sent ${formatDate(c.progress.linkSentAt)}`
  if (c.status === "trialing" && c.trialEndsAt) return `Trial ends ${formatDate(c.trialEndsAt)}`
  if (c.status === "active" && c.renewsAt) return `Renews ${formatDate(c.renewsAt)}`
  return "—"
}

const planText = (c: ClientRow) => (c.status === "free" ? "Free" : c.status === "trialing" ? "Trial" : c.plan ?? "—")

function Modules({ keys }: { keys: string[] }) {
  if (!keys.length) return <span className="text-muted-foreground">—</span>
  const shown = keys.slice(0, 2)
  return (
    <div className="flex gap-1 whitespace-nowrap" title={keys.map((k) => MODULE_SHORT[k] ?? k).join(", ")}>
      {shown.map((k) => (
        <span key={k} className="rounded bg-muted px-1.5 text-[11px] leading-5 text-muted-foreground">{MODULE_SHORT[k] ?? k}</span>
      ))}
      {keys.length > shown.length && <span className="rounded bg-muted px-1.5 text-[11px] leading-5 text-muted-foreground">+{keys.length - shown.length}</span>}
    </div>
  )
}

function Users({ used, limit }: { used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return (
    <div className="flex items-center gap-2 whitespace-nowrap tabular-nums">
      {limit ? (
        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
          <span className={cn("block h-full", pct >= 90 ? "bg-amber-500" : "bg-primary")} style={{ width: `${pct}%` }} />
        </span>
      ) : null}
      {used}
      {limit ? `/${limit}` : ""}
    </div>
  )
}

function ClientsList() {
  const router = useRouter()
  const params = useSearchParams()
  const base = useConsoleBase()
  const { me, canConsole } = useAuth()
  const audience = me?.console?.audience ?? "team"
  const team = audience === "team"
  const [search, setSearch] = React.useState("")
  const [status, setStatus] = React.useState(params.get("status") ?? "")
  const [planKey, setPlanKey] = React.useState("")
  const [onboarded, setOnboarded] = React.useState(params.get("onboarded") ?? "")
  const [industryKey, setIndustryKey] = React.useState("")
  const q = useDebounced(search)
  const list = useList<ClientRow>("/console/tenants", { search: q, status, planKey, onboarded, industryKey })
  const catalog = useApi<Catalog>("/console/catalog")
  const industries = useApi<{ data: { key: string; name: string }[] }>("/public/industries")
  const canAdd = canConsole("platform.tenant.create") && me?.console?.partner?.status !== "paused"
  const filtered = !!(q || status || planKey || onboarded || industryKey)

  function exportCsv() {
    downloadCsv("businesses.csv", [
      ["Business", "Industry", "Owner", "Mobile", "Email", "Status", "Plan", "Cycle", "Modules", "Users", "User limit", "Per month (₹)", "Onboarded by", "Created", "Last active"],
      ...list.rows.map((c) => [
        c.name, industryLabel(c.industryKey), c.owner?.name ?? "", c.owner?.mobile ?? "", c.owner?.email ?? "", c.progress && !c.progress.loggedIn ? "Not logged in" : c.status,
        planText(c), c.cycle ?? "", c.modules.map((k) => MODULE_SHORT[k] ?? k).join(" "), c.activeUsers, c.userLimit ?? "", c.mrrPaise ? c.mrrPaise / 100 : "",
        c.onboardedBy ? [c.onboardedBy.kind, c.onboardedBy.name].filter(Boolean).join(" · ") : "", c.createdAt.slice(0, 10), c.progress?.lastActiveAt?.slice(0, 10) ?? "",
      ]),
    ])
  }

  return (
    <Page
      eyebrow="Workspace"
      title={audience === "vendor" || me?.console?.role.key === "console_sales" ? "My businesses" : "Businesses"}
      subtitle={audience === "partner" ? "Businesses you look after. You are billed for them every month." : audience === "vendor" || me?.console?.role.key === "console_sales" ? "Businesses you brought to AHEAD." : "Every business AHEAD bills directly. Partners' businesses are under Partners."}
      actions={
        <>
          {team && list.rows.length > 0 && (
            <Button variant="outline" onClick={exportCsv}>
              <Download /> Export
            </Button>
          )}
          {canAdd && (
            <Link href={`${base}/clients/new`} className={buttonVariants()}>
              <Plus /> Onboard business
            </Link>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1" role="tablist" aria-label="Status">
          {TABS.map((t) => (
            <button
              key={t.key || "all"}
              type="button"
              role="tab"
              aria-selected={status === t.key}
              onClick={() => setStatus(t.key)}
              className={cn("h-8 shrink-0 rounded-lg px-3 text-[13px] font-medium transition-colors", status === t.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search business, owner, mobile or GSTIN" className="min-w-60 flex-1" />
          <NativeSelect className="w-40" value={planKey} onChange={(e) => setPlanKey(e.target.value)} aria-label="Plan">
            <option value="">Any plan</option>
            {catalog.data?.plans.map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </NativeSelect>
          {team && (
            <NativeSelect className="w-48" value={onboarded} onChange={(e) => setOnboarded(e.target.value)} aria-label="Onboarded by">
              {ONBOARDED_FILTER.map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </NativeSelect>
          )}
          <NativeSelect className="w-44" value={industryKey} onChange={(e) => setIndustryKey(e.target.value)} aria-label="Industry">
            <option value="">Any industry</option>
            {industries.data?.data.map((i) => (
              <option key={i.key} value={i.key}>{i.name}</option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <Panel padded={false}>
        {list.error ? (
          <div className="p-5">
            <Failed error={list.error} onRetry={list.reload} />
          </div>
        ) : list.loading ? (
          <Loading rows={6} className="p-5" />
        ) : !list.rows.length ? (
          <Empty
            icon={Building2}
            title={filtered ? "No businesses match" : "No businesses yet"}
            text={filtered ? "Try another search or filter." : "Businesses you onboard, or that sign up through you, appear here."}
            action={
              !filtered && canAdd && (
                <Link href={`${base}/clients/new`} className={buttonVariants({ size: "sm" })}>
                  <Plus /> Onboard business
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Business</th>
                  <th className="px-3 py-3 font-medium">Owner</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Plan</th>
                  <th className="px-3 py-3 font-medium">Modules</th>
                  <th className="px-3 py-3 font-medium">Users</th>
                  {audience !== "partner" && <th className="px-3 py-3 text-right font-medium">Per month</th>}
                  <th className="px-3 py-3 font-medium">Next date</th>
                  {team && <th className="px-3 py-3 font-medium">Onboarded by</th>}
                  <th className="px-5 py-3 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((c) => (
                  <tr key={c.id} onClick={() => router.push(`${base}/clients/${c.id}`)} className="cursor-pointer border-b align-top last:border-0 hover:bg-muted/50">
                    <td className="px-5 py-3">
                      <Link href={`${base}/clients/${c.id}`} className="font-medium whitespace-nowrap hover:underline" onClick={(e) => e.stopPropagation()}>
                        {c.name}
                      </Link>
                      <div className="text-[13px] text-muted-foreground">{industryLabel(c.industryKey)}</div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {c.owner?.name ?? "—"}
                      <div className="text-[13px] text-muted-foreground tabular-nums">{c.owner?.mobile.replace(/^\+91/, "") ?? ""}</div>
                    </td>
                    <td className="px-3 py-3">
                      <ClientStateChip status={c.status} progress={c.progress} trialEndsAt={c.trialEndsAt} partnerBilled={!!c.partner} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {planText(c)}
                      {c.status !== "trialing" && c.status !== "free" && c.cycle && <div className="text-[13px] text-muted-foreground">{c.cycle === "yearly" ? "Yearly" : "Monthly"}</div>}
                    </td>
                    <td className="px-3 py-3">
                      <Modules keys={c.modules} />
                    </td>
                    <td className="px-3 py-3">
                      <Users used={c.activeUsers} limit={c.userLimit} />
                    </td>
                    {audience !== "partner" && <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">{c.mrrPaise ? money(c.mrrPaise) : "—"}</td>}
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{nextDate(c)}</td>
                    {team && (
                      <td className="px-3 py-3">
                        <OnboardedChip by={c.onboardedBy} />
                      </td>
                    )}
                    <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">{c.progress?.lastActiveAt ? ago(c.progress.lastActiveAt) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Panel>
    </Page>
  )
}

export default function ClientsPage() {
  return (
    <React.Suspense>
      <ClientsList />
    </React.Suspense>
  )
}
