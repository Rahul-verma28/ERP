"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Field, FormError } from "@/components/form"
import { EmployeeSelect } from "@/components/hr/pickers"
import { todayInIndia } from "@contracts/validation"
import { api, ApiError, errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useApi } from "@/lib/use-api"
import { formatDate } from "@/lib/format"
import { useHrLookups, type LeaveApp } from "@/lib/hr"
import { cn } from "@/lib/utils"

// Leave forms: apply (or change a waiting request), and approve or reject.

interface Balance { types: { id: string; name: string; daysPerYear: number; paid: boolean }[]; data: { leave: { typeId: string; used: number; pending: number; left: number | null }[] }[] }

export function LeaveDialog({ leave, employeeId: fixed, onClose, onSaved }: { leave?: LeaveApp | null; employeeId?: string; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth()
  const look = useHrLookups()
  const own = !can("hr.leave.approve")
  const [f, setF] = React.useState({ employeeId: leave?.employeeId ?? fixed ?? "", leaveTypeId: leave?.leaveTypeId ?? "", fromDate: leave?.fromDate.slice(0, 10) ?? todayInIndia(), toDate: leave?.toDate.slice(0, 10) ?? todayInIndia(), halfDay: leave?.halfDay ?? false, reason: leave?.reason ?? "" })
  const bal = useApi<Balance>(f.employeeId || own ? `/hr/leave-balances${f.employeeId ? `?employeeId=${f.employeeId}` : ""}` : null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v, ...(k === "fromDate" && x.toDate < (v as string) ? { toDate: v as string } : {}) })); setErrors({}); setError(null) }
  const types = (look.data?.leaveTypes ?? []).filter((t) => t.isActive)
  const left = (typeId: string) => bal.data?.data[0]?.leave.find((l) => l.typeId === typeId)
  const sameDay = f.fromDate === f.toDate

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (!own && !f.employeeId) x.employeeId = "Choose the employee"
    if (!f.leaveTypeId) x.leaveTypeId = "Choose the leave type"
    if (!f.fromDate) x.fromDate = "Choose the first day"
    if (!f.toDate) x.toDate = "Choose the last day"
    else if (f.toDate < f.fromDate) x.toDate = "Must be on or after the first day"
    if (f.reason.trim().length < 3) x.reason = "Say why the leave is needed"
    setErrors(x)
    if (Object.keys(x).length) return setError("Fix the marked fields first.")
    setBusy(true)
    const body = { ...f, employeeId: f.employeeId || undefined, halfDay: sameDay && f.halfDay, reason: f.reason.trim() }
    try {
      if (leave) await api.put(`/hr/leaves/${leave.id}`, { ...body, version: leave.version })
      else await api.post("/hr/leaves", body)
      toast.success(leave ? "Leave request changed" : own ? "Leave requested. You'll be told when it is approved." : "Leave request added")
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{leave ? "Change leave request" : own ? "Apply for leave" : "Add leave"}</DialogTitle>
          <DialogDescription>Weekly offs and holidays inside the dates are not counted.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          {!own && !fixed && !leave && <Field label="Employee" required error={errors.employeeId} className="sm:col-span-2"><EmployeeSelect value={f.employeeId} onChange={(v) => set("employeeId", v)} aria-label="Employee" /></Field>}
          <Field label="Leave type" required error={errors.leaveTypeId} className="sm:col-span-2">
            <div className="grid gap-2 sm:grid-cols-2">
              {types.map((t) => {
                const l = left(t.id)
                return (
                  <button key={t.id} type="button" onClick={() => set("leaveTypeId", t.id)} aria-pressed={f.leaveTypeId === t.id} className={cn("flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50", f.leaveTypeId === t.id && "border-primary bg-primary/5 ring-1 ring-primary")}>
                    <span><span className="block font-medium">{t.name}</span><span className="text-xs text-muted-foreground">{t.paid ? "Paid" : "Unpaid"}</span></span>
                    <span className="text-right text-xs text-muted-foreground">{t.daysPerYear ? <><strong className="block text-base text-foreground tabular-nums">{l?.left ?? t.daysPerYear}</strong>left</> : "No limit"}</span>
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label="From" required error={errors.fromDate}><Input type="date" value={f.fromDate} onChange={(e) => set("fromDate", e.target.value)} /></Field>
          <Field label="To" required error={errors.toDate}><Input type="date" value={f.toDate} min={f.fromDate} onChange={(e) => set("toDate", e.target.value)} /></Field>
          {sameDay && <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm sm:col-span-2"><span><span className="font-medium">Half day</span><span className="block text-xs text-muted-foreground">Counts as 0.5 day</span></span><Switch checked={f.halfDay} onCheckedChange={(v) => set("halfDay", v)} aria-label="Half day" /></label>}
          <Field label="Reason" required error={errors.reason} className="sm:col-span-2"><Textarea rows={2} maxLength={500} value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. Sister's wedding in Kanpur" /></Field>
          <div className="sm:col-span-2"><FormError message={error} /></div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : leave ? "Save" : own ? "Request leave" : "Add leave"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DecideDialog({ leave, status, onClose, onSaved }: { leave: LeaveApp; status: "approved" | "rejected"; onClose: () => void; onSaved: () => void }) {
  const [comment, setComment] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (status === "rejected" && comment.trim().length < 3) return setError("Say why it is rejected, so they know.")
    setBusy(true)
    try {
      await api.post(`/hr/leaves/${leave.id}/decide`, { status, comment: comment.trim() || null })
      toast.success(status === "approved" ? `Leave approved for ${leave.employee}` : "Leave rejected")
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{status === "approved" ? "Approve" : "Reject"} leave</DialogTitle>
          <DialogDescription>{leave.employee} · {leave.leaveType} · {formatDate(leave.fromDate)}{leave.toDate !== leave.fromDate ? ` – ${formatDate(leave.toDate)}` : ""} · {leave.days} day{leave.days === 1 ? "" : "s"}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <p className="rounded-xl bg-muted/60 p-3 text-sm">“{leave.reason}”</p>
          <Field label={status === "rejected" ? "Why rejected" : "Note"} required={status === "rejected"}><Textarea rows={2} maxLength={500} value={comment} autoFocus onChange={(e) => { setComment(e.target.value); setError(null) }} placeholder={status === "rejected" ? "e.g. Stock-taking that week, please pick other dates" : "Optional"} /></Field>
          {status === "approved" && <p className="text-xs text-muted-foreground">Each working day is marked as leave in attendance{leave.paid ? "" : ", unpaid (loss of pay)"}.</p>}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant={status === "rejected" ? "destructive" : "default"} disabled={busy}>{busy ? "Saving…" : status === "approved" ? "Approve" : "Reject"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
