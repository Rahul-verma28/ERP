"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Copy, ExternalLink, LogOut, ScrollText } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/common"
import { Chip, Failed, Page, PageTabs, ago } from "@/components/console/kit"
import { Count, DataTable, FilterSelect, IdCell, type Column, type RowAction } from "@/components/console/data-table"
import { useClientTable, useServerTable } from "@/lib/use-table"
import { api, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"
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
  const [area, setArea] = React.useState<AuditArea | "">("")
  const [days, setDays] = React.useState("30")
  const [risky, setRisky] = React.useState("")
  const [open, setOpen] = React.useState<AuditEvent | null>(null)
  const table = useServerTable<AuditEvent>("/console/security/audit", { area, days, riskyOnly: risky || undefined })
  const columns: Column<AuditEvent>[] = [
    { key: "id", header: "Event ID", hidden: true, cell: (e) => <IdCell id={e.id} /> },
    { key: "at", header: "When", always: true, cell: (e) => <span title={new Date(e.at).toLocaleString("en-IN")}><Mono className="text-muted-foreground">{stamp(e.at)}</Mono></span> },
    { key: "area", header: "Area", cell: (e) => <Mono className="rounded-md bg-muted px-1.5 py-0.5 tracking-[0.12em]">{e.area ? AREA_TAG[e.area] : "OTHER"}</Mono> },
    { key: "actor", header: "Who", cell: (e) => <span className="font-medium">{e.actor}</span> },
    { key: "text", header: "What happened", cell: (e) => <span className="block max-w-md truncate" title={e.text}>{e.text}</span> },
    { key: "subject", header: "On", cell: (e) => (e.subject ? e.subjectHref ? <Link href={e.subjectHref} onClick={(x) => x.stopPropagation()} className="font-medium hover:underline">{e.subject}</Link> : e.subject : "—") },
    { key: "risky", header: "Risk", cell: (e) => (e.risky ? <Chip tone="amber">Risky</Chip> : <span className="text-muted-foreground">—</span>) },
    { key: "action", header: "Action key", hidden: true, cell: (e) => <Mono className="text-muted-foreground">{e.action}</Mono> },
    { key: "ip", header: "Network", cell: (e) => <Mono className="text-muted-foreground">{e.ip ?? "—"}</Mono> },
  ]
  const actions = (e: AuditEvent): RowAction[] => [
    { label: "See what changed", icon: ScrollText, onClick: () => setOpen(e) },
    { label: `Open ${e.subject ?? ""}`.trim(), icon: ExternalLink, href: e.subjectHref ?? undefined, hidden: !e.subjectHref },
    { label: "Copy event ID", icon: Copy, separator: true, onClick: () => navigator.clipboard.writeText(e.id).then(() => toast.success("Event ID copied")) },
  ]
  return (
    <>
      <DataTable
        id="audit"
        label="Audit trail"
        table={table}
        columns={columns}
        actions={actions}
        onRowClick={setOpen}
        searchPlaceholder="Search person, business or action"
        filters={
          <>
            <FilterSelect value={area} onChange={(v) => setArea(v as AuditArea | "")} label="Area" options={AREAS} />
            <FilterSelect value={days} onChange={setDays} label="Period" options={[["1", "Last 24 hours"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last year"]]} />
            <FilterSelect value={risky} onChange={setRisky} label="Risk" options={[["", "All changes"], ["true", "Risky only"]]} />
          </>
        }
        empty="No events. Try a longer period or another area."
      />
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-2xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.actor} {open.text}</DialogTitle>
                <DialogDescription>
                  {new Date(open.at).toLocaleString("en-IN")}{open.subject ? ` · ${open.subject}` : ""}{open.ip ? ` · ${open.ip}` : ""} · <Mono>{open.action}</Mono>
                </DialogDescription>
              </DialogHeader>
              {open.risky && <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Risky change: access, prices, refunds or settings.</p>}
              <Changes before={open.before} after={open.after} />
              {open.subjectHref && <Link href={open.subjectHref} className="text-sm font-medium text-primary hover:underline">Open {open.subject}</Link>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function SignIns() {
  const { data, error, reload } = useApi<{ data: SignInRow[] }>("/console/security/sign-ins")
  const [result, setResult] = React.useState("")
  const rows = React.useMemo(() => data?.data.filter((r) => !result || (result === "ok" ? r.outcome === "success" : r.outcome !== "success")) ?? null, [data, result])
  const table = useClientTable(rows, { person: (r) => r.person, device: (r) => r.device, ip: (r) => r.ip ?? "", at: (r) => r.at, outcome: (r) => r.outcome })
  if (error) return <Failed error={error} onRetry={reload} />
  const columns: Column<SignInRow>[] = [
    { key: "at", header: "When", always: true, sortable: true, cell: (r) => <Mono className="text-muted-foreground">{stamp(r.at)}</Mono> },
    { key: "person", header: "Person", sortable: true, cell: (r) => <span className="font-medium">{r.person}</span> },
    { key: "outcome", header: "Result", sortable: true, cell: (r) => { const o = OUTCOME[r.outcome] ?? { label: r.outcome, tone: "grey" as const }; return <Chip tone={o.tone}>{o.label}</Chip> } },
    { key: "device", header: "Device", cell: (r) => <span className="text-muted-foreground">{r.device}</span> },
    { key: "ip", header: "Network", cell: (r) => <Mono className="text-muted-foreground">{r.ip ?? "—"}</Mono> },
  ]
  const failed = data?.data.filter((r) => r.outcome !== "success").length ?? 0
  return (
    <DataTable
      id="signins"
      label="Sign-ins"
      table={table}
      columns={columns}
      searchFields={[{ key: "person", label: "Person" }, { key: "device", label: "Device" }, { key: "ip", label: "Network" }]}
      summary={data && <><Count tone="green" n={data.data.length - failed} label="Signed in" /><Count tone="red" n={failed} label="Failed" /></>}
      filters={<FilterSelect value={result} onChange={setResult} label="Result" options={[["", "Any result"], ["ok", "Signed in"], ["failed", "Failed"]]} />}
      empty="No sign-ins in the last 30 days."
    />
  )
}

function Sessions() {
  const { data, error, reload } = useApi<{ data: SessionRow[] }>("/console/security/sessions")
  const [revoke, setRevoke] = React.useState<SessionRow | null>(null)
  const table = useClientTable(data?.data, { person: (s) => s.person, email: (s) => s.email, role: (s) => s.role, device: (s) => s.device, since: (s) => s.since })
  if (error) return <Failed error={error} onRetry={reload} />
  const columns: Column<SessionRow>[] = [
    { key: "person", header: "Person", always: true, sortable: true, cell: (s) => <span className="font-medium">{s.person} {s.current && <span className="text-xs font-normal text-muted-foreground">(this session)</span>}</span> },
    { key: "email", header: "Email", sortable: true, cell: (s) => s.email },
    { key: "role", header: "Role", sortable: true, cell: (s) => <Chip tone="blue">{s.role}</Chip> },
    { key: "device", header: "Device", cell: (s) => <span className="text-muted-foreground">{s.device}</span> },
    { key: "ip", header: "Network", cell: (s) => <Mono className="text-muted-foreground">{s.ip ?? "—"}</Mono> },
    { key: "since", header: "Signed in", sortable: true, cell: (s) => <span className="text-muted-foreground">{ago(s.since)}</span> },
  ]
  const actions = (s: SessionRow): RowAction[] => [{ label: "Sign out", icon: LogOut, danger: true, onClick: () => setRevoke(s), hidden: s.current }]
  return (
    <>
      <DataTable
        id="sessions"
        label="Open Console sessions"
        table={table}
        columns={columns}
        actions={actions}
        searchFields={[{ key: "person", label: "Person" }, { key: "email", label: "Email" }, { key: "role", label: "Role" }]}
        summary={<span className="text-muted-foreground">Signing someone out ends that session on every device it was copied to.</span>}
      />
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
    </>
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
