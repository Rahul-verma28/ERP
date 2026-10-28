"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, Building2, Plus } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { SearchInput } from "@/components/common"
import { NativeSelect } from "@/components/form"
import { LoadMore } from "@/components/common"
import { ClientStatus, Empty, Failed, Loading, Page, Panel, daysFrom, industryLabel, relDays } from "@/components/console/kit"
import { useAuth } from "@/lib/auth"
import { useDebounced, useList } from "@/lib/use-list"
import { formatDate } from "@/lib/format"
import { SOURCE_LABEL, type ClientRow } from "@/lib/console"
import { cn } from "@/lib/utils"

// Clients: everyone you can see, newest first. Plain statuses, one click into a client.

const TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "trialing", label: "Free trial" },
  { key: "active", label: "Paying" },
  { key: "incomplete", label: "Waiting for payment" },
  { key: "past_due", label: "Payment overdue" },
  { key: "free", label: "Free plan" },
]

function statusSuffix(c: ClientRow) {
  if (c.status !== "trialing" || !c.trialEndsAt) return undefined
  const d = daysFrom(c.trialEndsAt) ?? 0
  return d <= 0 ? "ends today" : `${d} day${d === 1 ? "" : "s"} left`
}

function ClientsList() {
  const router = useRouter()
  const params = useSearchParams()
  const { me, canConsole } = useAuth()
  const audience = me?.console?.audience ?? "team"
  const [search, setSearch] = React.useState("")
  const [status, setStatus] = React.useState(params.get("status") ?? "")
  const [source, setSource] = React.useState("")
  const q = useDebounced(search)
  const list = useList<ClientRow>("/console/tenants", { search: q, status, source })
  const canAdd = canConsole("platform.tenant.create") && me?.console?.partner?.status !== "paused"
  const team = audience === "team"

  return (
    <Page
      title={audience === "vendor" ? "My clients" : "Clients"}
      subtitle={audience === "partner" ? "Businesses you look after. You are billed for them every month." : audience === "vendor" ? "Businesses you brought to AHEAD." : "Every business on AHEAD. Account and plan details only — their business data stays private."}
      actions={
        canAdd && (
          <Link href="/console/clients/new" className={buttonVariants()}>
            <Plus /> Add client
          </Link>
        )
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
          <SearchInput value={search} onChange={setSearch} placeholder="Search by business name or GSTIN" className="min-w-60 flex-1" />
          {team && (
            <NativeSelect className="w-52" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Brought in by">
              <option value="">Brought in by anyone</option>
              {(Object.keys(SOURCE_LABEL) as ClientRow["source"][]).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          )}
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
            title={q || status || source ? "No clients match" : "No clients yet"}
            text={q || status || source ? "Try another search or status." : "Clients you add, or who sign up through you, appear here."}
            action={
              !q && !status && canAdd && (
                <Link href="/console/clients/new" className={buttonVariants({ size: "sm" })}>
                  <Plus /> Add client
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium whitespace-nowrap text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Business</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Plan</th>
                  {team && <th className="px-3 py-3 font-medium">Brought in by</th>}
                  {team && <th className="px-3 py-3 font-medium">Next step</th>}
                  {!team && <th className="px-5 py-3 font-medium">Joined</th>}
                </tr>
              </thead>
              <tbody>
                {list.rows.map((c) => (
                  <tr key={c.id} onClick={() => router.push(`/console/clients/${c.id}`)} className="cursor-pointer border-b last:border-0 hover:bg-muted/50">
                    <td className="px-5 py-3.5">
                      <Link href={`/console/clients/${c.id}`} className="font-medium whitespace-nowrap hover:underline" onClick={(e) => e.stopPropagation()}>
                        {c.name}
                      </Link>
                      <div className="text-[13px] text-muted-foreground">{industryLabel(c.industryKey)}</div>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <ClientStatus status={c.status} suffix={statusSuffix(c)} partnerBilled={!!c.partner} />
                        {c.health && c.health.flag !== "good" && (
                          <span title={c.health.label} className="text-amber-600">
                            <AlertTriangle className="size-4" aria-label={c.health.label} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap">{c.status === "free" ? "Free" : c.plan ?? "—"}</td>
                    {team && <td className="px-3 py-3.5 whitespace-nowrap text-muted-foreground">{c.partner ? `${c.partner} (partner)` : c.acquiredBy ?? SOURCE_LABEL[c.source]}</td>}
                    {team && (
                      <td className="px-3 py-3.5">
                        {c.next ? (
                          <>
                            <div className="max-w-56 truncate">{c.next.title}</div>
                            <div className={cn("text-[13px]", new Date(c.next.dueAt) < new Date() ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground")}>
                              {new Date(c.next.dueAt) < new Date() ? "Overdue" : relDays(c.next.dueAt)}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                    {!team && <td className="px-5 py-3.5 text-muted-foreground">{formatDate(c.createdAt)}</td>}
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
