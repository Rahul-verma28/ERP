"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CheckCircle2, Clock, ExternalLink, Eye, FileCheck2, FileText, RotateCcw, Users } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/common"
import { countBy, DataList, localList, type Column, type ViewPreset } from "@/components/data-list"
import { ActionMenu, Pill } from "@/components/page-parts"
import { PersonCell, RecordView } from "@/components/record-view"
import { SummaryCards, share } from "@/components/summary-cards"
import { todayInIndia } from "@contracts/validation"
import { api, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate } from "@/lib/format"
import { openFile } from "@/lib/files"
import { NoAccessPage } from "@/components/page-states"

// Acknowledgments: for every document that must be read, one row per employee — who has
// confirmed, when, who shared it, and how long the rest have been pending.

interface Row { id: string; postId: string; document: string; category: string | null; url: string | null; effectiveOn: string | null; employeeId: string; employee: string; employeeCode: string; employeeSub: string | null; department: string | null; status: "pending" | "acknowledged"; ackedAt: string | null; assignedOn: string; assignedBy: string | null }
const PRESETS: ViewPreset[] = [{ key: "all", label: "All", params: {}, countKey: "all" }, { key: "pending", label: "Pending", params: { status: "pending" }, countKey: "pending" }, { key: "acknowledged", label: "Acknowledged", params: { status: "acknowledged" }, countKey: "acknowledged" }]
const waited = (r: Row) => Math.max(0, Math.round((new Date(todayInIndia()).getTime() - new Date(r.assignedOn.slice(0, 10)).getTime()) / 86_400_000))

export default function AcknowledgmentsPage() {
  const { can } = useAuth()
  const me = useApi<{ employee: { id: string } | null }>("/hr/me")
  const [version, setVersion] = React.useState(0)
  const [docs, setDocs] = React.useState<{ value: string; label: string }[]>([])
  const [viewing, setViewing] = React.useState<Row | null>(null)
  if (!can("hr.workplace.view")) return <NoAccessPage title="Acknowledgments" permission="hr.workplace.view" />
  const myId = me.data?.employee?.id
  const hr = can("hr.workplace.edit")
  const reload = () => setVersion((v) => v + 1)
  async function ack(r: Row) {
    try { await api.post(`/hr/posts/${r.postId}/ack`, {}); toast.success("Thanks, noted that you have read it"); reload() } catch (e) { toast.error(errorMessage(e)) }
  }
  async function ackFor(r: Row, undo = false) {
    try { await api.post(`/hr/posts/${r.postId}/ack-for`, { employeeId: r.employeeId, undo }); toast.success(undo ? `${r.employee}: back to pending` : `${r.employee}: marked as read`); setViewing(null); reload() } catch (e) { toast.error(errorMessage(e)) }
  }
  const columns: Column<Row>[] = [
    { key: "employee", header: "Employee", hideable: false, sort: (r) => r.employee, csv: (r) => r.employee, cell: (r) => <PersonCell name={r.employee} sub={r.employeeSub ?? r.employeeCode} /> },
    { key: "dept", header: "Department", csv: (r) => r.department ?? "", cell: (r) => (r.department ? <Pill color="violet">{r.department}</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "document", header: "Document", sort: (r) => r.document, csv: (r) => r.document, cell: (r) => <span className="flex items-center gap-2"><FileText className="size-4 shrink-0 text-primary" /><span className="min-w-0"><span className="block max-w-60 truncate font-medium">{r.document}</span>{r.category && <span className="text-xs text-muted-foreground">{r.category}</span>}</span></span> },
    { key: "status", header: "Status", csv: (r) => r.status, cell: (r) => (r.status === "acknowledged" ? <Pill color="emerald" dot>Acknowledged</Pill> : <Pill color={waited(r) > 7 ? "rose" : "amber"} dot>Pending{waited(r) ? ` · ${waited(r)}d` : ""}</Pill>) },
    { key: "acked", header: "Acknowledged at", sort: (r) => r.ackedAt ?? "", csv: (r) => r.ackedAt?.slice(0, 10) ?? "", cell: (r) => (r.ackedAt ? formatDate(r.ackedAt) : <span className="text-muted-foreground">—</span>) },
    { key: "by", header: "Assigned by", csv: (r) => r.assignedBy ?? "", cell: (r) => <span className="text-sm">{r.assignedBy ?? "—"}<span className="block text-xs text-muted-foreground">{formatDate(r.assignedOn)}</span></span> },
    {
      key: "actions", header: "Actions", hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {r.status === "pending" && r.employeeId === myId && <Button size="sm" className="h-8" onClick={() => void ack(r)}><CheckCircle2 /> I have read it</Button>}
          <Button variant="ghost" size="icon-sm" title="View" aria-label={`View acknowledgment of ${r.employee}`} onClick={() => setViewing(r)}><Eye /></Button>
          <ActionMenu label="More actions" items={[
            r.url && { label: "Open document", icon: ExternalLink, onClick: () => void openFile(r.url) },
            hr && r.status === "pending" && { label: "Mark as read (signed copy)", icon: CheckCircle2, onClick: () => void ackFor(r) },
            hr && r.status === "acknowledged" && { label: "Back to pending", icon: RotateCcw, onClick: () => void ackFor(r, true) },
          ]} />
        </span>
      ),
    },
  ]
  return (
    <>
      <DataList<Row>
        id="hr-acks"
        load={localList(
          async () => {
            const rows = (await api.get<{ data: Row[] }>("/hr/acknowledgments")).data
            setDocs([...new Map(rows.map((r) => [r.postId, { value: r.postId, label: r.document }])).values()])
            return rows
          },
          (r, q) => `${r.employee} ${r.employeeCode} ${r.document} ${r.department ?? ""}`.toLowerCase().includes(q),
          {
            filter: (r, p) => (!p.status || r.status === p.status) && (!p.postId || r.postId === p.postId),
            counts: (rows) => countBy(rows, (r) => r.status),
            meta: (rows) => ({ docCount: new Set(rows.map((r) => r.postId)).size, people: new Set(rows.map((r) => r.employeeId)).size, overdue: rows.filter((r) => r.status === "pending" && waited(r) > 7).length }),
          },
        )}
        params={{ v: String(version) }}
        header={{ title: "Acknowledgments", description: "Who has confirmed reading each policy or document, and who still has to.", actions: <Link href="/app/m/hr/workplace/document" className={buttonVariants({ variant: "outline", className: "h-10 rounded-xl" })}><FileCheck2 /> Documents</Link> }}
        top={(r) => {
          const c = (r.counts ?? {}) as Record<string, number>
          return <SummaryCards items={[
            { label: "To acknowledge", value: c.all ?? 0, hint: `${Number(r.docCount ?? 0)} documents · ${Number(r.people ?? 0)} people`, color: "blue", icon: FileText },
            { label: "Acknowledged", value: c.acknowledged ?? 0, hint: share(c.acknowledged ?? 0, c.all ?? 0), color: "emerald", icon: CheckCircle2 },
            { label: "Pending", value: c.pending ?? 0, hint: share(c.pending ?? 0, c.all ?? 0), color: "amber", icon: Clock },
            { label: "Pending over 7 days", value: Number(r.overdue ?? 0), hint: "Remind them", color: "rose", icon: Users },
          ]} />
        }}
        columns={columns}
        searchPlaceholder="Search employee, document or department"
        presetLabel="Show"
        presets={PRESETS}
        tabs
        filters={[{ key: "postId", label: "Document", options: docs }]}
        rowClick={(r) => setViewing(r)}
        exportName="acknowledgments"
        emptyState={<EmptyState icon={FileCheck2} title="Nothing to acknowledge" description="Turn on “Staff must confirm they have read it” on a document to ask everyone." />}
      />
      {viewing && (
        <RecordView
          title="Acknowledgment"
          icon={FileCheck2}
          status={viewing.status === "acknowledged" ? <Pill color="emerald" dot>Acknowledged</Pill> : <Pill color="amber" dot>Pending</Pill>}
          onClose={() => setViewing(null)}
          fields={[
            { label: "Employee", value: null, person: { name: viewing.employee, sub: [viewing.employeeCode, viewing.employeeSub].filter(Boolean).join(" · ") } },
            { label: "Department", value: viewing.department },
            { label: "Document", value: viewing.document },
            { label: "Category", value: viewing.category },
            { label: "Effective from", value: viewing.effectiveOn ? formatDate(viewing.effectiveOn) : null },
            { label: "Link", value: null, href: viewing.url },
            { label: "Assigned by", value: `${viewing.assignedBy ?? "—"} · ${formatDate(viewing.assignedOn)}` },
            { label: "Acknowledged at", value: viewing.ackedAt ? formatDate(viewing.ackedAt) : `Not yet · waiting ${waited(viewing)} days`, tone: viewing.ackedAt ? "success" : waited(viewing) > 7 ? "danger" : undefined },
          ]}
          footer={<>
            {viewing.status === "pending" && viewing.employeeId === myId && <Button onClick={() => { void ack(viewing); setViewing(null) }}><CheckCircle2 /> I have read it</Button>}
            {hr && viewing.status === "pending" && <Button variant="outline" onClick={() => void ackFor(viewing)}><CheckCircle2 /> Mark as read (signed copy)</Button>}
            {hr && viewing.status === "acknowledged" && <Button variant="outline" onClick={() => void ackFor(viewing, true)}><RotateCcw /> Back to pending</Button>}
          </>}
        />
      )}
    </>
  )
}
