"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { CalendarPlus, Copy, CreditCard, Download, ExternalLink, KeyRound, Plus } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { ClientStateChip, OnboardedChip, Page, ago, industryLabel, money } from "@/components/console/kit"
import { DataTable, FilterSelect, IdCell, type Column, type RowAction } from "@/components/console/data-table"
import { BulkBar, DaysDialog, LinkDialog } from "@/components/console/bulk-actions"
import { SavedViews } from "@/components/console/saved-views"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { useServerTable, type SortState } from "@/lib/use-table"
import { errorMessage } from "@/lib/api"
import { downloadCsv } from "@/lib/csv"
import { formatDate } from "@/lib/format"
import { MODULE_SHORT, type Catalog, type ClientRow } from "@/lib/console"
import { cn } from "@/lib/utils"
import { useConsoleBase } from "@/lib/console-base"

// Businesses: one wide table with every account detail (pick columns in View), numbered pages,
// sortable columns, saved views, ticked rows for bulk actions and a ⋮ menu per business.
// Partner businesses live under Partners, so the AHEAD team's list leaves them out.

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

/** Column sort → the API's sort value */
const sortParam = (s: SortState | null) =>
  !s ? undefined : s.key === "name" ? (s.dir === "asc" ? "name" : "name_desc") : s.key === "created" ? (s.dir === "asc" ? "oldest" : "newest") : s.key === "status" ? "status" : undefined

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
  const shown = keys.slice(0, 3)
  return (
    <div className="flex gap-1" title={keys.map((k) => MODULE_SHORT[k] ?? k).join(", ")}>
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
    <div className="flex items-center gap-2 tabular-nums">
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

const HEALTH_TONE: Record<string, string> = { good: "text-emerald-700 dark:text-emerald-400", errors: "text-red-700 dark:text-red-400", limit: "text-amber-700 dark:text-amber-400", no_invoice: "text-amber-700 dark:text-amber-400", quiet: "text-muted-foreground" }

function ClientsList() {
  const router = useRouter()
  const params = useSearchParams()
  const base = useConsoleBase()
  const { me, canConsole } = useAuth()
  const audience = me?.console?.audience ?? "team"
  const team = audience === "team"
  const own = audience === "vendor" || me?.console?.role.key === "console_sales"
  const [status, setStatus] = React.useState(params.get("status") ?? "")
  const [planKey, setPlanKey] = React.useState(params.get("planKey") ?? "")
  const [onboarded, setOnboarded] = React.useState(params.get("onboarded") ?? "")
  const [industryKey, setIndustryKey] = React.useState("")
  const table = useServerTable<ClientRow>("/console/tenants", { status, planKey, onboarded, industryKey }, { sortParam })
  const catalog = useApi<Catalog>("/console/catalog")
  const industries = useApi<{ data: { key: string; name: string }[] }>("/public/industries")
  const canAdd = canConsole("platform.tenant.create") && me?.console?.partner?.status !== "paused"
  const canExtend = canConsole("platform.grace.create")

  // Ticked rows survive paging; keep the row data so bulk actions can use it
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const [known, setKnown] = React.useState<Map<string, ClientRow>>(new Map())
  const [seenRows, setSeenRows] = React.useState(table.rows)
  if (seenRows !== table.rows) {
    setSeenRows(table.rows)
    setKnown((m) => new Map([...m, ...table.rows.map((r) => [r.id, r] as const)]))
  }
  const selected = [...picked].map((id) => known.get(id)).filter((x): x is ClientRow => !!x)
  const [single, setSingle] = React.useState<{ kind: "link" | "days"; row: ClientRow } | null>(null)

  function applyView(f: { search?: string; status?: string; planKey?: string; onboarded?: string; industryKey?: string }) {
    table.setSearch(f.search ?? "")
    setStatus(f.status ?? "")
    setPlanKey(f.planKey ?? "")
    setOnboarded(f.onboarded ?? "")
    setIndustryKey(f.industryKey ?? "")
    setPicked(new Set())
  }

  function exportCsv(rows: ClientRow[]) {
    downloadCsv("businesses.csv", [
      ["ID", "Business", "Industry", "Owner", "Mobile", "Email", "Status", "Plan", "Cycle", "Modules", "Users", "User limit", "Per month (₹)", "Onboarded by", "Created", "Last active"],
      ...rows.map((c) => [
        c.id, c.name, industryLabel(c.industryKey), c.owner?.name ?? "", c.owner?.mobile ?? "", c.owner?.email ?? "", c.progress && !c.progress.loggedIn ? "Not logged in" : c.status,
        planText(c), c.cycle ?? "", c.modules.map((k) => MODULE_SHORT[k] ?? k).join(" "), c.activeUsers, c.userLimit ?? "", c.mrrPaise ? c.mrrPaise / 100 : "",
        c.onboardedBy ? [c.onboardedBy.kind, c.onboardedBy.name].filter(Boolean).join(" · ") : "", c.createdAt.slice(0, 10), c.progress?.lastActiveAt?.slice(0, 10) ?? "",
      ]),
    ])
  }

  const href = (c: ClientRow, tab?: string) => `${base}/clients/${c.id}${tab ? `?tab=${tab}` : ""}`
  const columns: Column<ClientRow>[] = [
    { key: "id", header: "ID", cell: (c) => <IdCell id={c.id} href={href(c)} /> },
    {
      key: "name", header: "Business", always: true, sortable: true,
      cell: (c) => (
        <div className="max-w-64">
          <Link href={href(c)} onClick={(e) => e.stopPropagation()} className="block truncate font-medium hover:underline">{c.name}</Link>
          <div className="text-[12.5px] text-muted-foreground">{industryLabel(c.industryKey)}</div>
        </div>
      ),
    },
    { key: "owner", header: "Owner", cell: (c) => c.owner?.name ?? "—" },
    { key: "mobile", header: "Mobile", cell: (c) => <span className="tabular-nums">{c.owner?.mobile.replace(/^\+91/, "+91 ") ?? "—"}</span> },
    { key: "email", header: "Email", cell: (c) => c.owner?.email ?? "—" },
    { key: "status", header: "Status", sortable: true, cell: (c) => <ClientStateChip status={c.status} progress={c.progress} trialEndsAt={c.trialEndsAt} partnerBilled={!!c.partner} /> },
    { key: "plan", header: "Plan", cell: (c) => <span>{planText(c)}{c.status !== "trialing" && c.status !== "free" && c.cycle && <span className="text-muted-foreground"> · {c.cycle === "yearly" ? "Yearly" : "Monthly"}</span>}</span> },
    { key: "modules", header: "Modules", cell: (c) => <Modules keys={c.modules} /> },
    { key: "users", header: "Users", cell: (c) => <Users used={c.activeUsers} limit={c.userLimit} /> },
    ...(audience !== "partner" ? [{ key: "mrr", header: "Per month", align: "right" as const, cell: (c: ClientRow) => (c.mrrPaise ? money(c.mrrPaise) : "—") }] : []),
    { key: "next", header: "Next date", cell: (c) => <span className="text-muted-foreground">{nextDate(c)}</span> },
    { key: "health", header: "Health", hidden: true, cell: (c) => (c.health ? <span className={HEALTH_TONE[c.health.flag]}>{c.health.label}</span> : "—") },
    ...(team ? [{ key: "onboarded", header: "Onboarded by", cell: (c: ClientRow) => <OnboardedChip by={c.onboardedBy} /> }] : []),
    { key: "created", header: "Created", sortable: true, cell: (c) => <span className="text-muted-foreground">{formatDate(c.createdAt)}</span> },
    { key: "active", header: "Last active", cell: (c) => <span className="text-muted-foreground">{c.progress?.lastActiveAt ? ago(c.progress.lastActiveAt) : "Never"}</span> },
  ]

  const actions = (c: ClientRow): RowAction[] => [
    { label: "Open business", icon: ExternalLink, href: href(c) },
    { label: "Plan & billing", icon: CreditCard, href: href(c, "plan"), hidden: own && audience === "vendor" },
    { label: "Send login link", icon: KeyRound, onClick: () => setSingle({ kind: "link", row: c }), hidden: !(c.progress && !c.progress.loggedIn), separator: true },
    { label: "Add days", icon: CalendarPlus, onClick: () => setSingle({ kind: "days", row: c }), hidden: !canExtend || !["trialing", "past_due"].includes(c.status) },
    {
      label: "Copy ID", icon: Copy, separator: true,
      onClick: () => navigator.clipboard.writeText(c.id).then(() => toast.success("ID copied"), (e) => toast.error(errorMessage(e))),
    },
  ]

  return (
    <Page
      eyebrow="Workspace"
      title={own ? "My businesses" : "Businesses"}
      subtitle={audience === "partner" ? "Businesses you look after. You are billed for them every month." : own ? "Businesses you brought to AHEAD." : "Every business AHEAD bills directly. Partners' businesses are under Partners."}
      wide
      actions={
        canAdd && (
          <Link href={`${base}/clients/new`} className={buttonVariants()}>
            <Plus /> Onboard business
          </Link>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <SavedViews current={{ search: table.search, status, planKey, onboarded, industryKey }} onApply={applyView} />
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
      </div>

      {selected.length > 0 && <BulkBar rows={selected} canExtend={canExtend} canExport={team} onExport={() => exportCsv(selected)} onClear={() => setPicked(new Set())} onDone={table.reload} />}

      <DataTable
        id="businesses"
        label="Businesses"
        table={table}
        columns={columns}
        actions={actions}
        searchPlaceholder="Search business, owner, mobile, GSTIN or full ID"
        selectable
        selected={picked}
        onSelectedChange={setPicked}
        onRowClick={(c) => router.push(href(c))}
        empty={canAdd ? "No businesses yet. Onboard one, or share your link." : "No businesses yet."}
        filters={
          <>
            <FilterSelect value={planKey} onChange={setPlanKey} label="Plan" options={[["", "Any plan"], ...(catalog.data?.plans.map((p) => [p.key, p.name] as [string, string]) ?? [])]} />
            {team && <FilterSelect value={onboarded} onChange={setOnboarded} label="Onboarded by" options={ONBOARDED_FILTER} />}
            <FilterSelect value={industryKey} onChange={setIndustryKey} label="Industry" options={[["", "Any industry"], ...(industries.data?.data.map((i) => [i.key, i.name] as [string, string]) ?? [])]} />
          </>
        }
        toolbar={
          team && table.rows.length > 0 && (
            <Button variant="outline" size="sm" className="h-9" onClick={() => exportCsv(table.rows)} title="Export this page">
              <Download /> Export
            </Button>
          )
        }
      />

      {single?.kind === "link" && <LinkDialog rows={[single.row]} skipped={0} onClose={() => setSingle(null)} onDone={table.reload} />}
      {single?.kind === "days" && <DaysDialog rows={[single.row]} skipped={0} onClose={() => setSingle(null)} onDone={table.reload} />}
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
