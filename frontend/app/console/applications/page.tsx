"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Inbox } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FormError } from "@/components/form"
import { Chip, Empty, Failed, Loading, Page, PageTabs, Panel, ago } from "@/components/console/kit"
import { LoginLinkBox, type LoginLink } from "@/components/console/login-link"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"
import { formatDate, GST_STATES } from "@/lib/format"
import type { ApplicationRow } from "@/lib/console"

// Applications (blueprint Phase G): people who asked on the website (/apply) to become a vendor
// or a partner. Approve to create them with a login link, or turn them down. Admin only.

type Status = "new" | "approved" | "rejected"

export default function ApplicationsPage() {
  const [status, setStatus] = React.useState<Status>("new")
  const { data, error, reload } = useApi<{ counts: Record<Status, number>; data: ApplicationRow[] }>(`/console/applications?status=${status}`)
  const [approving, setApproving] = React.useState<ApplicationRow | null>(null)

  if (error) return <Failed error={error} onRetry={reload} />
  return (
    <Page
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
      {!data ? (
        <Loading rows={4} />
      ) : !data.data.length ? (
        <Empty icon={Inbox} title={status === "new" ? "Nothing to review" : "None yet"} text={status === "new" ? "New applications from the website appear here." : undefined} />
      ) : (
        <div className="grid gap-4">
          {data.data.map((a) => (
            <ApplicationCard key={a.id} a={a} onApprove={() => setApproving(a)} onDone={reload} />
          ))}
        </div>
      )}
      {approving && <ApproveDialog a={approving} onClose={() => { setApproving(null); reload() }} />}
    </Page>
  )
}

function ApplicationCard({ a, onApprove, onDone }: { a: ApplicationRow; onApprove: () => void; onDone: () => void }) {
  const [rejecting, setRejecting] = React.useState(false)
  const [note, setNote] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const state = a.stateCode ? GST_STATES.find(([c]) => c === a.stateCode)?.[1] : null

  async function reject() {
    setBusy(true)
    try {
      await api.post(`/console/applications/${a.id}/reject`, { note: note || null })
      toast.success("Turned down")
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel>
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{a.kind === "partner" ? a.company : a.name}</span>
            <Chip tone={a.kind === "partner" ? "blue" : "grey"}>{a.kind === "partner" ? "Partner" : "Vendor"}</Chip>
            {a.alreadyInConsole && <Chip tone="amber">Already a Console user</Chip>}
            {a.alreadyPartner && <Chip tone="amber">Email used by a partner</Chip>}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {a.kind === "partner" && <>{a.name} · </>}{a.email} · {a.mobile}{a.city || state ? ` · ${[a.city, state].filter(Boolean).join(", ")}` : ""}{a.gstin ? ` · GSTIN ${a.gstin}` : ""}
          </div>
          {a.message && <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-sm whitespace-pre-line">{a.message}</p>}
          <div className="mt-2 text-xs text-muted-foreground">
            Applied {ago(a.createdAt).toLowerCase()}
            {a.status !== "new" && a.decidedAt && <> · {a.status === "approved" ? "Approved" : "Turned down"} {formatDate(a.decidedAt)}{a.decidedBy ? ` by ${a.decidedBy}` : ""}</>}
            {a.decisionNote && <> · “{a.decisionNote}”</>}
          </div>
        </div>
        {a.status === "new" && !rejecting && (
          <div className="flex gap-2 md:flex-col md:items-stretch">
            <Button onClick={onApprove} disabled={busy}>Approve</Button>
            <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>Turn down</Button>
          </div>
        )}
        {a.status === "approved" && a.resultId && (
          <Link href={a.kind === "partner" ? `/console/partners/${a.resultId}` : "/console/team"} className="self-start text-sm font-medium text-primary hover:underline">
            {a.kind === "partner" ? "Open partner" : "Open Team"}
          </Link>
        )}
      </div>
      {rejecting && (
        <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Note for the record (optional)" hint="Only the AHEAD team sees it">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Not in our area yet" />
          </Field>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={reject} disabled={busy}>Turn down</Button>
          </div>
        </div>
      )}
    </Panel>
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
