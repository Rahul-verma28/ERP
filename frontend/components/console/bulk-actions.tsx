"use client"

import * as React from "react"
import { toast } from "sonner"
import { CalendarPlus, Download, KeyRound, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FormError } from "@/components/form"
import { api, errorMessage } from "@/lib/api"
import type { ClientRow } from "@/lib/console"

// Bulk actions on the Businesses list (blueprint Phase G). Each action only touches the
// selected businesses it applies to, says which ones it skipped, and runs one at a time so
// every change is checked and recorded like a single one.

const notSignedIn = (c: ClientRow) => !!c.progress && !c.progress.loggedIn
const canAddDays = (c: ClientRow) => c.status === "trialing" || c.status === "past_due"
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

async function each(rows: ClientRow[], fn: (c: ClientRow) => Promise<unknown>) {
  const failed: string[] = []
  for (const c of rows) {
    try {
      await fn(c)
    } catch (e) {
      failed.push(`${c.name}: ${errorMessage(e)}`)
    }
  }
  return failed
}

export function BulkBar({ rows, canExtend, canExport, onExport, onClear, onDone }: { rows: ClientRow[]; canExtend: boolean; canExport: boolean; onExport: () => void; onClear: () => void; onDone: () => void }) {
  const [dialog, setDialog] = React.useState<"link" | "days" | null>(null)
  const links = rows.filter(notSignedIn)
  const days = rows.filter(canAddDays)
  return (
    <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-accent/80 px-3 py-2 text-sm shadow-sm backdrop-blur" role="region" aria-label="Selected businesses">
      <span className="mr-1 font-medium">{rows.length} selected</span>
      <Button size="sm" variant="outline" disabled={!links.length} onClick={() => setDialog("link")} title={links.length ? undefined : "Every selected owner has signed in"}>
        <KeyRound /> Send login link{links.length ? ` (${links.length})` : ""}
      </Button>
      {canExtend && (
        <Button size="sm" variant="outline" disabled={!days.length} onClick={() => setDialog("days")} title={days.length ? undefined : "Only for a free trial or an overdue payment"}>
          <CalendarPlus /> Add days{days.length ? ` (${days.length})` : ""}
        </Button>
      )}
      {canExport && (
        <Button size="sm" variant="outline" onClick={onExport}>
          <Download /> Export
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onClear} className="ml-auto">
        <X /> Clear
      </Button>
      {dialog === "link" && <LinkDialog rows={links} skipped={rows.length - links.length} onClose={() => setDialog(null)} onDone={onDone} />}
      {dialog === "days" && <DaysDialog rows={days} skipped={rows.length - days.length} onClose={() => setDialog(null)} onDone={onDone} />}
    </div>
  )
}

function Result({ failed }: { failed: string[] }) {
  return (
    <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
      <div className="font-medium">{failed.length} could not be done</div>
      <ul className="mt-1 list-disc pl-5">
        {failed.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  )
}

function LinkDialog({ rows, skipped, onClose, onDone }: { rows: ClientRow[]; skipped: number; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false)
  const [failed, setFailed] = React.useState<string[] | null>(null)
  async function send() {
    setBusy(true)
    const f = await each(rows, (c) => api.post(`/console/tenants/${c.id}/login-link`))
    setBusy(false)
    const ok = rows.length - f.length
    if (ok) toast.success(`Login link sent to ${plural(ok, "owner", "owners")}`)
    onDone()
    if (f.length) setFailed(f)
    else onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send a new login link to {plural(rows.length, "owner", "owners")}?</DialogTitle>
          <DialogDescription>
            Each owner gets a new link by SMS and email to set their password. Their old link stops working.
            {skipped > 0 && ` ${plural(skipped, "selected business is", "selected businesses are")} left out: the owner already signed in.`}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 overflow-y-auto rounded-lg border text-sm">
          {rows.map((c) => (
            <li key={c.id} className="border-b px-3 py-1.5 last:border-0">
              {c.name} <span className="text-muted-foreground">· {c.owner?.name}</span>
            </li>
          ))}
        </ul>
        {failed && <Result failed={failed} />}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{failed ? "Close" : "Cancel"}</Button>
          {!failed && <Button onClick={send} disabled={busy}>{busy ? "Sending…" : "Send links"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DaysDialog({ rows, skipped, onClose, onDone }: { rows: ClientRow[]; skipped: number; onClose: () => void; onDone: () => void }) {
  const [days, setDays] = React.useState("7")
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [failed, setFailed] = React.useState<string[] | null>(null)
  async function add(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(days)
    if (!Number.isInteger(n) || n < 1 || n > 30) return setError("Choose 1 to 30 days")
    if (reason.trim().length < 5) return setError("Add a short note (5+ characters)")
    setError(null)
    setBusy(true)
    const f = await each(rows, (c) => api.post(`/console/tenants/${c.id}/extend`, { days: n, reason: reason.trim() }))
    setBusy(false)
    const ok = rows.length - f.length
    if (ok) toast.success(`${n} days added for ${plural(ok, "business", "businesses")}`)
    onDone()
    if (f.length) setFailed(f)
    else onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={add} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add days for {plural(rows.length, "business", "businesses")}</DialogTitle>
            <DialogDescription>
              A free trial runs longer; an overdue payment gets more time before paid modules lock.
              {skipped > 0 && ` ${plural(skipped, "selected business is", "selected businesses are")} left out: not on a trial and not overdue.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Field label="Days">
              <Input type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <Field label="Why" hint="Kept in the audit trail">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Festival week, owner travelling" />
            </Field>
          </div>
          <FormError message={error} />
          {failed && <Result failed={failed} />}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{failed ? "Close" : "Cancel"}</Button>
            {!failed && <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add days"}</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
