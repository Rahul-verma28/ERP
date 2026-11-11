"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CalendarClock, Download, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState, Spinner } from "@/components/common"
import { api, errorMessage } from "@/lib/api"
import { useApi } from "@/lib/use-api"
import { downloadCsv, parseCsv, rowsToContacts } from "@/lib/csv"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

// Shared by Leads and Customers: import a CSV of people, and the follow-ups list.

interface FollowUp {
  id: string
  title: string | null
  body: string | null
  dueAt: string
  contact: { id: string; name: string; phone: string | null } | null
}

export function ImportDialog({ kind, onClose, onDone }: { kind: "customer" | "lead"; onClose: () => void; onDone: () => void }) {
  const [records, setRecords] = React.useState<Record<string, string>[] | null>(null)
  const [unknown, setUnknown] = React.useState<string[]>([])
  const [result, setResult] = React.useState<{ created: number; duplicates: { row: number; name: string; reason: string }[]; errors: { row: number; message: string }[] } | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) return toast.error("Save your Excel sheet as CSV (File → Save As → CSV) and upload that.")
    const { records, unknownColumns } = rowsToContacts(parseCsv(await file.text()))
    if (!records.length) return toast.error("No rows found. The first row must be column headers.")
    if (records.length > 1000) return toast.error("Up to 1,000 rows per import. Split the file and try again.")
    setRecords(records)
    setUnknown(unknownColumns)
  }

  async function run() {
    setBusy(true)
    try {
      setResult(await api.post("/contacts/import", { type: kind, rows: records }))
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import {kind === "lead" ? "leads" : "customers"}</DialogTitle>
          <DialogDescription>Upload a CSV with a header row. Recognised columns: name, phone, email, company, gstin, city, notes. Rows whose phone or email already exists are skipped.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-3 text-sm">
            <p><strong>{result.created}</strong> added · <strong>{result.duplicates.length}</strong> duplicates skipped · <strong>{result.errors.length}</strong> errors</p>
            {[...result.duplicates.map((d) => `Row ${d.row} (${d.name}): ${d.reason}`), ...result.errors.map((e) => `Row ${e.row}: ${e.message}`)].length > 0 && (
              <ul className="max-h-48 overflow-y-auto rounded-2xl bg-muted p-3 text-xs">
                {[...result.duplicates.map((d) => `Row ${d.row} (${d.name}): ${d.reason}`), ...result.errors.map((e) => `Row ${e.row}: ${e.message}`)].map((l) => <li key={l}>{l}</li>)}
              </ul>
            )}
            <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <label className="grid cursor-pointer place-items-center gap-2 rounded-3xl border border-dashed p-8 text-center text-sm hover:bg-muted">
              <Upload className="size-5 text-muted-foreground" />
              {records ? <span><strong>{records.length}</strong> rows ready to import</span> : <span>Choose a .csv file</span>}
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            {unknown.length > 0 && <p className="text-xs text-muted-foreground">Ignored columns: {unknown.join(", ")}</p>}
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="ghost" onClick={() => downloadCsv("customers-template.csv", [["name", "phone", "email", "company", "gstin", "city", "notes"], ["Asha Verma", "9812345678", "asha@example.com", "", "", "Noida", "Prefers mornings"]])}>
                <Download /> Template
              </Button>
              <Button onClick={run} disabled={!records || busy}>{busy ? "Importing…" : "Import"}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function FollowUps() {
  const { data, reload } = useApi<{ data: FollowUp[] }>("/follow-ups")
  const [now] = React.useState(() => Date.now())
  if (!data) return <div className="grid place-items-center py-14"><Spinner /></div>
  if (!data.data.length) return <EmptyState icon={CalendarClock} title="No pending follow-ups" description="Schedule follow-ups from a customer's timeline." />
  return (
    <ul className="divide-y">
      {data.data.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-3 px-6 py-3">
          <div className="min-w-0 flex-1">
            <Link href={`/app/m/crm/${f.contact?.id}`} className="font-medium hover:underline">{f.contact?.name}</Link>
            <p className="truncate text-sm text-muted-foreground">{f.title || f.body}</p>
          </div>
          <span className={cn("text-sm", new Date(f.dueAt).getTime() < now ? "font-medium text-destructive" : "text-muted-foreground")}>{formatDateTime(f.dueAt)}</span>
          <Button size="sm" variant="outline" onClick={() => api.patch(`/activities/${f.id}`, { completed: true }).then(reload).then(() => toast.success("Marked done"))}>Done</Button>
        </li>
      ))}
    </ul>
  )
}

