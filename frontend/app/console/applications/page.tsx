"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Check, Copy, ExternalLink, FileText, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FormError } from "@/components/form"
import { Chip, Facts, Failed, Page, PageTabs, ago } from "@/components/console/kit"
import { DataTable, FilterSelect, IdCell, type Column, type RowAction } from "@/components/console/data-table"
import { LoginLinkBox, type LoginLink } from "@/components/console/login-link"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"
import { useClientTable } from "@/lib/use-table"
import { formatDate, GST_STATES } from "@/lib/format"
import type { ApplicationRow } from "@/lib/console"

// Applications (blueprint Phase G): people who asked on the website (/apply) to become a vendor
// or a partner. Approve to create them with a login link, or turn them down. Admin only.

type Status = "new" | "approved" | "rejected"
const stateName = (code: string | null) => (code ? GST_STATES.find(([c]) => c === code)?.[1] ?? code : null)

export default function ApplicationsPage() {
  const [status, setStatus] = React.useState<Status>("new")
  const [kind, setKind] = React.useState("")
  const { data, error, reload } = useApi<{ counts: Record<Status, number>; data: ApplicationRow[] }>(`/console/applications?status=${status}`)
  const [reading, setReading] = React.useState<ApplicationRow | null>(null)
  const [approving, setApproving] = React.useState<ApplicationRow | null>(null)
  const [rejecting, setRejecting] = React.useState<ApplicationRow | null>(null)
  const rows = React.useMemo(() => data?.data.filter((a) => !kind || a.kind === kind) ?? null, [data, kind])
  const table = useClientTable(rows, {
    name: (a) => a.name, company: (a) => a.company ?? "", email: (a) => a.email, mobile: (a) => a.mobile, city: (a) => a.city ?? "", applied: (a) => a.createdAt, kind: (a) => a.kind,
  })
  if (error) return <Failed error={error} onRetry={reload} />

  const columns: Column<ApplicationRow>[] = [
    { key: "id", header: "ID", cell: (a) => <IdCell id={a.id} /> },
    {
      key: "name", header: "Applicant", always: true, sortable: true,
      cell: (a) => (
        <div>
          <div className="font-medium">{a.kind === "partner" ? a.company : a.name}</div>
          {a.kind === "partner" && <div className="text-[12.5px] text-muted-foreground">{a.name}</div>}
        </div>
      ),
    },
    { key: "kind", header: "Wants to be", sortable: true, cell: (a) => <Chip tone={a.kind === "partner" ? "blue" : "grey"}>{a.kind === "partner" ? "Partner" : "Vendor"}</Chip> },
    { key: "email", header: "Email", sortable: true, cell: (a) => a.email },
    { key: "mobile", header: "Phone", cell: (a) => <span className="tabular-nums">{a.mobile.replace(/^[+]91/, "+91 ")}</span> },
    { key: "city", header: "Place", sortable: true, cell: (a) => [a.city, stateName(a.stateCode)].filter(Boolean).join(", ") || "—" },
    { key: "gstin", header: "GSTIN", hidden: true, cell: (a) => <span className="font-mono text-[12.5px]">{a.gstin ?? "—"}</span> },
    { key: "message", header: "Message", cell: (a) => <span className="block max-w-xs truncate text-muted-foreground" title={a.message ?? undefined}>{a.message ?? "—"}</span> },
    { key: "flags", header: "Check", cell: (a) => (a.alreadyInConsole ? <Chip tone="amber">Already a Console user</Chip> : a.alreadyPartner ? <Chip tone="amber">Email used by a partner</Chip> : <span className="text-muted-foreground">—</span>) },
    { key: "applied", header: "Applied", sortable: true, cell: (a) => <span className="text-muted-foreground">{ago(a.createdAt)}</span> },
    ...(status !== "new"
      ? [{ key: "decided", header: status === "approved" ? "Approved" : "Turned down", cell: (a: ApplicationRow) => <span className="text-muted-foreground">{a.decidedAt ? formatDate(a.decidedAt) : "—"}{a.decidedBy ? ` · ${a.decidedBy}` : ""}</span> }]
      : []),
  ]
  const actions = (a: ApplicationRow): RowAction[] => [
    { label: "Read application", icon: FileText, onClick: () => setReading(a) },
    { label: "Approve", icon: Check, onClick: () => setApproving(a), hidden: a.status !== "new" },
    { label: "Turn down", icon: X, danger: true, onClick: () => setRejecting(a), hidden: a.status !== "new" },
    { label: a.kind === "partner" ? "Open partner" : "Open Team", icon: ExternalLink, href: a.kind === "partner" ? `/console/partners/${a.resultId}` : "/console/team", hidden: a.status !== "approved" || !a.resultId },
    { label: "Copy email", icon: Copy, separator: true, onClick: () => navigator.clipboard.writeText(a.email).then(() => toast.success("Email copied")) },
  ]

  return (
    <Page
      wide
      eyebrow="People & access"
      title="Applications"
      subtitle={<>People who applied on the website to become a vendor or partner. Approve to give them a login link; they set their own password. The form is at <Link href="/apply" target="_blank" className="font-medium text-primary hover:underline">/apply</Link>.</>}
    >
      <PageTabs
        tabs={[
          { key: "new", label: "To review", count: data?.counts.new },
          { key: "approved", label: "Approved", count: data?.counts.approved },
          { key: "rejected", label: "Turned down", count: data?.counts.rejected },
        ]}
        active={status}
        onChange={setStatus}
      />
      <DataTable
        id="applications"
        label="Applications"
        table={table}
        columns={columns}
        actions={actions}
        onRowClick={setReading}
        searchFields={[{ key: "name", label: "Name" }, { key: "company", label: "Company" }, { key: "email", label: "Email" }, { key: "mobile", label: "Phone" }, { key: "city", label: "City" }]}
        filters={<FilterSelect value={kind} onChange={setKind} label="Type" options={[["", "Vendors and partners"], ["vendor", "Vendors"], ["partner", "Partners"]]} />}
        empty={status === "new" ? "Nothing to review. New applications from the website appear here." : "None yet."}
      />
      {reading && (
        <ReadDialog
          a={reading}
          onClose={() => setReading(null)}
          onApprove={() => (setApproving(reading), setReading(null))}
          onReject={() => (setRejecting(reading), setReading(null))}
        />
      )}
      {approving && <ApproveDialog a={approving} onClose={() => (setApproving(null), reload())} />}
      {rejecting && <RejectDialog a={rejecting} onClose={() => setRejecting(null)} onDone={reload} />}
    </Page>
  )
}

function ReadDialog({ a, onClose, onApprove, onReject }: { a: ApplicationRow; onClose: () => void; onApprove: () => void; onReject: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{a.kind === "partner" ? a.company : a.name}</DialogTitle>
          <DialogDescription>Wants to be a {a.kind} · applied {ago(a.createdAt).toLowerCase()}</DialogDescription>
        </DialogHeader>
        <Facts
          items={[
            { label: "Name", value: a.name },
            { label: "Company", value: a.company },
            { label: "Email", value: a.email },
            { label: "Phone", value: a.mobile },
            { label: "Place", value: [a.city, stateName(a.stateCode)].filter(Boolean).join(", ") || null },
            { label: "GSTIN", value: a.gstin },
          ]}
        />
        {a.message && <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm whitespace-pre-line">{a.message}</p>}
        {(a.alreadyInConsole || a.alreadyPartner) && <p className="text-sm text-amber-700 dark:text-amber-400">{a.alreadyInConsole ? "This email already belongs to a Console user." : "This email is already used by a partner."}</p>}
        {a.status !== "new" && <p className="text-sm text-muted-foreground">{a.status === "approved" ? "Approved" : "Turned down"} {a.decidedAt ? formatDate(a.decidedAt) : ""}{a.decidedBy ? ` by ${a.decidedBy}` : ""}{a.decisionNote ? ` · “${a.decisionNote}”` : ""}</p>}
        <DialogFooter>
          {a.status === "new" ? (
            <>
              <Button variant="outline" onClick={onReject}>Turn down</Button>
              <Button onClick={onApprove}>Approve</Button>
            </>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RejectDialog({ a, onClose, onDone }: { a: ApplicationRow; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  async function reject(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post(`/console/applications/${a.id}/reject`, { note: note || null })
      toast.success("Turned down")
      onDone()
      onClose()
    } catch (x) {
      toast.error(errorMessage(x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={reject} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Turn down {a.kind === "partner" ? a.company : a.name}?</DialogTitle>
            <DialogDescription>They don&apos;t get access. Nothing is sent to them.</DialogDescription>
          </DialogHeader>
          <Field label="Note for the record (optional)" hint="Only the AHEAD team sees it">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Not in our area yet" autoFocus />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={busy}>Turn down</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ApproveDialog({ a, onClose }: { a: ApplicationRow; onClose: () => void }) {
  const [discount, setDiscount] = React.useState("10")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<{ loginLink: LoginLink; mobile: string } | null>(null)

  async function approve(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ loginLink: LoginLink; mobile: string }>(`/console/applications/${a.id}/approve`, a.kind === "partner" ? { discountPercent: Number(discount || 0) } : {})
      setDone(r)
    } catch (x) {
      setError(x instanceof ApiError && x.fields ? Object.values(x.fields).filter(Boolean).join(" ") || errorMessage(x) : errorMessage(x))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>{a.kind === "partner" ? `${a.company} is now a partner` : `${a.name} is now a vendor`}</DialogTitle>
              <DialogDescription>We sent this login link by SMS and email. You can also copy it or send it on WhatsApp.</DialogDescription>
            </DialogHeader>
            <LoginLinkBox link={done.loginLink} mobile={done.mobile} message="Welcome to AHEAD. Set up your login here:" />
            <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
          </>
        ) : (
          <form onSubmit={approve} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Approve {a.kind === "partner" ? a.company : a.name}?</DialogTitle>
              <DialogDescription>
                {a.kind === "partner"
                  ? `This creates the partner and makes ${a.name} its owner. They can add their own team and businesses in the partner portal.`
                  : `${a.name} joins the Console as a Vendor: they see only the businesses they bring in, with their own link and code.`}
              </DialogDescription>
            </DialogHeader>
            {a.kind === "partner" && (
              <Field label="Partner discount (%)" hint="Off AHEAD's list price on their monthly bill. You can change it later.">
                <Input type="number" min={0} max={90} value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-32" />
              </Field>
            )}
            <FormError message={error} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Approving…" : "Approve and send login link"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
