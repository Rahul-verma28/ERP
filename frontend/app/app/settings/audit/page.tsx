"use client"

import { History } from "lucide-react"
import { EmptyState } from "@/components/common"
import { DataList } from "@/components/data-list"
import { api } from "@/lib/api"
import { formatDateTime } from "@/lib/format"

interface Entry {
  id: string
  action: string
  actorKind: string
  actorName: string | null
  entity: string | null
  ip: string | null
  at: string
}

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.password_reset": "Reset password",
  "tenant.created": "Created the business",
  "tenant.update": "Updated business details",
  "branch.create": "Added a branch",
  "branch.update": "Updated a branch",
  "member.invite": "Invited a user",
  "member.invite_revoke": "Revoked an invitation",
  "member.joined": "Joined the business",
  "member.update": "Updated a user",
  "member.role_change": "Changed a user's role",
  "config.terms.update": "Changed terminology",
  "config.field.create": "Added a custom field",
  "config.field.update": "Changed a custom field",
  "subscription.transition": "Subscription changed",
}

export default function AuditPage() {
  return (
    <DataList<Entry>
      id="audit-log"
      load={({ limit, cursor }) => api.get(`/audit-log?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`)}
      noSearch
      header={{ title: "Audit log", description: "Sign-ins, role changes, plan changes, deletes, exports and financial actions. Kept for at least 2 years and cannot be edited." }}
      columns={[
        { key: "at", header: "When", hideable: false, cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.at)}</span> },
        { key: "who", header: "Who", cell: (r) => r.actorName ?? (r.actorKind === "system" ? "System" : "AHEAD") },
        { key: "what", header: "What", cell: (r) => ACTION_LABEL[r.action] ?? r.action },
        { key: "ip", header: "IP", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.ip ?? "—"}</span> },
      ]}
      emptyState={<EmptyState icon={History} title="Nothing recorded yet" />}
    />
  )
}
