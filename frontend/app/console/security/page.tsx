"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ChevronRight, ScrollText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog, LoadMore, SearchInput } from "@/components/common"
import { NativeSelect } from "@/components/form"
import { Chip, Empty, Failed, Loading, Page, PageTabs, Panel, ago } from "@/components/console/kit"
import { api, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"
import { useDebounced, useList } from "@/lib/use-list"
import type { AuditArea, AuditEvent, SecurityStats, SessionRow, SignInRow } from "@/lib/console"
import { cn } from "@/lib/utils"

// Security & audit (blueprint S7): who changed what in the Console, with before and after;
// Console sign-ins; open Console sessions. Admin only. A business's own records never show here.

type Tab = "audit" | "signins" | "sessions"

const AREAS: [AuditArea | "", string][] = [
  ["", "All areas"],
  ["businesses", "Businesses"],
  ["billing", "Billing"],
  ["product", "Plans & pricing"],
  ["people", "People & roles"],
  ["settings", "Settings"],
  ["signin", "Sign-ins"],
]
const AREA_TAG: Record<AuditArea, string> = { businesses: "BUSINESS", billing: "BILLING", product: "PRODUCT", people: "ACCESS", settings: "SETTING", signin: "SIGN-IN" }

const OUTCOME: Record<string, { label: string; tone: "green" | "amber" | "red" | "grey" }> = {
  success: { label: "Signed in", tone: "green" },
  wrong_password: { label: "Wrong password", tone: "amber" },
  locked: { label: "Locked out", tone: "red" },
  mfa_challenge: { label: "Asked for two-step", tone: "grey" },
  mfa_failed: { label: "Wrong two-step code", tone: "amber" },
  mfa_locked: { label: "Two-step locked", tone: "red" },
  blocked_ip: { label: "Blocked network", tone: "red" },
  expired_password: { label: "Password expired", tone: "grey" },
  unknown_account: { label: "No such account", tone: "grey" },
}

const stamp = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getDate())}-${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[11.5px] tracking-wide", className)}>{children}</span>
}

function StatBox({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "warn" | "bad" }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <Mono className="tracking-[0.14em] text-muted-foreground uppercase">{label}</Mono>
      <div className={cn("mt-2 text-[26px] leading-none font-semibold tabular-nums", tone === "warn" && "text-amber-600 dark:text-amber-400", tone === "bad" && "text-red-600 dark:text-red-400")}>{value}</div>
      {hint && <div className="mt-2 text-[12.5px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** Before → after, only the fields that changed (or everything for create/delete). */
function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
  if (!keys.length) return <p className="text-xs text-muted-foreground">No field-level details were recorded for this event.</p>
  const show = (v: unknown) => (v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v, null, 1))
  const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
  // Two maps (e.g. a role's permissions): list only what was added, removed or changed
  const diffMaps = (x: Record<string, unknown>, y: Record<string, unknown>) =>
    [...new Set([...Object.keys(x), ...Object.keys(y)])]
      .filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]))
      .map((k) => (x[k] === undefined ? `+ ${k}: ${show(y[k])}` : y[k] === undefined ? `− ${k}` : `${k}: ${show(x[k])} → ${show(y[k])}`))
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Field</th>
            <th className="py-1 pr-3 font-medium">Before</th>
            <th className="py-1 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) =>
            isMap(b[k]) && isMap(a[k]) ? (
              <tr key={k} className="align-top">
                <td className="py-1 pr-3 font-medium whitespace-nowrap">{k}</td>
                <td colSpan={2} className="py-1">
                  <ul className="grid gap-0.5 font-mono text-[11px]">
                    {diffMaps(b[k] as Record<string, unknown>, a[k] as Record<string, unknown>).map((line) => (
                      <li key={line} className={line.startsWith("+") ? "text-emerald-700 dark:text-emerald-300" : line.startsWith("−") ? "text-red-700 dark:text-red-300" : ""}>{line}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ) : (
            <tr key={k} className="align-top">
              <td className="py-1 pr-3 font-medium whitespace-nowrap">{k}</td>
              <td className="max-w-80 py-1 pr-3"><pre className="font-mono text-[11px] whitespace-pre-wrap text-red-700 dark:text-red-300">{show(b[k])}</pre></td>
              <td className="max-w-80 py-1"><pre className="font-mono text-[11px] whitespace-pre-wrap text-emerald-700 dark:text-emerald-300">{show(a[k])}</pre></td>
            </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  )
}

function AuditTrail() {
  const [search, setSearch] = React.useState("")
  const [area, setArea] = React.useState<AuditArea | "">("")
  const [days, setDays] = React.useState("30")
  const [risky, setRisky] = React.useState(false)
  const [open, setOpen] = React.useState<string | null>(null)
  const q = useDebounced(search)
  const list = useList<AuditEvent>("/console/security/audit", { search: q, area, days, riskyOnly: risky ? "true" : undefined })
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Mono className="mr-1 tracking-[0.14em] text-muted-foreground uppercase">{"// filters"}</Mono>
        <SearchInput value={search} onChange={setSearch} placeholder="Search person, business or action" className="min-w-60 flex-1" />
        <NativeSelect className="w-44" value={area} onChange={(e) => setArea(e.target.value as AuditArea | "")} aria-label="Area">
          {AREAS.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </NativeSelect>
        <NativeSelect className="w-36" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period">
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </NativeSelect>
        <label className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-[13px]">
          <input type="checkbox" checked={risky} onChange={(e) => setRisky(e.target.checked)} className="size-4 accent-amber-600" /> Risky only
        </label>
      </div>
      <Panel padded={false}>
        {list.error ? (
          <div className="p-5"><Failed error={list.error} onRetry={list.reload} /></div>
        ) : list.loading ? (
          <Loading rows={6} className="p-5" />
        ) : !list.rows.length ? (
          <Empty icon={ScrollText} title="No events" text="Try a longer period or another area." />
        ) : (
          <ul className="divide-y">
            {list.rows.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id} className="grid w-full grid-cols-[10px_118px_96px_1fr_16px] items-center gap-3 px-5 py-3 text-left hover:bg-muted/40 max-sm:grid-cols-[10px_1fr_16px]">
                  <span className={cn("size-2 rounded-full", e.risky ? "bg-amber-500" : e.area === "signin" ? "bg-muted-foreground/50" : "bg-primary")} />
                  <Mono className="text-muted-foreground max-sm:hidden">{stamp(e.at)}</Mono>
                  <Mono className="rounded-md bg-muted px-1.5 py-0.5 text-center tracking-[0.12em] max-sm:hidden">{e.area ? AREA_TAG[e.area] : "OTHER"}</Mono>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px]"><b className="font-semibold">{e.actor}</b> {e.text}{e.subject ? <> · <span className="font-medium">{e.subject}</span></> : null}</span>
                    <Mono className="text-muted-foreground">{e.action}{e.ip ? ` · ${e.ip}` : ""}<span className="sm:hidden"> · {ago(e.at)}</span></Mono>
                  </span>
                  <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open === e.id && "rotate-90")} />
                </button>
                {open === e.id && (
                  <div className="grid gap-2 border-t bg-muted/20 px-5 py-3 sm:pl-[160px]">
                    {e.risky && <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Risky change: access, prices, refunds or settings.</p>}
                    <Changes before={e.before} after={e.after} />
                    {e.subjectHref && <Link href={e.subjectHref} className="text-xs font-medium text-primary hover:underline">Open {e.subject}</Link>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Panel>
    </div>
  )
}

function SignIns() {
  const { data, error, reload } = useApi<{ data: SignInRow[] }>("/console/security/sign-ins")
  if (error) return <Failed error={error} onRetry={reload} />
  return (
    <Panel padded={false} title="Sign-ins" description="Console sign-ins in the last 30 days (AHEAD team, sales and vendors).">
      {!data ? (
        <Loading rows={5} className="p-5" />
      ) : !data.data.length ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">No sign-ins yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">When</th>
                <th className="px-3 py-2.5 font-medium">Person</th>
                <th className="px-3 py-2.5 font-medium">Result</th>
                <th className="px-3 py-2.5 font-medium">Device</th>
                <th className="px-5 py-2.5 font-medium">Network</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((r) => {
                const o = OUTCOME[r.outcome] ?? { label: r.outcome, tone: "grey" as const }
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-5 py-2.5 whitespace-nowrap"><Mono className="text-muted-foreground">{stamp(r.at)}</Mono></td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{r.person}</td>
                    <td className="px-3 py-2.5"><Chip tone={o.tone}>{o.label}</Chip></td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{r.device}</td>
                    <td className="px-5 py-2.5"><Mono className="text-muted-foreground">{r.ip ?? "—"}</Mono></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function Sessions() {
  const { data, error, reload } = useApi<{ data: SessionRow[] }>("/console/security/sessions")
  const [revoke, setRevoke] = React.useState<SessionRow | null>(null)
  if (error) return <Failed error={error} onRetry={reload} />
  return (
    <Panel padded={false} title="Open Console sessions" description="Everyone signed in to the Console right now. Signing someone out ends that session on every device it was copied to.">
      {!data ? (
        <Loading rows={4} className="p-5" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Person</th>
                <th className="px-3 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 font-medium">Device</th>
                <th className="px-3 py-2.5 font-medium">Since</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {data.data.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="px-5 py-2.5">
                    <div className="font-medium">{s.person} {s.current && <span className="text-xs font-normal text-muted-foreground">(this session)</span>}</div>
                    <div className="text-xs text-muted-foreground">{s.email}</div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{s.role}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{s.device}<Mono className="block">{s.ip ?? ""}</Mono></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{ago(s.since)}</td>
                  <td className="px-5 py-2.5 text-right">{!s.current && <Button size="sm" variant="outline" onClick={() => setRevoke(s)}>Sign out</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        title={`Sign ${revoke?.person ?? ""} out of the Console?`}
        description="They can sign in again straight away. To stop them, turn them off in Team."
        confirmLabel="Sign out"
        destructive
        onConfirm={async () => {
          if (!revoke) return
          try {
            await api.post(`/console/security/sessions/${revoke.id}/revoke`)
            toast.success(`${revoke.person} is signed out`)
            reload()
          } catch (e) {
            toast.error(errorMessage(e))
          }
          setRevoke(null)
        }}
      />
    </Panel>
  )
}

export default function SecurityPage() {
  return (
    <React.Suspense>
      <Security />
    </React.Suspense>
  )
}

function Security() {
  const router = useRouter()
  const params = useSearchParams()
  const tab = (["audit", "signins", "sessions"] as const).find((t) => t === params.get("tab")) ?? "audit"
  const setTab = (t: Tab) => router.replace(t === "audit" ? "/console/security" : `/console/security?tab=${t}`, { scroll: false })
  const { data: stats } = useApi<SecurityStats>("/console/security/stats")
  return (
    <Page eyebrow="People & access" title="Security & audit" subtitle="Every change made in the Console, who signed in, and who is signed in now. Kept for 3 years." wide>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats ? (
          <>
            <StatBox label="Changes · 7 days" value={stats.changes7d} hint="Across the Console" />
            <StatBox label="Risky actions" value={stats.risky7d} hint="Roles, prices, refunds, settings" tone={stats.risky7d ? "warn" : undefined} />
            <StatBox label="Failed sign-ins" value={stats.failedSignIns7d} hint="Last 7 days" tone={stats.failedSignIns7d > 5 ? "bad" : stats.failedSignIns7d ? "warn" : undefined} />
            <StatBox label="Two-step on" value={`${stats.twoStepOn} / ${stats.people}`} hint="Console people" tone={stats.twoStepOn < stats.people ? "warn" : undefined} />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[112px] animate-pulse rounded-xl bg-muted" />)
        )}
      </div>
      <PageTabs tabs={[{ key: "audit", label: "Audit trail" }, { key: "signins", label: "Sign-ins" }, { key: "sessions", label: "Sessions" }]} active={tab} onChange={setTab} />
      {tab === "audit" && <AuditTrail />}
      {tab === "signins" && <SignIns />}
      {tab === "sessions" && <Sessions />}
    </Page>
  )
}
