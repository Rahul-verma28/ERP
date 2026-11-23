"use client"

import { History } from "lucide-react"
import { EmptyState } from "@/components/common"
import { DataList, type FilterDef } from "@/components/data-list"
import { NoAccessPage } from "@/components/page-states"
import { Pill } from "@/components/page-parts"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { formatDateTime } from "@/lib/format"
import { useApi } from "@/lib/use-api"

// Settings › Audit log: who did what and when, in plain words, with filters by area, person and
// date, and a search. Entries can't be edited and are kept for at least 2 years.

interface Entry {
  id: string
  action: string
  what: string
  area: string
  detail: string | null
  actorKind: string
  actorName: string | null
  ip: string | null
  at: string
}

const AREA_COLOR: Record<string, string> = {
  "Sign-ins & account": "blue",
  "Users & roles": "violet",
  Settings: "slate",
  "Plan & subscription": "amber",
  "Sales & billing": "emerald",
  "Purchase & stock": "orange",
  Items: "orange",
  "Accounts & finance": "emerald",
  "HR & payroll": "rose",
  "Tasks, bookings & support": "blue",
}

const DATES: { value: string; label: string; days: number }[] = [
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "365", label: "Last 12 months", days: 365 },
]
const dayInIndia = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)

export default function AuditPage() {
  const { can } = useAuth()
  const filters = useApi<{ people: { id: string; name: string }[]; areas: { key: string; label: string }[] }>(can("tenant.audit.view") ? "/audit-log/filters" : null)
  if (!can("tenant.audit.view")) return <NoAccessPage title="Audit log" permission="tenant.audit.view" />

  const filterDefs: FilterDef[] = [
    { key: "area", label: "Area", options: (filters.data?.areas ?? []).map((a) => ({ value: a.key, label: a.label })) },
    { key: "actorId", label: "Who", options: (filters.data?.people ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { key: "days", label: "When", options: DATES.map((d) => ({ value: d.value, label: d.label })), toParams: (v) => ({ from: dayInIndia(new Date(Date.now() - Number(v) * 86_400_000)) }) },
  ]

  return (
    <DataList<Entry>
      id="audit-log"
      load={({ params, limit, cursor }) => {
        const q = new URLSearchParams({ limit: String(limit) })
        if (cursor) q.set("cursor", cursor)
        for (const k of ["q", "area", "actorId", "from", "to"]) if (params[k]) q.set(k, params[k])
        return api.get(`/audit-log?${q}`)
      }}
      header={{ title: "Audit log", description: "Sign-ins, role changes, plan changes, deletes, exports and money actions. Kept for at least 2 years and cannot be edited." }}
      filters={filters.data ? filterDefs : undefined}
      searchPlaceholder="Search what was done or by whom"
      columns={[
        { key: "at", header: "When", hideable: false, csv: (r) => r.at, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.at)}</span> },
        { key: "who", header: "Who", csv: (r) => r.actorName ?? "", cell: (r) => <span className="font-medium">{r.actorName ?? (r.actorKind === "system" ? "System" : "AHEAD")}</span> },
        {
          key: "what", header: "What", hideable: false, csv: (r) => r.what,
          cell: (r) => (
            <span className="grid gap-0.5">
              <span>{r.what}</span>
              {r.detail && <span className="max-w-96 truncate text-xs text-muted-foreground">{r.detail}</span>}
            </span>
          ),
        },
        { key: "area", header: "Area", csv: (r) => r.area, cell: (r) => <Pill color={AREA_COLOR[r.area] ?? "slate"}>{r.area}</Pill> },
        { key: "ip", header: "IP address", csv: (r) => r.ip ?? "", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.ip === "::1" || r.ip === "127.0.0.1" ? "This computer" : r.ip ?? "—"}</span> },
        { key: "code", header: "Action code", defaultHidden: true, csv: (r) => r.action, cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.action}</span> },
      ]}
      exportName="audit-log"
      emptyState={<EmptyState icon={History} title="Nothing recorded yet" description="Sign-ins and changes made in the business show here." />}
    />
  )
}
